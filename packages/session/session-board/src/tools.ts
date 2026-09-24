/**
 * Commander-facing `board_*` tools: the ONLY write path to the engagement
 * board. Each tool resolves the calling agent's session, wraps a
 * {@link BoardWriter} over it, validates the mutation, and returns the
 * machine-readable post-op state (the model self-corrects from it).
 * Invalid transitions are rejected with `ok: false` plus the current
 * status — never silently coerced.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { BoardWriter, BoardOpInvalidError } from './index.ts'
import type {
  BoardBeeKind, BoardCard, BoardEvidence, BoardSurface,
} from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const name = 'rt-board-tools'

export const inject = ['tools', 'sessionProjections'] as const

type JsonRecord = Record<string, JsonValue>

interface EvidenceInput {
  readonly kind: 'command' | 'output' | 'artifact' | 'transcript'
  readonly path?: string
  readonly excerpt?: string
  readonly byBee?: string
}

/** Surface schema shared by every card-creating tool. */
const surfaceSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    host: { type: 'string', required: true, description: 'Target host or IP' },
    port: { type: 'number', description: 'Port, when pinned' },
    service: { type: 'string', description: 'Service name (http/ldap/ssh/...)' },
    path: { type: 'string', description: 'Path or endpoint, when pinned' },
  },
} as const

/** Evidence-item schema shared by tools that attach evidence. */
const evidenceSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    kind: { type: 'string', required: true, enum: ['command', 'output', 'artifact', 'transcript'] },
    path: { type: 'string', description: 'Workspace-relative artifact path' },
    excerpt: { type: 'string', description: 'One-line excerpt shown on the card face' },
    byBee: { type: 'string', description: 'Bee session id that produced it, when applicable' },
  },
} as const

function writerOf(pluginCtx: Context, exec: ToolRunContext): BoardWriter {
  const agent = exec.agent
  if (agent === undefined) throw new Error('board tools require an initiating agent')
  const registry = pluginCtx.get('sessionProjections')
  if (registry === undefined) throw new Error('board tools require the sessionProjections registry')
  return new BoardWriter(agent.session, registry)
}

function ok(value: JsonRecord): JsonRecord {
  return { ok: true, ...value }
}

function fail(error: unknown): JsonRecord {
  if (error instanceof BoardOpInvalidError) return { ok: false, error: error.message }
  throw error
}

/** Normalize one evidence input into the durable record. */
function evidenceOf(input: EvidenceInput): BoardEvidence {
  return {
    id: '', // minted by the writer
    kind: input.kind,
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
    ...(input.byBee !== undefined ? { byBee: input.byBee } : {}),
    ts: 0, // minted by the writer
  }
}

/** Summarize one card for the model's post-op readback. */
function cardSummary(card: BoardCard): JsonRecord {
  return {
    id: card.id,
    shortId: card.shortId,
    kind: card.kind,
    title: card.title,
    status: card.status,
    surface: { ...card.surface },
    evidenceCount: card.evidence.length,
    taskCount: card.tasks.length,
  }
}

