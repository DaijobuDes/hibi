import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import {
  Ban,
  BookOpen,
  Download,
  Hourglass,
  SearchX,
  WifiOff,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  CommandExecutionContext,
  ViewTarget,
} from '../../shared/foundation-contracts'
import { defineAddon } from '../api'
import { Button, PanelMessage } from '../ui'
import css from './dictionary.css?inline'
import { detectLangs, type LookupTarget, matchCase, wordAt } from './lookup'
import manifest from './manifest'
import { datamuseProvider, wiktionaryProvider } from './online'
import {
  createRegistry,
  type Entry,
  type Gathered,
  gather,
  INSTALL_PACK_COMMAND,
  type Related,
  type Source,
} from './providers'
import { languageNames, readPreferences } from './settings'

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
    readPreferences(),
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
  'not-installed': {
    icon: <Download size={28} />,
    title: 'Offline pack not installed',
    message: 'Install the offline pack for this language, then try again.',
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
      <h4>{label}</h4>
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

const credit = (source: Source) => (
  <p className="dictionary-source">{`${source.name} · ${source.license}`}</p>
)

type Outcome = Gathered<Entry[]> | Gathered<Related>

function Results({
  word,
  kind,
  load,
  choose,
  install,
}: {
  word: string
  kind: 'define' | 'synonyms'
  load: (signal: AbortSignal) => Promise<Outcome>
  choose: (word: string) => void
  install: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Outcome | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reruns the lookup.
  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    void load(controller.signal).then((value) => {
      if (!controller.signal.aborted) setResult(value)
    })
    return () => controller.abort()
  }, [load, attempt])
  if (!result)
    return (
      <PanelMessage
        icon={<BookOpen size={28} />}
        title={`Looking up “${word}”…`}
        loading
      />
    )
  if (!result.found.length) {
    if (result.failure) {
      const failure = failures[result.failure]
      return (
        <div className="dictionary-results">
          <PanelMessage icon={failure.icon} title={failure.title} role="alert">
            {failure.message}
          </PanelMessage>
          {result.failure !== 'denied' && (
            <Button onClick={() => setAttempt(attempt + 1)}>Try again</Button>
          )}
        </div>
      )
    }
    const [missing] = result.installable
    if (missing)
      return (
        <div className="dictionary-results">
          <PanelMessage
            icon={<Download size={28} />}
            title={`${languageNames[missing]} needs an offline pack`}
          >
            {kind === 'define'
              ? 'Install an offline pack to look up words in this language.'
              : 'Install an offline pack to find synonyms in this language.'}
          </PanelMessage>
          <Button onClick={install}>Install offline pack</Button>
        </div>
      )
    return (
      <PanelMessage
        icon={<SearchX size={28} />}
        title={kind === 'define' ? 'No definitions found' : 'No synonyms found'}
      >
        {`Nothing was found for “${word}”. Check the spelling or try another form of the word.`}
      </PanelMessage>
    )
  }
  const shown = new Set<string>()
  return (
    <div className="dictionary-results">
      {result.found.map(({ lang, value }) => {
        if (!Array.isArray(value))
          return (
            <section key={lang} aria-label={languageNames[lang]}>
              <h3>{languageNames[lang]}</h3>
              <Words label="Synonyms" words={value.synonyms} choose={choose} />
              <Words label="Antonyms" words={value.antonyms} choose={choose} />
              {credit(value.source)}
            </section>
          )
        // Cantonese can share Wiktionary's Chinese entries; show them once.
        const key = (entry: Entry) => `${entry.source.name}:${entry.lang}`
        const entries = value.filter((entry) => !shown.has(key(entry)))
        for (const entry of entries) shown.add(key(entry))
        const [first] = entries
        if (!first) return null
        return (
          <section key={lang} aria-label={languageNames[first.lang]}>
            <h3>{languageNames[first.lang]}</h3>
            {entries.map((entry, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per lookup.
                key={index}
                className="dictionary-meaning"
              >
                {(entry.partOfSpeech || entry.reading) && (
                  <h4>
                    {[entry.partOfSpeech, entry.reading]
                      .filter(Boolean)
                      .join(' · ')}
                  </h4>
                )}
                <ol>
                  {entry.senses.map((sense) => (
                    <li key={sense.gloss}>
                      {sense.gloss}
                      {sense.example && (
                        <p className="dictionary-example">{sense.example}</p>
                      )}
                    </li>
                  ))}
                </ol>
                <Words
                  label="Synonyms"
                  words={entry.synonyms ?? []}
                  choose={choose}
                />
                {credit(entry.source)}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export default defineAddon({
  manifest,
  start(context) {
    context.styles.register('dictionary', css)
    const registry = createRegistry()
    registry.register(wiktionaryProvider(context.host.network.getText))
    registry.register(datamuseProvider(context.host.network.getText))
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
    // ponytail: extensions are not told which view they belong to, so split
    // panes are matched through core's `data-side`, which is also their view
    // ID. Use a view ID from core once extensions receive one.
    const inView = (dom: Element, view: ViewTarget) => {
      const pane = dom.closest<HTMLElement>('.editor-page')
      return (
        dom.isConnected &&
        !!pane &&
        (pane.dataset.side ?? view.viewId) === view.viewId
      )
    }
    async function target(invocation: CommandExecutionContext) {
      // Palette and shortcut invocations capture the view but not its selection.
      const view = invocation.view ?? context.editorViews.getActive()
      if (!view) return null
      const active = context.editorViews.getSelection(view)
      const selection =
        invocation.selection ?? (active.ok ? active.value : null)
      if (!selection) return null
      const from = Math.min(selection.anchor, selection.head)
      const to = Math.max(selection.anchor, selection.head)
      const at = (dom: Element, anchor: number, head: number) =>
        inView(dom, view) &&
        anchor === selection.anchor &&
        head === selection.head
      let found: LookupTarget | null = null
      let dom: Element | undefined
      if (selection.editor === 'rich') {
        const editor = [...richEditors].find(
          (editor) =>
            !editor.isDestroyed &&
            at(
              editor.view.dom,
              editor.state.selection.anchor,
              editor.state.selection.head,
            ),
        )
        found = editor ? richTarget(editor, from, to) : null
        dom = editor?.view.dom
      } else {
        const { sourceTarget } = await import('./source')
        const editor = [...sourceViews].find((editor) =>
          at(
            editor.dom,
            editor.state.selection.main.anchor,
            editor.state.selection.main.head,
          ),
        )
        found = editor ? sourceTarget(editor, from, to) : null
        dom = editor?.dom
      }
      if (!found || !dom) return null
      const { replace } = found
      return {
        ...found,
        // getSelection fails once the view, document, or its generation changes.
        replace: (text: string) => {
          const current = context.editorViews.getSelection(view)
          return (
            current.ok &&
            current.value.editor === selection.editor &&
            inView(dom, view) &&
            replace(text)
          )
        },
      }
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
      const langs = detectLangs(word, readPreferences())
      if (!langs.length) {
        context.notify(
          'Lookups support English, Chinese, Cantonese, Japanese, Filipino, and French.',
        )
        found.focus()
        return
      }
      const load = (signal: AbortSignal): Promise<Outcome> =>
        kind === 'define'
          ? gather(registry, langs, 'lookup', (provider, lang) =>
              provider.lookup(word, lang, signal),
            )
          : gather(
              registry,
              langs,
              'related',
              (provider, lang) =>
                provider.related?.(word, lang, signal) ?? Promise.resolve(null),
            )
      const choice = await context.dialogs.open<string>({
        title:
          kind === 'define' ? `Define “${word}”` : `Synonyms for “${word}”`,
        content: ({ close }) => (
          <Results
            word={word}
            kind={kind}
            load={load}
            choose={close}
            install={() => {
              close(null)
              void context.commands
                .execute(INSTALL_PACK_COMMAND)
                .catch(() =>
                  context.notify('Offline packs are not available yet.'),
                )
            }}
          />
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
