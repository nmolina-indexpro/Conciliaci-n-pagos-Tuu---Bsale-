// /lib/mailing/csv.js
// Lector de CSV mínimo (comillas, comas/punto y coma/tab, BOM, saltos de línea de Windows) y mapeo de columnas de las exportaciones de Zoho Campaigns.

export function parsearCsv(texto) {
  let t = String(texto ?? '');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  if (!t.trim()) return [];
  // Separador: el más frecuente en la primera línea (fuera de comillas basta con contar la cabecera).
  const primera = t.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].map(c => [c, primera.split(c).length - 1]).sort((a, b) => b[1] - a[1])[0][0];

  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else entreComillas = false;
      } else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some(v => v.trim() !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some(v => v.trim() !== '')) filas.push(fila);
  return filas;
}

const quitarTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const clave = s => quitarTildes(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Nombres de columna aceptados (inglés de Zoho y español), ya pasados por clave().
const ALIAS = {
  email: ['email', 'contact email', 'email address', 'correo', 'correo electronico', 'e mail', 'mail'],
  first_name: ['first name', 'firstname', 'nombre', 'nombres'],
  last_name: ['last name', 'lastname', 'apellido', 'apellidos'],
  company_name: ['company', 'company name', 'empresa', 'razon social'],
  company_rut: ['rut', 'rut empresa', 'company rut'],
  business_line: ['business line', 'linea de negocio', 'linea'],
  tags: ['tags', 'etiquetas'],
  reason: ['reason', 'motivo', 'razon', 'type', 'tipo', 'bounce type', 'status', 'estado'],
  detail: ['detail', 'detalle', 'comment', 'comentario'],
  consent_at: ['consent date', 'fecha de consentimiento', 'added time', 'created time', 'fecha de alta'],
};

export function mapearColumnas(cabecera) {
  const idx = {};
  const claves = cabecera.map(clave);
  for (const [campo, alias] of Object.entries(ALIAS)) {
    const i = claves.findIndex(k => alias.includes(k));
    if (i >= 0) idx[campo] = i;
  }
  return idx;
}

// Devuelve [{ email, first_name, ..., extra: {columna: valor} }] a partir del texto CSV. Las columnas no reconocidas van a `extra` (terminan en attributes).
export function leerFilasCsv(texto) {
  const filas = parsearCsv(texto);
  if (filas.length < 2) return { columnas: {}, filas: [], error: filas.length ? null : 'El archivo está vacío' };
  const cab = filas[0];
  const columnas = mapearColumnas(cab);
  if (columnas.email === undefined) return { columnas, filas: [], error: 'No se encontró la columna del correo (Email / Contact Email / Correo)' };
  const usadas = new Set(Object.values(columnas));
  const salida = [];
  for (let n = 1; n < filas.length; n++) {
    const f = filas[n];
    const o = { linea: n + 1, extra: {} };
    for (const [campo, i] of Object.entries(columnas)) o[campo] = (f[i] ?? '').trim();
    cab.forEach((nombre, i) => {
      const v = (f[i] ?? '').trim();
      if (!usadas.has(i) && v && nombre.trim()) o.extra[nombre.trim().slice(0, 60)] = v.slice(0, 300);
    });
    salida.push(o);
  }
  return { columnas, filas: salida, error: null };
}
