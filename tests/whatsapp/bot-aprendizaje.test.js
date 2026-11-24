// Aprendizaje del bot (paso 2): anonimización, cambios del ejecutivo, elección del intercambio y casos candidatos contra Postgres real en memoria.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { reiniciarUnaVez } from '../../lib/una-vez.js';
import {
  anonimizarTexto, describirCambio, extraerIntercambio, asegurarTablaCandidatosBot, crearCandidatoCorreccion, crearCandidatoConversacion,
  listarCandidatos, resumenCandidatos, aprobarCandidato, rechazarCandidato, CATEGORIAS_KB,
} from '../../lib/whatsapp-bot-aprendizaje.js';
import { asegurarTablaEjemplosBot, listarEjemplos } from '../../lib/whatsapp-bot-ejemplos.js';

async function crearBase() {
  const db = new PGlite();
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...valores) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < valores.length ? `$${i + 1}` : ''), ''), valores));
  sql.query = async (texto, params = []) => salida(await db.query(texto, params));
  reiniciarUnaVez();
  await asegurarTablaCandidatosBot(sql);
  await asegurarTablaEjemplosBot(sql);
  return { db, sql };
}

test('anonimizarTexto oculta teléfonos, correos, RUT, nombres y enlaces ajenos, y deja intactos precios, modelos y enlaces de IndexStore', () => {
  const t = anonimizarTexto(
    'Hola, soy María González, mi correo es maria.g@gmail.com y mi cel +56 9 8765 4321 (o 987654321). RUT 12.345.678-5. ' +
    'Vi esto en https://www.mercadolibre.cl/MLC-123 y en https://www.indexstore.cl/products/pantalla-hp-240-g6. Cuesta $74.900, es un HP 240 G6 de 65W y 20V 3.25A. Pedido 123456789012.',
    { nombres: ['María González'] }
  );
  assert.ok(!/maria\.g@gmail|8765 4321|987654321|12\.345\.678|mercadolibre|123456789012/.test(t), t);
  assert.ok(!/María|González/.test(t), t);
  for (const marca of ['[correo]', '[teléfono]', '[RUT]', '[enlace]', '[cliente]', '[número]']) assert.ok(t.includes(marca), `falta ${marca} en: ${t}`);
  for (const intacto of ['https://www.indexstore.cl/products/pantalla-hp-240-g6', '$74.900', 'HP 240 G6', '65W', '20V 3.25A']) assert.ok(t.includes(intacto), `se dañó "${intacto}" en: ${t}`);
});

test('anonimizarTexto no confunde nombres con partes de otras palabras ni falla con valores vacíos', () => {
  assert.equal(anonimizarTexto('Hola Ana, Anabel y Ananás', { nombres: ['Ana'] }), 'Hola [cliente], Anabel y Ananás');
  assert.equal(anonimizarTexto(null), '');
  assert.equal(anonimizarTexto('sin datos', { nombres: [null, '', 'Al'] }), 'sin datos');
});

test('describirCambio cuenta lo que el ejecutivo cambió del borrador del bot', () => {
  const bot = '¡Hola! Tenemos varias opciones disponibles para tu notebook y también podemos ayudarte con la instalación en tienda si lo necesitas, además de enviarlo a todo Chile cuando quieras.';
  assert.match(describirCambio(bot, '¡Hola! Pantalla HP $74.900 https://www.indexstore.cl/products/x\n\n¿La instalamos?'), /acortó el mensaje.*agregó enlace.*agregó precio.*agregó una pregunta/);
  assert.match(describirCambio('Hola', 'Hola'), /reescribió partes/);
  assert.match(describirCambio('a'.repeat(100), 'a'.repeat(200)), /alargó el mensaje \(de 100 a 200 caracteres\)/);
});

test('extraerIntercambio toma lo que escribió el cliente y la primera respuesta útil del ejecutivo', () => {
  const ok = extraerIntercambio([
    { direccion: 'out', contenido_texto: 'Hola, te escribimos de IndexStore para avisarte algo importante de tu pedido anterior.' },
    { direccion: 'in', contenido_texto: 'Hola, necesito una pantalla' },
    { direccion: 'in', contenido_texto: 'para un HP 240 G6' },
    { direccion: 'out', contenido_texto: 'Hola' },
    { direccion: 'out', contenido_texto: 'Hola! Veo que necesitas una pantalla para tu HP 240 G6. La tenemos disponible, con 2 años de garantía. ¿La instalamos?' },
    { direccion: 'in', contenido_texto: 'Sí, ¿cuánto sale?' },
  ]);
  assert.equal(ok.cliente, 'Hola, necesito una pantalla\npara un HP 240 G6');
  assert.match(ok.respuesta, /^Hola! Veo que necesitas una pantalla/);
  assert.ok(!ok.respuesta.includes('¿cuánto sale?'));

  assert.equal(extraerIntercambio([{ direccion: 'in', contenido_texto: 'hola' }, { direccion: 'out', contenido_texto: 'Hola, ¿en qué te ayudo con tu notebook hoy día?' }]), null, 'cliente demasiado corto');
  assert.equal(extraerIntercambio([{ direccion: 'in', contenido_texto: 'Necesito un cargador para mi notebook Lenovo' }, { direccion: 'out', contenido_texto: 'ok' }]), null, 'respuesta demasiado corta');
  assert.equal(extraerIntercambio([{ direccion: 'in', contenido_texto: '', tipo: 'imagen' }, { direccion: 'out', contenido_texto: 'x'.repeat(100) }]), null, 'solo imagen');
  assert.equal(extraerIntercambio(null), null);
});

