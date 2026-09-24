/** Wire shape of one skills listing entry (shared by view and loader). */
export interface SkillEntry {
  readonly name: string
  readonly path?: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}
