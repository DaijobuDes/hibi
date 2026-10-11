# Host credentials

Use `context.host.credentials` to store a secret for your addon. Choose `session` when it only needs to last until the addon stops or the window reloads. Choose `persistent` only when the host reports a protected credential backend.

```ts
const result = await context.host.credentials.store({
  key: 'api-token',
  secret: tokenEnteredByUser,
  mode: 'session',
})
if (!result.ok) showCredentialError(result.code)
```

Keys start with a lowercase letter and contain up to 64 lowercase letters, digits, or hyphens. Secrets are limited to 8 KiB of UTF-8 text. `status({ key })` reports `missing`, `session`, or `persistent`, plus whether persistent protection is `protected`, `unprotected`, or `locked-or-unavailable`. `remove({ key })` deletes both session and persistent copies. None of these methods returns a stored secret.

Persistent secrets use Electron's protected storage backend and an encrypted file in Hibi's user data. A locked or unavailable backend refuses persistent writes. Linux's `basic_text` fallback is `unprotected` and also refuses them; use session mode if that is acceptable. Hibi never silently stores persistent secrets as plaintext. Disabling an addon clears its session secrets but retains persistent secrets so re-enabling can restore them. Remove a persistent secret explicitly when no longer needed.

Use a stored credential for one host-mediated HTTPS request by naming its key:

```ts
const result = await context.host.network.getText({
  url: 'https://api.example.com/account',
  credentialKey: 'api-token',
})
```

Hibi asks before sending a `Bearer` token to the exact URL. Local or private addresses need a second grant. Requests with credentials stop at redirects; Hibi does not forward the token to the redirect target. The host sends no cookies. A missing credential, an unsupported bearer value, or a response that echoes the exact token fails without returning the token. The result contains only the requested URL, status, and response text on success.

For credential-free GET requests that users approve when enabling your addon, declare exact HTTPS origins in the manifest:

```ts
network: { origins: ['https://en.wiktionary.org', 'https://api.datamuse.com'] },
```

Declare between 1 and 16 unique canonical HTTPS origins with lowercase hostnames, no trailing slash, and no default `:443` port; keep any non-default port. IP literals and local or private hostnames are not allowed. Hostnames embedding an IP address, such as `127.0.0.1.nip.io`, are allowed as declarations, but resolving to a private address still requires destination and private-address approvals. Only the manifest reviewed by Hibi's main process counts; a renderer-supplied declaration cannot grant access. Enabling the addon approves credential-free GET requests to those exact origins. Redirects outside the declarations, requests with credentials, and requests to local or private addresses still prompt. The addon row and settings show the declared hosts so users can review them before enabling it.

An installed addon shares the renderer with other addons. Any code running in that renderer can reach an enabled addon's declared origins without a prompt; declarations do not isolate addons from each other. Host ownership checks prevent stale or accidental cross-addon requests, but they cannot stop a malicious addon in the same renderer from spoofing another addon's ID or observing a secret when it is entered. Do not promise isolation from untrusted installed addons or from other software running as the same user. The bridge has no method to retrieve stored plaintext.
