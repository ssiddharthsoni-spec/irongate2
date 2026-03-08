import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
  },
});
