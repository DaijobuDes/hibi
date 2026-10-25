import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import {
  checksFromShards,
  classifyRelease,
  decideRelease,
  nightly,
  nightlyWebhook,
  platforms,
  releaseChannels,
  releaseNotes,
  sendNightlyWebhook,
} from '../scripts/nightly.mjs'

const sha = 'a'.repeat(40)
const prepared = {
  sha,
  betaVersion: '0.2.0',
  changed: true,
  nightlyTag: 'nightly-2026-10-25-aaaaaaa-12-1',
  nightlyVersion: '0.2.0-nightly.20261025.gaaaaaaa.12.1',
  previous: 'v0.1.0',
  commits: `${sha}\tFix [editor] *cursor*`,
  runUrl: 'https://github.com/owner/repo/actions/runs/123',
}
const shards = (sha) =>
  platforms.flatMap((platform) =>
    [0, 1, 2, 3].map((shard) => ({ platform, sha, shard, checks: 'success' })),
  )
const packages = (release) =>
  release.checks.map((report) => ({
    ...report,
    build: 'success',
    package: 'success',
    channel: release.channel,
    tag: release.tag,
    version: release.version,
  }))
const checkedRelease = (reports = shards(sha), changed = true) => {
  const decided = decideRelease({ ...prepared, changed }, reports)
  return classifyRelease(decided, packages(decided))
}
function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hibi-release-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  git('init')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release@example.invalid')
  writeFileSync(join(cwd, 'package.json'), '{"version":"0.2.0"}')
  git('add', 'package.json')
  git('commit', '-m', 'Initial app')
  return { cwd, git }
}
const date = new Date('2026-10-25T18:00:00Z')

test('version computation uses numeric latest tags, package floor, minor input and unchanged HEAD', (t) => {
  const { cwd, git } = repository(t)
  const first = nightly(cwd, date, 'patch', '12.1')
  assert.equal(first.betaVersion, '0.2.0')
  assert.equal(first.changed, true)
  assert.equal(first.previous, undefined)
  assert.match(first.commits, /Initial app/)
  assert.equal(
    first.nightlyTag,
    `nightly-2026-10-25-${first.sha.slice(0, 7)}-12-1`,
  )
  assert.equal(
    first.nightlyVersion,
    `0.2.0-nightly.20261025.g${first.sha.slice(0, 7)}.12.1`,
  )
  assert.notEqual(
    nightly(cwd, date, 'patch', '12.2').nightlyTag,
    first.nightlyTag,
  )
  git('tag', 'v0.1.9')
  assert.equal(
    nightly(cwd, date).betaVersion,
    '0.2.0',
    'package version is a floor',
  )
  assert.equal(nightly(cwd, date).changed, false)
  for (const tag of [
    'v0.2.9',
    'v0.2.10',
    'v0.2.2',
    'v99.0.0-beta.1',
    'v01.0.0',
    'beta',
    'nightly',
    'nightly-green',
  ])
    git('tag', tag)
  const unchanged = nightly(cwd, date)
  assert.equal(unchanged.betaVersion, '0.2.11')
  assert.equal(unchanged.changed, false)
  assert.equal(decideRelease(unchanged, shards(first.sha)).channel, 'nightly')
  assert.equal(nightly(cwd, new Date('2026-10-26T18:00:00Z')).sha, first.sha)
  git('commit', '--allow-empty', '-m', 'Fix editor')
  assert.equal(nightly(cwd, date).changed, true)
  assert.equal(nightly(cwd, date, 'minor').betaVersion, '0.3.0')
  const next = nightly(cwd, date)
  git('tag', next.nightlyTag)
  git('commit', '--allow-empty', '-m', 'Fix selection')
  const following = nightly(cwd, date)
  assert.equal(
    following.previous,
    next.nightlyTag,
    'rolling feeds are excluded from changelogs',
  )
  assert.match(following.commits, /Fix selection/)
  assert.doesNotMatch(following.commits, /Initial app/)
  writeFileSync(join(cwd, 'package.json'), '{"version":"0.5.2"}')
  assert.equal(nightly(cwd, date).betaVersion, '0.5.2')
  assert.equal(nightly(cwd, date, 'minor').betaVersion, '0.5.2')
  assert.throws(() => nightly(cwd, date, 'major'), /patch or minor/)
  assert.throws(() => nightly(cwd, date, 'patch', '01.1'), /run identity/)
  writeFileSync(join(cwd, 'package.json'), '{"version":"0.5.2-beta.1"}')
  assert.throws(() => nightly(cwd, date), /plain semver/)
})