export function apply(ctx: Context): void {
  const writerFor = (exec: ToolRunContext): BoardWriter => writerOf(ctx, exec)

  ctx.tools.register(defineTool({
    name: 'board_idea',
    description:
      'Put a mining idea (gray card) on the engagement board. Requires a falsifiable validation '
      + 'hypothesis — how success will be judged. One idea per surface+title; reuse or merge existing cards. '
      + 'Every dispatch must ride a card: 要派工，先落卡.',
    parameters: {
      title: { type: 'string', required: true, description: 'One-line attack hypothesis (≤80 chars)' },
      hypothesis: { type: 'string', required: true, description: 'Falsifiable validation probe: what exactly to try and what result counts as success' },
      surface: surfaceSchema,
      detail: { type: 'string', description: 'Optional markdown context (≤2000 chars)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const card = writer.putCard({
          kind: 'idea',
          title: args.title,
          hypothesis: args.hypothesis,
          ...(args.detail !== undefined ? { detail: args.detail } : {}),
          surface: args.surface as unknown as BoardSurface,
        }, 'commander')
        return Promise.resolve(ok({ card: cardSummary(card) }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_dispatch',
    description:
      'Record a dispatch from a card to a bee and flip an open idea to verifying. Call AFTER starting '
      + 'the bee via subagent_* (one bee per card unless force). The bee kind must match the work: '
      + 'recon maps surfaces, enum verifies hypotheses, exploit fires PoCs.',
    parameters: {
      cardId: { type: 'string', required: true, description: 'Card id the dispatch rides on' },
      beeKind: { type: 'string', required: true, enum: ['recon', 'enum', 'exploit'] },
      beeSessionId: { type: 'string', required: true, description: 'Durable session id of the dispatched bee (from the subagent_* result)' },
      brief: { type: 'string', required: true, description: 'Task brief as dispatched' },
      force: { type: 'string', description: 'Set "adversarial-double-check" to allow a second bee on a verifying idea' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const card = writer.board()?.cards[args.cardId]
        if (card === undefined) return Promise.resolve({ ok: false, error: `unknown card "${args.cardId}"` })
        if (card.kind === 'idea' && card.status === 'verifying' && args.force === undefined) {
          return Promise.resolve({
            ok: false,
            error: `idea "${card.shortId}" is already verifying; one bee per card. Pass force:"adversarial-double-check" only for a deliberate second opinion.`,
            card: cardSummary(card),
          })
        }
        const result = writer.recordTask(args.cardId, {
          beeKind: args.beeKind as BoardBeeKind,
          beeSessionId: args.beeSessionId,
          brief: args.brief,
        })
        return Promise.resolve(ok({ task: { id: result.taskId }, card: cardSummary(result.card) }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_derive_vuln',
    description:
      'Promote a verified idea (gray) into a vuln card (green) with a derive edge. Requires evidence '
      + 'on the SOURCE idea card (attach with board_evidence first if missing) and the new vuln carries '
      + 'its own evidence too. 复验后才晋升.',
    parameters: {
      ideaId: { type: 'string', required: true, description: 'Source idea card id' },
      title: { type: 'string', required: true, description: 'Vuln one-line title (≤80 chars)' },
      surface: surfaceSchema,
      severity: { type: 'string', required: true, enum: ['info', 'low', 'med', 'high', 'crit'] },
      affected: { type: 'string', required: true, description: 'Affected component/location, precise enough to re-hit' },
      poc: { type: 'string', description: 'Reproduction path' },
      evidence: { type: 'array', items: evidenceSchema, required: true, description: '≥1 evidence items for the vuln itself' },
      detail: { type: 'string', description: 'Optional markdown context' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const source = writer.board()?.cards[args.ideaId]
        if (source === undefined) return Promise.resolve({ ok: false, error: `unknown idea "${args.ideaId}"` })
        if (source.evidence.length === 0) {
          return Promise.resolve({
            ok: false,
            error: `idea "${source.shortId}" has no evidence yet — record the verification evidence on it (board_evidence) before promoting.`,
            card: cardSummary(source),
          })
        }
        const vuln = writer.putCard({
          kind: 'vuln',
          title: args.title,
          surface: args.surface as unknown as BoardSurface,
          ...(args.detail !== undefined ? { detail: args.detail } : {}),
          severity: args.severity,
          affected: args.affected,
          ...(args.poc !== undefined ? { poc: args.poc } : {}),
        }, 'commander', args.evidence.map(evidenceOf))
        const edge = writer.deriveEdge(args.ideaId, vuln.id, source.evidence.map(item => item.id))
        return Promise.resolve(ok({ vuln: cardSummary(vuln), edgeId: edge.id }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_derive_access',
    description:
      'Promote a vuln (green) into an access card (blue) once exploitation proves control. Evidence '
      + 'must include the control proof (whoami/id/file-drop). Stop-at-proof: access cards are living '
      + 'state — mark lost/regain when it changes.',
    parameters: {
      vulnId: { type: 'string', required: true, description: 'Source vuln card id' },
      title: { type: 'string', required: true, description: 'Access one-line title (≤80 chars, e.g. "webshell · www-data@web01")' },
      level: { type: 'string', required: true, enum: ['anon', 'app-low', 'webshell', 'service', 'local-admin', 'root', 'domain-user', 'domain-admin'] },
      accessHost: { type: 'string', required: true, description: 'Host the access lands on' },
      surface: surfaceSchema,
      credentialHint: { type: 'string', description: 'Credential FINGERPRINT only (never plaintext)' },
      evidence: { type: 'array', items: evidenceSchema, required: true, description: '≥1 control-proof evidence items' },
      detail: { type: 'string', description: 'Optional markdown context' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const source = writer.board()?.cards[args.vulnId]
        if (source === undefined) return Promise.resolve({ ok: false, error: `unknown vuln "${args.vulnId}"` })
        if (source.evidence.length === 0) {
          return Promise.resolve({ ok: false, error: `vuln "${source.shortId}" has no evidence recorded; attach proof first.`, card: cardSummary(source) })
        }
        const access = writer.putCard({
          kind: 'access',
          title: args.title,
          surface: args.surface as unknown as BoardSurface,
          ...(args.detail !== undefined ? { detail: args.detail } : {}),
          level: args.level,
          accessHost: args.accessHost,
          ...(args.credentialHint !== undefined ? { credentialHint: args.credentialHint } : {}),
        }, 'commander', args.evidence.map(evidenceOf))
        const edge = writer.deriveEdge(args.vulnId, access.id, source.evidence.map(item => item.id))
        return Promise.resolve(ok({ access: cardSummary(access), edgeId: edge.id }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_evidence',
    description: 'Append one evidence item to an existing card (command output, artifact path, or transcript pointer).',
    parameters: {
      cardId: { type: 'string', required: true },
      kind: { type: 'string', required: true, enum: ['command', 'output', 'artifact', 'transcript'] },
      path: { type: 'string', description: 'Workspace-relative artifact path' },
      excerpt: { type: 'string', description: 'One-line excerpt for the card face' },
      byBee: { type: 'string', description: 'Bee session id, when the bee produced it' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const card = writer.addEvidence(args.cardId, {
          kind: args.kind,
          ...(args.path !== undefined ? { path: args.path } : {}),
          ...(args.excerpt !== undefined ? { excerpt: args.excerpt } : {}),
          ...(args.byBee !== undefined ? { byBee: args.byBee } : {}),
        })
        return Promise.resolve(ok({ card: cardSummary(card) }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_transition',
    description:
      'Move a card along its lifecycle: idea → verifying/falsified/archived; vuln → revoked; '
      + 'access → lost/disproved. Falsified ideas keep their record (report needs them) — not deleted.',
    parameters: {
      cardId: { type: 'string', required: true },
      to: { type: 'string', required: true, enum: ['open', 'verifying', 'falsified', 'archived', 'revoked', 'lost', 'disproved'] },
      reason: { type: 'string', description: 'Why (required for falsified/revoked/lost/disproved)' },
      evidence: { type: 'array', items: evidenceSchema, description: 'Supporting evidence, appended before the transition' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const evidenceAppend = (args.evidence ?? []).map(evidenceOf)
        const card = writer.transition(args.cardId, args.to as BoardCard['status'], {
          ...(args.reason !== undefined ? { refutation: args.reason } : {}),
          ...(evidenceAppend.length > 0 ? { evidenceAppend } : {}),
        })
        return Promise.resolve(ok({ card: cardSummary(card) }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_pivot',
    description:
      'Record a lateral-move idea born from a vuln or access card (soft pivot edge, dashed slow flow '
      + 'on the board). Creates the new idea card and links it.',
    parameters: {
      srcId: { type: 'string', required: true, description: 'Vuln or access card the idea pivots from' },
      title: { type: 'string', required: true, description: 'New idea one-line title (≤80 chars)' },
      hypothesis: { type: 'string', required: true, description: 'Falsifiable validation probe' },
      surface: surfaceSchema,
      detail: { type: 'string', description: 'Optional markdown context' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        const idea = writer.putCard({
          kind: 'idea',
          title: args.title,
          hypothesis: args.hypothesis,
          ...(args.detail !== undefined ? { detail: args.detail } : {}),
          surface: args.surface as unknown as BoardSurface,
        }, 'commander')
        const edge = writer.pivotEdge(args.srcId, idea.id)
        return Promise.resolve(ok({ idea: cardSummary(idea), edgeId: edge.id }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_settle_task',
    description:
      'Settle a dispatch recorded on a card once its bee reports: done / stopped / aborted. A settled '
      + 'idea with no open dispatches returns to open for adjudication. The result reports how many '
      + 'board-wide dispatches are still outstanding and whether every dispatched bee has now settled: '
      + 'while outstandingDispatches > 0, record this result, tell the user the interim picture, and END '
      + 'YOUR TURN — the remaining bees\' settlement notices will wake you. Only allSettled=true authorizes '
      + 'the consolidated next-step planning.',
    parameters: {
      cardId: { type: 'string', required: true },
      taskId: { type: 'string', description: 'Task id from the board_dispatch result; omit to settle by bee' },
      beeSessionId: { type: 'string', description: 'Bee session id — settles that bee\'s open dispatch on the card (use this when you know the bee id from the subagent_* result)' },
      outcome: { type: 'string', required: true, enum: ['done', 'stopped', 'aborted'] },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      exec.signal.throwIfAborted()
      try {
        const writer = writerFor(exec)
        let taskId = args.taskId
        if (taskId === undefined && args.beeSessionId !== undefined) {
          const cardNow = writer.board()?.cards[args.cardId]
          const open = cardNow?.tasks.find(task => task.beeSessionId === args.beeSessionId && task.outcome === undefined)
          if (open === undefined) {
            const failRecord: JsonRecord = { ok: false, error: `no open dispatch for bee "${args.beeSessionId}" on this card` }
            if (cardNow !== undefined) failRecord.card = cardSummary(cardNow)
            return Promise.resolve(failRecord)
          }
          taskId = open.id
        }
        if (taskId === undefined) return Promise.resolve({ ok: false, error: 'provide taskId or beeSessionId' })
        const card = writer.settleTask(args.cardId, taskId, args.outcome)
        const board = writer.board()
        let outstanding = 0
        for (const other of Object.values(board?.cards ?? {})) {
          for (const task of other.tasks) {
            if (task.outcome === undefined) outstanding += 1
          }
        }
        return Promise.resolve(ok({
          card: cardSummary(card),
          outstandingDispatches: outstanding,
          allSettled: outstanding === 0,
        }))
      } catch (error) {
        return Promise.resolve(fail(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'board_view',
    description: 'Read the current engagement board: all cards (id, shortId, kind, status, title, surface) and edges.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(_args, exec) {
      exec.signal.throwIfAborted()
      const writer = writerFor(exec)
      const board = writer.board()
      if (board === null) return Promise.resolve(ok({ cards: [], edges: [] }))
      return Promise.resolve(ok({
        cards: Object.values(board.cards).map(cardSummary),
        edges: Object.values(board.edges).map(edge => ({ id: edge.id, type: edge.type, src: edge.src, dst: edge.dst })),
      }))
    },
  }))
}
