# build_exe.py
# Build script to create Skills Manager executable
import subprocess
import sys
import os
from pathlib import Path

def main():
    app_dir = Path(__file__).parent
    os.chdir(app_dir)
    
    print("=" * 60)
    print("Building Skills Manager Executable")
    print("=" * 60)
    
    # Install PyInstaller if needed
    print("\n[1/3] Checking PyInstaller...")
    try:
        import PyInstaller
        print("      PyInstaller found.")
    except ImportError:
        print("      Installing PyInstaller...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)
    
    # Build command
    print("\n[2/3] Building executable...")
    
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",                          # Single exe file
        "--name", "SkillsManager",            # Output name
        "--icon", "NONE",                     # No icon (or specify .ico path)
        "--console",                          # Show console window
        "--add-data", "skills-manager.html;.",  # Include HTML file
        "--add-data", "skills_manager_api.py;.",  # Include API module
        "--hidden-import", "flask",
        "--hidden-import", "flask_cors",
        "--hidden-import", "werkzeug",
        "--clean",                            # Clean build
        "skills_manager_launcher.py"
    ]
    
    result = subprocess.run(cmd)
    
    if result.returncode == 0:
        print("\n[3/3] Build complete!")
        print("=" * 60)
        print(f"\n✓ Executable created: {app_dir / 'dist' / 'SkillsManager.exe'}")
        print("\nTo use:")
        print("  1. Copy SkillsManager.exe to your skills-mcp folder")
        print("  2. Make sure 'skills/' folder is in the same directory")
        print("  3. Double-click SkillsManager.exe to run")
        print("\n" + "=" * 60)
    else:
        print("\n[!] Build failed. Check errors above.")

if __name__ == "__main__":
    main()
