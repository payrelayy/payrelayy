@echo off
setlocal
title FetanAgent - Deposits and Player ID
echo Opening FetanAgent in one protected Chrome window.
echo Keep this window and the Chrome window open. Do not start a second copy.
echo Sign in only on the KemerBet page if it asks you to.
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start FetanAgent Automatic Deposits.ps1" -EnablePlayerIdFind
set "fetanagent_result=%ERRORLEVEL%"
echo.
if not "%fetanagent_result%"=="0" (
  echo FetanAgent stopped or could not start. Check the Owner page for unfinished work.
) else (
  echo FetanAgent has stopped. Check the Owner page before opening it again.
)
echo Press any key to close this status window.
pause >nul
exit /b %fetanagent_result%
