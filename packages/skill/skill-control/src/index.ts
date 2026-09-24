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

import type { Context } from '@deepseek-ai/cordis'
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
    beeSkills: z.object({
      recon: z.array(z.string()).default([]),
      jsint: z.array(z.string()).default([]),
      web: z.array(z.string()).default([]),
      pivot: z.array(z.string()).default([]),
    }),
  }), {
    base: { disabled: [], beeSkills: { recon: [], jsint: [], web: [], pivot: [] } },
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
      beeSkills: () => Promise.resolve(settingsScope.get().beeSkills),
    }),
  })

  ctx.on('agent/created', ({ agent }): undefined | Promise<undefined> => {
    try {
      const header = agent.session.header
      if (header.delegationDepth !== 1 || header.origin !== 'subagent') return
      // Durable identity via the `subagent` projection unit (last-wins
      // descriptor fold) — not a synchronous history scan.
      const projections = agent.ctx.get('sessionProjections')
      const identity: SubagentIdentityProjection | null | undefined =
        projections === undefined ? undefined : projections.snapshot(agent.session, ['subagent']).values.subagent
      if (identity === undefined || identity === null) return
      const label = identity.label ?? ''
      const kind = label.startsWith('recon:') || /(^|\W)侦察蜂?(\W|$)/.test(label) ? 'recon'
        : label.startsWith('jsint:') || /JS分析/.test(label) ? 'jsint'
          : label.startsWith('web:') || /打点/.test(label) ? 'web'
            : label.startsWith('pivot:') || /横向/.test(label) ? 'pivot'
              : undefined
      if (kind === undefined) return
      const assigned = settingsScope.get().beeSkills[kind].filter(skillName => !disabledSet().has(skillName))
      if (assigned.length === 0) return
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
    } catch (error) {
      ctx.logger.warn(`rt-skill-control: agent/created handler failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
