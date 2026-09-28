import { defineConfig } from 'tsdown'

/** Host-only bundle for standalone rebuilds; workspace deps stay bare imports. */
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
