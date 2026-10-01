import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const htmlPaths = [];
async function collectHtml(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectHtml(fullPath);
    else if (entry.name.endsWith('.html')) htmlPaths.push(fullPath);
  }
}

await collectHtml(dist);
assert.ok(htmlPaths.length > 0, 'Build output should contain HTML pages.');

const html = (await Promise.all(htmlPaths.map((file) => readFile(file, 'utf8')))).join('\n');
const builtFiles = await Promise.all(htmlPaths.map(async (file) => ({
  file,
  content: await readFile(file, 'utf8')
})));
for (const forbidden of ['demo-01', 'example.com/auriculares-demo', 'DEMO · solo desarrollo', '4.8/5']) {
  assert.ok(!html.includes(forbidden), `Production HTML must not expose demo content: ${forbidden}`);
}

const adminPage = await readFile(path.join(dist, 'admin', 'index.html'), 'utf8');
assert.ok(adminPage.includes('Panel no disponible en producción'));
assert.ok(!adminPage.includes('offer-form'));
for (const { file, content } of builtFiles) {
  assert.ok(!content.includes('TELEGRAM_BOT_TOKEN'), `Production page must not expose bot token bindings: ${file}`);
  assert.ok(!content.includes('TELEGRAM_PUBLISH_SECRET'), `Production page must not expose publish secret bindings: ${file}`);
}

const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
assert.ok(!sitemap.includes('.example'));
const robots = await readFile(path.join(dist, 'robots.txt'), 'utf8');
assert.ok(robots.includes('Disallow: /admin/'));
assert.ok(!html.includes('/images/demo/'), 'Production HTML must not reference demo image assets.');
try {
  const demoImageFiles = await readdir(path.join(dist, 'images', 'demo'));
  assert.equal(demoImageFiles.length, 0, 'Production output must not contain demo image assets.');
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}
console.log(`Production output check passed (${htmlPaths.length} HTML pages).`);
