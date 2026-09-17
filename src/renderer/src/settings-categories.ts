import {
  Code,
  File,
  FileText,
  Keyboard,
  PanelTop,
  Puzzle,
  TextCursorInput,
} from 'lucide-react'

export const settingsCategories = [
  { id: 'hibi', label: 'Hibi', icon: File },
  { id: 'editor', label: 'Editor', icon: FileText },
  { id: 'formats', label: 'Formats', icon: FileText },
  { id: 'syntax', label: 'Syntax', icon: TextCursorInput },
  { id: 'code-syntax', label: 'Code highlighting', icon: Code },
  { id: 'appearance', label: 'Appearance', icon: PanelTop },
  { id: 'hotkeys', label: 'Hotkeys', icon: Keyboard },
  { id: 'addons', label: 'Addons', icon: Puzzle },
] as const
