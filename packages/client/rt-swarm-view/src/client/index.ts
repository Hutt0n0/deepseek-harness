/**
 * Swarm view client plugin: one `conversation.view` tab showing the current
 * session's subagent (bee) catalog as a card wall. Opening a card routes
 * through the existing `subagentchat` right-sidebar resource (registered by
 * ui-subagent), so this package owns no transcript rendering and no second
 * resource protocol.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
// Type-only merges used by the apply world.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import { SwarmView, type SwarmViewInjected } from './SwarmView.tsx'
import { en, NS, zh, type SwarmKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Swarm card-wall copy. */
    'rtSwarm': SwarmKey
  }
}

/** Required browser services for sessions, slots, locale, and Sidebar opening. */
export const inject = ['sessions', 'slots', 'locale', 'sidebarRight']

/**
 * Client plugin body: register the swarm view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rt-swarm: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'rt-swarm',
    order: 5,
    label: () => t('view.swarm'),
    locale: NS,
    inject: (sessionId): SwarmViewInjected => ({
      watch(open) {
        ctx.sessions.setSubagentCatalogOpen(sessionId, open)
      },
      openBee(childId, mode) {
        const address: SubagentAddress = {
          parentSessionId: sessionId,
          childSessionId: childId as SubagentAddress['childSessionId'],
          mode,
        }
        const query = new URLSearchParams({
          parent: address.parentSessionId,
          mode: address.mode,
        })
        ctx.sidebarRight.openResource(
          `dsh-resource://subagentchat/session/${encodeURIComponent(childId)}?${query}`,
          { preferNewPane: true },
        )
      },
      refresh() {
        void ctx.sessions.refreshSubagents(sessionId)
      },
    }),
  }, SwarmView))
}
