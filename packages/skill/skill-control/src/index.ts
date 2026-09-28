/**
 * Red-team skill control: runtime enable/disable of individual skills plus
 * per-bee skill assignment.
 *
 * Mechanism: a preset-layer skill provider re-lists every locally discovered
 * skill, flipping `invocation.modelInvocable` to false for user-disabled
 * names. The registry nearest-layer-wins merge then shadows the global
 * layer live entry, and tool-skill own invocation checks exclude the
 * disabled skill from the model catalog and the skill tool — no platform
 * package is modified. A second channel assigns skills to bee kinds: at
 * agent/created for a depth-1 subagent, the assigned skills full content
 * is registered as agent-scoped system-prompt sections (sync registration —
 * content is preloaded into a cache at apply time). The management face
 * reads through the deployment HTTP routes and the generic settings Remote.
 *
 * @module @dsh-redteam/dsh-skill-control
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.agents events (agent/created), the projection face,
// and the `subagent` projection key's SessionProjectionMap augmentation.
import type { SubagentIdentityProjection } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-projection'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import type {
  SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillProviderControl,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { handleSkillRoute } from './routes.ts'
import { RT_SKILLS_SETTINGS_NAMESPACE } from './types.ts'

export type { RtSkillsSettings, SkillControlItem } from './types.ts'
export { RT_SKILLS_SETTINGS_NAMESPACE }

export const CONTROL_PROVIDER_NAME = 'rt-skill-control'

export const name = 'rt-skill-control'

export const inject = ['settings', 'skills', 'webServer', 'webRuntime'] as const


export interface Config {
  readonly projectCwd?: string
}

export const Config = z.object({
  projectCwd: z.string(),
})

/* webServer/webRuntime are bundle-level services without a package-owned
static face; structural local declarations avoid cross-package type imports
(which would drag foreign src under this package's rootDir). */
interface WebServerFace {
  register(route: {
    readonly kind: 'exact' | 'prefix'
    readonly path: string
    readonly handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
  }): () => void
}
interface WebRuntimeFace {
  readonly trustedHosts: readonly string[]
}

function candidatesOf(output: readonly SkillCandidate[] | SkillProviderObservation): readonly SkillCandidate[] {
  return 'candidates' in output ? output.candidates : output
}

