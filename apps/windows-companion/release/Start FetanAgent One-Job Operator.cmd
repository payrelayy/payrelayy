@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start FetanAgent One-Job Operator.ps1"
set "operator_result=%ERRORLEVEL%"
echo.
echo Review the FetanAgent Owner page before starting another one-job session.
pause
exit /b %operator_result%
