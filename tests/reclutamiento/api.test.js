// Reclutamiento: los manejadores REALES (lib/reclutamiento-api.js) contra Postgres en memoria (PGlite), sin red ni correo real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearBase } from '../mailing/_pg.js';
import { agendaPublica, reclutamiento } from '../../lib/reclutamiento-api.js';

const AHORA = new Date('2026-11-23T20:00:00Z'); // lunes 23-nov-2026, 17:00 en Chile
const ADMIN = { rol: 'admin', nombre: 'Admin Prueba' };

function respuesta() { const r = { codigo: 200, cuerpo: null, status(c) { r.codigo = c; return r; }, json(o) { r.cuerpo = o; return r; } }; return r; }
async function montar() {
  const { sql, cerrar } = await crearBase();
  const correos = [], avisos = [];
  const deps = {
    getSql: async () => sql, urlBase: 'https://erp.prueba', ahora: () => AHORA,
    enviarCorreo: async d => { correos.push(d); return { enviado: true }; },
    asegurarTablaNotificaciones: async () => {}, notificacionDebeEnviarse: async () => true,
    obtenerSuscriptoresEmail: async () => ['admin@prueba.cl'], marcarNotificacionEnviada: async (_s, tipo, c) => { avisos.push({ tipo, asunto: c.asunto }); },
  };
  const admin = async (body, rol = ADMIN) => { const r = respuesta(); await reclutamiento(body ? { method: 'POST', body } : { method: 'GET', query: {} }, r, rol, deps); return r; };
  const pub = async (metodo, datos) => { const r = respuesta(); await agendaPublica(metodo === 'GET' ? { method: 'GET', query: datos } : { method: 'POST', query: {}, body: datos }, r, deps); return r; };
  return { sql, cerrar, deps, correos, avisos, admin, pub };
}

test('solo un administrador entra a Reclutamiento', async () => {
  const t = await montar();
  try { const r = await t.admin(null, { rol: 'usuario' }); assert.equal(r.codigo, 403); } finally { await t.cerrar(); }
});

