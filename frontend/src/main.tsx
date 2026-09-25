import React from "react";
import ReactDOM from "react-dom/client";
import { bootstrapTheme, configureTollbooth } from "@tollbooth-dpyc/web";
import { ErrorBoundary } from "@tollbooth-dpyc/web/react";
import App from "./App";
import "./index.css";

// The shared account pieces (profile, session key, avatar, theme) read who
// this site is from here. Storage keys stay under "roastify:", as they always were.
configureTollbooth({
  slug: "roastify",
  appName: "Roastify",
  mcpUrl: import.meta.env.VITE_MCP_URL as string,
});

// Apply the saved theme (dark by default) before first paint — no flash.
bootstrapTheme();

// Last guard: a render-time throw shows a calm card, not a white screen.
const crash = {
  root: "flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center text-stone-800 dark:bg-zinc-950 dark:text-zinc-200",
  title: "text-lg font-semibold",
  message: "max-w-md text-sm text-stone-500 dark:text-zinc-400",
  detail:
    "max-h-48 w-full max-w-md overflow-auto rounded-lg bg-stone-50 p-3 text-left font-mono text-xs text-stone-600 dark:bg-zinc-900 dark:text-zinc-400",
  actions: "flex flex-wrap justify-center gap-2",
  chip: "rounded-md bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-300",
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary classNames={crash}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
