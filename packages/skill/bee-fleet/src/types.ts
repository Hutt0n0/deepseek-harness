/**
 * Bee-fleet wire shapes: one configurable bee (a `tool-subagent` instance
 * spec plus its fleet-management metadata) and the route payloads.
 *
 * @module @dsh-redteam/dsh-bee-fleet/types
 */

/** Tool allow-list of one bee: exact platform tool names. */
export type BeeToolFilter = readonly string[]

/** One configurable bee in the fleet. */
export interface BeeSpec {
  /** Delegation tool name, unique across the fleet (e.g. `subagent_recon`). */
  readonly toolName: string
  /** Fleet kind channel (skills, board, UI tone). Free-form slug, e.g. `recon`. */
  readonly kind: string
  /** Worker persona: the bee's operating doctrine (model-facing text). */
  readonly persona: string
  /** Worker toolbox: allow-listed tool names. Empty is rejected (fail-loud). */
  readonly toolFilter: BeeToolFilter
  /** Continuation mode; the fleet fixes `continuable` (persistent bee sessions). */
  readonly backgroundMode: 'continuable' | 'one-shot'
  /**
   * Sub-bee authorization: when present, the bee may dispatch up to
   * `maxSubbees` depth-2 workers from this spec (its own domain's tactical
   * divide-and-conquer). The subbee shares the bee's kind channel; its
   * toolbox must be a subset of the bee's own (enforced at mount).
   * Absent = the bee physically cannot dispatch (no delegation tool).
   */
  readonly maxSubbees?: number
  readonly subbee?: {
    readonly toolName: string
    readonly persona: string
    readonly toolFilter: BeeToolFilter
  }
}

/** Management-face view of one bee (persona included; routes serve it raw). */
export type BeeEntry = BeeSpec

/** Body of `POST /rt-fleet/set`: replace the whole fleet. */
export interface FleetSetBody {
  readonly bees: readonly BeeSpec[]
}

/** Fleet route error envelope. */
export interface FleetError {
  readonly ok: false
  readonly error: string
}
