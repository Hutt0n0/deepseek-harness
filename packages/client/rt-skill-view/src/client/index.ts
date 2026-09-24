/**
 * Skill management page (顶级侧边栏面板): lists every skill the deployment
 * discovered, with runtime enable/disable toggles backed by the rt-skills
 * settings namespace. Session-independent: served by the skill-control
 * deployment routes, and reachable from the sidebar at the same level as
 * the workspace entry.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only merges used by the apply world.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import type { RtSkillsSettings } from '@dsh-redteam/dsh-skill-control/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SkillView } from './SkillView.tsx'
import { SkillPanelIcon } from './SkillPanelIcon.tsx'
import { en, NS, zh, type SkillViewKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill management view copy. */
    'rtSkillView': SkillViewKey
  }
}

/** Panel identity at the sidebar's top navigation level. */
export const PANEL_ID = 'rt-skills' as MainPanelId

/** Required browser services: slots, locale, and settings scopes. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Client plugin body: register the skills management section in Settings.
 * The registration rides the slot service's effect wrapper, so plugin
 * unload removes the section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rt-skill-view: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = ctx.settingsScope.bind<RtSkillsSettings>({ namespace: 'rt-skills' })

  const loadSkills = async () => {
    const response = await fetch('/rt-skills/list', { method: 'POST' })
    if (!response.ok) throw new Error(`skills listing failed: ${response.status}`)
    const wire = await response.json() as { ok: boolean; items?: unknown; error?: string }
    if (!wire.ok) throw new Error(wire.error ?? 'skills listing failed')
    return wire.items as import('./contract.ts').SkillEntry[]
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ settings, loadSkills }),
  }, SkillView))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 0,
    label: () => t('view.skills'),
    locale: NS,
  }, SkillPanelIcon))
}
