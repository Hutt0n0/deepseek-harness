/** Board view session-bound action contract (shared by entry and view). */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Actions injected into the board tab by the conversation.view registration. */
export interface BoardViewInjected {
  /** Open one bee's transcript in the right Sidebar. */
  openBee: (childId: SessionId, mode: 'one-shot' | 'continuable') => void
  /** Send a queue message to one continuable bee. */
  sendToBee: (childId: SessionId, text: string) => Promise<void>
}
