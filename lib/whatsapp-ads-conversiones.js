// /lib/whatsapp-ads-conversiones.js
// ══════════════════════════════════════════════════════════════════════
// Conversión REAL de Google Ads: mensaje de WhatsApp recibido.
// ══════════════════════════════════════════════════════════════════════
// Hoy Google Ads cuenta como "conversión" un toque en el botón o en el ícono de WhatsApp del sitio; eso NO confirma que el cliente
// haya enviado el mensaje. Como la venta es consultiva, lo que importa es el mensaje.
//
// Cómo se mide:
//   1) Al tocar un botón de WhatsApp, una etiqueta del sitio (Tag Manager) crea un código corto, lo agrega al texto precargado
//      ("... (ref K7P4Q2)") y avisa al ERP, por el Worker, el código con el gclid (o gbraid/wbraid) de la visita.
//   2) Cuando llega el mensaje (tabla whatsapp_mensajes, dirección 'in') y trae ese código, se vincula.
//   3) Un cron sube a Google Ads la conversión offline por clic (uploadClickConversions) con ese gclid.
// Si el cliente borra el código antes de enviar, no hay vínculo y no se sube nada: se subcuenta, nunca se inventa.
//
// No guarda datos personales: solo el código, los identificadores de clic de Google, la página y el dispositivo.
// Variable de entorno propia: GOOGLE_ADS_WHATSAPP_CONVERSION_ID (id numérico de la acción de conversión "WhatsApp - mensaje recibido
// (ERP)"; el resto de las variables GOOGLE_ADS_* son las mismas del resumen semanal).

import { obtenerAccessToken, fetchWithTimeout } from './google-ads-resumen.js';

// Sin 0/O/1/I para que se pueda dictar o leer sin confundir.
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 6;
const RE_CODIGO = new RegExp(`^[${ALFABETO_CODIGO}]{${LARGO_CODIGO}}$`);
// En el mensaje: "ref K7P4Q2", "(ref: K7P4Q2)", "REF-k7p4q2", etc.
const RE_REF_EN_TEXTO = new RegExp(`\\bref[\\s:#-]{0,3}([${ALFABETO_CODIGO}]{${LARGO_CODIGO}})\\b`, 'i');
const RE_ID_CLIC = /^[A-Za-z0-9_-]{20,200}$/;
export const VENTANA_DIAS = 28; // Google acepta hasta 90 días; con 28 hay margen bajo la ventana de 30 de la acción
export const MAX_INTENTOS = 5;
export const RETENCION_DIAS = 120;

export function normalizarCodigo(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return RE_CODIGO.test(s) ? s : null;
}

export function extraerCodigoDeTexto(texto) {
  const m = RE_REF_EN_TEXTO.exec(String(texto ?? ''));
  return m ? normalizarCodigo(m[1]) : null;
}

function limpiarId(v) {
  const s = String(v ?? '').trim();
  return RE_ID_CLIC.test(s) ? s : null;
}

function limpiarTexto(v, largo) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, largo);
  return s || null;
}