test('flujo completo: importar, enlace del postulante, reservar, cambiar, cancelar y bloquear', async () => {
  const t = await montar();
  try {
    // 1) El administrador importa dos postulantes (uno sin correo)
    let r = await t.admin({ accion: 'importar', postulantes: [
      { nombre: 'Ana Pérez Soto', email: 'ana@correo.cl', telefono: '957011597', indeed_id: 'a1', fecha_postulacion: '2026-11-20', respuestas: { experiencia: '4', smd: 'Si', esquemas: 'Si' }, resumen: 'Técnica electrónica' },
      { nombre: 'Beto Rojas', indeed_id: 'b2', fecha_postulacion: '2026-11-21' },
      { nombre: '', email: 'x@y.cl' }, { nombre: 'Mala Dirección', email: 'no-es-correo' } ] });
    assert.equal(r.cuerpo.importados, 2); assert.equal(r.cuerpo.errores.length, 2);
    r = await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Ana Pérez Soto', email: 'ana@correo.cl', indeed_id: 'a1' }] });
    assert.equal(r.cuerpo.actualizados, 1, 'reimportar no duplica');

    // 2) Lista del administrador: trae enlace personal y la configuración inicial (mar-vie 10:30-15:30, hasta fin de mes)
    r = await t.admin(null);
    const [ana, beto] = [r.cuerpo.postulantes.find(p => p.nombre.startsWith('Ana')), r.cuerpo.postulantes.find(p => p.nombre.startsWith('Beto'))];
    assert.equal(r.cuerpo.postulantes.length, 2); assert.match(ana.enlace, /^https:\/\/erp\.prueba\/agendar\.html\?t=[\w-]{24}$/);
    assert.deepEqual(r.cuerpo.config.dias, [2, 3, 4, 5]); assert.equal(r.cuerpo.config.fecha_hasta, '2026-11-30');
    assert.equal(ana.telefono, '+56 9 5701 1597'); assert.equal(ana.fecha_postulacion, '2026-11-20');
    assert.equal(r.cuerpo.espacios.filter(e => e.estado === 'libre').length, 15);
    const tokenAna = new URL(ana.enlace).searchParams.get('t'), tokenBeto = new URL(beto.enlace).searchParams.get('t');

    // 3) Enlace inválido o inventado
    assert.equal((await t.pub('GET', { t: 'corto' })).codigo, 404);
    assert.equal((await t.pub('GET', { t: 'x'.repeat(24) })).codigo, 404);

    // 4) El postulante ve solo su nombre de pila y los espacios libres, nunca datos de otros
    r = await t.pub('GET', { t: tokenAna });
    assert.equal(r.codigo, 200); assert.equal(r.cuerpo.nombre, 'Ana'); assert.equal(r.cuerpo.espacios.length, 15); assert.equal(r.cuerpo.reserva, null);
    assert.ok(!JSON.stringify(r.cuerpo).includes('ana@correo.cl'), 'no expone el correo');
    const espacios = r.cuerpo.espacios;

    // 5) Configura la videollamada y Ana reserva: llega confirmación a ella y aviso al equipo
    r = await t.admin({ accion: 'config', config: { ...(await t.admin(null)).cuerpo.config, enlace_video: 'https://meet.prueba/abc', aviso: 'Conéctate 5 minutos antes' } });
    assert.equal(r.codigo, 200);
    r = await t.pub('POST', { t: tokenAna, accion: 'reservar', inicio: espacios[0].inicio, telefono: '+56 9 1111 2222' });
    assert.equal(r.codigo, 200); assert.equal(r.cuerpo.reserva.enlace_video, 'https://meet.prueba/abc'); assert.equal(r.cuerpo.correoEnviado, true);
    assert.equal(t.correos.length, 2); assert.equal(t.correos[0].para, 'ana@correo.cl'); assert.match(t.correos[0].asunto, /Entrevista agendada/); assert.ok(t.correos[0].html.includes('https://meet.prueba/abc'));
    assert.equal(t.correos[1].para, 'admin@prueba.cl'); assert.equal(t.avisos[0].tipo, 'entrevistas-reserva');

    // 6) Beto (sin correo) no puede reservar sin dar uno, ni tomar el espacio de Ana
    assert.equal((await t.pub('POST', { t: tokenBeto, accion: 'reservar', inicio: espacios[1].inicio })).codigo, 400);
    r = await t.pub('POST', { t: tokenBeto, accion: 'reservar', inicio: espacios[0].inicio, email: 'beto@correo.cl' });
    assert.equal(r.codigo, 409, 'ese espacio ya está ocupado');
    r = await t.pub('GET', { t: tokenBeto }); assert.equal(r.cuerpo.espacios.length, 14, 'el espacio de Ana ya no se ofrece');
    // un espacio dentro de las 24 h de anticipación tampoco se puede reservar (martes 24-nov)
    r = await t.pub('POST', { t: tokenBeto, accion: 'reservar', inicio: '2026-11-24T13:30:00.000Z', email: 'beto@correo.cl' });
    assert.equal(r.codigo, 409);
    r = await t.pub('POST', { t: tokenBeto, accion: 'reservar', inicio: espacios[1].inicio, email: 'beto@correo.cl' });
    assert.equal(r.codigo, 200); assert.equal(t.correos.length, 4);

    // 7) Ana cambia de horario: el anterior queda libre, y el aviso al equipo dice «cambio»
    r = await t.pub('POST', { t: tokenAna, accion: 'reservar', inicio: espacios[5].inicio });
    assert.equal(r.codigo, 200); assert.match(t.avisos.at(-1).asunto, /cambió su horario/);
    r = await t.pub('GET', { t: tokenAna }); assert.equal(r.cuerpo.reserva.inicio, espacios[5].inicio); assert.ok(r.cuerpo.espacios.some(e => e.inicio === espacios[0].inicio), 'el espacio anterior quedó libre');
    // intento de cambiar a un espacio que otra persona ya tiene: se mantiene la reserva actual
    r = await t.pub('POST', { t: tokenAna, accion: 'reservar', inicio: espacios[1].inicio });
    assert.equal(r.codigo, 409); assert.equal((await t.pub('GET', { t: tokenAna })).cuerpo.reserva.inicio, espacios[5].inicio);

    // 8) El administrador ve las reservas y bloquea/desbloquea espacios; no puede bloquear uno ocupado
    r = await t.admin(null); assert.equal(r.cuerpo.postulantes.filter(p => p.reserva_inicio).length, 2);
    assert.equal(r.cuerpo.espacios.find(e => e.inicio === espacios[5].inicio).postulante, 'Ana Pérez Soto');
    assert.equal((await t.admin({ accion: 'bloquear', inicio: espacios[5].inicio })).codigo, 409);
    assert.equal((await t.admin({ accion: 'bloquear', inicio: espacios[7].inicio })).codigo, 200);
    assert.ok(!(await t.pub('GET', { t: tokenBeto })).cuerpo.espacios.some(e => e.inicio === espacios[7].inicio));
    assert.equal((await t.admin({ accion: 'desbloquear', inicio: espacios[7].inicio })).codigo, 200);

    // 9) Ana cancela: queda «invitada» y el espacio vuelve a estar libre
    r = await t.pub('POST', { t: tokenAna, accion: 'cancelar' }); assert.equal(r.codigo, 200); assert.match(t.avisos.at(-1).asunto, /canceló/);
    assert.equal((await t.admin(null)).cuerpo.postulantes.find(p => p.nombre.startsWith('Ana')).estado, 'invitado');

    // 10) Agenda cerrada: nadie puede reservar; reabrir con otro período funciona
    const cfg = (await t.admin(null)).cuerpo.config;
    await t.admin({ accion: 'config', config: { ...cfg, activa: false } });
    assert.equal((await t.pub('POST', { t: tokenAna, accion: 'reservar', inicio: espacios[0].inicio })).codigo, 409);
    assert.equal((await t.admin({ accion: 'config', config: { ...cfg, duracion_min: 5 } })).codigo, 400, 'config inválida rechazada');

    // 11) Estado y notas; nuevo enlace invalida el anterior; eliminar borra todo
    assert.equal((await t.admin({ accion: 'actualizar', id: ana.id, estado: 'entrevistado', notas: 'Buena entrevista' })).codigo, 200);
    assert.equal((await t.admin({ accion: 'actualizar', id: ana.id, estado: 'inventado' })).codigo, 400);
    const nuevo = (await t.admin({ accion: 'regenerar_token', id: ana.id })).cuerpo.enlace; assert.notEqual(nuevo, ana.enlace);
    assert.equal((await t.pub('GET', { t: tokenAna })).codigo, 404, 'el enlace anterior ya no sirve');
    assert.equal((await t.admin({ accion: 'eliminar', id: beto.id })).codigo, 200);
    assert.equal((await t.admin(null)).cuerpo.postulantes.length, 1);
  } finally { await t.cerrar(); }
});

