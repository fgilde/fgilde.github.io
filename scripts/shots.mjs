/**
 * Builds shots/manifest.json + one screenshot per live page.
 *
 * The custom domains (videola.app, audiola.de, ...) live in the Pages CNAME, not in
 * repo.homepage — only an authenticated call to /repos/:owner/:repo/pages knows them.
 * That is why this runs in CI and bakes the result into a static manifest: the site
 * then needs no API call at all, and never hits the 60 req/h anonymous rate limit.
 *
 * Local run (uses your installed Chrome, no browser download):
 *   npm install && GITHUB_TOKEN=$(gh auth token) node scripts/shots.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const USER = process.env.GH_USER || 'fgilde';
const TOKEN = process.env.GITHUB_TOKEN;
const SHOTS = 'shots';
// Taller than a normal viewport on purpose: the card crops the top for the thumbnail and
// pans down to the bottom on hover, so one image serves as both preview and "scroll" preview.
const VIEWPORT = { width: 1280, height: 1600 };
const SELF = `${USER}.github.io`;

const api = async path => {
  const r = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status} on ${path}`);
  return r.json();
};

const repos = (await api(`users/${USER}/repos?per_page=100&sort=pushed`))
  .filter(r => !r.archived && r.name !== SELF);

/** Prefer https when the host serves it — an http page cannot be shown in an iframe. */
async function preferHttps(url) {
  if (!url.startsWith('http://')) return url;
  const secure = url.replace(/^http:/, 'https:');
  try {
    const r = await fetch(secure, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (r.ok) return secure;
  } catch { /* host has no working https — keep http */ }
  return url;
}

/**
 * Can this page be shown in an iframe on the site? Only https pages can (mixed content),
 * and only when the host does not forbid framing. Checked here because the browser cannot
 * read these headers cross-origin — it would just show a blank frame and time out.
 */
async function isFramable(url) {
  if (!url.startsWith('https://')) return false;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.url.startsWith('https://')) return false; // redirected down to http
    const xfo = (r.headers.get('x-frame-options') || '').toLowerCase();
    if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
    const csp = (r.headers.get('content-security-policy') || '').toLowerCase();
    const fa = csp.match(/frame-ancestors([^;]*)/)?.[1] ?? '';
    return !fa || fa.includes('*') || fa.includes('github.io');
  } catch {
    return false;
  }
}

/**
 * Real public URL of a repo's page. An explicitly set homepage wins (that is the address
 * the owner advertises, e.g. mudex.org), then the Pages CNAME, then the default path.
 */
async function pageUrl(repo) {
  if (/^https?:\/\//.test(repo.homepage || '')) return preferHttps(repo.homepage);
  try {
    const p = await api(`repos/${USER}/${repo.name}/pages`);
    if (p.html_url) return preferHttps(p.html_url);
  } catch { /* no pages, or no permission — fall through */ }
  return `https://${SELF}/${repo.name}/`;
}

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CI ? undefined : 'chrome', // CI installs chromium, locally reuse Chrome
  args: ['--hide-scrollbars', '--disable-gpu'],
});
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true,
  reducedMotion: 'reduce',
  colorScheme: 'dark',
});

const entries = [];
const blank = [];
for (const repo of repos) {
  const base = {
    name: repo.name,
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    issues: repo.open_issues_count,
    topics: (repo.topics || []).slice(0, 4),
    pushed: repo.pushed_at,
    hasPages: repo.has_pages,
    isFork: repo.fork,
    homepage: /^https?:\/\//.test(repo.homepage || '') ? repo.homepage : null,
  };
  if (!repo.has_pages) { entries.push(base); continue; }

  const url = await pageUrl(repo);
  const framable = await isFramable(url);
  const file = `${repo.name}.jpg`;
  const page = await ctx.newPage();
  let shot = null;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    // WASM/SPA pages paint late; networkidle is optional, the extra wait is not
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3500);
    // an SPA shell can still be empty here — give it more time while the body has no
    // readable text yet, instead of screenshotting a blank page
    let text = 0;
    for (let i = 0; i < 4; i++) {
      text = await page.evaluate(() => document.body?.innerText.trim().length || 0);
      if (text > 80) break;
      await page.waitForTimeout(3000);
    }
    if (text > 80) {
      await page.screenshot({ path: `${SHOTS}/${file}`, type: 'jpeg', quality: 72 });
      shot = file;
      console.log(`ok    ${repo.name} -> ${url}${framable ? '' : '  (not framable)'}`);
    } else {
      // a page that renders nothing gets no screenshot: the card falls back to its monogram
      blank.push(repo.name);
      console.log(`blank ${repo.name} -> ${url}: renders no content, keeping placeholder`);
    }
  } catch (err) {
    console.log(`FAIL  ${repo.name} -> ${url}: ${err.message.split('\n')[0]}`);
    if (existsSync(`${SHOTS}/${file}`)) shot = file; // keep the previous screenshot
  }
  await page.close();
  entries.push({ ...base, url, shot, framable });
}

await ctx.close();
await browser.close();

// drop screenshots of repos that lost their page
const keep = new Set(entries.map(e => e.shot).filter(Boolean));
for (const f of await readdir(SHOTS)) {
  if (f.endsWith('.jpg') && !keep.has(f)) { await unlink(`${SHOTS}/${f}`); console.log(`removed ${f}`); }
}

const user = await api(`users/${USER}`);
await writeFile(`${SHOTS}/manifest.json`, JSON.stringify({
  generated: new Date().toISOString(),
  user: { login: user.login, publicRepos: user.public_repos, followers: user.followers },
  repos: entries,
}, null, 1) + '\n');

const live = entries.filter(e => e.hasPages).length;
console.log(`\nmanifest.json: ${entries.length} repos, ${live} with pages, ${keep.size} screenshots`);
