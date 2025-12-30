"""
Skills Manager API for Vercel
Uses Vercel Blob Storage for skill persistence
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import re
from urllib.parse import parse_qs, urlparse

# Vercel Blob SDK
try:
    from vercel_blob import put, list as blob_list, delete as blob_delete, head
except ImportError:
    # Fallback for local development
    put = blob_list = blob_delete = head = None

BLOB_TOKEN = os.environ.get('BLOB_READ_WRITE_TOKEN', '')


def sanitize_name(name: str) -> str:
    """Convert name to valid skill directory name."""
    return re.sub(r'[^a-z0-9-]', '-', name.lower().strip()).strip('-')


def get_skill_path(name: str, filename: str = 'SKILL.md') -> str:
    """Get blob path for a skill file."""
    return f"skills/{name}/{filename}"


async def list_skills():
    """List all skills from blob storage."""
    if not blob_list:
        return {"skills": [], "error": "Blob storage not configured"}

    try:
        result = blob_list(prefix="skills/", token=BLOB_TOKEN)

        # Group files by skill name
        skills_map = {}
        for blob in result.get('blobs', []):
            path = blob['pathname']
            parts = path.split('/')
            if len(parts) >= 2:
                skill_name = parts[1]
                if skill_name not in skills_map:
                    skills_map[skill_name] = {
                        'name': skill_name,
                        'files': [],
                        'content': None,
                        'description': '',
                        'tags': []
                    }
                skills_map[skill_name]['files'].append(path)

        # Fetch content and metadata for each skill
        skills = []
        for name, skill_data in skills_map.items():
            # Get SKILL.md content
            skill_md_path = get_skill_path(name)
            try:
                from urllib.request import urlopen
                blob_info = head(skill_md_path, token=BLOB_TOKEN)
                if blob_info:
                    with urlopen(blob_info['url']) as response:
                        content = response.read().decode('utf-8')
                        skill_data['content'] = content

                        # Extract description from frontmatter
                        if content.startswith('---'):
                            try:
                                end = content.index('---', 3)
                                for line in content[3:end].split('\n'):
                                    if line.startswith('description:'):
                                        skill_data['description'] = line.split(':', 1)[1].strip()
                                        break
                            except ValueError:
                                pass
            except Exception:
                pass

            # Get _meta.json if exists
            meta_path = get_skill_path(name, '_meta.json')
            try:
                blob_info = head(meta_path, token=BLOB_TOKEN)
                if blob_info:
                    from urllib.request import urlopen
                    with urlopen(blob_info['url']) as response:
                        meta = json.loads(response.read().decode('utf-8'))
                        skill_data.update(meta)
            except Exception:
                pass

            skill_data['file_count'] = len(skill_data['files'])
            skills.append(skill_data)

        return {"skills": skills}
    except Exception as e:
        return {"skills": [], "error": str(e)}


async def get_skill(name: str):
    """Get a specific skill."""
    if not head:
        return {"error": "Blob storage not configured"}, 500

    try:
        skill_data = {'name': name, 'files': []}

        # Get SKILL.md
        skill_md_path = get_skill_path(name)
        blob_info = head(skill_md_path, token=BLOB_TOKEN)

        if not blob_info:
            return {"error": f"Skill '{name}' not found"}, 404

        from urllib.request import urlopen
        with urlopen(blob_info['url']) as response:
            skill_data['content'] = response.read().decode('utf-8')

        # Get _meta.json
        meta_path = get_skill_path(name, '_meta.json')
        try:
            meta_info = head(meta_path, token=BLOB_TOKEN)
            if meta_info:
                with urlopen(meta_info['url']) as response:
                    meta = json.loads(response.read().decode('utf-8'))
                    skill_data.update(meta)
        except Exception:
            pass

        # List all files
        result = blob_list(prefix=f"skills/{name}/", token=BLOB_TOKEN)
        for blob in result.get('blobs', []):
            rel_path = blob['pathname'].replace(f"skills/{name}/", '')
            skill_data['files'].append(rel_path)

        return skill_data, 200
    except Exception as e:
        return {"error": str(e)}, 500


async def create_skill(data: dict):
    """Create a new skill."""
    if not put:
        return {"error": "Blob storage not configured"}, 500

    name = sanitize_name(data.get('name', ''))
    if not name:
        return {"error": "Skill name is required"}, 400

    description = data.get('description', '')
    content = data.get('content', '')

    skill_md = f"""---
