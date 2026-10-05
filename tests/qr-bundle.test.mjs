import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('QR generation is available from the initial app load, without a lazy chunk', async () => {
  // Pages removes previous hashed assets on deploy. An already-open app must
  // still render its first QR even after those old assets disappear.
  const result = await build({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  });
  const chunks = result.output.filter(item => item.type === 'chunk');
  const initial = new Set();
  function visit(chunk) {
    if (!chunk || initial.has(chunk.fileName)) return;
    initial.add(chunk.fileName);
    for (const file of chunk.imports) visit(chunks.find(item => item.fileName === file));
  }
  for (const chunk of chunks.filter(item => item.isEntry)) visit(chunk);
  const qrChunks = chunks.filter(chunk => Object.keys(chunk.modules)
    .some(id => id.replaceAll('\\', '/').includes('/node_modules/qrcode/')));
  assert.ok(qrChunks.length, 'The QR generator must be bundled');
  for (const chunk of qrChunks) {
    assert.ok(initial.has(chunk.fileName), `${chunk.fileName} must load with the app, before an invitation is requested`);
  }
});
