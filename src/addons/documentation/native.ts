import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NativeAddon } from '../api'
import manifest from './manifest'

export default {
  id: manifest.id,
  methods: {
    async export(_input, context) {
      const snapshot = await context.workspace.snapshot()
      const template = await readFile(
        join(import.meta.dirname, '../site/template.html'),
        'utf8',
      )
      const data = JSON.stringify(snapshot)
        .replaceAll('<', '\\u003c')
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029')
      const html = template.replace('__HIBI_WORKSPACE_DATA__', () => data)
      return context.exportHtml(
        html,
        `${snapshot.name}.html`,
        snapshot.pages.length,
      )
    },
  },
} satisfies NativeAddon
