@echo off
rem Double-click to play The 12th Tide (Windows).
cd /d "%~dp0"
where py >nul 2>nul && ( py serve.py & goto :end )
where python3 >nul 2>nul && ( python3 serve.py & goto :end )
where python >nul 2>nul && ( python serve.py & goto :end )
where npx >nul 2>nul && ( start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8080/" & npx --yes http-server play -p 8080 -a 127.0.0.1 -c-1 & goto :end )
echo The 12th Tide needs Python 3 (python.org) or Node.js (nodejs.org) to run its little local server.
:end
pause
