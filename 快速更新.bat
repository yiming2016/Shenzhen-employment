@echo off
chcp 65001 >nul
echo ==========================================
echo   快速更新（免打包）：构建 + 复制 + 启动
echo ==========================================
echo 正在关闭正在运行的深圳社保计算器...
taskkill /IM 深圳社保计算器.exe /F >nul 2>&1
taskkill /IM SZ-Shebao-Calculator-*.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

cd /d "%~dp0"

set "APP_DIR=%~dp0..\软件\电脑版\win-unpacked"

echo 正在构建 core ...
call npm run build:core
if errorlevel 1 goto :fail
echo 正在构建 renderer ...
call npm run build:renderer
if errorlevel 1 goto :fail

if not exist "%APP_DIR%\resources\app" (
  echo 错误：未找到 resources\app 目录，请先运行一次完整打包。
  goto :fail
)
echo 正在复制到绿色版目录 resources\app ...
copy /Y "package.json" "%APP_DIR%\resources\app\package.json" >nul
copy /Y "desktop\main.js" "%APP_DIR%\resources\app\desktop\main.js" >nul
copy /Y "desktop\preload.js" "%APP_DIR%\resources\app\desktop\preload.js" >nul
if exist "%APP_DIR%\resources\app\desktop\dist" rmdir /S /Q "%APP_DIR%\resources\app\desktop\dist"
xcopy /E /I /Y /Q "desktop\dist" "%APP_DIR%\resources\app\desktop\dist" >nul

echo 正在启动新版本...
start "" "%APP_DIR%\深圳社保计算器.exe"
echo.
echo 完成！本次未运行 electron-builder，速度很快。
exit /b 0

:fail
echo 构建失败，未启动。
exit /b 1
