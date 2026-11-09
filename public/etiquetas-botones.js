// /public/etiquetas-botones.js
// Red de seguridad de accesibilidad: todo botón que sea solo un ícono (✕, ◀, 🗑️, 💾...) y no tenga título ni aria-label recibe uno,
// para que al pasar el mouse salga el texto (tooltip) y los lectores de pantalla sepan qué hace. Funciona también con los botones que
// las páginas dibujan después con JavaScript. Los botones con texto visible no se tocan. Si un botón ya trae title o aria-label, se respeta.

(function () {
  // Ícono (texto del botón sin espacios) -> etiqueta
  const ICONOS = {
    '✕': 'Cerrar', '✖': 'Cerrar', '✖️': 'Cerrar', '×': 'Cerrar',
    '◀': 'Anterior', '←': 'Anterior', '‹': 'Anterior', '«': 'Anterior', '▲': 'Subir', '▼': 'Bajar', '▶': 'Siguiente', '→': 'Siguiente', '›': 'Siguiente', '»': 'Siguiente',
    '🗑': 'Eliminar', '🗑️': 'Eliminar', '✏': 'Editar', '✏️': 'Editar', '💾': 'Guardar', '✔': 'Confirmar', '✓': 'Confirmar', '✅': 'Confirmar',
    '↻': 'Actualizar', '🔄': 'Actualizar', '⟳': 'Actualizar', '➕': 'Agregar', '+': 'Agregar', '−': 'Quitar', '-': 'Quitar', '➖': 'Quitar',
    '⬇': 'Descargar', '⬇️': 'Descargar', '📥': 'Descargar', '📤': 'Subir archivo', '📋': 'Copiar', '📎': 'Adjuntar',
    '📞': 'Llamar', '☎': 'Llamar', '☎️': 'Llamar', '💬': 'Mensaje', '✉': 'Correo', '✉️': 'Correo', '📧': 'Correo', '🔍': 'Buscar', '🔎': 'Buscar',
    '⚙': 'Configuración', '⚙️': 'Configuración', '⋮': 'Más opciones', '…': 'Más opciones', '⋯': 'Más opciones', '☰': 'Menú', '📌': 'Fijar', '📍': 'Ubicación',
    '👁': 'Ver', '👁️': 'Ver', '★': 'Favorito', '☆': 'Favorito', '⭐': 'Favorito', '🔗': 'Enlace', '↗': 'Abrir en otra pestaña', '🖨': 'Imprimir', '🖨️': 'Imprimir',
    '📅': 'Calendario', '🔔': 'Notificaciones', '❓': 'Ayuda', '?': 'Ayuda', 'ℹ': 'Información', 'ℹ️': 'Información',
  };
  const TIENE_TEXTO = /[A-Za-zÁÉÍÓÚÜáéíóúüñÑ0-9]/;

  // Último recurso: la acción que dispara el botón, "cerrarModalEnvio()" -> "Cerrar modal envio"
  function desdeOnclick(el) {
    const m = /^\s*([A-Za-z_$][\w$.]*)\s*\(/.exec(el.getAttribute('onclick') || '');
    if (!m) return '';
    const nombre = m[1].split('.').pop().replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$]+/g, ' ').trim().toLowerCase();
    return nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : '';
  }

  function etiquetar(boton) {
    if (boton.hasAttribute('title') || boton.hasAttribute('aria-label') || boton.hasAttribute('aria-labelledby')) return;
    const texto = (boton.textContent || '').replace(/\s+/g, '');
    if (!texto && boton.querySelector('img[alt]:not([alt=""]), svg title')) return; // ya tiene nombre por su imagen
    if (texto && TIENE_TEXTO.test(texto)) return; // tiene texto visible
    const etiqueta = ICONOS[texto] || desdeOnclick(boton);
    if (!etiqueta) return;
    boton.setAttribute('title', etiqueta);
    boton.setAttribute('aria-label', etiqueta);
  }

  function recorrer(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    if (raiz.tagName === 'BUTTON') etiquetar(raiz);
    if (raiz.querySelectorAll) raiz.querySelectorAll('button').forEach(etiquetar);
  }

  function iniciar() {
    recorrer(document.body);
    let pendientes = [], programado = false;
    new MutationObserver(function (cambios) {
      for (const c of cambios) for (const n of c.addedNodes) if (n.nodeType === 1) pendientes.push(n);
      if (programado || !pendientes.length) return;
      programado = true;
      requestAnimationFrame(function () { const lote = pendientes; pendientes = []; programado = false; lote.forEach(recorrer); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
