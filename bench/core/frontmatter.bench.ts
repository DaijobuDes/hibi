import { bench, describe } from 'vitest'
import {
  addFrontmatter,
  parseFrontmatter,
  replaceFrontmatter,
} from '../../src/addons/frontmatter/markdown.ts'
import { readFrontmatter } from '../../src/shared/frontmatter.ts'
import { note, noteWithFrontmatter } from '../fixtures.ts'

// Frontmatter is split from the source on every document load, save and preview.
const withBlock = noteWithFrontmatter(5)
const withoutBlock = note(5)
const yaml = 'title: updated\ntags:\n  - notes\n  - hibi\ndraft: true'

describe('frontmatter', () => {
  bench('read a note with frontmatter', () => {
    readFrontmatter(withBlock)
  })

  bench('read a note without frontmatter', () => {
    readFrontmatter(withoutBlock)
  })

  bench('project a note for the rich editor', () => {
    parseFrontmatter(withBlock)
  })

  bench('replace the frontmatter block', () => {
    replaceFrontmatter(withBlock, yaml)
  })

  bench('add a frontmatter block', () => {
    addFrontmatter(withoutBlock)
  })
})
