# Soporte > IndexPro — dashboard de backups de NAS de clientes

Página: `public/soporte-indexpro.html` (menú Soporte > IndexPro). Datos: `/api/negocio?recurso=nas-backup&cliente=<id>`.
Lógica pura (estados, calendario, series): `lib/nas-backup.js`. Tabla: `nas_backup_eventos` (`asegurarTablaNasBackup` en `lib/db.js`).

## Clientes y jobs

Se definen en `CLIENTES` de `lib/nas-backup.js`:

| Cliente | NAS | Jobs HBS 3 |
|---|---|---|
| Inmobiliaria Magua (= "Patagua" en los correos) | `NAS-PATAGUA` | `Backup-Diario-Disco-Externo` (diario, incremental, disco USB) y `RAIZ PATAGUA A DRIVE Q3Z1ON` (semanal, Google Drive vía QTS) |
| MvS Group | — | sin NAS conectado todavía |

`toleranciaDias` = días máximos sin un backup exitoso antes de marcar el job "Sin avisos".

## Fase 1 (hecha): datos desde los correos del NAS

El NAS manda por Notification Center un correo por cada evento de Hybrid Backup Sync (asunto "REPORTE BACKUP PATAGUA").
El historial se extrajo de Gmail a `lib/nas-backup-historial.js` y un admin lo carga con el botón **Cargar historial inicial**
(`?recurso=nas-backup-importar`, idempotente por `cliente + evento_id`).

Límite conocido: un correo ausente NO prueba que el job no corrió (el NAS puede no haber avisado). Por eso el estado se llama
"Sin avisos". El panel todavía no se actualiza solo: hay que volver a cargar el historial hasta que exista la fase 2 o un sistema
que lea el buzón.

## Fase 2 (pendiente): agente en el NAS que empuja el estado real

Objetivo: dejar de depender de los correos y saber el estado verdadero de cada job y del hardware.

Diseño propuesto:
- **Solo saliente**: el NAS hace `POST https://erp.indexstore.cl/api/negocio?recurso=nas-backup-agente` (HTTPS, sin abrir puertos).
- **Auth**: header `x-api-key` con `NAS_AGENTE_KEY` (variable de entorno en Vercel; una clave por cliente). Hay que agregar el recurso a la lista pública de `middleware.ts`.
- **Qué manda** (una vez al día y al terminar cada job):
  - último run de cada job HBS 3: inicio, fin, resultado, archivos, GB, error;
  - disco USB de destino: conectado/no, ID del volumen (la falla de abril 2025 fue "el ID del volumen externo no coincide"), espacio libre;
  - volúmenes del NAS: usado/libre; salud SMART de los discos; temperatura; firmware QTS; UPS si hay;
  - espacio libre en Google Drive si HBS lo expone.
- **Dónde guarda**: eventos → `nas_backup_eventos` con `fuente = 'agente'` (mismo formato, el dashboard ya los muestra); estado de hardware → tabla nueva `nas_backup_estado`.
- **Alertas**: correo semanal a IndexPro (formato `lib/correo-base.js`, registrado en `lib/notificaciones.js`) + aviso inmediato si un job falla o no reporta.

Pendiente de confirmar en el NAS real (no se puede saber desde aquí): modelo, versión de QTS y de HBS 3, si SSH está habilitado,
si hay Container Station (para correr el agente en un contenedor) o solo shell/cron, y de dónde se pueden leer los resultados
de HBS 3 (HBS 3 no tiene API pública documentada; los logs de job se pueden descargar desde HBS 3 como `job_log.csv`).
