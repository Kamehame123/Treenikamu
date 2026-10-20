@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0gen-icons.mjs"
if errorlevel 1 pause