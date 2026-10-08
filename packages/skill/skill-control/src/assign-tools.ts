/**
 * Commander-facing skill-assignment tools: the `skill_assign` /
 * `skill_assignment_view` pair over the `rt-skills.beeSkills` channel — the
 * SAME data the skills management page writes, so operator and commander
 * edits stay one source of truth. Assignment is per fleet KIND (the bee
 * line-up's kind channel, gated live against fleet.yaml); assigned skills
 * inject into newly created bees of that kind at `agent/created`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SkillCandidate, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { RtSkillsSettings } from './types.ts'

export const name = 'rt-skill-assign-tools'

export const inject = ['tools', 'settings', 'skills'] as const

type JsonRecord = Record<string, JsonValue>

/** Resolve the calling agent (the commander); assignment tools are commander-side. */
function agentOf(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  const agent = exec.agent
  if (agent === undefined) throw new Error('skill assignment tools require an initiating agent')
  return agent
}

/** One assignable skill as the tools see it. */
interface AssignableSkill {
  readonly name: string
  readonly modelInvocable: boolean
}

/** Shared tool context resolved once per apply. */
interface AssignToolContext {
  readonly settings: SettingsScope<RtSkillsSettings>
  readonly fleetKinds: () => readonly string[]
  readonly listableSkills: (scope: unknown) => Promise<readonly AssignableSkill[]>
}

/** Minimal shape of the skills provider this package reads through. */
interface SkillsProviderFace {
  list(options?: { cwd?: string; scope?: unknown }): Promise<readonly SkillCandidate[] | SkillProviderObservation>
}

export function apply(
  ctx: Context,
  config: { projectCwd?: string },
  settingsScope: SettingsScope<RtSkillsSettings>,
): void {
  /** Kinds of the live bee fleet (fleet.yaml — same source bee-fleet mounts). */
  const fleetKinds = (): readonly string[] => {
    try {
      const file = join(config.projectCwd ?? process.cwd(), 'fleet', 'fleet.yaml')
      const parsed = parse(readFileSync(file, 'utf8')) as { bees?: readonly { kind?: unknown }[] }
      return (parsed.bees ?? []).flatMap(bee => typeof bee.kind === 'string' ? [bee.kind] : [])
    } catch {
      return []
    }
  }

  /** Skill names visible to the calling agent (respects runtime disables).
   * scope comes from the calling agent: the filesystem skill provider mounts
   * on the preset standing scope, so an unscooped global read sees nothing.
   * cwd rides the config so project-root skills (.dsh/skills) are discovered. */
  const listableSkills = async (scope: unknown): Promise<readonly AssignableSkill[]> => {
    const skills = (ctx as unknown as { skills: SkillsProviderFace }).skills
    const output = await skills.list({
      cwd: config.projectCwd ?? process.cwd(),
      ...scope === undefined ? {} : { scope: scope as never },
    })
    const candidates: readonly SkillCandidate[] = 'candidates' in output ? output.candidates : output
    const disabled = new Set(settingsScope.get().disabled ?? [])
    return candidates.map(candidate => ({
      name: candidate.name,
      modelInvocable: candidate.invocation.modelInvocable && !disabled.has(candidate.name),
    })).sort((a, b) => a.name.localeCompare(b.name))
  }

  const shared: AssignToolContext = { settings: settingsScope, fleetKinds, listableSkills }

  ctx.tools.register(defineTool({
    name: 'skill_assignment_view',
    description:
      'View the current skill assignments per bee kind. Use before dispatching when you need a bee '
      + 'that carries specific playbooks: check which skills each kind carries, then dispatch the '
      + 'matching kind (or reassign first with skill_assign).',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(_args, exec) {
      exec.signal.throwIfAborted()
      agentOf(exec)
      const beeSkills = shared.settings.get().beeSkills ?? {}
      const kinds = shared.fleetKinds()
      const rows: JsonValue[] = kinds.map(kind => ({
        kind,
        skills: (beeSkills[kind] ?? []).slice().sort(),
      }))
      return Promise.resolve({
        ok: true,
        kinds: rows,
        // Kinds left in the settings by removed fleet kinds — visible so the
        // commander knows stale assignments exist.
        staleKinds: Object.keys(beeSkills).filter(kind => !kinds.includes(kind)).sort(),
      } satisfies JsonRecord)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'skill_assign',
    description:
      'Assign skills to one bee kind. The assigned skills are injected into NEWLY created bees of '
      + 'that kind as <assigned_skill> doctrine sections (running bees are unaffected). Kind must '
      + 'exist in the current fleet; a skill that is statically blocked or runtime-disabled is '
      + 'rejected. A stale kind (one skill_assignment_view lists under staleKinds — removed from the '
      + 'fleet) may only be CLEARED: pass its name with skills=[] to delete the dead assignment key. '
      + 'Assign when the battlefield needs a specific playbook on a bee — e.g. hand '
      + 'kerberoast-playbook to the pivot kind before domain work.',
    parameters: {
      kind: { type: 'string', required: true, description: 'Bee kind from the fleet (see skill_assignment_view)' },
      skills: { type: 'array', items: { type: 'string' }, required: true, description: 'Full skill-name list for this kind (replaces the previous assignment; empty list clears it)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      agentOf(exec)
      const kinds = shared.fleetKinds()
      const isStale = !kinds.includes(args.kind)
      // Stale kinds (removed from the fleet) may ONLY be cleared — this is
      // the one sanctioned deletion channel for legacy beeSkills keys, which
      // otherwise survive every spread-merge forever. Assigning skills to a
      // stale kind stays rejected.
      if (isStale && args.skills.length > 0) {
        return Promise.resolve({ ok: false, error: `unknown bee kind "${args.kind}" — fleet kinds: ${kinds.join(', ') || '(fleet empty)'}` })
      }
      return (async (): Promise<JsonRecord> => {
        if (isStale) {
          const current = shared.settings.get().beeSkills ?? {}
          const next: Record<string, readonly string[]> = {}
          for (const [key, value] of Object.entries(current)) {
            if (key !== args.kind && value !== undefined) next[key] = value
          }
          await shared.settings.replace({ beeSkills: next })
          return { ok: true, kind: args.kind, cleared: true, remainingKinds: Object.keys(next).sort() }
        }
        const available = await shared.listableSkills(scopeOf(agentOf(exec).ctx))
        const byName = new Map(available.map(skill => [skill.name, skill]))
        const unknown = args.skills.filter(name => !byName.has(name))
        if (unknown.length > 0) {
          return { ok: false, error: `unknown skills: ${unknown.join(', ')}` }
        }
        const blocked = args.skills.filter(name => byName.get(name)?.modelInvocable === false)
        if (blocked.length > 0) {
          return { ok: false, error: `skills statically blocked or disabled: ${blocked.join(', ')}` }
        }
        const current = shared.settings.get().beeSkills ?? {}
        await shared.settings.replace({ beeSkills: { ...current, [args.kind]: [...args.skills].sort() } })
        return { ok: true, kind: args.kind, skills: [...args.skills].sort() }
      })()
    },
  }))
}
