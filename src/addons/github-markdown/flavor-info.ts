import { Marked } from 'marked'
import type { MarkdownFlavor } from '../api'
import { alertMarker } from './alerts'

const parser = new Marked({ gfm: true })
export const flavorInfo: MarkdownFlavor = {
  id: 'github',
  name: 'github markdown',
  kind: 'dialect',
  description:
    'Alerts, tables, task lists, strikethrough, and automatic links.',
  detect(source) {
    let found = false
    parser.walkTokens(parser.lexer(source), (token) => {
      if (
        token.type === 'table' ||
        token.type === 'del' ||
        (token.type === 'blockquote' && alertMarker(token.text)) ||
        (token.type === 'list_item' && token.task) ||
        (token.type === 'link' && !token.raw.startsWith('['))
      )
        found = true
    })
    return found
  },
}
export default [flavorInfo]
