// The Bench — change the words on a design and get new artwork back.
//
// Roastify matches a layer by the NAME a person typed in Design Studio, and
// publishes no way to ask which names a design has. So the design file answers
// that here, in the browser: drop the export, read the names, edit the words.
// The file is never uploaded and never leaves the page.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Wand2, Upload, AlertTriangle, ImageDown, Loader2, ExternalLink } from "lucide-react";
import {
  artworkStatus,
  generateArtwork,
  listMyProducts,
  type ArtworkField,
  type MyProduct,
} from "../lib/mcp";
import { editable, parseDesign, type DesignDoc, type DesignLayer } from "../lib/design";
import PanelMap from "./PanelMap";

const card = "rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900";

/** Upstream never published its status words; treat only the clear ones as final. */
const DONE = new Set(["COMPLETED", "COMPLETE", "SUCCEEDED", "SUCCESS", "DONE", "READY", "FINISHED"]);
const FAILED = new Set(["FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED"]);

type Job =
  | { kind: "idle" }
  | { kind: "working"; jobId: string; status: string }
  | { kind: "ready"; url: string }
  | { kind: "failed"; why: string };

export default function BenchPage() {
  const [params, setParams] = useSearchParams();
  const [designs, setDesigns] = useState<MyProduct[]>([]);
  const [doc, setDoc] = useState<DesignDoc | null>(null);
  const [fileName, setFileName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const [problem, setProblem] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = params.get("design") ?? "";

  useEffect(() => {
    listMyProducts({ limit: 50 })
      .then((r) => setDesigns(r.products ?? []))
      .catch(() => setDesigns([]));
  }, []);

  const fields = useMemo(() => (doc ? editable(doc) : []), [doc]);

  // Which layers carry a value that prints somewhere else too.
  const repeated = useMemo(() => {
    if (!doc) return new Map<string, DesignLayer[]>();
    const m = new Map<string, DesignLayer[]>();
    for (const d of doc.duplicates) for (const l of d.layers) m.set(l.id, d.layers);
    return m;
  }, [doc]);

  async function onFile(f: File) {
    setProblem("");
    try {
      const parsed = parseDesign(JSON.parse(await f.text()));
      if (!parsed.layers.length) {
        setProblem("That file has no text on it — is it a Design Studio export?");
        return;
      }
      setDoc(parsed);
      setFileName(f.name);
      const seed: Record<string, string> = {};
      for (const l of editable(parsed)) seed[l.name] = l.text;
      setValues(seed);
    } catch {
      setProblem("That file could not be read as a design.");
    }
  }

  async function make() {
    if (!chosen) {
      setProblem("Choose which design to make artwork from.");
      return;
    }
    const payload: ArtworkField[] = fields
      .filter((l) => values[l.name] !== undefined && values[l.name] !== l.text)
      .map((l) => ({ fieldId: l.name, type: l.type === "image" ? "image" : "text", value: values[l.name] }));

    if (!payload.length) {
      setProblem("Change something first.");
      return;
    }
    setProblem("");
    try {
      const r = await generateArtwork({
        productId: chosen,
        fields: payload,
        clientReqId: `bench-${chosen}-${Date.now()}`,
      });
      if (!r.success || !r.job_id) {
        setJob({ kind: "failed", why: r.error ?? "It could not be started." });
        return;
      }
      setJob({ kind: "working", jobId: r.job_id, status: r.status ?? "" });
    } catch (e) {
      setJob({ kind: "failed", why: (e as Error).message });
    }
  }

  // Poll while it renders. Checking costs nothing, so this simply waits.
  useEffect(() => {
    if (job.kind !== "working") return;
    let live = true;
    const tick = async () => {
      try {
        const s = await artworkStatus(job.jobId);
        if (!live) return;
        const word = (s.status ?? "").toUpperCase();
        if (DONE.has(word) && s.artwork_url) setJob({ kind: "ready", url: s.artwork_url });
        else if (FAILED.has(word)) setJob({ kind: "failed", why: s.error ?? `Ended as ${s.status}.` });
        else setJob({ kind: "working", jobId: job.jobId, status: s.status ?? word });
      } catch {
        /* keep waiting; a hiccup is not a verdict */
      }
    };
    const id = window.setInterval(tick, 4000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [job]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Bench</h1>
        <select
          value={chosen}
          onChange={(e) => setParams(e.target.value ? { design: e.target.value } : {})}
          aria-label="Which design"
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">Choose a design…</option>
          {designs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title ?? d.id}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <button
            onClick={() => fileRef.current?.click()}
            title="Read the design file so its editable text can be listed"
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Upload className="h-4 w-4" />
            {fileName ? "Change file" : "Open design file"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </div>
      </header>

      {!doc && (
        <div className={`${card} p-8 text-center`}>
          <Wand2 className="mx-auto mb-3 h-8 w-8 text-stone-300 dark:text-zinc-700" />
          <p className="text-sm text-stone-600 dark:text-zinc-400">
            Open your design file to see what you can change.
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-stone-400 dark:text-zinc-500">
            In Roastify’s designer: File → Export → Project .json. It stays on this device.
          </p>
        </div>
      )}

      {doc && (
        <div className="space-y-5">
          <PanelMap doc={doc} highlight={[...repeated.keys()]} />

          {doc.duplicates.length > 0 && (
            <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                {doc.duplicates.map((d) => (
                  <p key={d.text} className="text-amber-900 dark:text-amber-200">
                    “{d.text.slice(0, 46)}” prints in {d.layers.length} places
                    {d.layers.some((l) => l.panel) &&
                      ` — ${[...new Set(d.layers.map((l) => l.panel).filter(Boolean))].join(", ")}`}
                    .
                  </p>
                ))}
              </div>
            </div>
          )}

          <section className={`${card} p-4`}>
            <h2 className="mb-3 text-sm font-semibold">What it says</h2>

            {!fields.length && (
              <div className="rounded-lg border border-dashed border-stone-300 p-4 text-sm dark:border-zinc-700">
                <p className="text-stone-600 dark:text-zinc-400">
                  Nothing on this design can be changed from here yet.
                </p>
                <p className="mt-1 text-xs text-stone-400 dark:text-zinc-500">
                  Name a layer in Roastify’s designer and it becomes editable here.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {fields.map((l) => (
                <label key={l.id} className="block">
                  <span className="mb-1 flex items-center gap-2 text-xs text-stone-500 dark:text-zinc-400">
                    {l.name}
                    {l.panel && <span className="text-stone-400 dark:text-zinc-600">{l.panel}</span>}
                    {repeated.has(l.id) && (
                      <span
                        title={`Also prints in ${repeated.get(l.id)!.length - 1} other place(s)`}
                        className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {repeated.get(l.id)!.length}×
                      </span>
                    )}
                  </span>
                  <input
                    value={values[l.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [l.name]: e.target.value }))}
                    className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-400 dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
              ))}
            </div>

            {fields.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={make}
                  disabled={job.kind === "working"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
                >
                  <Wand2 className="h-4 w-4" />
                  Make artwork
                </button>

                {job.kind === "working" && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Making it…
                  </span>
                )}
                {job.kind === "ready" && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400"
                  >
                    <ImageDown className="h-4 w-4" />
                    Artwork ready
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {job.kind === "failed" && (
                  <span className="text-sm text-red-700 dark:text-red-400">{job.why}</span>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {problem && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
