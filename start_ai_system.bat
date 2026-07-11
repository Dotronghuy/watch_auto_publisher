@echo off
title He Thong AI Ban Hang - Control Panel
color 0A

echo ========================================================
echo        KHOI DONG HE THONG AI BAN HANG (LOCAL)
echo ========================================================
echo.

echo [1/3] Kiem tra va khoi dong Ollama...
start "Ollama Server" cmd /c "ollama serve"
timeout /t 5 /nobreak >nul

echo [2/3] Khoi dong Backend (API & AI Service)...
start "Backend Server" cmd /c "cd backend && npm run dev"
timeout /t 3 /nobreak >nul

echo [3/3] Khoi dong Frontend (Dashboard)...
start "Frontend Dashboard" cmd /c "cd frontend && npm run dev"

echo.
echo ========================================================
echo ✅ He thong da duoc khoi dong thanh cong!
echo ✅ Dashboard: http://localhost:5173
echo ✅ API Server: http://localhost:3333
echo ✅ Ollama AI: http://localhost:11434
echo ========================================================
echo Luu y: Khong tat cac cua so mau den (cmd) trong qua trinh ban hang.
echo Nhan phim bat ky de thoat bang dieu khien nay...
pause >nul
