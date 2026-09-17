import { Marked } from 'marked'
import { bench, describe } from 'vitest'
import {
  alertMarkdown,
  alertToken,
} from '../src/addons/github-markdown/alerts.ts'
import {
  blockMath,
  inlineMath,
  mathFlavor,
  mathTokens,
} from '../src/addons/math/syntax.ts'
import { textExtrasMarkdown } from '../src/addons/text-extras/syntax.ts'
import {
  typstBlock,
  typstFlavor,
  typstTokens,
} from '../src/addons/typst/syntax.ts'
import { note } from './fixtures.ts'

// Parsing runs on every keystroke in the rich editor and once per page on export,
// so the flavor pipeline is the hottest Markdown path in the app.
const flavored = new Marked(
  { gfm: true },
  alertMarkdown,
  mathTokens,
  textExtrasMarkdown,
  typstTokens,
)
// Only flavors with renderers take part in the exported HTML.
const exported = new Marked({ gfm: true }, alertMarkdown, textExtrasMarkdown)
const plain = new Marked({ gfm: true })
const document = note(7)
const short = note(11, 1)

describe('markdown', () => {
  bench('lex a note with the core parser', () => {
    plain.lexer(document)
  })

  bench('lex a note with every flavor enabled', () => {
    flavored.lexer(document)
  })

  bench('render a note to html', () => {
    exported.parse(document)
  })

  bench('walk the tokens of a small note', () => {
    flavored.walkTokens(flavored.lexer(short), () => {})
  })
})

describe('markdown flavor detection', () => {
  bench('detect math', () => {
    mathFlavor.detect(document)
  })

  bench('detect typst blocks', () => {
    typstFlavor.detect(document)
  })
})

describe('markdown tokenizers', () => {
  const alert = '> [!WARNING]\n> careful with this one\n> and the next line\n'
  const math = '$$\n\\sum_{i=0}^{10} i^2\n$$\n'
  const typst = '~~~typst\n#set text(size: 10pt)\n= Heading\n~~~\n'

  bench('github alert tokenizer', () => {
    alertToken(alert)
  })

  bench('block math tokenizer', () => {
    blockMath(math)
  })

  bench('inline math tokenizer', () => {
    inlineMath('$E = mc^2$ trailing text')
  })

  bench('typst block tokenizer', () => {
    typstBlock(typst)
  })
})