function controlProvider(
  underlying: () => SkillProvider,
  isDisabled: (name: string) => boolean,
): SkillProvider {
  return {
    name: CONTROL_PROVIDER_NAME,
    async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
      const candidates = candidatesOf(await underlying().list(options))
      return candidates.map(candidate => ({
        ...candidate,
        provider: CONTROL_PROVIDER_NAME,
        ...(isDisabled(candidate.name)
          ? { invocation: { ...candidate.invocation, modelInvocable: false } }
          : {}),
      }))
    },
    async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
      const definition = await underlying().get(candidate, options)
      if (definition === undefined) return undefined
      return { ...definition, provider: CONTROL_PROVIDER_NAME }
    },
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const settingsScope = ctx.settings.register(RT_SKILLS_SETTINGS_NAMESPACE, z.object({
    disabled: z.array(z.string()).default([]),
    // Keys are fleet kinds — an open set synced with the bee fleet's YAML.
    // Runtime z.dict(string-array) is exact; the schema helper's TS overload
    // is single-argument, so keep the schema untyped at the helper boundary.
    beeSkills: z.dict(z.array(z.string())),
  }), {
    base: { disabled: [], beeSkills: {} },
  })
  let fsProvider: FileSystemSkillProvider | undefined
  let providerControl: SkillProviderControl | undefined
  const disabledSet = (): ReadonlySet<string> => new Set(settingsScope.get().disabled)

  const fsProviderForBees = (): FileSystemSkillProvider => {
    if (fsProvider === undefined) {
      fsProvider = new FileSystemSkillProvider(ctx, {
        signal: new AbortController().signal,
        invalidate: () => {
          providerControl?.invalidate()
        },
      }, {
        providerName: `${CONTROL_PROVIDER_NAME}-fs`,
      })
    }
    return fsProvider
  }

  ctx.skills.registerProvider((control: SkillProviderControl): SkillProvider => {
    providerControl = control
    return controlProvider(
      () => fsProviderForBees(),
      skillName => disabledSet().has(skillName),
    )
  })
  settingsScope.watch(() => {
    providerControl?.invalidate()
    refreshCache()
  })

  const contentCache = new Map<string, SkillDefinition>()
  const refreshCache = (): void => {
    void (async () => {
      try {
        const provider = fsProviderForBees()
        const candidates = candidatesOf(await provider.list({
          cwd: config.projectCwd ?? process.cwd(),
          signal: new AbortController().signal,
        }))
        for (const candidate of candidates) {
          const definition = await provider.get(candidate, {
            cwd: config.projectCwd ?? process.cwd(),
            signal: new AbortController().signal,
          })
          if (definition !== undefined) contentCache.set(definition.name, definition)
        }
      } catch (error) {
        ctx.logger.warn(`rt-skill-control: content cache refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }
  refreshCache()

  let routeListing: FileSystemSkillProvider | undefined
  const webServer = (ctx as unknown as { webServer: WebServerFace }).webServer
  const trustedHosts = ((ctx.get('webRuntime') as WebRuntimeFace | undefined)?.trustedHosts) ?? []
  webServer.register({
    kind: 'prefix',
    path: '/rt-skills',
    handler: handleSkillRoute({
      trustedHosts,
      list: async () => {
        if (routeListing === undefined) {
          routeListing = new FileSystemSkillProvider(ctx, {
            signal: new AbortController().signal,
            invalidate: () => {},
          }, {
            providerName: `${CONTROL_PROVIDER_NAME}-mgmt`,
          })
        }
        const disabled = new Set(settingsScope.get().disabled)
        const candidates = candidatesOf(await routeListing.list({
          cwd: config.projectCwd ?? process.cwd(),
          signal: new AbortController().signal,
        }))
        return candidates.map(candidate => ({
          name: candidate.name,
          description: candidate.description,
          source: candidate.source,
          ...(candidate.path !== undefined ? { path: candidate.path } : {}),
          modelInvocable: candidate.invocation.modelInvocable,
          userInvocable: candidate.invocation.userInvocable,
          enabled: !disabled.has(candidate.name) && candidate.invocation.modelInvocable,
        })).sort((a, b) => a.name.localeCompare(b.name))
      },
      setEnabled: async (skillName, enabled) => {
        const current = new Set(settingsScope.get().disabled)
        if (enabled) current.delete(skillName)
        else current.add(skillName)
        await settingsScope.replace({ disabled: [...current].sort() })
      },
      setBeeSkills: async (bee, names) => {
        const current = settingsScope.get().beeSkills
        await settingsScope.replace({ beeSkills: { ...current, [bee]: [...names].sort() } })
      },
      beeSkills: () => Promise.resolve(settingsScope.get().beeSkills as unknown as Record<string, readonly string[]>),
      fleetKinds: () => [...fleetBees().map(bee => bee.kind)],
    }),
  })

  /** toolName → (kind, persona) from the bee fleet's YAML (same source of
   * truth the fleet mounts from). Refreshed lazily on each use — reads are tiny. */
  const fleetBees = (): readonly { readonly toolName: string; readonly kind: string; readonly persona: string }[] => {
    try {
      const file = join(config.projectCwd ?? process.cwd(), 'fleet', 'fleet.yaml')
      const parsed = parse(readFileSync(file, 'utf8')) as {
        bees?: readonly { toolName?: unknown; kind?: unknown; persona?: unknown }[]
      }
      return (parsed.bees ?? []).flatMap(bee =>
        typeof bee.toolName === 'string' && typeof bee.kind === 'string' && typeof bee.persona === 'string'
          ? [{ toolName: bee.toolName, kind: bee.kind, persona: bee.persona }]
          : [])
    } catch {
      // A missing/unreadable fleet file means no kind channel; the label
      // fallback below still applies.
      return []
    }
  }
  /** Legacy label-prefix recognition for bees mounted outside the fleet. */
  const kindFromLabel = (label: string): string | undefined =>
    label.startsWith('recon:') || /(^|\W)侦察蜂?(\W|$)/.test(label) ? 'recon'
      : label.startsWith('jsint:') || /JS分析/.test(label) ? 'jsint'
        : label.startsWith('web:') || /打点/.test(label) ? 'web'
          : label.startsWith('pivot:') || /横向/.test(label) ? 'pivot'
            : undefined

  ctx.on('agent/created', ({ agent }): undefined | Promise<undefined> => {
    const run = async (): Promise<undefined> => {
      const header = agent.session.header
      if (header.delegationDepth !== 1 || header.origin !== 'subagent') return undefined
      // Kind channel: the child's persona IS the dispatching tool's persona
      // (child-agent installs it as `deployment:persona-prefix`), so matching
      // it against the fleet YAML resolves toolName → kind structurally — no
      // label-prefix discipline required. The label heuristic covers
      // out-of-fleet bees.
      const assembly = await agent.ctx.systemPrompt.assemble()
      const personaText = assembly.sections
        .find(section => section.name === 'deployment:persona-prefix')?.text ?? ''
      const fleet = fleetBees()
      const byPersona = fleet.find(bee => bee.persona === personaText)
      const kind = byPersona?.kind ?? kindFromLabel(identityLabel(agent))
      if (kind === undefined) return undefined
      const assignments = settingsScope.get().beeSkills[kind] as readonly string[] | undefined
      const assigned = (assignments ?? []).filter((skillName: string) => !disabledSet().has(skillName))
      if (assigned.length === 0) return undefined
      if (contentCache.size === 0) refreshCache()
      for (const skillName of assigned) {
        const definition = contentCache.get(skillName)
        if (definition === undefined) continue
        agent.ctx.systemPrompt.section({
          name: `rt-skill:${definition.name}`,
          order: 100,
          text: `<assigned_skill name="${definition.name}">\n${definition.content}\n</assigned_skill>`,
        })
      }
    }
    return run().catch((error: unknown): undefined => {
      ctx.logger.warn(`rt-skill-control: agent/created handler failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  })
}

/** Durable creation label of one freshly created subagent, from the identity projection. */
function identityLabel(agent: Agent): string {
  const projections = agent.ctx.get('sessionProjections')
  const identity: SubagentIdentityProjection | null | undefined =
    projections === undefined ? undefined : projections.snapshot(agent.session, ['subagent']).values.subagent
  return identity === undefined || identity === null ? '' : (identity.label ?? '')
}
