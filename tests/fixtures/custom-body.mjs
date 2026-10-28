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
