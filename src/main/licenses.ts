import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LicenseInfo } from '../shared/about'
import { getAddonLicenses } from './addons'

let catalog: Promise<(LicenseInfo & { text: string })[]> | undefined
function load() {
  catalog ??= readFile(join(import.meta.dirname, '../licenses.json'), 'utf8')
    .then((text) => [...JSON.parse(text), ...getAddonLicenses()])
    .catch((error) => {
      catalog = undefined
      throw error
    })
  return catalog
}
export async function listLicenses(): Promise<LicenseInfo[]> {
  return (await load()).map(({ text: _text, ...info }) => info)
}
export async function readLicense(id: unknown): Promise<string> {
  if (typeof id !== 'string') throw new Error('invalid license id')
  const license = (await load()).find((entry) => entry.id === id)
  if (!license) throw new Error('unknown license')
  return license.text
}
