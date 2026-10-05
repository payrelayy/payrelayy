@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start FetanAgent Automatic Deposits.ps1"
set "routine_result=%ERRORLEVEL%"
echo.
echo Review the FetanAgent Owner page and any unfinished attempt before restarting Automatic Deposits.
pause
exit /b %routine_result%