test('every shard must pass for beta; other complete runs publish nightlies without relabeling packages', () => {
  const beta = checkedRelease()
  assert.equal(beta.channel, 'beta')
  assert.equal(beta.tag, 'v0.2.0')
  assert.equal(beta.version, '0.2.0')
  assert.deepEqual(releaseChannels(beta), ['beta', 'nightly'])
  for (const checks of ['failure', 'cancelled', 'skipped', undefined]) {
    for (let i = 0; i < platforms.length * 4; i++) {
      const reports = shards(sha)
      reports[i].checks = checks
      const release = checkedRelease(reports)
      assert.equal(release.channel, 'nightly')
      assert.equal(release.tag, prepared.nightlyTag)
      assert.equal(release.version, prepared.nightlyVersion)
      assert.deepEqual(releaseChannels(release), ['nightly'])
    }
  }
  assert.equal(checkedRelease(shards(sha), false).channel, 'nightly')
})

test('decide and publish fail closed on missing, duplicate, mismatched or changed reports', () => {
  const reports = shards(sha)
  for (const invalid of [
    reports.slice(1),
    [...reports, reports[0]],
    [reports[1], ...reports.slice(1)],
    [{ ...reports[0], sha: 'b'.repeat(40) }, ...reports.slice(1)],
    [{ ...reports[0], platform: 'other' }, ...reports.slice(1)],
  ])
    assert.throws(
      () => decideRelease(prepared, invalid),
      /Every release check shard/,
    )
  const beta = decideRelease(prepared, reports)
  const built = packages(beta)
  for (const key of ['channel', 'tag', 'version'])
    assert.throws(
      () => classifyRelease({ ...beta, [key]: 'mismatch' }, built),
      /checked release decision/,
    )
  assert.throws(
    () => classifyRelease(beta, built.slice(1)),
    /Every release platform/,
  )
  assert.throws(
    () => classifyRelease(beta, [built[1], ...built.slice(1)]),
    /Every release platform/,
  )
  for (const stage of ['build', 'package']) {
    for (const outcome of ['failure', 'cancelled', 'skipped', undefined])
      assert.throws(
        () =>
          classifyRelease(beta, [
            { ...built[0], [stage]: outcome },
            ...built.slice(1),
          ]),
        /Cannot publish/,
      )
  }
  for (const [key, value] of [
    ['sha', 'b'.repeat(40)],
    ['version', '0.2.1'],
    ['tag', prepared.nightlyTag],
    ['channel', 'nightly'],
    ['checks', 'failure'],
  ])
    assert.throws(
      () =>
        classifyRelease(beta, [
          { ...built[0], [key]: value },
          ...built.slice(1),
        ]),
      /mismatched packages|checked decision/,
    )
  const failed = [{ ...reports[0], checks: 'failure' }, ...reports.slice(1)]
  assert.throws(
    () => classifyRelease(beta, built, failed),
    /checked release decision/,
  )
  const nightly = decideRelease(prepared, failed)
  assert.throws(
    () => classifyRelease(nightly, packages(nightly), reports),
    /checked release decision/,
  )
  const platformReports = reports.filter(
    (report) => report.platform === 'macos-x64',
  )
  assert.equal(checksFromShards('macos-x64', sha, platformReports), 'success')
  assert.throws(
    () => checksFromShards('macos-x64', sha, platformReports.slice(1)),
    /Every release check shard/,
  )
})

const downloads = (version) =>
  [
    'win-x64.exe',
    'mac-x64.dmg',
    'mac-arm64.dmg',
    'mac-x64.zip',
    'mac-arm64.zip',
    ...['x64', 'arm64'].flatMap((arch) =>
      ['AppImage', 'deb', 'flatpak'].map((ext) => `linux-${arch}.${ext}`),
    ),
  ].map((suffix) => `hibi-${version}-${suffix}`)
const checksums = (release) =>
  downloads(release.version)
    .map((name) => `${'a'.repeat(64)}  ./${name}`)
    .join('\n')

