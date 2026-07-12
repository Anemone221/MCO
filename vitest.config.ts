import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(root, 'src/main'),
      '@shared': resolve(root, 'src/shared'),
      '@renderer': resolve(root, 'src/renderer/src'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
