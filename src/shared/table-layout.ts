export const TABLE_LAYOUT_CHANNELS = {
  read: 'table-layout:read',
  write: 'table-layout:write',
} as const

/** Sizes in CSS pixels; 0 keeps a column or row at its automatic size. */
export type TableLayout = {
  /** Table ordinal and a fingerprint of its header row. */
  key: string
  columns: number[] | null
  rows: number[] | null
}