test('release notes and webhook announce both channels with check results, logs and direct downloads', () => {
  const failed = shards(sha)
  failed[0].checks = 'failure'
  for (const release of [
    checkedRelease(),
    checkedRelease(failed),
    checkedRelease(shards(sha), false),
  ]) {
    const notes = releaseNotes(release, 'owner/repo', checksums(release))
    assert.match(notes, /linux-x64: checks (success|failure); package success/)
    assert.ok(notes.includes(`[build and test logs](${prepared.runUrl})`))
    assert.doesNotMatch(notes, /\b(green|red|broken)\b/)
    assert.match(notes, /Fix \\\[editor\\\] \\\*cursor\\\*/)
    assert.ok(notes.includes(`/compare/v0.1.0...${sha}`))
    assert.equal(
      notes.match(/^SHA256 /gm).length,
      downloads(release.version).length,
    )
    const payload = nightlyWebhook(release, 'owner/repo', checksums(release))
    const beta = release.channel === 'beta'
    assert.equal(
      payload.content,
      (beta ? '<@&1550309423166267432> ' : '') +
        'new ' +
        release.channel +
        ' released: **' +
        release.tag +
        '**',
    )
    assert.deepEqual(payload.allowed_mentions, {
      parse: [],
      roles: ['1550309423166267432'],
    })
    assert.deepEqual(payload.attachments, [])
    const [embed] = payload.embeds
    assert.equal(embed.title, '🦋')
    assert.equal(embed.color, beta ? 9568176 : 9807270)
    assert.equal(
      embed.footer.text,
      beta
        ? 'this beta passed all checks on every platform.'
        : 'back up your notes before installing. nightlies are bleeding edge and may be broken.',
    )
    assert.ok(embed.description.includes(`/commit/${sha}`))
    assert.deepEqual(
      embed.description.split('**download links**\n')[1].split('\n'),
      downloads(release.version).map(
        (name) =>
          '[' +
          name +
          '](https://github.com/owner/repo/releases/download/' +
          release.tag +
          '/' +
          encodeURIComponent(name) +
          ')',
      ),
    )
    assert.ok(embed.description.length <= 4096)
    assert.throws(
      () => releaseNotes(release, 'owner/repo', 'invalid'),
      /checksum/,
    )
    assert.throws(
      () =>
        releaseNotes(
          release,
          'owner/repo',
          checksums(release).split('\n').slice(1).join('\n'),
        ),
      /Missing nightly download/,
    )
  }
})

test('prepare, decide and classify CLI preserve the packaged identity and scheduled patch policy', (t) => {
  const { cwd, git } = repository(t)
  git('tag', 'v0.2.4')
  git('commit', '--allow-empty', '-m', 'Fix editor')
  const output = join(cwd, 'output')
  const cli = (command, env = {}) =>
    execFileSync(process.execPath, [resolve('scripts/nightly.mjs'), command], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_EVENT_NAME: 'schedule',
        BUMP: 'minor',
        GITHUB_RUN_NUMBER: '99',
        GITHUB_RUN_ATTEMPT: '2',
        ...env,
      },
    })
  cli('prepare')
  const readRelease = () =>
    JSON.parse(readFileSync(join(cwd, 'release.json'), 'utf8'))
  assert.equal(
    readRelease().betaVersion,
    '0.2.5',
    'scheduled runs ignore minor input',
  )
  cli('prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch' })
  assert.equal(readRelease().betaVersion, '0.3.0')
  const revision = readRelease().sha
  mkdirSync(join(cwd, 'check-shards'))
  for (const report of shards(revision))
    writeFileSync(
      join(cwd, 'check-shards', `${report.platform}-${report.shard}.json`),
      JSON.stringify(report),
    )
  cli('decide')
  const decided = readRelease()
  assert.equal(decided.version, '0.3.0')
  for (const entry of ['channel=beta', 'version=0.3.0', 'tag=v0.3.0'])
    assert.ok(readFileSync(output, 'utf8').includes(entry))
  mkdirSync(join(cwd, 'installers'))
  for (const report of packages(decided))
    writeFileSync(
      join(cwd, 'installers', `checks-${report.platform}.json`),
      JSON.stringify(report),
    )
  cli('classify')
  assert.equal(readRelease().version, decided.version)
  const changedReport = { ...shards(revision)[0], checks: 'failure' }
  writeFileSync(
    join(cwd, 'check-shards', `${changedReport.platform}-0.json`),
    JSON.stringify(changedReport),
  )
  assert.throws(() => cli('classify'), /checked release decision/)
})

test('webhook confirms delivery, skips unset secrets and keeps secrets out of failures', async (t) => {
  const requests = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
  }))
  await sendNightlyWebhook('', {})
  assert.equal(requests.mock.callCount(), 0)
  const webhookUrl = 'https://discord.com/api/webhooks/123/secret?thread_id=456'
  const payload = { content: 'release announcement' }
  await sendNightlyWebhook(webhookUrl, payload)
  const [url, options] = requests.mock.calls[0].arguments
  assert.equal(url.searchParams.get('wait'), 'true')
  assert.equal(url.searchParams.get('thread_id'), '456')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), payload)
  assert.ok(options.signal instanceof AbortSignal)
  requests.mock.mockImplementation(async () => ({ ok: false, status: 429 }))
  await assert.rejects(sendNightlyWebhook(webhookUrl, payload), {
    message: 'Nightly webhook failed: HTTP 429',
  })
  requests.mock.mockImplementation(async () => {
    throw new Error(webhookUrl)
  })
  for (const url of [webhookUrl, 'invalid secret url'])
    await assert.rejects(sendNightlyWebhook(url, payload), {
      message: 'Nightly webhook request failed',
    })
})

