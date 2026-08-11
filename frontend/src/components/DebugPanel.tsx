// On-screen MCP activity log, ported from taxsort-mcp. A fixed bottom bar that
// shows every MCP call/result/error so you can see what the FE is doing —
// invaluable for diagnosing "Post does nothing" and the OAuth flow.
//
// It also surfaces the Cloudflare cron Worker's traffic, which is otherwise
// invisible here: "Scheduler ↻" pulls recent process_scheduled_posts ticks
// (operator-only) and merges each run — with its per-post skip/error reasons —
// into this same log. With "auto" on it re-polls every 5 min while the panel is
// open AND the tab is visible — a hidden tab stops polling so it never keeps the
// Neon compute awake in the background.

import { useRef, useState } from "react";
import { clearDebug, useDebugLog, type DebugEntry } from "../lib/debugLog";

const TYPE_COLOR: Record<DebugEntry["type"], string> = {
  info: "text-sky-400",
  call: "text-amber-400",
  result: "text-green-400",
  error: "text-red-400",
};

function isFailure(entry: DebugEntry): boolean {
  if (entry.type === "error") return true;
  if (entry.type === "result") {
    const m = entry.message;
    return m.includes('"success":false') || m.includes('"error"') || m.includes("error_code");
  }
  return false;
}

export default function DebugPanel() {
  const log = useDebugLog();
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set()); // run_at values already rendered

  const errorCount = log.filter(isFailure).length;


  // Auto re-poll every 5 min while the panel is open, auto is on, AND the tab is
  // visible. A hidden tab stops polling so it never keeps the Neon compute awake
  // in the background; it catches up immediately when the tab becomes visible.
  function handleClear(): void {
    clearDebug();
    seen.current.clear(); // allow ticks to re-render after a manual clear
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-end">
      {/* Control bar — always in flow ABOVE the panel, so the minimize (Hide)
          tab is never overlapped by the expanded log. */}
      <div className="flex gap-1 pr-3">
        {open && (
          <>
            <button
              onClick={handleClear}
              className="rounded-t-lg bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
            >
              Clear
            </button>
          </>
        )}
        <button
          onClick={() => setOpen(!open)}
          className={`rounded-t-lg px-3 py-1 text-xs text-white ${
            errorCount > 0 ? "bg-red-700 hover:bg-red-600" : "bg-zinc-800 hover:bg-zinc-700"
          }`}
        >
          {open ? "Hide" : "Debug"} ({log.length}
          {errorCount > 0 ? ` · ${errorCount} err` : ""})
        </button>
      </div>
      {open && (
        <div className="max-h-64 w-full overflow-y-auto border-t border-zinc-700 bg-zinc-950/95 p-3 font-mono text-xs backdrop-blur-sm">
          {log.length === 0 && <div className="text-zinc-500">No MCP activity yet.</div>}
          {log.map((entry, i) => {
            const failed = isFailure(entry);
            return (
              <div
                key={i}
                className={`flex gap-2 py-0.5 ${failed ? "-mx-1 rounded-sm bg-red-950/60 px-1" : ""}`}
              >
                <span className="shrink-0 text-zinc-600">{entry.ts}</span>
                <span className={`w-12 shrink-0 ${failed ? "font-bold text-red-400" : TYPE_COLOR[entry.type]}`}>
                  {entry.type}
                  {failed && entry.type !== "error" ? " !" : ""}
                </span>
                <span className={`break-all ${failed ? "text-red-300" : "text-zinc-300"}`}>{entry.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
