# fgilde.github.io

Landing page for **https://fgilde.github.io/** — a live showcase of every repo of mine that ships a GitHub Pages
site or a custom domain.

## How it works

- The page itself is a single file: [`index.html`](index.html). No build step, no framework, no dependencies.
- [`.github/workflows/screenshots.yml`](.github/workflows/screenshots.yml) runs nightly, calls
  [`scripts/shots.mjs`](scripts/shots.mjs) and commits the result:
  - `shots/manifest.json` — every repo with description, language, stars and the **real** page URL. The custom
    domains (videola.app, audiola.de, poweraim.de, …) live in each repo's Pages CNAME, which only an
    authenticated API call can read — so the workflow resolves them once and bakes them in.
  - `shots/<repo>.jpg` — a 1280×800 screenshot of the live page, taken with Playwright.
- The page loads `manifest.json` first: same-origin, static, CDN-cached, no rate limit, works instantly. The
  screenshots are the card thumbnails, so previews are persisted instead of re-rendered per visitor.
- Afterwards it calls the public GitHub API once to refresh stars and pick up repos created since the last
  workflow run. If that call fails or is rate-limited (60 req/h per IP anonymously), the manifest data stays.
- Hovering a card still loads the site *live* in a scaled sandboxed iframe on top of the screenshot. Pages
  without HTTPS cannot be framed, so those cards just link out instead.
- Dark/light toggle, search (`/` focuses it), language filters, sorting, reduced-motion support.

## Local

```sh
python -m http.server 8080          # manifest.json needs http://, not file://
```

Regenerate previews locally (uses your installed Chrome, no browser download):

```sh
npm install
GITHUB_TOKEN=$(gh auth token) npm run shots
```

## Pages settings

Deploy from branch `main`, folder `/ (root)`.
