@echo off
rem 방문기록 앱 실행기. 더블클릭하면 준비를 마친 뒤 브라우저에서 화면이 열린다.
rem 이 창은 앱 서버이므로, 닫으면 앱이 종료된다.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 방문기록 (이 창을 닫으면 앱이 종료됩니다)

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 없습니다. https://nodejs.org 에서 Node.js 24 LTS 이상을 설치한 뒤 다시 실행해 주세요.
  goto end
)

if not exist "node_modules\" (
  echo [준비] 처음 실행이라 필요한 라이브러리를 설치합니다. 몇 분 걸릴 수 있습니다...
  call npm ci --no-fund
  if errorlevel 1 (
    echo [오류] 라이브러리 설치에 실패했습니다. 인터넷 연결을 확인해 주세요.
    goto end
  )
)

echo [준비] 브라우저(Chromium)를 확인합니다...
call npx --no-install playwright install chromium >nul
if errorlevel 1 (
  echo [오류] 브라우저 설치에 실패했습니다. 인터넷 연결을 확인해 주세요.
  goto end
)

echo [준비] 바탕화면에 '방문기록' 아이콘을 만듭니다(다음부터는 아이콘으로 실행하세요)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1"

call npm run --silent app
if errorlevel 1 (
  echo.
  echo [오류] 앱을 시작하지 못했습니다. 위의 메시지를 확인해 주세요.
)

:end
echo.
pause
endlocal
