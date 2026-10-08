/**
 * Red-team bee fleet: the commander's worker line-up as live configuration.
 *
 * Mechanism: the fleet (toolName / kind / persona / toolFilter per bee) is
 * persisted as YAML under the project cwd; apply() mounts one `tool-subagent`
 * child fiber per bee via `ctx.plugin`, and a fleet replacement disposes the
 * removed fibers and mounts the new line-up — live, without a process
 * restart. Existing bee sessions keep running to settlement; new dispatches
 * use the new configuration. The management face reads through the
 * deployment HTTP routes (`/rt-fleet/list|set`).
 *
 * @module @dsh-redteam/dsh-bee-fleet
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import type { BeeSpec } from './types.ts'
import { handleFleetRoute } from './routes.ts'

export type { BeeSpec, BeeEntry, FleetSetBody, FleetError } from './types.ts'

export const name = 'rt-bee-fleet'

export const inject = ['webServer', 'webRuntime', 'tools'] as const

export interface Config {
  /** Workspace root holding the fleet definition (fleet/fleet.yaml). */
  readonly projectCwd?: string
}

/** Fleet persistence: relative to projectCwd. */
const FLEET_DIR = 'fleet'
const FLEET_FILE = 'fleet.yaml'

/** Structural validation for one bee loaded from YAML — the same rules as
 * the HTTP wire path (slug regex, cross-fleet dedup), so a hand-edited
 * fleet.yaml cannot mount a fleet the management API would reject. */
function validateFleet(bees: readonly BeeSpec[]): readonly BeeSpec[] {
  const toolNames = new Set<string>()
  const kinds = new Set<string>()
  for (const [index, bee] of bees.entries()) {
    if (!/^[a-z][a-z0-9_]*$/i.test(bee.toolName)) throw new Error(`fleet.yaml: bee[${index}].toolName "${bee.toolName}" is not a valid tool name`)
    if (!/^[a-z][a-z0-9_]*$/i.test(bee.kind)) throw new Error(`fleet.yaml: bee[${index}].kind "${bee.kind}" is not a valid kind slug`)
    if (toolNames.has(bee.toolName)) throw new Error(`fleet.yaml: duplicate toolName "${bee.toolName}" (bee[${index}])`)
    toolNames.add(bee.toolName)
    if (kinds.has(bee.kind)) throw new Error(`fleet.yaml: duplicate kind "${bee.kind}" (bee[${index}])`)
    kinds.add(bee.kind)
  }
  return bees
}

/** Structural validation for one bee loaded from YAML. */
function beeFromConfig(value: unknown, index: number): BeeSpec {
  if (typeof value !== 'object' || value === null) throw new Error(`fleet.yaml: bee[${index}] must be a mapping`)
  const raw = value as Record<string, unknown>
  const toolName = typeof raw.toolName === 'string' ? raw.toolName.trim() : ''
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : ''
  const persona = typeof raw.persona === 'string' ? raw.persona : ''
  if (toolName === '') throw new Error(`fleet.yaml: bee[${index}].toolName is required`)
  if (kind === '') throw new Error(`fleet.yaml: bee[${index}].kind is required`)
  if (persona.trim() === '') throw new Error(`fleet.yaml: bee[${index}].persona must not be empty`)
  if (!Array.isArray(raw.toolFilter) || raw.toolFilter.length === 0
    || raw.toolFilter.some(name => typeof name !== 'string')) {
    throw new Error(`fleet.yaml: bee[${index}].toolFilter must be a non-empty string array`)
  }
  const backgroundMode = raw.backgroundMode === 'one-shot' ? 'one-shot' : 'continuable'
  return { toolName, kind, persona, toolFilter: raw.toolFilter as readonly string[], backgroundMode }
}

/** Read and validate the fleet file; a missing file means an empty fleet.
 * A PRESENT but broken file throws (fail-loud at mount — the same contract
 * as the management API), never a silently empty fleet. */
function readFleet(file: string): readonly BeeSpec[] {
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed = parse(content) as { bees?: unknown }
  if (!Array.isArray(parsed.bees)) return []
  return validateFleet((parsed.bees as unknown[]).map(beeFromConfig))
}

/** Render the fleet file (yaml lib: literal blocks and flow arrays come out stable). */
function renderFleet(bees: readonly BeeSpec[]): string {
  const header = [
    '# 红队蜂群编制 — 蜂群管理页写入；保存后 bee-fleet 热重载（新会话生效，运行中蜂不受影响）。',
    '# toolName 全局唯一；kind 是技能装载与画板的工种通道；toolFilter 非空。',
  ].join('\n')
  return `${header}\n${stringify({ bees }, { lineWidth: 0 })}`
}

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

