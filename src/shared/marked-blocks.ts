import { type MarkedExtension, marked, Tokenizer } from 'marked'

// Keep each parser's block grammar, but scan lines without a backtracking frame
// per character or continuation line. Equivalence tests guard the rule delimiters.
const setextRules = new WeakMap<RegExp, { start: RegExp; candidate: RegExp }>()
const paragraphRules = new WeakMap<RegExp, RegExp>()
// Tabs keep their physical columns when a list removes its content indent.
const containerColumns = new WeakMap<Tokenizer, number>()

// Candidate calls and source spans, including title interruption windows.
export const blockScanCounters = { calls: 0, units: 0 }

const tableTokenizer = new Tokenizer()
const tableLexer = new marked.Lexer({ gfm: true, tokenizer: tableTokenizer })
// Boundary validation only needs cell counts, so retain no pending inline work.
tableLexer.inline = () => []

function paragraphRule(pattern: RegExp) {
  let interrupt = paragraphRules.get(pattern)
  if (!interrupt) {
    const start = '^([^\\n]+(?:\\n(?!'
    const tail = ')[^\\n]+)*)'
    if (!pattern.source.startsWith(start) || !pattern.source.endsWith(tail))
      return
    interrupt = new RegExp(
      `^(?:${pattern.source.slice(start.length, -tail.length)})`,
    )
    paragraphRules.set(pattern, interrupt)
  }
  return interrupt
}

/** Reference titles cannot cross CommonMark paragraph boundaries. */
export function endsReferenceTitle(
  source: string,
  paragraph = marked.Lexer.rules.block.normal.paragraph,
) {
  blockScanCounters.calls++
  blockScanCounters.units += source.length
  if (
    /^[ \t]*(?:\r?\n|$)/.test(source) ||
    /^ {0,3}(?:=+|-+)[ \t]*(?:\r?\n|$)/.test(source)
  )
    return true
  if (!paragraphRule(paragraph)?.test(source)) return false
  if (
    paragraph !== marked.Lexer.rules.block.gfm.paragraph ||
    paragraphRule(marked.Lexer.rules.block.normal.paragraph)?.test(source)
  )
    return true
  // Match block precedence on container-relative text before checking cell counts.
  const end = source.indexOf('\n', source.indexOf('\n') + 1)
  const lines = end < 0 ? source : source.slice(0, end)
  return !tableTokenizer.code(lines) && !!tableTokenizer.table(lines)
}

export function lexMarkdown(source: string) {
  return marked.lexer(source, {
    ...marked.defaults,
    tokenizer: new BlockTokenizer(),
  })
}

export function parseMarkdown(source: string) {
  return marked.parse(source, {
    async: false,
    tokenizer: new BlockTokenizer(),
  })
}

export const blockMarkdown: MarkedExtension = {
  tokenizer: {
    list(source) {
      return BlockTokenizer.prototype.list.call(
        this,
        source,
        Object.getPrototypeOf(this).list,
      )
    },
    blockquote(source) {
      return BlockTokenizer.prototype.blockquote.call(
        this,
        source,
        Object.getPrototypeOf(this).blockquote,
      )
    },
    def(source) {
      return BlockTokenizer.prototype.def.call(
        this,
        source,
        Object.getPrototypeOf(this).def,
      )
    },
    lheading(source) {
      return BlockTokenizer.prototype.lheading.call(
        this,
        source,
        Object.getPrototypeOf(this).lheading,
      )
    },
    paragraph(source) {
      return BlockTokenizer.prototype.paragraph.call(
        this,
        source,
        Object.getPrototypeOf(this).paragraph,
      )
    },
  },
}

// Let upstream construct tokens, including its version-specific newline behavior.
function blockToken<Result>(
  tokenizer: Tokenizer,
  name: 'lheading' | 'paragraph',
  source: string,
  parts: [string, ...string[]],
  read: (source: string) => Result,
): Result {
  const match = Object.assign(parts, { index: 0, input: source })
  const rule = /(?:)/
  rule.exec = () => match
  const rules = tokenizer.rules
  tokenizer.rules = {
    ...rules,
    block: { ...rules.block, [name]: rule },
  }
  try {
    return read.call(tokenizer, source)
  } finally {
    tokenizer.rules = rules
  }
}

export class BlockTokenizer extends Tokenizer {
  override list(source: string, read = Tokenizer.prototype.list) {
    if (!this.rules.block.list.test(source)) return read.call(this, source)
    const rules = this.rules,
      columns: number[] = [],
      base = containerColumns.get(this) ?? 0
    this.rules = {
      ...rules,
      other: {
        ...rules.other,
        listItemRegex: (bullet) => {
          const rule = rules.other.listItemRegex(bullet),
            exec = rule.exec
          rule.exec = (text) => {
            const match = exec.call(rule, text)
            if (match) {
              let column = base + match[1]!.length
              for (const char of /^[ \t]*/.exec(match[2]!)![0])
                column += char === '\t' ? 4 - (column % 4) : 1
              const padding = column - base - match[1]!.length
              const indent = padding > 4 ? 1 : padding || 1
              columns.push(base + match[1]!.length + indent)
            }
            return match
          }
          return rule
        },
      },
    }
    const lexer = this.lexer,
      blockTokens = lexer.blockTokens
    let item = 0
    const nested: typeof blockTokens = (...args) => {
      this.rules = rules
      lexer.blockTokens = blockTokens
      containerColumns.set(this, columns[item++]!)
      try {
        return Reflect.apply(blockTokens, lexer, args)
      } finally {
        containerColumns.set(this, base)
        lexer.blockTokens = nested
      }
    }
    lexer.blockTokens = nested
    try {
      return read.call(this, source)
    } finally {
      this.rules = rules
      lexer.blockTokens = blockTokens
      containerColumns.set(this, base)
    }
  }

