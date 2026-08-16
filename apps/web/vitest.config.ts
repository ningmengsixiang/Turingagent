import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true, // @testing-library/react 自动 cleanup 依赖全局 afterEach
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
