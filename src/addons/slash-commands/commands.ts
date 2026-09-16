import type { ChainedCommands } from '@tiptap/core'

export type SlashCommand = {
  id: string
  label: string
  description: string
  keywords: string
  markdown: string
  cursor?: number
  rich: (chain: ChainedCommands) => ChainedCommands
}

export const commands: SlashCommand[] = [
  {
    id: 'text',
    label: 'text',
    description: 'plain paragraph',
    keywords: 'paragraph normal',
    markdown: '',
    rich: (chain) => chain.setParagraph(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `heading-${level}`,
    label: `heading ${level}`,
    description:
      ['large heading', 'medium heading', 'small heading'][level - 1] ?? '',
    keywords: `h${level} title`,
    markdown: `${'#'.repeat(level)} `,
    rich: (chain: ChainedCommands) => chain.setHeading({ level }),
  })),
  {
    id: 'bullet-list',
    label: 'bullet list',
    description: 'unordered list',
    keywords: 'ul bullets',
    markdown: '- ',
    rich: (chain) => chain.toggleBulletList(),
  },
  {
    id: 'numbered-list',
    label: 'numbered list',
    description: 'ordered list',
    keywords: 'ol numbers',
    markdown: '1. ',
    rich: (chain) => chain.toggleOrderedList(),
  },
  {
    id: 'checklist',
    label: 'checklist',
    description: 'tasks with checkboxes',
    keywords: 'todo task list',
    markdown: '- [ ] ',
    rich: (chain) => chain.toggleTaskList(),
  },
  {
    id: 'quote',
    label: 'quote',
    description: 'blockquote',
    keywords: 'quotation',
    markdown: '> ',
    rich: (chain) => chain.toggleBlockquote(),
  },
  {
    id: 'code',
    label: 'code block',
    description: 'fenced code',
    keywords: 'codeblock pre',
    markdown: '```\n\n```',
    cursor: 4,
    rich: (chain) => chain.setCodeBlock(),
  },
  {
    id: 'divider',
    label: 'divider',
    description: 'horizontal rule',
    keywords: 'hr separator line',
    markdown: '---\n\n',
    rich: (chain) => chain.setHorizontalRule(),
  },
  {
    id: 'table',
    label: 'table',
    description: 'two columns with a header',
    keywords: 'grid columns',
    markdown: '| column 1 | column 2 |\n| --- | --- |\n|  |  |',
    cursor: 2,
    rich: (chain) =>
      chain.insertTable({ rows: 2, cols: 2, withHeaderRow: true }),
  },
]

/** Only a slash at a block boundary is a command, never a path or URL. */
export function slashQuery(text: string) {
  return /^\/([\p{L}\p{N} -]{0,48})$/u.exec(text)?.[1] ?? null
}

export function filterCommands(query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/)
  return commands.filter((command) =>
    terms.every((term) =>
      `${command.label} ${command.description} ${command.keywords}`.includes(
        term,
      ),
    ),
  )
}
