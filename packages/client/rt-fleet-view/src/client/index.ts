/**
 * Fleet management page (顶级侧边栏面板): edit the commander's bee line-up —
 * per-bee toolName / kind / persona / toolbox — backed by the bee-fleet
 * deployment routes. Saving hot-reloads the mounted delegation tools; new
 * sessions use the new fleet while running bees settle untouched.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only merges used by the apply world.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { FleetView } from './FleetView.tsx'
import { FleetPanelIcon } from './FleetPanelIcon.tsx'
import { en, NS, zh, type FleetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fleet management view copy. */
    'rtFleet': FleetKey
  }
}

/** Panel identity at the sidebar's top navigation level. */
export const PANEL_ID = 'rt-fleet' as MainPanelId

/** Required browser services: slots and locale. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the fleet management panel. The registration
 * rides the slot service's effect wrapper, so plugin unload removes the panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rt-fleet-view: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({}),
  }, FleetView))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 0,
    label: () => t('view.fleet'),
    locale: NS,
  }, FleetPanelIcon))
}
