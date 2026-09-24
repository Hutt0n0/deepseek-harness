/** Skill management view: roster over skills.list + rt-skills settings toggles. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NS } from './locales.ts'
import type { SkillEntry } from './contract.ts'
export type { SkillEntry } from './contract.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './skill-view.module.css'

/** rt-skills settings document. */
interface RtSkillsSettings {
  readonly disabled?: readonly string[]
}

/** One roster row: wire entry joined with the runtime toggle state. */
interface SkillRow {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly modelInvocable: boolean
  /** Effective state: static-off entries cannot be toggled on. */
  readonly effectiveEnabled: boolean
  readonly staticallyBlocked: boolean
}

/** Derive the source tag text from the SKILL.md path. */
function sourceLabel(path: string | undefined, t: TranslateNS<typeof NS>): string {
  if (path === undefined) return t('skills.sourceRuntime')
  if (path.includes('/.dsh/skills/')) return t('skills.sourceProject')
  if (path.includes('/node_modules/')) return t('skills.sourceBundled')
  if (path.includes('/skills/')) return t('skills.sourceUser')
  return t('skills.sourceCustom')
}

/** Props of the skills tab. */
export type SkillViewProps = PropsRuntime<'main'> & InjectFace<SkillViewInjected> & PropsLocale<typeof NS>

/** Session-bound controls injected by the registration. */
export interface SkillViewInjected {
  /** Bound rt-skills settings scope (read + toggle writes). */
  readonly settings: SettingsScope<RtSkillsSettings>
  /** Load this session's skill entries from the Host. */
  readonly loadSkills: () => Promise<readonly SkillEntry[]>
}

/** The management roster for one session. */
export function SkillView({
  settings, loadSkills, t,
}: SkillViewProps) {
  const [entries, setEntries] = useState<readonly SkillEntry[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [detail, setDetail] = useState<SkillRow | undefined>(undefined)

  const settingsSnapshot = settings.getSnapshot()
  const disabledList = useMemo(
    () => new Set(settingsSnapshot.value?.disabled ?? []),
    [settingsSnapshot],
  )

  const reload = useCallback(() => {
    const cancelled = { current: false }
    void (async () => {
      try {
        const list = await loadSkills()
        if (!cancelled.current) {
          setEntries(list)
          setError(undefined)
        }
      } catch (cause) {
        if (!cancelled.current) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled.current = true }
  }, [loadSkills])

  useEffect(() => {
    return reload()
  }, [reload])

  const toggle = useCallback((name: string, next: boolean) => {
    const disabled = new Set(settings.getSnapshot().value?.disabled ?? [])
    if (next) disabled.delete(name)
    else disabled.add(name)
    void settings.set('disabled', [...disabled].sort()).then(() => {
      setError(undefined)
    }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [settings])

  const rows = useMemo<readonly SkillRow[]>(() => (entries ?? []).map(entry => ({
    name: entry.name,
    description: entry.description,
    ...(entry.path !== undefined ? { path: entry.path } : {}),
    modelInvocable: entry.modelInvocable,
    // A skill absent from the disabled list shows as enabled only when its
    // static policy allows the model; disabled-list membership is the
    // runtime flip handled by the settings write.
    effectiveEnabled: !disabledList.has(entry.name),
    staticallyBlocked: !entry.modelInvocable && !disabledList.has(entry.name),
  })), [entries, disabledList])

  return (
    <div className={css.root} data-rt-skill-view="">
      <div className={css.header}>
        <span>{t('skills.count', { count: rows.length })}</span>
      </div>
      {error !== undefined && (
        <div className={css.error}>
          <span>{t('skills.loadFailed')}: {error}</span>
          <button type="button" onClick={reload}>{t('skills.retry')}</button>
        </div>
      )}
      {entries === undefined && error === undefined && <div className={css.empty}><span>…</span></div>}
      {entries !== undefined && rows.length === 0 && (
        <div className={css.empty}>
          <span>{t('skills.empty')}</span>
          <span>{t('skills.emptyHint')}</span>
        </div>
      )}
      {rows.length > 0 && (
        <div className={css.roster}>
          {rows.map((row) => {
            const statusClass = row.staticallyBlocked
              ? css.statusStatic
              : row.effectiveEnabled ? css.statusOn : css.statusOff
            const statusText = row.staticallyBlocked
              ? t('skills.modelBlocked')
              : row.effectiveEnabled ? t('skills.enabled') : t('skills.disabled')
            return (
              <div key={row.name} className={`${css.card}${row.effectiveEnabled ? '' : ` ${css.cardDim}`}`}>
                <button type="button" className={css.cardMain} onClick={() => { setDetail(row) }}>
                  <span className={css.cardHead}>
                    <span className={css.name}>{row.name}</span>
                    <span>{sourceLabel(row.path, t)}</span>
                  </span>
                  <span className={css.desc}>{row.description}</span>
                  <span className={`${css.status} ${statusClass}`}>{statusText}</span>
                </button>
                <Switch
                  checked={row.effectiveEnabled}
                  disabled={row.staticallyBlocked}
                  label={t('skills.switchLabel')}
                  onChange={(next) => { toggle(row.name, next) }}
                />
              </div>
            )
          })}
        </div>
      )}
      {detail !== undefined && (
        <Modal
          open
          onClose={() => { setDetail(undefined) }}
          closeLabel="✕"
          title={detail.name}
        >
          <div className={css.detailBody}>
            <dl className={css.detailGrid}>
              <dt>{t('skills.detailDesc')}</dt>
              <dd>{detail.description}</dd>
              {detail.path !== undefined && (<><dt>{t('skills.detailPath')}</dt><dd>{detail.path}</dd></>)}
            </dl>
            <p className={css.detailNote}>{t('skills.detailUserOnly')}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
