import { useMemo, useState } from 'react'
import { isMarkdownDocument } from '../../shared/document-types'
import type { AddonContext } from '../api'
import { Button, ControlRow, Panel, TextInput } from '../ui'
import { useWorkspaceSnapshot } from '../workspace-snapshot'
import { noteTags } from './syntax'

export function TagsPanel({
  context,
  initialTag,
  close,
}: {
  context: AddonContext
  initialTag?: string | undefined
  close: () => void
}) {
  const { snapshot, workspace, loading, error, refresh } =
    useWorkspaceSnapshot(context)
  const [query, setQuery] = useState('')
  const [selected, select] = useState(initialTag ?? '')
  const index = useMemo(() => {
    const tags = new Map<string, string[]>()
    for (const page of snapshot?.pages ?? []) {
      if (!isMarkdownDocument(page.path)) continue
      for (const tag of noteTags(page.markdown))
        tags.set(tag, [...(tags.get(tag) ?? []), page.path])
    }
    return [...tags].sort(([a], [b]) => a.localeCompare(b))
  }, [snapshot])
  const matches = index.filter(([tag]) =>
    tag.includes(query.trim().replace(/^#/, '').toLowerCase()),
  )
  const files = index.find(([tag]) => tag === selected)?.[1] ?? []
  return (
    <Panel className="tags-panel">
      <ControlRow className="tags-controls">
        <TextInput
          type="search"
          aria-label="filter tags"
          placeholder="filter tags…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button onClick={refresh} disabled={loading}>
          refresh
        </Button>
      </ControlRow>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">reading tags…</p>
      ) : !workspace ? (
        <Button onClick={() => void context.workspace.open().then(refresh)}>
          open a folder
        </Button>
      ) : (
        <div className="tags-browser">
          <section className="tags-list" aria-label="workspace tags">
            {matches.map(([tag, paths]) => (
              <Button
                variant="row"
                key={tag}
                aria-pressed={selected === tag}
                onClick={() => select(tag)}
              >
                <span>#{tag}</span>
                <span>{paths.length}</span>
              </Button>
            ))}
            {!matches.length && (
              <p>no tags found. write #tag in a note to add one.</p>
            )}
          </section>
          <section
            className="tags-files"
            aria-label={selected ? `notes tagged #${selected}` : 'tagged notes'}
          >
            <p>
              {selected
                ? `#${selected} · ${files.length} ${files.length === 1 ? 'note' : 'notes'}`
                : 'select a tag to see its notes.'}
            </p>
            {files.map((path) => (
              <Button
                variant="row"
                key={path}
                onClick={() => {
                  close()
                  void context.workspace.openFile(path)
                }}
              >
                {path}
              </Button>
            ))}
          </section>
        </div>
      )}
    </Panel>
  )
}
