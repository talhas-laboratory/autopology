import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests-node/**/*.test.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      enabled: false,
    },
  },
});
