/** Wire shape of one bee entry (shared by view and loader). */
export interface BeeEntry {
  readonly toolName: string
  readonly kind: string
  readonly persona: string
  readonly toolFilter: readonly string[]
  readonly backgroundMode: 'continuable' | 'one-shot'
}

/** Wire shape of /rt-fleet/list. */
export interface FleetListValue {
  readonly ok: boolean
  readonly bees?: readonly BeeEntry[]
  readonly knownTools?: readonly string[]
  readonly error?: string
}
