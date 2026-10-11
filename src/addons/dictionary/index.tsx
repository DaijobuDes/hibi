import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { Ban, BookOpen, Hourglass, SearchX, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CommandExecutionContext } from '../../shared/foundation-contracts'
import { defineAddon } from '../api'
import { Button, PanelMessage } from '../ui'
import css from './dictionary.css?inline'
import {
  createLookups,
  type Definitions,
  type Lookup,
  type LookupTarget,
  matchCase,
  type Thesaurus,
  wordAt,
} from './lookup'
import manifest from './manifest'

function richTarget(
  editor: Editor,
  from: number,
  to: number,
): LookupTarget | null {
  const { doc } = editor.state
  const $from = doc.resolve(from)
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null
  if (to > $from.end()) return null
  const base = $from.start()
  const found = wordAt(
    $from.parent.textBetween(0, $from.parent.content.size, undefined, '￼'),
    from - base,
    to - base,
  )
  if (!found) return null
  const range = { from: base + found.from, to: base + found.to }
  if (doc.textBetween(range.from, range.to) !== found.word) return null
  return {
    word: found.word,
    replace(text) {
      if (editor.isDestroyed || editor.state.doc !== doc) return false
      const tr = closeHistory(editor.state.tr).insertText(
        text,
        range.from,
        range.to,
      )
      tr.setSelection(TextSelection.create(tr.doc, range.from + text.length))
      editor.view.dispatch(tr)
      editor.view.dispatch(closeHistory(editor.state.tr))
      return true
    },
    focus: () => editor.view.focus(),
  }
}

const failures = {
  offline: {
    icon: <WifiOff size={28} />,
    title: 'Could not reach the service',
    message: 'Check your internet connection, then try again.',
  },
  'rate-limited': {
    icon: <Hourglass size={28} />,
    title: 'Too many lookups',
    message: 'The service is limiting requests. Wait a minute, then try again.',
  },
  unavailable: {
    icon: <SearchX size={28} />,
    title: 'Service unavailable',
    message: 'The service did not return a usable answer. Try again later.',
  },
  denied: {
    icon: <Ban size={28} />,
    title: 'Lookup not allowed',
    message:
      'Nothing was sent. Run the command again and allow the request to look up this word.',
  },
}

function Words({
  label,
  words,
  choose,
}: {
  label: string
  words: readonly string[]
  choose: (word: string) => void
}) {
  if (!words.length) return null
  return (
    <section className="dictionary-words" aria-label={label}>
      <h3>{label}</h3>
      <div>
        {words.map((word) => (
          <Button key={word} variant="ghost" onClick={() => choose(word)}>
            {word}
          </Button>
        ))}
      </div>
    </section>
  )
}

