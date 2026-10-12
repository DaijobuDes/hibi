# Using addon dependencies

Declare another addon in `requires.addons` when you need its renderer API. This is separate from the executable and toolchain requirements described in [managing external dependencies](managing-dependencies.md).

## Declare dependencies

Add `requires` to your source manifest or installed package's `hibi-addon.json`:

```json
{
  "requires": {
    "addons": [
      { "id": "provider" },
      { "id": "dictionary", "optional": true }
    ]
  }
}
```

A dependency is required unless `optional` is `true`. Hibi starts required providers before their consumers. If a provider loads lazily, Hibi activates it when its consumer needs to start; declaring a dependency does not make an otherwise unused consumer start. Optional dependencies never block startup.

Each addon can declare up to 32 dependencies. IDs must be unique and cannot name the addon itself. Hibi rejects dependency cycles and invalid declarations, and refuses to install a package whose required providers are unknown. Install required providers first. If an already installed addon loses a required provider before the next startup, Hibi keeps the consumer installed and enabled but blocks it from running.

## Publish an API

Use `context.exports.provide()` inside the provider's `start()` method. Every published API must be a plain object with a positive safe integer `version`. Choose this version for your API contract; it is separate from the addon's release `version` and Hibi's `apiVersion`.

For a source addon, define and publish a typed API:

```typescript
import { type AddonExports, defineAddon } from '../../addons/api'
import manifest from './manifest'

export type ProviderApi = AddonExports & {
  greet(name: string): string
}

export default defineAddon({
  manifest,
  start(context) {
    context.exports.provide<ProviderApi>({
      version: 1,
      greet: (name) => `Hello, ${name}.`,
    })
  },
})
```

Exported APIs share ordinary object and function references in the same renderer. Hibi does not clone them, send them over IPC, or sandbox them. Declared access is an author and lifecycle contract, not a security boundary between trusted addons.

The API becomes visible only after the provider finishes startup successfully. `provide()` returns a function that removes that publication. Publishing a replacement API makes it current; calling the old publication's removal function does not remove the replacement. Hibi removes exports when the provider stops, is disabled, or reloads.

## Consume an API

`context.addons.get<T>(id)` returns the declared provider's current API only while the provider is active and startup is complete. It returns `undefined` when no API is available and does not activate a lazy provider.

`context.addons.ready<T>(id)` requests activation of an enabled lazy provider and waits for startup. It resolves to `undefined` if the provider is unavailable, disabled, fails startup, or publishes no API. It does not enable disabled addons.

Check the API version and required methods before using them. The type parameter describes the expected API; it does not validate another addon's object at runtime. A consumer with a required `provider` declaration can use:

```typescript
import { type AddonExports, defineAddon } from '../../addons/api'
import manifest from './manifest'

type ProviderApi = AddonExports & {
  greet(name: string): string
}

export default defineAddon({
  manifest,
  async start(context) {
    const provider = await context.addons.ready<ProviderApi>('provider')
    if (!provider || provider.version !== 1 || typeof provider.greet !== 'function')
      throw new Error('Provider API version 1 is required.')

    context.commands.register({
      id: 'greet',
      label: 'Greet with Provider',
      run: () => context.notify(provider.greet('writer')),
    })
  },
})
```

For an optional integration, handle `undefined` or an unsupported API version by continuing without that integration. Use `get()` to use an already active provider, or `ready()` when the feature needs to activate it.

Both methods require the provider's ID in your manifest, including optional providers. An undeclared `get()` call throws; an undeclared `ready()` call rejects its promise. After the consumer stops, both methods return or resolve to `undefined`. Keep API references within one consumer activation and release your own timers and listeners in `stop()`. Existing object references cannot be revoked. For optional integrations, reacquire the current API before using it after a provider is disabled or reloaded.

## Enable, disable, and recover

When a user enables a consumer with disabled required providers, Hibi shows **Enable required addons** and offers **Enable all**. Cancelling leaves the providers disabled.

Disabling a provider shows **Disable addon** and lists the consumers that will stop. Their contributions are removed, but their enabled preferences remain saved. Settings shows **Requires Provider** with **Enable Provider too** for a consumer whose provider is named Provider. Enabling the required provider again lets the consumer start with the provider's new API. A blocked feature stops without disabling document editing. If a document uses markup owned by that addon, Hibi applies the existing [syntax preservation rules](document-formats-and-syntax.md#preserve-source).

If an enabled provider fails startup, its consumers show **Could not start Provider** and offer **Retry Provider**. Use **Retry required addons** when several enabled providers failed. Retrying preserves enabled preferences.

Test cancellation, provider failure, missing exports, optional-provider absence, and disable/re-enable cycles. Check that stopped consumers leave no commands, styles, or listeners behind. See [testing your addon](testing-your-addon.md).
