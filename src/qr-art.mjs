// Keep all encoded modules, a four-module quiet zone and solid, dark ink.
// Rounded finder frames add character without covering data with a logo.
export function roundedQrSvg(matrix) {
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
      const r = matrix.isReserved(y, x) ? 0 : 0.28;
      const tl = !dark(x - 1, y) && !dark(x, y - 1) ? r : 0;
      const tr = !dark(x + 1, y) && !dark(x, y - 1) ? r : 0;
      const br = !dark(x + 1, y) && !dark(x, y + 1) ? r : 0;
      const bl = !dark(x - 1, y) && !dark(x, y + 1) ? r : 0;
      const a = x + margin, b = y + margin;
      cells.push(`M${a + tl} ${b}H${a + 1 - tr}Q${a + 1} ${b} ${a + 1} ${b + tr}V${b + 1 - br}Q${a + 1} ${b + 1} ${a + 1 - br} ${b + 1}H${a + bl}Q${a} ${b + 1} ${a} ${b + 1 - bl}V${b + tl}Q${a} ${b} ${a + tl} ${b}Z`);
    }
  }
  parts.push(`<path shape-rendering="crispEdges" d="${cells.join("")}"/>`);
  for (const [x, y] of eyes) {
    parts.push(`<rect x="${x + margin}" y="${y + margin}" width="7" height="7" rx="1.3"/>`);
    parts.push(`<rect x="${x + margin + 1}" y="${y + margin + 1}" width="5" height="5" rx="0.7" fill="#fff"/>`);
    parts.push(`<rect x="${x + margin + 2}" y="${y + margin + 2}" width="3" height="3" rx="0.6"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="1024" height="1024"><rect width="${extent}" height="${extent}" fill="#fff"/><g fill="#111827" shape-rendering="crispEdges">${parts.join("")}</g></svg>`;
}
