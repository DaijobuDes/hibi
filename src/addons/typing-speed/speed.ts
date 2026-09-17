export function typingSpeed() {
  let started: number | null = null
  let last = 0
  let count = 0
  const expire = (time: number) => {
    if (started !== null && time - last >= 5000) {
      started = null
      count = 0
    }
  }
  return {
    add(characters: number, time: number) {
      expire(time)
      started ??= time
      last = time
      count += characters
    },
    read(time: number) {
      expire(time)
      const elapsed = started === null ? 1000 : Math.max(1000, last - started)
      const cpm = Math.round((count * 60000) / elapsed)
      return { cpm, wpm: Math.round(cpm / 5) }
    },
  }
}
