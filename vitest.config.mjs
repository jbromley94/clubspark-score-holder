import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // Type-only modules are checked by tsc and have no executable coverage to measure.
      exclude: ['src/types/**/*.ts', 'src/interfaces/**/*.ts'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
      thresholds: {
        perFile: true,
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
      },
    },
  },
});
