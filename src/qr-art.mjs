// Use with error correction H: the small central badge covers some data.
// Keep a four-module quiet zone and the finder/timing patterns intact.
export function roundedQrSvg(matrix, logoDataUrl) {
  const { size } = matrix;
  const margin = 4;
  const extent = size + margin * 2;
  const eyes = [[0, 0], [size - 7, 0], [0, size - 7]];
  const parts = [];
  const cells = [];
  const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && matrix.get(y, x);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!matrix.get(y, x) || eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7)) continue;
      // Round only exposed corners. One compound path avoids pale seams
      // between adjoining modules at fractional display scales.
      const r = matrix.isReserved(y, x) ? 0 : 0.5;
      const tl = !dark(x - 1, y) && !dark(x, y - 1) ? r : 0;
      const tr = !dark(x + 1, y) && !dark(x, y - 1) ? r : 0;
      const br = !dark(x + 1, y) && !dark(x, y + 1) ? r : 0;
      const bl = !dark(x - 1, y) && !dark(x, y + 1) ? r : 0;
      const a = x + margin, b = y + margin;
      cells.push(`M${a + tl} ${b}H${a + 1 - tr}Q${a + 1} ${b} ${a + 1} ${b + tr}V${b + 1 - br}Q${a + 1} ${b + 1} ${a + 1 - br} ${b + 1}H${a + bl}Q${a} ${b + 1} ${a} ${b + 1 - bl}V${b + tl}Q${a} ${b} ${a + tl} ${b}Z`);
    }
  }
  parts.push(`<path d="${cells.join("")}"/>`);
  for (const [x, y] of eyes) {
    parts.push(`<rect x="${x + margin}" y="${y + margin}" width="7" height="7" rx="2"/>`);
    parts.push(`<rect x="${x + margin + 1}" y="${y + margin + 1}" width="5" height="5" rx="1.1" fill="#fff"/>`);
    parts.push(`<rect x="${x + margin + 2}" y="${y + margin + 2}" width="3" height="3" rx="0.85"/>`);
  }
  // Embedded image keeps the badge and code together at every size, including
  // fullscreen, without an extra network request on each invitation refresh.
  if (logoDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logoDataUrl)) {
    const badge = Math.max(5, Math.floor(size * 0.19) | 1);
    const start = (extent - badge) / 2;
    const inset = 0.8;
    parts.push(`<rect x="${start}" y="${start}" width="${badge}" height="${badge}" rx="1.5" fill="#fff"/>`);
    parts.push(`<image href="${logoDataUrl}" x="${start + inset}" y="${start + inset}" width="${badge - inset * 2}" height="${badge - inset * 2}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="1024" height="1024"><rect width="${extent}" height="${extent}" fill="#fff"/><g fill="#111111" shape-rendering="geometricPrecision">${parts.join("")}</g></svg>`;
}
