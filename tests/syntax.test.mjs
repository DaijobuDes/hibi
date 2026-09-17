import assert from 'node:assert/strict'
import test from 'node:test'
import { StreamLanguage } from '@codemirror/language'
import {
  codeHtml,
  codeLanguages,
  highlightCode,
} from '../src/renderer/src/code-languages.ts'

test('common fenced-code languages highlight without executing or changing code', async () => {
  const cases = {
    js: 'const answer = "<script>alert(1)</script>"; // café 💚',
    ts: 'const answer: number = 42;',
    jsx: 'const view = <main>Hello</main>',
    tsx: 'const view: ReactNode = <main>Hello</main>',
    html: '<div class="example">hi</div>',
    css: 'body { color: red; }',
    json: '{"answer": 42}',
    py: 'def answer():\n  return "hello"',
    yml: 'answer: true',
    sql: 'SELECT name FROM users WHERE id = 42;',
    java: 'public class Main { int answer = 42; }',
    cpp: 'int main() { return 42; }',
    rust: 'fn main() { let answer = 42; }',
    go: 'package main\nfunc main() { println("hello") }',
    sh: 'echo "$HOME" # hello',
    cs: 'public class Main { int answer = 42; }',
    ruby: 'def answer\n  return "hello"\nend',
    swift: 'let answer = "hello"',
    toml: 'answer = 42',
    dockerfile: 'FROM node:22\nRUN echo hello',
    ps1: 'Write-Output "hello"',
  }
  for (const [language, text] of Object.entries(cases)) {
    await codeLanguages.ensure(language)
    const spans = highlightCode(text, language)
    assert.ok(spans.length > 0, language)
    assert.ok(
      spans.every(
        (span) =>
          span.from >= 0 && span.to <= text.length && span.to > span.from,
      ),
    )
  }
  assert.ok(!codeHtml(cases.js, 'js').includes('<script>'))
  assert.deepEqual(highlightCode('anything', 'unknown'), [])
  assert.deepEqual(highlightCode('x'.repeat(100001), 'js'), [])
  assert.equal(
    codeLanguages.resolve('JS filename=example.js'),
    codeLanguages.resolve('javascript'),
  )
})

test('language contributions override aliases and restore built-ins on cleanup', async () => {
  await codeLanguages.ensure('js')
  const before = codeLanguages.resolve('js')
  const language = StreamLanguage.define({
    token(stream) {
      stream.skipToEnd()
      return 'keyword'
    },
  })
  const definition = { id: 'javascript', aliases: ['custom-js'], language }
  const remove = codeLanguages.register('test', definition)
  assert.equal(codeLanguages.resolve('js'), language)
  assert.equal(codeLanguages.resolve('custom-js'), language)
  remove()
  const removeNew = codeLanguages.register('test', definition)
  remove()
  assert.equal(codeLanguages.resolve('js'), language)
  removeNew()
  assert.equal(codeLanguages.resolve('js'), before)
  assert.equal(codeLanguages.resolve('custom-js'), null)
  assert.throws(
    () => codeLanguages.register('test', { id: undefined, language }),
    /invalid/,
  )
})

test('language switches cover aliases, retain plain code, and follow extension registration', async () => {
  await codeLanguages.ensure('js')
  codeLanguages.setEnabled('javascript', false)
  assert.equal(codeLanguages.resolve('js'), null)
  assert.equal(codeHtml('const value = 1 < 2', 'js'), 'const value = 1 &lt; 2')
  codeLanguages.setEnabled('javascript', true)
  assert.ok(codeLanguages.resolve('js'))
  const language = StreamLanguage.define({
    token(stream) {
      stream.skipToEnd()
      return 'keyword'
    },
  })
  const remove = codeLanguages.register('test-plugin', {
    id: 'customlang',
    aliases: ['custom'],
    language,
  })
  assert.equal(
    codeLanguages.snapshot().find((item) => item.id === 'customlang').owner,
    'test-plugin',
  )
  codeLanguages.setEnabled('customlang', false)
  assert.equal(codeLanguages.resolve('custom'), null)
  remove()
  assert.ok(!codeLanguages.snapshot().some((item) => item.id === 'customlang'))
  const cleanup = codeLanguages.register('test-plugin', {
    id: 'customlang',
    aliases: ['custom'],
    language,
  })
  assert.equal(codeLanguages.resolve('custom'), null)
  codeLanguages.setEnabled('customlang', true)
  cleanup()
})
