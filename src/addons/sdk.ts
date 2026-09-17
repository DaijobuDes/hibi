/** Runtime dependencies shared with explicitly installed renderer extensions. */
import * as commands from '@codemirror/commands'
import * as language from '@codemirror/language'
import * as state from '@codemirror/state'
import * as view from '@codemirror/view'
import * as highlight from '@lezer/highlight'
import * as tiptap from '@tiptap/core'
import { Marked } from 'marked'
import * as React from 'react'
import type { Addon } from './api'
import * as ui from './ui'

export const sdk = {
  React,
  ui,
  tiptap,
  codeMirror: { commands, state, view, language, highlight },
  markdown: { Marked },
}
/** Export this factory as the default export of a package's compiled ES module. */
export type SideloadFactory = (host: typeof sdk) => Omit<Addon, 'manifest'>