test('si dos personas reservan el mismo espacio a la vez, solo una lo logra', async () => {
  const t = await montar();
  try {
    await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Uno Uno', email: 'uno@correo.cl' }, { nombre: 'Dos Dos', email: 'dos@correo.cl' }] });
    const lista = (await t.admin(null)).cuerpo.postulantes, tokens = lista.map(p => new URL(p.enlace).searchParams.get('t'));
    const inicio = (await t.pub('GET', { t: tokens[0] })).cuerpo.espacios[0].inicio;
    const [a, b] = await Promise.all(tokens.map(tok => t.pub('POST', { t: tok, accion: 'reservar', inicio })));
    assert.deepEqual([a.codigo, b.codigo].sort(), [200, 409]);
    const { rows } = await t.sql`SELECT count(*)::int AS n FROM reclutamiento_reservas WHERE estado = 'confirmada';`; assert.equal(rows[0].n, 1);
  } finally { await t.cerrar(); }
});

test('cada entrevista tiene su propio enlace de videollamada y se le puede avisar al postulante', async () => {
  const t = await montar();
  try {
    await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Ana Pérez', email: 'ana@correo.cl' }, { nombre: 'Beto Rojas' }] });
    const lista = (await t.admin(null)).cuerpo.postulantes, ana = lista.find(p => p.nombre === 'Ana Pérez'), beto = lista.find(p => p.nombre === 'Beto Rojas');
    const tokAna = new URL(ana.enlace).searchParams.get('t'), tokBeto = new URL(beto.enlace).searchParams.get('t');
    const esp = (await t.pub('GET', { t: tokAna })).cuerpo.espacios;
    // sin enlace general ni propio: el postulante no ve enlace; el aviso al equipo dice que falta
    let r = await t.pub('POST', { t: tokAna, accion: 'reservar', inicio: esp[0].inicio });
    assert.equal(r.cuerpo.reserva.enlace_video, null); assert.match(t.correos.at(-1).html, /Falta el enlace de la videollamada/);
    assert.equal((await t.admin(null)).cuerpo.postulantes.find(p => p.id === ana.id).reserva_enlace, null);
    // quien no tiene entrevista no puede recibir enlace
    assert.equal((await t.admin({ accion: 'enlace_reserva', id: beto.id, enlace: 'https://meet.google.com/aaa-bbbb-ccc' })).codigo, 409);
    // enlace inválido
    assert.equal((await t.admin({ accion: 'enlace_reserva', id: ana.id, enlace: 'javascript:alert(1)' })).codigo, 400);
    // guardar sin avisar: no sale correo; el postulante lo ve al abrir su página
    const antes = t.correos.length;
    r = await t.admin({ accion: 'enlace_reserva', id: ana.id, enlace: 'https://meet.google.com/aaa-bbbb-ccc' });
    assert.equal(r.codigo, 200); assert.equal(r.cuerpo.avisado, false); assert.equal(t.correos.length, antes);
    assert.equal((await t.pub('GET', { t: tokAna })).cuerpo.reserva.enlace_video, 'https://meet.google.com/aaa-bbbb-ccc');
    // guardar y avisar: sale el correo al postulante con el enlace
    r = await t.admin({ accion: 'enlace_reserva', id: ana.id, enlace: 'https://meet.google.com/ddd-eeee-fff', avisar: true });
    assert.equal(r.cuerpo.avisado, true); const c = t.correos.at(-1);
    assert.equal(c.para, 'ana@correo.cl'); assert.match(c.asunto, /Enlace de tu videollamada/); assert.ok(c.html.includes('https://meet.google.com/ddd-eeee-fff'));
    // avisar sin correo registrado: se rechaza (hay que pegarlo en Indeed)
    await t.pub('POST', { t: tokBeto, accion: 'reservar', inicio: esp[1].inicio, email: 'beto@correo.cl' });
    await t.sql`UPDATE reclutamiento_postulantes SET email = NULL WHERE id = ${beto.id};`;
    assert.equal((await t.admin({ accion: 'enlace_reserva', id: beto.id, enlace: 'https://meet.google.com/ggg-hhhh-iii', avisar: true })).codigo, 409);
    // si hay un enlace general, lo usan las entrevistas que no tienen el suyo
    const cfg = (await t.admin(null)).cuerpo.config; await t.admin({ accion: 'config', config: { ...cfg, enlace_video: 'https://meet.google.com/general' } });
    assert.equal((await t.pub('GET', { t: tokBeto })).cuerpo.reserva.enlace_video, 'https://meet.google.com/ggg-hhhh-iii', 'el propio de la entrevista manda sobre el general');
    await t.admin({ accion: 'enlace_reserva', id: beto.id, enlace: '' });
    assert.equal((await t.pub('GET', { t: tokBeto })).cuerpo.reserva.enlace_video, 'https://meet.google.com/general');
  } finally { await t.cerrar(); }
});

