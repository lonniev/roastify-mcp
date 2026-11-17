// Profile: the package's AccountPage in the Bench's look, with Roastify's own
// panel in its slot — the Roastify key after the session key.

import type { ReactNode } from "react";
import { translate, type Theme } from "@tollbooth-dpyc/web";
import { AccountPage, LanguageChooser, PatronCredentialsPanel, Tx, useAppShell } from "@tollbooth-dpyc/web/react";
import { useT, WORDS, type Translate } from "../i18n";
import { accountLook, buildInfoLook, keyPanelLook, timezonePickerLook, usageLook } from "../lib/look";

const themeLook = {
  root: "grid grid-cols-3 gap-2",
  chip: "rounded-lg border px-3 py-3 text-left transition-colors border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-800",
  active: "border-amber-400! bg-amber-50! dark:border-amber-500/50! dark:bg-amber-500/10!",
};

export default function ProfilePage() {
  const { session, status } = useAppShell();
  const t = useT();
  return (
    <AccountPage
      npub={session.npub}
      onSignOut={session.signOut}
      classNames={accountLook}
      between={{
        sessionKey: (
          <>
          <PatronCredentialsPanel
            npub={session.npub}
            heading={t("views.profile.account.heading")}
            connectedText={t("views.profile.account.connected")}
            inviteText={t("views.profile.account.invite")}
            keySource={{
              href: "https://merchant.roastify.app/developers",
              label: t("views.profile.account.getKey"),
              title: t("views.profile.account.getKeyTitle"),
            }}
            classNames={keyPanelLook}
          />
          <section className={accountLook.section}>
            <h2 className={accountLook.sectionHeading}>{t("views.profile.language.heading")}</h2>
            <LanguageChooser classNames={themeLook} />
          </section>
          </>
        ),
      }}
      usage={{ classNames: usageLook }}
      timezone={{
        heading: t("views.profile.timezone.heading"),
        intro: t("views.profile.timezone.intro"),
        label: t("views.profile.timezone.label"),
        id: "tz-select",
        autoLabel: (zone) => t("views.profile.timezone.auto", { zone }),
        optionLabel: (o) => `${o.labelKey ? translate(o.labelKey) : o.label} — ${o.value}`,
        classNames: timezonePickerLook,
        note: (pref, zone) =>
          pref === "auto"
            ? t("views.profile.timezone.resolving", { zone })
            : t("views.profile.timezone.using", { zone }),
      }}
      theme={{
        intro: t("views.profile.theme.intro"),
        labels: themeLabels(t),
        classNames: themeLook,
      }}
      build={{
        status,
        frontend: {
          version: __APP_VERSION__,
          commit: __BUILD_COMMIT__,
          builtAt: __BUILD_TIME__,
          source: "https://github.com/lonniev/roastify-mcp",
        },
        intro: <Tx ns={WORDS} k="views.profile.build" components={{ tm: <sup />, i: <i /> }} />,
        classNames: buildInfoLook,
      }}
    />
  );
}

/** Each theme's name and hint, with its swatch, in the reader's language. */
function themeLabels(t: Translate): Record<Theme, ReactNode> {
  const words: Record<Theme, { label: string; hint: string }> = {
    dark: { label: t("views.profile.theme.dark"), hint: t("views.profile.theme.darkHint") },
    light: { label: t("views.profile.theme.light"), hint: "" },
    system: { label: t("views.profile.theme.system"), hint: t("views.profile.theme.systemHint") },
  };
  return Object.fromEntries(
    (Object.keys(words) as Theme[]).map((theme) => [
      theme,
      <>
        <div className="flex items-center gap-2">
          <ThemeSwatch theme={theme} />
          <span className="text-sm font-medium">{words[theme].label}</span>
        </div>
        {words[theme].hint && (
          <span className="block text-xs text-stone-400 dark:text-zinc-500 mt-1">{words[theme].hint}</span>
        )}
      </>,
    ]),
  ) as Record<Theme, ReactNode>;
}

function ThemeSwatch({ theme }: { theme: Theme }) {
  const base = "w-5 h-5 rounded-full border border-stone-300 dark:border-zinc-600";
  if (theme === "dark") return <span className={`${base} bg-zinc-900`} />;
  if (theme === "light") return <span className={`${base} bg-stone-100`} />;
  return <span className={`${base} bg-linear-to-r from-stone-100 to-zinc-900`} />;
}
