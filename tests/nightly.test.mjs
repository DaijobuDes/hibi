import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { nightly, releaseNotes } from '../scripts/nightly.mjs'

test('nightlies skip released revisions and include real commits since the previous tag', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'hibi-nightly-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  git('init')
  git('config', 'user.name', 'Nightly test')
  git('config', 'user.email', 'nightly@example.invalid')
  writeFileSync(join(cwd, 'package.json'), '{"version":"0.1.0"}')
  git('add', 'package.json')
  git('commit', '-m', 'Initial app')
  const date = new Date('2026-09-17T18:00:00Z')
  const first = nightly(cwd, date)
  assert.equal(first.changed, true)
  assert.match(first.commits, /Initial app/)
  git('tag', first.tag)
  assert.equal(nightly(cwd, date).changed, false)
  git('commit', '--allow-empty', '-m', 'Fix [editor] *cursor*')
  const next = nightly(cwd, date)
  assert.equal(next.changed, true)
  assert.equal(next.previous, first.tag)
  assert.notEqual(next.tag, first.tag)
  assert.match(next.version, /^0\.1\.0-nightly\.20260917\.[0-9a-f]{7}$/)
  const names = [
    'win-x64.exe',
    'mac-x64.dmg',
    'mac-arm64.dmg',
    'mac-x64.zip',
    'mac-arm64.zip',
    'linux-x86_64.AppImage',
  ].map((suffix) => `hibi-${next.version}-${suffix}`)
  const checksums = names
    .map((name, index) => `${String(index).repeat(64)}  ./${name}`)
    .join('\n')
  const notes = releaseNotes(next, 'hibigarden/hibi', checksums)
  assert.ok(
    notes.startsWith(
      `this nightly was built from sha \`${next.sha.slice(0, 7)}\`.`,
    ),
  )
  assert.ok(
    notes.includes('**:warning: always back up before using a nightly!**'),
  )
  assert.match(
    notes,
    /\[windows\].+ • \[macOS \(intel\)\].+ • \[linux \(appImage\)\]/,
  )
  for (const [index, name] of names.entries()) {
    assert.ok(notes.includes(`/releases/download/${next.tag}/${name}`))
    assert.ok(notes.includes(`\`${String(index).repeat(64)}\``))
  }
  assert.equal(notes.match(/^SHA256 /gm).length, names.length)
  assert.ok(notes.includes('\n## changes\n'))
  assert.throws(
    () => releaseNotes(next, 'hibigarden/hibi', 'bad checksum'),
    /Invalid nightly checksum/,
  )
  assert.throws(
    () =>
      releaseNotes(
        next,
        'hibigarden/hibi',
        checksums.split('\n').slice(1).join('\n'),
      ),
    /Missing nightly download: windows/,
  )
  assert.match(notes, /Fix \\\[editor\\\] \\\*cursor\\\*/)
  assert.ok(notes.includes(`/commit/${next.sha}`))
  assert.ok(notes.includes(`/compare/${first.tag}...${next.sha}`))
  assert.ok(!notes.includes('Initial app'))
})