test('el administrador puede ofrecer un día dentro del plazo solo desde cierta hora y ampliar el horario', async () => {
  const t = await montar();
  try {
    await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Ana Pérez', email: 'ana@correo.cl' }] });
    const ana = (await t.admin(null)).cuerpo.postulantes[0], tok = new URL(ana.enlace).searchParams.get('t');
    const del24 = async () => (await t.admin(null)).cuerpo.espacios.filter(e => e.fecha === '2026-11-24');
    // martes 24: con 24 h de anticipación todo está «pronto»
    assert.ok((await del24()).every(e => e.estado === 'pronto'));
    // ampliar el horario hasta las 17:30: 10:30 … 16:30 (7 espacios)
    const cfg = (await t.admin(null)).cuerpo.config;
    assert.equal((await t.admin({ accion: 'config', config: { ...cfg, hasta: '17:30' } })).codigo, 200);
    assert.equal((await del24()).length, 7);
    // ofrecer el día solo desde las 12:30
    assert.equal((await t.admin({ accion: 'dia_desde', fecha: '2026-11-24', hora: '12:30' })).codigo, 200);
    const d = await del24();
    assert.deepEqual(d.filter(e => e.estado === 'bloqueado').map(e => e.hora), ['10:30', '11:30']);
    assert.deepEqual(d.filter(e => e.estado === 'libre').map(e => e.hora), ['12:30', '13:30', '14:30', '15:30', '16:30']);
    // el postulante los ve y puede reservar uno; el de las 10:30 sigue cerrado
    const pub = (await t.pub('GET', { t: tok })).cuerpo.espacios.filter(e => e.fecha === '2026-11-24');
    assert.equal(pub.length, 5);
    assert.equal((await t.pub('POST', { t: tok, accion: 'reservar', inicio: '2026-11-24T13:30:00.000Z' })).codigo, 409);
    assert.equal((await t.pub('POST', { t: tok, accion: 'reservar', inicio: pub[0].inicio })).codigo, 200);
    // volver a aplicar no toca el espacio ya reservado; quitar la excepción de uno lo cierra
    assert.equal((await t.admin({ accion: 'dia_desde', fecha: '2026-11-24', hora: '13:30' })).codigo, 200);
    assert.equal((await del24()).find(e => e.hora === '12:30').estado, 'ocupado');
    assert.equal((await t.admin({ accion: 'deshabilitar', inicio: pub[4].inicio })).codigo, 200);
    assert.equal((await del24()).find(e => e.hora === '16:30').estado, 'pronto');
    assert.equal((await t.admin({ accion: 'habilitar', inicio: pub[4].inicio })).codigo, 200);
    assert.equal((await del24()).find(e => e.hora === '16:30').estado, 'libre');
    // validaciones
    assert.equal((await t.admin({ accion: 'dia_desde', fecha: '2026-11-24', hora: '25:00' })).codigo, 400);
    assert.equal((await t.admin({ accion: 'dia_desde', fecha: '2026-11-29', hora: '12:30' })).codigo, 400, 'domingo no está en el calendario');
  } finally { await t.cerrar(); }
});

