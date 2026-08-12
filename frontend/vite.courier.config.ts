import { defineConfig } from "vite";

// The courier is injected into merchant.roastify.app — a DIFFERENT origin than
// the Bench — so a relative /mcp would resolve to the merchant, which has no
// proxy. Bake the Bench's absolute /mcp proxy URL (its CORS is *), so tool
// calls reach roastify-mcp from the merchant origin.
const MCP_PROXY = "https://roastify-app.pages.dev/mcp";

// Built as a standalone IIFE into dist/tools/courier.js, alongside the static
// public/tools/ files the main build copies there. emptyOutDir:false so this
// second build does not wipe index.html / roastify-push.js.
export default defineConfig({
  // This build's only output is courier.js; the main build already copied the
  // static public/ files. Without this, Vite re-copies public/ into dist/tools,
  // nesting a stray dist/tools/tools.
  publicDir: false,
  define: {
    "import.meta.env.VITE_MCP_URL": JSON.stringify(MCP_PROXY),
  },
  build: {
    outDir: "dist/tools",
    emptyOutDir: false,
    lib: {
      entry: "src/courier/main.ts",
      formats: ["iife"],
      name: "RoastifyCourier",
      fileName: () => "courier.js",
    },
  },
});
