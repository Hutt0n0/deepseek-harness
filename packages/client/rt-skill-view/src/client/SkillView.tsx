/** Skill management view: roster over skills.list + rt-skills settings toggles. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NS } from './locales.ts'
import type { SkillEntry } from './contract.ts'
export type { SkillEntry } from './contract.ts'
import css from './skill-view.module.css'

/** rt-skills settings document. */
interface RtSkillsSettings {
  readonly disabled?: readonly string[]
}

/** Source facet the roster groups by, derived from the SKILL.md path. */
type SkillSource = 'project' | 'user' | 'bundled' | 'custom' | 'runtime'

/** One roster row: wire entry joined with the runtime toggle state. */
interface SkillRow {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  /** Effective state: static-off entries cannot be toggled on. */
  readonly effectiveEnabled: boolean
  readonly staticallyBlocked: boolean
  readonly source: SkillSource
}

/** Source facet from the SKILL.md path. */
function sourceOf(path: string | undefined): SkillSource {
  if (path === undefined) return 'runtime'
  if (path.includes('/.dsh/skills/')) return 'project'
  if (path.includes('/node_modules/')) return 'bundled'
  if (path.includes('/skills/')) return 'user'
  return 'custom'
}

/** Locale key for one source facet. */
function sourceKey(source: SkillSource): 'skills.sourceProject' | 'skills.sourceUser'
  | 'skills.sourceBundled' | 'skills.sourceCustom' | 'skills.sourceRuntime' {
  return source === 'project' ? 'skills.sourceProject'
    : source === 'user' ? 'skills.sourceUser'
      : source === 'bundled' ? 'skills.sourceBundled'
        : source === 'custom' ? 'skills.sourceCustom' : 'skills.sourceRuntime'
}

/** Fixed group order; unknown facets fall to the end. */
const SOURCE_ORDER: readonly SkillSource[] = ['project', 'user', 'bundled', 'custom', 'runtime']

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
  const [pending, setPending] = useState<readonly string[]>([])

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
    setPending(prev => [...prev, name])
    const disabled = new Set(settings.getSnapshot().value?.disabled ?? [])
    if (next) disabled.delete(name)
    else disabled.add(name)
    void settings.set('disabled', [...disabled].sort()).then(() => {
      setError(undefined)
    }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      setPending(prev => prev.filter(item => item !== name))
    })
  }, [settings])

  const rows = useMemo<readonly SkillRow[]>(() => (entries ?? []).map(entry => ({
    name: entry.name,
    description: entry.description,
    ...(entry.path !== undefined ? { path: entry.path } : {}),
    ...(entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {}),
    modelInvocable: entry.modelInvocable,
    // A skill absent from the disabled list shows as enabled only when its
    // static policy allows the model; disabled-list membership is the
    // runtime flip handled by the settings write.
    effectiveEnabled: !disabledList.has(entry.name),
    staticallyBlocked: !entry.modelInvocable && !disabledList.has(entry.name),
    source: sourceOf(entry.path),
  })), [entries, disabledList])

  const groups = useMemo(() => {
    const bySource = new Map<SkillSource, SkillRow[]>()
    for (const row of rows) {
      const bucket = bySource.get(row.source)
      if (bucket === undefined) bySource.set(row.source, [row])
      else bucket.push(row)
    }
    return [...bySource.entries()]
      .sort(([a], [b]) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b))
      .map(([source, rowsOfSource]) => ({ source, rows: rowsOfSource }))
  }, [rows])

  return (
    <div className={css.root} data-rt-skill-view="">
      <div className={css.header}>
        <span>{t('skills.count', { count: rows.length })}</span>
      </div>
      {error !== undefined && (
        <div className={css.error}>
          <span>{t('skills.loadFailed')}: {error}</span>
          <button type="button" className={css.errorBtn} onClick={() => { reload() }}>{t('skills.retry')}</button>
        </div>
      )}
      {entries === undefined && error === undefined && (
        <div className={css.skeleton} data-rt-skill-loading="">
          <div className={css.skeletonRow} />
          <div className={css.skeletonRow} />
          <div className={css.skeletonRow} />
        </div>
      )}
      {entries !== undefined && rows.length === 0 && (
        <div className={css.empty}>
          <span>{t('skills.empty')}</span>
          <span>{t('skills.emptyHint')}</span>
        </div>
      )}
      {groups.map(({ source, rows: groupRows }) => (
        <section key={source} className={css.group}>
          <div className={css.groupHead}>
            <span>{t(sourceKey(source))}</span>
            <span className={css.groupCount}>{groupRows.length}</span>
          </div>
          <div className={css.roster}>
            {groupRows.map((row) => {
              const statusClass = row.staticallyBlocked
                ? css.statusStatic
                : row.effectiveEnabled ? css.statusOn : css.statusOff
              const statusText = row.staticallyBlocked
                ? t('skills.modelBlocked')
                : row.effectiveEnabled ? t('skills.enabled') : t('skills.disabled')
              return (
                <div
                  key={row.name}
                  className={`${css.card}${row.effectiveEnabled ? '' : ` ${css.cardDim}`}`}
                >
                  <button type="button" className={css.cardMain} onClick={() => { setDetail(row) }}>
                    <span className={css.cardHead}>
                      <span className={css.name}>{row.name}</span>
                      <span className={`${css.status} ${statusClass}`}>{statusText}</span>
                    </span>
                    <span className={css.desc}>{row.description}</span>
                  </button>
                  <Switch
                    checked={row.effectiveEnabled}
                    disabled={row.staticallyBlocked || pending.includes(row.name)}
                    label={t('skills.switchLabel')}
                    onChange={(next) => { toggle(row.name, next) }}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
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
              {detail.whenToUse !== undefined && (
                <><dt>{t('skills.detailWhen')}</dt><dd>{detail.whenToUse}</dd></>
              )}
              {detail.path !== undefined && (
                <><dt>{t('skills.detailPath')}</dt><dd><code className={css.detailPathCode}>{detail.path}</code></dd></>
              )}
            </dl>
            <p className={css.detailNote}>{t('skills.detailUserOnly')}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
