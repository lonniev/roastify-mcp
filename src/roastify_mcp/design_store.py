"""Per-patron design library — durable in the operator's Neon.

The browser courier shuttles a saved Roastify design JSON up here, keyed by the
patron's npub; the Design Bench edits it; the courier fetches it back to write
onto a product. This is the patron's own *library*, not a throwaway relay —
designs persist, list, and re-fetch.

Persistence reuses the operator's bootstrapped ``NeonVault`` via its HTTP SQL
helper (``_execute``) and schema-prefix helper (``_t``), exactly as the SDK's
own ``adoption_store`` does. The Neon HTTP API returns SELECT rows as a list of
column-keyed dicts and affected-row counts under the camelCase key ``rowCount``.

A saved design is ~2.3 MB, but 99 % of that is ONE inline base64 image, and a
patron's "small variations of one design" reuse the same image. So inline
``data:`` URIs are extracted into a content-addressed, chunked assets table
(dedup by sha256, chunks small enough to clear the HTTP-SQL payload ceiling) and
the design row keeps only a light skeleton with ``asset://<sha256>`` markers.
``get_design`` re-inlines them, so a caller always sees a complete design.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from typing import Any

DESIGNS = "roastify_designs"
ASSETS = "roastify_design_assets"

# Each inline image becomes one or more asset chunks. 400 KB of base64 per row
# keeps a single INSERT well under Neon's HTTP-SQL request ceiling even for a
# multi-megabyte PNG, which arrives as ~6 chunks.
_CHUNK = 400_000
_ASSET_REF = re.compile(r"asset://([0-9a-f]{64})")

_schema_ready = False


async def ensure_schema(vault: Any) -> None:
    """Create the library tables once per process (idempotent)."""
    global _schema_ready
    if _schema_ready:
        return
    await vault._execute(
        f"CREATE TABLE IF NOT EXISTS {vault._t(DESIGNS)} ("
        "  npub TEXT NOT NULL,"
        "  design_id TEXT NOT NULL,"
        "  label TEXT NOT NULL DEFAULT '',"
        "  product_id TEXT NOT NULL DEFAULT '',"
        "  source_title TEXT NOT NULL DEFAULT '',"
        "  skeleton TEXT NOT NULL,"
        "  bytes INTEGER NOT NULL DEFAULT 0,"
        "  created_at TIMESTAMPTZ DEFAULT now(),"
        "  updated_at TIMESTAMPTZ DEFAULT now(),"
        "  PRIMARY KEY (npub, design_id)"
        ")"
    )
    # Content-addressed and chunked. sha256 dedups a repeated image across a
    # patron's variants; (sha256, idx) orders the chunks for reassembly.
    await vault._execute(
        f"CREATE TABLE IF NOT EXISTS {vault._t(ASSETS)} ("
        "  sha256 TEXT NOT NULL,"
        "  idx INTEGER NOT NULL,"
        "  content TEXT NOT NULL,"
        "  PRIMARY KEY (sha256, idx)"
        ")"
    )
    _schema_ready = True


# ---------------------------------------------------------------------------
# asset externalization
# ---------------------------------------------------------------------------


def _externalize(design: Any) -> tuple[Any, dict[str, str]]:
    """Return (skeleton, {sha256: data_uri}) with every ``data:`` URI lifted out.

    The skeleton is a structural copy — the caller's object is never mutated —
    with each inline ``data:`` string replaced by an ``asset://<sha256>`` marker.
    """
    assets: dict[str, str] = {}

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and node.startswith("data:"):
            digest = hashlib.sha256(node.encode("utf-8")).hexdigest()
            assets[digest] = node
            return f"asset://{digest}"
        return node

    return walk(design), assets


def _inline(skeleton: Any, resolved: dict[str, str]) -> Any:
    """Reverse ``_externalize``: swap each ``asset://<sha256>`` back to its URI."""

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str):
            m = _ASSET_REF.fullmatch(node)
            if m:
                return resolved.get(m.group(1), node)
        return node

    return walk(skeleton)


