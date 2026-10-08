/**
 * Replay-safe, model-free tool-result pruning service.
 *
 * @module @deepseek-ai/dsh-compaction-tool-result-pruner
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq, ToolResultMessage } from '@deepseek-ai/dsh-session'
import { SessionSeq as sessionSeqOf } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'
import { canonicalCommand, codePointLength, COLLAPSE_MARKER, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
import type {
  PrunedEntry,
  PruneResult,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

export { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
export type {
  PrunedEntry,
  PruneResult,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolResultPruner: ToolResultPruner
  }
}

interface SnapshotCandidate {
  readonly seq: SessionSeq
  readonly event: SessionEvent<'tool/result'>
}

/** Deterministic head/middle/tail pruning for current tool-result surface nodes. */
export class ToolResultPruner extends Service {
  // The token meter prices each shadowed node for its logged shadow-price
  // event, so pruning genuinely requires the pricing capability.
  static inject = ['tokenMeter']

  static Config: z<ToolResultPruneConfig> = z.object({
    thresholdChars: z.number().step(1).min(1).default(DEFAULTS.thresholdChars),
    headChars: z.number().step(1).min(0).default(DEFAULTS.headChars),
    tailChars: z.number().step(1).min(0).default(DEFAULTS.tailChars),
    collapseRepeats: z.number().step(1).min(0).default(DEFAULTS.collapseRepeats),
  })

  /** Resolved and immutable character budgets. */
  readonly config: ResolvedConfig

  constructor(ctx: Context, config: ToolResultPruneConfig = {}) {
    super(ctx, 'toolResultPruner')
    this.config = resolveConfig(config)
  }

