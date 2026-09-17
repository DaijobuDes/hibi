import { ArrowUpRight, ChevronRight, File, Heart } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LicenseInfo } from '../../shared/about'
import type { AppInfo } from '../../shared/desktop'
import { Button, SettingRow } from '../../ui/Controls'
import { useDialogs } from '../../ui/DialogProvider'
import { Modal } from '../../ui/Modal'
import { RecoveryScreen } from './RecoveryScreen'
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
    return <p role="alert">This license could not load. close and try again.</p>
  if (text === null) return <p role="status">Loading license…</p>
  return <pre className="license-text">{text}</pre>
}

export function HibiSettings({ info }: { info: AppInfo | null }) {
  const dialogs = useDialogs()
  const [licenses, setLicenses] = useState<LicenseInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [sponsoring, setSponsoring] = useState(false)
  const [preview, setPreview] = useState(false)
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
        title: 'Could not open your browser',
        description: 'Try again, or visit GitHub.com/sponsors/schmayterling.',
        confirmLabel: 'Close',
      })
    } finally {
      setSponsoring(false)
    }
  }
  return (
    <>
      <h1>Hibi</h1>
      <div className="settings-group hibi-about">
        <div className="hibi-identity">
          <span className="hibi-mark" aria-hidden="true">
            <File size={28} strokeWidth={1.25} />
          </span>
          <div>
            <div className="hibi-name">Hibi</div>
            <p>Version {info?.version ?? '…'}</p>
          </div>
          <span className="hibi-description">
            A quiet place to write Markdown.
          </span>
        </div>
        <p className="hibi-credit">
          Made with <Heart size={12} aria-label="Love" /> by may{' '}
          <span aria-hidden="true">·</span> © {new Date().getFullYear()}
        </p>
        <SettingRow
          id="sponsor-project"
          label="Support Hibi"
          description="Help keep the project growing."
        >
          <Button
            id="sponsor-project"
            aria-label="Sponsor on GitHub"
            aria-describedby="sponsor-project-description"
            className="sponsor-button"
            disabled={sponsoring}
            onClick={() => void sponsor()}
          >
            Sponsor on GitHub <ArrowUpRight aria-hidden="true" />
          </Button>
        </SettingRow>
      </div>
      <h2>Diagnostics</h2>
      <div className="settings-group">
        <SettingRow
          id="recovery-preview"
          label="Explode screen"
          description="Preview the recovery screen without interrupting your document."
        >
          <Button
            id="recovery-preview"
            aria-label="Preview explode screen"
            onClick={() => setPreview(true)}
          >
            Preview explode screen
          </Button>
        </SettingRow>
      </div>
      {preview && (
        <Modal
          className="recovery-preview"
          aria-label="Recovery preview"
          onDismiss={() => setPreview(false)}
        >
          <RecoveryScreen
            error={new Error('preview: this is an example error.')}
            onBack={() => setPreview(false)}
          />
        </Modal>
      )}
      <h2 id="open-source-licenses">Open source licenses</h2>
      <section
        className="settings-group license-list"
        aria-labelledby="open-source-licenses"
      >
        {failed ? (
          <p role="alert">
            Licenses could not load. reopen this page to try again.
          </p>
        ) : licenses === null ? (
          <p role="status">Loading licenses…</p>
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
