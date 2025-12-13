# skills_manager_launcher.py
# Launches the Skills Manager API server and opens the browser
import subprocess
import sys
import os
import time
import webbrowser
import socket
import threading
from pathlib import Path

# Configuration
PORT = 5050
HOST = "127.0.0.1"

def get_app_dir():
    """Get the directory where the app is located."""
    if getattr(sys, 'frozen', False):
        # Running as compiled exe
        return Path(sys.executable).parent
    else:
        # Running as script
        return Path(__file__).parent

def is_port_in_use(port):
    """Check if port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, port)) == 0

def open_browser_delayed():
    """Open browser after a short delay to let server start."""
    time.sleep(2)
    webbrowser.open(f"http://{HOST}:{PORT}")

def main():
    app_dir = get_app_dir()
    os.chdir(app_dir)
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                    Skills Manager                            ║
╠══════════════════════════════════════════════════════════════╣
║  Starting server at http://{HOST}:{PORT}                       ║
║  Press Ctrl+C to stop                                        ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    # Check if server already running
    if is_port_in_use(PORT):
        print(f"[!] Port {PORT} already in use. Opening browser to existing server...")
        webbrowser.open(f"http://{HOST}:{PORT}")
        input("\nPress Enter to exit...")
        return
    
    # Start browser in background thread
    browser_thread = threading.Thread(target=open_browser_delayed, daemon=True)
    browser_thread.start()
    
    # Import and run Flask app
    try:
        # Add app directory to path
        sys.path.insert(0, str(app_dir))
        
        from skills_manager_api import app, SKILLS_DIR, find_claude_cli
        
        print(f"[✓] Skills directory: {SKILLS_DIR}")
        print(f"[✓] Claude CLI: {find_claude_cli() or 'Not found'}")
        print(f"\n[*] Server starting...\n")
        
        # Run Flask (this blocks)
        app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
        
    except KeyboardInterrupt:
        print("\n[*] Server stopped.")
    except Exception as e:
        print(f"\n[!] Error: {e}")
        input("\nPress Enter to exit...")

if __name__ == "__main__":
    main()
