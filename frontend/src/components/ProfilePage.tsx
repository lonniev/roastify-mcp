// Profile: the package's AccountPage in the Bench's look, with Roastify's own
// panels in its slots — the Roastify key after the session key, and Roastify's
// coupon rows in place of the package's.

import type { ReactNode } from "react";
import type { Theme } from "@tollbooth-dpyc/web";
import { AccountPage, useAppShell } from "@tollbooth-dpyc/web/react";
import RoastifyKeyPanel from "./RoastifyKeyPanel";
import Coupons from "./Coupons";
import { accountLook, buildInfoLook, timezonePickerLook, usageLook } from "../lib/look";

const THEME_LABELS: Record<Theme, { label: string; hint: string }> = {
  dark: { label: "Dark", hint: "Default" },
  light: { label: "Light", hint: "" },
  system: { label: "System", hint: "Match OS" },
};

const themeLabels = Object.fromEntries(
  (Object.keys(THEME_LABELS) as Theme[]).map((t) => [
    t,
    <>
      <div className="flex items-center gap-2">
        <ThemeSwatch theme={t} />
        <span className="text-sm font-medium">{THEME_LABELS[t].label}</span>
      </div>
      {THEME_LABELS[t].hint && (
        <span className="block text-xs text-stone-400 dark:text-zinc-500 mt-1">{THEME_LABELS[t].hint}</span>
      )}
    </>,
  ]),
) as Record<Theme, ReactNode>;

const themeLook = {
  root: "grid grid-cols-3 gap-2",
  chip: "rounded-lg border px-3 py-3 text-left transition-colors border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800",
  active: "border-amber-400! bg-amber-50! dark:border-amber-500/50! dark:bg-amber-500/10!",
};

export default function ProfilePage() {
  const { session, status } = useAppShell();
  return (
    <AccountPage
      npub={session.npub}
      onSignOut={session.signOut}
      classNames={accountLook}
      between={{ sessionKey: <RoastifyKeyPanel />, coupons: <Coupons /> }}
      usage={{ classNames: usageLook }}
      timezone={{
        heading: "Display timezone",
        intro:
          "Dates on your Wallet — top-ups and when credits expire — and the debug log's times use this zone. Saved on this device.",
        label: "Zone",
        id: "tz-select",
        autoLabel: (zone) => `Auto (browser) — ${zone}`,
        optionLabel: (o) => `${o.label} — ${o.value}`,
        classNames: timezonePickerLook,
        note: (pref, zone) =>
          pref === "auto"
            ? `Currently resolving to ${zone}.`
            : `Using ${zone}. Past dates keep the offset that applied at the time.`,
      }}
      theme={{
        intro: "Roastify defaults to dark. Your choice is saved on this device.",
        labels: themeLabels,
        classNames: themeLook,
      }}
      coupons={false}
      build={{
        status,
        frontend: {
          version: __APP_VERSION__,
          commit: __BUILD_COMMIT__,
          builtAt: __BUILD_TIME__,
          source: "https://github.com/lonniev/roastify-mcp",
        },
        intro: (
          <>
            Roastify and Tollbooth-DPYC<sup>™</sup> ship as open source under the Apache License 2.0 —
            anyone can read the code, fork it, run their own operator. The <i>services</i> on top are
            private commerce: each operator sets their own tolls; patrons pre-fund a Lightning balance
            and pay per call. The protocol is shared; the businesses on it are not.
          </>
        ),
        classNames: buildInfoLook,
      }}
    />
  );
}

function ThemeSwatch({ theme }: { theme: Theme }) {
  const base = "w-5 h-5 rounded-full border border-stone-300 dark:border-zinc-600";
  if (theme === "dark") return <span className={`${base} bg-zinc-900`} />;
  if (theme === "light") return <span className={`${base} bg-stone-100`} />;
  return <span className={`${base} bg-linear-to-r from-stone-100 to-zinc-900`} />;
}