  override blockquote(source: string, read = Tokenizer.prototype.blockquote) {
    const match = this.rules.block.blockquote.exec(source)
    if (!match?.[0].includes('\t')) return read.call(this, source)
    const base = containerColumns.get(this) ?? 0
    let added = 0
    const offsets: [number, number][] = []
    // Expand indentation before stripping quote markers; leave body tabs alone.
    const text = match[0].replace(/^[ \t>]+/gm, (prefix, at: number) => {
      if (!prefix.includes('\t')) return prefix
      let column = base,
        indent = 0,
        expanded = ''
      for (let i = 0; i < prefix.length; i++) {
        const char = prefix[i]!
        const width = char === '\t' ? 4 - (column % 4) : 1
        expanded += char === '\t' ? ' '.repeat(width) : char
        column += width
        indent = char === '>' ? -1 : indent + width
        // Tabs after the code indent are literal code content.
        if (indent >= 4) {
          expanded += prefix.slice(i + 1)
          break
        }
      }
      if (expanded.length !== prefix.length) {
        added += expanded.length - prefix.length
        offsets.push([at + prefix.length + added, added])
      }
      return expanded
    })
    const token = read.call(this, text)
    if (token) {
      let extra = 0
      for (const [end, added] of offsets) {
        if (end > token.raw.length) break
        extra = added
      }
      // The outer lexer consumes original text, not expanded indentation.
      token.raw = source.slice(0, token.raw.length - extra)
    }
    return token
  }

  override def(source: string, read = Tokenizer.prototype.def) {
    let token = read.call(this, source)
    const title = token?.title && this.rules.block.def.exec(token.raw)?.[3]
    if (title && token) {
      const from = token.raw.lastIndexOf(title)
      let boundary = from + title.length
      // A definition can hold block syntax even inside a list's text context.
      const top = this.lexer.state.top
      this.lexer.state.top = true
      try {
        // Extension starts are candidates; only a real block ends the title.
        for (const start of this.options.extensions?.startBlock ?? []) {
          for (let offset = 0; offset < title.length; ) {
            const at = start.call({ lexer: this.lexer }, title.slice(offset))
            if (typeof at !== 'number' || at < 0) break
            offset += at
            if (
              this.options.extensions?.block?.some((read) =>
                read.call(
                  { lexer: this.lexer },
                  source.slice(from + offset),
                  [],
                ),
              )
            ) {
              boundary = Math.min(boundary, from + offset)
              break
            }
            offset++
          }
        }
      } finally {
        this.lexer.state.top = top
      }
      const line = source.lastIndexOf('\n', from - 1) + 1
      for (let at = line; at < boundary; ) {
        // Include the first title line and the delimiter after its closing line.
        // Only this line and the next can establish a table interruption.
        const end = source.indexOf('\n', at)
        const next = end < 0 ? -1 : source.indexOf('\n', end + 1)
        if (
          endsReferenceTitle(
            source.slice(at, next < 0 ? undefined : next),
            this.rules.block.paragraph,
          )
        ) {
          boundary = at
          break
        }
        if (end < 0) break
        at = end + 1
      }
      if (boundary < from + title.length)
        token = read.call(this, source.slice(0, boundary))
    }
    if (token && !token.title) {
      // The failed optional title still belongs to the definition's paragraph.
      const indent = /^\n[ \t]+(?=["'(])/.exec(source.slice(token.raw.length))
      if (indent) token.raw += indent[0]
    }
    return token
  }

  override lheading(source: string, read = Tokenizer.prototype.lheading) {
    const pattern = this.rules.block.lheading
    let rule = setextRules.get(pattern)
    if (!rule) {
      const [start, body] = pattern.source.split('((?:.|\\n(?!')
      if (!start || !body) return read.call(this, source)
      const [interrupt, underline] = body.split('))+?)\\n')
      if (!interrupt || !underline) return read.call(this, source)
      rule = {
        start: new RegExp(start),
        candidate: new RegExp(`\\n(?:(${underline})|${interrupt})`),
      }
      setextRules.set(pattern, rule)
    }
    if (!rule.start.test(source)) return
    // Stop at the first underline or interruption without a frame per character.
    blockScanCounters.calls++
    const candidate = rule.candidate.exec(source)
    blockScanCounters.units += candidate
      ? candidate.index + candidate[0].length
      : source.length
    if (!candidate?.[1] || !candidate.index) return
    blockScanCounters.units += candidate.index
    if (/[\r\u2028\u2029]/.test(source.slice(0, candidate.index))) return
    return blockToken(
      this,
      'lheading',
      source,
      [
        source.slice(0, candidate.index + candidate[0].length),
        source.slice(0, candidate.index),
        candidate[2] as string,
      ],
      read,
    )
  }

  override paragraph(source: string, read = Tokenizer.prototype.paragraph) {
    let end = source.indexOf('\n')
    // One physical line needs no repeated continuation match.
    if (end < 0) return read.call(this, source)
    if (!end) return
    const firstLine = end
    const interrupt = paragraphRule(this.rules.block.paragraph)
    if (!interrupt) return read.call(this, source)
    while (end < source.length) {
      const from = end + 1
      if (
        from === source.length ||
        source.charCodeAt(from) === 10 ||
        interrupt.test(source.slice(from))
      )
        break
      const newline = source.indexOf('\n', from)
      end = newline < 0 ? source.length : newline
    }
    if (end === firstLine) return read.call(this, source)
    const text = source.slice(0, end)
    return blockToken(this, 'paragraph', source, [text, text], read)
  }
}
