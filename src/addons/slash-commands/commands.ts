import type { ChainedCommands } from '@tiptap/core'
import type { AddonContext } from '../api'

type BlockCommand = {
  id: string
  label: string
  description: string
  keywords: string
  markdown: string
  cursor?: number
  rich: (chain: ChainedCommands) => ChainedCommands
}

export type SlashCommand =
  | BlockCommand
  | {
      id: string
      label: string
      description: string
      keywords: string
      transform: (source: string) => string | null
    }

export const commands: BlockCommand[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Plain paragraph',
    keywords: 'paragraph normal',
    markdown: '',
    rich: (chain) => chain.setParagraph(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `heading-${level}`,
    label: `Heading ${level}`,
    description:
      ['large heading', 'medium heading', 'small heading'][level - 1] ?? '',
    keywords: `h${level} title`,
    markdown: `${'#'.repeat(level)} `,
    rich: (chain: ChainedCommands) => chain.setHeading({ level }),
  })),
  {
    id: 'bullet-list',
    label: 'Bullet list',
    description: 'Unordered list',
    keywords: 'ul bullets',
    markdown: '- ',
    rich: (chain) => chain.toggleBulletList(),
  },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    description: 'Ordered list',
    keywords: 'ol numbers',
    markdown: '1. ',
    rich: (chain) => chain.toggleOrderedList(),
  },
  {
    id: 'checklist',
    label: 'Checklist',
    description: 'Tasks with checkboxes',
    keywords: 'todo task list',
    markdown: '- [ ] ',
    rich: (chain) => chain.toggleTaskList(),
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Blockquote',
    keywords: 'quotation',
    markdown: '> ',
    rich: (chain) => chain.toggleBlockquote(),
  },
  {
    id: 'code',
    label: 'Code block',
    description: 'Fenced code',
    keywords: 'codeblock pre',
    markdown: '```\n\n```',
    cursor: 4,
    rich: (chain) => chain.setCodeBlock(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Horizontal rule',
    keywords: 'hr separator line',
    markdown: '---\n\n',
    rich: (chain) => chain.setHorizontalRule(),
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Two columns with a header',
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

export function filterCommands(query: string, context: AddonContext) {
  const terms = query.toLowerCase().trim().split(/\s+/)
  const available: SlashCommand[] = [
    ...commands,
    ...context.commands
      .getSlashCommands()
      .map((command) => ({ ...command, keywords: command.keywords ?? '' })),
  ]
  return available.filter((command) =>
    terms.every((term) =>
      `${command.label} ${command.description} ${command.keywords}`
        .toLowerCase()
        .includes(term),
    ),
  )
}
