export const customBodyCases = [
  [
    'alert italic',
    'core.italic',
    'Emphasis',
    '> [!TIP]\n> *careful*',
    '\ncareful',
  ],
  [
    'subtext italic',
    'core.italic',
    'Emphasis',
    '-# small *words*',
    'small words',
  ],
  [
    'alert strike',
    'markdown.strike',
    'Strikethrough',
    '> [!TIP]\n> ~~gone~~',
    '\ngone',
  ],
  [
    'subtext strike',
    'markdown.strike',
    'Strikethrough',
    '-# small ~~words~~',
    'small words',
  ],
  [
    'alert link',
    'core.links',
    'Link',
    '> [!TIP]\n> [a](https://b.test)',
    '\na',
  ],
  [
    'subtext link',
    'core.links',
    'Link',
    '-# small [a](https://b.test)',
    'small a',
  ],
  [
    'alert autolink',
    'core.links',
    'Autolink',
    '> [!TIP]\n> <https://b.test>',
    '\nhttps://b.test',
  ],
  [
    'subtext url',
    'core.links',
    'URL',
    '-# small https://b.test',
    'small https://b.test',
  ],
  [
    'alert heading',
    'core.heading-1',
    'ATXHeading1',
    '> [!TIP]\n> # head',
    '\nhead',
  ],
  ['subscript bold', 'core.bold', 'StrongEmphasis', 'H~**2**~O', 'H2O'],
  [
    'alert task',
    'core.bold',
    'StrongEmphasis',
    '> [!TIP]\n> - [ ] **x** y',
    '\n\n\nx y',
  ],
  ['bullet alert', '', '', '- > [!TIP]\n  > **x** y', '\n\n**x** y'],
  ['ordered alert', '', '', '1. > [!TIP]\n   > **x** y', '\n\n\n\n\n\nx y'],
  [
    'continued ordered alert',
    'core.bold',
    'StrongEmphasis',
    '1. before\n\n   > [!TIP]\n   > **x** y',
    '\n\nbefore\n\nx y',
    'before\ntip\nx y',
  ],
  [
    'continued bullet alert',
    'core.bold',
    'StrongEmphasis',
    '- before\n\n  > [!TIP]\n  > **x** y',
    '\n\nbefore\n**x** y',
    'before\ntip\n**x** y',
  ],
].map(([name, feature, literal, source, text, rendered]) => ({
  name,
  feature,
  literal,
  source,
  text,
  rendered,
}))

const marks = [
  ['bold', '**x**', 'x'],
  ['emphasis', '*a **x** b*', 'a x b'],
  ['link', '[a **x**](/u)', 'a x'],
  ['strike', '~~a **x**~~', 'a x'],
]
const containers = [
  ['bullet', (text) => `> [!TIP]\n> - ${text} y`, (text) => `\n\n\n${text} y`],
  [
    'ordered',
    (text) => `> [!TIP]\n> 1. ${text} y`,
    (text) => `\n\n\n${text} y`,
  ],
  [
    'quoted alert in list',
    (text) => `- > > [!TIP]\n  > > ${text} y`,
    (text) => `\n\n\n\n${text} y`,
  ],
  [
    'table',
    (text) => `> [!TIP]\n> | h |\n> |---|\n> | ${text} |`,
    (text) => `\n\n\n\nh\n\n\n${text}`,
  ],
]

export const customBodyBoldCases = containers.flatMap(
  ([container, source, text]) =>
    marks.map(([mark, markdown, plain]) => ({
      name: `${container} / ${mark}`,
      source: source(markdown),
      text: text(plain),
    })),
)
