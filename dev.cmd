@echo off
rem Uses the portable Node LTS in D:\Tools for this project only; the system PATH is untouched.
rem   dev.cmd            start the dev server
rem   dev.cmd test       any npm command, e.g. "dev.cmd run build"
set "PATH=D:\Tools\node-v24.21.0;%PATH%"
cd /d "%~dp0"
if "%~1"=="" (npm run dev) else (npm %*)
