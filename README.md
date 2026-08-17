# fgilde.github.io

Landing page for **https://fgilde.github.io/** — a live showcase of every repo of mine that ships a GitHub Pages site
or a custom domain.

- Single file: [`index.html`](index.html). No build step, no dependencies, no framework.
- Project list comes from the public GitHub API at runtime (`/users/fgilde/repos`), filtered by `has_pages`.
  New Pages repos show up automatically — nothing to maintain here.
- A hardcoded `SEED` array in `index.html` renders instantly and is the fallback when the API is rate-limited
  (60 requests/hour per IP for unauthenticated calls).
- Cards load the *actual* site in a scaled, lazy `<iframe>` on hover.
- Dark/light toggle, search (`/` focuses it), language filters, sorting, reduced-motion support.

## Local

Just open `index.html` in a browser, or:

```sh
python -m http.server 8080
```

## Pages settings

Deploy from branch `main`, folder `/ (root)`.
