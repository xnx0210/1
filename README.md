# dsh-xdpool — Doubao model-selection fix

An installable build of [`XDTrees/dsh-xdpool`](https://github.com/XDTrees/dsh-xdpool) 2.7.5
carrying one bug fix. Everything else is upstream, unchanged.

## Install

```sh
dsh plugin --profile desktop add github:xnx0210/1
```

Or from a local checkout:

```sh
dsh plugin --profile desktop add file:C:/path/to/dsh-xdpool-2.7.5-local.tgz
```

`lib/` is committed, so the install needs no build step — the same arrangement the
upstream project uses.

## What this build changes

### The bug

Doubao's model switches in the pool card did not reach the model picker.

The card kept its selection in the browser's `localStorage`. The picker is rendered from
the adapter registry **inside the host process**, which cannot read a browser store — and
the OpenAI gateway builds a second roster of its own. Switching a model off therefore
changed the card and left both other views listing every model.

### The fix

Doubao's roster is published in two places, and both had to learn about the selection:

| File | Change |
| --- | --- |
| `src/doubao-store.ts` | read/write the selection beside the session |
| `src/doubao-routes.ts` | `GET`/`PUT /plugins/dsh-xdpool/doubao/selection` |
| `src/doubao-host-adapter.ts` | `listModels` filters the local picker's roster |
| `src/doubao-llm.ts` | `listModels` filters the gateway's roster |
| `src/client/ChannelPoolSection.tsx` | mirrors each click to the host |
| `src/index.ts` | wires one reader into both faces |
| `src/status-paths.ts` | the new route constant |
| `tests/doubao-selection-sync.test.ts` | 15 tests over both paths and the store |

Three semantics are preserved deliberately:

- **`undefined` ≠ empty set.** `undefined` is "never configured" and serves every model;
  an empty set is "the user switched every model off" and serves none. Collapsing them
  either blanks a fresh install or re-enables a model the user deliberately turned off.
- **An unreadable selection widens the roster.** A corrupt file is not evidence that every
  model was disabled, and an empty picker reads as a broken channel.
- **A hidden model stays resolvable.** Hiding a model from the picker is not the same as
  making it unusable; a saved conversation that names it keeps working.

### The community-group invite is removed

The upstream card has a 「交流群」 button beside the star. It opens a dialog containing the
upstream author's WeChat bot code and QQ group code, inlined into the bundle as data URIs
so they ship no matter what.

Those are invitations to somebody else's groups, and they do not belong in a build that is
only carrying a bug fix — so the button, the dialog, the two locale entries and
`src/client/community-qr.ts` are gone. `lib/client.js` is **94.9 KB smaller** as a result.

Nothing else visual changed: the star link, the tab strip and every page are untouched.

## Verification

```
pnpm typecheck        0 error
pnpm typecheck:client 0 error
pnpm test             124 files / 1404 tests pass
pnpm build            lib/index.js + lib/index.d.ts + lib/bin.js + lib/client.js
```

## Upgrading upstream

This is a snapshot, not a fork that tracks upstream. When upstream ships a new version,
the fix is two files' worth of logic in `doubao-store.ts` + the three call sites — read
the diff of `CHANGES.patch` for the whole shape.

## License

MIT, as upstream. The upstream `LICENSE` and copyright notice are retained in full; this
build adds changes and removes one UI feature, and claims nothing of the original work.