async def _store_asset(vault: Any, digest: str, data_uri: str) -> None:
    """Chunk-store one asset, skipping the write entirely if already present."""
    existing = await vault._execute(
        f"SELECT 1 FROM {vault._t(ASSETS)} WHERE sha256 = $1 LIMIT 1", [digest]
    )
    if existing.get("rows"):
        return  # content-addressed: identical bytes are already stored
    for idx in range(0, len(data_uri), _CHUNK):
        await vault._execute(
            f"INSERT INTO {vault._t(ASSETS)} (sha256, idx, content) VALUES ($1, $2, $3) "
            "ON CONFLICT (sha256, idx) DO NOTHING",
            [digest, idx // _CHUNK, data_uri[idx : idx + _CHUNK]],
        )


async def _load_asset(vault: Any, digest: str) -> str | None:
    """Reassemble one asset's chunks in order, or None if absent."""
    result = await vault._execute(
        f"SELECT content FROM {vault._t(ASSETS)} WHERE sha256 = $1 ORDER BY idx", [digest]
    )
    rows = result.get("rows", [])
    if not rows:
        return None
    return "".join(r["content"] for r in rows)


# ---------------------------------------------------------------------------
# library operations
# ---------------------------------------------------------------------------


async def put_design(
    vault: Any,
    npub: str,
    design: dict[str, Any],
    *,
    design_id: str = "",
    label: str = "",
    product_id: str = "",
    source_title: str = "",
) -> dict[str, Any]:
    """Stash a design for ``npub``. Omit ``design_id`` to mint a new one.

    Returns the row's metadata (never the bytes). Idempotent on
    ``(npub, design_id)``: passing an existing id overwrites that slot.
    """
    await ensure_schema(vault)
    did = design_id or str(uuid.uuid4())
    skeleton, assets = _externalize(design)
    for digest, uri in assets.items():
        await _store_asset(vault, digest, uri)
    skeleton_json = json.dumps(skeleton, separators=(",", ":"))
    nbytes = len(json.dumps(design, separators=(",", ":")))
    await vault._execute(
        f"INSERT INTO {vault._t(DESIGNS)} "
        "(npub, design_id, label, product_id, source_title, skeleton, bytes, "
        " created_at, updated_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now()) "
        "ON CONFLICT (npub, design_id) DO UPDATE SET "
        "  label = EXCLUDED.label, product_id = EXCLUDED.product_id, "
        "  source_title = EXCLUDED.source_title, skeleton = EXCLUDED.skeleton, "
        "  bytes = EXCLUDED.bytes, updated_at = now()",
        [npub, did, label, product_id, source_title, skeleton_json, nbytes],
    )
    return {
        "design_id": did,
        "label": label,
        "product_id": product_id,
        "source_title": source_title,
        "bytes": nbytes,
        "assets": len(assets),
    }


async def get_skeleton(vault: Any, npub: str, design_id: str) -> dict[str, Any] | None:
    """Return the stored skeleton (text + ``asset://`` markers, images NOT inlined).

    Light — never loads the megabyte image chunks. This is what editing works on:
    the text layers live in the skeleton; the images are separate content-addressed
    assets that ``get_design`` re-inlines only when a full design is needed.
    """
    await ensure_schema(vault)
    result = await vault._execute(
        f"SELECT label, product_id, source_title, skeleton, bytes, updated_at "
        f"FROM {vault._t(DESIGNS)} WHERE npub = $1 AND design_id = $2",
        [npub, design_id],
    )
    rows = result.get("rows", [])
    if not rows:
        return None
    row = rows[0]
    return {
        "design_id": design_id,
        "label": row["label"],
        "product_id": row["product_id"],
        "source_title": row["source_title"],
        "bytes": row["bytes"],
        "updated_at": str(row["updated_at"]),
        "skeleton": json.loads(row["skeleton"]),
    }


async def get_design(vault: Any, npub: str, design_id: str) -> dict[str, Any] | None:
    """Fetch one design for ``npub``, fully re-inlined, or None if absent."""
    found = await get_skeleton(vault, npub, design_id)
    if found is None:
        return None
    skeleton = found["skeleton"]
    digests = set(_ASSET_REF.findall(json.dumps(skeleton)))
    resolved: dict[str, str] = {}
    for digest in digests:
        uri = await _load_asset(vault, digest)
        if uri is not None:
            resolved[digest] = uri
    return {
        "design_id": found["design_id"],
        "label": found["label"],
        "product_id": found["product_id"],
        "source_title": found["source_title"],
        "bytes": found["bytes"],
        "updated_at": found["updated_at"],
        "design": _inline(skeleton, resolved),
    }


# ---------------------------------------------------------------------------
# text-layer read / edit (pure) — the field surface for Claude-orchestrated edits
# ---------------------------------------------------------------------------


def text_layers(design: Any) -> list[dict[str, Any]]:
    """List every text layer as {id, text, fontFamily, fontWeight, face}.

    Each layer's own current text is its label — infer its role (title, quote,
    recipe…) from that; the design is the schema, nothing is hardcoded.
    """
    out: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("id"):
                out.append({
                    "id": node["id"],
                    "text": node.get("text", ""),
                    "fontFamily": node.get("fontFamily"),
                    "fontWeight": node.get("fontWeight"),
                    "face": node.get("faceId") or node.get("face"),
                })
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(design)
    return out


def apply_text_edits(design: Any, edits: dict[str, str]) -> int:
    """Set ``.text`` on each text layer whose id is a key in ``edits`` (mutates).

    Returns the number of layers changed. Fonts, geometry, and images are left
    exactly as they were — only the words change.
    """
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


async def list_designs(vault: Any, npub: str) -> list[dict[str, Any]]:
    """List ``npub``'s stashed designs — metadata only, newest first."""
    await ensure_schema(vault)
    result = await vault._execute(
        f"SELECT design_id, label, product_id, source_title, bytes, updated_at "
        f"FROM {vault._t(DESIGNS)} WHERE npub = $1 ORDER BY updated_at DESC",
        [npub],
    )
    return [
        {
            "design_id": r["design_id"],
            "label": r["label"],
            "product_id": r["product_id"],
            "source_title": r["source_title"],
            "bytes": r["bytes"],
            "updated_at": str(r["updated_at"]),
        }
        for r in result.get("rows", [])
    ]


async def delete_design(vault: Any, npub: str, design_id: str) -> bool:
    """Delete one design row for ``npub``. Returns whether a row was removed.

    Content-addressed assets are left in place: they are immutable, may be
    shared by the patron's other variants, and orphans are harmless (dedup
    keeps their volume low). A dedicated sweep can reclaim them later.
    """
    await ensure_schema(vault)
    result = await vault._execute(
        f"DELETE FROM {vault._t(DESIGNS)} WHERE npub = $1 AND design_id = $2",
        [npub, design_id],
    )
    return int(result.get("rowCount") or 0) > 0
