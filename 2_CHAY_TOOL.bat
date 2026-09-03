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

:: Khong cho mo hai ban Tool cung luc (gay tranh cong va backend restart lien tuc)
netstat -ano | findstr /R /C:":3000 .*LISTENING" /C:":3100 .*LISTENING" /C:":5173 .*LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [LOI] Phat hien Tool cu van dang chay hoac bi ket.
    echo Hay chay "3_TAT_TOOL_KHI_BI_LOI.bat" truoc, sau do mo lai file nay.
    pause
    exit /b 1
)

:: ============================================
:: BUOC 1: Dong bo code moi nhat tu GitHub
:: ============================================
echo [1/6] Dang dong bo code moi nhat tu GitHub...
if not exist ".git" (
    echo    [LOI] Thu muc nay khong phai ban Git clone, khong the tu dong cap nhat.
    pause
    exit /b 1
)

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo    [LOI] Khong tim thay Git tren may.
    pause
    exit /b 1
)

git pull --ff-only origin master
if %errorlevel% neq 0 (
    echo    [LOI] Khong the dong bo code. Hay kiem tra Internet hoac thay doi code cuc bo.
    echo    Tool se khong khoi dong bang code cu de tranh chay sai phien ban.
    pause
    exit /b 1
)
echo    [OK] Code da dong bo thanh cong tu GitHub.

:: ============================================
:: BUOC 2: Kiem tra va cai dat thu vien moi (neu co)
:: ============================================
echo.
echo [2/6] Dang kiem tra thu vien...
if not exist "node_modules\concurrently\package.json" call npm install
if not exist "backend\node_modules\playwright\package.json" call npm --prefix backend install
if not exist "frontend\node_modules\vite\package.json" call npm --prefix frontend install

:: Code moi co the bo sung cot SQLite/Prisma. Luon dong bo schema sau git pull
:: de Backend va Mobile Gateway cung doc dung caption da luu trong job.
pushd backend
call npx prisma generate
if errorlevel 1 (
    popd
    echo    [LOI] Khong the tao Prisma Client theo schema moi.
    pause
    exit /b 1
)
call npx prisma db push --skip-generate
if errorlevel 1 (
    popd
    echo    [LOI] Khong the dong bo database cho Mobile Worker.
    pause
    exit /b 1
)
popd
echo    [OK] Thu vien da san sang.

:: ============================================
:: BUOC 3: Khoi dong Redis
:: ============================================
echo.
echo [3/6] Dang khoi dong Redis...

:: Kiem tra Redis co dang chay khong
tasklist /FI "IMAGENAME eq redis-server.exe" 2>nul | find /I "redis-server.exe" >nul
if %errorlevel% equ 0 (
    echo    Redis local da co tien trinh dang chay, dang kiem tra ket noi...
) else (
    start "Redis Server" /B "%~dp0Redis\redis-server.exe" "%~dp0Redis\redis.windows.conf"
    timeout /t 2 /nobreak >nul
)

"%~dp0Redis\redis-cli.exe" -h 127.0.0.1 -p 6379 PING | find /I "PONG" >nul
if errorlevel 1 (
    echo    [LOI] Redis local khong phan hoi tai 127.0.0.1:6379.
    pause
    exit /b 1
)
echo    [OK] Redis local san sang tai 127.0.0.1:6379.

:: ============================================
:: BUOC 4: Chuan bi Mobile Worker Gateway
:: ============================================
echo.
echo [4/6] Mobile Worker Gateway se duoc quan ly cung Backend va Frontend.
echo    [OK] Khong con tien trinh Gateway rieng co the bi cu hoac sot lai.

:: ============================================
:: BUOC 5: Khoi dong Tailscale Funnel
:: ============================================
echo.
echo [5/6] Dang kiem tra Tailscale Funnel...
call npm --prefix backend run start:mobile-worker-funnel
if errorlevel 1 (
    echo    [CANH BAO] Khong the bat Tailscale Funnel.
    echo    Hay kiem tra Tailscale da cai dat, dang nhap va da cho phep Funnel.
    echo    Tool chinh van se khoi dong, nhung dien thoai co the khong ket noi duoc.
) else (
    echo    [OK] Tailscale Funnel da san sang.
)

:: ============================================
:: BUOC 6: Khoi dong Tool (Gateway + Backend + Frontend)
:: ============================================
echo.
echo [6/6] Dang khoi dong Tool...
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

:: Redis da duoc khoi dong va kiem tra dung mot lan o BUOC 3.
:: Lenh nay quan ly Gateway + Backend + Frontend de tat/mo cung mot luong.
:: Redis khong bi mo trung cong
:: roi lam concurrently tat ca tien trinh con lai.
call npm run start:no-ngrok

echo.
echo Tool da dung lai.
pause
