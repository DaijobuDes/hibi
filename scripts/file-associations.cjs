const { writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const {
  fileAssociations,
  DESKTOP_APP_ID,
} = require('../src/shared/file-associations.ts')

const associations = Object.values(fileAssociations).map((format) => ({
  ...format,
  role: 'Editor',
  rank: 'Alternate',
}))

// Advertise Open With without replacing existing extension defaults on install.
function windowsRegistration() {
  const install = []
  const uninstall = []
  const quote = (value) => `"${value.replaceAll('"', '$\\"')}"`
  const write = (key, name, value) =>
    install.push(
      `  WriteRegStr SHELL_CONTEXT ${quote(key)} ${quote(name)} ${quote(value)}`,
    )
  const remove = (key) =>
    uninstall.push(`  DeleteRegKey SHELL_CONTEXT ${quote(key)}`)
  const filename = `\${APP_EXECUTABLE_FILENAME}` // NSIS compile-time variable.
  const executable = `$INSTDIR\\${filename}`
  const command = `"${executable}" "%1"`
  const capabilities = `Software\\${DESKTOP_APP_ID}\\Capabilities`
  write(capabilities, 'ApplicationName', 'hibi')
  write(capabilities, 'ApplicationDescription', 'Document editor')
  write(capabilities, 'ApplicationIcon', `${executable},0`)
  write('Software\\RegisteredApplications', DESKTOP_APP_ID, capabilities)
  uninstall.push(
    `  DeleteRegValue SHELL_CONTEXT "Software\\RegisteredApplications" "${DESKTOP_APP_ID}"`,
  )
  remove(capabilities)
  const application = `Software\\Classes\\Applications\\${filename}`
  write(`${application}\\shell\\open\\command`, '', command)
  write(application, 'FriendlyAppName', 'hibi')
  remove(application)
  for (const format of associations) {
    for (const ext of format.ext) {
      const progId = `${DESKTOP_APP_ID}.${ext}`
      const key = `Software\\Classes\\${progId}`
      write(key, '', `${format.name} document`)
      write(`${key}\\DefaultIcon`, '', `${executable},0`)
      write(`${key}\\shell\\open\\command`, '', command)
      write(`${application}\\SupportedTypes`, `.${ext}`, '')
      write(`${capabilities}\\FileAssociations`, `.${ext}`, progId)
      write(`Software\\Classes\\.${ext}\\OpenWithProgids`, progId, '')
      remove(key)
      uninstall.push(
        `  DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${ext}\\OpenWithProgids" "${progId}"`,
      )
    }
  }
  return `!macro customInstall\n${install.join('\n')}\n!macroend\n\n!macro customUnInstall\n${uninstall.join('\n')}\n!macroend\n`
}

module.exports = {
  mac: { fileAssociations: associations },
  linux: {
    fileAssociations: associations,
    syncDesktopName: true,
  },
  nsis: { include: resolve(__dirname, '../out/file-associations.nsh') },
  beforePack: async ({ electronPlatformName }) => {
    if (electronPlatformName === 'win32')
      await writeFile(
        resolve(__dirname, '../out/file-associations.nsh'),
        windowsRegistration(),
      )
  },
}
