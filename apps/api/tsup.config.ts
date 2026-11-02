import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/server.ts', 'src/scripts/seed.ts', 'src/scripts/sync-indexes.ts'],
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    sourcemap: true,
    clean: true,
    noExternal: ['@erp/shared'],
  },
  {
    entry: { index: 'src/serverless.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: '../../api',
    sourcemap: false,
    clean: false,
    noExternal: ['@erp/shared'],
  },
]);
