import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inventoryAddonDirectory } from '../src/main/addon-inventory.ts'
import {
  addonFileHashes,
  parseAddonRevocations,
  verifyAddonSignature,
} from '../src/main/addon-trust-crypto.ts'
import { ADDON_SIGNATURE_FILE } from '../src/shared/addon-trust.ts'

export function signingKey(pem) {
  const privateKey = createPrivateKey(pem)
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('Signing requires an Ed25519 private key.')
  const publicKey = createPublicKey(privateKey).export({ format: 'jwk' })
  const raw = Buffer.from(publicKey.x, 'base64url')
  const keyId = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  return { privateKey, keyId, keys: { [keyId]: raw.toString('base64') } }
}

export function signEnvelope(statement, key) {
  const bytes = Buffer.from(JSON.stringify(statement), 'utf8')
  return {
    keyId: key.keyId,
    statement: bytes.toString('base64'),
    signature: sign(null, bytes, key.privateKey).toString('base64'),
  }
}

async function main() {
  const [command, input, ...options] = process.argv.slice(2)
  const flag = (name) => {
    const index = options.indexOf(name)
    if (index < 0 || !options[index + 1]) throw new Error(`Missing ${name}.`)
    return options[index + 1]
  }
  const write = (path, value) =>
    writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  if (!input || !['sign', 'revocations', 'verify'].includes(command))
    throw new Error(
      'Usage: sign <folder> --key <pem> | revocations <list.json> --key <pem> --out <file> | verify <folder>',
    )
  if (command === 'verify') {
    const inventory = await inventoryAddonDirectory(resolve(input))
    const manifest = JSON.parse(
      (await inventory.read('hibi-addon.json')).toString('utf8'),
    )
    const trust = await verifyAddonSignature(inventory, '', manifest)
    if (trust.status !== 'signed')
      throw new Error(
        trust.status === 'invalid' ? trust.reason : 'Unsigned addon.',
      )
    console.log(`signed by ${trust.keyId}`)
    return
  }
  const key = signingKey(await readFile(flag('--key')))
  if (command === 'revocations') {
    const statement = JSON.parse(await readFile(input, 'utf8'))
    const envelope = signEnvelope(statement, key)
    parseAddonRevocations(envelope, key.keys)
    await write(flag('--out'), envelope)
    return
  }
  const folder = resolve(input)
  const inventory = await inventoryAddonDirectory(folder)
  const manifest = JSON.parse(
    (await inventory.read('hibi-addon.json')).toString('utf8'),
  )
  if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string')
    throw new Error('The addon manifest needs an id and version.')
  const statement = {
    type: 'hibi-addon-signature',
    version: 1,
    id: manifest.id,
    addonVersion: manifest.version,
    files: await addonFileHashes(inventory),
    signedAt: new Date().toISOString(),
  }
  await write(
    resolve(folder, ADDON_SIGNATURE_FILE),
    signEnvelope(statement, key),
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
