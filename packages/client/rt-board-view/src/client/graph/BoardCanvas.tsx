/** Board canvas: auto-sized React card nodes, DOM-measured SVG edges, and the card detail modal. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardCard, BoardProjection } from '@dsh-redteam/dsh-session-board/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import {
  CARD_MAX_WIDTH, edgeFlowClass, edgePath, edgeAnchors, isArchived, layoutBoard,
  runningBeeId, type CardBox, type PlacedCard,
} from './layout.ts'
import css from '../board.module.css'

/** Actions injected by the entry registration. */
export interface BoardCanvasActions {
  /** Open one bee's transcript in the right Sidebar. */
  openBee: (childId: SessionId, mode: 'one-shot' | 'continuable') => void
  /** Send a queue message to one continuable bee. */
  sendToBee: (childId: SessionId, text: string) => Promise<void>
  /** Prefill the commander composer with a verification/task draft. */
  draftToCommander: (text: string) => void
  /** Bee liveness by session id. */
  beeRunning: Readonly<Record<string, boolean>>
}

export interface BoardCanvasProps {
  readonly board: BoardProjection
  readonly t: TranslateNS<typeof NS>
  readonly actions: BoardCanvasActions
}

interface DragState {
  readonly id: string
  readonly offsetX: number
  readonly offsetY: number
}

type BoardStatusKey = 'board.statusOpen' | 'board.statusVerifying' | 'board.statusValidated'
  | 'board.statusFalsified' | 'board.statusArchived' | 'board.statusVerified' | 'board.statusRevoked'
  | 'board.statusSuperseded' | 'board.statusHeld' | 'board.statusLost' | 'board.statusDisproved'

/** Locale key for one card's status. */
function statusKey(card: BoardCard): BoardStatusKey {
  const name = card.status.charAt(0).toUpperCase() + card.status.slice(1)
  return `board.status${name}` as BoardStatusKey
}

/** Locale label for one card's status. */
function statusLabel(card: BoardCard, t: TranslateNS<typeof NS>): string {
  return t(statusKey(card))
}

/** The most recent dispatch's bee session id, when the card has any. */
function lastBeeId(card: BoardCard): string | undefined {
  const task = card.tasks[card.tasks.length - 1]
  return task?.beeSessionId
}

/** Severity badge tone by band. */
function severityClass(severity: string): string {
  return (severity === 'crit' ? css.detailSeverityCrit
    : severity === 'high' ? css.detailSeverityHigh
      : '') ?? ''
}

/** The detail dialog: full card record as a bounded, scrollable document —
 * badges, title, markdown analysis, field grid, PoC/EXP, evidence list with
 * bee jumps, dispatch history, and upstream chain. The platform Modal owns
 * mask/escape/portal; this component owns the document structure. */
