import type { DocumentSession } from '../../shared/document-session.ts'
import {
  type ClientOptions,
  DocumentWorkerClient,
} from './document-worker-client.ts'

export type DocumentWorkerConnection = Pick<
  DocumentWorkerClient,
  | 'find'
  | 'cancelFind'
  | 'metadata'
  | 'releaseMetadata'
  | 'boundaries'
  | 'releaseBoundaries'
  | 'dispose'
>
type FindJob = {
  owner: ClientOptions
  args: Parameters<DocumentWorkerClient['find']>
}
type MetadataJob = {
  owner: ClientOptions
  args: Parameters<DocumentWorkerClient['metadata']>
}
type BoundaryJob = {
  owner: ClientOptions
  args: Parameters<DocumentWorkerClient['boundaries']>
}
const groups = new WeakMap<DocumentSession, ReturnType<typeof workerGroup>>()

/** One replica per document; panes keep separate callbacks and cancellation. */
export function connectDocumentWorker(
  session: DocumentSession,
  options: ClientOptions,
): DocumentWorkerConnection {
  let group = groups.get(session)
  if (!group) {
    group = workerGroup(session, options)
    groups.set(session, group)
  }
  return group.connect(options)
}

function workerGroup(session: DocumentSession, initial: ClientOptions) {
  const owners = new Set<ClientOptions>()
  let find: FindJob | null = null
  let highlightOwner: ClientOptions | null = null
  let metadata: MetadataJob | null = null
  let boundaries: BoundaryJob | null = null
  let findQueue: FindJob[] = []
  let metadataQueue: MetadataJob[] = []
  let boundaryQueue: BoundaryJob[] = []
  const nextFind = () => {
    if (find) return
    find = findQueue.shift() ?? null
    if (find) {
      if (highlightOwner !== find.owner) client.invalidateHighlights()
      highlightOwner = find.owner
      client.find(...find.args)
    }
  }
  const nextMetadata = () => {
    if (metadata) return
    metadata = metadataQueue.shift() ?? null
    if (metadata) client.metadata(...metadata.args)
  }
  const nextBoundaries = () => {
    if (boundaries) return
    const job = boundaryQueue.shift()
    if (!job) return
    boundaries = job
    const [config, receive, declined, from, baseVersion] = job.args
    client.boundaries(
      config,
      (page, acknowledge) => {
        if (boundaries !== job) return
        receive(page, () => {
          if (boundaries !== job) return
          acknowledge()
          if (page.done && boundaries === job) {
            boundaries = null
            client.releaseBoundaries(true)
            nextBoundaries()
          }
        })
      },
      (reason) => {
        if (boundaries !== job) return
        boundaries = null
        declined(reason)
        nextBoundaries()
      },
      from,
      baseVersion,
    )
  }
  const cancelFind = (owner: ClientOptions) => {
    findQueue = findQueue.filter((job) => job.owner !== owner)
    if (find?.owner !== owner) return
    find = null
    client.cancelFind()
    nextFind()
  }
  const releaseMetadata = (owner: ClientOptions) => {
    metadataQueue = metadataQueue.filter((job) => job.owner !== owner)
    if (metadata?.owner !== owner) return
    metadata = null
    client.releaseMetadata()
    nextMetadata()
  }
  const releaseBoundaries = (owner: ClientOptions, retain = false) => {
    boundaryQueue = boundaryQueue.filter((job) => job.owner !== owner)
    if (boundaries?.owner !== owner) return
    boundaries = null
    client.releaseBoundaries(retain || owners.size > 1)
    nextBoundaries()
  }
  const clear = () => {
    find = metadata = boundaries = null
    findQueue = []
    metadataQueue = []
    boundaryQueue = []
  }
  const client = new DocumentWorkerClient(session, {
    ...initial,
    changed() {
      find = null
      findQueue = []
      metadata = null
      metadataQueue = []
      client.releaseMetadata()
      for (const owner of owners) owner.changed()
    },
    pending: () => find?.owner.pending(),
    result(...args) {
      const job = find
      find = null
      job?.owner.result(...args)
      nextFind()
    },
    error(message) {
      clear()
      client.dispose()
      if (groups.get(session) === group) groups.delete(session)
      for (const owner of owners) owner.error(message)
    },
    metadataPending: () => metadata?.owner.metadataPending?.(),
    metadataResult(...args) {
      const job = metadata
      metadata = null
      job?.owner.metadataResult?.(...args)
      nextMetadata()
    },
    metadataError(message) {
      const job = metadata
      metadata = null
      job?.owner.metadataError?.(message)
      nextMetadata()
    },
  })
  const group = {
    connect(owner: ClientOptions): DocumentWorkerConnection {
      owners.add(owner)
      let disposed = false
      return {
        find(...args) {
          if (disposed) return
          cancelFind(owner)
          findQueue.push({ owner, args })
          nextFind()
        },
        cancelFind: () => cancelFind(owner),
        metadata(...args) {
          if (disposed) return
          releaseMetadata(owner)
          metadataQueue.push({ owner, args })
          nextMetadata()
        },
        releaseMetadata: () => releaseMetadata(owner),
        boundaries(...args) {
          if (disposed) return
          releaseBoundaries(owner, true)
          boundaryQueue.push({ owner, args })
          nextBoundaries()
        },
        releaseBoundaries: (retain) => releaseBoundaries(owner, retain),
        dispose() {
          if (disposed) return
          disposed = true
          owners.delete(owner)
          releaseMetadata(owner)
          releaseBoundaries(owner)
          cancelFind(owner)
          if (owners.size) return
          client.dispose()
          if (groups.get(session) === group) groups.delete(session)
        },
      }
    },
  }
  return group
}
