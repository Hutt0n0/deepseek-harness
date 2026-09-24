import { Service } from '@deepseek-ai/cordis'
import { apply as registerBoardTools } from './tools.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ZodType } from 'zod'
import type { Session, SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry, ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  BoardCard, BoardEdge, BoardEvidence, BoardOpData, BoardProjection, BoardSurface, BoardTaskRef,
} from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Engagement board operation. Log-only: whole-value post-op record folded
     * last-wins into the `board` projection unit; never enters the model
     * surface. Each record is one of card.put / edge.put / task.record.
     */
    'board/op': BoardOpData
  }
}

export type {
  AccessLevel, AccessStatus, BoardBeeKind, BoardCard, BoardCardKind, BoardCardStatus, BoardEdge,
  BoardEdgeType, BoardEvidence, BoardOpData, BoardProjection, BoardSurface, BoardTaskOutcome,
  BoardTaskRef, IdeaStatus, VulnSeverity, VulnStatus,
} from './types.ts'

/**
* Red-team engagement board: the `board/op` log-only session event, the
* `board` projection unit, and the append face the commander's `board_*`
* tools drive. Every operation is a whole-value record folded last-wins;
* cards are never deleted, only tombstoned (falsified / archived /
* superseded / disproved).
*
* @module @dsh-redteam/dsh-session-board
*/
const boardProjectionSchema = { parse: (value: unknown) => value } as unknown as ZodType<BoardProjection | null>
/**
* The `board` projection unit: fold `board/op` events last-wins into the
* whole board. Uninterested events return the same state reference.
*/
const boardProjectionDefinition = {
  key: 'board',
  stateVersion: 1,
  stateSchema: boardProjectionSchema,
  init: (_header: SessionHeader, _inherited: SessionLogOffset): BoardProjection | null => null,
  apply: (state: BoardProjection | null, event: SessionEvent): BoardProjection | null => {
    if (event.type !== 'board/op') return state
    const cards = state?.cards ?? {}
    const edges = state?.edges ?? {}
    const data = event.data
    let next
    switch (data.op) {
      case 'card.put':
        next = {
          cards: { ...cards, [data.card.id]: data.card },
          edges,
          seq: event.seq,
        } as BoardProjection
        break
      case 'edge.put':
        next = {
          cards,
          edges: { ...edges, [data.edge.id]: data.edge },
          seq: event.seq,
        } as BoardProjection
        break
      case 'task.record':
        if (cards[data.cardId] === undefined) return state
        next = {
          ...state,
          cards: { ...cards, [data.cardId]: data.card },
          seq: event.seq,
        } as BoardProjection
        break
      default: return state
    }
    return next
  },
  wire: {
    viewSchema: boardProjectionSchema,
    view: (state: BoardProjection | null) => state,
  },
} satisfies ProjectionDefinition<'board', BoardProjection | null>
/** Validation failures thrown by the append face; tools surface them verbatim. */

/**
* Append face over one session's board. Tools construct mutations here; the
* class owns validation, id minting, and the whole-value event envelope.
*/
/** Validation failures thrown by the append face; tools surface them verbatim. */
export class BoardOpInvalidError extends Error {
  override readonly name = 'BoardOpInvalidError'
}

/** Input for one new card (tool-validated before reaching here). */
export interface BoardCardInit {
  readonly kind: BoardCard['kind']
  readonly title: string
  readonly detail?: string
  readonly surface: BoardSurface
  readonly hypothesis?: string
  readonly severity?: BoardCard['ext']['severity']
  readonly affected?: string
  readonly poc?: string
  readonly level?: BoardCard['ext']['level']
  readonly accessHost?: string
  readonly credentialHint?: string
}

/** Optional patch for a status transition. */
export interface TransitionPatch {
  readonly detail?: string
  readonly refutation?: string
  readonly evidenceAppend?: readonly BoardEvidence[]
}

