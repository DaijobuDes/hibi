import assert from 'node:assert/strict'
import test from 'node:test'
import { StreamLanguage } from '@codemirror/language'
import {
  codeHtml,
  codeLanguages,
  highlightCode,
} from '../src/renderer/src/code-languages.ts'

test('common fenced-code languages highlight without executing or changing code', () => {
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

test('language contributions override aliases and restore built-ins on cleanup', () => {
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
