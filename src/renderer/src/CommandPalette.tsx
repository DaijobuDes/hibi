import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type PaletteCommand = {
  id: string
  label: string
  shortcut?: string
  run: () => void
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[]
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const closing = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const terms = query.toLowerCase().trim().split(/\s+/)
  const results = commands.filter((command) =>
    terms.every((term) => command.label.toLowerCase().includes(term)),
  )
  const active = Math.min(selected, results.length - 1)
  const activeId = results[active]?.id

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    input.current?.focus()
    return () => {
      clearTimeout(closeTimer.current)
      element?.close()
    }
  }, [])

  useEffect(() => {
    if (activeId)
      window.document
        .getElementById(`command-${activeId}`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function close(after?: () => void) {
    if (closing.current) return
    closing.current = true
    const finish = () => {
      dialog.current?.close()
      onClose()
      if (after) requestAnimationFrame(after)
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish()
    else {
      dialog.current?.classList.add('closing')
      closeTimer.current = setTimeout(finish, 140)
    }
  }

  function execute(command: PaletteCommand) {
    close(command.run)
  }

  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-label="command palette"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close()
      }}
    >
      <div className="command-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label="search commands"
          aria-expanded="true"
          aria-controls="command-results"
          aria-autocomplete="list"
          aria-activedescendant={
            results[active] ? `command-${results[active].id}` : undefined
          }
          placeholder="type a command…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (results.length)
                setSelected(
                  (active +
                    (event.key === 'ArrowDown' ? 1 : results.length - 1)) %
                    results.length,
                )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const command = results[active]
              if (command) execute(command)
            }
          }}
        />
      </div>
      <div
        id="command-results"
        className="command-results"
        role="listbox"
        aria-label="commands"
      >
        {results.map((command, index) => (
          <div
            key={command.id}
            id={`command-${command.id}`}
            role="option"
            aria-selected={index === active}
            tabIndex={-1}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => execute(command)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') execute(command)
            }}
          >
            <span>{command.label}</span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </div>
        ))}
      </div>
      {results.length === 0 && (
        <p className="commands-empty" role="status">
          no commands found.
        </p>
      )}
    </dialog>
  )
}
