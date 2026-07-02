@echo off
title Watch Auto Publisher - DANG CHAY
color 0A

:: Di chuyen den thu muc chua script
cd /d "%~dp0"

echo.
echo  +======================================================+
echo  !         WATCH AUTO PUBLISHER - KHOI DONG              !
echo  +======================================================+
echo.

:: ============================================
:: Kiem tra nhanh Node.js
:: ============================================
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Node.js! Hay chay file "1_CAI_DAT_LAN_DAU.bat" truoc.
    pause
    exit /b 1
)

:: ============================================
:: BUOC 1: Cap nhat code moi nhat tu GitHub
:: ============================================
echo [1/4] Dang cap nhat code moi nhat tu GitHub...
git config core.autocrlf true 2>nul
git config core.safecrlf false 2>nul
git fetch origin >nul 2>nul
git reset --hard origin/master >nul 2>nul
git pull origin master >nul 2>nul
if %errorlevel% neq 0 (
    echo    [CANH BAO] Khong the cap nhat code. Co the khong co mang hoac chua cau hinh git.
    echo    Tiep tuc khoi dong voi code hien tai...
) else (
    echo    [OK] Code da cap nhat thanh cong tu GitHub.
)

:: ============================================
:: BUOC 2: Kiem tra va cai dat thu vien moi (neu co)
:: ============================================
echo.
echo [2/4] Dang kiem tra thu vien...
call npm install --silent 2>nul
cd backend
call npm install --silent 2>nul
call npx prisma db push --accept-data-loss 2>nul
cd ..
cd frontend
call npm install --silent 2>nul
cd ..
echo    [OK] Thu vien da san sang.

:: ============================================
:: BUOC 3: Khoi dong Redis
:: ============================================
echo.
echo [3/4] Dang khoi dong Redis...

:: Kiem tra Redis co dang chay khong
tasklist /FI "IMAGENAME eq redis-server.exe" 2>nul | find /I "redis-server.exe" >nul
if %errorlevel% equ 0 (
    echo    [OK] Redis da dang chay san.
) else (
    :: Xoa file dump cu neu co
    if exist "%~dp0dump.rdb" del /Q "%~dp0dump.rdb"
    start "Redis Server" /B "%~dp0Redis\redis-server.exe" "%~dp0Redis\redis.windows.conf"
    echo    [OK] Redis da khoi dong.
)

:: ============================================
:: BUOC 4: Khoi dong Tool (Backend + Frontend)
:: ============================================
echo.
echo [4/4] Dang khoi dong Tool...
echo.
echo  +======================================================+
echo  !                                                       !
echo  !   Tool dang chay! Vui long doi vai giay...            !
echo  !                                                       !
echo  !   Truy cap: http://localhost:5173                     !
echo  !                                                       !
echo  !   ** KHONG DONG CUA SO NAY KHI DANG SU DUNG **       !
echo  !                                                       !
echo  +======================================================+
echo.

call npm run dev:no-ngrok

echo.
echo Tool da dung lai.
pause
