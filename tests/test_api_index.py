"""
Tests for api/index.py — the Vercel Blob Storage skills API handler.

These tests cover the previously untested module by mocking the
vercel_blob SDK and the BaseHTTPRequestHandler I/O.
"""

import asyncio
import io
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Make sure the project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reload_api(monkeypatch, blob_token="test-blob-token", api_token="",
                allowed_origin="http://localhost:3000",
                vercel_blob_present=True):
    """
    Import api.index with the given environment, optionally simulating
    presence/absence of the vercel_blob SDK.
    """
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", blob_token)
    monkeypatch.setenv("SKILLS_API_TOKEN", api_token)
    monkeypatch.setenv("ALLOWED_ORIGIN", allowed_origin)

    # Remove cached module so env vars are re-read.
    sys.modules.pop("api.index", None)
    sys.modules.pop("api", None)

    if vercel_blob_present:
        # Stub out the vercel_blob module so the import inside api.index works
        fake_vb = MagicMock()
        fake_vb.put = MagicMock(name="put")
        fake_vb.list = MagicMock(name="list")
        fake_vb.delete = MagicMock(name="delete")
        fake_vb.head = MagicMock(name="head")
        monkeypatch.setitem(sys.modules, "vercel_blob", fake_vb)
    else:
        # Force ImportError when api.index tries to import vercel_blob
        monkeypatch.setitem(sys.modules, "vercel_blob", None)

    import importlib
    import api.index as api_index
    importlib.reload(api_index)
    return api_index


class _FakeURLOpenResponse:
    """A context-manager-compatible fake urllib response."""

    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


# ---------------------------------------------------------------------------
# Pure helper functions
# ---------------------------------------------------------------------------

class TestSanitizeName:
    def test_lowercases(self, monkeypatch):
        api = _reload_api(monkeypatch)
        assert api.sanitize_name("My Skill") == "my-skill"

    def test_strips_special_chars(self, monkeypatch):
        api = _reload_api(monkeypatch)
        # Each disallowed char is replaced by a single dash; outer dashes stripped
        assert api.sanitize_name("foo!@#bar$$") == "foo---bar"
        # Outer special chars get stripped after the dash conversion
        assert api.sanitize_name("!foo!") == "foo"

    def test_strips_outer_dashes(self, monkeypatch):
        api = _reload_api(monkeypatch)
        assert api.sanitize_name("---hello---") == "hello"

    def test_empty_string(self, monkeypatch):
        api = _reload_api(monkeypatch)
        assert api.sanitize_name("") == ""

    def test_only_special_chars(self, monkeypatch):
        api = _reload_api(monkeypatch)
        assert api.sanitize_name("!!!@@@") == ""


class TestGetSkillPath:
    def test_default_filename(self, monkeypatch):
        api = _reload_api(monkeypatch)
        assert api.get_skill_path("my-skill") == "skills/my-skill/SKILL.md"

    def test_custom_filename(self, monkeypatch):
        api = _reload_api(monkeypatch)
        assert (
            api.get_skill_path("my-skill", "_meta.json")
            == "skills/my-skill/_meta.json"
        )


class TestCheckBlobConfigured:
    def test_returns_none_when_configured(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="abc")
        assert api._check_blob_configured() is None

    def test_returns_error_when_missing(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="")
        result = api._check_blob_configured()
        assert result is not None
        assert "Blob storage not configured" in result["error"]


class TestModuleImportFallback:
    def test_fallback_when_vercel_blob_missing(self, monkeypatch):
        api = _reload_api(monkeypatch, vercel_blob_present=False)
        assert api.put is None
        assert api.blob_list is None
        assert api.blob_delete is None
        assert api.head is None


# ---------------------------------------------------------------------------
# Async API functions
# ---------------------------------------------------------------------------

def _run(coro):
    return asyncio.run(coro)


