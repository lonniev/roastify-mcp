// Connecting your Roastify account.
//
// Everything this operator reads — the catalog you can see, your saved designs,
// what your plan includes — belongs to the Roastify account behind your own key.
// So the key is the one thing a person has to set up, and this is where it lives.
//
// The key never touches the browser. It travels as a Nostr direct message to the
// operator, which encrypts it at rest. This panel starts that conversation and
// then collects the reply.

import { useEffect, useState } from "react";
import { KeyRound, CheckCircle2, Send, Inbox, ExternalLink } from "lucide-react";
import {
  getPatronOnboardingStatus,
  requestPatronCredentials,
  receivePatronCredentials,
  type PatronOnboardingResult,
} from "../lib/mcp";

const card = "rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900";

type Phase = { kind: "idle" } | { kind: "sent"; phrase: string; relay: string } | { kind: "done" };

export default function RoastifyKeyPanel() {
  const [status, setStatus] = useState<PatronOnboardingResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function check() {
    setChecking(true);
    try {
      setStatus(await getPatronOnboardingStatus());
      setProblem("");
    } catch (e) {
      // Say that the check failed. Silence here reads as "nothing needed",
      // which is the opposite of what an unreachable check means.
      setProblem((e as Error).message);
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void check();
  }, []);

  async function start() {
    setBusy(true);
    setProblem("");
    try {
      const r = await requestPatronCredentials();
      if (r.success && r.dpop_token) {
        setPhase({ kind: "sent", phrase: r.dpop_token, relay: r.rendezvous_relay ?? "" });
      } else {
        setProblem(r.message ?? "The invitation could not be sent.");
      }
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function collect(phrase: string) {
    setBusy(true);
    setProblem("");
    try {
      const r = await receivePatronCredentials(phrase);
      if (r.success && (r.stored_fields ?? []).length) {
        setPhase({ kind: "done" });
        await check();
      } else {
        setProblem(r.error ?? r.message ?? "No reply found yet — send it, then try again.");
      }
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.ready === true;

  return (
    <section className={`${card} p-4`}>
      <header className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold">Your Roastify account</h2>
        {connected && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Connected
          </span>
        )}
      </header>

      {checking && <p className="text-sm text-stone-400 dark:text-zinc-500">Checking…</p>}

      {!checking && connected && (
        <p className="text-sm text-stone-600 dark:text-zinc-400">
          Your catalog and designs are the ones in your own Roastify account.
        </p>
      )}

      {!checking && !connected && phase.kind === "idle" && (
        <div className="space-y-3">
          <p className="text-sm text-stone-600 dark:text-zinc-400">
            Connect your Roastify account to see your catalog and your saved designs.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={start}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Connect
            </button>
            <a
              href="https://merchant.roastify.app/developers"
              target="_blank"
              rel="noopener noreferrer"
              title="Where your Roastify API key is created"
              className="inline-flex items-center gap-1 text-sm text-stone-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              Get a key
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {phase.kind === "sent" && (
        <div className="space-y-3">
          <p className="text-sm text-stone-600 dark:text-zinc-400">
            Check your Nostr messages for one marked{" "}
            <span className="font-mono text-stone-800 dark:text-zinc-200">{phase.phrase}</span> and
            reply with your key.
          </p>
          {phase.relay && (
            <p className="text-xs text-stone-400 dark:text-zinc-500">
              Reply on <span className="font-mono">{phase.relay}</span> — replies elsewhere are missed.
            </p>
          )}
          <button
            onClick={() => collect(phase.phrase)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Inbox className="h-4 w-4" />
            {busy ? "Looking…" : "I replied"}
          </button>
        </div>
      )}

      {phase.kind === "done" && (
        <p className="text-sm text-green-700 dark:text-green-400">Connected.</p>
      )}

      {problem && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {problem}
        </p>
      )}
    </section>
  );
}
