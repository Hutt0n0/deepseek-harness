/**
 * Deployment-level HTTP routes for the fleet management face: session-
 * independent listing and replacement of the bee fleet, served under the
 * same browser-trust fence as /rt-skills (Host loopback or webRuntime
 * trustedHosts; same-origin browser markers).
 *
 * @module @dsh-redteam/dsh-bee-fleet/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BeeSpec } from './types.ts'

/** Minimal request facts the fence consumes. */
interface FenceRequest {
  readonly headers: Record<string, string | string[] | undefined>
}

/** JSON body reader with a size bound. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > 256 * 1024) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function header(req: FenceRequest, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost'
    || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '::ffff:127.0.0.1'
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    let entryUrl: URL
    try {
      entryUrl = new URL(entry.includes('://') ? entry : `http://${entry}`)
    } catch {
      return false
    }
    const entryPort = entryUrl.port !== '' ? entryUrl.port : ''
    return entryPort === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** Browser-trust fence, behaviorally identical to the /api gateway's. */
function isTrustedRequest(req: FenceRequest, trustedHosts: readonly string[]): boolean {
  const hostUrl = new URL(`http://${header(req, 'host')}`)
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  const site = header(req, 'sec-fetch-site')
  if (site !== '' && site !== 'same-origin' && site !== 'none') return false
  return true
}

/** Structural validation of one bee spec from the wire. */
function beeFromWire(value: unknown, index: number): BeeSpec {
  if (typeof value !== 'object' || value === null) throw new Error(`bee[${index}] must be an object`)
  const raw = value as Record<string, unknown>
  const toolName = typeof raw.toolName === 'string' ? raw.toolName.trim() : ''
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : ''
  const persona = typeof raw.persona === 'string' ? raw.persona : ''
  if (toolName === '') throw new Error(`bee[${index}].toolName is required`)
  if (!/^[a-z][a-z0-9_]*$/i.test(toolName)) throw new Error(`bee[${index}].toolName "${toolName}" is not a valid tool name`)
  if (kind === '') throw new Error(`bee[${index}].kind is required`)
  if (!/^[a-z][a-z0-9_]*$/i.test(kind)) throw new Error(`bee[${index}].kind "${kind}" is not a valid kind slug`)
  if (persona.trim() === '') throw new Error(`bee[${index}].persona must not be empty`)
  if (!Array.isArray(raw.toolFilter) || raw.toolFilter.some(name => typeof name !== 'string')) {
    throw new Error(`bee[${index}].toolFilter must be a string array (empty is rejected — a bee with no tools cannot work)`)
  }
  const toolFilter = raw.toolFilter as string[]
  if (toolFilter.length === 0) throw new Error(`bee[${index}].toolFilter must not be empty`)
  const backgroundMode = raw.backgroundMode === 'one-shot' ? 'one-shot' : 'continuable'
  return { toolName, kind, persona, toolFilter, backgroundMode }
}

/** Route handler dependencies. */
export interface FleetRoutesDeps {
  /** Browser-trust authorities from the web runtime. */
  readonly trustedHosts: readonly string[]
  /** Current fleet, in configured order. */
  readonly list: () => readonly BeeSpec[]
  /** Replace the whole fleet (validated upstream of the caller). */
  readonly set: (bees: readonly BeeSpec[]) => Promise<void>
  /** Platform tool names available for the toolbox editor. */
  readonly knownTools: () => readonly string[]
}

/** Build the prefix-route handler for /rt-fleet/<method>. */
export function handleFleetRoute(deps: FleetRoutesDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!isTrustedRequest(req, deps.trustedHosts)) {
      writeJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      .replace(/^\/rt-fleet\/?/, '')
    try {
      if (method === 'list') {
        writeJson(res, 200, { ok: true, bees: deps.list(), knownTools: deps.knownTools() })
        return
      }
      if (method === 'set') {
        const body = await readJson(req)
        if (!Array.isArray(body.bees)) throw new Error('bees must be an array')
        const bees = body.bees.map(beeFromWire)
        const toolNames = new Set<string>()
        const kinds = new Set<string>()
        for (const [index, bee] of bees.entries()) {
          if (toolNames.has(bee.toolName)) throw new Error(`duplicate toolName "${bee.toolName}" (bee[${index}])`)
          toolNames.add(bee.toolName)
          if (kinds.has(bee.kind)) throw new Error(`duplicate kind "${bee.kind}" (bee[${index}])`)
          kinds.add(bee.kind)
        }
        await deps.set(bees)
        writeJson(res, 200, { ok: true })
        return
      }
      writeJson(res, 404, { ok: false, error: `unknown method "${method}"` })
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
