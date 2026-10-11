import fs from 'node:fs/promises';

const check = process.argv.includes('--check');
// Compare with LF endings so Windows CRLF checkouts are not reported as stale.
const lf = text => text.replace(/\r\n/g, '\n');
const source = lf(await fs.readFile(new URL('../AGENT_GUIDE.md', import.meta.url), 'utf8'));
const generated = '<!-- Generated from AGENT_GUIDE.md. Run npm run docs:sync; edit the source only. -->\n\n' + source;

for (const name of ['agent.md', 'llms.txt']) {
  const target = new URL(`../docs/${name}`, import.meta.url);
  if (check) {
    const existing = await fs.readFile(target, 'utf8').catch(() => null);
    if (existing === null || lf(existing) !== generated) {
      console.error(`docs/${name} is stale. Run npm run docs:sync.`);
      process.exitCode = 1;
    }
  } else {
    await fs.writeFile(target, generated);
  }
}

const cryptoSource = await fs.readFile(new URL('../bin/lib/browser-crypto.mjs', import.meta.url), 'utf8');
const cryptoTarget = new URL('../docs/login-crypto.js', import.meta.url);
if (check) {
  if (lf(await fs.readFile(cryptoTarget, 'utf8').catch(() => '')) !== lf(cryptoSource)) {
    console.error('docs/login-crypto.js is stale. Run npm run docs:sync.');
    process.exitCode = 1;
  }
} else await fs.writeFile(cryptoTarget, cryptoSource);

const indexTarget = new URL('../docs/index.html', import.meta.url);
const index = lf(await fs.readFile(indexTarget, 'utf8'));
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const updatedIndex = index.replace(/(<pre class="markdown-source">)[\s\S]*?(<\/pre>)/, (_, start, end) => start + escapeHtml(source) + end);
if (check) {
  if (index !== updatedIndex) { console.error('docs/index.html machine guide is stale. Run npm run docs:sync.'); process.exitCode = 1; }
} else await fs.writeFile(indexTarget, updatedIndex);
