# Tickets: formularios y carritos abandonados (reemplazo de Zoho Forms)

Todo ticket entra por `crearTicket` (`lib/tickets.js`). Los canales automáticos están en `lib/tickets-entrada.js`.

## 1. Formularios del sitio y las landings

El endpoint público es `POST /api/negocio?recurso=tickets-publico` (JSON o `application/x-www-form-urlencoded`).
Solo acepta envíos desde `indexstore.cl`, `indexpro.cl` (con y sin `www`) y vistas previas `*.myshopify.com`.
Para otro dominio (por ejemplo una landing en Netlify), agregarlo en Vercel en `TICKETS_ORIGENES_EXTRA` (separados por coma, con `https://`).

La forma más simple es el script que ya trae el campo trampa, el tiempo mínimo y el manejo de errores:

```html
<script src="https://URL-DEL-ERP/tickets-formulario.js" defer></script>

<form data-erp-ticket="pantallas">
  <input name="nombre" placeholder="Nombre" required>
  <input name="telefono" placeholder="Teléfono" inputmode="tel" required>
  <input name="email" type="email" placeholder="Correo (opcional)">
  <input name="producto" placeholder="Modelo del notebook">
  <textarea name="mensaje" placeholder="Cuéntanos qué necesitas"></textarea>
  <button type="submit">Cotizar</button>
</form>
```

| `data-erp-ticket` | Crea | Origen |
|---|---|---|
| `pantallas` | lead | landing_pantallas |
| `cargadores` | lead | landing_cargadores |
| `nas` | lead | nas |
| `postventa` | postventa (valida el pedido en Shopify) | sitio_postventa |

Campos reconocidos: `nombre`, `telefono`, `email`, `producto` (o `modelo`), `marca`, `cantidad`, `empresa`, `mensaje`, `rut`.
Postventa además: `pedido` (obligatorio), `motivo` (`problema_pedido_producto`, `cancelacion`, `seguimiento`, `cambio_direccion`, `otra`) y `tipo_producto` (`cargador`, `bateria`, `pantalla`, `vitrina`, `servicio`, `otro`).
Siempre hace falta un teléfono o un correo.

El script captura solo `utm_*` y `gclid` de la URL y la página de origen: quedan en el lead (campo "Campaña" del ticket).
Al enviar bien empuja `{ event: 'erp_ticket_enviado', formulario }` a `dataLayer`, para medir la conversión en GTM / Google Ads.

Anti-spam: campo trampa `web`, envío en menos de 2 s descartado, más de 2 enlaces en el mensaje descartado, y tope por IP
(unos 15 envíos cada 10 minutos). Un envío descartado responde igual "ok" para no darle pistas al robot.
Un doble envío del mismo cliente en 15 minutos (24 h en postventa) se anota en el ticket abierto en vez de crear otro.

Postventa: el número de pedido se busca en Shopify. Si existe, se enlaza al ticket; si el teléfono o el correo no coinciden con los
del pedido, o el pedido no existe, queda una nota interna para el equipo. Nada del pedido se devuelve al público.

## 2. Carritos abandonados de Shopify

Shopify no avisa "carrito abandonado" por webhook (`checkouts/update` se dispara en cada cambio), así que se consulta la lista
`abandonedCheckouts` con una tarea programada (`vercel.json`, 3 veces al día) y el botón **🛒 Revisar carritos** de la página Tickets (administradores).

- Un carrito cuenta como abandonado si lleva más de 60 minutos sin cambios, no se completó y tiene teléfono o correo.
- Crea un lead (origen `carrito_abandonado`) con los productos y el enlace para retomar la compra. No duplica (por id de checkout).
- Usa la API `2025-07` (cambiable con `SHOPIFY_API_VERSION_CARRITOS`).
- **Requiere** que la app de Shopify tenga permiso para leer carritos abandonados y datos de clientes (acceso a datos protegidos de clientes).
  Si falta, la tarea responde el error de Shopify y el botón lo muestra.

## Variables de entorno

- `TICKETS_ORIGENES_EXTRA` (opcional): otros sitios autorizados a enviar formularios.
- `SHOPIFY_API_VERSION_CARRITOS` (opcional).
- Ya existentes: `CRON_SECRET`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `POSTGRES_URL`.
