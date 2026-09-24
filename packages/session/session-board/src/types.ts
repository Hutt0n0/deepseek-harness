/**
 * Pure types of the red-team board domain: the ONE home of the `board`
 * projection-key declaration and the `board/op` session-event declaration.
 * No host-side value imports — this module is shared by host consumers and
 * the client aggregate verbatim.
 *
 * @module @dsh-redteam/dsh-session-board/types
 */
export {}
/** Node kinds on the engagement board. The kind never changes once created. */
export type BoardCardKind = 'idea' | 'vuln' | 'access'
/** Lifecycle of one idea (gray) card. */
export type IdeaStatus = 'open' | 'verifying' | 'validated' | 'falsified' | 'archived'
/** Lifecycle of one vuln (green) card. */
export type VulnStatus = 'verified' | 'revoked' | 'superseded'
/** Lifecycle of one access (blue) card. */
export type AccessStatus = 'held' | 'lost' | 'disproved'
export type BoardCardStatus = IdeaStatus | VulnStatus | AccessStatus
/** One attack surface reference — the dedup/clustering key of the board. */
export interface BoardSurface {
  readonly host: string
  readonly port?: number
  readonly service?: string
  readonly path?: string
}
/** Severity band of a verified vuln card. */
export type VulnSeverity = 'info' | 'low' | 'med' | 'high' | 'crit'
/** Privilege level of an access card. */
export type AccessLevel = 'anon' | 'app-low' | 'webshell' | 'service' | 'local-admin' | 'root' | 'domain-user' | 'domain-admin'
/** Bee kind that a dispatch assigns (mirrors the commander preset's bee line-up). */
export type BoardBeeKind = 'recon' | 'jsint' | 'web' | 'pivot'
/** Outcome of one dispatched task, settled by the commander. */
export type BoardTaskOutcome = 'done' | 'stopped' | 'aborted'
/** One dispatch from a card to a bee. */
export interface BoardTaskRef {
  /** Stable task id (`t_` prefix). */
  readonly id: string
  readonly beeKind: BoardBeeKind
  /** Durable session id of the dispatched bee. */
  readonly beeSessionId: string
  /** Task brief as dispatched. */
  readonly brief: string
  readonly dispatchedAt: number
  readonly settledAt?: number
  readonly outcome?: BoardTaskOutcome
}
/** One evidence item backing a card or a derive edge. */
export interface BoardEvidence {
  /** Stable evidence id (`ev_` prefix). */
  readonly id: string
  readonly kind: 'command' | 'output' | 'artifact' | 'transcript'
  /** Workspace-relative artifact path, when the evidence lives on disk. */
  readonly path?: string
  /** One-line excerpt carried on the card face. */
  readonly excerpt?: string
  /** Bee session id that produced the evidence, when applicable. */
  readonly byBee?: string
  readonly ts: number
}
/** Whole-value record of one board card (node). */
export interface BoardCard {
  /** Stable card id with kind prefix: `i_` / `v_` / `a_`. */
  readonly id: string
  readonly kind: BoardCardKind
  /** One-line conclusion-style title (≤80 chars). */
  readonly title: string
  /** Short display id shown on the card face (RT-n / VL-n / AX-n). */
  readonly shortId: string
  /** Markdown detail (≤2000 chars). */
  readonly detail: string
  readonly surface: BoardSurface
  readonly status: BoardCardStatus
  /** Who created this card and in which session. */
  readonly origin: {
    readonly actor: 'commander' | 'user'
    readonly sessionId: string
    readonly ts: number
  }
  /** Evidence list — append-only. */
  readonly evidence: readonly BoardEvidence[]
  /** Dispatches issued from this card — append-only, settled in place. */
  readonly tasks: readonly BoardTaskRef[]
  /** Kind-specific payload. */
  readonly ext: {
    /** idea: how validation success is judged (falsifiable probe). Required for ideas. */
    readonly hypothesis?: string
    /** idea: why the idea was falsified. */
    readonly refutation?: string
    /** vuln: severity band. */
    readonly severity?: VulnSeverity
    /** vuln: affected component/location, precise enough to re-hit. */
    readonly affected?: string
    /** vuln: reproduction path. */
    readonly poc?: string
    /** access: privilege level. */
    readonly level?: AccessLevel
    /** access: host the access lands on. */
    readonly accessHost?: string
    /** access: credential fingerprint ONLY (never plaintext). */
    readonly credentialHint?: string
  }
}
/** Edge types. `derive` is the hard materialization edge; `pivot` is a soft lateral idea. */
export type BoardEdgeType = 'derive' | 'pivot'
/** Whole-value record of one board edge. */
export interface BoardEdge {
  /** Stable edge id (`e_` prefix). */
  readonly id: string
  readonly type: BoardEdgeType
  /** Source card id. */
  readonly src: string
  /** Destination card id. */
  readonly dst: string
  /** Evidence ids backing a derive edge (required for derive). */
  readonly evidenceIds?: readonly string[]
  readonly createdAt: number
}
/** Client-visible board state for one session: cards + edges, folded last-wins. */
export interface BoardProjection {
  /** Cards by id; includes archived/falsified/superseded cards (tombstones, never deleted). */
  readonly cards: Readonly<Record<string, BoardCard>>
  /** Edges by id. */
  readonly edges: Readonly<Record<string, BoardEdge>>
  /** Seq of the last folded `board/op` event; 0 before any. */
  readonly seq: number
}
/** Payload of the log-only `board/op` event. Whole-value: carries the complete post-op record. */
export type BoardOpData = {
  readonly op: 'card.put'
  readonly card: BoardCard
} | {
  readonly op: 'edge.put'
  readonly edge: BoardEdge
} | {
  readonly op: 'task.record'
  readonly cardId: string
  readonly task: BoardTaskRef
  /** Complete post-op card state (whole-value). */
  readonly card: BoardCard
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
         * Folded engagement board for this session: cards and edges keyed by id.
         * Null before the first board operation.
         */
    board: BoardProjection | null
  }
  interface SessionProjectionStateMap {
    /**
         * Board fold state: the whole projection (cards + edges + watermark).
         * Null before the first board operation.
         */
    board: BoardProjection | null
  }
}
