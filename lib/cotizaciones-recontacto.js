// /lib/cotizaciones-recontacto.js
// Resumen diario "Cotizaciones por recontactar" (correo): qué cotizaciones llevan días sin respuesta del cliente y
// a quién le toca recontactarlas. Funciones puras (sin red ni base de datos).
//
// Entra una cotización si:
//   - su estado es "Cotización enviada" o "Contactado" (la gestión está abierta y esperando al cliente),
//   - pasaron `umbralDias` o más desde NUESTRO último contacto (correo enviado, contacto registrado o último cambio de estado),
//   - y el cliente no escribió después de ese contacto.
// Las que llevan más de `topeDias` ya se dan por perdidas y no se repiten todos los días.

export const ESTADOS_A_RECONTACTAR = ['cotizacion_enviada', 'contactado'];
export const UMBRAL_DIAS_RECONTACTO = 7;
export const TOPE_DIAS_RECONTACTO = 35;

const aFecha = v => (v ? new Date(v) : null);
const diaChile = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const diasEntre = (desde, hasta) => Math.round((new Date(diaChile(hasta) + 'T00:00:00Z') - new Date(diaChile(desde) + 'T00:00:00Z')) / 86400000);

export function escapeHtml(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// filas: { id, numero, cliente_nombre, monto, fecha, estado, actualizado_en, ultimo_contacto, ultimo_entrante,
//          responsable, vendedor_nombre }
export function seleccionarPorRecontactar(filas, ahora = new Date(), { umbralDias = UMBRAL_DIAS_RECONTACTO, topeDias = TOPE_DIAS_RECONTACTO } = {}) {
  const items = [];
  for (const f of filas || []) {
    if (!ESTADOS_A_RECONTACTAR.includes(f.estado)) continue;
    // el último contacto nuestro; si no hay registro, el último cambio de estado, y en último caso la fecha de emisión
    const base = [aFecha(f.ultimo_contacto), aFecha(f.actualizado_en)].filter(Boolean).sort((a, b) => b - a)[0] || aFecha(f.fecha);
    if (!base) continue;
    const entrante = aFecha(f.ultimo_entrante);
    if (entrante && entrante > base) continue; // el cliente respondió: la pelota está de nuestro lado, pero no es "sin respuesta"
    const dias = diasEntre(base, ahora);
    if (dias < umbralDias || dias > topeDias) continue;
    items.push({
      id: f.id, numero: f.numero, cliente: f.cliente_nombre || 'Sin nombre', monto: Number(f.monto) || 0, dias,
      estado: f.estado, responsable: f.responsable || f.vendedor_nombre || 'Sin responsable',
    });
  }
  return items.sort((a, b) => b.dias - a.dias || b.monto - a.monto);
}

const fmtMonto = n => '$' + Math.round(n).toLocaleString('es-CL');

// Correo "opción C": una tabla por responsable con cliente, cotización, monto y días sin respuesta.
export function armarCorreoRecontacto(items, { urlBase, umbralDias = UMBRAL_DIAS_RECONTACTO } = {}) {
  const porResponsable = new Map();
  for (const it of items) {
    if (!porResponsable.has(it.responsable)) porResponsable.set(it.responsable, []);
    porResponsable.get(it.responsable).push(it);
  }
  const celda = 'padding:6px 10px;border-bottom:1px solid #eee;';
  const bloques = [...porResponsable.entries()].sort((a, b) => b[1].length - a[1].length).map(([responsable, lista]) => {
    const total = lista.reduce((s, x) => s + x.monto, 0);
    const filas = lista.map(x => `
      <tr>
        <td style="${celda}"><b>${escapeHtml(x.cliente)}</b></td>
        <td style="${celda}"><a href="${urlBase}/cotizaciones-clientes.html">#${escapeHtml(x.numero)}</a></td>
        <td style="${celda}text-align:right;">${fmtMonto(x.monto)}</td>
        <td style="${celda}text-align:center;${x.dias >= 14 ? 'color:#B91C1C;font-weight:bold;' : ''}">${x.dias} días</td>
      </tr>`).join('');
    return `
      <h3 style="margin:18px 0 6px;">${escapeHtml(responsable)} — ${lista.length} ${lista.length === 1 ? 'cotización' : 'cotizaciones'} · ${fmtMonto(total)}</h3>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;min-width:460px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="padding:6px 10px;text-align:left;">Cliente</th><th style="padding:6px 10px;">Cotización</th>
          <th style="padding:6px 10px;text-align:right;">Monto</th><th style="padding:6px 10px;">Sin respuesta</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  }).join('');
  const n = items.length;
  const html = `
    <h2>📞 Cotizaciones por recontactar hoy</h2>
    <p style="color:#666;">${n} ${n === 1 ? 'cotización lleva' : 'cotizaciones llevan'} ${umbralDias} o más días sin respuesta del cliente (estado "Cotización enviada" o "Contactado").
    Llámalo, escríbele por WhatsApp o por correo, y deja registrado el contacto en la ficha.</p>
    ${bloques}
    <p style="margin-top:18px;"><a href="${urlBase}/cotizaciones-clientes.html">Abrir Cotizaciones en el ERP</a></p>`;
  const asunto = `📞 ${n} ${n === 1 ? 'cotización' : 'cotizaciones'} por recontactar hoy`;
  return { asunto, html };
}
