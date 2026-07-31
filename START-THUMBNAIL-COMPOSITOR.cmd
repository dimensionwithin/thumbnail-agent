@echo off
setlocal
cd /d "%~dp0"

py -3 thumbnail_service.py %*
if %errorlevel% neq 0 (
  for /d %%D in ("%LocalAppData%\Python\pythoncore-*") do (
    if exist "%%~fD\python.exe" (
      "%%~fD\python.exe" thumbnail_service.py %*
      goto :finished
    )
  )
  python thumbnail_service.py %*
)

:finished
if %errorlevel% neq 0 (
  echo.
  echo Der lokale Thumbnail-Dienst konnte nicht gestartet werden.
  pause
)
