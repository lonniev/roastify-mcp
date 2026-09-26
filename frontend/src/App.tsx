import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import type { ServiceStatus } from "@tollbooth-dpyc/web";
import { AppShell } from "@tollbooth-dpyc/web/react";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import CatalogPage from "./components/CatalogPage";
import DesignsPage from "./components/DesignsPage";
import BenchPage from "./components/BenchPage";
import Wallet from "./components/Wallet";
import ProfilePage from "./components/ProfilePage";

// The session, the sign-in gate, the theme, the avatar and the debug log are
// the package's AppShell; Roastify brings its routes, its hero and its footer.
export default function App() {
  return (
    <AppShell
      theme="dark"
      classNames={{ root: "bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 transition-colors" }}
      footer={({ status }) => <Footer status={status} />}
      signedOut={({ gate }) => (
        <>
          <TopBar />
          <main className="flex-1">
            <Hero />
            <div className="pb-16">{gate}</div>
          </main>
        </>
      )}
    >
      {() => (
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<CatalogPage />} />
              <Route path="designs" element={<DesignsPage />} />
              <Route path="bench" element={<BenchPage />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      )}
    </AppShell>
  );
}

function Layout() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Outlet />
      </main>
    </>
  );
}

function TopBar() {
  return (
    <header className="border-b border-stone-200 dark:border-zinc-800 px-4 py-3 flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
      <span className="font-semibold tracking-wide">Roastify</span>
      <span className="text-sm text-stone-400 dark:text-zinc-500">Design Bench</span>
    </header>
  );
}

function Footer({ status }: { status: ServiceStatus | null }) {
  return (
    <footer className="border-t border-stone-100 px-4 py-3 text-center text-xs text-stone-400 dark:border-zinc-900 dark:text-zinc-600 space-y-0.5">
      <div>
        Roastify Design Bench v{__APP_VERSION__} · {__BUILD_COMMIT__}
        {status?.version && ` · MCP ${status.version}`}
        {status?.tollbooth_dpyc_version && ` · SDK ${status.tollbooth_dpyc_version}`}
      </div>
      <div>
        Monetized with{" "}
        <a
          href="https://tollbooth-dpyc.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-600/80 hover:underline dark:text-amber-400/80"
        >
          Tollbooth DPYC™
        </a>{" "}
        · Apache-2.0 · Patent Pending (US Prov. 64/045,999)
      </div>
    </footer>
  );
}
