@echo off
title Khoi Dong Tool Auto Publisher
color 0A

:: Di chuyen den thu muc chua script nay (thu muc project)
cd /d "%~dp0"

echo ===================================================
echo [1/3] Dang kiem tra va cap nhat code tu Github...
echo ===================================================
git pull origin master

echo.
echo ===================================================
echo [2/3] Dang kiem tra va cai dat thu vien...
echo ===================================================
echo --- Cai dat thu vien goc... ---
call npm install
echo --- Cai dat thu vien backend... ---
cd backend
call npm install
echo --- Khoi tao Database Backend ---
call npx prisma db push
cd ..
echo --- Cai dat thu vien frontend... ---
cd frontend
call npm install
cd ..

echo.
echo ===================================================
echo [3/4] Dang khoi dong CSDL Redis...
echo ===================================================
echo Dang bat Redis ngam...
if exist "%~dp0dump.rdb" del /Q "%~dp0dump.rdb"
start "Redis Server" /B "%~dp0Redis\redis-server.exe" "%~dp0Redis\redis.windows.conf"

echo.
echo ===================================================
echo [4/4] Dang khoi dong Tool...
echo ===================================================
echo Vui long doi vai giay de tool khoi dong. KHONG TAT CUA SO NAY!
call npm run dev

pause
