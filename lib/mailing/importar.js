// /lib/mailing/importar.js
// Importación de contactos y supresiones desde los CSV exportados de Zoho Campaigns.
//  - prepararImportacion: función pura (texto CSV -> filas limpias, sin duplicados, con inválidos aparte).
//  - guardarImportacion: escribe en la base por tandas (UNNEST). Reglas:
//      * deduplica por correo (citext);
//      * un contacto que ya existe NO se reactiva ni se pisan sus datos: solo se completan los vacíos y se suman etiquetas;
//      * mk_suppressions manda: si el correo está suprimido, el contacto queda como unsubscribed/bounced/complained.

import { leerFilasCsv } from './csv.js';
import { normalizarEmail, emailValido } from './email.js';

export const MAX_FILAS_POR_LLAMADA = 20000;
const TANDA = 1000;
const LINEAS = new Set(['indexstore', 'indexpro', 'fonoip']);

// 'unsubscribe' | 'hard_bounce' | 'complaint' a partir del texto libre de Zoho (Unsubscribed, Hard Bounce, Spam complaint, Baja, Queja...).
export function categoriaSupresion(texto) {
  const t = String(texto ?? '').toLowerCase();
  if (/complain|queja|spam|abuse/.test(t)) return 'complaint';
  if (/bounce|rebot|invalid|inexist/.test(t)) return 'hard_bounce';
  if (/unsub|desuscri|baja|opt.?out|remov/.test(t)) return 'unsubscribe';
  return null;
}

export const estadoContactoPorCategoria = cat => (cat === 'hard_bounce' ? 'bounced' : cat === 'complaint' ? 'complained' : 'unsubscribed');

function fechaIso(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d > new Date() ? null : d.toISOString();
}

