// Roastify's look for the shared account pieces from @tollbooth-dpyc/web.
// The package owns the mechanics (calls, states, words); these class maps
// are the Bench's stone/zinc/amber, light and dark.

import type { CouponsPanelClassNames, WalletPageClassNames } from "@tollbooth-dpyc/web/react";

export const card = "rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900";

/** Every action the shared pieces draw is a chip. */
const chip =
  "inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";

const input =
  "rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-zinc-950 border border-stone-300 dark:border-zinc-700 focus:outline-hidden focus:border-amber-400";

const errorBox =
  "rounded-lg p-3 text-xs bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400";

export const walletLook: WalletPageClassNames = {
  root: "max-w-3xl mx-auto px-4 py-6 space-y-5",
  heading: "text-lg font-semibold",
  section: `${card} p-5 space-y-3`,
  sectionTitle: "text-sm font-medium",
  figure: "text-3xl font-semibold tabular-nums",
  unit: "text-base text-stone-400 dark:text-zinc-500",
  stats: "flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-zinc-400",
  notice: "text-xs text-amber-600 dark:text-amber-400",
  error: errorBox,
  chip,
  chipActive: "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-400",
  chips: "flex flex-wrap items-center gap-2",
  input: `${input} w-32`,
  invoice: "rounded-lg border border-stone-200 dark:border-zinc-800 p-3 space-y-2",
  bolt11: "font-mono text-xs break-all bg-stone-50 dark:bg-zinc-950 rounded-sm p-2",
  status: "text-xs text-stone-500 dark:text-zinc-400",
  list: "space-y-1.5 text-xs",
  row: "flex justify-between gap-3 text-stone-500 dark:text-zinc-400 tabular-nums",
};

export const couponsLook: CouponsPanelClassNames = {
  root: `${card} p-5`,
  heading: "text-sm font-medium mb-1",
  intro: "text-xs text-stone-500 dark:text-zinc-400 mb-4",
  form: "flex gap-2 mb-3",
  input: `${input} flex-1 py-2 uppercase`,
  chip: "bg-amber-600 hover:bg-amber-500 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap",
  message: "rounded-lg p-2.5 mb-3 text-xs border",
  ok: "bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-400",
  error: "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400",
  loading: "text-xs text-stone-400 dark:text-zinc-500 py-2",
  empty: "text-xs text-stone-400 dark:text-zinc-500 leading-relaxed",
  list: "divide-y divide-stone-100 dark:divide-zinc-800",
  row: "flex items-center gap-3 py-2.5",
};
