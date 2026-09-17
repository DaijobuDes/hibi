export const MAX_ADDON_BYTES = 25 * 1024 * 1024
export const MAX_ADDON_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ADDON_ENTRIES = 1000

export function validAddonPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length < 2048 &&
    value
      .split('/')
      .every(
        (part) =>
          !!part &&
          !part.startsWith('.') &&
          !/[\\:?%#<>"|*]|\p{Cc}/u.test(part),
      )
  )
}

export function addonPackageUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 8192)
    throw new Error(
      'enter an https url to an addon zip package or git repository.',
    )
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('use an https url without embedded credentials.')
  url.hash = ''
  return url
}
