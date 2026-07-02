@echo off
title [CAI DAT LAN DAU] Watch Auto Publisher
color 0B

:: Di chuyen den thu muc chua script
cd /d "%~dp0"

echo.
echo  +======================================================+
echo  !     CAI DAT LAN DAU - WATCH AUTO PUBLISHER           !
echo  !     Chi can chay 1 lan duy nhat tren may moi         !
echo  +======================================================+
echo.

:: ============================================
:: BUOC 1: Kiem tra Node.js
:: ============================================
echo [1/5] Dang kiem tra Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  +======================================================+
    echo  !  [LOI] KHONG TIM THAY NODE.JS!                       !
    echo  !                                                       !
    echo  !  Hay cai dat Node.js truoc khi tiep tuc:              !
    echo  !  1. Truy cap: https://nodejs.org                      !
    echo  !  2. Tai ban LTS                                       !
    echo  !  3. Cai dat voi tat ca tuy chon mac dinh              !
    echo  !  4. Khoi dong lai may tinh                            !
    echo  !  5. Chay lai file nay                                 !
    echo  +======================================================+
    echo.
    echo Dang mo trang tai Node.js cho ban...
    start https://nodejs.org/en/download/
    echo.
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
    echo    [OK] Node.js da duoc cai dat: %NODE_VER%
)

:: ============================================
:: BUOC 2: Kiem tra Git
:: ============================================
echo.
echo [2/5] Dang kiem tra Git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  +======================================================+
    echo  !  [LOI] KHONG TIM THAY GIT!                           !
    echo  !                                                       !
    echo  !  Hay cai dat Git truoc khi tiep tuc:                  !
    echo  !  1. Truy cap: https://git-scm.com/downloads/win      !
    echo  !  2. Tai ban 64-bit                                    !
    echo  !  3. Cai dat voi tat ca tuy chon mac dinh              !
    echo  !  4. Khoi dong lai may tinh                            !
    echo  !  5. Chay lai file nay                                 !
    echo  +======================================================+
    echo.
    echo Dang mo trang tai Git cho ban...
    start https://git-scm.com/downloads/win
    echo.
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('git --version') do set GIT_VER=%%i
    echo    [OK] Git da duoc cai dat: %GIT_VER%
)

:: ============================================
:: BUOC 3: Tai va Cai dat Redis (Portable)
:: ============================================
echo.
echo [3/5] Dang kiem tra Redis Local...
if not exist "%~dp0Redis\redis-server.exe" (
    echo    Khong tim thay Redis. Dang tu dong tai ve phien ban Portable...
    mkdir "%~dp0Redis" 2>nul
    curl -L -o "%~dp0Redis\Redis.zip" "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
    echo    Dang giai nen Redis...
    tar -xf "%~dp0Redis\Redis.zip" -C "%~dp0Redis"
    del "%~dp0Redis\Redis.zip"
    echo    [OK] Da cai dat Redis thanh cong!
) else (
    echo    [OK] Redis da duoc cai dat san.
)

:: ============================================
:: BUOC 4: Cai dat thu vien (npm install)
:: ============================================
echo.
echo [4/5] Dang cai dat tat ca thu vien can thiet...
echo    Qua trinh nay co the mat 3-10 phut, vui long doi...
echo.

echo --- Cai dat thu vien goc (root)... ---
call npm install
if %errorlevel% neq 0 (
    echo [LOI] Cai dat thu vien goc that bai!
    pause
    exit /b 1
)

echo.
echo --- Cai dat thu vien backend... ---
cd backend
call npm install
if %errorlevel% neq 0 (
    echo [LOI] Cai dat thu vien backend that bai!
    pause
    exit /b 1
)

echo.
echo --- Khoi tao Database... ---
call npx prisma db push
if %errorlevel% neq 0 (
    echo [LOI] Khoi tao database that bai!
    pause
    exit /b 1
)

cd ..

echo.
echo --- Cai dat thu vien frontend... ---
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo [LOI] Cai dat thu vien frontend that bai!
    pause
    exit /b 1
)
cd ..

:: ============================================
:: BUOC 5: Cai dat Playwright browsers
:: ============================================
echo.
echo [5/5] Dang cai dat trinh duyet tu dong (Playwright)...
echo    Qua trinh nay co the mat 5-10 phut...
cd backend
call npx playwright install chromium
cd ..

echo.
echo  +======================================================+
echo  !                                                       !
echo  !   CAI DAT THANH CONG!                                 !
echo  !                                                       !
echo  !   Bay gio ban co the chay file:                       !
echo  !   2_CHAY_TOOL.bat                                     !
echo  !                                                       !
echo  !   (Khong can chay file cai dat nay nua)               !
echo  !                                                       !
echo  +======================================================+
echo.
pause
