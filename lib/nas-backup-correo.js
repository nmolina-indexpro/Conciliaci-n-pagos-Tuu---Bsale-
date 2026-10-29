// /lib/nas-backup-correo.js
// Informe semanal de respaldos que IndexPro le envía al CLIENTE (no al equipo interno): corto, en lenguaje simple, sin jerga de QNAP ni cifras de la empresa.
// Función pura (sin red ni BD): recibe el resumen que ya calcula lib/nas-backup.js y devuelve { asunto, html, veredicto }.
// Se arma con lib/correo-base.js (mismo diseño que los correos del ERP) pero con pie y botón de contacto propios.

import { armarCorreo, tarjetas, avisos, seccion, tabla, vacio, chip, esc, dec, plural, fechaCorta, MESES } from './correo-base.js';
import { diaChile, esFalla } from './nas-backup.js';

// Dirección a la que el cliente escribe si tiene dudas (la mesa de ayuda NAS de IndexPro en Zoho Desk).
export const CONTACTO_SOPORTE_NAS = 'serviciosti@indexpro.zohodesk.com';

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const sumarDias = (dia, n) => new Date(Date.parse(dia + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const diaSemana = dia => DIAS_SEMANA[new Date(dia + 'T12:00:00Z').getUTCDay()];
const fechaDia = dia => `${diaSemana(dia)} ${fechaCorta(dia)}`;
const horaChile = iso => new Date(iso).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });

