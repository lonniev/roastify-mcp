// Where the words actually print.
//
// A list of layers tells you what a design says. It cannot tell you that the
// same words print on two faces and again inside a paragraph — which is how a
// box ends up contradicting itself after someone edits one of them. Laid out at
// true coordinates on the unfolded box, that is visible at a glance.

import type { DesignDoc, DesignLayer } from "../lib/design";

export default function PanelMap({
  doc,
  highlight = [],
}: {
  doc: DesignDoc;
  /** Layer ids to call out — typically every place one value appears. */
  highlight?: string[];
}) {
  const marked = new Set(highlight);
  const texts = doc.layers.filter((l) => l.type === "text" && l.text);

  // Crop to the ink: the canvas is much taller than the printed area, and
  // showing all of it renders the panels as a thin strip.
  const pad = 120;
  const minY = Math.max(0, Math.min(...texts.map((l) => l.y)) - pad);
  const maxY = Math.min(doc.height, Math.max(...texts.map((l) => l.y + l.height)) + pad);
  const h = Math.max(1, maxY - minY);

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-stone-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
      <svg
        viewBox={`0 ${minY} ${doc.width} ${h}`}
        role="img"
        aria-label="Where each piece of text prints on the unfolded box"
        style={{ minWidth: 520 }}
      >
        {doc.panels.map((p) => (
          <g key={p.name}>
            <rect
              x={p.x}
              y={minY + 8}
              width={p.width}
              height={h - 16}
              fill="none"
              stroke="currentColor"
              strokeWidth={5}
              strokeDasharray="26 16"
              className="text-stone-300 dark:text-zinc-700"
            />
            <text
              x={p.x + 18}
              y={minY + 78}
              fontSize={64}
              letterSpacing={4}
              fill="currentColor"
              className="text-stone-400 dark:text-zinc-600"
              style={{ fontFamily: "ui-monospace, monospace" }}
            >
              {p.name}
            </text>
          </g>
        ))}

        {texts.map((l) => (
          <Block key={l.id} layer={l} marked={marked.has(l.id)} />
        ))}
      </svg>
    </div>
  );
}

function Block({ layer, marked }: { layer: DesignLayer; marked: boolean }) {
  const named = layer.name.trim().length > 0;
  return (
    <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
      <rect
        x={layer.x}
        y={layer.y}
        width={Math.max(layer.width, 24)}
        height={Math.max(layer.height, 24)}
        rx={6}
        fill="currentColor"
        fillOpacity={marked ? 0.28 : 0.14}
        stroke="currentColor"
        strokeWidth={marked ? 10 : 0}
        className={
          marked
            ? "text-rose-500"
            : named
              ? "text-teal-600 dark:text-teal-400"
              : "text-amber-700 dark:text-amber-600"
        }
      >
        <title>
          {(layer.name || "unnamed") + " — " + layer.text.slice(0, 80)}
        </title>
      </rect>
    </g>
  );
}
