/**
 * Deployment-level HTTP routes for the skills management face: session-
 * independent listing and toggling, served under a browser-trust fence
 * behaviorally identical to the /api gateway (Host loopback or webRuntime
 * trusted authorities; same-origin browser markers).
 *
 * @module @dsh-redteam/dsh-skill-control/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillControlItem } from './types.ts'

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
    if (total > 64 * 1024) throw new Error('request body too large')
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

/** Route handler dependencies. */
export interface SkillRoutesDeps {
  /** Browser-trust authorities from the web runtime. */
  readonly trustedHosts: readonly string[]
  /** List skills for the deployment (cwd-independent roots). */
  readonly list: () => Promise<readonly SkillControlItem[]>
  /** Persist one enable/disable flip. */
  readonly setEnabled: (name: string, enabled: boolean) => Promise<void>
  /** Persist one bee kind's skill assignment. */
  readonly setBeeSkills: (bee: string, names: readonly string[]) => Promise<void>
  /** Read the current per-bee assignments. */
  readonly beeSkills: () => Promise<Record<string, readonly string[]>>
}

/** Build the prefix-route handler for /rt-skills/<method>. */
export function handleSkillRoute(deps: SkillRoutesDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
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
      .replace(/^\/rt-skills\/?/, '')
    try {
      if (method === 'list') {
        writeJson(res, 200, { ok: true, items: await deps.list() })
        return
      }
      if (method === 'set') {
        const body = await readJson(req)
        const skillName = typeof body.name === 'string' ? body.name : ''
        const enabled = body.enabled === true
        if (skillName === '') throw new Error('name is required')
        await deps.setEnabled(skillName, enabled)
        writeJson(res, 200, { ok: true })
        return
      }
      if (method === 'beeSkills') {
        writeJson(res, 200, { ok: true, beeSkills: await deps.beeSkills() })
        return
      }
      if (method === 'setBeeSkills') {
        const body = await readJson(req)
        const bee = typeof body.bee === 'string' ? body.bee : ''
        const names = Array.isArray(body.skills) ? body.skills.filter((n): n is string => typeof n === 'string') : []
        if (!['recon', 'jsint', 'web', 'pivot'].includes(bee)) throw new Error(`unknown bee kind "${bee}"`)
        await deps.setBeeSkills(bee, names)
        writeJson(res, 200, { ok: true })
        return
      }
      writeJson(res, 404, { ok: false, error: `unknown method "${method}"` })
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
