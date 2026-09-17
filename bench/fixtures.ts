import type { WorkspacePage } from '../src/shared/workspace.ts'

/** Deterministic pseudo-random source so every run measures identical work. */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const words = [
  'hibi',
  'workspace',
  'markdown',
  'editor',
  'addon',
  'colorscheme',
  'sidebar',
  'document',
  'renderer',
  'typst',
  'graph',
  'tag',
]

function sentence(next: () => number, length: number) {
  return Array.from(
    { length },
    () => words[Math.floor(next() * words.length)] as string,
  ).join(' ')
}

/** A note using every syntax the editor and export pipeline have to handle. */
export function note(seed: number, paragraphs = 12) {
  const next = random(seed)
  const lines = [
    `# ${sentence(next, 4)}`,
    '',
    `Some **bold** and *italic* prose with \`inline code\`, a [local link](../notes/note-${seed % 40}.md), and a #project/${words[seed % words.length]} tag.`,
    '',
  ]
  for (let index = 0; index < paragraphs; index++) {
    lines.push(`## ${sentence(next, 3)}`, '')
    lines.push(sentence(next, 30), '')
    lines.push(
      `> [!NOTE]`,
      `> ${sentence(next, 12)} with a [reference](../guides/note-${index * 4 + 1}.md).`,
      '',
    )
    lines.push(
      `- ${sentence(next, 6)}`,
      `- ${sentence(next, 6)}`,
      `- [ ] ${sentence(next, 6)}`,
      '',
    )
    lines.push('| column | value |', '| --- | --- |')
    for (let row = 0; row < 3; row++)
      lines.push(`| ${sentence(next, 2)} | ${Math.floor(next() * 1000)} |`)
    lines.push('')
    lines.push(
      '```ts',
      `const total = ${index} + ${Math.floor(next() * 10)}`,
      '```',
      '',
    )
    lines.push(`Inline math $E_{${index}} = mc^2$ and a block:`, '')
    lines.push('$$', `\\sum_{i=0}^{${index}} i^2`, '$$', '')
    lines.push(
      '~~~typst',
      `#set text(size: ${8 + index}pt)`,
      '= Heading',
      '~~~',
      '',
    )
    lines.push(`-# ${sentence(next, 5)}`, '')
  }
  return lines.join('\n')
}

export function noteWithFrontmatter(seed: number, paragraphs = 12) {
  return [
    '---',
    `title: ${sentence(random(seed), 4)}`,
    'tags:',
    '  - notes',
    '  - hibi',
    'draft: false',
    `updated: 2026-01-0${(seed % 9) + 1}`,
    '---',
    '',
    note(seed, paragraphs),
  ].join('\n')
}

/** A workspace shaped like a real vault: nested folders and cross links. */
export function workspace(count: number, paragraphs = 4): WorkspacePage[] {
  const folders = ['notes', 'guides', 'journal', 'archive']
  return Array.from({ length: count }, (_, index) => {
    const folder = folders[index % folders.length] as string
    return {
      path: `${folder}/note-${index}.md`,
      markdown: noteWithFrontmatter(index, paragraphs),
    }
  })
}
