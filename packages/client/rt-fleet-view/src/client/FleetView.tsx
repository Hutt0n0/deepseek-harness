/** Fleet management view: editable roster over /rt-fleet list + set. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BeeEntry } from './contract.ts'
import css from './fleet-view.module.css'

/** Props of the fleet page. */
export type FleetViewProps = PropsRuntime<'main'> & PropsLocale<typeof NS>

/** Mutable working copy of one bee in the editor. */
interface BeeDraft {
  readonly toolName: string
  readonly kind: string
  readonly persona: string
  readonly toolFilter: readonly string[]
  readonly backgroundMode: 'continuable' | 'one-shot'
  /** Sub-bee authorization — carried through verbatim so saving the fleet
   * from the management page never strips a subbee configured elsewhere
   * (full subbee editing lands with the management-page subbee editor). */
  readonly maxSubbees?: number
  readonly subbee?: {
    readonly toolName: string
    readonly persona: string
    readonly toolFilter: readonly string[]
  }
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/i

/** Client-side validation; mirrors the route's server checks. */
function validate(bees: readonly BeeDraft[], t: TranslateNS<typeof NS>): string | undefined {
  const toolNames = new Set<string>()
  const kinds = new Set<string>()
  for (const [index, bee] of bees.entries()) {
    if (!NAME_PATTERN.test(bee.toolName)) return `${t('fleet.invalidName')} (bee[${index}] toolName)`
    if (toolNames.has(bee.toolName)) return `${t('fleet.duplicateTool')}: ${bee.toolName}`
    toolNames.add(bee.toolName)
    if (!NAME_PATTERN.test(bee.kind)) return `${t('fleet.invalidName')} (bee[${index}] kind)`
    if (kinds.has(bee.kind)) return `${t('fleet.duplicateKind')}: ${bee.kind}`
    kinds.add(bee.kind)
    if (bee.persona.trim() === '') return `${t('fleet.personaRequired')} (${bee.toolName})`
    if (bee.toolFilter.length === 0) return `${t('fleet.toolboxHint')} (${bee.toolName})`
  }
  return undefined
}

/** One bee card: collapsed identity row + expandable full editor. */
function BeeCard({
  bee, index, knownTools, onChange, onRemove, t,
}: {
  bee: BeeDraft
  index: number
  knownTools: readonly string[]
  onChange: (next: BeeDraft) => void
  onRemove: () => void
  t: TranslateNS<typeof NS>
}) {
  const [expanded, setExpanded] = useState(false)
  const toggleTool = (name: string): void => {
    const has = bee.toolFilter.includes(name)
    onChange({ ...bee, toolFilter: has ? bee.toolFilter.filter(item => item !== name) : [...bee.toolFilter, name] })
  }
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <span className={css.toolName}>{bee.toolName}</span>
        <span className={css.kindTag}>{bee.kind}</span>
        <span className={css.modeText}>{bee.backgroundMode === 'continuable' ? t('fleet.modeContinuable') : t('fleet.modeOneShot')}</span>
        <span className={css.cardActions}>
          <button type="button" className={css.ghostBtn} onClick={() => { setExpanded(prev => !prev) }}>
            {expanded ? t('fleet.collapse') : t('fleet.expand')}
          </button>
          <button type="button" className={css.dangerBtn} onClick={onRemove}>{t('fleet.remove')}</button>
        </span>
      </div>
      {expanded && (
        <div className={css.editor}>
          <div className={css.fieldRow}>
            <span className={css.fieldLabel}>{t('fleet.toolName')}</span>
            <input
              className={css.textInput}
              value={bee.toolName}
              onChange={(event) => { onChange({ ...bee, toolName: event.target.value.trim() }) }}
            />
          </div>
          <div className={css.fieldRow}>
            <span className={css.fieldLabel}>{t('fleet.kind')}</span>
            <input
              className={css.textInput}
              value={bee.kind}
              onChange={(event) => { onChange({ ...bee, kind: event.target.value.trim() }) }}
            />
          </div>
          <div className={css.fieldRow}>
            <span className={css.fieldLabel}>{t('fleet.backgroundMode')}</span>
            <span className={css.modeToggle}>
              {(['continuable', 'one-shot'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`${css.toolChip}${bee.backgroundMode === mode ? ` ${css.toolChipOn}` : ''}`}
                  onClick={() => { onChange({ ...bee, backgroundMode: mode }) }}
                >
                  {mode === 'continuable' ? t('fleet.modeContinuable') : t('fleet.modeOneShot')}
                </button>
              ))}
            </span>
          </div>
          <div className={css.fieldRowWide}>
            <span className={css.fieldLabel}>{t('fleet.persona')}</span>
            <textarea
              className={css.personaArea}
              value={bee.persona}
              onChange={(event) => { onChange({ ...bee, persona: event.target.value }) }}
            />
          </div>
          <div className={css.fieldRowWide}>
            <span className={css.fieldLabel}>{t('fleet.toolbox')}</span>
            <span>
              <span className={css.toolbox}>
                {knownTools.map(name => (
                  <button
                    key={name}
                    type="button"
                    className={`${css.toolChip}${bee.toolFilter.includes(name) ? ` ${css.toolChipOn}` : ''}`}
                    onClick={() => { toggleTool(name) }}
                  >
                    {name}
                  </button>
                ))}
              </span>
              <span className={css.hint}>{t('fleet.toolboxHint')}</span>
            </span>
          </div>
        </div>
      )}
      {index < 0 && <span />}
    </div>
  )
}