export class BoardWriter {
  private readonly session: Session
  private readonly registry: SessionProjectionRegistry
  private counters = new Map<string, number>()
  constructor(session: Session, registry: SessionProjectionRegistry) {
    this.session = session
    this.registry = registry
  }
  /** Current folded board, or null. */
  board(): BoardProjection | null {
    return this.registry.stateOf(this.session, 'board') ?? null
  }
  /** Next short id for a card kind (RT-1, VL-2, AX-3 — per-kind counter). */
  private nextShortId(kind: BoardCard['kind']): string {
    const prefix = kind === 'idea' ? 'RT' : kind === 'vuln' ? 'VL' : 'AX'
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    return `${prefix}-${next}`
  }
  /** Mint a fresh unique id with the given prefix (time-ordered via timestamp+counter). */
  mint(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  }
  private requireCard(cardId: string): BoardCard {
    const card = this.board()?.cards[cardId]
    if (card === void 0) throw new BoardOpInvalidError(`board: unknown card "${cardId}"`)
    return card
  }
  private append(data: BoardOpData): void {
    this.session.append('board/op', data)
  }
  /**
	* Create one card. Ideas require a falsifiable hypothesis; vuln/access
	* cards require at least one evidence item.
	*/
  putCard(init: BoardCardInit, actor: 'commander' | 'user', evidence: readonly BoardEvidence[] = []): BoardCard {
    if (init.kind === 'idea' && (init.hypothesis === void 0 || init.hypothesis.trim() === '')) throw new BoardOpInvalidError('board: an idea card requires a falsifiable hypothesis (预期验证手段)')
    if (init.kind !== 'idea' && evidence.length === 0) throw new BoardOpInvalidError(`board: a ${init.kind} card requires at least one evidence item`)
    const board = this.board()
    const sameSurface = (card: BoardCard): boolean =>
      card.surface.host === init.surface.host
      && (card.surface.port ?? undefined) === (init.surface.port ?? undefined)
      && (card.surface.path ?? undefined) === (init.surface.path ?? undefined)
    const dup = (Object.values(board?.cards ?? {})).find(card =>
      card.kind === init.kind && card.title === init.title && sameSurface(card))
    if (dup !== void 0) throw new BoardOpInvalidError(`board: duplicate ${init.kind} card "${dup.shortId}" already covers this surface+title; merge or reuse it`)
    const status = init.kind === 'idea' ? 'open' : init.kind === 'vuln' ? 'verified' : 'held'
    const card: BoardCard = {
      id: this.mint(init.kind === 'idea' ? 'i' : init.kind === 'vuln' ? 'v' : 'a'),
      kind: init.kind,
      title: init.title.slice(0, 80),
      shortId: this.nextShortId(init.kind),
      detail: (init.detail ?? '').slice(0, 2e3),
      surface: init.surface,
      status,
      origin: {
        actor,
        sessionId: this.session.id,
        ts: Date.now(),
      },
      evidence,
      tasks: [],
      ext: {
        ...init.hypothesis !== void 0 ? { hypothesis: init.hypothesis } : {},
        ...init.severity !== void 0 ? { severity: init.severity } : {},
        ...init.affected !== void 0 ? { affected: init.affected } : {},
        ...init.poc !== void 0 ? { poc: init.poc } : {},
        ...init.level !== void 0 ? { level: init.level } : {},
        ...init.accessHost !== void 0 ? { accessHost: init.accessHost } : {},
        ...init.credentialHint !== void 0 ? { credentialHint: init.credentialHint } : {},
      },
    }
    this.append({
      op: 'card.put',
      card,
    })
    return card
  }
  /** Create a derive edge (idea→vuln / vuln→access), tombstoning the source as materialized. */
  deriveEdge(srcId: string, dstId: string, evidenceIds: readonly string[]): BoardEdge {
    const src = this.requireCard(srcId)
    const dst = this.requireCard(dstId)
    if (!(src.kind === 'idea' && dst.kind === 'vuln' || src.kind === 'vuln' && dst.kind === 'access')) throw new BoardOpInvalidError(`board: derive edge requires idea→vuln or vuln→access, got ${src.kind}→${dst.kind}`)
    if (evidenceIds.length === 0) throw new BoardOpInvalidError('board: a derive edge requires evidence ids')
    const known = new Set(src.evidence.map(item => item.id))
    const unknown = evidenceIds.filter(id => !known.has(id))
    if (unknown.length > 0) throw new BoardOpInvalidError(`board: evidence ids not on the source card: ${unknown.join(', ')}`)
    const edge: BoardEdge = {
      id: this.mint('e'),
      type: 'derive',
      src: srcId,
      dst: dstId,
      evidenceIds,
      createdAt: Date.now(),
    }
    if (src.kind === 'idea' && src.status !== 'validated') this.append({
      op: 'card.put',
      card: {
        ...src,
        status: 'validated',
      },
    })
    this.append({
      op: 'edge.put',
      edge,
    })
    return edge
  }
  /** Create a pivot edge (vuln/access → new idea). The idea card must already exist. */
  pivotEdge(srcId: string, ideaId: string): BoardEdge {
    const src = this.requireCard(srcId)
    if (this.requireCard(ideaId).kind !== 'idea' || src.kind === 'idea') throw new BoardOpInvalidError('board: pivot edge requires a vuln/access source and an idea destination')
    const edge: BoardEdge = {
      id: this.mint('e'),
      type: 'pivot',
      src: srcId,
      dst: ideaId,
      createdAt: Date.now(),
    }
    this.append({
      op: 'edge.put',
      edge,
    })
    return edge
  }
  /** Transition one card's status with validation of the legal transitions. */
  transition(cardId: string, to: BoardCard['status'], patch?: TransitionPatch): BoardCard {
    const card = this.requireCard(cardId)
    const legalStatuses: Record<BoardCard['kind'], readonly string[]> = {
      idea: ['verifying', 'open', 'validated', 'falsified', 'archived'],
      vuln: ['verified', 'revoked', 'superseded'],
      access: ['held', 'lost', 'disproved'],
    }
    if (!legalStatuses[card.kind].includes(to)) throw new BoardOpInvalidError(`board: illegal status "${to}" for a ${card.kind} card`)
    if (card.status === 'validated' || card.status === 'superseded' || card.status === 'disproved') throw new BoardOpInvalidError(`board: card "${card.shortId}" is sealed at "${card.status}"`)
    const evidenceAppend = patch?.evidenceAppend ?? []
    const updated = {
      ...card,
      status: to,
      ...patch?.detail !== void 0 ? { detail: patch.detail.slice(0, 2e3) } : {},
      evidence: evidenceAppend.length > 0 ? [...card.evidence, ...evidenceAppend] : card.evidence,
      ext: to === 'falsified' && patch?.refutation !== void 0 ? {
        ...card.ext,
        refutation: patch.refutation,
      } : card.ext,
    }
    this.append({
      op: 'card.put',
      card: updated,
    })
    return updated
  }
  /** Record a dispatch from a card (and flip an idea to `verifying`). */
  recordTask(cardId: string, task: Omit<BoardTaskRef, 'id' | 'dispatchedAt'>): { card: BoardCard; taskId: string } {
    const card = this.requireCard(cardId)
    const taskId = this.mint('t')
    const record = {
      ...task,
      id: taskId,
      dispatchedAt: Date.now(),
    }
    const status = card.kind === 'idea' && card.status === 'open' ? 'verifying' : card.status
    const updated = {
      ...card,
      status,
      tasks: [...card.tasks, record],
    }
    this.append({
      op: 'task.record',
      cardId,
      task: record,
      card: updated,
    })
    return {
      card: updated,
      taskId,
    }
  }
  /** Settle a dispatched task (outcome recorded on its TaskRef). */
  settleTask(cardId: string, taskId: string, outcome: BoardTaskRef['outcome']): BoardCard {
    const card = this.requireCard(cardId)
    const tasks = card.tasks.map(task => task.id === taskId ? {
      ...task,
      ...outcome === void 0 ? {} : { outcome },
      settledAt: Date.now(),
    } : task)
    if (tasks.length === card.tasks.length) throw new BoardOpInvalidError(`board: unknown task "${taskId}" on card "${card.shortId}"`)
    const allSettled = tasks.every(task => task.outcome !== void 0)
    const status = card.kind === 'idea' && card.status === 'verifying' && allSettled ? 'open' : card.status
    const updated = {
      ...card,
      tasks,
      status,
    }
    this.append({
      op: 'card.put',
      card: updated,
    })
    return updated
  }
  /** Append evidence to a card. */
  addEvidence(cardId: string, evidence: Omit<BoardEvidence, 'id' | 'ts'>): BoardCard {
    const card = this.requireCard(cardId)
    const record = {
      ...evidence,
      id: this.mint('ev'),
      ts: Date.now(),
    }
    const updated = {
      ...card,
      evidence: [...card.evidence, record],
    }
    this.append({
      op: 'card.put',
      card: updated,
    })
    return updated
  }
};
/**
* Host service: registers the `board` projection unit. The commander's tools
* construct a {@link BoardWriter} per session (they already hold the Session
* object through `exec.agent.session`).
*/

export class BoardService extends Service {
  static inject = ['sessionProjections', 'tools'] as const

  constructor(ctx: Context) {
    super(ctx, 'rtBoard')
    ctx.sessionProjections.register(boardProjectionDefinition)
    registerBoardTools(ctx)
  }
}

export default BoardService
