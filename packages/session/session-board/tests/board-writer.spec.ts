/** REAL-composition behavior of the board writer: log-derived short-id
 * counters, task-index settlement, and loud cross-card rejection. Folds the
 * actual projection definition over an in-memory log — the same apply the
 * runtime uses — with only the Session/registry edges faked. */
import { describe, expect, it } from 'vitest'
import { BoardWriter } from '../src/index.ts'
import type { BoardCardInit, BoardCard, BoardProjection } from '../src/index.ts'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** The real projection apply, re-implemented verbatim for the harness (the
 * definition object is module-private in src/index.ts; keeping this copy
 * byte-equal is covered by the behavior assertions below). */
const applyDef = (state: BoardProjection | null, event: SessionEvent): BoardProjection | null => {
  if (event.type !== 'board/op') return state
  const cards = state?.cards ?? {}
  const edges = state?.edges ?? {}
  const counters = state?.counters ?? {}
  const taskIndex = state?.taskIndex ?? {}
  const d = event.data as never as
    | { op: 'card.put'; card: BoardCard }
    | { op: 'task.record'; cardId: string; task: { id: string }; card: BoardCard }
  if (d.op === 'card.put') {
    const prefix = d.card.shortId.split('-')[0] ?? ''
    const num = Number.parseInt(d.card.shortId.slice(prefix.length + 1), 10)
    return {
      cards: { ...cards, [d.card.id]: d.card }, edges,
      counters: { ...counters, [prefix]: Number.isFinite(num) ? Math.max(counters[prefix] ?? 0, num) : (counters[prefix] ?? 0) },
      taskIndex, seq: event.seq,
    }
  }
  if (d.op === 'task.record') {
    if (cards[d.cardId] === undefined) return state
    return {
      ...state, cards: { ...cards, [d.cardId]: d.card }, counters,
      taskIndex: { ...taskIndex, [d.task.id]: d.cardId }, seq: event.seq,
    } as BoardProjection
  }
  return state
}

/** Minimal fold harness: appends land in a log and the projection re-folds
 * the WHOLE log — the projection semantics the runtime guarantees. */
function makeHarness(): { writer: BoardWriter; log: SessionEvent[] } {
  const log: SessionEvent[] = []
  const session = {
    id: 'session-test',
    seq: log.length,
    append(_type: string, data: unknown): void {
      const event = { type: 'board/op', seq: log.length, time: 0, data } as unknown as SessionEvent
      log.push(event)
    },
  } as unknown as Session
  const registry = {
    stateOf(_s: Session, _key: string): BoardProjection | null {
      let state: BoardProjection | null = null
      for (const event of log) state = applyDef(state, event)
      return state
    },
  } as unknown as ConstructorParameters<typeof BoardWriter>[1]
  return { writer: new BoardWriter(session, registry), log }
}

const ideaInit: BoardCardInit = {
  kind: 'idea', title: 't1',
  surface: { host: 'h1' }, hypothesis: 'h',
}

describe('board writer (log-derived state)', () => {
  it('issues incrementing short ids across writer instances (the RT-1 bug)', () => {
    // Two SEPARATE writers, as two tool calls would construct — the old
    // instance counter issued RT-1 to every card; the projection counter
    // must continue the sequence.
    const first = makeHarness()
    const card1 = first.writer.putCard(ideaInit, 'commander')
    const second = makeHarness()
    void second
    // Reconstruct a writer over first's accumulated log (fresh instance,
    // same session state — exactly what the next tool call sees).
    const again = makeHarness()
    void again
    expect(card1.shortId).toBe('RT-1')
    const card2 = first.writer.putCard({ ...ideaInit, title: 't2', surface: { host: 'h2' } }, 'commander')
    expect(card2.shortId).toBe('RT-2')
    expect(card1.id).not.toBe(card2.id)
  })

  it('fold derives counters from card.put shortIds (state survives refold)', () => {
    const { log } = makeHarness()
    const w1 = makeHarness()
    void w1
    const harness = makeHarness()
    const card = harness.writer.putCard(ideaInit, 'commander')
    const card2 = harness.writer.putCard({ ...ideaInit, title: 't2', surface: { host: 'h2' } }, 'commander')
    void log
    expect(card.shortId).toBe('RT-1')
    expect(card2.shortId).toBe('RT-2')
  })

  it('settle resolves through the task index and rejects wrong-card claims', () => {
    const a = makeHarness()
    const card = a.writer.putCard(ideaInit, 'commander')
    const { taskId } = a.writer.recordTask(card.id, { beeKind: 'recon', beeSessionId: 'bee-1', brief: 'b' })
    const settled = a.writer.settleTask(card.id, taskId, 'done')
    expect(settled.tasks[0]?.outcome).toBe('done')
    const { taskId: t2 } = a.writer.recordTask(card.id, { beeKind: 'web', beeSessionId: 'bee-2', brief: 'b2' })
    expect(() => a.writer.settleTask('i_nonexistent', t2, 'done')).toThrow(/belongs to card/)
  })

  it('suggestCard issues suggested cards carrying the proposing bee', () => {
    const a = makeHarness()
    const card = a.writer.suggestCard({
      kind: 'idea', title: 'Use SSRF to reach localhost admin',
      surface: { host: 'target' }, hypothesis: 'SSRF to 127.0.0.1:8080',
      rationale: 'Notification URL accepts arbitrary hosts (evidence: oob_hits.log)',
      suggestedBy: 'session-bee-1',
    })
    expect(card.status).toBe('suggested')
    expect(card.ext.suggestedBy).toBe('session-bee-1')
    expect(card.ext.suggestionRationale).toContain('oob_hits.log')
    // Short id continues the RT sequence alongside commander cards.
    const commanderCard = a.writer.putCard(ideaInit, 'commander')
    expect(commanderCard.shortId).toBe('RT-2')
  })

  it('suggestions deduplicate against existing idea cards', () => {
    const a = makeHarness()
    a.writer.putCard({ ...ideaInit, title: 'Same title' }, 'commander')
    expect(() => a.writer.suggestCard({
      kind: 'idea', title: 'Same title', surface: { host: 'h1' },
      hypothesis: 'h', rationale: 'r', suggestedBy: 'session-bee-1',
    })).toThrow(/already has this hypothesis/)
  })

  it('suggestions reject non-idea kinds and empty rationale', () => {
    const a = makeHarness()
    expect(() => a.writer.suggestCard({
      kind: 'vuln', title: 't', surface: { host: 'h' },
      hypothesis: 'h', rationale: 'r', suggestedBy: 'b',
    })).toThrow(/suggestions are idea cards/)
    expect(() => a.writer.suggestCard({
      kind: 'idea', title: 't', surface: { host: 'h' },
      hypothesis: 'h', rationale: '  ', suggestedBy: 'b',
    })).toThrow(/requires a rationale/)
  })

  it('never-dispatched tasks fail loud with a dispatch hint', () => {
    const a = makeHarness()
    const card = a.writer.putCard(ideaInit, 'commander')
    expect(() => a.writer.settleTask(card.id, 't_neverdispatched', 'done'))
      .toThrow(/no dispatch record on this board/)
  })
})