/** Apply: load the fleet, mount one tool-subagent child per bee, serve /rt-fleet. */
export function apply(ctx: Context, config: Config): void {
  const projectCwd = config.projectCwd ?? process.cwd()
  const fleetFile = join(projectCwd, FLEET_DIR, FLEET_FILE)

  let current: readonly BeeSpec[] = []
  const mounted = new Map<string, { dispose: () => unknown }>()

  /** Mount one bee as a child tool-subagent fiber; returns its disposer. */
  const mountBee = (bee: BeeSpec): { dispose: () => unknown } => {
    const child = ctx.plugin({
      name: `rt-bee-fleet:${bee.toolName}`,
      inject: ToolSubagent.inject,
      apply: (childCtx: Context) => {
        ToolSubagent.apply(childCtx, {
          provider: 'spawn',
          toolName: bee.toolName,
          backgroundMode: bee.backgroundMode,
          enableRunInBackground: true,
          // The kind stamp rides INSIDE the persona: skill-control resolves
          // the bee's kind from its durable persona text, so an operator
          // editing the fleet persona later must not break kind resolution
          // for cold-resumed bees (the persona-equality channel alone dies
          // on the first edit). The stamp is a stable machine line.
          persona: `${bee.persona}\n\n<!-- rt-bee-kind:${bee.kind} -->`,
          toolFilter: { allow: [...bee.toolFilter] },
          maxDepth: 1,
        })
      },
    })
    return { dispose: () => child.dispose() }
  }

  /** Replace the mounted line-up with the given fleet (diff by toolName). */
  const reconcile = (next: readonly BeeSpec[]): void => {
    for (const [toolName, fiber] of mounted) {
      const keep = next.find(bee => bee.toolName === toolName)
      if (keep !== undefined && sameBee(current.find(bee => bee.toolName === toolName), keep)) continue
      void fiber.dispose()
      mounted.delete(toolName)
    }
    for (const bee of next) {
      const existing = current.find(candidate => candidate.toolName === bee.toolName)
      if (existing !== undefined && sameBee(existing, bee) && mounted.has(bee.toolName)) continue
      mounted.set(bee.toolName, mountBee(bee))
    }
    current = next
  }

  const initial = readFleet(fleetFile)
  reconcile(initial)

  /** Curated toolbox universe: the standard preset's model-facing tool names
   * a bee worker can meaningfully carry (verified registrations). The tools
   * registry itself is agent-scoped, so a deployment-level read cannot list
   * them; this fixed set matches the platform's shipped toolkits. */
  const BEE_TOOL_UNIVERSE: readonly string[] = [
    'bash', 'read', 'write', 'edit', 'glob', 'grep', 'todo_write',
    'web_fetch', 'web_search', 'skill', 'job_output', 'job_kill', 'job_list',
    // Reporting/cooperation channels — omitting these here is exactly how the
    // first engagement lost its send_message report path (persona ordered
    // "report via send_message" while the UI could not grant the tool).
    'send_message', 'board_suggest', 'interrupt_agent', 'list_agents',
  ]
  const knownTools = (): readonly string[] => BEE_TOOL_UNIVERSE

  const webServer = (ctx as unknown as { webServer: WebServerFace }).webServer
  const trustedHosts = ((ctx.get('webRuntime') as WebRuntimeFace | undefined)?.trustedHosts) ?? []
  webServer.register({
    kind: 'prefix',
    path: '/rt-fleet',
    handler: handleFleetRoute({
      trustedHosts,
      list: () => current,
      set: (bees) => {
        mkdirSync(dirname(fleetFile), { recursive: true })
        writeFileSync(fleetFile, renderFleet(bees), 'utf8')
        reconcile(bees)
        return Promise.resolve()
      },
      knownTools,
    }),
  })

  ctx.logger.info('rt-bee-fleet: mounted %s bee(s) from %s', current.length, fleetFile)
}

/** Structural equality for reconcile diffing. */
function sameBee(a: BeeSpec | undefined, b: BeeSpec): boolean {
  if (a === undefined) return false
  return a.toolName === b.toolName && a.kind === b.kind && a.persona === b.persona
    && a.backgroundMode === b.backgroundMode
    && a.toolFilter.length === b.toolFilter.length
    && a.toolFilter.every((name, index) => name === b.toolFilter[index])
}
