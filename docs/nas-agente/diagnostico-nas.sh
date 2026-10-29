#!/bin/sh
# Diagnóstico de un NAS QNAP para preparar el agente de backups de IndexPro (Soporte > IndexPro).
# SOLO LECTURA: no crea, borra ni modifica nada, y no imprime contraseñas, tokens ni configuraciones de jobs.
# Imprime: modelo/versión, herramientas disponibles, espacio, discos (SMART/temperatura), ubicación de Hybrid Backup Sync,
# disco USB externo, tareas programadas y si el NAS puede salir a internet por HTTPS.
#
# Uso desde Windows (PowerShell), reemplazando IP_DEL_NAS y el usuario administrador:
#   Get-Content -Raw .\diagnostico-nas.sh | ssh admin@IP_DEL_NAS "sh -s" | Tee-Object diagnostico-salida.txt
# Luego pegar el contenido de diagnostico-salida.txt en el chat.

seccion() { echo; echo "===== $1 ====="; }

seccion "Fecha y usuario"
date
id

seccion "Modelo y versión de QTS"
getcfg System Model -f /etc/config/uLinux.conf 2>/dev/null
getcfg System Version -f /etc/config/uLinux.conf 2>/dev/null
getcfg System "Build Number" -f /etc/config/uLinux.conf 2>/dev/null
uname -a

seccion "Herramientas disponibles"
for t in curl wget python3 python jq sqlite3 openssl crontab; do
  printf "%s: " "$t"; command -v "$t" || echo "NO"
done

seccion "Memoria"
free -m 2>/dev/null | head -3

seccion "Espacio en volúmenes y discos externos"
df -h 2>/dev/null | grep -E "Filesystem|CACHEDEV|external|DEV"

seccion "Discos (modelo, capacidad, SMART, temperatura)"
echo "Cantidad de discos: $(getsysinfo hdnum 2>/dev/null)"
for i in 1 2 3 4; do
  m=$(getsysinfo hdmodel $i 2>/dev/null)
  [ -z "$m" ] && continue
  echo "Disco $i: modelo=$m capacidad=$(getsysinfo hdcapacity $i 2>/dev/null) smart=$(getsysinfo hdsmart $i 2>/dev/null) temp=$(getsysinfo hdtmp $i 2>/dev/null)"
done
echo "Temperatura sistema: $(getsysinfo systmp 2>/dev/null)  CPU: $(getsysinfo cputmp 2>/dev/null)"

seccion "Aplicaciones instaladas (solo nombres)"
grep '^\[' /etc/config/qpkg.conf 2>/dev/null | tr -d '[]' | tr '\n' ' '; echo

seccion "Hybrid Backup Sync: versión y ubicación"
for s in HybridBackup HBS3 HybridBackupSync; do
  v=$(getcfg "$s" Version -f /etc/config/qpkg.conf 2>/dev/null)
  p=$(getcfg "$s" Install_Path -f /etc/config/qpkg.conf 2>/dev/null)
  if [ -n "$v$p" ]; then echo "Sección $s: versión=$v ruta=$p"; HBS_PATH="$p"; fi
done
[ -z "$HBS_PATH" ] && { echo "No encontré la sección en qpkg.conf; buscando por nombre..."; find /share/CACHEDEV1_DATA/.qpkg -maxdepth 1 -iname "*hybrid*" 2>/dev/null; }

seccion "Archivos de log/BD de Hybrid Backup Sync (solo nombre y tamaño, sin contenido)"
if [ -n "$HBS_PATH" ] && [ -d "$HBS_PATH" ]; then
  find "$HBS_PATH" -maxdepth 4 \( -name "*.log" -o -name "*.db" -o -name "*.sqlite*" -o -name "*.csv" \) -exec ls -la {} \; 2>/dev/null | head -60
else
  echo "(sin ruta de HBS que listar)"
fi

seccion "Disco USB externo (puntos de montaje)"
ls -la /share/external 2>/dev/null
mount 2>/dev/null | grep -i external

seccion "Tareas programadas (crontab del sistema)"
cat /etc/config/crontab 2>/dev/null

seccion "Salida a internet (HTTPS)"
if command -v curl >/dev/null 2>&1; then
  curl -sS -o /dev/null -m 10 -w "erp.indexstore.cl -> HTTP %{http_code}\n" https://erp.indexstore.cl/login.html 2>&1
else
  echo "Sin curl: no se pudo probar"
fi

echo
echo "===== FIN (nada fue modificado) ====="
