/** Board canvas layout: layered positions for cards and edge geometry. */
import type { BoardCard, BoardEdge, BoardProjection } from '@dsh-redteam/dsh-session-board/client'

/** Layout spacing: column pitch and row pitch. Card boxes size to content. */
export const COLUMN_PITCH_X = 300
export const ROW_PITCH_Y = 64
export const CARD_MAX_WIDTH = 260

/** One laid-out card with computed position. */
export interface PlacedCard {
  readonly card: BoardCard
  readonly x: number
  readonly y: number
}

/** Whether a card belongs in the archive band (terminal negative states). */
export function isArchived(card: BoardCard): boolean {
  return card.status === 'falsified' || card.status === 'archived'
    || card.status === 'superseded' || card.status === 'disproved'
}

/**
 * Depth of one card along derive edges: ideas at 0, vulns at 1, accesses at
 * 2 (reducer invariants pin derive kinds, so depth == kind). Columns group
 * by depth; rows stack siblings in short-id order.
 */
export function layoutBoard(board: BoardProjection): {
  readonly main: readonly PlacedCard[]
  readonly archived: readonly BoardCard[]
} {
  const cards = Object.values(board.cards)
  const active = cards.filter(card => !isArchived(card))
  const tombstones = cards.filter(isArchived)

  const byDepth: [BoardCard[], BoardCard[], BoardCard[]] = [[], [], []]
  for (const card of active) {
    const depth = card.kind === 'idea' ? 0 : card.kind === 'vuln' ? 1 : 2
    byDepth[depth].push(card)
  }
  const shortOrder = (a: BoardCard, b: BoardCard): number => a.shortId.localeCompare(b.shortId, 'en', { numeric: true })

  const main: PlacedCard[] = []
  byDepth.forEach((column, depth) => {
    const sorted = [...column].sort(shortOrder)
    sorted.forEach((card, row) => {
      main.push({ card, x: depth * COLUMN_PITCH_X + 40, y: row * ROW_PITCH_Y + 40 })
    })
  })
  return { main, archived: tombstones.sort(shortOrder) }
}

/** Measured DOM box of one card node (canvas-relative). */
export interface CardBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Edge anchor points: right-center of source, left-center of destination. */
export function edgeAnchors(src: CardBox, dst: CardBox): { from: { x: number; y: number }; to: { x: number; y: number } } {
  return {
    from: { x: src.x + src.width, y: src.y + src.height / 2 },
    to: { x: dst.x, y: dst.y + dst.height / 2 },
  }
}

/** Edge path from source anchor to destination anchor with a horizontal bow. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2
  const bow = Math.min(30, Math.abs(to.y - from.y) / 2)
  return `M ${from.x} ${from.y} C ${midX} ${from.y + (to.y > from.y ? bow : -bow)}, ${midX} ${to.y - (to.y > from.y ? bow : -bow)}, ${to.x} ${to.y}`
}

/** Flow class for one edge given its type and endpoint liveness. */
export function edgeFlowClass(edge: BoardEdge, board: BoardProjection): string {
  const src = board.cards[edge.src]
  const dst = board.cards[edge.dst]
  if (src === undefined || dst === undefined) return ''
  const dimmed = isArchived(src) || isArchived(dst)
    || (src.kind === 'vuln' && src.status === 'revoked')
    || (dst.kind === 'access' && dst.status === 'lost')
  if (dimmed) return 'edgeDim'
  return edge.type === 'derive' ? 'edgeFlow' : 'edgeFlowSlow'
}

/** The bee currently working a card, when one is running. */
export function runningBeeId(
  card: BoardCard,
  beeRunning: Readonly<Record<string, boolean>>,
): string | undefined {
  for (const task of card.tasks) {
    if (task.outcome === undefined && beeRunning[task.beeSessionId] === true) return task.beeSessionId
  }
  return undefined
}
