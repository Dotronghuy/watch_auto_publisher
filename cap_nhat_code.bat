@echo off
echo ===================================
echo   CAP NHAT CODE MOI NHAT TU GIT
echo ===================================
echo.

cd /d "%~dp0"

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
