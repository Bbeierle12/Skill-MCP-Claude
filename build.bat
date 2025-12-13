@echo off
echo ============================================================
echo Building Skills Manager Executable
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/5] Checking Python...
python --version
if errorlevel 1 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)

echo.
echo [2/5] Installing dependencies...
pip install flask flask-cors pyinstaller --quiet

echo.
echo [3/5] Building executable...
pyinstaller --onefile --name "SkillsManager" --console --clean --noconfirm ^
    --add-data "skills-manager.html;." ^
    skills_manager_app.py

echo.
echo [4/5] Copying files to dist...
copy "skills-manager.html" "dist\skills-manager.html" >nul 2>&1

echo.
echo [5/5] Syncing skills to dist...
if not exist "dist\skills" mkdir "dist\skills"
xcopy "skills\*" "dist\skills\" /E /Y /Q >nul 2>&1
for /f %%a in ('dir /b /ad "skills" 2^>nul ^| find /c /v ""') do set SKILL_COUNT=%%a
echo Synced %SKILL_COUNT% skills to dist\skills

echo.
echo ============================================================
echo BUILD COMPLETE!
echo ============================================================
echo.
echo Executable: %~dp0dist\SkillsManager.exe
echo Skills:     %SKILL_COUNT% skills synced to dist\skills
echo.
echo To distribute:
echo   1. Copy the 'dist' folder contents
echo   2. Everything is self-contained
echo.
pause
