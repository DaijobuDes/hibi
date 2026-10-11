import { useState } from 'react'
import { Select, SettingRow } from '../ui'
import type { LanguagePreferences } from './lookup'
import { languageNames, readPreferences, writePreferences } from './settings'

export function Settings() {
  const [value, setValue] = useState(readPreferences)
  const change = (next: Partial<LanguagePreferences>) => {
    const preferences = { ...value, ...next }
    setValue(preferences)
    writePreferences(preferences)
  }
  return (
    <>
      <SettingRow
        id="dictionary-latin"
        label="Words in Latin letters"
        description="Results in this language are shown first. Other supported languages follow when they have an entry."
      >
        <Select
          id="dictionary-latin"
          value={value.latin}
          onChange={(event) =>
            change({
              latin: event.target.value as LanguagePreferences['latin'],
            })
          }
        >
          {(['en', 'fr', 'tl'] as const).map((lang) => (
            <option key={lang} value={lang}>
              {languageNames[lang]}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        id="dictionary-han"
        label="Words in Chinese characters"
        description="Words written only in Chinese characters are looked up in this language first. Words with kana are always looked up in Japanese."
      >
        <Select
          id="dictionary-han"
          value={value.han}
          onChange={(event) =>
            change({ han: event.target.value as LanguagePreferences['han'] })
          }
        >
          {(['zh', 'yue', 'ja'] as const).map((lang) => (
            <option key={lang} value={lang}>
              {languageNames[lang]}
            </option>
          ))}
        </Select>
      </SettingRow>
    </>
  )
}