test('el enlace vence 3 días después de terminada la entrevista y no filtra detalles técnicos', async () => {
  const t = await montar();
  try {
    await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Ana Pérez', email: 'ana@correo.cl' }, { nombre: 'Beto Rojas', email: 'beto@correo.cl' }, { nombre: 'Carla Soto', email: 'carla@correo.cl' }] });
    const lista = (await t.admin(null)).cuerpo.postulantes, tok = n => new URL(lista.find(p => p.nombre.startsWith(n)).enlace).searchParams.get('t'), id = n => lista.find(p => p.nombre.startsWith(n)).id;
    const hora = 3600000, reservaEn = async (n, finMs) => { const fin = new Date(AHORA.getTime() + finMs), ini = new Date(fin.getTime() - hora); await t.sql`INSERT INTO reclutamiento_reservas (postulante_id, inicio, fin) VALUES (${id(n)}, ${ini.toISOString()}, ${fin.toISOString()});`; };
    await reservaEn('Ana', -4 * 24 * hora);   // terminó hace 4 días: vencido
    await reservaEn('Beto', -2 * 24 * hora);  // terminó hace 2 días: sigue vigente
    // Carla no tiene entrevista: sigue vigente
    let r = await t.pub('GET', { t: tok('Ana') }); assert.equal(r.codigo, 410); assert.match(r.cuerpo.error, /venció/);
    assert.equal((await t.pub('POST', { t: tok('Ana'), accion: 'cancelar' })).codigo, 410);
    assert.equal((await t.pub('GET', { t: tok('Beto') })).codigo, 200);
    assert.equal((await t.pub('GET', { t: tok('Carla') })).codigo, 200);
    // un error interno no devuelve detalles al público
    const roto = { ...t.deps, getSql: async () => { throw new Error('relation "secreta" does not exist'); } };
    const rr = respuesta(); await agendaPublica({ method: 'GET', query: { t: tok('Carla') } }, rr, roto);
    assert.equal(rr.codigo, 500); assert.ok(!JSON.stringify(rr.cuerpo).includes('secreta'));
  } finally { await t.cerrar(); }
});