function CardDetail({
  card, board, t, actions, onClose,
}: {
  card: BoardCard
  board: BoardProjection
  t: TranslateNS<typeof NS>
  actions: BoardCanvasActions
  onClose: () => void
}) {
  const labels = useMemo(() => ({
    code: { copyLabel: t('detailCopy'), copiedLabel: t('detailCopied') },
    footnotes: '—',
  }), [t])
  const beeId = lastBeeId(card)
  const kindLabel = t(card.kind === 'idea' ? 'board.kindIdea' : card.kind === 'vuln' ? 'board.kindVuln' : 'board.kindAccess')
  const badgeClass = card.kind === 'idea' ? css.detailBadgeIdea : card.kind === 'vuln' ? css.detailBadgeVuln : css.detailBadgeAccess
  const surfaceText = [
    card.surface.host + (card.surface.port !== undefined ? `:${card.surface.port}` : ''),
    card.surface.path ?? '',
    card.surface.service !== undefined ? `(${card.surface.service})` : '',
  ].filter(part => part !== '').join(' ')
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('detailClose')}
      title={`${card.shortId} · ${kindLabel}`}
      {...(css.detailDialog !== undefined ? { className: css.detailDialog } : {})}
      {...(css.detailDialogContent !== undefined ? { contentClassName: css.detailDialogContent } : {})}
      footer={(
        <>
          {beeId !== undefined && (
            <button
              type="button"
              className={css.actionBtn}
              onClick={() => { actions.openBee(beeId as SessionId, 'continuable') }}
            >
              {t('board.openBee')}
            </button>
          )}
          <button type="button" className={css.actionBtn} onClick={onClose}>{t('detailClose')}</button>
        </>
      )}
    >
      <div className={css.detailBody} data-rt-board-detail="">
        <div className={css.detailHeaderMeta}>
          <span className={`${css.detailBadge} ${badgeClass}`}>{kindLabel}</span>
          <span className={css.detailBadge}>{statusLabel(card, t)}</span>
          {card.ext.severity !== undefined && (
            <span className={`${css.detailBadge} ${severityClass(card.ext.severity)}`}>
              {t('board.severity', { severity: card.ext.severity })}
            </span>
          )}
          <span>{surfaceText}</span>
        </div>
        <h3 className={css.detailTitle}>{card.title}</h3>
        {card.detail !== '' && <MarkdownText text={card.detail} labels={labels} variant="compact" />}
        <dl className={css.detailGrid}>
          {card.ext.hypothesis !== undefined && (<><dt>{t('detailHypothesis')}</dt><dd>{card.ext.hypothesis}</dd></>)}
          {card.ext.affected !== undefined && (<><dt>{t('detailAffected')}</dt><dd>{card.ext.affected}</dd></>)}
          {card.ext.level !== undefined && (<><dt>{t('detailLevel')}</dt><dd>{card.ext.level}</dd></>)}
          {card.ext.accessHost !== undefined && (<><dt>{t('detailHost')}</dt><dd>{card.ext.accessHost}</dd></>)}
          {card.ext.credentialHint !== undefined && (<><dt>{t('detailCredential')}</dt><dd>{card.ext.credentialHint}</dd></>)}
        </dl>
        {card.ext.poc !== undefined && card.ext.poc !== '' && (
          <section className={css.detailSection}>
            <h4 className={css.detailHeading}>{t('detailPoc')}</h4>
            <MarkdownText text={'```\n' + card.ext.poc + '\n```'} labels={labels} variant="compact" />
          </section>
        )}
        {card.evidence.length > 0 && (
          <section className={css.detailSection}>
            <h4 className={css.detailHeading}>{t('detailEvidence')} · {card.evidence.length}</h4>
            <ul className={css.detailList}>
              {card.evidence.map(item => (
                <li key={item.id}>
                  <span className={css.detailEvidenceKind}>{item.kind}</span>
                  {item.excerpt !== undefined && <span className={css.detailEvidenceText}>{item.excerpt}</span>}
                  {item.path !== undefined && <code className={css.detailPath}>{item.path}</code>}
                  {item.byBee !== undefined && (
                    <button type="button" className={css.actionBtn} onClick={() => { actions.openBee(item.byBee as SessionId, 'continuable') }}>
                      {t('board.openBee')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {card.tasks.length > 0 && (
          <section className={css.detailSection}>
            <h4 className={css.detailHeading}>{t('detailTasks')} · {card.tasks.length}</h4>
            <ul className={css.detailList}>
              {card.tasks.map(task => (
                <li key={task.id}>
                  <span className={css.detailEvidenceKind}>{task.beeKind}</span>
                  <span className={css.detailEvidenceText}>{task.brief.slice(0, 140)}{task.brief.length > 140 ? '…' : ''}</span>
                  <span className={task.outcome === undefined ? css.running : css.detailEvidenceText}>
                    {task.outcome === undefined ? t('board.statusVerifying') : task.outcome}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {Object.values(board.edges).filter(edge => edge.dst === card.id && edge.type === 'derive').map((edge) => {
          const parent = board.cards[edge.src]
          if (parent === undefined) return null
          return (
            <section key={edge.id} className={css.detailSection}>
              <h4 className={css.detailHeading}>{t('detailChain')}</h4>
              <p className={css.detailEvidenceText}>{parent.shortId} · {parent.title}</p>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}

/**
 * The interactive canvas. Positions live in component state (per mount,
 * session-local); the projection provides topology. Card boxes auto-size to
 * their content; edge anchors are measured from the rendered DOM.
 */
export function BoardCanvas({ board, t, actions }: BoardCanvasProps) {
  const { main, archived } = useMemo(() => layoutBoard(board), [board])
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [boxes, setBoxes] = useState<Record<string, CardBox>>({})
  const dragRef = useRef<DragState | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [dispatch, setDispatch] = useState<{ cardId: string; shortId: string; beeId?: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)

  const placed = useMemo(() => main.map(item => ({
    ...item,
    x: positions[item.card.id]?.x ?? item.x,
    y: positions[item.card.id]?.y ?? item.y,
  })), [main, positions])

  // Measure every card's rendered box; re-measure on content or position changes.
  useEffect(() => {
    const measure = (): void => {
      const next: Record<string, CardBox> = {}
      for (const [id, node] of cardRefs.current) {
        next[id] = { x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }
      }
      setBoxes((prev) => {
        const same = Object.keys(next).length === Object.keys(prev).length
          && Object.entries(next).every(([id, box]) => {
            const old = prev[id]
            return old !== undefined && old.x === box.x && old.y === box.y
              && old.width === box.width && old.height === box.height
          })
        return same ? prev : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const node of cardRefs.current.values()) observer.observe(node)
    return () => { observer.disconnect() }
  }, [placed])

  const onPointerDown = useCallback((item: PlacedCard) => (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, textarea') !== null) return
    dragRef.current = { id: item.card.id, offsetX: event.clientX - item.x, offsetY: event.clientY - item.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    setPositions(prev => ({ ...prev, [drag.id]: { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY } }))
  }, [])

  const onPointerUp = useCallback(() => { dragRef.current = null }, [])

  const kindClass = (card: BoardCard): string =>
    (card.kind === 'idea' ? css.cardGray : card.kind === 'vuln' ? css.cardGreen : css.cardBlue) ?? ''
  const statusLabel = (card: BoardCard): string => t(statusKey(card))

  const submitDispatch = useCallback(async () => {
    if (dispatch === null || draft.trim() === '') return
    if (dispatch.beeId !== undefined) {
      await actions.sendToBee(dispatch.beeId as SessionId, draft)
    } else {
      actions.draftToCommander(`[${dispatch.shortId}] ${draft}`)
    }
    setDispatch(null)
    setDraft('')
  }, [dispatch, draft, actions])

  const detailCard = detailId === null ? undefined : board.cards[detailId]

  return (
    <div className={css.canvasWrap}>
      <div className={css.canvas} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <svg className={css.edgeLayer}>
          {Object.values(board.edges).map((edge) => {
            const srcBox = boxes[edge.src]
            const dstBox = boxes[edge.dst]
            if (srcBox === undefined || dstBox === undefined) return null
            const anchors = edgeAnchors(srcBox, dstBox)
            const path = edgePath(anchors.from, anchors.to)
            const base = edge.type === 'derive' ? css.edgeDerive : css.edgeBase
            const flow = edgeFlowClass(edge, board)
            return (
              <g key={edge.id}>
                <path className={`${css.edgeBase} ${base}`} d={path} />
                {flow !== '' && <path className={`${css.edgeFlow} ${flow}`} d={path} />}
              </g>
            )
          })}
        </svg>
        {placed.map((item) => {
          const card = item.card
          const beeId = runningBeeId(card, actions.beeRunning)
          const hopBee = lastBeeId(card)
          const dim = isArchived(card) || card.status === 'revoked' || card.status === 'lost'
          return (
            <div
              key={card.id}
              ref={(node) => {
                if (node === null) cardRefs.current.delete(card.id)
                else cardRefs.current.set(card.id, node)
              }}
              className={`${css.card} ${kindClass(card)}${dim ? ` ${css.cardDim}` : ''}`}
              style={{ left: item.x, top: item.y, maxWidth: CARD_MAX_WIDTH }}
              onPointerDown={onPointerDown(item)}
            >
              <div className={css.cardHead}>
                <span className={css.shortId}>{card.shortId}</span>
                <span className={css.kindTag}>{t(card.kind === 'idea' ? 'board.kindIdea' : card.kind === 'vuln' ? 'board.kindVuln' : 'board.kindAccess')}</span>
                {beeId !== undefined && <span className={css.running}>{t('board.beeRunning')}</span>}
              </div>
              <div className={css.title} title={card.title}>{card.title}</div>
              <div className={css.meta}>
                <span>{statusLabel(card)}</span>
                {card.ext.severity !== undefined && <span>{t('board.severity', { severity: card.ext.severity })}</span>}
                {card.evidence.length > 0 && <span>{t('board.evidence', { count: card.evidence.length })}</span>}
                {card.tasks.length > 0 && <span>{t('board.tasks', { count: card.tasks.length })}</span>}
              </div>
              <div className={css.actions}>
                {hopBee !== undefined && (
                  <button
                    type="button"
                    className={css.actionBtn}
                    title={t('board.openBee')}
                    onClick={() => { actions.openBee(hopBee as SessionId, 'continuable') }}
                  >
                    {t('cardBtnSession')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.actionBtn}
                  title={t('cardBtnDetail')}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDetailId(card.id)
                  }}
                >
                  {t('cardBtnDetail')}
                </button>
                <button
                  type="button"
                  className={css.actionBtn}
                  title={t('board.dispatchTask')}
                  onClick={(event) => {
                    event.stopPropagation()
                    const rect = (event.currentTarget.closest(`.${css.canvas}`) as HTMLElement).getBoundingClientRect()
                    setDispatch({
                      cardId: card.id,
                      shortId: card.shortId,
                      ...(beeId !== undefined ? { beeId } : {}),
                      x: event.clientX - rect.left + 8,
                      y: event.clientY - rect.top + 8,
                    })
                  }}
                >
                  {t('board.dispatchTask')}
                </button>
              </div>
            </div>
          )
        })}
        {dispatch !== null && (
          <div className={css.dispatchPop} style={{ left: dispatch.x, top: dispatch.y }}>
            <div className={css.shortId}>{t('board.dispatchPrompt')} · {dispatch.shortId}</div>
            <textarea className={css.dispatchArea} value={draft} onChange={(event) => { setDraft(event.target.value) }} autoFocus />
            <div className={css.dispatchRow}>
              <button type="button" className={css.actionBtn} onClick={() => { setDispatch(null); setDraft('') }}>✕</button>
              <button type="button" className={css.actionBtn} onClick={() => { void submitDispatch() }}>
                {dispatch.beeId !== undefined ? t('board.dispatchToBee') : t('board.dispatchToCommander')}
              </button>
            </div>
          </div>
        )}
      </div>
      {archived.length > 0 && (
        <div className={css.archiveBand}>
          <div className={css.archiveTitle}>{t('board.archive')} · {archived.length}</div>
          <div className={css.archiveGrid}>
            {archived.map(card => (
              <div key={card.id} className={css.archiveCard}>
                <div className={css.archiveCardTitle}>{card.shortId} {card.title}</div>
                <div>{t(statusKey(card))}{card.ext.refutation !== undefined ? ` — ${card.ext.refutation.slice(0, 60)}` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {detailCard !== undefined && (
        <CardDetail card={detailCard} board={board} t={t} actions={actions} onClose={() => { setDetailId(null) }} />
      )}
    </div>
  )
}
