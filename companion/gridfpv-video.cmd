@echo off
rem gridfpv-video — the RaceGOW video companion, for Windows. Double-click to watch; or
rem run with a command: gridfpv-video.cmd probe | render "<recording>" | init | ui
rem (`ui` opens the helper's window in your browser: profiles, the session, the log).
rem It carries its own Node (node.exe) and JavaScript; ffmpeg is fetched once, below.
setlocal
cd /d "%~dp0"

if not exist "ffmpeg\bin\ffmpeg.exe" (
  echo Fetching ffmpeg once ^(about 115 MB, from gyan.dev^)...
  curl -L --fail -o ffmpeg.zip https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip || goto :noffmpeg
  tar -xf ffmpeg.zip || goto :noffmpeg
  del ffmpeg.zip
  for /d %%d in (ffmpeg-*essentials_build) do move "%%d" ffmpeg >nul
  if not exist "ffmpeg\bin\ffmpeg.exe" goto :noffmpeg
)
set "GRIDFPV_FFMPEG=%~dp0ffmpeg\bin\ffmpeg.exe"

if not exist "gridfpv-video.json" (
  echo First run: a few questions, saved to gridfpv-video.json ^(edit it any time^).
  "%~dp0node.exe" "%~dp0src\cli.js" init || goto :end
)

if "%~1"=="" (
  "%~dp0node.exe" "%~dp0src\cli.js" watch
) else if /i "%~1"=="ui" (
  "%~dp0node.exe" "%~dp0src\cli.js" serve --port 5055 --open
) else (
  "%~dp0node.exe" "%~dp0src\cli.js" %*
)
goto :end

:noffmpeg
echo.
echo Could not fetch ffmpeg. Download https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
echo by hand, unzip it, and put its folder here as "ffmpeg" ^(so ffmpeg\bin\ffmpeg.exe exists^).
:end
echo.
pause
