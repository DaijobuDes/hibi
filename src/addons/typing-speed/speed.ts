export function typingSpeed() {
  const samples: { time: number; characters: number }[] = []
  return {
    add(characters: number, time: number) {
      samples.push({ characters, time })
    },
    read(time: number) {
      while (samples[0] && samples[0].time <= time - 60_000) samples.shift()
      const cpm = samples.reduce((sum, sample) => sum + sample.characters, 0)
      return { cpm, wpm: Math.round(cpm / 5) }
    },
  }
}
