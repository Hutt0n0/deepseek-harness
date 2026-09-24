/**
 * Pure types of the red-team skill-control domain: the `rt-skills` settings
 * vocabulary and the management-face wire types. No host-side value imports.
 *
 * @module @dsh-redteam/dsh-skill-control/types
 */
/** Settings namespace owning the runtime enable/disable state of skills. */
export const RT_SKILLS_SETTINGS_NAMESPACE = 'rt-skills'
/** One bee kind's assigned skill names. */
export interface BeeSkillAssignment {
  readonly recon?: readonly string[]
  readonly jsint?: readonly string[]
  readonly web?: readonly string[]
  readonly pivot?: readonly string[]
}
/** Settings document for `rt-skills`: global disables + per-bee assignments. */
export interface RtSkillsSettings {
  /** Disabled skill names (model-facing catalog excludes them). */
  readonly disabled?: readonly string[]
  /** Skills assigned to each bee kind; a bee's catalog lists only these. */
  readonly beeSkills?: BeeSkillAssignment
}
/** Management-face view of one discovered skill. */
export interface SkillControlItem {
  /** Skill name (kebab-case). */
  readonly name: string
  readonly description: string
  /** Which root the skill was discovered from. */
  readonly source: string
  /** File path of the SKILL.md, when the provider disclosed one. */
  readonly path?: string
  /** Static frontmatter policy. */
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  /** Effective runtime state: false when the user disabled it. */
  readonly enabled: boolean
}
