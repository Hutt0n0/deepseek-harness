/** Swarm view: card wall over one session's subagent catalog. */
import { useEffect, useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionProjectionMap, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './swarm.module.css'

/** Card-row facts resolved from the sessions snapshot. */
interface SwarmCard {
  readonly childId: string
  readonly mode: 'one-shot' | 'continuable'
  readonly label: string
  readonly running: boolean
  readonly timing: SessionProjectionMap['subagentTiming'] | undefined
}

/** Format an active-turn duration in compact human units. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m${totalSeconds % 60 > 0 ? ` ${totalSeconds % 60}s` : ''}`
  return `${Math.floor(minutes / 60)}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''}`
}

/** Cards in catalog order; one row per healthy catalog entry. */
function deriveCards(
  catalog: SessionListState['subagentsByParent'][SessionId] | undefined,
  byId: SessionListState['byId'],
): SwarmCard[] {
  const entries = catalog?.entries ?? []
  const cards: SwarmCard[] = []
  for (const entry of entries) {
    if (entry.kind !== 'child') continue
    const summary = byId[entry.id]
    const projections = summary?.projectionValues
    const identity = projections?.subagent
    cards.push({
      childId: entry.id,
      mode: entry.mode,
      label: ('label' in entry && entry.label) || identity?.label || entry.id.slice(0, 8),
      running: summary?.running === true,
      timing: projections?.subagentTiming,
    })
  }
  return cards
}

/**
 * The swarm card wall for the current (commander) session. `injected` comes
 * from the conversation.view registration's per-session inject(); opening a
 * card routes through the existing `subagentchat` right-sidebar resource.
 */
export function SwarmView({
  useSessions, sessionId, openBee, refresh, watch, t,
}: ConvViewProps & InjectFace<SwarmViewInjected> & PropsLocale<typeof NS>) {
  const byId = useSessions(state => state.byId)
  const catalog = useSessions(state => state.subagentsByParent[sessionId])
  // While this wall is mounted it is a live catalog consumer: registration
  // makes membership events (a bee spawning, settling) refetch this parent's
  // catalog, so cards appear without a manual refresh.
  useEffect(() => {
    watch(true)
    return () => { watch(false) }
  }, [watch, sessionId])
  const cards = useMemo(() => deriveCards(catalog, byId), [catalog, byId])
  const runningCount = cards.filter(card => card.running).length
  return (
    <div className={css.root} data-rt-swarm="">
      <div className={css.header}>
        <span>{t('swarm.count', { count: cards.length })}</span>
        {runningCount > 0 && <span className={css.runningMeta}>{t('swarm.running', { count: runningCount })}</span>}
        <button
          type="button"
          className={css.refreshBtn}
          onClick={() => { refresh() }}
        >
          {t('swarm.refresh')}
        </button>
      </div>
      {catalog?.state === 'error' && (
        <div className={css.error}>{t('swarm.loadFailed')}{catalog.error === null ? '' : `: ${catalog.error.message}`}</div>
      )}
      {cards.length === 0
        ? (
          <div className={css.empty}>
            <span>{t('swarm.empty')}</span>
            <span>{t('swarm.emptyHint')}</span>
          </div>
        )
        : (
          <div className={css.wall}>
            {cards.map(card => (
              <button
                key={card.childId}
                type="button"
                className={css.card}
                onClick={() => { openBee(card.childId, card.mode) }}
                title={t('swarm.openTranscript')}
              >
                <span className={css.cardTop}>
                  <span className={card.running ? `${css.dot} ${css.dotRunning}` : css.dot} />
                  <span className={css.label}>{card.label}</span>
                </span>
                <span className={css.meta}>
                  <span className={card.running ? css.runningMeta : undefined}>
                    {card.running
                      ? t('swarm.statusRunning')
                      : card.mode === 'continuable'
                        ? t('swarm.statusStopped')
                        : t('swarm.statusDone')}
                  </span>
                  <span>{card.mode === 'continuable' ? t('swarm.modeContinuable') : t('swarm.modeOneShot')}</span>
                  {card.timing !== undefined && (
                    <span>
                      {t('swarm.duration', {
                        duration: formatDuration(card.timing.settledMs
                          + (card.timing.active !== undefined
                            ? Math.max(0, card.timing.active.through - card.timing.active.since)
                            : 0)),
                      })}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
    </div>
  )
}

/** Session-bound actions injected by the plugin registration. */
export interface SwarmViewInjected {
  /** Open one bee's transcript in the right Sidebar. */
  openBee: (childId: string, mode: 'one-shot' | 'continuable') => void
  /** Re-read this session's subagent catalog from the Host. */
  refresh: () => void
  /** Register/unregister this wall as a live catalog consumer for its session. */
  watch: (open: boolean) => void
}