test('entrevistas propuestas: se cargan por nombre, se validan y llegan al administrador', async () => {
  const t = await montar();
  try {
    await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Ana Pérez', email: 'ana@correo.cl' }, { nombre: 'Beto Rojas', email: 'beto@correo.cl' }] });
    const q = [{ cod: 'P1', texto: 'Cuéntame una reparación', espera: 'Un caso concreto', alerta: 'Respuesta vaga' }, { cod: 'N1', texto: 'Equipo que no enciende', espera: 'Método', alerta: 'Cambia piezas', ref: 'Lecciones 8 y 21' }];
    const ent = { encaje: 'Alto', perfil: [['Formación', 'Técnico']], fortalezas: ['Mucha práctica'], dudas: ['Plazo'], antes: [], preguntas: q, cierre: ['Renta'] };
    let r = await t.admin({ accion: 'entrevistas', items: [{ nombre: 'ana pérez', entrevista: ent }, { nombre: 'No Existe', entrevista: ent }, { nombre: 'Beto Rojas', entrevista: { preguntas: [] } }, { nombre: 'Beto Rojas' }] });
    assert.equal(r.codigo, 200); assert.equal(r.cuerpo.guardadas, 1); assert.equal(r.cuerpo.errores.length, 3);
    const lista = (await t.admin(null)).cuerpo.postulantes, ana = lista.find(p => p.nombre === 'Ana Pérez'), beto = lista.find(p => p.nombre === 'Beto Rojas');
    assert.equal(ana.entrevista.encaje, 'Alto'); assert.equal(ana.entrevista.preguntas.length, 2); assert.equal(ana.entrevista.preguntas[1].ref, 'Lecciones 8 y 21'); assert.equal(beto.entrevista, null);
    // por id, y null la quita
    r = await t.admin({ accion: 'entrevistas', items: [{ id: beto.id, entrevista: ent }, { id: ana.id, entrevista: null }] });
    assert.equal(r.cuerpo.guardadas, 2);
    const l2 = (await t.admin(null)).cuerpo.postulantes; assert.equal(l2.find(p => p.id === ana.id).entrevista, null); assert.equal(l2.find(p => p.id === beto.id).entrevista.fortalezas[0], 'Mucha práctica');
    // reimportar al postulante no borra su entrevista
    await t.admin({ accion: 'importar', postulantes: [{ nombre: 'Beto Rojas', email: 'beto@correo.cl' }] });
    assert.ok((await t.admin(null)).cuerpo.postulantes.find(p => p.id === beto.id).entrevista);
    // solo administradores; la agenda pública nunca la muestra
    assert.equal((await t.admin({ accion: 'entrevistas', items: [{ id: beto.id, entrevista: ent }] }, { rol: 'usuario' })).codigo, 403);
    const tok = new URL(beto.enlace).searchParams.get('t'); assert.ok(!JSON.stringify((await t.pub('GET', { t: tok })).cuerpo).includes('Mucha práctica'));
    assert.equal((await t.admin({ accion: 'entrevistas', items: [] })).codigo, 400);
  } finally { await t.cerrar(); }
});
