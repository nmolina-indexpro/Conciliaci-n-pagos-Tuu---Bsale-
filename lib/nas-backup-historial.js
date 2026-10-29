// /lib/nas-backup-historial.js
// Historial inicial de eventos de Hybrid Backup Sync del NAS-PATAGUA (Inmobiliaria Magua), extraído de los correos de Notification Center
// (asunto "REPORTE BACKUP PATAGUA") el 2026-10-29. Lo carga un admin con el botón "Cargar historial inicial" de Soporte > IndexPro
// (api/negocio.js ?recurso=nas-backup-importar). Es un dato puntual, no se actualiza solo: desde la Fase 2 lo reemplaza el agente del NAS.
// Las fechas son la hora LOCAL del NAS (America/Santiago). Cada término/falla puede venir en dos correos casi simultáneos
// (Job Status + Custom Job Event); lib/nas-backup.js los fusiona al mostrar.
export default {
  "generado": "2026-10-29",
  "fuente": "Gmail: correos de Notification Center de NAS-PATAGUA (asunto 'REPORTE BACKUP PATAGUA')",
  "cliente": "magua",
  "nas": "NAS-PATAGUA",
  "eventos": [
    {
      "id": "183ccfb4bbd323a8",
      "fecha": "2022-10-12 13:09:16",
      "job": "Backup 1",
      "tipo": "otro",
      "severidad": "Info",
      "categoria": "Job Management",
      "mensaje": "Created Backup job: \"Backup 1\".",
      "stats": null
    },
    {
      "id": "183cf4f20e5dfd50",
      "fecha": "2022-10-13 00:00:05",
      "job": "RESPALDO DE SEGURIDAD",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RESPALDO DE SEGURIDAD\".",
      "stats": null
    },
    {
      "id": "183cf4f3a75b8545",
      "fecha": "2022-10-13 00:00:14",
      "job": "RESPALDO DE SEGURIDAD",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Job Status",
      "mensaje": "Failed to complete Backup job: \"RESPALDO DE SEGURIDAD\". Failed to locate the destination folder. Ensure that the destination folder exists or select another destination.",
      "stats": null
    },
    {
      "id": "183cf4f438761a2d",
      "fecha": "2022-10-13 00:00:15",
      "job": "RESPALDO DE SEGURIDAD",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Custom Job Event",
      "mensaje": "Failed to complete Backup job: \"RESPALDO DE SEGURIDAD\". Failed to locate the destination folder. Ensure that the destination folder exists or select another destination.. Check logs for more information.",
      "stats": null
    },
    {
      "id": "18af22c7b7982bb6",
      "fecha": "2023-10-02 17:44:44",
      "job": "Restore 1",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Restore job: \"Restore 1\".",
      "stats": null
    },
    {
      "id": "18af22c7ca059202",
      "fecha": "2023-10-02 17:44:46",
      "job": "Restore 1",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Job Status",
      "mensaje": "Failed to complete Restore job: \"Restore 1\". Failed to locate the destination folder. Ensure that the destination folder exists or select another destination.",
      "stats": null
    },
    {
      "id": "18af249fcb9c8a46",
      "fecha": "2023-10-02 18:16:59",
      "job": null,
      "tipo": "storage",
      "severidad": "Info",
      "categoria": "Storage Space",
      "mensaje": "Created storage: DESARROLLO 02-10.",
      "stats": null
    },
    {
      "id": "18af25774f83a9cb",
      "fecha": "2023-10-02 18:31:42",
      "job": null,
      "tipo": "storage",
      "severidad": "Info",
      "categoria": "Storage Space",
      "mensaje": "Deleted storage: DESARROLLO 02-10.",
      "stats": null
    },
    {
      "id": "18b6cc64736a7b6a",
      "fecha": "2023-10-26 13:06:07",
      "job": null,
      "tipo": "storage",
      "severidad": "Info",
      "categoria": "Storage Space",
      "mensaje": "Created storage: Google Drive q3z1on-patagua.",
      "stats": null
    },
    {
      "id": "18b6ccb69feab86e",
      "fecha": "2023-10-26 13:11:45",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "otro",
      "severidad": "Info",
      "categoria": "Job Management",
      "mensaje": "Created Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18b9360ab7555a06",
      "fecha": "2023-11-03 01:00:16",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18b936cf2232de41",
      "fecha": "2023-11-03 01:13:42",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18b936cf659f8be6",
      "fecha": "2023-11-03 01:13:43",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 290464, Unchanged Files: 285280, Skipped Files: 0, Backed-up Files: 720, Total File Size: 300.20 GB, Average Transmission Speed: 667.43 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 290464,
        "sin_cambios": 285280,
        "omitidos": 0,
        "respaldados": 720,
        "tamano_gb": 300.2,
        "velocidad": "667.43 KB"
      }
    },
    {
      "id": "18bb76d4dbaed701",
      "fecha": "2023-11-10 01:00:19",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18bb77a0fd65b335",
      "fecha": "2023-11-10 01:14:16",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18bb77a15095b3a7",
      "fecha": "2023-11-10 01:14:18",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 291214, Unchanged Files: 285194, Skipped Files: 0, Backed-up Files: 1556, Total File Size: 300.82 GB, Average Transmission Speed: 999.78 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 291214,
        "sin_cambios": 285194,
        "omitidos": 0,
        "respaldados": 1556,
        "tamano_gb": 300.82,
        "velocidad": "999.78 KB"
      }
    },
    {
      "id": "18c23930cb920343",
      "fecha": "2023-12-01 01:00:17",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18c239fef98460b1",
      "fecha": "2023-12-01 01:14:23",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18c239ff5fd06773",
      "fecha": "2023-12-01 01:14:25",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 292871, Unchanged Files: 287201, Skipped Files: 0, Backed-up Files: 1206, Total File Size: 302.85 GB, Average Transmission Speed: 699.40 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 292871,
        "sin_cambios": 287201,
        "omitidos": 0,
        "respaldados": 1206,
        "tamano_gb": 302.85,
        "velocidad": "699.40 KB"
      }
    },
    {
      "id": "18d43f7b0a2cfc5f",
      "fecha": "2024-01-26 01:00:16",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18d440836d8a601f",
      "fecha": "2024-01-26 01:18:20",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18d44083b127d553",
      "fecha": "2024-01-26 01:18:21",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 300810, Unchanged Files: 291759, Skipped Files: 0, Backed-up Files: 4584, Total File Size: 312.99 GB, Average Transmission Speed: 2.08 MB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 300810,
        "sin_cambios": 291759,
        "omitidos": 0,
        "respaldados": 4584,
        "tamano_gb": 312.99,
        "velocidad": "2.08 MB"
      }
    },
    {
      "id": "18d6804511b614dc",
      "fecha": "2024-02-02 01:00:17",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18d681394444d498",
      "fecha": "2024-02-02 01:17:00",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18d68139ddbf30e8",
      "fecha": "2024-02-02 01:17:02",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 301101, Unchanged Files: 296028, Skipped Files: 0, Backed-up Files: 606, Total File Size: 314.66 GB, Average Transmission Speed: 1.90 MB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 301101,
        "sin_cambios": 296028,
        "omitidos": 0,
        "respaldados": 606,
        "tamano_gb": 314.66,
        "velocidad": "1.90 MB"
      }
    },
    {
      "id": "18e404fbadc2c091",
      "fecha": "2024-03-15 01:00:14",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18e405d97e805670",
      "fecha": "2024-03-15 01:15:24",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18e405d9c5cb4cfb",
      "fecha": "2024-03-15 01:15:25",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 303948, Unchanged Files: 298305, Skipped Files: 0, Backed-up Files: 1173, Total File Size: 316.88 GB, Average Transmission Speed: 888.11 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 303948,
        "sin_cambios": 298305,
        "omitidos": 0,
        "respaldados": 1173,
        "tamano_gb": 316.88,
        "velocidad": "888.11 KB"
      }
    },
    {
      "id": "18e645c55d270388",
      "fecha": "2024-03-22 01:00:15",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18e6469bbbce1be0",
      "fecha": "2024-03-22 01:14:55",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18e6469c1ced24c1",
      "fecha": "2024-03-22 01:14:57",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 304195, Unchanged Files: 298886, Skipped Files: 0, Backed-up Files: 839, Total File Size: 317.09 GB, Average Transmission Speed: 478.35 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 304195,
        "sin_cambios": 298886,
        "omitidos": 0,
        "respaldados": 839,
        "tamano_gb": 317.09,
        "velocidad": "478.35 KB"
      }
    },
    {
      "id": "18ef48eaa4674532",
      "fecha": "2024-04-19 01:00:16",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18ef49db3b9d2429",
      "fecha": "2024-04-19 01:16:42",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "18ef49db9b6e7c37",
      "fecha": "2024-04-19 01:16:43",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 308179, Unchanged Files: 299787, Skipped Files: 0, Backed-up Files: 3916, Total File Size: 322.51 GB, Average Transmission Speed: 1.59 MB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 308179,
        "sin_cambios": 299787,
        "omitidos": 0,
        "respaldados": 3916,
        "tamano_gb": 322.51,
        "velocidad": "1.59 MB"
      }
    },
    {
      "id": "190152a302f124b0",
      "fecha": "2024-06-14 01:00:15",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "1901538a47f88396",
      "fecha": "2024-06-14 01:16:03",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "1901538aabf88b38",
      "fecha": "2024-06-14 01:16:05",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 312777, Unchanged Files: 307268, Skipped Files: 0, Backed-up Files: 994, Total File Size: 326.99 GB, Average Transmission Speed: 512.68 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 312777,
        "sin_cambios": 307268,
        "omitidos": 0,
        "respaldados": 994,
        "tamano_gb": 326.99,
        "velocidad": "512.68 KB"
      }
    },
    {
      "id": "1903936d159cb1ec",
      "fecha": "2024-06-21 01:00:17",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19039451510e213e",
      "fecha": "2024-06-21 01:15:53",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19039451a89b02c3",
      "fecha": "2024-06-21 01:15:55",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 313415, Unchanged Files: 308031, Skipped Files: 0, Backed-up Files: 869, Total File Size: 327.20 GB, Average Transmission Speed: 435.85 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 313415,
        "sin_cambios": 308031,
        "omitidos": 0,
        "respaldados": 869,
        "tamano_gb": 327.2,
        "velocidad": "435.85 KB"
      }
    },
    {
      "id": "192c1e23df27411c",
      "fecha": "2024-10-25 01:00:15",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "192c1f193460000e",
      "fecha": "2024-10-25 01:17:01",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "192c1f19844516d9",
      "fecha": "2024-10-25 01:17:03",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 325006, Unchanged Files: 319757, Skipped Files: 0, Backed-up Files: 737, Total File Size: 351.80 GB, Average Transmission Speed: 597.49 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 325006,
        "sin_cambios": 319757,
        "omitidos": 0,
        "respaldados": 737,
        "tamano_gb": 351.8,
        "velocidad": "597.49 KB"
      }
    },
    {
      "id": "19592de020c306b2",
      "fecha": "2025-03-14 01:00:20",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19592f38c900bfa2",
      "fecha": "2025-03-14 01:23:52",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19592f39088457f2",
      "fecha": "2025-03-14 01:23:54",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 349333, Unchanged Files: 331031, Skipped Files: 0, Backed-up Files: 13733, Total File Size: 376.99 GB, Average Transmission Speed: 3.98 MB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 349333,
        "sin_cambios": 331031,
        "omitidos": 0,
        "respaldados": 13733,
        "tamano_gb": 376.99,
        "velocidad": "3.98 MB"
      }
    },
    {
      "id": "195ea87837c3d346",
      "fecha": "2025-03-31 01:32:14",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Job Status",
      "mensaje": "Failed to complete Backup job: \"Backup-Diario-Disco-Externo\". The external volume ID does not match the external volume ID saved in the job settings.",
      "stats": null
    },
    {
      "id": "195ea8787b10d0c2",
      "fecha": "2025-03-31 01:32:16",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Custom Job Event",
      "mensaje": "Failed to complete Backup job: \"Backup-Diario-Disco-Externo\". The external volume ID does not match the external volume ID saved in the job settings.. Check logs for more information.",
      "stats": null
    },
    {
      "id": "195ff20f26b93f4b",
      "fecha": "2025-04-04 01:32:11",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Custom Job Event",
      "mensaje": "Failed to complete Backup job: \"Backup-Diario-Disco-Externo\". The external volume ID does not match the external volume ID saved in the job settings.. Check logs for more information.",
      "stats": null
    },
    {
      "id": "19613ba7fb9eaa36",
      "fecha": "2025-04-08 01:32:15",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Custom Job Event",
      "mensaje": "Failed to complete Backup job: \"Backup-Diario-Disco-Externo\". The external volume ID does not match the external volume ID saved in the job settings.. Check logs for more information.",
      "stats": null
    },
    {
      "id": "19618e0e4280ee6e",
      "fecha": "2025-04-09 01:32:16",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "failed",
      "severidad": "Error",
      "categoria": "Custom Job Event",
      "mensaje": "Failed to complete Backup job: \"Backup-Diario-Disco-Externo\". The external volume ID does not match the external volume ID saved in the job settings.. Check logs for more information.",
      "stats": null
    },
    {
      "id": "196fb92f0ef92742",
      "fecha": "2025-05-23 01:00:15",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "1971f9f866114a85",
      "fecha": "2025-05-30 01:00:15",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19aecd0831904818",
      "fecha": "2025-12-05 01:21:54",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19b58e29243b6994",
      "fecha": "2025-12-26 01:00:19",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19b58f36c5cae41d",
      "fecha": "2025-12-26 01:18:45",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19b58f372aef479c",
      "fecha": "2025-12-26 01:18:46",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 366717, Unchanged Files: 361554, Skipped Files: 0, Backed-up Files: 585, Total File Size: 421.93 GB, Average Transmission Speed: 498.43 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 366717,
        "sin_cambios": 361554,
        "omitidos": 0,
        "respaldados": 585,
        "tamano_gb": 421.93,
        "velocidad": "498.43 KB"
      }
    },
    {
      "id": "19bc50864674dbff",
      "fecha": "2026-01-16 01:00:16",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19bc51d5056c7d14",
      "fecha": "2026-01-16 01:23:10",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19bc51d564044715",
      "fecha": "2026-01-16 01:23:12",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 377031, Unchanged Files: 362759, Skipped Files: 0, Backed-up Files: 9694, Total File Size: 432.77 GB, Average Transmission Speed: 2.06 MB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 377031,
        "sin_cambios": 362759,
        "omitidos": 0,
        "respaldados": 9694,
        "tamano_gb": 432.77,
        "velocidad": "2.06 MB"
      }
    },
    {
      "id": "19e4917394ac2459",
      "fecha": "2026-05-21 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e492a7c57fabd3",
      "fecha": "2026-05-21 01:51:13",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e4e224065ba552",
      "fecha": "2026-05-22 01:00:17",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19e4e34873487ff7",
      "fecha": "2026-05-22 01:20:17",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19e4e348c6fda7c5",
      "fecha": "2026-05-22 01:20:18",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 394336, Unchanged Files: 389490, Skipped Files: 0, Backed-up Files: 268, Total File Size: 485.35 GB, Average Transmission Speed: 322.16 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 394336,
        "sin_cambios": 389490,
        "omitidos": 0,
        "respaldados": 268,
        "tamano_gb": 485.35,
        "velocidad": "322.16 KB"
      }
    },
    {
      "id": "19e4e3d7b16ce399",
      "fecha": "2026-05-22 01:30:04",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e4e5047aed9310",
      "fecha": "2026-05-22 01:50:36",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e6d23ce20d56f0",
      "fecha": "2026-05-28 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e6d3753178882e",
      "fecha": "2026-05-28 01:51:30",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e722ed08d5d38e",
      "fecha": "2026-05-29 01:00:15",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19e7241c9a45f1e6",
      "fecha": "2026-05-29 01:21:00",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19e7241ce5c3ddc7",
      "fecha": "2026-05-29 01:21:02",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 395753, Unchanged Files: 389434, Skipped Files: 0, Backed-up Files: 1741, Total File Size: 486.18 GB, Average Transmission Speed: 799.51 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 395753,
        "sin_cambios": 389434,
        "omitidos": 0,
        "respaldados": 1741,
        "tamano_gb": 486.18,
        "velocidad": "799.51 KB"
      }
    },
    {
      "id": "19e724a18f880cdc",
      "fecha": "2026-05-29 01:30:05",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e725daa25937d7",
      "fecha": "2026-05-29 01:51:27",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e7c96ee6c06806",
      "fecha": "2026-05-31 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e7caa8e3cd64ae",
      "fecha": "2026-05-31 01:51:37",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e86e3af2193860",
      "fecha": "2026-06-02 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19e86f745ad6c6eb",
      "fecha": "2026-06-02 01:51:35",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19eba481d54f8b5f",
      "fecha": "2026-06-12 01:00:20",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19eba61e83a21eaf",
      "fecha": "2026-06-12 01:28:32",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19eba61f22bc4caf",
      "fecha": "2026-06-12 01:28:35",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 396990, Unchanged Files: 391355, Skipped Files: 0, Backed-up Files: 1057, Total File Size: 502.92 GB, Average Transmission Speed: 5.27 MB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 396990,
        "sin_cambios": 391355,
        "omitidos": 0,
        "respaldados": 1057,
        "tamano_gb": 502.92,
        "velocidad": "5.27 MB"
      }
    },
    {
      "id": "19eba635a99a1a51",
      "fecha": "2026-06-12 01:30:07",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19eba7aca0313e5b",
      "fecha": "2026-06-12 01:55:43",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ee39660f540262",
      "fecha": "2026-06-20 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ee3aa4d293348d",
      "fecha": "2026-06-20 01:51:56",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19eede322671ee28",
      "fecha": "2026-06-22 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19eedf6cf1efc550",
      "fecha": "2026-06-22 01:51:41",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ef31d0eab0cb63",
      "fecha": "2026-06-23 01:51:32",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ef82fdaea99f79",
      "fecha": "2026-06-24 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ef844cd258d7ab",
      "fecha": "2026-06-24 01:53:03",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f0261489f9352b",
      "fecha": "2026-06-26 01:00:18",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19f0275d100980a5",
      "fecha": "2026-06-26 01:22:45",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19f0275d668eff2e",
      "fecha": "2026-06-26 01:22:47",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 400611, Unchanged Files: 395419, Skipped Files: 0, Backed-up Files: 614, Total File Size: 507.89 GB, Average Transmission Speed: 779.30 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 400611,
        "sin_cambios": 395419,
        "omitidos": 0,
        "respaldados": 614,
        "tamano_gb": 507.89,
        "velocidad": "779.30 KB"
      }
    },
    {
      "id": "19f027c84e43d390",
      "fecha": "2026-06-26 01:30:04",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f0290523e8e49d",
      "fecha": "2026-06-26 01:51:42",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f171618e4788e9",
      "fecha": "2026-06-30 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f1729c539e2c29",
      "fecha": "2026-06-30 01:51:40",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f1c3c72982d0eb",
      "fecha": "2026-07-01 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f1c5031ff2a9a4",
      "fecha": "2026-07-01 01:51:44",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f2162d9a907ebd",
      "fecha": "2026-07-02 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f45835e599fb0a",
      "fecha": "2026-07-09 01:51:58",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f5a08ec260691b",
      "fecha": "2026-07-13 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f5a1cd6671da0d",
      "fecha": "2026-07-13 01:51:56",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f78ef277b11919",
      "fecha": "2026-07-19 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f790309fc41e2b",
      "fecha": "2026-07-19 01:51:54",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f833be41c39273",
      "fecha": "2026-07-21 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19f834f983f0a3bc",
      "fecha": "2026-07-21 01:51:43",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19fd5a1ca0468da6",
      "fecha": "2026-08-06 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19fd5b5dc28fa3e1",
      "fecha": "2026-08-06 01:52:05",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19fe52975f55bd07",
      "fecha": "2026-08-09 01:52:37",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ff9ae65249c45f",
      "fecha": "2026-08-13 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ff9c29ebf2a9d7",
      "fecha": "2026-08-13 01:52:16",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ffeb96ce318ae4",
      "fecha": "2026-08-14 01:00:17",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19ffecd247f55b28",
      "fecha": "2026-08-14 01:21:51",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\".",
      "stats": null
    },
    {
      "id": "19ffecd29f0bd57e",
      "fecha": "2026-08-14 01:21:52",
      "job": "RAIZ PATAGUA A DRIVE Q3Z1ON",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Custom Job Event",
      "mensaje": "Finished Backup job: \"RAIZ PATAGUA A DRIVE Q3Z1ON\". Folder Pairs: 27, Total Files: 403295, Unchanged Files: 396946, Skipped Files: 0, Backed-up Files: 1771, Total File Size: 514.29 GB, Average Transmission Speed: 742.88 KB.",
      "stats": {
        "carpetas": 27,
        "archivos_total": 403295,
        "sin_cambios": 396946,
        "omitidos": 0,
        "respaldados": 1771,
        "tamano_gb": 514.29,
        "velocidad": "742.88 KB"
      }
    },
    {
      "id": "19ffed4ac03b9f20",
      "fecha": "2026-08-14 01:30:05",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "19ffee868c982173",
      "fecha": "2026-08-14 01:51:38",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a00921832deb03b",
      "fecha": "2026-08-16 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a009353385423a5",
      "fecha": "2026-08-16 01:51:41",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a018949ee2048c6",
      "fecha": "2026-08-19 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a018a91d4cf5095",
      "fecha": "2026-08-19 01:52:33",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a02807bf7e98ad8",
      "fecha": "2026-08-22 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a0281bcb6840498",
      "fecha": "2026-08-22 01:52:04",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a02d2e2309ca18f",
      "fecha": "2026-08-23 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a02d421ca5f52fb",
      "fecha": "2026-08-23 01:52:00",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a0513aba23c68f7",
      "fecha": "2026-08-30 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a0514ee6b7476cf",
      "fecha": "2026-08-30 01:52:13",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a075106066b9e65",
      "fecha": "2026-09-06 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a0e65c9059ea1af",
      "fecha": "2026-09-28 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a0e670cd2294998",
      "fecha": "2026-09-28 01:52:17",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a1294f695139d5b",
      "fecha": "2026-10-11 01:30:08",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a12963b8545285a",
      "fecha": "2026-10-11 01:52:21",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a12e75ca397c859",
      "fecha": "2026-10-12 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a12e89f9b71eee3",
      "fecha": "2026-10-12 01:52:14",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a161f5843d25b49",
      "fecha": "2026-10-22 01:30:09",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "started",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Started Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    },
    {
      "id": "1a16209dfbd464d9",
      "fecha": "2026-10-22 01:52:25",
      "job": "Backup-Diario-Disco-Externo",
      "tipo": "finished",
      "severidad": "Info",
      "categoria": "Job Status",
      "mensaje": "Finished Backup job: \"Backup-Diario-Disco-Externo\".",
      "stats": null
    }
  ]
};
