export const HOTKEY_CHANNELS = {
  get: 'hotkeys:get',
  save: 'hotkeys:save',
  record: 'hotkeys:record',
  command: 'app:command',
} as const

export const actions = [
  { id: 'palette', label: 'command palette', category: 'app', key: 'k' },
  { id: 'new', label: 'new document', category: 'file', key: 'n' },
  { id: 'open', label: 'open document…', category: 'file', key: 'o' },
  { id: 'save', label: 'save document', category: 'file', key: 's' },
  { id: 'saveAs', label: 'save as…', category: 'file', key: 'shift+s' },
  { id: 'find', label: 'find in note', category: 'edit', key: 'f' },
  { id: 'settings', label: 'open settings', category: 'preferences', key: ',' },
  { id: 'normal', label: 'normal view', category: 'view', key: '' },
  { id: 'side-by-side', label: 'side-by-side view', category: 'view', key: '' },
  { id: 'markdown', label: 'markdown only', category: 'view', key: '' },
  {
    id: 'toggle-titlebar',
    label: 'toggle top bar auto-hide',
    category: 'appearance',
    key: '',
  },
] as const

export type AppCommand = (typeof actions)[number]['id']
export type Hotkeys = Record<AppCommand, string>

export function defaultHotkeys(platform: string): Hotkeys {
  const modifier = platform === 'darwin' ? 'meta' : 'ctrl'
  return Object.fromEntries(
    actions.map(({ id, key }) => [id, key ? `${modifier}+${key}` : '']),
  ) as Hotkeys
}

const modifiers = ['ctrl', 'meta', 'alt', 'shift']
const punctuation: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Space: 'space',
}
const specialKeys = [
  'space',
  'enter',
  'tab',
  'backspace',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]

export function shortcutFromEvent(event: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string {
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(5)
      : (punctuation[event.code] ?? event.key.toLowerCase())
  if (!isKey(key)) return ''
  return [
    event.ctrlKey && 'ctrl',
    event.metaKey && 'meta',
    event.altKey && 'alt',
    event.shiftKey && 'shift',
    key,
  ]
    .filter(Boolean)
    .join('+')
}

function isKey(key: string): boolean {
  return (
    /^[a-z0-9,./;'[\]\\`=-]$/.test(key) ||
    /^f([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    specialKeys.includes(key)
  )
}

export function shortcutError(
  shortcut: string,
  platform: string,
): string | null {
  if (!shortcut) return null
  const parts = shortcut.split('+')
  const key = parts.pop() ?? ''
  if (
    !isKey(key) ||
    parts.join('+') !==
      modifiers.filter((modifier) => parts.includes(modifier)).join('+')
  )
    return 'unsupported shortcut.'
  if (!parts.some((part) => part !== 'shift') && !/^f\d+$/.test(key))
    return `include ${platform === 'darwin' ? 'command, control, or option' : 'ctrl or alt'}, or use a function key.`
  const mod = platform === 'darwin' ? 'meta' : 'ctrl'
  const reserved = [
    'a',
    'c',
    'v',
    'x',
    'z',
    'shift+z',
    'shift+v',
    'y',
    'q',
    'w',
    'h',
    'm',
    'r',
    'shift+r',
    'shift+i',
    '0',
    '-',
    '=',
    'shift+=',
  ].map((key) => `${mod}+${key}`)
  if (
    reserved.includes(shortcut) ||
    ['alt+f4', 'ctrl+alt+delete', 'ctrl+meta+f', 'meta+alt+h'].includes(
      shortcut,
    )
  )
    return 'reserved for editing or window controls.'
  return null
}

export function validateHotkeys(value: unknown, platform: string): Hotkeys {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== actions.length
  )
    throw new Error('invalid hotkey settings.')
  const result = {} as Hotkeys
  const used = new Set<string>()
  for (const { id } of actions) {
    const shortcut = (value as Record<string, unknown>)[id]
    if (typeof shortcut !== 'string' || shortcut.length > 60)
      throw new Error('invalid shortcut.')
    const error = shortcutError(shortcut, platform)
    if (error) throw new Error(error)
    if (shortcut && used.has(shortcut))
      throw new Error('shortcut already assigned.')
    if (shortcut) used.add(shortcut)
    result[id] = shortcut
  }
  return result
}

export function accelerator(shortcut: string): string {
  const keys: Record<string, string> = {
    meta: 'Super',
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
  }
  return shortcut
    ? shortcut
        .split('+')
        .map((key) => keys[key] ?? key)
        .join('+')
    : ''
}

export function shortcutLabels(shortcut: string, platform: string): string[] {
  const keys: Record<string, string> =
    platform === 'darwin'
      ? { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
      : { meta: 'win', ctrl: 'ctrl', alt: 'alt', shift: 'shift' }
  return shortcut
    .split('+')
    .filter(Boolean)
    .map(
      (key) =>
        keys[key] ??
        {
          arrowup: '↑',
          arrowdown: '↓',
          arrowleft: '←',
          arrowright: '→',
          enter: '↵',
        }[key] ??
        key,
    )
}
