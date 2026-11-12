// /lib/electronica-svg.js
// Diagramas ILUSTRATIVOS (SVG) de las lecciones de Electrónica: una fila de cajas con flechas (flujo de energía, de señales o de pasos).
// flujo(['Cargador|20 V DC', 'Conector', ...], 'nota opcional al pie'): cada caja puede llevar dos líneas separadas por «|».
// Usa currentColor: se adapta al tema de la página. No es una fotografía ni el esquema de un equipo real.
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function flujo(cajas, pie = '', etiqueta = 'Diagrama ilustrativo') {
  const n = cajas.length, ancho = 560, hueco = n >= 6 ? 14 : 22;
  const w = Math.floor((ancho - (n - 1) * hueco) / n), alto = 64, y = 40;
  // Tamaño de letra: el mayor que permita que la línea más larga entre en su caja (mínimo legible 9,5).
  const masLarga = Math.max(...cajas.flatMap(c => String(c).split('|').map(l => l.length)));
  const fuente = Math.max(9.5, Math.min(n >= 6 ? 11 : n === 5 ? 12 : 13, Math.floor(((w - 8) / (masLarga * 0.6)) * 10) / 10));
  let s = `<svg viewBox="0 0 ${ancho} ${pie ? 150 : 130}" role="img" aria-label="${esc(etiqueta)}: ${esc(cajas.map(c => c.replace('|', ' ')).join(', '))}"><g font-family="Arial,sans-serif" font-size="${fuente}" fill="currentColor">`;
  cajas.forEach((c, i) => {
    const x = i * (w + hueco), [l1, l2] = String(c).split('|');
    s += `<rect x="${x}" y="${y}" width="${w}" height="${alto}" rx="8" fill="none" stroke="currentColor" stroke-width="2"/>`;
    if (l2) s += `<text x="${x + w / 2}" y="${y + 27}" text-anchor="middle" font-weight="bold">${esc(l1)}</text><text x="${x + w / 2}" y="${y + 46}" text-anchor="middle">${esc(l2)}</text>`;
    else s += `<text x="${x + w / 2}" y="${y + alto / 2 + 5}" text-anchor="middle" font-weight="bold">${esc(l1)}</text>`;
    if (i < n - 1) { const a = x + w + 2, b = x + w + hueco - 2; s += `<path d="M${a} ${y + alto / 2} H${b} M${b - 6} ${y + alto / 2 - 5} L${b} ${y + alto / 2} L${b - 6} ${y + alto / 2 + 5}" stroke="currentColor" stroke-width="2" fill="none"/>`; }
  });
  if (pie) s += `<text x="${ancho / 2}" y="132" text-anchor="middle" opacity=".8">${esc(pie)}</text>`;
  return s + '</g></svg>';
}
