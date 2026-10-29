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

Además se cargaron a mano las corridas del **historial de trabajos de HBS 3** (capturas del panel, 29-oct-2026): diario #1446-#1476 (29-sep a 29-oct)
y semanal #151-#156 (18-sep a 23-oct), con archivos procesados y GB transferidos (fuente `hbs-panel`). Horarios confirmados en HBS 3: diario 01:30 y
semanal viernes 01:00. Un evento del panel y el correo de la misma corrida se fusionan en uno solo (`consolidarEventos`).

Hallazgo: los correos del NAS dejaron de llegar (semanal desde el 14-ago, diario desde el 22-oct) aunque los jobs corrieron todos los días/viernes.
Conviene revisar la regla de Notification Center y probar el envío de correo del NAS.

Límite conocido: un correo ausente NO prueba que el job no corrió (el NAS puede no haber avisado). Por eso el estado se llama
"Sin avisos". El panel todavía no se actualiza solo: hay que volver a cargar el historial hasta que exista la fase 2 o un sistema
que lea el buzón.

## Fase 1b: lectura automática del buzón de avisos

El ERP lee por IMAP el buzón `backups@indexstore.cl` (variable `NAS_BACKUP_BUZON` para cambiarlo; contraseña en `IMAP_PASS_BACKUPS` en Vercel).
- Cron diario `?recurso=nas-backup-correos-sync` (12:30 UTC, `CRON_SECRET`, mira los últimos 3 días) y botón **Sincronizar correo** (admin, últimos 10 días).
- Cada correo se interpreta con `parsearCorreoHbs` (`lib/nas-backup.js`); el id del evento es `msg:<Message-ID>`, así que no se duplica. Se reconoce el cliente por el `NAS Name`.
- El servidor de correo entrega ~8 s por cuerpo: se lee hasta agotar 38 s y lo pendiente queda para la próxima pasada.
- Límite: solo refleja lo que el NAS avise por correo. El estado real y la salud del hardware siguen requiriendo la fase 2.

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
