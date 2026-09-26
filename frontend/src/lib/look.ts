// Roastify's look for the shared account pieces from @tollbooth-dpyc/web.
// The package owns the mechanics (calls, states, words); these class maps
// are the Bench's stone/zinc/amber, light and dark.

import type {
  AccountPageClassNames,
  BuildInfoPanelClassNames,
  CouponsPanelClassNames,
  RefreshButtonClassNames,
  SiteNavClassNames,
  TimezonePickerClassNames,
  UsageSummaryClassNames,
  WalletPageClassNames,
} from "@tollbooth-dpyc/web/react";

export const card = "rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900";

/** Every action the shared pieces draw is a chip… */
const chip =
  "inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * …but the one that moves things forward, which is the amber button it always
 * was (Create invoice, at the end of its row; Redeem). Open checkout, a link,
 * stays the amber text link it always was.
 */
const primary = [
  "inline-flex items-center ml-auto px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap",
  "bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40",
  "[a&]:ml-0 [a&]:px-3 [a&]:py-1.5 [a&]:bg-transparent [a&]:hover:bg-transparent [a&]:hover:underline",
  "[a&]:text-amber-600 dark:[a&]:text-amber-400",
].join(" ");

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
  primary,
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
  primary,
  message: "rounded-lg p-2.5 mb-3 text-xs border",
  ok: "bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-400",
  error: "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400",
  loading: "text-xs text-stone-400 dark:text-zinc-500 py-2",
  empty: "text-xs text-stone-400 dark:text-zinc-500 leading-relaxed",
  list: "divide-y divide-stone-100 dark:divide-zinc-800",
  row: "flex items-center gap-3 py-2.5",
};

export const timezonePickerLook: TimezonePickerClassNames = {
  label: "block text-xs text-stone-500 dark:text-zinc-400 mb-1.5",
  select:
    "w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:outline-hidden focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200",
};

const muted = "text-xs text-stone-400 dark:text-zinc-500";

export const usageLook: UsageSummaryClassNames = {
  root: `${card} p-5`,
  header: "mb-3 flex items-center gap-2",
  heading: "text-sm font-medium",
  chip: "ml-auto text-xs text-stone-500 hover:text-amber-600 dark:text-zinc-400 dark:hover:text-amber-400 disabled:opacity-40 transition-colors",
  figures: "grid grid-cols-3 gap-3 text-center",
  value: "text-lg font-semibold tabular-nums",
  label: muted,
  subheading: "mt-4 mb-1 text-xs uppercase tracking-wider text-stone-400 dark:text-zinc-500",
  list: "divide-y divide-stone-100 dark:divide-zinc-800",
  row: "flex items-baseline gap-3 py-1.5 text-xs",
  tool: "flex-1 min-w-0 truncate font-mono text-stone-700 dark:text-zinc-300",
  calls: "text-stone-400 dark:text-zinc-500 tabular-nums",
  sats: "w-24 text-right text-stone-700 dark:text-zinc-300 tabular-nums",
  loading: muted,
  error: muted,
  empty: muted,
};

// The row carries the value colour so a link's amber never fights it.
export const buildInfoLook: BuildInfoPanelClassNames = {
  root: `${card} p-5`,
  heading: "text-sm font-medium mb-1",
  intro: "text-xs text-stone-500 dark:text-zinc-400 mb-4 leading-relaxed",
  section: "text-xs uppercase tracking-wider text-stone-400 dark:text-zinc-500 mt-4 mb-1",
  row: "flex gap-3 py-1.5 border-b border-stone-100 dark:border-zinc-800 text-xs text-stone-700 dark:text-zinc-300",
  label: "w-28 shrink-0 text-stone-400 dark:text-zinc-500",
  value: "flex-1 min-w-0 font-mono break-all",
  link: "text-amber-600 dark:text-amber-400 hover:underline",
};

// The top bar. Each page is an icon and a word; on a phone the pages fold
// behind a menu button at the far right, which opens a full-width sheet of
// rows under the bar — icon and word, the current page in amber.
export const navLook: SiteNavClassNames = {
  // The 40 px tap targets set the bar's height, so it keeps the 52 px it had.
  root: "relative border-b border-stone-200 dark:border-zinc-800 px-4 py-1.5 flex items-center gap-1.5",
  nav: "max-sm:order-last",
  list: "flex flex-wrap items-center gap-1.5",
  item: "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800",
  active:
    "bg-amber-100 text-amber-800! hover:bg-amber-100! dark:bg-amber-500/15 dark:text-amber-400! dark:hover:bg-amber-500/15!",
  icon: "inline-flex [&_svg]:h-4 [&_svg]:w-4",
  end: "ml-auto flex items-center gap-3",
  toggle:
    "inline-flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 aria-expanded:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:aria-expanded:bg-zinc-800 transition-colors",
  menu: "absolute inset-x-0 top-full z-40 divide-y divide-stone-100 border-b border-stone-200 bg-white shadow-lg dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900",
  menuItem:
    "gap-3 px-4 py-2.5 text-[15px] transition-colors text-stone-700 hover:bg-stone-50 dark:text-zinc-200 dark:hover:bg-zinc-800 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-stone-400 dark:[&_svg]:text-zinc-500",
  menuItemActive:
    "font-medium text-amber-700! bg-amber-50! dark:text-amber-400! dark:bg-amber-500/10! [&_svg]:text-amber-600! dark:[&_svg]:text-amber-400!",
  account: "relative",
  accountButton: "flex items-center justify-center rounded-full",
  accountMenu:
    "absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden z-40",
  accountHeader: "px-3 py-2 border-b border-stone-100 dark:border-zinc-800",
  accountHeading: "text-xs text-stone-400 dark:text-zinc-500",
  accountNpub: "text-xs font-mono truncate text-stone-600 dark:text-zinc-300",
  accountLink:
    "px-3 text-sm text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors",
  signOut:
    "w-full text-left px-3 text-sm text-stone-600 dark:text-zinc-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors",
};

// Profile: every panel in the same card; the time-zone and theme sections are
// the package's, drawn in that card too.
export const accountLook: AccountPageClassNames = {
  root: "max-w-3xl mx-auto px-4 py-6 space-y-5",
  heading: "text-lg font-semibold",
  section: `${card} p-5`,
  sectionHeading: "text-sm font-medium mb-1",
  sectionIntro: "text-xs text-stone-500 dark:text-zinc-400 mb-3",
  sectionNote: "mt-2 text-[11px] text-stone-400 dark:text-zinc-500",
  actions: "flex justify-end",
  signOut:
    "text-sm px-4 py-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors",
};

// Refresh: a 48 px button in a toolbar, 40 px beside a page title.
const refreshButton =
  "inline-flex items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-zinc-800";
export const refreshLook: Record<"toolbar" | "header", RefreshButtonClassNames> = {
  toolbar: { root: `${refreshButton} h-12 w-12`, spinning: "animate-spin" },
  header: { root: `${refreshButton} h-10 w-10`, spinning: "animate-spin" },
};