// 'Del 23 al 29 de octubre de 2026' / 'Del 28 de septiembre al 4 de octubre de 2026'
function rangoLargo(ini, fin) {
  const [a1, m1, d1] = ini.split('-').map(Number);
  const [a2, m2, d2] = fin.split('-').map(Number);
  if (a1 === a2 && m1 === m2) return `Del ${d1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  return `Del ${d1} de ${MESES[m1 - 1]}${a1 === a2 ? '' : ' de ' + a1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

const SIMBOLO = { ok: ['✓', 'verde'], falla: ['✕', 'rojo'], aviso: ['!', 'amarillo'], vacio: ['—', 'gris'] };
const COLORES = { verde: ['#E3F6EA', '#12713A'], rojo: ['#FDE2E2', '#B91C1C'], amarillo: ['#FEF3C7', '#92400E'], gris: ['#EEF2F9', '#64748b'] };

// Franja de 7 días (un cuadro por día: ✓ respaldado, ✕ falló, ! con advertencias, — sin confirmación)
function franjaSemana(dias) {
  const celdas = dias.map(d => {
    const [simbolo, t] = SIMBOLO[d.estado] || SIMBOLO.vacio;
    const [fondo, texto] = COLORES[t];
    return `<td width="${Math.floor(100 / dias.length)}%" style="padding:3px;text-align:center;">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">${diaSemana(d.dia)}</div>
      <div style="margin-top:3px;background:${fondo};color:${texto};border-radius:8px;padding:8px 0;font-size:16px;font-weight:800;">${simbolo}</div>
      <div style="margin-top:3px;font-size:11px;color:#94a3b8;">${Number(d.dia.slice(8))}</div></td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 0;"><tr>${celdas}</tr></table>`;
}

// resumen = resumirCliente(...), eventos = eventos normalizados y consolidados del cliente, alertas = filas de nas_alertas ({fecha, app, categoria, severidad, mensaje}).
// Cubre los 7 días anteriores a `ahora` (pensado para enviarse el lunes temprano, con la semana ya cerrada).
export function correoSemanalNasBackup({ resumen, eventos = [], alertas = [], ahora = new Date(), contacto = CONTACTO_SOPORTE_NAS }) {
  const equipo = resumen.cliente.equipo ? `NAS ${resumen.cliente.equipo}` : 'NAS';
  const hoy = diaChile(ahora);
  const ini = sumarDias(hoy, -7);
  const fin = sumarDias(hoy, -1);
  const enSemana = dia => dia >= ini && dia <= fin;

  const diario = resumen.jobs.find(j => j.cadencia === 'Diaria') || null;
  const semanal = resumen.jobs.find(j => j.cadencia === 'Semanal') || null;
  const diasDiario = diario ? diario.calendario.filter(c => enSemana(c.dia)) : [];
  const diasOk = diasDiario.filter(d => d.estado === 'ok' || d.estado === 'aviso').length;
  const diasFalla = diasDiario.filter(d => d.estado === 'falla').length;
  const diasSinConfirmar = diasDiario.filter(d => d.estado === 'vacio').length;

  const fallasSemana = eventos.filter(e => e.job && enSemana(e.dia) && esFalla(e)).length;
  const alertasSemana = alertas.filter(a => enSemana(diaChile(a.fecha)));
  const alertasGraves = alertasSemana.filter(a => a.severidad === 'Error');

  // Veredicto: rojo si algo falló, amarillo si falta confirmación o hay advertencias, verde si todo está al día.
  const hayFalla = fallasSemana > 0 || (resumen.jobs || []).some(j => j.estado === 'falla') || alertasGraves.length > 0;
  const hayDuda = diasSinConfirmar > 0 || (resumen.jobs || []).some(j => j.estado !== 'ok') || alertasSemana.length > 0;
  const veredicto = hayFalla ? 'rojo' : (hayDuda ? 'amarillo' : 'verde');

  const mensajeVeredicto = {
    verde: { tono: 'verde', texto: `<b>Tus respaldos están al día.</b> Todos los respaldos programados de tu ${equipo} se completaron esta semana y no hay alertas del equipo.` },
    amarillo: { tono: 'amarillo', texto: `<b>Falta confirmación de algunos respaldos de tu ${equipo}.</b> ${diasSinConfirmar ? `No recibimos aviso de ${diasSinConfirmar} ${plural(diasSinConfirmar, 'día', 'días')} de la semana: no significa que el respaldo no se haya hecho, y lo estamos revisando. ` : ''}No necesitas hacer nada por ahora.` },
    rojo: { tono: 'rojo', texto: `<b>Detectamos un problema en los respaldos de tu ${equipo}.</b> Escríbenos y lo revisamos juntos para dejarlos al día.` },
  }[veredicto];

  // Tarjetas: lo esencial de un vistazo
  const gbSemana = eventos.filter(e => e.job && enSemana(e.dia) && e.tipo === 'finished' && e.transferidoGb != null).reduce((t, e) => t + e.transferidoGb, 0);
  const hayGb = eventos.some(e => e.job && enSemana(e.dia) && e.tipo === 'finished' && e.transferidoGb != null);
  const exitoSemanal = semanal && semanal.ultimoExito;
  const tonoSemanal = !semanal ? 'gris' : (semanal.estado === 'ok' ? 'verde' : (semanal.estado === 'falla' ? 'rojo' : 'amarillo'));
  const textoSemanal = !semanal ? '—' : (semanal.estado === 'ok' ? 'Completo' : (semanal.estado === 'falla' ? 'Con falla' : 'Sin confirmar'));
  const cuadros = [];
  if (diario) cuadros.push({ etiqueta: 'Respaldo diario', cifra: `${diasOk} de ${diasDiario.length}`, sub: 'días respaldados en el disco externo', tono: diasFalla ? 'rojo' : (diasOk === diasDiario.length ? 'verde' : 'amarillo') });
  if (semanal) cuadros.push({ etiqueta: 'Respaldo semanal', cifra: textoSemanal, sub: exitoSemanal ? `Google Drive · ${fechaDia(exitoSemanal.dia)}` : 'Google Drive', tono: tonoSemanal });
  if (hayGb) cuadros.push({ etiqueta: 'Información nueva', cifra: `${dec(gbSemana, 1)} GB`, sub: 'copiada esta semana', tono: 'azul' });

  // Detalle por respaldo
  const estadoChip = j => (j.estado === 'ok' ? chip('Al día', 'verde') : (j.estado === 'falla' ? chip('Con falla', 'rojo') : chip('Sin confirmar', 'amarillo')));
  const ultimo = j => (j.ultimoExito ? `${fechaDia(j.ultimoExito.dia)}, ${horaChile(j.ultimoExito.fecha)}` : '—');
  const filas = (resumen.jobs || []).map(j => [`<b>${esc(j.etiqueta)}</b><br><span style="color:#64748b;font-size:12px;">${esc(j.cadencia === 'Diaria' ? 'Todos los días' : 'Cada viernes')}</span>`, esc(j.destino.replace(/ \(.*\)$/, '')), ultimo(j), estadoChip(j)]);
  const detalle = tabla([{ titulo: 'Respaldo' }, { titulo: 'Se guarda en' }, { titulo: 'Último completado' }, { titulo: 'Estado' }], filas);

  // Alertas del equipo (NAS)
  const lista = alertasSemana.slice(0, 5).map(a => ({ tono: a.severidad === 'Error' ? 'rojo' : 'naranja', texto: `<b>${esc(a.categoria || a.app || 'Equipo')}</b> · ${esc(a.mensaje)} <span style="color:#64748b;">(${fechaCorta(diaChile(a.fecha))})</span>` }));
  const bloqueAlertas = lista.length
    ? avisos(lista) + (alertasSemana.length > 5 ? `<p style="margin:6px 0 0;font-size:12px;color:#64748b;">… y ${alertasSemana.length - 5} más.</p>` : '')
    : vacio(`Tu ${equipo} no reportó alertas de salud ni de seguridad esta semana.`, 'verde');

  const cuerpo = avisos([mensajeVeredicto])
    + tarjetas(cuadros)
    + seccion('Detalle de los respaldos', null, detalle)
    + (diario ? seccion('Respaldo diario de la semana', `Cada noche a las ${(diario.horario.match(/\d{2}:\d{2}/) || ['01:30'])[0]} tu ${equipo} copia lo nuevo al disco externo.`, franjaSemana(diasDiario)) : '')
    + seccion('Estado del equipo', null, bloqueAlertas);

  const rango = rangoLargo(ini, fin);
  const pie = `<b style="color:#0b2a5b;">IndexPro · Respaldo de tus datos</b><br>Informe automático semanal. Si tienes dudas o quieres revisar algo, escríbenos a <a href="mailto:${esc(contacto)}" style="color:#0b57d0;text-decoration:none;">${esc(contacto)}</a>.`;
  const html = armarCorreo({
    etiqueta: 'IndexPro · Respaldos',
    titulo: 'Informe semanal de respaldos',
    subtitulo: `${esc(resumen.cliente.nombre)} · ${esc(equipo)} · ${rango}`,
    cuerpo,
    leyenda: '✓ respaldo completado · ✕ el respaldo falló · ! terminó con advertencias · — sin confirmación (puede que el respaldo se haya hecho, pero el equipo no nos avisó).',
    botones: veredicto === 'verde' ? [] : [{ url: `mailto:${contacto}?subject=${encodeURIComponent('Respaldos ' + resumen.cliente.nombre)}`, texto: 'Escribir a IndexPro' }],
    pie,
  });
  const marca = { verde: '', amarillo: 'Falta confirmación · ', rojo: 'Requiere atención · ' }[veredicto];
  return { asunto: `${marca}Informe semanal de respaldos · ${resumen.cliente.nombre} · ${fechaCorta(ini)} al ${fechaCorta(fin)}`, html, veredicto, semana: { ini, fin } };
}

// Copia de revisión que se le envía al equipo de IndexPro ANTES de mandar el informe al cliente: el mismo correo con un recuadro arriba que dice que
// todavía no salió y lleva al ERP, donde se aprueba (Soporte > IndexPro > Informe semanal al cliente).
export function correoRevisionNasBackup({ informe, para = [], urlErp }) {
  const url = `${urlErp}/soporte-indexpro.html${informe.id ? `?informe=${informe.id}` : ''}`;
  const banner = `<div style="margin:0;padding:14px 12px 0;background:#eef2f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:680px;margin:0 auto;background:#FEF3C7;border-left:4px solid #92400E;border-radius:8px;padding:12px 16px;font-size:13.5px;line-height:1.5;color:#1b2a41;">
      <b>Revisión interna: este informe todavía NO se envió al cliente.</b><br>
      Saldrá a <b>${para.map(esc).join(', ') || '(sin destinatarios)'}</b> solo cuando lo apruebes en el ERP.
      <a href="${esc(url)}" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#0b57d0;color:#ffffff;border-radius:8px;font-weight:700;text-decoration:none;">Revisar y aprobar en el ERP</a>
    </div></div>`;
  return { asunto: `[REVISAR antes de enviar] ${informe.asunto}`, html: banner + informe.html };
}
