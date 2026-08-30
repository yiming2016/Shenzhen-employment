@echo off
chcp 65001 >nul
echo 正在关闭正在运行的深圳社保计算器...
taskkill /IM 深圳社保计算器.exe /F >nul 2>&1
taskkill /IM SZ-Shebao-Calculator-*.exe /F >nul 2>&1

cd /d "%~dp0"
echo 正在构建绿色版（约 2~3 分钟）...
call npm run dist

echo 正在同步到软件目录...
set "APP_DIR=%~dp0..\软件\电脑版\release\win-unpacked"
if exist "%APP_DIR%" rmdir /S /Q "%APP_DIR%"
xcopy /E /I /Y /Q "release\win-unpacked" "%APP_DIR%" >nul
rmdir /S /Q "release"

echo.
echo 完成！绿色版位置：%APP_DIR%\深圳社保计算器.exe
echo 便携版位置：%APP_DIR%\..\SZ-Shebao-Calculator-*-portable.exe
pause
