import { parentPort } from 'node:worker_threads'
import { convertEntries } from './pack-converters'
import { type PackId, PackIndex, validateId, writePack } from './pack-index'

const port = parentPort
if (!port) throw new Error('Dictionary worker requires parent port')
const index = new PackIndex()
let queue = Promise.resolve()
port.on(
  'message',
  (job: {
    seq: number
    type: string
    id: PackId
    files: string[]
    directory: string
    word: string
  }) => {
    queue = queue.then(async () => {
      try {
        let result: unknown
        if (job.type === 'unload') await index.unload()
        else {
          validateId(job.id)
          if (job.type === 'convert') {
            if (
              !Array.isArray(job.files) ||
              job.files.length < 1 ||
              job.files.length > 16 ||
              !job.files.every((f) => typeof f === 'string' && f.length <= 4096)
            )
              throw new Error('Invalid dictionary files')
            await index.unload()
            result = await writePack(
              job.id,
              convertEntries(job.id, job.files),
              job.directory,
              (entries) =>
                port.postMessage({ seq: job.seq, progress: entries }),
            )
          } else if (job.type === 'lookup')
            result = await index.lookup(job.id, job.directory, job.word)
          else throw new Error('Invalid dictionary operation')
        }
        port.postMessage({ seq: job.seq, result })
      } catch (error) {
        port.postMessage({
          seq: job.seq,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  },
)
