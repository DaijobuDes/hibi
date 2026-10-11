import { Check, CircleAlert, Info, X } from 'lucide-react'
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { sentenceCase } from '../shared/ui-case'
import { Button, IconButton } from './Controls'
import {
  createToastService,
  defaultToastPreferences,
  toastPreferences,
} from './toast-store'
import './sonner.css'

type ToastService = ReturnType<typeof createToastService>
const ToastContext = createContext<ToastService | null>(null)
export function useToastService() {
  const service = useContext(ToastContext)
  if (!service) throw new Error('toasts require a ToastProvider')
  return service
}
/** Built-ins use this hook; extensions receive lifecycle-owned context.toasts. */
export function useToasts() {
  return useToastService().api
}

/** Keep notifications interactive in the active native modal's top layer. */
export function useToastContainer(ref: RefObject<HTMLDialogElement | null>) {
  const service = useContext(ToastContext)
  useLayoutEffect(() => {
    service?.setContainer(ref.current)
    return () => service?.setContainer(null)
  }, [service, ref])
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [service] = useState(() => {
    let initial = defaultToastPreferences
    try {
      initial = toastPreferences(
        JSON.parse(localStorage.getItem('toast-preferences') ?? '{}'),
      )
    } catch {
      /* Use defaults for unreadable preferences. */
    }
    return createToastService(initial, (preferences) =>
      localStorage.setItem('toast-preferences', JSON.stringify(preferences)),
    )
  })
  useLayoutEffect(() => {
    service.start()
    return () => service.stop()
  }, [service])
  return (
    <ToastContext.Provider value={service}>
      {children}
      <Sonner />
    </ToastContext.Provider>
  )
}

/** The single notification stack, shared by the app and every extension. */
export function Sonner() {
  const service = useToastService()
  const { items, preferences, container } = useSyncExternalStore(
    service.subscribe,
    service.snapshot,
  )
  const element = useRef<HTMLElement>(null)
  // Escape and finished actions return focus to where keyboard users came from.
  const returnFocus = useRef<Element | null>(null)
  const restoreFocus = () => {
    const previous = returnFocus.current
    if (
      element.current?.contains(document.activeElement) &&
      previous instanceof HTMLElement &&
      previous.isConnected
    )
      previous.focus()
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the portal container creates a new popover element.
  useLayoutEffect(() => {
    const node = element.current
    if (items.length && node && !node.matches(':popover-open'))
      node.showPopover()
  }, [items.length, container])
  if (!items.length) return null
  return createPortal(
    <section
      ref={element}
      popover="manual"
      className="sonner"
      data-position={preferences.position}
      aria-label="Notifications"
      onFocus={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          returnFocus.current = event.relatedTarget
      }}
      // Buttons stay out of the Tab order; once Focus notifications enters the
      // stack, arrows cycle its buttons and Tab past either end returns focus.
      onKeyDown={(event) => {
        const step = {
          ArrowDown: 1,
          ArrowRight: 1,
          ArrowUp: -1,
          ArrowLeft: -1,
          Tab: event.shiftKey ? -1 : 1,
        }[event.key]
        if (!step || event.altKey || event.ctrlKey || event.metaKey) return
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            '.toast:not([data-closing="true"]) button',
          ),
        ]
        const index = buttons.indexOf(document.activeElement as HTMLElement)
        if (index < 0) return
        event.preventDefault()
        const next = index + step
        if (event.key === 'Tab' && (next < 0 || next >= buttons.length))
          restoreFocus()
        else buttons[(next + buttons.length) % buttons.length].focus()
      }}
    >
      {items.map((item) => {
        const Icon =
          item.variant === 'error'
            ? CircleAlert
            : item.variant === 'success'
              ? Check
              : Info
        const message = sentenceCase(item.message)
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: the action button gives keyboard users the same target as clicking the notification.
          <div
            key={item.id}
            className="toast"
            data-closing={item.closing}
            data-variant={item.variant ?? 'info'}
            data-action={!!item.action}
            onClick={
              item.action
                ? () => {
                    try {
                      service.select(item.id)
                    } finally {
                      restoreFocus()
                    }
                  }
                : undefined
            }
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              service.dismiss(item.id)
              restoreFocus()
            }}
            onPointerEnter={() => service.pause(item.id, 'hover', true)}
            onPointerLeave={() => service.pause(item.id, 'hover', false)}
            onFocusCapture={() => service.pause(item.id, 'focus', true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                service.pause(item.id, 'focus', false)
            }}
          >
            <Icon className="toast-icon" aria-hidden="true" />
            <div
              className="toast-copy"
              role={item.variant === 'error' ? 'alert' : 'status'}
              aria-atomic="true"
            >
              <span>{message}</span>
              {item.description && <p>{sentenceCase(item.description)}</p>}
              {item.action && (
                <Button
                  variant="ghost"
                  className="toast-action"
                  tabIndex={-1}
                  aria-label={`${/[.!?…]$/.test(message) ? message : `${message}.`} ${sentenceCase(item.action.label)}.`}
                >
                  {sentenceCase(item.action.label)}
                </Button>
              )}
            </div>
            <IconButton
              tabIndex={-1}
              aria-label={
                item.variant === 'error' ? 'Dismiss error' : 'Dismiss notice'
              }
              onClick={(event) => {
                event.stopPropagation()
                service.dismiss(item.id)
                restoreFocus()
              }}
            >
              <X aria-hidden="true" />
            </IconButton>
            {item.duration > 0 && (
              <div
                key={item.revision}
                className="toast-progress"
                aria-hidden="true"
                data-paused={!!item.paused.size}
                style={
                  {
                    '--toast-progress': item.remaining / item.duration,
                    '--toast-remaining': `${item.remaining}ms`,
                  } as CSSProperties
                }
              />
            )}
          </div>
        )
      })}
    </section>,
    container ?? document.body,
  )
}
