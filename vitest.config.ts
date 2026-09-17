import codspeed from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Native flows use Tinybench's per-round setup/cleanup outside the measured interval.
export default defineConfig({
  plugins: [codspeed()],
  test: {
    maxWorkers: 1,
    fileParallelism: false,
    benchmark: { include: ['bench/core/**/*.bench.ts'] },
  },
})
