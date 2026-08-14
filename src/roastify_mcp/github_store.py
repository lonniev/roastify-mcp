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

import asyncio
import base64
import contextlib
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
    origin is its top-left; ``sheet_size`` gives the extent). ``width`` is the fixed
    wrap FRAME — text wraps within it and it does not change as copy changes —
    while ``height`` is the grown extent, a function of line count: edit the text
    and height re-measures, width holds. ``chars`` is the current length, the anchor
    to write near.
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


# ---------------------------------------------------------------------------
# element creation — build, place, and validate a new text element (Phase 3)
# ---------------------------------------------------------------------------


def find_element(design: Any, element_id: str) -> dict[str, Any] | None:
    """Return the element with ``element_id`` (text or not), or None."""
    found: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("id") == element_id and node.get("type"):
                found.append(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return found[0] if found else None


def _bounded_elements(design: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") and node.get("id") is not None and all(
                isinstance(node.get(k), (int, float)) for k in ("x", "y", "width", "height")
            ):
                out.append(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return out


def _line_count(text: str, font_size: float, width: float) -> int:
    """Estimate how many wrapped lines ``text`` occupies in a ``width`` frame."""
    per_line = max(1, int(width / max(1.0, font_size * 0.5)))
    lines = 0
    for para in str(text or "").split("\n"):
        lines += max(1, -(-len(para) // per_line))  # ceil division
    return max(1, lines)


def estimate_text_height(text: str, font_size: float, width: float) -> int:
    """Predict a text box's height from its content, font size, and wrap width.

    Uses the ratio the read payload reflects (~1.21·fontSize per line) and a
    rough half-em average character width to estimate wrap. Approximate — the
    Designer re-measures exactly on open — but good enough to validate placement.
    """
    return round(_line_count(text, font_size, width) * font_size * 1.21)


def reflowed_height(old_height: Any,
                    old: tuple[str, float, float],
                    new: tuple[str, float, float]) -> float:
    """Re-measure a text box's height after its text, font size, or wrap width
    changed — anchored on the renderer's exact prior height.

    On a text layer ``width`` is the fixed wrap FRAME and ``height`` is the grown
    extent. The line estimator is only roughly right in absolute terms (the
    Designer re-measures exactly on open), so rather than overwrite an exact bound
    with an approximation, this scales the prior height by the estimator's RELATIVE
    change. When the modeled line metrics are unchanged the exact height is kept
    verbatim — an edit that doesn't cross a wrap boundary reports no spurious drift.

    ``old``/``new`` are each ``(text, font_size, width)``.
    """
    eo = estimate_text_height(*old)
    en = estimate_text_height(*new)
    if not isinstance(old_height, (int, float)) or old_height <= 0 or eo <= 0:
        return en
    if en == eo:
        return old_height
    return round(old_height * en / eo)


def build_text_element(design: Any, *, text: str, style_from: str,
                       x: float, y: float, width: float, new_id: str,
                       ) -> tuple[dict[str, Any] | None, str]:
    """Build a new text element inheriting typography from ``style_from``.

    Copies font family/weight/size/style/fill/alignment/leading from the named
    layer so the new element is consistent with the template by construction.
    Returns (element, "") or (None, error).
    """
    src = find_element(design, style_from)
    if src is None:
        return None, f"style_from layer '{style_from}' not found"
    if src.get("type") != "text":
        return None, f"style_from layer '{style_from}' is a {src.get('type')}, not text"
    font_size = src.get("fontSize", 24)
    el = {
        "type": "text", "id": new_id, "text": text,
        "x": round(x), "y": round(y), "width": round(width),
        "height": estimate_text_height(text, font_size, width),
        "fontFamily": src.get("fontFamily"), "fontWeight": src.get("fontWeight", "normal"),
        "fontSize": font_size, "fontStyle": src.get("fontStyle", "normal"),
        "fill": src.get("fill", "rgba(0,0,0,1)"), "align": src.get("align", "left"),
        "lineHeight": src.get("lineHeight", 1.2), "letterSpacing": src.get("letterSpacing", 0),
        "rotation": src.get("rotation", 0), "faceId": src.get("faceId", "sheet"),
    }
    return el, ""


def first_collision(el: dict[str, Any], design: Any) -> str | None:
    """The id of the first content element ``el`` overlaps (AABB), or None.

    Full-bleed background art (an element covering most of the sheet) is skipped —
    you always place text over the background; the collision that matters is with
    other text and the small graphics (rules, a roast scale) it must not cover.
    """
    sheet = design.get("sheet") if isinstance(design, dict) else None
    sw = (sheet or {}).get("width") or 1
    sh = (sheet or {}).get("height") or 1
    sheet_area = sw * sh
    ax, ay, aw, ah = el["x"], el["y"], el["width"], el["height"]
    for other in _bounded_elements(design):
        if other.get("id") == el.get("id"):
            continue
        bx, by, bw, bh = other["x"], other["y"], other["width"], other["height"]
        if bw * bh > 0.6 * sheet_area:  # background art — not a collision
            continue
        if ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by:
            return str(other.get("id"))
    return None


def apply_text_edits(design: Any, edits: dict[str, str]) -> int:
    """Set ``.text`` on each text layer whose id is a key in ``edits`` (mutates).

    Also re-measures the layer's ``height`` for the new copy so the stored bounds
    describe the design that now exists (``width`` is the fixed wrap frame and is
    left untouched). Returns the number of layers changed.
    """
    changed = 0

    def walk(node: Any) -> None:
        nonlocal changed
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("id") in edits:
                old_text = node.get("text", "")
                new_text = edits[node["id"]]
                node["text"] = new_text
                fs, w = node.get("fontSize"), node.get("width")
                if isinstance(fs, (int, float)) and isinstance(w, (int, float)):
                    node["height"] = reflowed_height(
                        node.get("height"), (old_text, fs, w), (new_text, fs, w))
                changed += 1
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return changed


def _translate(el: dict[str, Any], dx: float, dy: float) -> None:
    """Shift an element by (dx, dy), INCLUDING a line's absolute endpoints.

    A ``line`` shape carries its geometry in absolute ``x1/y1/x2/y2`` (and sometimes
    a flat ``points`` list), NOT in x/y — x/y is only its bounding box. Moving x/y
    alone leaves the drawn line behind, so the endpoints must travel with it.
    """
    el["x"] = float(el.get("x", 0) or 0) + dx
    el["y"] = float(el.get("y", 0) or 0) + dy
    for k in ("x1", "x2"):
        if isinstance(el.get(k), (int, float)):
            el[k] = float(el[k]) + dx
    for k in ("y1", "y2"):
        if isinstance(el.get(k), (int, float)):
            el[k] = float(el[k]) + dy
    pts = el.get("points")
    if isinstance(pts, list) and pts and all(isinstance(p, (int, float)) for p in pts):
        el["points"] = [float(p) + (dx if i % 2 == 0 else dy) for i, p in enumerate(pts)]


def edit_geometry(design: Any, edits: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """Move and/or resize elements in place. Returns (changed, missing_ids).

    Each edit is one of two shapes:
      - group shift:  {"ids": [id, ...], "dx": N, "dy": M} — add the delta to every
        named element's x/y, moving them together as one rigid object. This is the
        "lock the layers and shift them" the Designer can't do.
      - absolute set: {"id": id, "x": ?, "y": ?, "width": ?, "height": ?, "fontSize": ?}
        — set only the keys present (e.g. re-centre and resize a panel rectangle).

    Element kind decides what the size keys mean. On a RECTANGLE/line/image, ``width``
    and ``height`` are the frame and are written directly. On a TEXT layer, ``width``
    is the wrap frame and ``fontSize`` the type size — both settable — while ``height``
    is DERIVED (re-measured from the reflowed text); a ``height`` passed for a text
    layer is ignored. Line endpoints (x1/y1/x2/y2, points) travel with any x/y move —
    a bare x/y shift would leave the drawn line at its old spot. An unknown id is
    collected in ``missing`` rather than raising. Only numeric fields are written.
    """
    changed = 0
    missing: list[str] = []
    for edit in edits or []:
        if edit.get("ids") is not None:
            dx, dy = float(edit.get("dx", 0) or 0), float(edit.get("dy", 0) or 0)
            for eid in edit["ids"]:
                el = find_element(design, str(eid))
                if el is None:
                    missing.append(str(eid))
                    continue
                _translate(el, dx, dy)
                changed += 1
        elif edit.get("id") is not None:
            el = find_element(design, str(edit["id"]))
            if el is None:
                missing.append(str(edit["id"]))
                continue
            # Move by the implied delta first so any line endpoints follow, then
            # apply the size keys directly.
            ndx = float(edit["x"]) - float(el.get("x", 0) or 0) if isinstance(edit.get("x"), (int, float)) else 0.0
            ndy = float(edit["y"]) - float(el.get("y", 0) or 0) if isinstance(edit.get("y"), (int, float)) else 0.0
            if ndx or ndy:
                _translate(el, ndx, ndy)
            if el.get("type") == "text":
                # width is the wrap frame, fontSize the type size; height is derived.
                old = (el.get("text", ""), el.get("fontSize") or 0, el.get("width") or 0)
                for key in ("width", "fontSize"):
                    if isinstance(edit.get(key), (int, float)):
                        el[key] = float(edit[key])
                new = (el.get("text", ""), el.get("fontSize") or 0, el.get("width") or 0)
                if all(old[1:]) and all(new[1:]):
                    el["height"] = reflowed_height(el.get("height"), old, new)
            else:
                for key in ("width", "height"):
                    if isinstance(edit.get(key), (int, float)):
                        el[key] = float(edit[key])
            changed += 1
    return changed, missing


# ---------------------------------------------------------------------------
# font repair — undo Roastify's lossy schema migration on the way in
# ---------------------------------------------------------------------------

_WEIGHT_NAMES = {"bold": 700, "bolder": 700, "normal": 400, "regular": 400, "lighter": 300}


def _weight_num(v: Any) -> int:
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v or "").strip().lower()
    if s in _WEIGHT_NAMES:
        return _WEIGHT_NAMES[s]
    try:
        return int(s)
    except ValueError:
        return 400


def used_fonts(design: Any) -> dict[str, set[int]]:
    """Map each fontFamily the text uses to the set of weights it needs."""
    used: dict[str, set[int]] = {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("fontFamily"):
                used.setdefault(node["fontFamily"], set()).add(_weight_num(node.get("fontWeight")))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return used


def _css2(family: str, weights: list[int] | None) -> str:
    fam = family.replace(" ", "+")
    if weights:
        return f"https://fonts.googleapis.com/css2?family={fam}:wght@{';'.join(map(str, weights))}&display=swap"
    return f"https://fonts.googleapis.com/css2?family={fam}&display=swap"


async def _resolvable_url(client: httpx.AsyncClient, family: str, weights: list[int]) -> str:
    """A css2 URL that actually loads: the ``:wght@`` form if Google keeps the
    family, else the plain family (which always resolves; a missing weight then
    faux-bolds instead of 404-ing the whole batch)."""
    w = sorted(set(weights))
    if w == [400]:
        return _css2(family, None)
    with contextlib.suppress(Exception):
        r = await client.get(_css2(family, w), timeout=8)
        if r.status_code == 200 and family.lower() in r.text.lower():
            return _css2(family, w)
    return _css2(family, None)


async def repair_fonts(design: dict[str, Any]) -> list[dict[str, Any]]:
    """Rebuild ``design['fonts']`` from the families the text actually uses.

    Roastify's own schema migration leaves a lossy ``fonts[]`` — a dropped family,
    a weight a font does not ship — so the migrated design renders fallback fonts in
    Edit Design. This rebuilds the list from scratch, keyed ``family`` (the shape
    Roastify's saved designs use) with css2 URLs validated against Google Fonts, so
    every family the text references actually loads.

    Non-destructive: only the ``fonts[]`` load list changes; the text and each
    layer's fontFamily/fontWeight are untouched, so the intended fonts are preserved.
    Mutates ``design`` and returns the new fonts list.
    """
    used = used_fonts(design)
    if not used:
        return design.get("fonts", [])
    fonts: list[dict[str, Any]] = []
    async with httpx.AsyncClient() as client:
        for family in used:
            weights = sorted(used[family])
            url = await _resolvable_url(client, family, weights)
            fonts.append({"family": family, "weights": weights, "url": url})
    design["fonts"] = fonts
    return fonts


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
        if not data:
            return None
        if data.get("encoding") == "base64" and data.get("content"):
            return base64.b64decode(data["content"])
        # The Contents API returns EMPTY content for files over ~1 MB (a design's
        # background image is bigger than that), so fetch the git blob by sha — the
        # Blobs API serves base64 up to 100 MB. Without this the artwork comes back
        # as an empty data: URI and the applied design loses its background.
        sha = data.get("sha")
        if not sha:
            return None
        blob = await self._req(client, "GET", f"/repos/{self.owner}/{self.repo}/git/blobs/{sha}")
        if blob and blob.get("encoding") == "base64" and blob.get("content") is not None:
            return base64.b64decode(blob["content"])
        return None

    async def _list_dir(self, client: httpx.AsyncClient, path: str) -> list[dict[str, Any]]:
        data = await self._req(client, "GET", f"/repos/{self.owner}/{self.repo}/contents/{path}"
                               f"?ref={self.branch}", allow_404=True)
        return data if isinstance(data, list) else []

    async def _latest_commit(self, client: httpx.AsyncClient,
                             path: str) -> dict[str, str] | None:
        """The newest commit that touched ``path`` — its sha and GitHub URL, or None.

        Every save is a commit, so a design's latest commit is the handle a merchant
        uses to correlate the chooser against the repo (and the derivation chain is
        the folder's commit history, which supersedes the old from_design_id pointer).
        Best-effort: a lookup failure just omits the sha, never fails the listing.
        """
        try:
            commits = await self._req(
                client, "GET",
                f"/repos/{self.owner}/{self.repo}/commits"
                f"?sha={self.branch}&path={path}&per_page=1",
            )
        except GitHubError:
            return None
        if isinstance(commits, list) and commits:
            c = commits[0]
            return {"sha": str(c.get("sha", "")), "url": str(c.get("html_url", ""))}
        return None

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
                         product_id: str = "", source_title: str = "",
                         repair: bool = False) -> dict[str, Any]:
        # The store is configuration management: a design's identity is the slug of
        # its label, so re-stashing or editing the same design commits a new version
        # of the SAME folder rather than spawning a `<slug>-<hash>` sibling. Two
        # genuinely different designs simply need different labels.
        did = design_id or _slug(label or source_title) or uuid.uuid4().hex[:12]
        # Repair the lossy fonts[] Roastify's schema migration leaves behind, so
        # the stored design renders in its intended fonts (idempotent for a design
        # that is already correct).
        repaired = await repair_fonts(design) if repair else None
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
                "source_title": source_title, "assets": len(assets),
                "fonts_repaired": [f["family"] for f in repaired] if repaired is not None else None}

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
            names = [e["name"] for e in entries if e.get("type") == "dir"]

            async def row(name: str) -> dict[str, Any]:
                # meta and the latest-commit lookup are independent — run them
                # together so the listing does not serialize two round-trips per
                # design (the fetch is already the chooser's slowest moment).
                meta_raw, commit = await asyncio.gather(
                    self._get_file(client, f"designs/{name}/meta.json"),
                    self._latest_commit(client, f"designs/{name}/meta.json"),
                )
                meta = json.loads(meta_raw) if meta_raw else {}
                r: dict[str, Any] = {
                    "design_id": name, "label": meta.get("label", ""),
                    "product_id": meta.get("product_id", ""),
                    "source_title": meta.get("source_title", ""),
                    "updated_at": meta.get("updated_at", ""),
                    "path": f"designs/{name}/",
                }
                if commit and commit["sha"]:
                    r["sha"] = commit["sha"]
                    r["short_sha"] = commit["sha"][:7]
                    r["commit_url"] = commit["url"]
                return r

            out = list(await asyncio.gather(*(row(n) for n in names)))
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
