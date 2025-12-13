@echo off
echo ============================================================
echo Building Skills Manager Executable
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Python...
python --version
if errorlevel 1 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)

echo.
echo [2/4] Installing dependencies...
pip install flask flask-cors pyinstaller --quiet

echo.
echo [3/4] Building executable...
pyinstaller --onefile --name "SkillsManager" --console --clean --noconfirm ^
    --add-data "skills-manager.html;." ^
    skills_manager_app.py

echo.
echo [4/4] Copying files to dist...
copy "skills-manager.html" "dist\skills-manager.html" >nul 2>&1
if not exist "dist\skills" mkdir "dist\skills"

echo.
echo ============================================================
echo BUILD COMPLETE!
echo ============================================================
echo.
echo Executable: %~dp0dist\SkillsManager.exe
echo.
echo To distribute:
echo   1. Copy the 'dist' folder contents
echo   2. Ensure 'skills-manager.html' is next to the .exe
echo   3. The 'skills' folder will be created automatically
echo.
pause
