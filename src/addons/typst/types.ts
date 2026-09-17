export type TypstResult = {
  svg?: string
  pages?: number
  diagnostics: { message: string; severity: 'error' | 'warning' }[]
}
