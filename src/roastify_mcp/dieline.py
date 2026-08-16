"""Panel geometry recovered from Roastify dielines.

A saved design carries no panel identity — every element's ``faceId`` is the
constant ``"sheet"`` — and no panel rectangles. But the catalog dieline for a
``productType`` carries a ``SIDE_LABELS`` guide group whose per-panel text labels
(FRONT, BACK, LEFT, RIGHT, TOP FLAP) are sized and positioned to the panels, so
the panel columns are recoverable from it. We fetch the (public) dieline once and
read those labels; ``face_of`` then assigns a panel to an element by which body
column its x-centre falls in.

There is no safe-area data in the dieline (``bleed`` is 0), so callers apply a
conservative default margin rather than claiming a real safe area.
"""

from __future__ import annotations

from typing import Any

import httpx

# productType -> public dieline template URL (from browse_catalog; stable per
# product). Add rows as new box types come into use.
DIELINE_URLS: dict[str, str] = {
    "CoffeeBox12oz": "https://d13jwb0zul8vwm.cloudfront.net/templates/baseTemplate_box12oz.json",
}

# The four wrap panels laid out as x-columns. Flaps (top/bottom) overlap a body
# column in x, so face assignment considers only these.
BODY_PANELS = ("back", "left", "front", "right")

_cache: dict[str, dict[str, dict[str, int]]] = {}


def parse_panels(dieline: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Extract panel columns from a dieline's SIDE_LABELS group.

    Each label's x + width is the panel's column; y spans the full sheet (the
    labels don't bound the body band, and full-height is the safe over-estimate
    for containment). Returns {panel_name: {x, y, width, height}}.
    """
    pages = dieline.get("pages") or [{}]
    page = pages[0] if pages else {}
    # The page height is often the string "auto"; the numeric extent is the root's.
    sheet_h = dieline.get("height") or page.get("height") or 0
    if not isinstance(sheet_h, (int, float)):
        sheet_h = 0
    panels: dict[str, dict[str, int]] = {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "group" and node.get("name") == "SIDE_LABELS":
                for c in node.get("children", []):
                    if c.get("type") == "text" and c.get("text") and c.get("width"):
                        name = str(c["text"]).strip().split()[0].lower()  # "TOP FLAP" -> "top"
                        panels[name] = {
                            "x": round(c.get("x", 0)), "y": 0,
                            "width": round(c["width"]), "height": round(sheet_h),
                        }
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(dieline)
    return panels


async def panels_for(product_type: str) -> dict[str, dict[str, int]]:
    """Panel columns for a productType, or {} if unknown or unfetchable. Cached."""
    if product_type in _cache:
        return _cache[product_type]
    url = DIELINE_URLS.get(product_type)
    if not url:
        return {}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, timeout=10)
            r.raise_for_status()
            panels = parse_panels(r.json())
    except Exception:  # noqa: BLE001
        return {}
    _cache[product_type] = panels
    return panels


def face_of(x_centre: float, panels: dict[str, dict[str, int]]) -> str | None:
    """Which body-panel column contains ``x_centre``, or None."""
    for name in BODY_PANELS:
        p = panels.get(name)
        if p and p["x"] <= x_centre < p["x"] + p["width"]:
            return name
    return None


def sheet_panel(sheet: dict[str, Any] | None) -> dict[str, int] | None:
    """Whole-sheet placement box from ``sheet`` bounds, or None if unusable.

    Used when a product has no discrete panels (e.g. Tubes — a continuous wrap
    whose dieline carries no SIDE_LABELS columns). The sheet is the coordinate
    space every element already lives in.
    """
    s = sheet if isinstance(sheet, dict) else {}
    sw, sh = s.get("width"), s.get("height")
    if not (isinstance(sw, (int, float)) and isinstance(sh, (int, float)) and sw > 0 and sh > 0):
        return None
    return {"x": 0, "y": 0, "width": int(sw), "height": int(sh)}


def resolve_placement_panel(
    face: str,
    panels: dict[str, dict[str, int]],
    sheet: dict[str, Any] | None = None,
) -> tuple[dict[str, int] | None, str]:
    """Resolve the containment box for ``add_design_element``.

    Multi-panel products (boxes): ``face`` must name a key in ``panels``.
    Single-face products (Tubes and any type with no dieline columns): ``panels``
    is empty — accept any face value and fall back to the design's sheet bounds.
    Returns ``(panel, "")`` on success or ``(None, error)``.
    """
    if panels:
        panel = panels.get(face.lower())
        if not panel:
            return None, f"unknown panel '{face}'; panels are {sorted(panels)}"
        return panel, ""
    panel = sheet_panel(sheet)
    if panel is None:
        return None, (
            f"unknown panel '{face}'; panels are unavailable and design has no sheet bounds"
        )
    return panel, ""
