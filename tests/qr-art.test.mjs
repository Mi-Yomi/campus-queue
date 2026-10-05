import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { roundedQrSvg } from '../src/qr-art.mjs';

const logo = `data:image/png;base64,${readFileSync(new URL('../src/assets/ritm-qr-mark.png', import.meta.url)).toString('base64')}`;
const id = '232b2fb2-e533-453f-84f2-d36871a7da67';

for (const backend of ['local', 'cloud']) {
 for (const issuer of ['session', 'visitor', 'display']) {
  test(`Branded ${backend} ${issuer} QR decodes at compact and fullscreen sizes`, () => {
    const claims = { q: id, g: 1, kind: issuer, issuer: 'd4'.repeat(32), iat: 1790913600000, exp: 1790913620000 };
    // The cloud API uses hex-encoded JSON (including jsonb whitespace), which
    // makes a denser code than local base64url invitations.
    const cloudClaims = { ...claims, kind: issuer === 'visitor' ? 'ticket' : 'session', issuer: issuer === 'visitor' ? id : claims.issuer };
    const invite = backend === 'cloud'
      ? Buffer.from(JSON.stringify(cloudClaims).replaceAll(':', ': ').replaceAll(',', ', ')).toString('hex') + '.' + 'd4'.repeat(32)
      : Buffer.from(JSON.stringify({ v: 1, ...claims })).toString('base64url') + '.' + 'M'.repeat(43);
    const url = `https://mi-yomi.github.io/campus-queue/#/q/${id}?invite=${invite}`;
    const matrix = QRCode.create(url, { errorCorrectionLevel: 'H' }).modules;
    const svg = roundedQrSvg(matrix, logo);
    assert.ok(svg.includes(`<image href="${logo}"`), 'The actual brand asset is embedded');
    for (const availableWidth of [240, 288, 320, 358, 720, 1024]) {
      const width = Math.floor(availableWidth / (matrix.size + 8)) * (matrix.size + 8);
      const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
      const code = jsQR(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height);
      assert.equal(code?.data, url, `decode at ${width}px (${availableWidth}px available)`);
    }
  });
 }
}