class TestListSkills:
    def test_returns_error_when_token_missing(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="")
        result = _run(api.list_skills())
        assert "error" in result

    def test_returns_empty_when_sdk_missing(self, monkeypatch):
        api = _reload_api(monkeypatch, vercel_blob_present=False)
        # blob_token is set but blob_list is None
        result = _run(api.list_skills())
        assert result["skills"] == []
        assert "error" in result

    def test_lists_skills_with_metadata(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.return_value = {
            "blobs": [
                {"pathname": "skills/foo/SKILL.md"},
                {"pathname": "skills/foo/_meta.json"},
                {"pathname": "skills/bar/SKILL.md"},
            ]
        }

        def head_side_effect(path, token=None):
            return {"url": f"https://example.com/{path}"}

        api.head.side_effect = head_side_effect

        skill_md = (
            "---\nname: foo\ndescription: A foo skill\n---\n# Foo\n"
        ).encode("utf-8")
        meta = json.dumps({"tags": ["alpha", "beta"]}).encode("utf-8")
        bar_md = b"# Bar (no frontmatter)"

        def urlopen_side_effect(url):
            if url.endswith("/skills/foo/SKILL.md"):
                return _FakeURLOpenResponse(skill_md)
            if url.endswith("/skills/foo/_meta.json"):
                return _FakeURLOpenResponse(meta)
            if url.endswith("/skills/bar/SKILL.md"):
                return _FakeURLOpenResponse(bar_md)
            if url.endswith("/skills/bar/_meta.json"):
                return _FakeURLOpenResponse(b"{}")
            return _FakeURLOpenResponse(b"")

        with patch("urllib.request.urlopen", side_effect=urlopen_side_effect):
            result = _run(api.list_skills())

        names = {s["name"] for s in result["skills"]}
        assert names == {"foo", "bar"}

        foo = next(s for s in result["skills"] if s["name"] == "foo")
        assert foo["description"] == "A foo skill"
        assert foo["tags"] == ["alpha", "beta"]
        assert foo["file_count"] == 2

    def test_ignores_short_paths(self, monkeypatch):
        api = _reload_api(monkeypatch)
        # A path with only one segment (no slash) is skipped by the len >= 2 check
        api.blob_list.return_value = {"blobs": [{"pathname": "skills"}]}
        result = _run(api.list_skills())
        assert result["skills"] == []

    def test_handles_head_failure_gracefully(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.return_value = {
            "blobs": [{"pathname": "skills/foo/SKILL.md"}]
        }
        # head raises -> caught and logged, doesn't fail the call
        api.head.side_effect = RuntimeError("network down")
        result = _run(api.list_skills())
        assert any(s["name"] == "foo" for s in result["skills"])

    def test_handles_top_level_exception(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.side_effect = RuntimeError("blob api down")
        result = _run(api.list_skills())
        assert result["skills"] == []
        assert "blob api down" in result["error"]


class TestGetSkill:
    def test_returns_error_when_token_missing(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="")
        result, status = _run(api.get_skill("foo"))
        assert status == 500
        assert "error" in result

    def test_returns_error_when_sdk_missing(self, monkeypatch):
        api = _reload_api(monkeypatch, vercel_blob_present=False)
        result, status = _run(api.get_skill("foo"))
        assert status == 500

    def test_returns_404_when_missing(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.head.return_value = None
        result, status = _run(api.get_skill("ghost"))
        assert status == 404
        assert "not found" in result["error"]

    def test_returns_skill(self, monkeypatch):
        api = _reload_api(monkeypatch)
        # First head() call (SKILL.md) returns info, second (_meta.json) returns info too
        api.head.side_effect = [
            {"url": "https://example.com/skills/foo/SKILL.md"},
            {"url": "https://example.com/skills/foo/_meta.json"},
        ]
        api.blob_list.return_value = {
            "blobs": [
                {"pathname": "skills/foo/SKILL.md"},
                {"pathname": "skills/foo/_meta.json"},
            ]
        }

        skill_md = b"# Foo\n"
        meta = json.dumps({"tags": ["x"]}).encode("utf-8")

        def urlopen_side_effect(url):
            if url.endswith("SKILL.md"):
                return _FakeURLOpenResponse(skill_md)
            return _FakeURLOpenResponse(meta)

        with patch("urllib.request.urlopen", side_effect=urlopen_side_effect):
            result, status = _run(api.get_skill("foo"))

        assert status == 200
        assert result["name"] == "foo"
        assert result["content"] == "# Foo\n"
        assert result["tags"] == ["x"]
        assert "SKILL.md" in result["files"]
        assert "_meta.json" in result["files"]

    def test_meta_failure_does_not_fail_request(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.head.side_effect = [
            {"url": "https://example.com/SKILL.md"},
            RuntimeError("meta fetch failed"),
        ]
        api.blob_list.return_value = {"blobs": []}
        with patch(
            "urllib.request.urlopen",
            return_value=_FakeURLOpenResponse(b"# Foo"),
        ):
            result, status = _run(api.get_skill("foo"))
        assert status == 200
        assert result["content"] == "# Foo"

    def test_handles_top_level_exception(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.head.side_effect = RuntimeError("boom")
        result, status = _run(api.get_skill("foo"))
        assert status == 500
        assert "boom" in result["error"]


class TestCreateSkill:
    def test_requires_token(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="")
        result, status = _run(api.create_skill({"name": "foo"}))
        assert status == 500

    def test_requires_sdk(self, monkeypatch):
        api = _reload_api(monkeypatch, vercel_blob_present=False)
        result, status = _run(api.create_skill({"name": "foo"}))
        assert status == 500

    def test_requires_name(self, monkeypatch):
        api = _reload_api(monkeypatch)
        result, status = _run(api.create_skill({}))
        assert status == 400
        assert "name" in result["error"].lower()

    def test_creates_skill(self, monkeypatch):
        api = _reload_api(monkeypatch)
        result, status = _run(
            api.create_skill(
                {
                    "name": "My Skill",
                    "description": "Desc",
                    "content": "Body",
                    "tags": ["a"],
                    "sub_skills": [],
                }
            )
        )
        assert status == 200
        assert result["success"] is True
        assert result["name"] == "my-skill"
        # put called twice: SKILL.md and _meta.json
        assert api.put.call_count == 2
        # Check arguments include sanitized path
        first_args = api.put.call_args_list[0].args
        assert first_args[0] == "skills/my-skill/SKILL.md"
        # SKILL.md body contains the description
        assert b"description: Desc" in first_args[1]

    def test_propagates_put_exception(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.put.side_effect = RuntimeError("upload failed")
        result, status = _run(api.create_skill({"name": "foo"}))
        assert status == 500
        assert "upload failed" in result["error"]


class TestUpdateSkill:
    def test_requires_token(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="")
        result, status = _run(api.update_skill("foo", {}))
        assert status == 500

    def test_requires_sdk(self, monkeypatch):
        api = _reload_api(monkeypatch, vercel_blob_present=False)
        result, status = _run(api.update_skill("foo", {}))
        assert status == 500

    def test_updates_skill(self, monkeypatch):
        api = _reload_api(monkeypatch)
        result, status = _run(
            api.update_skill(
                "foo",
                {"description": "New", "content": "New body", "tags": ["t"]},
            )
        )
        assert status == 200
        assert result["success"] is True
        assert api.put.call_count == 2

    def test_propagates_exception(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.put.side_effect = RuntimeError("oh no")
        result, status = _run(api.update_skill("foo", {}))
        assert status == 500


class TestDeleteSkill:
    def test_requires_token(self, monkeypatch):
        api = _reload_api(monkeypatch, blob_token="")
        result, status = _run(api.delete_skill("foo"))
        assert status == 500

    def test_requires_sdk(self, monkeypatch):
        api = _reload_api(monkeypatch, vercel_blob_present=False)
        result, status = _run(api.delete_skill("foo"))
        assert status == 500

    def test_returns_404_when_no_blobs(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.return_value = {"blobs": []}
        result, status = _run(api.delete_skill("foo"))
        assert status == 404

    def test_deletes_all_blobs(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.return_value = {
            "blobs": [
                {"url": "https://example.com/a"},
                {"url": "https://example.com/b"},
            ]
        }
        result, status = _run(api.delete_skill("foo"))
        assert status == 200
        assert result["success"] is True
        assert api.blob_delete.call_count == 2

    def test_propagates_exception(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.side_effect = RuntimeError("nope")
        result, status = _run(api.delete_skill("foo"))
        assert status == 500


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class _FakeRequest:
    def makefile(self, *a, **kw):
        return io.BytesIO()


def _make_handler(api, path, method="GET", body=b"", headers=None):
    """Construct a handler instance without going through socket setup."""
    handler_cls = api.handler
    h = handler_cls.__new__(handler_cls)
    h.path = path
    h.command = method
    h.rfile = io.BytesIO(body)
    h.wfile = io.BytesIO()
    h.headers = headers or {}
    if body:
        h.headers.setdefault("Content-Length", str(len(body)))
    # Stub send_response/send_header/end_headers — they normally write to
    # self.wfile via self.connection. We just track them.
    h._sent_status = None
    h._sent_headers = []

    def send_response(code, *a, **kw):
        h._sent_status = code

    def send_header(k, v):
        h._sent_headers.append((k, v))

    def end_headers():
        pass

    h.send_response = send_response
    h.send_header = send_header
    h.end_headers = end_headers
    return h


def _read_response(handler):
    """Decode JSON the handler wrote to wfile."""
    raw = handler.wfile.getvalue()
    return json.loads(raw.decode("utf-8")) if raw else None


class TestHandlerAuth:
    def test_no_token_configured_allows_all(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="")
        h = _make_handler(api, "/api/skills", method="POST")
        assert h._check_auth() is True

    def test_correct_bearer_token(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="secret")
        h = _make_handler(
            api,
            "/api/skills",
            method="POST",
            headers={"Authorization": "Bearer secret"},
        )
        assert h._check_auth() is True

    def test_wrong_bearer_token(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="secret")
        h = _make_handler(
            api,
            "/api/skills",
            method="POST",
            headers={"Authorization": "Bearer wrong"},
        )
        assert h._check_auth() is False

    def test_missing_auth_header(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="secret")
        h = _make_handler(api, "/api/skills", method="POST")
        assert h._check_auth() is False


class TestHandlerOptions:
    def test_options_returns_cors_headers(self, monkeypatch):
        api = _reload_api(monkeypatch, allowed_origin="https://example.com")
        h = _make_handler(api, "/api/skills", method="OPTIONS")
        h.do_OPTIONS()
        assert h._sent_status == 200
        header_dict = dict(h._sent_headers)
        assert header_dict["Access-Control-Allow-Origin"] == "https://example.com"
        assert "GET" in header_dict["Access-Control-Allow-Methods"]


class TestHandlerGet:
    def test_get_skills_list(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.return_value = {"blobs": []}
        h = _make_handler(api, "/api/skills")
        h.do_GET()
        assert h._sent_status == 200
        body = _read_response(h)
        assert body == {"skills": []}

    def test_get_individual_skill_not_found(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.head.return_value = None
        h = _make_handler(api, "/api/skills/missing")
        h.do_GET()
        assert h._sent_status == 404

    def test_get_unknown_path(self, monkeypatch):
        api = _reload_api(monkeypatch)
        h = _make_handler(api, "/api/nope")
        h.do_GET()
        assert h._sent_status == 404
        assert _read_response(h)["error"] == "Not found"


class TestHandlerPost:
    def test_unauthorized(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="secret")
        body = json.dumps({"name": "foo"}).encode()
        h = _make_handler(api, "/api/skills", method="POST", body=body)
        h.do_POST()
        assert h._sent_status == 401

    def test_create_via_post(self, monkeypatch):
        api = _reload_api(monkeypatch)
        body = json.dumps({"name": "Test", "description": "d"}).encode()
        h = _make_handler(api, "/api/skills", method="POST", body=body)
        h.do_POST()
        assert h._sent_status == 200
        assert _read_response(h)["name"] == "test"

    def test_reload(self, monkeypatch):
        api = _reload_api(monkeypatch)
        h = _make_handler(api, "/api/reload", method="POST")
        h.do_POST()
        assert h._sent_status == 200
        body = _read_response(h)
        assert body["success"] is True

    def test_unknown_post_path(self, monkeypatch):
        api = _reload_api(monkeypatch)
        h = _make_handler(api, "/api/nope", method="POST")
        h.do_POST()
        assert h._sent_status == 404

    def test_post_empty_body(self, monkeypatch):
        api = _reload_api(monkeypatch)
        h = _make_handler(api, "/api/skills", method="POST")
        h.headers["Content-Length"] = "0"
        h.do_POST()
        # No name → 400
        assert h._sent_status == 400


class TestHandlerPut:
    def test_unauthorized(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="secret")
        h = _make_handler(api, "/api/skills/foo", method="PUT")
        h.do_PUT()
        assert h._sent_status == 401

    def test_update_via_put(self, monkeypatch):
        api = _reload_api(monkeypatch)
        body = json.dumps({"description": "new"}).encode()
        h = _make_handler(api, "/api/skills/foo", method="PUT", body=body)
        h.do_PUT()
        assert h._sent_status == 200

    def test_unknown_put_path(self, monkeypatch):
        api = _reload_api(monkeypatch)
        h = _make_handler(api, "/api/nope", method="PUT")
        h.do_PUT()
        assert h._sent_status == 404


class TestHandlerDelete:
    def test_unauthorized(self, monkeypatch):
        api = _reload_api(monkeypatch, api_token="secret")
        h = _make_handler(api, "/api/skills/foo", method="DELETE")
        h.do_DELETE()
        assert h._sent_status == 401

    def test_delete_via_handler(self, monkeypatch):
        api = _reload_api(monkeypatch)
        api.blob_list.return_value = {
            "blobs": [{"url": "https://example.com/a"}]
        }
        h = _make_handler(api, "/api/skills/foo", method="DELETE")
        h.do_DELETE()
        assert h._sent_status == 200

    def test_delete_unknown_path(self, monkeypatch):
        api = _reload_api(monkeypatch)
        h = _make_handler(api, "/api/nope", method="DELETE")
        h.do_DELETE()
        assert h._sent_status == 404
