/**
 * Board view client plugin: one `conversation.view` tab rendering the
 * session's engagement board (gray idea → green vuln → blue access chain).
 * Data comes from the `board` session projection (host: session-board) plus
 * the bee catalog; card actions dispatch tasks to bees or prefill the
 * commander composer.
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
import type {} from '@dsh-redteam/dsh-session-board/client'
import { BoardView } from './BoardView.tsx'
import type { BoardViewInjected } from './contract.ts'
import { en, NS, zh, type BoardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Board canvas copy. */
    'rtBoard': BoardKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Board-card dispatch: short-lived retain around one queued message. */
    rtBoardDispatch: unknown
  }
}

/** Required browser services for sessions, slots, locale, Sidebar opening, and composer drafts. */
export const inject = ['sessions', 'slots', 'locale', 'sidebarRight']

/**
 * Client plugin body: register the board view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rt-board: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'rt-board',
    order: 6,
    label: () => t('view.board'),
    locale: NS,
    inject: (sessionId): BoardViewInjected => ({
      openBee(childId, mode) {
        const address: SubagentAddress = {
          parentSessionId: sessionId,
          childSessionId: childId,
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
      async sendToBee(childId, text) {
        // Retain the child session and queue a message; prompt() routes to
        // subagents/prompt automatically for a subagent-addressed reference.
        // Queue (never steer): the swarm's steer-cadence discipline keeps
        // mid-flight interruptions rare and deliberate.
        const reference = ctx.sessions.retain(
          { parentSessionId: sessionId, childSessionId: childId, mode: 'continuable' },
          { source: 'rtBoardDispatch' },
        )
        try {
          const result = await reference.binding.session.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) throw new Error(`rt-board: dispatch rejected: ${result.error.message}`)
        } finally {
          reference.release()
        }
      },
    }),
  }, BoardView))
}
