/**
 * Reads a Roastify Design Studio export (a Polotno store JSON) in the browser.
 *
 * The API accepts `{fieldId, type, value}` but publishes no way to discover what
 * fields a design has, so this closes that gap locally: no upload, no server call,
 * nothing spent. The file never leaves the page.
 *
 * Two things it surfaces that a flat list of layers cannot:
 *
 *  - which layers are **addressable** — Roastify matches a layer by its `name`,
 *    and Design Studio leaves that empty unless a human types one, so an unnamed
 *    layer is invisible to the API however important it looks on the box;
 *  - where a value is **repeated** — the same words often print on two panels and
 *    again inside a paragraph, and changing one of them is how a box ends up
 *    contradicting itself.
 */

export interface DesignLayer {
  id: string;
  /** Empty unless a human named it in Design Studio. Empty ⇒ not addressable. */
  name: string;
  type: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Which die-cut panel this sits on, when the design labels its panels. */
  panel?: string;
}

export interface DesignDoc {
  width: number;
  height: number;
  layers: DesignLayer[];
  /** Panel bands read from the design's own FRONT/BACK/LEFT/… labels. */
  panels: { name: string; x: number; width: number }[];
  /** Values appearing on more than one layer, keyed by the normalized text. */
  duplicates: { text: string; layers: DesignLayer[] }[];
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Panel names a coffee-box dieline labels its faces with. */
const PANEL_WORDS = new Set(["FRONT", "BACK", "LEFT", "RIGHT", "TOP FLAP", "BOTTOM FLAP", "TOP", "BOTTOM"]);

function walk(node: unknown, out: DesignLayer[]): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (typeof o.type === "string" && typeof o.id === "string") {
    if (o.type === "text") {
      out.push({
        id: o.id,
        name: str(o.name),
        type: o.type,
        text: str(o.text).replace(/\s+/g, " ").trim(),
        x: num(o.x),
        y: num(o.y),
        width: num(o.width),
        height: num(o.height),
        rotation: num(o.rotation),
      });
    } else if (o.type === "image" && str(o.name)) {
      // Only named images matter — an unnamed one cannot be targeted either.
      out.push({
        id: o.id,
        name: str(o.name),
        type: "image",
        text: "",
        x: num(o.x),
        y: num(o.y),
        width: num(o.width),
        height: num(o.height),
        rotation: num(o.rotation),
      });
    }
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") walk(v, out);
  }
}

/** Derive panel bands from the layers the designer used as face labels.
 *
 * Only the labels sharing a row count. A flap label sits at a different height
 * from the four faces, and letting it into the ordering makes the panel beside
 * it come out a few pixels wide — the bands are read across one row, not across
 * the whole canvas.
 */
function readPanels(layers: DesignLayer[]): { name: string; x: number; width: number }[] {
  const marks = layers.filter((l) => PANEL_WORDS.has(l.text.toUpperCase()));
  if (marks.length < 2) return [];

  // Group by y (rounded generously), then take the most populous row.
  const rows = new Map<number, DesignLayer[]>();
  for (const m of marks) {
    const band = Math.round(m.y / 200);
    (rows.get(band) ?? rows.set(band, []).get(band)!).push(m);
  }
  const faces = [...rows.values()].sort((a, b) => b.length - a.length)[0];
  if (!faces || faces.length < 2) return [];

  const sorted = [...faces].sort((a, b) => a.x - b.x);
  return sorted.map((m, i) => ({
    name: m.text.toUpperCase(),
    x: m.x,
    // The last face has no neighbour to bound it; give it the median width of
    // the others rather than a guess scaled off its own label.
    width:
      sorted[i + 1] !== undefined
        ? sorted[i + 1].x - m.x
        : Math.round(
            sorted.slice(0, -1).reduce((acc, s, j) => acc + (sorted[j + 1].x - s.x), 0) /
              Math.max(1, sorted.length - 1),
          ),
  }));
}

function assignPanels(layers: DesignLayer[], panels: { name: string; x: number; width: number }[]): void {
  if (!panels.length) return;
  for (const l of layers) {
    const p = panels.find((p) => l.x >= p.x && l.x < p.x + p.width);
    if (p) l.panel = p.name;
  }
}

/** Words too generic to be worth flagging when they repeat. */
const IGNORE_DUPES = new Set(["", "COFFEE", "OZ", "100%"]);

function findDuplicates(layers: DesignLayer[]): { text: string; layers: DesignLayer[] }[] {
  const byText = new Map<string, DesignLayer[]>();
  for (const l of layers) {
    const key = l.text.trim().toUpperCase();
    if (!key || key.length < 4 || IGNORE_DUPES.has(key)) continue;
    (byText.get(key) ?? byText.set(key, []).get(key)!).push(l);
  }
  const out: { text: string; layers: DesignLayer[] }[] = [];
  for (const [, group] of byText) {
    if (group.length > 1) out.push({ text: group[0].text, layers: group });
  }

  // A value can also be repeated INSIDE a longer paragraph — the case a
  // by-equality check misses entirely, and the one that actually bit Praxeology,
  // whose product name prints twice and appears again inside two paragraphs.
  //
  // The floor is 8 characters rather than 4: a short common word ("COFFEE",
  // "ROAST") turns up inside prose constantly and flagging it buries the one
  // duplicate that matters under noise.
  const shorts = layers.filter(
    (l) => l.text.length >= 8 && l.text.length <= 40 && !IGNORE_DUPES.has(l.text.toUpperCase()),
  );
  for (const s of shorts) {
    const inside = layers.filter(
      (l) => l.id !== s.id && l.text.length > 40 && l.text.toUpperCase().includes(s.text.toUpperCase()),
    );
    if (!inside.length) continue;
    const existing = out.find((d) => d.text.toUpperCase() === s.text.toUpperCase());
    if (existing) {
      for (const l of inside) if (!existing.layers.includes(l)) existing.layers.push(l);
    } else {
      out.push({ text: s.text, layers: [s, ...inside] });
    }
  }
  return out.sort((a, b) => b.layers.length - a.layers.length);
}

export function parseDesign(json: unknown): DesignDoc {
  const root = (json ?? {}) as Record<string, unknown>;
  const layers: DesignLayer[] = [];
  walk(root.pages ?? root, layers);
  const panels = readPanels(layers);
  assignPanels(layers, panels);
  return {
    width: num(root.width, 3900),
    height: num(root.height, 5700),
    layers,
    panels,
    duplicates: findDuplicates(layers),
  };
}

/** Layers a human named — the only ones the API can be asked to change. */
export function addressable(doc: DesignDoc): DesignLayer[] {
  return doc.layers.filter((l) => l.name.trim().length > 0);
}

/** Named layers that are face labels rather than content worth editing. */
export function editable(doc: DesignDoc): DesignLayer[] {
  return addressable(doc).filter((l) => !PANEL_WORDS.has(l.text.toUpperCase()));
}