test('workflow decides before signing, verifies before publishing and preserves frozen forwards', () => {
  const expression = (value) => ['$', '{{ ', value, ' }}'].join('')
  const source = readFileSync('.github/workflows/nightly.yml', 'utf8')
  const workflow = parse(source)
  assert.equal(workflow.on.push, undefined)
  assert.equal(workflow.on.workflow_dispatch.inputs.bump.default, 'patch')
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.bump.options, [
    'patch',
    'minor',
  ])
  assert.equal(workflow.concurrency.group, 'releases')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs.prepare.if, "github.ref == 'refs/heads/main'")
  assert.deepEqual(workflow.jobs.decide.needs, ['prepare', 'checks'])
  assert.deepEqual(workflow.jobs.build.needs, ['prepare', 'decide'])
  assert.deepEqual(workflow.jobs.publish.needs, ['prepare', 'decide', 'build'])
  assert.equal(
    workflow.jobs.publish.if,
    undefined,
    'failed package jobs block publication',
  )
  assert.deepEqual(Object.keys(workflow.jobs.decide.outputs).sort(), [
    'channel',
    'tag',
    'version',
  ])
  assert.doesNotMatch(
    source,
    /nightly-green|recommended-nightly|update\.json|STABLE_TAG|nightly-broken/,
  )
  const checkJob = workflow.jobs.checks
  assert.deepEqual(checkJob.strategy.matrix.shard, [0, 1, 2, 3])
  assert.deepEqual(
    checkJob.strategy.matrix.include.map((item) => item.platform).sort(),
    [...platforms].sort(),
  )
  const checks = checkJob.steps.find((step) => step.id === 'ci')
  assert.equal(checks['continue-on-error'], true)
  assert.ok(checks['timeout-minutes'] < checkJob['timeout-minutes'])
  assert.equal(checks.with.clean, true)
  assert.equal(checks.with.shard, `${expression('matrix.shard')}/4`)
  const reportUpload = checkJob.steps.at(-1)
  assert.equal(
    reportUpload.with.path,
    'checks-' +
      expression('matrix.platform') +
      '-' +
      expression('matrix.shard') +
      '.json',
  )
  const steps = workflow.jobs.build.steps
  assert.deepEqual(
    workflow.jobs.build.strategy.matrix.include
      .map((item) => item.platform)
      .sort(),
    [...platforms].sort(),
  )
  assert.equal(steps.find((step) => step.id === 'compile').run, 'npm run build')
  const packageStep = steps.find((step) => step.id === 'package')
  assert.equal(
    packageStep.env.RELEASE_VERSION,
    expression('needs.decide.outputs.version'),
  )
  assert.match(packageStep.run, /extraMetadata.version="\$RELEASE_VERSION"/)
  const credentials = steps.find(
    (step) => step.name === 'Install macOS signing credentials',
  )
  for (const command of [
    'security import',
    'security set-key-partition-list',
    'base64 --decode',
    'openssl pkey',
    'CSC_KEYCHAIN=',
    'APPLE_API_KEY=',
  ])
    assert.ok(credentials.run.includes(command))
  const verifyMac = steps.find(
    (step) => step.name === 'Verify signed macOS installers',
  )
  for (const command of [
    'codesign --verify',
    'spctl --assess',
    'bash scripts/validate-stapled-ticket.sh "$app"',
  ])
    assert.ok(verifyMac.run.includes(command))
  const builder = parse(readFileSync('electron-builder.yml', 'utf8'))
  assert.equal(builder.mac.forceCodeSigning, true)
  assert.equal(builder.mac.notarize, true)
  const publish = workflow.jobs.publish.steps
  assert.ok(
    publish.some((step) => step.with?.pattern === 'checks-*'),
    'publication rereads shard reports',
  )
  assert.ok(
    publish.findIndex((step) => step.id === 'classify') <
      publish.findIndex((step) => step.id === 'publish'),
  )
  const immutable = publish.find((step) => step.id === 'publish')
  assert.match(
    immutable.run,
    /if \[ "\$CHANNEL" = beta \]; then\n\s+prerelease=false\n\s+latest=true/,
  )
  assert.match(immutable.run, /published=false/)
  assert.match(immutable.run, /published=true/)
  const feeds = publish.find((step) => step.id === 'feeds')
  assert.equal(feeds.if, "steps.publish.outputs.published == 'true'")
  assert.equal(feeds.run, 'node scripts/update-feed.mjs publish')
  const announcement = publish.find(
    (step) => step.name === 'Announce release on Discord',
  )
  assert.equal(
    announcement.if,
    "steps.publish.outputs.published == 'true' && steps.feeds.outcome == 'success'",
  )
  assert.equal(
    announcement.env.NIGHTLIES_WEBHOOK_URL,
    expression('secrets.NIGHTLIES_WEBHOOK_URL'),
  )
  assert.ok(publish.indexOf(feeds) < publish.indexOf(announcement))
})
