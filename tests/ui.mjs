/** Match UI labels in either presentation without weakening content assertions. */
export function uiName(value, exact = false) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${exact ? '^' : ''}${escaped}${exact ? '$' : ''}`, 'i')
}
