/**
 * Inline code spans by CommonMark rules: a backtick run opens a span that the
 * next run of the same length closes. A backslash before an opening run
 * escapes its first backtick; inside a span backslashes are literal, so they
 * never stop a closing run. An opener with no closer is literal text.
 */
function scan(text: string) {
  const runs = [...text.matchAll(/`+/g)].map((match) => {
    let slashes = 0
    while (text[match.index - 1 - slashes] === '\\') slashes++
    return {
      start: match.index,
      length: match[0].length,
      escaped: !!(slashes % 2),
    }
  })
  const spans: [number, number][] = []
  let unmatched = false
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]
    const start = run.start + Number(run.escaped)
    const length = run.length - Number(run.escaped)
    if (!length) continue
    const close = runs.findIndex(
      (other, later) => later > index && other.length === length,
    )
    if (close === -1) {
      unmatched = true
      continue
    }
    spans.push([start, runs[close].start + length])
    index = close
  }
  return { spans, unmatched }
}

/** Closed code spans in `text` as `[start, end)` offsets, backticks included. */
export function codeSpanRanges(text: string): readonly [number, number][] {
  return scan(text).spans
}

/**
 * True when a backtick run before `offset` is not closed before it: the
 * offset is inside a code span, or code is still being typed. An opener that
 * never closes later is literal in CommonMark but still counts here.
 */
export function openCodeSpanAt(text: string, offset: number): boolean {
  return scan(text.slice(0, offset)).unmatched
}
