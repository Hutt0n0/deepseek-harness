import { defineConfig } from 'tsdown'

/**
 * Host-only bundle for standalone rebuilds. Workspace dependencies stay bare
 * imports: the profile environment resolves @deepseek-ai/* and @dsh-redteam/*
 * through its own two-anchor resolution, and bundling the workspace source
 * facade would inline TS decorator syntax the runtime cannot execute.
 */
const workspaceExternal = (id: string): boolean => id.startsWith('@deepseek-ai/') || id.startsWith('@dsh-redteam/')

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  fixedExtension: false,
  external: workspaceExternal,
})
