import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import type { ServiceStatus } from "@tollbooth-dpyc/web";
import { AppShell, LanguageChooser, Tx, Wallet } from "@tollbooth-dpyc/web/react";
import { useT, WORDS } from "./i18n";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import CatalogPage from "./components/CatalogPage";

// Each page past the catalog is its own chunk, fetched the first time it opens.
const DesignsPage = lazy(() => import("./components/DesignsPage"));
const BenchPage = lazy(() => import("./components/BenchPage"));
const ProfilePage = lazy(() => import("./components/ProfilePage"));

// The session, the sign-in gate, the theme, the avatar and the debug log are
// the package's AppShell; Roastify brings its routes, its hero and its footer.
export default function App() {
  const t = useT();
  return (
    <AppShell
      theme="dark"
      gateOptions={{ welcome: t("ui.app.welcome") }}
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
              <Route
                path="wallet"
                element={
                  <div className="max-w-[90rem] mx-auto px-4 py-6">
                    <Wallet />
                  </div>
                }
              />
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
  const t = useT();
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Suspense fallback={<p className="py-12 text-center text-sm text-stone-400 dark:text-zinc-500">{t("ui.app.loading")}</p>}>
          <Outlet />
        </Suspense>
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

/** The language row in the footer, where every visitor can reach it, signed in or not. */
const languageLook = {
  root: "flex flex-wrap justify-center gap-1.5 pt-2",
  chip: "rounded-full border border-stone-200 px-2.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900",
  active: "border-amber-400! text-amber-700! dark:border-amber-500/50! dark:text-amber-300!",
};

function Footer({ status }: { status: ServiceStatus | null }) {
  return (
    <footer className="border-t border-stone-100 px-4 py-3 text-center text-xs text-stone-400 dark:border-zinc-900 dark:text-zinc-600 space-y-0.5">
      <div>
        Roastify Design Bench v{__APP_VERSION__} · {__BUILD_COMMIT__}
        {status?.version && ` · MCP ${status.version}`}
        {status?.tollbooth_dpyc_version && ` · SDK ${status.tollbooth_dpyc_version}`}
      </div>
      <div>
        <Tx
          ns={WORDS}
          k="ui.app.monetized"
          components={{
            dpyc: (
              <a
                href="https://tollbooth-dpyc.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600/80 hover:underline dark:text-amber-400/80"
              />
            ),
          }}
        />
      </div>
      <LanguageChooser classNames={languageLook} />
    </footer>
  );
}
