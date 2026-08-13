"""Per-patron design library — backed by the patron's own GitHub repo.

The MCP is the broker: it holds a fine-grained GitHub token (vaulted per npub,
like the Roastify key) and commits/reads designs on the patron's behalf. The
courier and the MCP tool surface are unchanged — only the backing store moved
from the operator's Neon to a repo the patron owns.

Why a repo: git is content-addressed, so a design's heavy artwork is de-duplicated
across variants for free; every save is a commit, so there is real version history
and rollback; the patron owns the store and can browse, edit, and delete in
GitHub's own UI; and a design becomes a readable folder rather than a 2.3 MB row.

Repo layout, one folder per design::

    designs/<design_id>/design.json    the Roastify design; large inline images
                                       lifted out to asset:// markers, small SVGs
                                       kept inline so the JSON stays diffable
    designs/<design_id>/content.json   the editable text layers, projected out for
                                       humans and agents to read at a glance
    designs/<design_id>/meta.json      label, product_id, source_title, updated_at
    assets/<sha12>.<ext>               the externalized images, content-addressed
                                       and shared across designs (git de-dups them)

Writes are single atomic commits via the Git Data API (blobs → tree → commit →
ref); reads use the Contents API. ``get_design`` re-inlines the assets so a caller
always receives a complete, pushable design.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

API = "https://api.github.com"
# Lift a data: URI out to a file only when it is large; small SVGs stay inline so
# design.json remains readable and diffable.
_EXTERNALIZE_OVER = 50_000
_ASSET_REF = re.compile(r"asset://([0-9a-zA-Z._-]+)")
_MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
}
_EXT_MIME = {v: k for k, v in _MIME_EXT.items()}
_DATA_URI = re.compile(r"^data:([^;]+);base64,(.*)$", re.DOTALL)


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:48] or "design"


# ---------------------------------------------------------------------------
# pure format helpers — text layers and image externalization
# ---------------------------------------------------------------------------


def text_layers(design: Any) -> list[dict[str, Any]]:
    """List every text layer with its content, font, and box geometry.

    Each layer's own current text is its label; geometry lets an editor judge fit
    and placement: ``x``/``y`` are the top-left corner in design units (the sheet
    origin is its top-left; ``sheet_size`` gives the extent), and ``width``/``height``
    are the MEASURED text bounds — text does not clip, it grows, so the footprint
    is a function of line count and longest line, not a fixed frame. ``chars`` is
    the current length, the anchor to write near.
    """
    out: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("id"):
                text = node.get("text", "")
                out.append({
                    "id": node["id"], "text": text, "chars": len(text),
                    "fontFamily": node.get("fontFamily"), "fontWeight": node.get("fontWeight"),
                    "fontSize": node.get("fontSize"),
                    "x": node.get("x"), "y": node.get("y"),
                    "width": node.get("width"), "height": node.get("height"),
                    "rotation": node.get("rotation"),
                    "face": node.get("faceId") or node.get("face"),
                })
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return out


def non_text_elements(design: Any) -> list[dict[str, Any]]:
    """List the NON-text elements (images, shapes, rules) read-only.

    An agent must know these exist so it neither reports a header's value as
    missing when the value is a graphic (e.g. a five-dot roast scale under a
    ROAST header), nor places text on top of background art. Each entry carries
    id, type, name, and bounds (x/y/width/height). Roastify's migrated format
    carries no visibility flag, so none is reported.
    """
    out: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            t = node.get("type")
            if t and t != "text" and node.get("id") is not None and "width" in node:
                out.append({
                    "id": node["id"], "type": t, "name": node.get("name"),
                    "x": node.get("x"), "y": node.get("y"),
                    "width": node.get("width"), "height": node.get("height"),
                })
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return out


def sheet_size(design: Any) -> dict[str, Any]:
    """The overall design sheet extent — the coordinate space x/y live in."""
    s = design.get("sheet") if isinstance(design, dict) else None
    s = s if isinstance(s, dict) else {}
    return {"width": s.get("width"), "height": s.get("height")}


def apply_text_edits(design: Any, edits: dict[str, str]) -> int:
    """Set ``.text`` on each text layer whose id is a key in ``edits`` (mutates)."""
    changed = 0

    def walk(node: Any) -> None:
        nonlocal changed
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("id") in edits:
                node["text"] = edits[node["id"]]
                changed += 1
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return changed


def externalize(design: Any) -> tuple[Any, dict[str, bytes]]:
    """Return (skeleton, {filename: bytes}) with large inline images lifted to files.

    Each large ``data:`` URI becomes an ``asset://<sha12>.<ext>`` marker and a
    binary blob keyed by that filename; small ones stay inline. The caller's
    object is not mutated.
    """
    assets: dict[str, bytes] = {}

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and node.startswith("data:") and len(node) > _EXTERNALIZE_OVER:
            m = _DATA_URI.match(node)
            if not m:
                return node
            mime, b64 = m.group(1), m.group(2)
            raw = base64.b64decode(b64)
            sha = hashlib.sha256(raw).hexdigest()[:12]
            name = f"{sha}.{_MIME_EXT.get(mime, 'bin')}"
            assets[name] = raw
            return f"asset://{name}"
        return node

    return walk(design), assets


def inline(skeleton: Any, blobs: dict[str, bytes]) -> Any:
    """Reverse ``externalize``: swap each ``asset://<file>`` back to a data: URI.

    The re-encoded base64 may differ byte-for-byte from the original string, but
    it decodes to the identical image — which is all Roastify's Designer needs.
    """

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str):
            m = _ASSET_REF.fullmatch(node)
            if m:
                name = m.group(1)
                raw = blobs.get(name)
                if raw is not None:
                    ext = name.rsplit(".", 1)[-1]
                    mime = _EXT_MIME.get(ext, "application/octet-stream")
                    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
        return node

    return walk(skeleton)


# ---------------------------------------------------------------------------
# GitHub-backed store
# ---------------------------------------------------------------------------


class GitHubError(Exception):
    """A GitHub API failure named for the tool layer."""

    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


class GitHubStore:
    """Thin async client over one patron repo, with the design operations on top."""

    def __init__(self, token: str, owner: str, repo: str, branch: str = "main") -> None:
        self.owner, self.repo, self.branch = owner, repo, branch
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    @classmethod
    def from_spec(cls, token: str, repo_spec: str, branch: str = "") -> GitHubStore:
        """Build from a ``owner/repo`` spec (URL forms are tolerated)."""
        spec = repo_spec.strip().removeprefix("https://github.com/").removesuffix(".git").strip("/")
        if "/" not in spec:
            raise GitHubError(f"github_repo must be 'owner/repo', got '{repo_spec}'")
        owner, repo = spec.split("/", 1)
        return cls(token, owner, repo, branch or "main")

    async def _req(self, client: httpx.AsyncClient, method: str, path: str,
                   json_body: Any = None, allow_404: bool = False) -> Any:
        r = await client.request(method, f"{API}{path}", headers=self._headers, json=json_body)
        if r.status_code == 404 and allow_404:
            return None
        if r.status_code >= 400:
            detail = ""
            try:
                detail = r.json().get("message", "")
            except Exception:  # noqa: BLE001
                detail = r.text[:120]
            raise GitHubError(f"GitHub {method} {path} -> {r.status_code}: {detail}", r.status_code)
        return r.json() if r.content else None

    # -- reads ---------------------------------------------------------------

    async def _get_file(self, client: httpx.AsyncClient, path: str) -> bytes | None:
        data = await self._req(client, "GET", f"/repos/{self.owner}/{self.repo}/contents/{path}"
                               f"?ref={self.branch}", allow_404=True)
        if not data or "content" not in data:
            return None
        return base64.b64decode(data["content"])

    async def _list_dir(self, client: httpx.AsyncClient, path: str) -> list[dict[str, Any]]:
        data = await self._req(client, "GET", f"/repos/{self.owner}/{self.repo}/contents/{path}"
                               f"?ref={self.branch}", allow_404=True)
        return data if isinstance(data, list) else []

    # -- atomic write (Git Data API): blobs -> tree -> commit -> ref ---------

    async def _commit(self, client: httpx.AsyncClient, message: str,
                      writes: dict[str, bytes], deletes: list[str]) -> str:
        base = f"/repos/{self.owner}/{self.repo}/git"
        ref = await self._req(client, "GET", f"{base}/ref/heads/{self.branch}", allow_404=True)
        if ref is None:
            raise GitHubError(
                f"branch '{self.branch}' not found in {self.owner}/{self.repo} — "
                "create the repo with at least one commit (a README) first.", 404)
        head_sha = ref["object"]["sha"]
        head_commit = await self._req(client, "GET", f"{base}/commits/{head_sha}")
        base_tree = head_commit["tree"]["sha"]

        tree: list[dict[str, Any]] = []
        for path, raw in writes.items():
            blob = await self._req(client, "POST", f"{base}/blobs",
                                   {"content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"})
            tree.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        for path in deletes:
            tree.append({"path": path, "mode": "100644", "type": "blob", "sha": None})

        new_tree = await self._req(client, "POST", f"{base}/trees", {"base_tree": base_tree, "tree": tree})
        commit = await self._req(client, "POST", f"{base}/commits",
                                 {"message": message, "tree": new_tree["sha"], "parents": [head_sha]})
        await self._req(client, "PATCH", f"{base}/refs/heads/{self.branch}", {"sha": commit["sha"]})
        return commit["sha"]

    # -- design operations ---------------------------------------------------

    async def put_design(self, design: dict[str, Any], *, design_id: str = "", label: str = "",
                         product_id: str = "", source_title: str = "") -> dict[str, Any]:
        did = design_id or f"{_slug(label or source_title)}-{uuid.uuid4().hex[:6]}"
        skeleton, assets = externalize(design)
        meta = {
            "design_id": did, "label": label, "product_id": product_id,
            "source_title": source_title, "updated_at": datetime.now(UTC).isoformat(),
        }
        writes: dict[str, bytes] = {
            f"designs/{did}/design.json": json.dumps(skeleton, indent=1).encode(),
            f"designs/{did}/content.json": json.dumps(text_layers(skeleton), indent=1).encode(),
            f"designs/{did}/meta.json": json.dumps(meta, indent=1).encode(),
        }
        async with httpx.AsyncClient(timeout=60) as client:
            # Only upload an asset the repo does not already hold (git would de-dup
            # the blob anyway, but this saves re-sending megabytes every save).
            for name, raw in assets.items():
                if await self._get_file(client, f"assets/{name}") is None:
                    writes[f"assets/{name}"] = raw
            await self._commit(client, f"design: save {label or did}", writes, [])
        return {"design_id": did, "label": label, "product_id": product_id,
                "source_title": source_title, "assets": len(assets)}

    async def get_skeleton(self, design_id: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=60) as client:
            raw = await self._get_file(client, f"designs/{design_id}/design.json")
            if raw is None:
                return None
            meta_raw = await self._get_file(client, f"designs/{design_id}/meta.json")
        meta = json.loads(meta_raw) if meta_raw else {}
        return {
            "design_id": design_id, "label": meta.get("label", ""),
            "product_id": meta.get("product_id", ""), "source_title": meta.get("source_title", ""),
            "updated_at": meta.get("updated_at", ""), "skeleton": json.loads(raw),
        }

    async def get_design(self, design_id: str) -> dict[str, Any] | None:
        found = await self.get_skeleton(design_id)
        if found is None:
            return None
        skeleton = found["skeleton"]
        names = set(_ASSET_REF.findall(json.dumps(skeleton)))
        blobs: dict[str, bytes] = {}
        async with httpx.AsyncClient(timeout=60) as client:
            for name in names:
                raw = await self._get_file(client, f"assets/{name}")
                if raw is not None:
                    blobs[name] = raw
        return {**{k: found[k] for k in ("design_id", "label", "product_id", "source_title", "updated_at")},
                "design": inline(skeleton, blobs)}

    async def list_designs(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=60) as client:
            entries = await self._list_dir(client, "designs")
            out: list[dict[str, Any]] = []
            for e in entries:
                if e.get("type") != "dir":
                    continue
                meta_raw = await self._get_file(client, f"designs/{e['name']}/meta.json")
                meta = json.loads(meta_raw) if meta_raw else {}
                out.append({
                    "design_id": e["name"], "label": meta.get("label", ""),
                    "product_id": meta.get("product_id", ""), "source_title": meta.get("source_title", ""),
                    "updated_at": meta.get("updated_at", ""),
                })
        out.sort(key=lambda d: d.get("updated_at", ""), reverse=True)
        return out

    async def delete_design(self, design_id: str) -> bool:
        async with httpx.AsyncClient(timeout=60) as client:
            files = await self._list_dir(client, f"designs/{design_id}")
            paths = [f["path"] for f in files if f.get("type") == "file"]
            if not paths:
                return False
            # Only the design folder is removed; assets/ are shared and left in
            # place (harmless, and history keeps them anyway).
            await self._commit(client, f"design: delete {design_id}", {}, paths)
        return True
