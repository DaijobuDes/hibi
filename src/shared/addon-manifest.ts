import {
  ADDON_API_VERSION,
  type AddonManifest,
  compatibleAddonManifest,
} from '../addons/api'
import { parseAddonRequirements } from './addon-dependencies'
import { validCommandMenu } from './addon-hotkeys'
import { validAddonPath as validPath } from './addon-package'
import { type ColorschemeInput, defineColorscheme } from './colorschemes'
import { parseDependencies } from './dependencies'
import { validDocumentExtensions } from './document-types'
import { parseAddonNetwork } from './host-network'
import { parseSyntaxDescriptors } from './preservation'

export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)

function settingsMetadata(
  value: unknown,
): NonNullable<AddonManifest['settings']> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The addon settings metadata is invalid.')
  const { category, icon } = value as Record<string, unknown>
  if (
    [category, icon].some(
      (field) =>
        field !== undefined &&
        (typeof field !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(field)),
    )
  )
    throw new Error('The addon settings category or icon is invalid.')
  return {
    ...(typeof category === 'string' ? { category } : {}),
    ...(typeof icon === 'string' ? { icon } : {}),
  }
}

export function parseAddonManifest(value: unknown): {
  manifest: AddonManifest
  entry: string
  themes: ColorschemeInput[]
} {
  if (!value || typeof value !== 'object')
    throw new Error('The addon details in hibi-addon.json are invalid.')
  const data = value as Record<string, unknown>
  const string = (value: unknown, max: number): value is string =>
    typeof value === 'string' && !!value.trim() && value.length <= max
  if (
    !validId(data.id) ||
    !string(data.name, 100) ||
    !string(data.description, 500) ||
    !compatibleAddonManifest(data) ||
    !['theme', 'extension'].includes(String(data.kind)) ||
    !string(data.version, 40) ||
    !Array.isArray(data.authors) ||
    !data.authors.length ||
    data.authors.length > 20 ||
    data.authors.some(
      (author) =>
        !author ||
        !string(author.displayName, 100) ||
        (author.discordId !== undefined &&
          (typeof author.discordId !== 'string' ||
            !/^\d{5,24}$/.test(author.discordId))) ||
        (author.github !== undefined &&
          (typeof author.github !== 'string' ||
            !/^[a-z\d-]{1,39}$/i.test(author.github))) ||
        (author.role !== undefined && !string(author.role, 100)),
    )
  )
    throw new Error(
      'The addon needs an ID, kind, API version, version, description, and authors in hibi-addon.json.',
    )
  if (
    data.licenses !== undefined &&
    (!Array.isArray(data.licenses) ||
      data.licenses.length > 50 ||
      data.licenses.some(
        (license) =>
          !license ||
          !validId(license.id) ||
          !string(license.name, 100) ||
          !string(license.license, 100) ||
          !string(license.text, 32000),
      ))
  )
    throw new Error('The addon license details are invalid.')
  if (
    data.fileExtensions !== undefined &&
    (data.kind === 'theme' || !validDocumentExtensions(data.fileExtensions))
  )
    throw new Error('The addon lists invalid file extensions.')
  if (
    data.capabilities !== undefined &&
    (!Array.isArray(data.capabilities) ||
      data.capabilities.length > 4 ||
      new Set(data.capabilities).size !== data.capabilities.length ||
      data.capabilities.some(
        (value) => !['ui', 'rich', 'source', 'markdown'].includes(value),
      ))
  )
    throw new Error('The addon lists invalid SDK capabilities.')
  if (
    data.activation !== undefined &&
    !['command', 'source', 'rich'].includes(String(data.activation))
  )
    throw new Error('The addon activation mode is invalid.')
  if (
    data.commands !== undefined &&
    (!Array.isArray(data.commands) ||
      data.commands.length > 64 ||
      new Set(data.commands.map((command) => command?.id)).size !==
        data.commands.length ||
      data.commands.some(
        (command) =>
          !command ||
          !validId(command.id) ||
          !string(command.label, 100) ||
          (command.keywords !== undefined && !string(command.keywords, 300)) ||
          (command.menu !== undefined && !validCommandMenu(command.menu)),
      ))
  )
    throw new Error('The addon command descriptors are invalid.')
  if (
    data.activation === 'command' &&
    (!Array.isArray(data.commands) || !data.commands.length)
  )
    throw new Error('Command-activated addons must declare their commands.')
  if (data.activation !== undefined && data.capabilities === undefined)
    throw new Error(
      'Declare SDK capabilities before choosing an activation mode.',
    )
  const requires = parseAddonRequirements(data.requires, data.id)
  const base: AddonManifest = {
    id: data.id,
    name: data.name,
    description: data.description,
    apiVersion: ADDON_API_VERSION,
    kind: data.kind as 'theme' | 'extension',
    version: data.version,
    authors: data.authors,
    defaultEnabled: false,
    ...(data.network === undefined
      ? {}
      : { network: parseAddonNetwork(data.network) }),
    ...(data.dependencies === undefined
      ? {}
      : { dependencies: parseDependencies(data.dependencies) }),
    ...(requires === undefined ? {} : { requires }),
    ...(data.settings === undefined
      ? {}
      : { settings: settingsMetadata(data.settings) }),
    ...(data.analysis === undefined
      ? {}
      : { analysis: parseAnalysis(data.analysis) }),
    ...(data.syntax === undefined
      ? {}
      : { syntax: parseSyntaxDescriptors(data.syntax)! }),
    ...(data.capabilities === undefined
      ? {}
      : {
          capabilities: data.capabilities as NonNullable<
            AddonManifest['capabilities']
          >,
        }),
    ...(data.activation === undefined
      ? {}
      : {
          activation: data.activation as NonNullable<
            AddonManifest['activation']
          >,
        }),
    ...(data.commands === undefined
      ? {}
      : { commands: data.commands as NonNullable<AddonManifest['commands']> }),
    ...(data.startup === 'background'
      ? { startup: 'background' as const }
      : {}),
    ...(data.fileExtensions !== undefined
      ? {
          fileExtensions: data.fileExtensions,
        }
      : {}),
    ...(data.licenses
      ? { licenses: data.licenses as NonNullable<AddonManifest['licenses']> }
      : {}),
  }
  if (base.kind === 'theme') {
    if (
      data.analysis !== undefined ||
      data.syntax !== undefined ||
      data.capabilities !== undefined ||
      data.activation !== undefined ||
      data.commands !== undefined ||
      data.dependencies !== undefined ||
      data.entry !== undefined ||
      !Array.isArray(data.themes) ||
      !data.themes.length ||
      data.themes.length > 20
    )
      throw new Error(
        'Themes must contain color schemes without executable code.',
      )
    const themes = data.themes.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !value.colors ||
        typeof value.colors !== 'object'
      )
        throw new Error('This theme has an invalid color scheme.')
      return defineColorscheme(value as ColorschemeInput)
    })
    if (
      themes.some((theme) => !validId(theme.id)) ||
      new Set(themes.map((theme) => theme.id)).size !== themes.length
    )
      throw new Error('Each theme needs a valid, unique ID.')
    base.licenses = [
      ...(base.licenses ?? []),
      ...themes.map((theme) => ({
        id: `theme-${theme.id}`,
        name: theme.name,
        license: theme.license.name,
        text: theme.license.text,
      })),
    ]
    return { manifest: base, entry: '', themes }
  }
  if (!validPath(data.entry) || !/\.(m?js)$/.test(data.entry))
    throw new Error(
      'The extension entry must point to a .js or .mjs file inside the addon folder.',
    )
  return { manifest: base, entry: data.entry, themes: [] }
}
function parseAnalysis(value: unknown): { entry: string } {
  const entry =
    value && typeof value === 'object'
      ? (value as { entry?: unknown }).entry
      : undefined
  if (!validPath(entry) || !/\.m?js$/.test(entry))
    throw new Error(
      'The analysis entry must be a JavaScript module inside the addon folder.',
    )
  return { entry }
}
