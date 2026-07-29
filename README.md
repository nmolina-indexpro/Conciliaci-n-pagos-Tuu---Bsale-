# Cuadratura POS — IndexStore

Concilia automáticamente las ventas del POS (TUU / Haulmer) contra los documentos
emitidos en Bsale, separadas por tarjeta débito y crédito, para un día específico.

## Cómo funciona

- `api/tuu-report.js` — consulta el endpoint de reportes de TUU y devuelve las
  ventas del día (débito/crédito) con sus montos.
- `api/bsale-report.js` — consulta Bsale: primero identifica los IDs de los
  medios de pago "Tarjeta Crédito" y "Tarjeta Débito", luego trae los pagos de esos
  medios en el rango de fecha, y por cada uno busca el documento asociado
  (número, cliente).
- `public/index.html` — la app. Botón "Traer y cuadrar" llama a ambos endpoints
  y hace el match por monto entre POS y Bsale, marcando en rojo cualquier venta
  sin documento o documento sin venta. También queda la opción de pegar los datos
  a mano como respaldo.

Los tokens de Bsale y TUU **nunca** viajan al navegador: viven como variables de
entorno del servidor y las funciones en `/api` son las únicas que los usan.

## Despliegue (mismo patrón que tu proyecto Compra Ágil)

1. Sube esta carpeta a un repo de GitHub.
2. En Vercel: **New Project** → importa el repo.
3. En **Settings → Environment Variables**, agrega:
   - `BSALE_ACCESS_TOKEN`
   - `TUU_API_KEY`
4. Deploy. Listo — `tu-proyecto.vercel.app` sirve `public/index.html` y las
   funciones quedan disponibles en `/api/tuu-report` y `/api/bsale-report`.

## Para probar en local

```bash
npm i -g vercel
cp .env.example .env.local   # y completa los tokens
vercel dev
```

## Notas / cosas a revisar cuando pruebes con datos reales

- **Nombres de medios de pago en Bsale**: el código busca por texto
  "tarjeta.*crédito" y "tarjeta.*débito" (insensible a mayúsculas/acentos).
  Si en tu cuenta Bsale el medio de pago tiene otro nombre, ajusta el regex en
  `getCardPaymentTypeIds()` dentro de `api/bsale-report.js`.
- **Zona horaria**: el filtro de fecha en Bsale usa UTC-4 fijo (no ajusta
  horario de verano). Si notas transacciones del borde del día (23:00–01:00)
  cayendo en el día equivocado, ese es el lugar para ajustar.
- **Paginación TUU**: máximo 20 registros por página; el código ya pagina
  automáticamente si un día tiene más de 20 ventas.
- **Estado de transacciones TUU**: solo se incluyen las `completed`
  (se excluyen reversas/fallidas). Si quieres verlas igual para auditoría,
  quita el `.filter()` en `tuu-report.js`.
- Ninguna de estas llamadas se pudo probar en vivo desde este entorno (mi
  sandbox no tiene salida de red hacia `api.bsale.io` ni
  `integrations.payment.haulmer.com`), así que están armadas estrictamente
  según la documentación oficial. Es posible que al primer uso real haya que
  ajustar algún nombre de campo — avísame qué error tira y lo corrijo.
