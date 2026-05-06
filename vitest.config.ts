import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    pool: 'forks', // sql.js init can be flaky on shared workers
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/tray.ts'],
    },
  },
});
