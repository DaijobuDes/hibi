const AUTO_SWITCH_KEY = 'modal-editing:auto-switch'
const SETTINGS_EVENT = 'hibi:modal-editing-settings'

export function automaticModalSwitching() {
  return localStorage.getItem(AUTO_SWITCH_KEY) === 'true'
}

export function setAutomaticModalSwitching(enabled: boolean) {
  localStorage.setItem(AUTO_SWITCH_KEY, String(enabled))
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

export function onModalEditingSettings(listener: () => void) {
  window.addEventListener(SETTINGS_EVENT, listener)
  return () => window.removeEventListener(SETTINGS_EVENT, listener)
}
