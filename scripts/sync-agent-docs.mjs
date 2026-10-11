import fs from 'node:fs/promises';

const check = process.argv.includes('--check');
const source = await fs.readFile(new URL('../AGENT_GUIDE.md', import.meta.url), 'utf8');
const generated = '<!-- Generated from AGENT_GUIDE.md. Run npm run docs:sync; edit the source only. -->\n\n' + source;

for (const name of ['agent.md', 'llms.txt']) {
  const target = new URL(`../docs/${name}`, import.meta.url);
  if (check) {
    const existing = await fs.readFile(target, 'utf8').catch(() => null);
    if (existing !== generated) {
      console.error(`docs/${name} is stale. Run npm run docs:sync.`);
      process.exitCode = 1;
    }
  } else {
    await fs.writeFile(target, generated);
  }
}
