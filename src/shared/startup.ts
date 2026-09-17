/** Process-local checkpoints; static imports precede the entrypoint checkpoint. */
export function startupMark(name: string) {
  const key = `hibi:${name}`
  if (!performance.getEntriesByName(key).length) performance.mark(key)
}

export async function startupSpan(name: string, load: () => Promise<void>) {
  const start = performance.now()
  try {
    await load()
  } finally {
    performance.measure(`hibi:${name}`, { start, end: performance.now() })
  }
}