name: {name}
description: {description}
---

{content}
"""

    try:
        # Upload SKILL.md
        put(
            get_skill_path(name),
            skill_md.encode('utf-8'),
            {'access': 'public', 'token': BLOB_TOKEN}
        )

        # Upload _meta.json
        meta = {
            'name': name,
            'description': description,
            'tags': data.get('tags', []),
            'sub_skills': data.get('sub_skills', []),
            'source': 'web-upload'
        }
        put(
            get_skill_path(name, '_meta.json'),
            json.dumps(meta, indent=2).encode('utf-8'),
            {'access': 'public', 'token': BLOB_TOKEN}
        )

        return {"success": True, "name": name}, 200
    except Exception as e:
        return {"error": str(e)}, 500


async def update_skill(name: str, data: dict):
    """Update an existing skill."""
    if not put:
        return {"error": "Blob storage not configured"}, 500

    description = data.get('description', '')
    content = data.get('content', '')

    skill_md = f"""---
name: {name}
description: {description}
---

{content}
"""

    try:
        # Upload updated SKILL.md
        put(
            get_skill_path(name),
            skill_md.encode('utf-8'),
            {'access': 'public', 'token': BLOB_TOKEN}
        )

        # Update _meta.json
        meta = {
            'name': name,
            'description': description,
            'tags': data.get('tags', [])
        }
        put(
            get_skill_path(name, '_meta.json'),
            json.dumps(meta, indent=2).encode('utf-8'),
            {'access': 'public', 'token': BLOB_TOKEN}
        )

        return {"success": True, "name": name}, 200
    except Exception as e:
        return {"error": str(e)}, 500


async def delete_skill(name: str):
    """Delete a skill."""
    if not blob_delete or not blob_list:
        return {"error": "Blob storage not configured"}, 500

    try:
        # List all files for this skill
        result = blob_list(prefix=f"skills/{name}/", token=BLOB_TOKEN)

        if not result.get('blobs'):
            return {"error": f"Skill '{name}' not found"}, 404

        # Delete all files
        for blob in result['blobs']:
            blob_delete(blob['url'], token=BLOB_TOKEN)

        return {"success": True, "name": name}, 200
    except Exception as e:
        return {"error": str(e)}, 500


class handler(BaseHTTPRequestHandler):
    def _send_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self._send_response({})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        import asyncio

        if path == '/api/skills':
            result = asyncio.run(list_skills())
            self._send_response(result)
        elif path.startswith('/api/skills/'):
            name = path.replace('/api/skills/', '')
            result, status = asyncio.run(get_skill(name))
            self._send_response(result, status)
        else:
            self._send_response({"error": "Not found"}, 404)

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        data = json.loads(body) if body else {}

        import asyncio

        if self.path == '/api/skills':
            result, status = asyncio.run(create_skill(data))
            self._send_response(result, status)
        elif self.path == '/api/reload':
            self._send_response({"success": True, "message": "Skills reloaded"})
        else:
            self._send_response({"error": "Not found"}, 404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/skills/'):
            name = path.replace('/api/skills/', '')
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}

            import asyncio
            result, status = asyncio.run(update_skill(name, data))
            self._send_response(result, status)
        else:
            self._send_response({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/skills/'):
            name = path.replace('/api/skills/', '')

            import asyncio
            result, status = asyncio.run(delete_skill(name))
            self._send_response(result, status)
        else:
            self._send_response({"error": "Not found"}, 404)
