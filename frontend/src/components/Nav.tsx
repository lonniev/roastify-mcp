// Roastify's top bar: the package's SiteNav (the pages, the phone menu, the
// account menu) in the Bench's look — each page an icon and a word.

import { Link, useLocation } from "react-router-dom";
import { Coffee, Layers, Wand2, Wallet } from "lucide-react";
import { SiteNav, matchesPath, useAppShell, type SiteNavItem } from "@tollbooth-dpyc/web/react";
import { navLook } from "../lib/look";

const PAGES: readonly SiteNavItem[] = [
  { href: "/", label: "Catalog", icon: <Coffee />, end: true, title: "Catalog" },
  { href: "/designs", label: "Designs", icon: <Layers />, title: "Designs" },
  { href: "/bench", label: "Bench", icon: <Wand2 />, title: "Bench" },
  { href: "/wallet", label: "Wallet", icon: <Wallet />, title: "Wallet" },
];

const ACCOUNT_LINKS: readonly SiteNavItem[] = [
  { href: "/profile", label: "Profile & theme" },
  { href: "/wallet", label: "Wallet" },
];

export default function Nav() {
  const { session } = useAppShell();
  const { pathname } = useLocation();
  return (
    <SiteNav
      brand={
        <Link to="/" className="flex items-center gap-2 mr-3">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="font-semibold tracking-wide">Roastify</span>
        </Link>
      }
      items={PAGES}
      isActive={(href, item) => matchesPath(pathname, href, item.end)}
      renderLink={({ href, children, ...rest }) => (
        <Link to={href} {...rest}>
          {children}
        </Link>
      )}
      account={{ npub: session.npub, links: ACCOUNT_LINKS, onSignOut: session.signOut }}
      classNames={navLook}
    />
  );
}
