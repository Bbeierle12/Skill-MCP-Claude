# Skills Manager API container image.
# Single-stage build that runs the Flask API server (skills_manager_api.py).
# The MCP server (server.py) can also be run from this image by overriding CMD.
#
# Usage:
#   docker build -t skills-manager .
#   docker run --rm -p 5050:5050 -v "$(pwd)/skills:/data/skills" \
#       -e SKILLS_DIR=/data/skills skills-manager

FROM python:3.11-slim

# Don't write .pyc files, flush stdout/stderr immediately.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install Python dependencies first to maximize layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application source. The skills/ directory should be provided as a
# volume mount at runtime via SKILLS_DIR; we still copy any bundled defaults so
# fresh containers without a mount have something to load.
COPY core ./core
COPY server.py skills_manager_api.py skills_manager_app.py ./
COPY skills-manager.html ./
COPY skills ./skills

# Default skills location inside the container (override with -e SKILLS_DIR=...).
ENV SKILLS_DIR=/app/skills \
    HOST=127.0.0.1 \
    PORT=5050 \
    FLASK_DEBUG=false

EXPOSE 5050

# Lightweight healthcheck against the skills list endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+__import__('os').environ.get('PORT','5050')+'/api/skills', timeout=3).status==200 else 1)"

CMD ["python", "skills_manager_api.py"]
