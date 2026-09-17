import type { Token } from 'marked'
import type { MarkdownSyntaxFeature } from '../../shared/markdown-syntax'

const core: MarkdownSyntaxFeature[] = [
  ...Array.from(
    { length: 6 },
    (_, index): MarkdownSyntaxFeature => ({
      id: `heading-${index + 1}`,
      label: `heading ${index + 1}`,
      group: 'headings',
      description: `${'#'.repeat(index + 1)} heading`,
      level: 'block',
      extensions: ['heading'],
      matches: (token) => token.type === 'heading' && token.depth === index + 1,
    }),
  ),
  {
    id: 'bold',
    label: 'bold',
    group: 'text',
    description: '**bold**',
    level: 'inline',
    extensions: ['bold'],
    matches: (token) => token.type === 'strong',
  },
  {
    id: 'italic',
    label: 'italic',
    group: 'text',
    description: '*italic*',
    level: 'inline',
    extensions: ['italic'],
    matches: (token) => token.type === 'em',
  },
  {
    id: 'inline-code',
    label: 'inline code',
    group: 'text',
    description: '`code`',
    level: 'inline',
    extensions: ['code'],
    matches: (token) => token.type === 'codespan',
  },
  {
    id: 'escapes',
    label: 'escaped punctuation',
    group: 'text',
    description: 'backslash escapes such as \\*.',
    level: 'inline',
    matches: (token) => token.type === 'escape',
  },
  {
    id: 'code-blocks',
    label: 'code blocks',
    group: 'blocks',
    description: 'fenced and indented code.',
    level: 'block',
    extensions: ['codeBlock'],
    matches: (token) => token.type === 'code',
  },
  {
    id: 'quotes',
    label: 'quotes',
    group: 'blocks',
    description: '> quote',
    level: 'block',
    extensions: ['blockquote'],
    matches: (token) => token.type === 'blockquote',
  },
  {
    id: 'bullet-lists',
    label: 'bullet lists',
    group: 'blocks',
    description: '- item',
    level: 'block',
    extensions: ['bulletList'],
    matches: (token) =>
      token.type === 'list' &&
      !token.ordered &&
      !token.items.some((item: { task?: boolean }) => item.task),
  },
  {
    id: 'numbered-lists',
    label: 'numbered lists',
    group: 'blocks',
    description: '1. item',
    level: 'block',
    extensions: ['orderedList'],
    matches: (token) =>
      token.type === 'list' &&
      token.ordered &&
      !token.items.some((item: { task?: boolean }) => item.task),
  },
  {
    id: 'dividers',
    label: 'dividers',
    group: 'blocks',
    description: '---, ***, or ___.',
    level: 'block',
    extensions: ['horizontalRule'],
    matches: (token) => token.type === 'hr',
  },
  {
    id: 'line-breaks',
    label: 'line breaks',
    group: 'blocks',
    description: 'two trailing spaces or a backslash before a newline.',
    level: 'inline',
    extensions: ['hardBreak'],
    matches: (token) => token.type === 'br',
  },
  {
    id: 'links',
    label: 'links',
    group: 'links and media',
    description: 'markdown links and automatic links.',
    level: 'inline',
    extensions: ['link'],
    matches: (token) => token.type === 'link',
  },
  {
    id: 'images',
    label: 'images and video',
    group: 'links and media',
    description: '![description](path)',
    level: 'inline',
    extensions: ['image'],
    matches: (token) => token.type === 'image',
  },
  {
    id: 'html-blocks',
    label: 'html blocks',
    group: 'html',
    description: 'sanitized html in exports; rich editing remains protected.',
    level: 'block',
    matches: (token) => token.type === 'html' && !!token.block,
  },
  {
    id: 'inline-html',
    label: 'inline html',
    group: 'html',
    description: 'sanitized inline html in exports.',
    level: 'inline',
    matches: (token) => token.type === 'html' && !token.block,
  },
]
type Entry = MarkdownSyntaxFeature & { owner: string; enabled: boolean }
const registry = new Map<string, MarkdownSyntaxFeature & { owner: string }>(
  core.map((feature) => [
    `core.${feature.id}`,
    { ...feature, id: `core.${feature.id}`, owner: 'core' },
  ]),
)
const disabled = new Set<string>()
try {
  const stored: unknown = JSON.parse(
    localStorage.getItem('hibi:markdown-syntax-disabled') ?? '[]',
  )
  if (Array.isArray(stored))
    for (const id of stored) if (typeof id === 'string') disabled.add(id)
} catch {
  /* Use enabled defaults when preferences are unavailable. */
}
const listeners = new Set<() => void>()
let snapshot: readonly Entry[] = [],
  disabledFeatures: readonly Entry[] = [],
  version = 0
function publish() {
  snapshot = [...registry.values()].map((feature) => ({
    ...feature,
    enabled: !disabled.has(feature.id),
  }))
  disabledFeatures = snapshot.filter((feature) => !feature.enabled)
  version++
  for (const listener of listeners) listener()
}
publish()
function savePreferences() {
  try {
    localStorage.setItem(
      'hibi:markdown-syntax-disabled',
      JSON.stringify([...disabled]),
    )
  } catch {
    /* Session preferences still apply. */
  }
  publish()
}
export const markdownSyntax = {
  snapshot: () => snapshot,
  version: () => version,
  enabled: (id: string) => !disabled.has(id),
  extensionEnabled(name: string) {
    const owners = snapshot.filter((feature) =>
      feature.extensions?.includes(name),
    )
    return !owners.length || owners.some((feature) => feature.enabled)
  },
  disabledFeature(token: Token) {
    return disabledFeatures.find((feature) => {
      try {
        return feature.matches(token)
      } catch (error) {
        console.error(`syntax matcher failed: ${feature.id}`, error)
        return false
      }
    })
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  setEnabled(id: string, enabled: boolean) {
    if (!registry.has(id) || enabled === !disabled.has(id)) return
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    savePreferences()
  },
  reset() {
    disabled.clear()
    savePreferences()
  },
  register(owner: string, feature: MarkdownSyntaxFeature) {
    const id = `${owner}.${feature.id}`
    if (
      !/^[a-z][a-z0-9-]*$/.test(feature.id) ||
      registry.has(id) ||
      typeof feature.label !== 'string' ||
      !feature.label ||
      typeof feature.group !== 'string' ||
      !feature.group ||
      !['block', 'inline'].includes(feature.level) ||
      typeof feature.matches !== 'function' ||
      (feature.extensions !== undefined &&
        (!Array.isArray(feature.extensions) ||
          feature.extensions.some((name) => typeof name !== 'string')))
    )
      throw new Error('invalid or duplicate markdown syntax feature.')
    const entry = {
      ...feature,
      id,
      owner,
      extensions: [...(feature.extensions ?? [])],
    }
    registry.set(id, entry)
    publish()
    return () => {
      if (registry.get(id) === entry) {
        registry.delete(id)
        publish()
      }
    }
  },
}
