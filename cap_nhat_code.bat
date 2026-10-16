@echo off
echo ===================================
echo   CAP NHAT CODE MOI NHAT TU GIT
echo ===================================
echo.

cd /d "%~dp0"

if not exist ".git" (
    echo Day la ban ZIP nen khong the tu cap nhat qua Git.
    echo.
    echo De lay phien ban moi:
    echo   1. Tai ban ZIP moi nhat tu Google Drive.
    echo   2. Giai nen DE LEN thu muc cu, chon "Thay the file" khi duoc hoi.
    echo   3. Chay lai "1_CAI_DAT_LAN_DAU.bat" mot lan roi "2_CHAY_TOOL.bat".
    echo.
    echo File .env, cookie dang nhap va du lieu cua ban se duoc giu nguyen.
    echo.
    pause
    exit /b 0
)

echo Dang tai code moi nhat...
git fetch --all
git reset --hard origin/master

echo.
echo ===================================
echo   XONG! Da cap nhat thanh cong.
echo   Ban co the bat chay_tool.bat
echo ===================================
echo.
pause
