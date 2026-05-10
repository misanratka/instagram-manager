@echo off
echo ============================================
echo  InstaManager - First-time Setup
echo ============================================
echo.

echo [1/3] Installing backend dependencies...
cd backend
call npm install
if %errorlevel% neq 0 (
  echo ERROR: Backend install failed.
  pause
  exit /b 1
)
cd ..

echo.
echo [2/3] Installing frontend dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
  echo ERROR: Frontend install failed.
  pause
  exit /b 1
)
cd ..

echo.
echo [3/3] Creating .env from template...
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env"
  echo   Created backend\.env  -- EDIT IT before running the app!
) else (
  echo   backend\.env already exists, skipping.
)

echo.
echo ============================================
echo  Setup complete!
echo.
echo  NEXT STEPS:
echo  1. Edit backend\.env with your API keys
echo  2. Make sure yt-dlp is installed:
echo       pip install yt-dlp
echo     or download from: https://github.com/yt-dlp/yt-dlp/releases
echo  3. Make sure ffmpeg is installed and in PATH:
echo       https://ffmpeg.org/download.html
echo  4. Start the app:
echo       Run start-backend.bat in one terminal
echo       Run start-frontend.bat in another
echo ============================================
pause
