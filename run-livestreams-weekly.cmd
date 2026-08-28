@echo off
REM Wochenlauf Livestream-Archiv-Sync (SCHARF: mit --execute --yes)
REM Wird vom Windows-Taskplaner aufgerufen. Schreibt backups\livestream-weekly-LAST.txt
REM C1 (2026-08-27): Log wird ANGEHAENGT (nicht ueberschrieben), mit Zeitstempel
REM und Trennlinie pro Lauf -- sonst ist ein fehlgeschlagener Lauf (z.B. 25.08.2026,
REM Exit 1) nicht mehr nachvollziehbar, sobald der naechste Lauf drueberschreibt.
REM 2026-08-27: Auf --execute --yes umgestellt, nachdem die Zuordnung mehrfach
REM fehlerfrei war. Das "--" vor den Flags ist noetig, damit npm sie durchreicht.
REM Zurueck in den Melde-Modus: einfach " -- --execute --yes" in der call-Zeile
REM entfernen.
cd /d "%~dp0"
if not exist logs mkdir logs
echo ===================================================================== >> "logs\livestream-weekly.log"
echo Lauf gestartet: %DATE% %TIME% >> "logs\livestream-weekly.log"
echo ===================================================================== >> "logs\livestream-weekly.log"
call npm run livestreams:weekly -- --execute --yes >> "logs\livestream-weekly.log" 2>&1
set WEEKLY_EXIT=%ERRORLEVEL%
echo Lauf beendet: %DATE% %TIME% -- Exit-Code %WEEKLY_EXIT% >> "logs\livestream-weekly.log"

REM Z3 (2026-08-28): Backup des unwiederbringlichen Zustands ins private
REM State-Repo. Laeuft NACH dem Wochenlauf und AUCH, wenn dieser abgebrochen
REM ist -- dann ist der Stand erst recht schuetzenswert. Das Skript beendet
REM sich immer mit 0; %WEEKLY_EXIT% wird unten unveraendert durchgereicht,
REM damit ein Backup-Problem den Wochenlauf nicht rot macht. Fehler stehen in
REM backups\livestream-weekly-LAST.txt.
echo --- Backup State-Repo: %DATE% %TIME% >> "logs\livestream-weekly.log"
call node scripts\backup-state.cjs >> "logs\livestream-weekly.log" 2>&1

exit /b %WEEKLY_EXIT%