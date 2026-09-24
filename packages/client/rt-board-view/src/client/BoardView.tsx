/** Board view tab: the attack-chain canvas over one session's board projection. */
import { useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardViewInjected } from './contract.ts'
import { NS } from './locales.ts'
import { BoardCanvas, type BoardCanvasActions, type BoardFilter } from './graph/BoardCanvas.tsx'
import css from './board.module.css'

/** Props of the board tab from the conversation.view registration. */
export type BoardViewProps = ConvViewProps & InjectFace<BoardViewInjected> & PropsLocale<typeof NS>

/**
 * The board tab body. Data: the session's `board` projection plus the bee
 * catalog for liveness. The canvas chunk loads only when a board exists.
 */
export function BoardView({
  useProjection, useSessions, sessionId, inputActions, openBee, sendToBee, t,
}: BoardViewProps) {
  const board = useProjection('board') ?? null
  const byId = useSessions(state => state.byId)
  const catalog = useSessions(state => state.subagentsByParent[sessionId])
  const beeRunning = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const entry of catalog?.entries ?? []) {
      if (entry.kind !== 'child') continue
      map[entry.id] = byId[entry.id]?.running === true
    }
    return map
  }, [catalog, byId])
  const cardCount = board === null ? 0 : Object.keys(board.cards).length
  const [filter, setFilter] = useState<BoardFilter>('all')

  if (board === null || cardCount === 0) {
    return (
      <div className={css.root} data-rt-board="">
        <div className={css.empty}>
          <span>{t('board.empty')}</span>
          <span>{t('board.emptyHint')}</span>
        </div>
      </div>
    )
  }

  const actions: BoardCanvasActions = {
    beeRunning,
    openBee,
    sendToBee,
    // Composer draft prefill via the standard input actions (user reviews
    // and sends; the loop stays authoritative over which bee is dispatched).
    draftToCommander: (text) => { inputActions.setDraft(text) },
  }

  return (
    <div className={css.root} data-rt-board="">
      <div className={css.toolbar}>
        <span>{t('board.count', { count: cardCount })}</span>
        <span className={css.filterRow}>
          {([['all', t('board.filterAll')], ['idea', t('board.kindIdea')], ['vuln', t('board.kindVuln')],
            ['access', t('board.kindAccess')], ['running', t('board.filterRunning')]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${css.filterPill}${filter === key ? ` ${css.filterPillActive}` : ''}`}
              onClick={() => { setFilter(key) }}
            >
              {label}
            </button>
          ))}
        </span>
        <span className={css.legend}>
          <span className={css.legendItem}>
            <span className={`${css.legendLine} ${css.legendLineDerive}`} />
            {t('board.legendDerive')}
          </span>
          <span className={css.legendItem}>
            <span className={`${css.legendLine} ${css.legendLinePivot}`} />
            {t('board.legendPivot')}
          </span>
          <span className={css.legendItem}>
            <span className={`${css.legendLine} ${css.legendLineDim}`} />
            {t('board.legendDim')}
          </span>
        </span>
      </div>
      <BoardCanvas board={board} t={t} actions={actions} filter={filter} />
    </div>
  )
}

export type { SessionId }
