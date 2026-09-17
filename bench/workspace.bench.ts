import { bench, describe } from 'vitest'
import { localTarget, noteGraph } from '../src/addons/graph/model.ts'
import { noteTags, tagMatches } from '../src/addons/tags/syntax.ts'
import { note, workspace } from './fixtures.ts'

// The graph and tag panels rebuild from the whole workspace after every save.
const small = workspace(25)
const large = workspace(250)
const paths = new Set(large.map((page) => page.path))
const document = note(3)
const paragraph =
  'a #project/hibi note with #inbox and #reading/2026 tags plus plain prose'

describe('note graph', () => {
  bench('build the graph for 25 notes', () => {
    noteGraph(small)
  })

  bench('build the graph for 250 notes', () => {
    noteGraph(large)
  })

  bench('resolve a relative link target', () => {
    localTarget('guides/note-1.md', '../notes/note-12.md', paths)
  })

  bench('reject an external link target', () => {
    localTarget('guides/note-1.md', 'https://example.com/page', paths)
  })
})

describe('tags', () => {
  bench('collect the tags of a note', () => {
    noteTags(document)
  })

  bench('collect the tags of 25 notes', () => {
    for (const page of small) noteTags(page.markdown)
  })

  bench('match tags in a paragraph', () => {
    tagMatches(paragraph)
  })
})
