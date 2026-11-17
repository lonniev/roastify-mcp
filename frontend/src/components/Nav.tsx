// Roastify's top bar: the package's SiteNav (the pages, the phone menu, the
// account menu) in the Bench's look — each page an icon and a word.

import { Link, useLocation } from "react-router-dom";
import { Coffee, Layers, Wand2, Wallet } from "lucide-react";
import { SiteNav, matchesPath, useAppShell, type SiteNavItem } from "@tollbooth-dpyc/web/react";
import { navLook } from "../lib/look";
import { useT } from "../i18n";

export default function Nav() {
  const { session } = useAppShell();
  const { pathname } = useLocation();
  const t = useT();
  const pages: readonly SiteNavItem[] = [
    { href: "/", label: t("ui.nav.catalog"), icon: <Coffee />, end: true, title: t("ui.nav.catalog") },
    { href: "/designs", label: t("ui.nav.designs"), icon: <Layers />, title: t("ui.nav.designs") },
    { href: "/bench", label: t("ui.nav.bench"), icon: <Wand2 />, title: t("ui.nav.bench") },
    { href: "/wallet", label: t("ui.nav.wallet"), icon: <Wallet />, title: t("ui.nav.wallet") },
  ];
  const accountLinks: readonly SiteNavItem[] = [
    { href: "/profile", label: t("ui.nav.profile") },
    { href: "/wallet", label: t("ui.nav.wallet") },
  ];
  return (
    <SiteNav
      brand={
        <Link to="/" className="flex items-center gap-2 mr-3">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="font-semibold tracking-wide">Roastify</span>
        </Link>
      }
      items={pages}
      isActive={(href, item) => matchesPath(pathname, href, item.end)}
      renderLink={({ href, children, ...rest }) => (
        <Link to={href} {...rest}>
          {children}
        </Link>
      )}
      account={{ npub: session.npub, links: accountLinks, onSignOut: session.signOut }}
      classNames={navLook}
    />
  );
}
