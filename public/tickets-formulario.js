/* Conecta un formulario HTML al módulo de Tickets del ERP (reemplaza a Zoho Forms).
 * Uso: <script src="https://URL-DEL-ERP/tickets-formulario.js" defer></script>
 *      <form data-erp-ticket="pantallas"> ... campos con name="nombre", "telefono", "email", "producto", "mensaje" ... </form>
 * Valores de data-erp-ticket: pantallas | cargadores | nas | postventa.
 * Campos reconocidos (name): nombre, telefono, email, producto (o modelo), marca, cantidad, empresa, mensaje, rut;
 *   y para postventa: pedido (obligatorio), motivo, tipo_producto.
 * Opcional dentro del formulario: un elemento con data-erp-exito (se muestra al enviar bien) y otro con data-erp-error (recibe el mensaje de error).
 * Anti-spam: agrega solo un campo trampa invisible y mide cuánto tardó la persona en enviar. No necesita nada más.
 * Al enviar bien dispara el evento "erp-ticket-enviado" en el formulario y empuja { event: 'erp_ticket_enviado', formulario } a dataLayer (para GTM / Google Ads).
 */
(function () {
  var script = document.currentScript;
  var base = '';
  try { base = new URL(script.src).origin; } catch (e) { base = ''; }
  var API = base + '/api/negocio?recurso=tickets-publico';

  function params() {
    var out = {}, q = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid'].forEach(function (k) { if (q.get(k)) out[k] = q.get(k); });
    return out;
  }

  function activar(form) {
    if (form.__erpActivo) return;
    form.__erpActivo = true;
    var tipo = form.getAttribute('data-erp-ticket');
    var t0 = Date.now();

    var trampa = document.createElement('input');
    trampa.type = 'text'; trampa.name = 'web'; trampa.tabIndex = -1; trampa.autocomplete = 'off';
    trampa.setAttribute('aria-hidden', 'true');
    trampa.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
    form.appendChild(trampa);

    function mostrarError(msg) {
      var caja = form.querySelector('[data-erp-error]');
      if (!caja) { caja = document.createElement('div'); caja.setAttribute('data-erp-error', ''); caja.style.cssText = 'color:#b91c1c;margin-top:8px;font-size:14px;'; form.appendChild(caja); }
      caja.textContent = msg; caja.style.display = '';
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var boton = form.querySelector('[type=submit]');
      var cuerpo = { formulario: tipo, t: Date.now() - t0, pagina: location.href, referrer: document.referrer || '' };
      var p = params(); for (var k in p) cuerpo[k] = p[k];
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === 'submit' || el.type === 'button') return;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
        cuerpo[el.name] = el.value;
      });
      var err = form.querySelector('[data-erp-error]'); if (err) err.style.display = 'none';
      if (boton) boton.disabled = true;
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          if (!r.ok || r.j.error) { mostrarError(r.j.error || 'No pudimos enviar tu solicitud. Intenta de nuevo.'); if (boton) boton.disabled = false; return; }
          var exito = form.querySelector('[data-erp-exito]');
          if (exito) { exito.style.display = ''; Array.prototype.forEach.call(form.children, function (c) { if (c !== exito) c.style.display = 'none'; }); }
          else { form.innerHTML = '<p style="font-size:16px">¡Gracias! Recibimos tu solicitud' + (r.j.numero ? ' (N° ' + String(r.j.numero).replace(/\D/g, '') + ')' : '') + '. Te contactaremos pronto.</p>'; }
          try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'erp_ticket_enviado', formulario: tipo }); } catch (e) { /* sin GTM */ }
          try { form.dispatchEvent(new CustomEvent('erp-ticket-enviado', { bubbles: true, detail: { numero: r.j.numero, formulario: tipo } })); } catch (e) { /* navegador antiguo */ }
        })
        .catch(function () { mostrarError('No pudimos enviar tu solicitud. Revisa tu conexión e intenta de nuevo.'); if (boton) boton.disabled = false; });
    });
  }

  function iniciar() { Array.prototype.forEach.call(document.querySelectorAll('form[data-erp-ticket]'), activar); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.erpTicketsActivar = iniciar; // por si el formulario se agrega después (popups, carruseles)
})();
