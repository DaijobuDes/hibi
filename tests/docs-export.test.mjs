import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { parse } from 'yaml'

const exec = promisify(execFile)

test('docs export embeds nested pages and images, escapes content, and stays deterministic', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-docs-export-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const docs = join(folder, 'docs')
  const output = join(folder, 'published', 'index.html')
  await mkdir(join(docs, 'guides'), { recursive: true })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  )
  await writeFile(join(docs, 'pixel.png'), png)
  await writeFile(
    join(docs, 'README.md'),
    '# Documentation\n\n![pixel](pixel.png)',
  )
  const markdown = '# Guide\n\n</script><script>alert(1)</script>\u2028\u2029'
  await writeFile(join(docs, 'guides', 'start.md'), markdown)
  const exportDocs = () =>
    exec(process.execPath, [resolve('scripts/export-docs.mjs'), docs, output])
  await exportDocs()
  const first = await readFile(output, 'utf8')
  const embedded = first.match(
    /<script id="workspace-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1]
  assert.ok(embedded)
  assert.equal(embedded.includes('<'), false)
  assert.equal(/[\u2028\u2029]/.test(embedded), false)
  const snapshot = JSON.parse(embedded)
  assert.deepEqual(
    snapshot.pages.map((page) => page.path),
    ['README.md', 'guides/start.md'],
  )
  assert.equal(snapshot.pages[1].markdown, markdown)
  assert.equal(
    snapshot.pages[0].images['pixel.png'],
    `data:image/png;base64,${png.toString('base64')}`,
  )
  assert.equal(first.includes('__HIBI_WORKSPACE_DATA__'), false)
  await exportDocs()
  assert.equal(await readFile(output, 'utf8'), first)

  await writeFile(join(folder, 'private.png'), png)
  await writeFile(join(docs, 'README.md'), '![outside](../private.png)')
  await assert.rejects(exportDocs(), /outside the docs folder/)
  assert.equal(await readFile(output, 'utf8'), first)
})

test('docs sync commits only changed html and refuses to overwrite concurrent pushes', {
  skip: process.platform === 'win32', // The publishing job runs Bash on Ubuntu.
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-docs-sync-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const remote = join(folder, 'remote.git')
  const destination = join(folder, 'published-docs')
  const source = join(folder, 'source', 'out', 'docs')
  const git = async (cwd, ...args) =>
    (await exec('git', args, { cwd })).stdout.trim()
  await git(folder, 'init', '--bare', '--initial-branch=main', remote)
  await git(folder, 'clone', remote, destination)
  await git(destination, 'config', 'user.name', 'Test')
  await git(destination, 'config', 'user.email', 'test@example.com')
  await mkdir(join(destination, '.github', 'workflows'), { recursive: true })
  for (const file of [
    'README.md',
    'LICENSE',
    'CNAME',
    '.github/workflows/pages.yml',
  ])
    await writeFile(join(destination, file), `preserve ${file}`)
  await writeFile(join(destination, 'index.html'), 'old html')
  await git(destination, 'add', '.')
  await git(destination, 'commit', '-m', 'Initial site')
  await git(destination, 'push', 'origin', 'main')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'index.html'), 'new html')
  const workflow = parse(
    await readFile('.github/workflows/docs-sync.yml', 'utf8'),
  )
  const script = workflow.jobs.sync.steps.find(
    (step) => step.name === 'publish changed html',
  ).run
  const publish = () =>
    exec('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: destination,
      env: { ...process.env, SOURCE_COMMIT: 'abc1234' },
    })
  await publish()
  assert.equal(
    await git(remote, 'log', '-1', '--format=%s', 'main'),
    'docs: sync to main (abc1234)',
  )
  assert.equal(await git(remote, 'show', 'main:index.html'), 'new html')
  for (const file of [
    'README.md',
    'LICENSE',
    'CNAME',
    '.github/workflows/pages.yml',
  ])
    assert.equal(await git(remote, 'show', `main:${file}`), `preserve ${file}`)
  const firstCommit = await git(remote, 'rev-parse', 'main')
  await publish()
  assert.equal(await git(remote, 'rev-parse', 'main'), firstCommit)

  const other = join(folder, 'other')
  await git(folder, 'clone', remote, other)
  await git(other, 'config', 'user.name', 'Test')
  await git(other, 'config', 'user.email', 'test@example.com')
  await writeFile(join(other, 'README.md'), 'concurrent edit')
  await git(other, 'commit', '-am', 'Concurrent change')
  await git(other, 'push', 'origin', 'main')
  const concurrentCommit = await git(remote, 'rev-parse', 'main')
  await writeFile(join(source, 'index.html'), 'next html')
  await assert.rejects(publish(), /rejected/)
  assert.equal(await git(remote, 'rev-parse', 'main'), concurrentCommit)
  assert.equal(await git(remote, 'show', 'main:README.md'), 'concurrent edit')
})