test('candidatos: una corrección por borrador, conversación analizada una sola vez, aprobar crea la pregunta modelo', async () => {
  const { db, sql } = await crearBase();
  try {
    const id1 = await crearCandidatoCorreccion(sql, {
      conversacionId: 7, borradorId: 11, mensajeCliente: 'Hola, soy Juan, necesito una pantalla HP 240 G6, mi cel 987654321',
      textoBot: 'Tenemos pantallas.', textoFinal: 'Hola Juan, la pantalla para tu HP 240 G6 está disponible.\n¿La instalamos?', nombres: ['Juan'],
    });
    assert.ok(id1);
    assert.equal(await crearCandidatoCorreccion(sql, { conversacionId: 7, borradorId: 11, mensajeCliente: 'x'.repeat(20), textoBot: 'a', textoFinal: 'b' }), null, 'mismo borrador: no se repite');

    const idIa = await crearCandidatoConversacion(sql, {
      conversacionId: 9, mensajeCliente: 'Necesito un cargador para mi notebook', respuestaOriginal: 'Tenemos cargadores, escríbenos.', preguntaPropuesta: 'Necesito un cargador para mi notebook',
      respuestaPropuesta: 'Para validar el cargador correcto, ¿me envías el modelo exacto o una foto de la etiqueta?', problema: 'No pidió el modelo.', regla: 'Pedir modelo o etiqueta antes de ofrecer.',
      categoria: 'cargadores', riesgo: 'alto', alertas: ['Precio no verificado'], modeloIa: 'gemini-test',
    });
    assert.ok(idIa);
    assert.equal(await crearCandidatoConversacion(sql, { conversacionId: 9, mensajeCliente: 'otra vez' }), null, 'misma conversación: no se analiza dos veces');
    const idNoUtil = await crearCandidatoConversacion(sql, { conversacionId: 10, mensajeCliente: 'spam spam spam spam', util: false });
    assert.ok(idNoUtil);

    // anonimizado y ordenado por riesgo
    const pend = await listarCandidatos(sql);
    assert.deepEqual(pend.map(c => c.id), [idIa, id1], 'el de riesgo alto va primero y el descartado por la IA no aparece');
    assert.ok(!/Juan|987654321/.test(pend[1].mensajeCliente + pend[1].respuestaPropuesta), 'se anonimizó');
    assert.match(pend[1].problema, /El ejecutivo/);
    assert.deepEqual(pend[0].alertas, ['Precio no verificado']);
    assert.equal((await listarCandidatos(sql, { tipo: 'correccion' })).length, 1);
    assert.equal((await listarCandidatos(sql, { estado: 'rechazado' })).length, 1);

    let r = await resumenCandidatos(sql);
    assert.deepEqual({ ...r }, { pendientes: 2, pendientes_correccion: 1, pendientes_conversacion: 1, aprobados: 0, rechazados: 1 });

    // aprobar con el texto editado por la persona
    const a = await aprobarCandidato(sql, idIa, { pregunta: pend[0].preguntaPropuesta, respuesta: 'Para validar el cargador correcto, ¿me envías el modelo exacto de tu notebook?' }, 'Ana');
    assert.equal(a.ok, true);
    assert.equal(a.ejemplo.origen, 'conversacion');
    assert.equal(a.ejemplo.etiquetas, 'cargadores');
    assert.equal(a.ejemplo.creadoPor, 'Ana');
    assert.equal((await aprobarCandidato(sql, idIa, { pregunta: 'x', respuesta: 'y' }, 'Ana')).estado, 409, 'no se aprueba dos veces');
    assert.equal((await aprobarCandidato(sql, id1, { pregunta: '', respuesta: 'y' }, 'Ana')).estado, 400, 'valida como cualquier pregunta modelo');
    assert.equal((await aprobarCandidato(sql, 999, { pregunta: 'x', respuesta: 'y' }, 'Ana')).estado, 404);

    const b = await aprobarCandidato(sql, id1, { pregunta: pend[1].preguntaPropuesta, respuesta: pend[1].respuestaPropuesta }, 'Luis');
    assert.equal(b.ejemplo.origen, 'correccion');
    assert.equal((await listarEjemplos(sql)).length, 2);

    assert.equal((await rechazarCandidato(sql, id1, 'Luis')).estado, 404, 'ya aprobado');
    r = await resumenCandidatos(sql);
    assert.deepEqual({ ...r }, { pendientes: 0, pendientes_correccion: 0, pendientes_conversacion: 0, aprobados: 2, rechazados: 1 });
    assert.ok((await listarCandidatos(sql, { estado: 'aprobado' })).every(c => c.ejemploId && c.resueltoPor));
  } finally { await db.close(); }
});

test('rechazar un candidato lo saca de la lista de pendientes y guarda la nota', async () => {
  const { db, sql } = await crearBase();
  try {
    const id = await crearCandidatoConversacion(sql, { conversacionId: 1, mensajeCliente: 'Necesito algo que no es de IndexStore' });
    assert.equal((await rechazarCandidato(sql, id, 'Ana', 'No corresponde')).ok, true);
    const [c] = await listarCandidatos(sql, { estado: 'rechazado' });
    assert.equal(c.nota, 'No corresponde');
    assert.equal(c.resueltoPor, 'Ana');
    assert.equal((await listarCandidatos(sql)).length, 0);
    assert.equal((await rechazarCandidato(sql, 'abc', 'Ana')).estado, 400);
  } finally { await db.close(); }
});

test('las categorías de entrenamiento coinciden con los módulos de la base de conocimiento', () => {
  for (const c of ['cargadores', 'baterías', 'pantallas', 'garantías', 'despachos y retiros', 'productos a pedido', 'objeciones', 'otro']) assert.ok(CATEGORIAS_KB.includes(c), c);
});
