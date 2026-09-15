import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { isTrustedRendererUrl, resolveAssetPath } from '../src/main/security.ts'

test('assets stay inside the renderer bundle', () => {
  const root = resolve('out/renderer')
  assert.equal(
    resolveAssetPath('app://hibi/', root),
    resolve(root, 'index.html'),
  )
  assert.equal(
    resolveAssetPath('app://hibi/assets/index-a.js', root),
    resolve(root, 'assets/index-a.js'),
  )
  for (const url of [
    'app://other/index.html',
    'app://hibi:8000/index.html',
    'app://user@hibi/index.html',
    'https://hibi/index.html',
    'app://hibi/..%2fmain/index.js',
    'app://hibi/%2e%2e%2fmain/index.js',
    'app://hibi/assets/%2e%2e%2f%2e%2e%2fmain/index.js',
    'app://hibi/%5c..%5cmain/index.js',
    'app://hibi/%00',
    'app://hibi/%zz',
    'not a url',
  ])
    assert.equal(resolveAssetPath(url, root), null, url)
})

test('ipc trusts only the exact app document, allowing hash routes', () => {
  for (const expected of ['app://hibi/', 'http://127.0.0.1:5173/']) {
    assert.equal(isTrustedRendererUrl(expected, expected), true)
    assert.equal(isTrustedRendererUrl(`${expected}#settings`, expected), true)
    for (const candidate of [
      `${expected}other`,
      `${expected}?injected=1`,
      'app://hibi.attacker/',
      'file:///index.html',
      'data:text/html,hello',
      'invalid',
    ]) {
      assert.equal(isTrustedRendererUrl(candidate, expected), false, candidate)
    }
  }
})
