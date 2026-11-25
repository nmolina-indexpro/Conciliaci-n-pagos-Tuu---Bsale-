// Perfiles de acceso: quien ya tenía el chat de WhatsApp sigue viendo el Bot y Configuración WhatsApp hasta que un admin guarde su perfil.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginasEfectivas, paginasParaGuardar, MARCA_CONFIG_WHATSAPP, MARCA_BOT_WHATSAPP, PAGINA_CONFIG_WHATSAPP, PAGINA_BOT_WHATSAPP } from '../../lib/paginas-perfil.js';

test('un perfil con el chat de WhatsApp recibe Bot y Configuración WhatsApp, sin las marcas internas', () => {
  const r = paginasEfectivas(['home.html', 'clientes-whatsapp.html']);
  assert.deepEqual(r.sort(), ['clientes-whatsapp.html', PAGINA_CONFIG_WHATSAPP, PAGINA_BOT_WHATSAPP, 'home.html'].sort());
  assert.ok(!r.includes(MARCA_CONFIG_WHATSAPP) && !r.includes(MARCA_BOT_WHATSAPP));
});

test('un perfil sin el chat no recibe nada, y sin restricción (null) sigue sin restricción', () => {
  assert.deepEqual(paginasEfectivas(['home.html']), ['home.html']);
  assert.equal(paginasEfectivas(null), null);
});

test('una vez que un admin guarda el perfil, manda lo que dejó marcado (Configuración WhatsApp puede quedar fuera)', () => {
  const guardado = paginasParaGuardar(['home.html', 'clientes-whatsapp.html']);
  assert.ok(guardado.includes(MARCA_CONFIG_WHATSAPP));
  const r = paginasEfectivas(guardado);
  assert.deepEqual(r.sort(), ['clientes-whatsapp.html', 'home.html']);
  // y si el admin la marca, se conserva
  const conConfig = paginasEfectivas(paginasParaGuardar(['clientes-whatsapp.html', PAGINA_CONFIG_WHATSAPP]));
  assert.ok(conConfig.includes(PAGINA_CONFIG_WHATSAPP));
});
