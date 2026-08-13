"""Unit tests for panel geometry recovered from a dieline's SIDE_LABELS group."""

from __future__ import annotations

from roastify_mcp import dieline

# A box12-shaped dieline: the SIDE_LABELS group carries per-panel labels sized to
# the panels, laid out left-to-right across a 3900-wide sheet.
FAKE = {
    "width": 3900, "height": 5700,
    "pages": [{"height": 5700, "children": [
        {"type": "image", "x": 0, "y": 0, "width": 3900, "height": 5700},
        {"type": "group", "name": "SIDE_LABELS", "children": [
            {"type": "text", "text": "FRONT", "x": 1987, "y": 3281, "width": 1044},
            {"type": "text", "text": "RIGHT", "x": 3029, "y": 3281, "width": 826},
            {"type": "text", "text": "LEFT", "x": 1170, "y": 3281, "width": 817},
            {"type": "text", "text": "BACK", "x": 125, "y": 3281, "width": 1045},
            {"type": "text", "text": "TOP FLAP", "x": 3037, "y": 1223, "width": 1045},
        ]},
    ]}],
}


def test_parse_panels_reads_columns_from_labels():
    p = dieline.parse_panels(FAKE)
    assert set(p) >= {"front", "right", "left", "back", "top"}
    assert p["right"] == {"x": 3029, "y": 0, "width": 826, "height": 5700}
    assert p["back"]["x"] == 125 and p["back"]["width"] == 1045


def test_parse_panels_empty_when_no_side_labels():
    assert dieline.parse_panels({"pages": [{"children": []}]}) == {}


def test_face_of_assigns_by_body_column():
    p = dieline.parse_panels(FAKE)
    assert dieline.face_of(3400, p) == "right"    # inside the right column
    assert dieline.face_of(2500, p) == "front"
    assert dieline.face_of(1500, p) == "left"
    assert dieline.face_of(500, p) == "back"
    # The top flap overlaps the right column in x but is not a body panel, so a
    # point past the right column's end is unassigned rather than "top".
    assert dieline.face_of(3890, p) is None
