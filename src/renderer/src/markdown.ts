import { Extension } from '@tiptap/core'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown, type MarkdownExtensionOptions } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { Marked, marked } from 'marked'
import { search } from 'prosemirror-search'
import type {
  MarkdownExtension,
  MarkdownFlavor,
  MarkdownProjection,
} from '../../addons/api'
import { readFrontmatter } from '../../shared/frontmatter'
import { BlockExit } from './BlockExit'
import { CodeHighlight } from './CodeHighlight'
import { literalMarkdown } from './LiteralMarkdown'
import { markdownSyntax } from './markdown-syntax'
import { installSyntaxPreferences } from './syntax-parser'

export function projectMarkdown(
  source: string,
  adapters: readonly MarkdownExtension[],
): MarkdownProjection {
  let result: MarkdownProjection = {
    content: source,
    serialize: (content) => content,
  }
  for (const adapter of adapters) {
    const next = adapter.parse(result.content)
    if (!next) continue
    const previous = result
    result = {
      content: next.content,
      serialize: (content) => previous.serialize(next.serialize(content)),
      readOnly: Boolean(previous.readOnly || next.readOnly),
    }
  }
  return result
}

export function editorExtensions(flavors: readonly MarkdownFlavor[]) {
  const options = Object.assign(
    { gfm: false, breaks: false },
    ...flavors.map((flavor) => flavor.markedOptions),
  )
  // Tiptap types this as the callable singleton, but its manager uses the
  // instance methods. A separate parser prevents disabled syntax leaking in.
  const configured = installSyntaxPreferences(new Marked(options))
  for (const flavor of flavors)
    for (const extension of flavor.export?.extensions ?? [])
      configured.use(extension)
  const parser = configured as unknown as NonNullable<
    MarkdownExtensionOptions['marked']
  >
  const enabled = (id: string) => markdownSyntax.enabled(`core.${id}`)
  const levels = ([1, 2, 3, 4, 5, 6] as const).filter((level) =>
    enabled(`heading-${level}`),
  )
  return [
    Extension.create({
      name: 'findInNote',
      addProseMirrorPlugins: () => [search()],
    }),
    StarterKit.configure({
      strike: false,
      underline: false,
      trailingNode: false,
      bold: enabled('bold') ? {} : false,
      italic: enabled('italic') ? {} : false,
      code: enabled('inline-code') ? {} : false,
      codeBlock: enabled('code-blocks') ? {} : false,
      blockquote: enabled('quotes') ? {} : false,
      bulletList: enabled('bullet-lists') ? {} : false,
      orderedList: enabled('numbered-lists') ? {} : false,
      horizontalRule: enabled('dividers') ? {} : false,
      hardBreak: enabled('line-breaks') ? {} : false,
      heading: levels.length ? { levels } : false,
      link: enabled('links') ? { openOnClick: false } : false,
    }),
    ...literalMarkdown,
    Markdown.configure({ marked: parser, markedOptions: options }),
    CodeHighlight,
    BlockExit,
    ...flavors
      .flatMap((flavor) => flavor.richExtensions ?? [])
      .filter((extension) => markdownSyntax.extensionEnabled(extension.name)),
    Placeholder.configure({ placeholder: 'start typing' }),
  ]
}

// Preserve source constructs the rich editor cannot round-trip without loss.
export function needsSourceEditing(source: string): boolean {
  if (readFrontmatter(source) || /^\s{0,3}\[[^\]]+\]:/m.test(source))
    return true
  let unsupported = false
  marked.walkTokens(marked.lexer(source), (token) => {
    if (
      token.type === 'def' ||
      (token.type === 'html' && !/^<br\s*\/?>$/i.test(token.raw.trim()))
    )
      unsupported = true
  })
  return unsupported
}
