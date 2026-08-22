import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 180_000,
  },
})