  /**
   * Measure text content in Unicode code points; non-text blocks cost zero.
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number {
    let chars = 0
    for (const block of blocks) {
      if (block.type === 'text') chars += codePointLength(block.text)
    }
    return chars
  }

  /**
   * Replace an over-budget text middle while retaining rich-block order.
   * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
   * boundary cannot split a surrogate pair. Grapheme clusters may still split.
   * @param blocks - original tool-result content.
   * @returns pruned content, or `null` when the text is within budget.
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null {
    const totalChars = this.measureContent(blocks)
    if (totalChars <= this.config.thresholdChars) return null

    const removedStart = this.config.headChars
    const removedEnd = totalChars - this.config.tailChars
    const pruned: ContentBlock[] = []
    let consumed = 0
    let markerInserted = false

    for (const block of blocks) {
      if (block.type !== 'text') {
        pruned.push(block)
        continue
      }

      const points = Array.from(block.text)
      const blockStart = consumed
      const blockEnd = blockStart + points.length
      const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
      const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
      const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
      const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : ''
      if (marker.length > 0) markerInserted = true
      const text = points.slice(0, headEnd).join('')
        + marker
        + points.slice(tailStart).join('')
      if (text.length > 0) pruned.push({ ...block, text })
      consumed = blockEnd
    }

    /* v8 ignore next -- totalChars > threshold and valid budgets guarantee a removed text span. */
    if (!markerInserted) throw new Error('tool-result prune: failed to locate the removed text span')
    const charsAfter = this.measureContent(pruned)
    /* v8 ignore next -- config validation fixes the emitted head + marker + tail budget. */
    if (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) {
      throw new Error('tool-result prune: replacement must be smaller and within threshold')
    }
    return pruned
  }

  /**
   * Collapse repeated-poll results: when one tool command runs ≥
   * `collapseRepeats` consecutive times (same canonical command), every
   * result but the newest is replaced with a one-line placeholder. The
   * command normalizes away digits (sleep durations, PIDs, counters) so
   * `sleep 115; cat nmap.gnmap` rounds collapse as one polling family, and
   * the caller may pass the current turn boundary to avoid collapsing
   * results that predate it.
   * @param session - session whose current surface is rewritten.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   */
  collapseRepeatedResults(session: Session): PruneResult {
    if (this.config.collapseRepeats === 0) return { pruned: [], charsRemoved: 0 }
    // Build the callId → canonical-command map from the full log: tool/call
    // events are NOT surface nodes (only message-producing types surface), so
    // the surface walk alone cannot see commands. session.seq is one past the
    // last committed log index; tool/call events live below it.
    const commandByCallId = new Map<ToolCallId, string>()
    for (let seq = 0; seq < session.seq; seq++) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(sessionSeqOf(seq))
      if (event?.type === 'tool/call') {
        commandByCallId.set(event.data.callId, event.data.name + ' ' + canonicalCommand(event.data.name, event.data.arguments))
      }
    }
    // Walk the surface grouping consecutive results by their call's command.
    interface Run {
      resultSeqs: SessionSeq[]
      callIds: ToolCallId[]
      readonly command: string
    }
    let prevCommand: string | undefined
    let run: Run | undefined
    const runs: Run[] = []
    for (const seq of [...session.surface.nodes]) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(seq)
      if (event?.type !== 'tool/result') continue
      const callId = event.data.message.source.callId
      const command = commandByCallId.get(callId)
      if (command === undefined) continue
      if (command !== prevCommand) {
        prevCommand = command
        run = { resultSeqs: [], callIds: [], command }
        runs.push(run)
      }
      run?.resultSeqs.push(seq)
      run?.callIds.push(callId)
    }
    const pruned: PrunedEntry[] = []
    let charsRemoved = 0
    for (const candidate of runs) {
      if (candidate.resultSeqs.length < this.config.collapseRepeats) continue
      // Keep the newest result; collapse every earlier one in the run.
      const keepSeq = candidate.resultSeqs.at(-1)
      for (const seq of candidate.resultSeqs) {
        if (seq === keepSeq) continue
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        const event = session.eventAt(seq)
        if (event?.type !== 'tool/result') continue
        const original = session.deriveEventMessage(event) as ToolResultMessage
        const result = original.content[0]
        const charsBefore = this.measureContent(result.content)
        const message = freezeMessage<ToolResultMessage>({
          ...original,
          content: [{
            ...result,
            content: [{ type: 'text', text: COLLAPSE_MARKER + `command: ${candidate.command.slice(0, 120)}` }] as typeof result.content,
          }] as [typeof result],
        })
        // Shadow-price protocol, identical to the size-budget pass.
        session.append('compaction/prune', {
          shadowedRange: { start: seq, end: seq },
          shadowedSeqs: [seq],
          shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
        })
        session.append('tool/result', {
          ...event.data,
          message,
        }, {
          surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
          sourceEventSeqs: [seq],
        })
        pruned.push({
          originalSeq: seq,
          replacementSeq: seq,
          callId: event.data.message.source.callId,
          charsBefore,
          charsAfter: this.measureContent([{ type: 'text', text: COLLAPSE_MARKER }]),
        })
        charsRemoved += charsBefore - codePointLength(COLLAPSE_MARKER)
      }
    }
    return { pruned, charsRemoved }
  }

  /**
   * Prune every over-budget tool result from one stable current-surface snapshot.
   * Each replacement preserves the complete event data except for `content`,
   * cites the shadowed node so replay can recover the replacement input, and is
   * immediately preceded by a `compaction/prune` shadow-price event pricing the
   * shadowed node through the injected token meter, so pure consumers can
   * subtract it without per-node state.
   * @param session - session whose current surface is rewritten.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   * @throws when the session rejects a replacement; replacements committed
   * earlier in the pass remain durable.
   */
  pruneSession(session: Session): PruneResult {
    const candidates: SnapshotCandidate[] = []
    for (const seq of [...session.surface.nodes]) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(seq)
      /* v8 ignore next -- surface seqs are validated contiguous log references. */
      if (event?.type === 'tool/result') candidates.push({ seq, event })
    }

    const pruned: PrunedEntry[] = []
    let charsRemoved = 0
    for (const { seq, event } of candidates) {
      const original = session.deriveEventMessage(event) as ToolResultMessage
      const result = original.content[0]
      const content = this.pruneContent(result.content)
      if (content === null) continue
      const charsBefore = this.measureContent(result.content)
      const charsAfter = this.measureContent(content)
      const message = freezeMessage<ToolResultMessage>({
        ...original,
        content: [{
          ...result,
          content,
        }] as [typeof result],
      })
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so pure consumers subtract the
      // shadowed node's heuristic price without retaining per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        callId: event.data.message.source.callId,
        charsBefore,
        charsAfter,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { pruned, charsRemoved }
  }
}

export default ToolResultPruner
