@echo off
chcp 65001 >nul
title منظومة كودكس — الخادم المحلي ومحرك المزامنة مع السحابة
cd /d "%~dp0"
echo ========================================================
echo   منظومة كودكس — تشغيل الخادم المحلي + محرك المزامنة
echo   شركة كودكس للبرمجيات (Codex Software)
echo ========================================================
echo.
echo 1. تشغيل محرك المزامنة الذكي لسحب التقارير من السحابة إلى القرص الصلب...
start /b node local_relay_sync.js
echo 2. تشغيل الخادم المحلي على: http://localhost:8080/
echo.
echo [Super Admin]: http://localhost:8080/super_admin.html
echo [تسجيل الدخول]:  http://localhost:8080/login.html
echo ========================================================
echo.
node server.js
pause
