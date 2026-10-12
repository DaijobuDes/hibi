import { useState } from 'react'
import { Select, SettingRow, Toggle } from '../ui'
import { CustomWords } from './CustomWords'
import { type LanguagePreferences, latinLangs } from './lookup'
import { PackSettings } from './PackSettings'
import { languageNames, readPreferences, writePreferences } from './settings'
import { readTyping, type TypingPreferences, writeTyping } from './suggestions'

export function Settings() {
  const [value, setValue] = useState(readPreferences)
  const [typing, setTyping] = useState(readTyping)
  const changeTyping = (next: Partial<TypingPreferences>) => {
    const preferences = { ...typing, ...next }
    setTyping(preferences)
    writeTyping(preferences)
  }
  const change = (next: Partial<LanguagePreferences>) => {
    const preferences = { ...value, ...next }
    setValue(preferences)
    writePreferences(preferences)
  }
  return (
    <>
      <div className="settings-group">
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
            {(['en', 'fr', 'de', 'tl'] as const).map((lang) => (
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
        <SettingRow
          id="dictionary-suggest"
          label="Suggest words as you type"
          description="Offers completions for the word you are typing from installed offline packs. Nothing is sent online."
        >
          <Toggle
            id="dictionary-suggest"
            checked={typing.suggest}
            onChange={(event) =>
              changeTyping({ suggest: event.target.checked })
            }
          />
        </SettingRow>
        <SettingRow
          id="dictionary-suggest-languages"
          label="Suggestion languages"
          description="Suggestions come from the installed packs of every language turned on here, so mixed-language writing works. Words that match what you typed best come first, then languages in the order you turned them on."
        >
          <fieldset
            id="dictionary-suggest-languages"
            className="dictionary-suggest-languages"
            aria-label="Suggestion languages"
            disabled={!typing.suggest}
          >
            {latinLangs.map((lang) => {
              const on = typing.languages.includes(lang)
              return (
                <label key={lang} htmlFor={`dictionary-suggest-${lang}`}>
                  <Toggle
                    id={`dictionary-suggest-${lang}`}
                    checked={on}
                    // At least one language stays on.
                    disabled={on && typing.languages.length === 1}
                    onChange={(event) =>
                      changeTyping({
                        languages: event.target.checked
                          ? [...typing.languages, lang]
                          : typing.languages.filter((item) => item !== lang),
                      })
                    }
                  />
                  {languageNames[lang]}
                </label>
              )
            })}
          </fieldset>
        </SettingRow>
        <SettingRow
          id="dictionary-tab-accepts"
          label="Accept suggestions with Tab"
          description="When suggestions are showing, Tab inserts the highlighted word. Enter always does. Without suggestions, Tab works as usual."
        >
          <Toggle
            id="dictionary-tab-accepts"
            checked={typing.suggest && typing.tabAccepts}
            disabled={!typing.suggest}
            onChange={(event) =>
              changeTyping({ tabAccepts: event.target.checked })
            }
          />
        </SettingRow>
      </div>
      <CustomWords />
      <h2>Offline language packs</h2>
      <PackSettings />
    </>
  )
}
