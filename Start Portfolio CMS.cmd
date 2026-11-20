@echo off
rem Double-click to start the Portfolio CMS.
rem First time: offers to install Node.js and Git if missing (asks first), gets the CMS ready,
rem adds a "Portfolio CMS" shortcut to the desktop, then opens the CMS. After that it just opens it.
setlocal
title Start Portfolio CMS
cd /d "%~dp0"
echo.
echo   Portfolio CMS
echo.

where node >nul 2>nul
if not errorlevel 1 goto node_ok
call :install "Node.js" "OpenJS.NodeJS.LTS" "https://nodejs.org" "%ProgramFiles%\nodejs" "It runs the CMS."
if errorlevel 1 goto failed
goto node_done
:node_ok
echo   [ok] Node.js found
:node_done

where git >nul 2>nul
if not errorlevel 1 goto git_ok
call :install "Git" "Git.Git" "https://git-scm.com/download/win" "%ProgramFiles%\Git\cmd" "It keeps your versions."
if errorlevel 1 goto failed
goto git_done
:git_ok
echo   [ok] Git found
:git_done

if exist "node_modules\astro" goto ready
echo   Getting things ready. First time only, about a minute...
call npm install --no-audit --no-fund --loglevel=error >nul
if errorlevel 1 goto npm_failed
:ready
echo   [ok] Ready

if exist "cms\.local\portfolio-cms.ico" goto shortcut_done
node cms\shortcut.js >nul 2>nul
if not errorlevel 1 echo   [ok] "Portfolio CMS" added to your desktop
:shortcut_done

echo.
echo   Opening the CMS...
start "" wscript.exe "%~dp0cms\launch.vbs"
echo   You can close this window. Next time, use the desktop shortcut.
timeout /t 6 >nul
exit /b 0

rem ---------- install a missing tool with Windows' own installer (winget), after asking ----------
:install
echo   [!] %~1 isn't installed. %~5
choice /c YN /n /m "      Install it now? It's free and takes a minute. [Y/N] "
if errorlevel 2 goto install_declined
where winget >nul 2>nul
if errorlevel 1 goto install_manual
echo       Installing %~1. Windows may ask for permission...
winget install --id %~2 -e --source winget --accept-package-agreements --accept-source-agreements --silent >nul
if errorlevel 1 goto install_manual
set "PATH=%PATH%;%~4"
echo   [ok] %~1 installed
exit /b 0
:install_declined
echo       No problem. Install %~1 from %~3, then double-click this file again.
exit /b 1
:install_manual
echo       Couldn't install it automatically. Opening %~3 so you can install it,
echo       then double-click this file again.
start "" "%~3"
exit /b 1

:npm_failed
echo.
echo   [x] Couldn't get things ready. Check your internet connection and try again.
goto hold
:failed
echo.
echo   [x] The CMS can't start yet.
:hold
echo.
pause
exit /b 1