/** The management page for one deployment's fleet. */
export function FleetView({
  t,
}: FleetViewProps): ReactNode {
  const [bees, setBees] = useState<readonly BeeEntry[] | undefined>(undefined)
  const [knownTools, setKnownTools] = useState<readonly string[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [toast, setToast] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    const cancelled = { current: false }
    void (async () => {
      try {
        const response = await fetch('/rt-fleet/list', { method: 'POST' })
        const wire = await response.json() as { ok: boolean; bees?: unknown; knownTools?: unknown; error?: string }
        if (!wire.ok) throw new Error(wire.error ?? `listing failed: ${response.status}`)
        if (!cancelled.current) {
          setBees((wire.bees ?? []) as readonly BeeEntry[])
          setKnownTools((wire.knownTools ?? []) as readonly string[])
          setError(undefined)
        }
      } catch (cause) {
        if (!cancelled.current) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled.current = true }
  }, [])

  useEffect(() => load(), [load, reloadKey])

  useEffect(() => {
    if (toast === undefined) return
    const timer = setTimeout(() => { setToast(undefined) }, 3600)
    return () => { clearTimeout(timer) }
  }, [toast])

  const drafts = useMemo<readonly BeeDraft[]>(() => (bees ?? []).map(bee => ({
    toolName: bee.toolName,
    kind: bee.kind,
    persona: bee.persona,
    toolFilter: bee.toolFilter,
    backgroundMode: bee.backgroundMode,
    ...(bee.maxSubbees !== undefined ? { maxSubbees: bee.maxSubbees } : {}),
    ...(bee.subbee !== undefined ? { subbee: bee.subbee } : {}),
  })), [bees])

  const change = (index: number, next: BeeDraft): void => {
    setBees(prev => (prev ?? []).map((bee, i) => (i === index ? next : bee)))
  }
  const remove = (index: number): void => {
    setBees(prev => (prev ?? []).filter((_, i) => i !== index))
  }
  const add = (): void => {
    setBees(prev => [...(prev ?? []), {
      toolName: `subagent_bee_${(prev ?? []).length + 1}`,
      kind: `bee${(prev ?? []).length + 1}`,
      persona: 'You are a red-team worker bee. Await the commander\'s task brief.',
      toolFilter: ['read', 'grep'],
      backgroundMode: 'continuable',
    }])
  }

  const validation = validate(drafts, t)

  const save = useCallback(() => {
    if (validation !== undefined) return
    setSaving(true)
    void (async () => {
      try {
        const response = await fetch('/rt-fleet/set', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bees: drafts }),
        })
        const wire = await response.json() as { ok: boolean; error?: string }
        if (!wire.ok) throw new Error(wire.error ?? `save failed: ${response.status}`)
        setToast(t('fleet.saved'))
        setReloadKey(key => key + 1)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setSaving(false)
      }
    })()
  }, [drafts, validation, t])

  return (
    <div className={css.root} data-rt-fleet="">
      <div className={css.header}>
        <span>{t('fleet.count', { count: drafts.length })}</span>
        <span className={css.headerNote}>{t('fleet.maxDepthNote')}</span>
        <span className={css.spacer} />
        <button type="button" className={css.ghostBtn} onClick={() => { add() }}>{t('fleet.addBee')}</button>
        <button
          type="button"
          className={css.primaryBtn}
          disabled={saving || validation !== undefined}
          title={validation ?? undefined}
          onClick={() => { save() }}
        >
          {t('fleet.save')}
        </button>
      </div>
      {error !== undefined && (
        <div className={css.error}>
          <span>{t('fleet.loadFailed')}: {error}</span>
          <button type="button" className={css.ghostBtn} onClick={() => { setReloadKey(key => key + 1) }}>{t('fleet.retry')}</button>
        </div>
      )}
      {validation !== undefined && (
        <div className={css.error}>
          <span>{validation}</span>
        </div>
      )}
      {bees !== undefined && drafts.length === 0 && (
        <div className={css.empty}>{t('fleet.empty')}</div>
      )}
      {drafts.length > 0 && (
        <div className={css.roster}>
          {drafts.map((bee, index) => (
            <BeeCard
              key={`${bee.toolName}:${index}`}
              bee={bee}
              index={index}
              knownTools={knownTools}
              onChange={(next) => { change(index, next) }}
              onRemove={() => { remove(index) }}
              t={t}
            />
          ))}
        </div>
      )}
      {toast !== undefined && <div className={css.toast}>{toast}</div>}
    </div>
  )
}