// body: { codigo, gclid?, gbraid?, wbraid?, pagina?, dispositivo? } -- lo manda el Worker (con la clave) a pedido del sitio.
export function validarClic(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  const codigo = normalizarCodigo(body.codigo);
  if (!codigo) return { ok: false, error: 'Código inválido' };
  const gclid = limpiarId(body.gclid);
  const gbraid = limpiarId(body.gbraid);
  const wbraid = limpiarId(body.wbraid);
  if (!gclid && !gbraid && !wbraid) return { ok: false, error: 'Sin identificador de clic de Google' };
  let pagina = limpiarTexto(body.pagina, 200);
  if (pagina) pagina = pagina.replace(/[?#].*$/, ''); // sin parámetros de la URL
  return {
    ok: true,
    fila: {
      codigo, gclid, gbraid, wbraid, pagina,
      dispositivo: ['movil', 'escritorio'].includes(body.dispositivo) ? body.dispositivo : null,
    },
  };
}

export async function asegurarTablaWaClicsAds(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS wa_clics_ads (
      id SERIAL PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      gclid TEXT,
      gbraid TEXT,
      wbraid TEXT,
      pagina TEXT,
      dispositivo TEXT,
      mensaje_id INTEGER,
      mensaje_en TIMESTAMPTZ,
      subida_en TIMESTAMPTZ,
      intentos INTEGER NOT NULL DEFAULT 0,
      ultimo_error TEXT
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS wa_clics_ads_creado ON wa_clics_ads (creado_en);`;
}

export async function guardarClic(sql, fila) {
  await asegurarTablaWaClicsAds(sql);
  await sql.query(
    `INSERT INTO wa_clics_ads (codigo, gclid, gbraid, wbraid, pagina, dispositivo) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (codigo) DO NOTHING`,
    [fila.codigo, fila.gclid, fila.gbraid, fila.wbraid, fila.pagina, fila.dispositivo],
  );
}

// Busca en los mensajes recibidos los que traen un código de clic todavía sin vincular.
export async function vincularMensajes(sql) {
  const pendientes = await sql.query(
    `SELECT codigo FROM wa_clics_ads WHERE mensaje_id IS NULL AND creado_en >= now() - make_interval(days => $1)`,
    [VENTANA_DIAS],
  );
  if (!pendientes.rows.length) return { pendientes: 0, vinculados: 0 };
  const codigos = new Set(pendientes.rows.map((r) => r.codigo));
  const msgs = await sql.query(
    `SELECT id, marca_tiempo, contenido_texto FROM whatsapp_mensajes
     WHERE direccion = 'in' AND marca_tiempo >= now() - make_interval(days => $1) AND contenido_texto ~* 'ref[[:space:]:#-]{0,3}[A-Za-z0-9]{6}'
     ORDER BY marca_tiempo ASC LIMIT 2000`,
    [VENTANA_DIAS + 2],
  );
  let vinculados = 0;
  for (const m of msgs.rows) {
    const codigo = extraerCodigoDeTexto(m.contenido_texto);
    if (!codigo || !codigos.has(codigo)) continue;
    const r = await sql.query(
      `UPDATE wa_clics_ads SET mensaje_id = $1, mensaje_en = $2 WHERE codigo = $3 AND mensaje_id IS NULL`,
      [m.id, m.marca_tiempo, codigo],
    );
    if (r.rowCount) vinculados++;
    codigos.delete(codigo);
  }
  return { pendientes: pendientes.rows.length, vinculados };
}

// "2026-10-14 15:04:05+00:00" -- el formato que pide uploadClickConversions.
export function fechaGoogle(d) {
  const f = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${f.getUTCFullYear()}-${p(f.getUTCMonth() + 1)}-${p(f.getUTCDate())} ${p(f.getUTCHours())}:${p(f.getUTCMinutes())}:${p(f.getUTCSeconds())}+00:00`;
}

export function faltanVariablesConversion(env = process.env) {
  return ['GOOGLE_ADS_WHATSAPP_CONVERSION_ID'].filter((k) => !String(env[k] || '').trim());
}

// Arma la conversión de una fila. La conversión no puede quedar antes del clic: se usa la hora del mensaje, y si por desfase de relojes
// quedara antes del registro del clic, un segundo después de este.
export function armarConversion(fila, cid, idAccion) {
  const clic = new Date(fila.creado_en).getTime();
  const msg = new Date(fila.mensaje_en).getTime();
  const c = {
    conversionAction: `customers/${cid}/conversionActions/${idAccion}`,
    conversionDateTime: fechaGoogle(Math.max(msg, clic + 1000)),
    orderId: fila.codigo, // Google descarta repetidos con el mismo orderId
    conversionEnvironment: 'WEB',
  };
  if (fila.gclid) c.gclid = fila.gclid;
  else if (fila.gbraid) c.gbraid = fila.gbraid;
  else c.wbraid = fila.wbraid;
  return c;
}

// Errores parciales de Google: devuelve { indice: mensaje }.
export function erroresParciales(respuesta) {
  const salida = {};
  const err = respuesta?.partialFailureError;
  if (!err) return salida;
  for (const d of err.details || []) {
    for (const e of d.errors || []) {
      const idx = e.location?.fieldPathElements?.find((x) => x.fieldName === 'conversions')?.index;
      const msg = `${Object.values(e.errorCode || {})[0] || 'ERROR'}: ${String(e.message || '').slice(0, 160)}`;
      if (idx !== undefined) salida[idx] = msg;
    }
  }
  if (!Object.keys(salida).length && err.message) salida.todos = String(err.message).slice(0, 200);
  return salida;
}

export async function subirConversiones(sql, env = process.env) {
  const cid = String(env.GOOGLE_ADS_DEFAULT_CUSTOMER_ID).replace(/\D/g, '');
  const filas = (await sql.query(
    `SELECT id, codigo, creado_en, gclid, gbraid, wbraid, mensaje_en FROM wa_clics_ads
     WHERE mensaje_id IS NOT NULL AND subida_en IS NULL AND intentos < $1
       AND creado_en >= now() - make_interval(days => $2) ORDER BY mensaje_en ASC LIMIT 200`,
    [MAX_INTENTOS, VENTANA_DIAS],
  )).rows;
  if (!filas.length) return { a_subir: 0, subidas: 0, con_error: 0 };

  const token = await obtenerAccessToken(env);
  const version = env.GOOGLE_ADS_API_VERSION || 'v25';
  const idAccion = String(env.GOOGLE_ADS_WHATSAPP_CONVERSION_ID).replace(/\D/g, '');
  const r = await fetchWithTimeout(`https://googleads.googleapis.com/${version}/customers/${cid}:uploadClickConversions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ conversions: filas.map((f) => armarConversion(f, cid, idAccion)), partialFailure: true }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detalle = `HTTP ${r.status}: ${String(data?.error?.message || 'sin detalle').slice(0, 200)}`;
    await sql.query(`UPDATE wa_clics_ads SET intentos = intentos + 1, ultimo_error = $2 WHERE id = ANY($1::int[])`, [filas.map((f) => f.id), detalle]);
    return { a_subir: filas.length, subidas: 0, con_error: filas.length, error: detalle };
  }
  const errores = erroresParciales(data);
  let subidas = 0;
  for (let i = 0; i < filas.length; i++) {
    const msg = errores[i] ?? errores.todos;
    if (msg) {
      await sql.query(`UPDATE wa_clics_ads SET intentos = intentos + 1, ultimo_error = $2 WHERE id = $1`, [filas[i].id, msg]);
    } else {
      subidas++;
      await sql.query(`UPDATE wa_clics_ads SET subida_en = now(), ultimo_error = NULL WHERE id = $1`, [filas[i].id]);
    }
  }
  // Motivos de Google (códigos de error, sin datos del cliente) para poder revisar en el registro por qué una conversión no se aceptó.
  const motivos = [...new Set(Object.values(errores))].slice(0, 3);
  return { a_subir: filas.length, subidas, con_error: filas.length - subidas, ...(motivos.length ? { motivos } : {}) };
}

// Solo cantidades (sin montos): cuántos toques de botón con código, cuántos terminaron en mensaje y cuántos se subieron a Google.
export async function resumenWaClics(sql, dias) {
  await asegurarTablaWaClicsAds(sql);
  const r = await sql.query(
    `SELECT count(*)::int AS toques, count(mensaje_id)::int AS con_mensaje, count(subida_en)::int AS subidas,
            count(*) FILTER (WHERE ultimo_error IS NOT NULL AND subida_en IS NULL)::int AS con_error
     FROM wa_clics_ads WHERE creado_en >= now() - make_interval(days => $1)`,
    [dias],
  );
  return r.rows[0];
}
