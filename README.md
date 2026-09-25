# tab-headers

**TabHeaders — per-tab request headers.**

Chrome extension (Manifest V3) that sets custom **request** headers per tab, for testing —
e.g. `x-mycustomer-header: tenant-a` in one tab and `tenant-b` in another, side by side.

## Install

### From a release

1. Download `tab-headers.zip` from the [latest release](https://github.com/orshih6/tab-headers/releases/latest)
   and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the
   unzipped folder.

### From source

Requires Node 20+, [pnpm](https://pnpm.io) and Chrome 120+.

```bash
pnpm install
pnpm build        # typecheck + bundle into dist/
pnpm dev          # rebuild on change
pnpm lint
pnpm zip          # build + pack dist/ into tab-headers.zip
```

Load `dist/` with **Load unpacked** as above. After a rebuild, hit the reload icon on the
extension card.

## Use

Click the toolbar icon on any tab to add headers for **that tab only**. The badge shows how
many headers the tab is sending. Optional domain filter limits them to e.g. `api.example.com`
(subdomains included). **Profiles** save a header set so you can apply it to another tab.
The **All tabs** switch pauses everything.

## How it works

- Headers are applied by Chrome itself via `declarativeNetRequest` session rules, one rule per
  tab scoped with `condition.tabIds`. No request is intercepted by extension code.
- `chrome.storage.session` holds per-tab config (`tab:<id>`) — tab ids don't survive a browser
  restart, so neither does per-tab config. Profiles live in `chrome.storage.local` and persist.
- `src/background.ts` rebuilds all session rules from storage on every change; storage is the
  source of truth. If Chrome rejects a header, only that tab's rule is dropped and the error is
  shown in its popup.

## Limits

- Requests not tied to a tab (service workers, some prefetches) get no headers.
- Chrome forbids modifying a few headers; the popup shows the error if you try.
- Request headers only; response headers are out of scope for now.

## Privacy

The extension makes no network requests of its own and collects nothing. Everything you enter
stays in your browser's `chrome.storage`. The `<all_urls>` host permission is required because
Chrome only lets `declarativeNetRequest` modify headers on hosts the extension has access to.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `pnpm lint` and `pnpm build` —
CI runs the same checks.

To cut a release, bump `version` in `public/manifest.json` (and `package.json`), then push a
matching `v<version>` tag; the release workflow builds the zip and publishes it.

## License

[MIT](LICENSE)
