import { ArrowUpRight, ChevronRight, File, Heart } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LicenseInfo } from '../../shared/about'
import type { AppInfo } from '../../shared/desktop'
import { Button, SettingRow } from '../../ui/Controls'
import { useDialogs } from '../../ui/DialogProvider'
import './hibi-settings.css'

function LicenseText({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void window.hibi.getLicense(id).then(
      (value) => {
        if (active) setText(value)
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [id])
  if (failed)
    return <p role="alert">this license could not load. close and try again.</p>
  if (text === null) return <p role="status">loading license…</p>
  return <pre className="license-text">{text}</pre>
}

export function HibiSettings({ info }: { info: AppInfo | null }) {
  const dialogs = useDialogs()
  const [licenses, setLicenses] = useState<LicenseInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [sponsoring, setSponsoring] = useState(false)
  useEffect(() => {
    let active = true
    void window.hibi.getLicenses().then(
      (value) => {
        if (active) setLicenses(value)
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [])
  async function sponsor() {
    setSponsoring(true)
    try {
      await window.hibi.openSponsor()
    } catch {
      void dialogs.alert({
        title: 'could not open your browser',
        description: 'try again, or visit github.com/sponsors/schmayterling.',
        confirmLabel: 'close',
      })
    } finally {
      setSponsoring(false)
    }
  }
  return (
    <>
      <h1>hibi</h1>
      <div className="settings-group hibi-about">
        <div className="hibi-identity">
          <span className="hibi-mark" aria-hidden="true">
            <File size={28} strokeWidth={1.25} />
          </span>
          <div>
            <div className="hibi-name">hibi</div>
            <p>version {info?.version ?? '…'}</p>
          </div>
          <span className="hibi-description">
            a quiet place to write markdown.
          </span>
        </div>
        <p className="hibi-credit">
          made with <Heart size={12} aria-label="love" /> by may{' '}
          <span aria-hidden="true">·</span> © {new Date().getFullYear()}
        </p>
        <SettingRow
          id="sponsor-project"
          label="support hibi"
          description="help keep the project growing."
        >
          <Button
            id="sponsor-project"
            aria-label="sponsor on github"
            aria-describedby="sponsor-project-description"
            className="sponsor-button"
            disabled={sponsoring}
            onClick={() => void sponsor()}
          >
            sponsor on github <ArrowUpRight aria-hidden="true" />
          </Button>
        </SettingRow>
      </div>
      <h2 id="open-source-licenses">open source licenses</h2>
      <section
        className="settings-group license-list"
        aria-labelledby="open-source-licenses"
      >
        {failed ? (
          <p role="alert">
            licenses could not load. reopen this page to try again.
          </p>
        ) : licenses === null ? (
          <p role="status">loading licenses…</p>
        ) : (
          licenses.map((license) => (
            <button
              key={license.id}
              className="ui-action-row license-row"
              type="button"
              aria-haspopup="dialog"
              onClick={() =>
                dialogs.open({
                  title: license.name,
                  description: [license.version, license.license]
                    .filter(Boolean)
                    .join(' · '),
                  size: 'wide',
                  content: () => <LicenseText id={license.id} />,
                })
              }
            >
              <span className="license-name">
                {license.name}
                {license.version && (
                  <span className="license-version">{license.version}</span>
                )}
              </span>
              <span className="license-type">{license.license}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))
        )}
      </section>
    </>
  )
}
