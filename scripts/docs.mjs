import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

const references = [
  [
    'docs/reference/sideload-sdk.md',
    'sideload sdk',
    'src/addons/sdk.ts',
    (source) => source,
  ],
  [
    'docs/reference/menu-api.md',
    'menu api',
    'src/ui/menus.ts',
    (source) => source,
  ],
  [
    'docs/reference/toolbar-api.md',
    'toolbar api',
    'src/ui/toolbar.ts',
    (source) => source,
  ],
  [
    'docs/reference/tooltip-api.md',
    'tooltip api',
    'src/ui/tooltips.ts',
    (source) => source,
  ],
  [
    'docs/reference/colorscheme-api.md',
    'colorscheme api',
    'src/shared/colorschemes.ts',
    (source) => source,
  ],
  [
    'docs/reference/dialog-api.md',
    'dialog api',
    'src/ui/dialogs.ts',
    (source) => source,
  ],
  [
    'docs/reference/modal-api.md',
    'shared modal component',
    'src/ui/Modal.tsx',
    (source) => source,
    'tsx',
  ],
  [
    'docs/reference/controls-api.md',
    'shared controls',
    'src/ui/Controls.tsx',
    (source) => source,
    'tsx',
  ],
  [
    'docs/reference/authors.md',
    'plugin authors',
    'src/addons/authors.ts',
    (source) => source,
  ],
  [
    'docs/reference/theme-tokens.md',
    'theme tokens',
    'src/ui/tokens.css',
    (source) => source,
    'css',
  ],
  [
    'docs/reference/addon-api.md',
    'addon api',
    'src/addons/api.ts',
    (source) => source,
  ],
  [
    'docs/reference/workspace-api.md',
    'workspace types',
    'src/shared/workspace.ts',
    (source) => source,
  ],
  [
    'docs/reference/sidebar-api.md',
    'shared sidebar api',
    'src/ui/Sidebar.tsx',
    (source) =>
      source.slice(
        source.indexOf('export type SidebarItem'),
        source.indexOf('function RenameInput'),
      ),
  ],
]
async function generate() {
  let stale = false
  for (const [
    output,
    title,
    input,
    select,
    language = 'typescript',
  ] of references) {
    const source = select(await readFile(input, 'utf8')).trim()
    const expected = `# ${title}\n\ngenerated from \`${input}\`. update the source, then run \`npm run docs\`. \`npm run docs:check\` rejects stale references.\n\n\`\`\`${language}\n${source}\n\`\`\`\n`
    if (process.argv.includes('--check')) {
      const current = await readFile(output, 'utf8').catch(() => '')
      if (current !== expected) {
        console.error(`outdated documentation: ${output}`)
        stale = true
      }
    } else {
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, expected)
    }
  }
  process.exitCode = stale ? 1 : 0
}

await generate()
if (process.argv.includes('--watch')) {
  let timer
  const watchers = [
    ...new Set(references.map(([, , input]) => dirname(input))),
  ].map((directory) =>
    watch(directory, (_event, filename) => {
      if (
        !references.some(
          ([, , input]) =>
            dirname(input) === directory && basename(input) === filename,
        )
      )
        return
      clearTimeout(timer)
      timer = setTimeout(() => {
        void generate().catch(console.error)
      }, 40)
    }),
  )
  const stop = () => {
    clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

import { watch } from 'node:fs'
