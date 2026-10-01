import test from 'node:test';
import assert from 'node:assert/strict';
import { queueBase } from '../src/queue-links.mjs';
test('hosted QR stays under campus-queue despite a saved cinema or LAN address', () => {
  for (const saved of ['https://mi-yomi.github.io/', 'http://192.168.0.2:5173/', 'https://other.example/'])
    assert.equal(queueBase('https://mi-yomi.github.io/campus-queue/#/admin', saved, true), 'https://mi-yomi.github.io/campus-queue/');
});
test('student and display routes use the same project directory', () => {
  for (const route of ['#/q/123?invite=test', '#/screen/123?display=test', '#/admin'])
    assert.equal(queueBase('https://mi-yomi.github.io/campus-queue/' + route, null, true), 'https://mi-yomi.github.io/campus-queue/');
  assert.equal(queueBase('https://mi-yomi.github.io/campus-queue/index.html#/admin', null, true), 'https://mi-yomi.github.io/campus-queue/');
});
test('local QR can still use a LAN address and rejects invalid saved URLs', () => {
  assert.equal(queueBase('http://localhost:5173/#/admin', 'http://192.168.0.2:5173/', false), 'http://192.168.0.2:5173/');
  for (const invalid of ['javascript:alert(1)', 'https://user:pass@example.com/', 'broken'])
    assert.equal(queueBase('http://localhost:5173/#/admin', invalid, false), 'http://localhost:5173/');
});
