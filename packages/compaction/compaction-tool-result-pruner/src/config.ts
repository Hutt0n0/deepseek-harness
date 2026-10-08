/** Configuration resolution for deterministic tool-result pruning. */

import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { ResolvedConfig, ToolResultPruneConfig } from './types.ts'

/** Fixed marker substituted for every removed middle span. */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/** Placeholder left in place of one collapsed repeated-poll result. */
export const COLLAPSE_MARKER = '\n[repeated poll collapsed — same command ran again; latest result kept below/above]\n'

/** Low-friction defaults for coding-agent tool output. */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
  collapseRepeats: 3,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'thresholdChars',
  'headChars',
  'tailChars',
  'collapseRepeats',
])

/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text to measure.
 * @returns the Unicode code-point count.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Canonical polling key for one tool call: the tool name plus its arguments
 * with every digit run and whitespace run flattened. Sleep durations, PIDs,
 * and byte counters differ between rounds of the same poll — a bee watching
 * `sleep 115; cat scan.gnmap` for an hour issues thirty distinct commands
 * that are all one polling family. Digit-flattening groups them; genuinely
 * different commands (different target paths, different flags) still differ.
 * @param name - tool name.
 * @param argumentsJson - raw arguments JSON string as logged.
 * @returns the flattened canonical key.
 */
export function canonicalCommand(name: string, argumentsJson: string): string {
  return name + '|' + argumentsJson.replace(/\d+/g, '#').replace(/\s+/g, ' ')
}

/**
 * Resolve and validate pruning budgets.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
export function resolveConfig(config: ToolResultPruneConfig = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown key "${key}" `
        + '(allowed: thresholdChars, headChars, tailChars)',
      )
    }
  }

  const resolved: ResolvedConfig = {
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    headChars: config.headChars ?? DEFAULTS.headChars,
    tailChars: config.tailChars ?? DEFAULTS.tailChars,
    collapseRepeats: config.collapseRepeats ?? DEFAULTS.collapseRepeats,
  }
  assertPositiveInteger('thresholdChars', resolved.thresholdChars)
  assertNonNegativeInteger('headChars', resolved.headChars)
  assertNonNegativeInteger('tailChars', resolved.tailChars)
  assertNonNegativeInteger('collapseRepeats', resolved.collapseRepeats)

  const emittedChars = resolved.headChars
    + codePointLength(PRUNE_MARKER)
    + resolved.tailChars
  if (emittedChars > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + marker + tailChars (${emittedChars}) `
      + `must be at most thresholdChars (${resolved.thresholdChars})`,
    )
  }
  return deepFreeze(structuredClone(resolved))
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a positive integer`)
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a non-negative integer`)
  }
}
