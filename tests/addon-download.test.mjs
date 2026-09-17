import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadAddon, unpackAddon } from '../src/main/addon-download.ts'
import {
  downloadRepository,
  repositoryUrl,
} from '../src/main/addon-repository.ts'
import {
  addonPackageUrl,
  MAX_ADDON_FILE_BYTES,
} from '../src/shared/addon-package.ts'
import { zipFiles } from './zip.mjs'

const packageFiles = [
  { name: 'hibi-addon.json', content: '{}' },
  { name: 'README.md', content: 'fixture' },
  {
    name: 'index.js',
    content: 'export default () => ({start() {}})',
    deflate: true,
  },
]
test('addon archives preserve wrappers and reject unsafe or oversized contents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-unpack-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const prefix of ['', 'example-main/']) {
    const folder = await mkdtemp(join(root, 'good-'))
    await unpackAddon(
      zipFiles(
        packageFiles.map((file) => ({ ...file, name: prefix + file.name })),
      ),
      folder,
    )
    assert.equal(await readFile(join(folder, 'README.md'), 'utf8'), 'fixture')
    assert.equal(
      await readFile(join(folder, 'index.js'), 'utf8'),
      packageFiles[2].content,
    )
  }
  for (const [label, extra] of [
    ['traversal', { name: '../escape.js' }],
    ['absolute', { name: '/escape.js' }],
    ['windows path', { name: 'a\\escape.js' }],
    ['symlink', { name: 'link.js', mode: 0xa000, content: '/etc/passwd' }],
    ['special file', { name: 'pipe.js', mode: 0x1000 }],
    ['encrypted', { name: 'encrypted.js', flags: 1 }],
    ['duplicate', { name: 'readme.md' }],
    [
      'declared size',
      { name: 'large.js', declaredSize: MAX_ADDON_FILE_BYTES + 1 },
    ],
    [
      'actual size',
      {
        name: 'bomb.js',
        content: 'a'.repeat(MAX_ADDON_FILE_BYTES + 1),
        declaredSize: 1,
        deflate: true,
      },
    ],
    ['checksum', { name: 'damaged.js', content: 'changed', crc: 1 }],
  ]) {
    const folder = await mkdtemp(join(root, 'bad-'))
    await assert.rejects(
      unpackAddon(zipFiles([...packageFiles, extra]), folder),
      undefined,
      label,
    )
  }
  const many = zipFiles(packageFiles)
  many.writeUInt16LE(65535, many.length - 14)
  many.writeUInt16LE(65535, many.length - 12)
  await assert.rejects(unpackAddon(many, root), /1,000 entries/)
  await assert.rejects(
    unpackAddon(Buffer.from('not a zip'), root),
    /invalid addon zip/,
  )
})

test('addon urls stay https through redirects and downloads remain bounded', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  for (const url of [
    'http://example.com/a.zip',
    'file:///tmp/a.zip',
    'https://name:secret@example.com/a.zip',
  ])
    assert.throws(() => addonPackageUrl(url))
  let calls = 0
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.Authorization, undefined)
    return ++calls === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/a.zip' },
        })
      : new Response(zipFiles(packageFiles))
  }
  const download = await downloadAddon('https://example.com/addon.zip')
  assert.equal(download.host, 'cdn.example.com')
  assert.equal(calls, 2)
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'http://example.com/a.zip' },
    })
  await assert.rejects(downloadAddon('https://example.com/a.zip'), /https/)
  globalThis.fetch = async () =>
    new Response('large', {
      headers: { 'content-length': String(26 * 1024 * 1024) },
    })
  await assert.rejects(downloadAddon('https://example.com/a.zip'), /25 mib/)
})

test('repository installs archive without checkout, hooks, or inherited git config', {
  timeout: 30000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-repo-package-'))
  const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const source = join(root, 'source'),
    bin = join(root, 'bin'),
    log = join(root, 'commands.jsonl')
  await mkdir(source)
  await mkdir(bin)
  for (const file of packageFiles)
    await writeFile(join(source, file.name), file.content)
  execFileSync(git, ['-c', 'init.defaultBranch=main', 'init', source])
  const run = (args) =>
    execFileSync(git, [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.test',
      '-C',
      source,
      ...args,
    ])
  run(['add', '.'])
  run(['commit', '-m', 'fixture'])
  const wrapper = join(bin, 'git')
  await writeFile(
    wrapper,
    `#!${process.execPath}\nconst cp=require('node:child_process'),fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,global:process.env.GIT_CONFIG_GLOBAL,system:process.env.GIT_CONFIG_NOSYSTEM})+'\\n');const index=args.indexOf('https://github.com/example/addon.git');if(index>=0)args[index]=${JSON.stringify(source)};const result=cp.spawnSync(${JSON.stringify(git)},['-c','protocol.file.allow=always',...args],{stdio:'inherit'});process.exit(result.status??1)\n`,
  )
  await chmod(wrapper, 0o700)
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous}`
  t.after(async () => {
    process.env.PATH = previous
    await rm(root, { recursive: true, force: true })
  })
  const temporary = join(root, 'download')
  await mkdir(temporary)
  const archive = await downloadRepository(
    'https://github.com/example/addon',
    temporary,
  )
  const folder = join(root, 'package')
  await mkdir(folder)
  await unpackAddon(archive.zip, folder)
  assert.equal(await readFile(join(folder, 'README.md'), 'utf8'), 'fixture')
  const commands = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.equal(commands.length, 2)
  assert.ok(commands[0].args.includes('--bare'))
  assert.ok(commands[0].args.includes('--depth=1'))
  assert.ok(commands[1].args.includes('archive'))
  assert.equal(commands[0].system, '1')
  assert.ok(commands[0].args.includes('credential.helper='))
  assert.equal(repositoryUrl('https://github.com/example/addon'), true)
  assert.equal(repositoryUrl('https://git.example.com/addon.git'), true)
  assert.equal(
    repositoryUrl(
      'https://github.com/example/addon/releases/download/1/addon.zip',
    ),
    false,
  )
})