// tipo: 'contactos' | 'supresiones'. categoria: categoría por defecto de las supresiones cuando el archivo no trae columna de motivo.
export function prepararImportacion(texto, { tipo = 'contactos', origen = 'zoho_import', categoria = null } = {}) {
  const { filas, error } = leerFilasCsv(texto);
  if (error) return { error };
  if (filas.length > MAX_FILAS_POR_LLAMADA) return { error: `Demasiadas filas en una sola llamada (${filas.length}); máximo ${MAX_FILAS_POR_LLAMADA}. Divide el archivo.` };

  const invalidos = [];
  const vistos = new Map();
  let duplicados = 0;
  for (const f of filas) {
    const email = normalizarEmail(f.email);
    if (!emailValido(email)) { invalidos.push({ linea: f.linea, email: String(f.email).slice(0, 80), motivo: 'correo inválido' }); continue; }
    if (vistos.has(email)) {
      duplicados++;
      const previo = vistos.get(email);
      for (const k of ['first_name', 'last_name', 'company_name', 'company_rut']) if (!previo[k] && f[k]) previo[k] = f[k];
      continue;
    }
    vistos.set(email, { ...f, email });
  }
  const unicas = [...vistos.values()];

  if (tipo === 'supresiones') {
    const supresiones = [];
    for (const f of unicas) {
      const cat = categoriaSupresion(f.reason) || categoriaSupresion(f.detail) || categoria;
      if (!cat) { invalidos.push({ linea: f.linea, email: f.email, motivo: 'no se pudo determinar si es baja, rebote o queja' }); continue; }
      supresiones.push({ email: f.email, categoria: cat, detalle: (f.detail || f.reason || '').slice(0, 200) || null });
    }
    return { tipo, supresiones, contactos: [], invalidos, duplicados, filas: filas.length };
  }

  const contactos = unicas.map(f => ({
    email: f.email,
    first_name: f.first_name || null,
    last_name: f.last_name || null,
    company_name: f.company_name || null,
    company_rut: f.company_rut || null,
    business_line: LINEAS.has(String(f.business_line || '').toLowerCase()) ? String(f.business_line).toLowerCase() : null,
    source: origen,
    tags: [...new Set(String(f.tags || '').split(/[,;|]/).map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30),
    attributes: f.extra,
    consent_source: origen,
    consent_at: fechaIso(f.consent_at),
  }));
  return { tipo, contactos, supresiones: [], invalidos, duplicados, filas: filas.length };
}

async function guardarContactos(sql, contactos) {
  let nuevos = 0;
  let existentes = 0;
  for (let i = 0; i < contactos.length; i += TANDA) {
    const l = contactos.slice(i, i + TANDA);
    const col = campo => l.map(c => c[campo] ?? null);
    const { rows } = await sql.query(
      `INSERT INTO mk_contacts (email, first_name, last_name, company_name, company_rut, business_line, source, tags, attributes, consent_source, consent_at)
       SELECT u.email, u.first_name, u.last_name, u.company_name, u.company_rut, u.business_line, u.source,
              COALESCE(string_to_array(NULLIF(u.tags, ''), '|'), '{}'), COALESCE(u.attributes::jsonb, '{}'::jsonb), u.consent_source, u.consent_at::timestamptz
         FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
              AS u(email, first_name, last_name, company_name, company_rut, business_line, source, tags, attributes, consent_source, consent_at)
       ON CONFLICT (email) DO UPDATE SET
         first_name = COALESCE(mk_contacts.first_name, EXCLUDED.first_name),
         last_name = COALESCE(mk_contacts.last_name, EXCLUDED.last_name),
         company_name = COALESCE(mk_contacts.company_name, EXCLUDED.company_name),
         company_rut = COALESCE(mk_contacts.company_rut, EXCLUDED.company_rut),
         business_line = COALESCE(mk_contacts.business_line, EXCLUDED.business_line),
         tags = ARRAY(SELECT DISTINCT t FROM unnest(mk_contacts.tags || EXCLUDED.tags) AS t),
         attributes = EXCLUDED.attributes || mk_contacts.attributes,
         consent_source = COALESCE(mk_contacts.consent_source, EXCLUDED.consent_source),
         consent_at = COALESCE(mk_contacts.consent_at, EXCLUDED.consent_at),
         updated_at = now()
       RETURNING (xmax = 0) AS insertado`,
      [col('email'), col('first_name'), col('last_name'), col('company_name'), col('company_rut'), col('business_line'), col('source'),
        l.map(c => c.tags.join('|')), l.map(c => JSON.stringify(c.attributes || {})), col('consent_source'), col('consent_at')],
    );
    for (const r of rows) (r.insertado ? nuevos++ : existentes++);
    // mk_suppressions manda: lo recién importado que ya estaba suprimido no queda como suscrito.
    await sql.query(
      `UPDATE mk_contacts c
          SET status = CASE s.reason WHEN 'hard_bounce' THEN 'bounced'::mk_contact_status WHEN 'complaint' THEN 'complained'::mk_contact_status
                         WHEN 'zoho_import' THEN (CASE split_part(s.detail, ':', 1) WHEN 'hard_bounce' THEN 'bounced' WHEN 'complaint' THEN 'complained' ELSE 'unsubscribed' END)::mk_contact_status
                         ELSE 'unsubscribed'::mk_contact_status END,
              unsubscribed_at = COALESCE(c.unsubscribed_at, now()), updated_at = now()
         FROM mk_suppressions s
        WHERE s.email = c.email AND c.status IN ('subscribed', 'pending') AND c.email = ANY($1::text[]::citext[])`,
      [col('email')],
    );
  }
  return { nuevos, existentes };
}

async function guardarSupresiones(sql, supresiones) {
  let nuevas = 0;
  let contactosActualizados = 0;
  for (let i = 0; i < supresiones.length; i += TANDA) {
    const l = supresiones.slice(i, i + TANDA);
    const emails = l.map(s => s.email);
    const { rowCount } = await sql.query(
      `INSERT INTO mk_suppressions (email, reason, detail)
       SELECT u.email, 'zoho_import', NULLIF(u.categoria || COALESCE(': ' || u.detalle, ''), '')
         FROM UNNEST($1::text[], $2::text[], $3::text[]) AS u(email, categoria, detalle)
       ON CONFLICT (email) DO NOTHING`,
      [emails, l.map(s => s.categoria), l.map(s => s.detalle)],
    );
    nuevas += rowCount || 0;
    const r = await sql.query(
      `UPDATE mk_contacts c
          SET status = u.estado::mk_contact_status, unsubscribed_at = COALESCE(c.unsubscribed_at, now()), updated_at = now()
         FROM UNNEST($1::text[], $2::text[]) AS u(email, estado)
        WHERE c.email = u.email::citext AND c.status IN ('subscribed', 'pending')`,
      [emails, l.map(s => estadoContactoPorCategoria(s.categoria))],
    );
    contactosActualizados += r.rowCount || 0;
  }
  return { nuevas, contactosActualizados };
}

export async function guardarImportacion(sql, prep) {
  if (prep.tipo === 'supresiones') {
    const r = await guardarSupresiones(sql, prep.supresiones);
    return { supresiones_nuevas: r.nuevas, supresiones_ya_existentes: prep.supresiones.length - r.nuevas, contactos_marcados: r.contactosActualizados };
  }
  const r = await guardarContactos(sql, prep.contactos);
  return { contactos_nuevos: r.nuevos, contactos_existentes: r.existentes };
}

export async function importarCsv(sql, texto, opciones = {}) {
  const prep = prepararImportacion(texto, opciones);
  if (prep.error) return { ok: false, error: prep.error };
  const guardado = await guardarImportacion(sql, prep);
  return { ok: true, tipo: prep.tipo, filas: prep.filas, invalidos: prep.invalidos.length, duplicados_en_archivo: prep.duplicados, ejemplos_invalidos: prep.invalidos.slice(0, 20), ...guardado };
}
