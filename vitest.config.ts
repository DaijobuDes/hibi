import codspeed from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Benchmarks cover pure logic only; the Electron suites stay on `npm test`.
export default defineConfig({
  plugins: [codspeed()],
  test: {
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
})
