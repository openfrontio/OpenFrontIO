```bat
@echo off
title Auto Update
color 0A

echo ===============================
echo Updating Main Project
echo ===============================

cd /d "%~dp0"

echo Pull latest code...
git fetch upstream
git checkout main
git merge upstream/main

echo.
echo ===============================
echo Copying Project
echo ===============================

set TARGET=..\open(amade)

if not exist "%TARGET%" (
 echo Target folder not found
 pause
 exit
)

echo Copying files...
robocopy "%cd%" "%TARGET%" /E /XD node_modules .git /XF finish.cmd

echo.
echo Switching to target folder...
cd /d "%TARGET%"

echo Installing target dependencies...
call npm run inst

echo Starting dev server...
start cmd /k "npm run dev"

echo.
echo DONE
pause
```