function Results({
  word,
  kind,
  load,
  choose,
}: {
  word: string
  kind: 'define' | 'synonyms'
  load: () => Promise<Lookup<Definitions | Thesaurus>>
  choose: (word: string) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Lookup<Definitions | Thesaurus> | null>(
    null,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reruns the lookup.
  useEffect(() => {
    let live = true
    setResult(null)
    void load().then((value) => {
      if (live) setResult(value)
    })
    return () => {
      live = false
    }
  }, [load, attempt])
  if (!result)
    return (
      <PanelMessage
        icon={<BookOpen size={28} />}
        title={`Looking up “${word}”…`}
        loading
      />
    )
  if (!result.ok) {
    const failure = failures[result.reason]
    return (
      <div className="dictionary-results">
        <PanelMessage icon={failure.icon} title={failure.title} role="alert">
          {failure.message}
        </PanelMessage>
        {result.reason !== 'denied' && (
          <Button onClick={() => setAttempt(attempt + 1)}>Try again</Button>
        )}
      </div>
    )
  }
  if (!result.value)
    return (
      <PanelMessage
        icon={<SearchX size={28} />}
        title={kind === 'define' ? 'No definitions found' : 'No synonyms found'}
      >
        {`Nothing was found for “${word}”. Check the spelling or try another form of the word.`}
      </PanelMessage>
    )
  if ('meanings' in result.value) {
    const { meanings, license } = result.value
    return (
      <div className="dictionary-results">
        {meanings.map((meaning) => (
          <section key={meaning.partOfSpeech} className="dictionary-meaning">
            {meaning.partOfSpeech && <h3>{meaning.partOfSpeech}</h3>}
            <ol>
              {meaning.definitions.map((item) => (
                <li key={item.definition}>
                  {item.definition}
                  {item.example && (
                    <p className="dictionary-example">{item.example}</p>
                  )}
                </li>
              ))}
            </ol>
            <Words label="Synonyms" words={meaning.synonyms} choose={choose} />
          </section>
        ))}
        <p className="dictionary-source">
          {license
            ? `Definitions from Wiktionary via Free Dictionary API, ${license}.`
            : 'Definitions from Wiktionary via Free Dictionary API.'}
        </p>
      </div>
    )
  }
  return (
    <div className="dictionary-results">
      <Words label="Synonyms" words={result.value.synonyms} choose={choose} />
      <Words label="Antonyms" words={result.value.antonyms} choose={choose} />
      <p className="dictionary-source">Words from the Datamuse API.</p>
    </div>
  )
}

export default defineAddon({
  manifest,
  start(context) {
    context.styles.register('dictionary', css)
    const lookups = createLookups(context.host.network.getText)
    const richEditors = new Set<Editor>()
    const sourceViews = new Set<EditorView>()
    context.editor.registerRich({
      id: 'lookup',
      attach(editor) {
        richEditors.add(editor)
        return () => richEditors.delete(editor)
      },
    })
    context.editor.registerSource({
      id: 'lookup',
      create: async () =>
        (await import('./source')).trackSourceViews(sourceViews),
    })
    async function target(invocation: CommandExecutionContext) {
      // Palette and shortcut invocations capture the view but not its selection.
      const view = invocation.view ?? context.editorViews.getActive()
      const active = view && context.editorViews.getSelection(view)
      const selection =
        invocation.selection ?? (active?.ok ? active.value : null)
      if (!selection) return null
      const from = Math.min(selection.anchor, selection.head)
      const to = Math.max(selection.anchor, selection.head)
      if (selection.editor === 'rich') {
        for (const editor of richEditors) {
          const current = editor.state.selection
          if (
            !editor.isDestroyed &&
            editor.view.dom.isConnected &&
            current.anchor === selection.anchor &&
            current.head === selection.head
          )
            return richTarget(editor, from, to)
        }
        return null
      }
      const { sourceTarget } = await import('./source')
      for (const view of sourceViews) {
        const current = view.state.selection.main
        if (
          view.dom.isConnected &&
          current.anchor === selection.anchor &&
          current.head === selection.head
        )
          return sourceTarget(view, from, to)
      }
      return null
    }
    async function lookUp(
      invocation: CommandExecutionContext,
      kind: 'define' | 'synonyms',
    ) {
      const found = await target(invocation)
      if (!found) {
        context.notify('Place the cursor in a word or select one word.')
        return
      }
      const { word } = found
      const load =
        kind === 'define'
          ? () => lookups.define(word)
          : () => lookups.thesaurus(word)
      const choice = await context.dialogs.open<string>({
        title:
          kind === 'define' ? `Define “${word}”` : `Synonyms for “${word}”`,
        content: ({ close }) => (
          <Results word={word} kind={kind} load={load} choose={close} />
        ),
      }).result
      if (choice && !found.replace(matchCase(word, choice)))
        context.notify('The document changed. Look up the word again.')
      found.focus()
    }
    context.commands.register({
      id: 'define',
      label: 'Define word',
      keywords: 'dictionary definition meaning look up',
      menu: { location: 'editor', group: 'dictionary', order: 1 },
      run: (invocation) => lookUp(invocation, 'define'),
    })
    context.commands.register({
      id: 'synonyms',
      label: 'Find synonyms',
      keywords: 'thesaurus synonym antonym replace word',
      defaultShortcut: 'shift+f7',
      menu: { location: 'editor', group: 'dictionary', order: 2 },
      run: (invocation) => lookUp(invocation, 'synonyms'),
    })
  },
})
