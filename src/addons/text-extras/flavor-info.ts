import type { MarkdownFlavor } from '../api'
import { detectTextExtras } from './syntax'

export const flavorInfo: MarkdownFlavor = {
  id: 'text-extras',
  name: 'text extras',
  kind: 'syntax',
  description: '~subscript~ and -# small text.',
  detect: detectTextExtras,
}
export default [flavorInfo]
