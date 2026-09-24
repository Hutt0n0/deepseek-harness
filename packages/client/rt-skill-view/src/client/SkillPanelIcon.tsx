import type { ReactNode } from 'react'
/** The sidebar's Skills entry icon; the sidebar owns the button, label, and selected state around it. */
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the skill glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge size.
 * @returns the icon element.
 */
export function SkillPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconSkillOutline16 size={size} />
}
