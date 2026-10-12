import { useState, useSyncExternalStore } from 'react'
import { Button, ControlRow, Select, TextArea, TextInput } from '../ui'
import {
  addCustomWord,
  type CustomWord,
  editCustomWord,
  exportCustomWords,
  importCustomWords,
  listCustomWords,
  mergeCustomWords,
  onCustomWordsChanged,
  sameCustomWord,
  updateCustomWords,
} from './custom-words'
import { LANGS, type Lang } from './providers'
import { languageNames } from './settings'

const failed = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not save custom words.'

export function CustomWords() {
  const words = useSyncExternalStore(onCustomWordsChanged, listCustomWords)
  const [draft, setDraft] = useState('')
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const edit = (
    original: CustomWord,
    change: (current: CustomWord) => CustomWord,
  ) =>
    editCustomWord(original, change)
      .then(() => setMessage(''))
      .catch((error) => setMessage(failed(error)))
  return (
    <section
      className="dictionary-custom-words"
      aria-labelledby="dictionary-custom-words"
    >
      <h3 id="dictionary-custom-words">Custom words</h3>
      <p>
        Words you add are shown as your word in lookups and come first in
        suggestions. They stay on this computer and are never sent online.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          addCustomWord({ word: draft })
            .then(() => {
              setDraft('')
              setMessage('')
            })
            .catch((error) => setMessage(failed(error)))
        }}
      >
        <ControlRow>
          <TextInput
            aria-label="New custom word"
            placeholder="Add a word…"
            maxLength={64}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={!draft.trim()}>
            Add
          </Button>
        </ControlRow>
      </form>
      {words.length ? (
        <ul>
          {words.map((item) => (
            <li key={`${item.word}\u0000${item.lang ?? ''}`}>
              <span className="dictionary-custom-word" lang={item.lang}>
                {item.word}
              </span>
              <Select
                aria-label={`Language of “${item.word}”`}
                value={item.lang ?? ''}
                onChange={(event) => {
                  const lang = event.target.value as Lang | ''
                  void edit(item, ({ lang: _old, ...rest }) =>
                    lang ? { ...rest, lang } : rest,
                  )
                }}
              >
                <option value="">Any language</option>
                {LANGS.map((lang) => (
                  <option key={lang} value={lang}>
                    {languageNames[lang]}
                  </option>
                ))}
              </Select>
              <TextInput
                aria-label={`Note for “${item.word}”`}
                placeholder="Note or definition"
                maxLength={2000}
                defaultValue={item.note ?? ''}
                onBlur={(event) => {
                  const note = event.target.value.trim()
                  if (note === (item.note ?? '')) return
                  void edit(item, ({ note: _old, ...rest }) =>
                    note ? { ...rest, note } : rest,
                  )
                }}
              />
              <Button
                variant="ghost"
                aria-label={`Remove “${item.word}”`}
                onClick={() =>
                  updateCustomWords((current) =>
                    current.filter((other) => !sameCustomWord(other, item)),
                  )
                    .then(() => setMessage(''))
                    .catch((error) => setMessage(failed(error)))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No custom words yet.</p>
      )}
      <TextArea
        aria-label="Custom words as text"
        placeholder="One word per line. Add a tab, a language code such as en, and a note to keep them."
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <ControlRow>
        <Button
          onClick={() => {
            const exported = exportCustomWords(words)
            setText(exported)
            void navigator.clipboard
              ?.writeText(exported)
              .then(() => setMessage('Copied your words as text.'))
              .catch(() => setMessage('Select the text to copy it.'))
          }}
        >
          Export as text
        </Button>
        <Button
          disabled={!text.trim()}
          onClick={() => {
            const imported = importCustomWords(text)
            if (!imported.length) {
              setMessage('No words were found in the text.')
              return
            }
            updateCustomWords((current) => mergeCustomWords(current, imported))
              .then(() => {
                setText('')
                setMessage(
                  imported.length === 1
                    ? 'Imported 1 word.'
                    : `Imported ${imported.length} words.`,
                )
              })
              .catch((error) => setMessage(failed(error)))
          }}
        >
          Import text
        </Button>
      </ControlRow>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
