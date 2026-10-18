# Signing addons and revocations

Hibi trusts the Ed25519 public keys in `src/shared/addon-trust.ts`. Its root key ID is `1b43eadedb48d51d`. Keep its private key outside every repository and package, with access limited to release maintainers. Back it up in a protected vault. Never paste it into logs, issues, or chat.

## Keys and package releases

Use Node 22.18 or newer. The signing script has no dependencies. For a new signing key, create an Ed25519 PEM file outside the checkout:

```sh
mkdir -p ~/.hibi-signing
chmod 700 ~/.hibi-signing
(umask 077; openssl genpkey -algorithm Ed25519 -out ~/.hibi-signing/new-addon-key.pem)
```

Do not overwrite the existing root key. A new key is not trusted until its public half is added to Hibi and released. Public keys are base64 of the raw 32 bytes. Key IDs are the first 16 lowercase hex characters of SHA-256 of those raw public bytes.

Review the source, declared access, and compiled output, then sign the final package:

```sh
node scripts/addon-signing.mjs sign /path/to/addon --key ~/.hibi-signing/hibi-addon-root.key
node scripts/addon-signing.mjs verify /path/to/addon
```

Ship the generated `hibi-addon.sig.json` with the package. The signer and installer share the package inventory and hashing code, including path exclusions. Every included file except the signature is covered. Changing any included file requires signing again. The verifier accepts only Hibi's trusted public keys; it does not accept a key supplied by the package.

## Publish a revocation list

Prepare a statement following the [revocation format](sideloading.md#revoked-addons). Start with sequence 1 and an empty `entries` array; increase the sequence for every subsequent change. Use an explanation suitable for users. Omit `versions` to revoke all versions of an ID.

```sh
node scripts/addon-signing.mjs revocations /path/to/list.json \
  --key ~/.hibi-signing/hibi-addon-root.key --out /path/to/revocations.json
```

Publish the signed envelope as `public/addons/revocations.json` in the `hibigarden/site` repository so it is served at `https://www.hibi.garden/addons/revocations.json`. Keep the envelope under 256 KiB. Publish only the signed envelope; keep the private key outside the site repository. Removing an entry also requires a higher sequence, and does not automatically enable disabled addons.

Network checks start after startup, use a 15-second timeout, and run no more than once per 24 hours in a running app. A missing or invalid remote list retains the last accepted signed list. There is no expiry, so a network attacker can delay newer lists; signatures and monotonic sequence numbers prevent accepting forged lists or rolling back an already accepted sequence.

## Local test keys

Tests generate a throwaway Ed25519 pair at runtime. `HIBI_TEST_ADDON_TRUST_KEYS` points to a JSON object mapping an extra key ID to a base64 raw public key. `HIBI_TEST_ADDON_REVOCATIONS_URL` points to the local test server. Both overrides require an unpackaged app launched with `--hibi-test`; packaged apps ignore them even if that switch is present. Test keys cannot replace a compiled root key. Neither value comes from the renderer.

Preferences are atomically persisted in `addon-trust-settings.json` under Electron's `userData` directory. The last accepted signed envelope is `addon-revocations.json` there, and disabled preferences use the existing `addons.json`. Each installed package's `.hibi-install.json` records `trust` as `signed` or `unsigned`; older missing values are treated as unsigned.
