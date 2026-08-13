import { defineConfig } from "vite";

// The courier is injected into merchant.roastify.app — a DIFFERENT origin than
// the Bench — so a relative /mcp would resolve to the merchant, which has no
// proxy. Bake the Bench's absolute /mcp proxy URL (its CORS is *), so tool
// calls reach roastify-mcp from the merchant origin.
const MCP_PROXY = "https://roastify.tollbooth-dpyc.com/mcp";

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
    // Dependencies (MCP SDK, ajv, …) read process.env.NODE_ENV at module init.
    // This lib build has no React plugin to replace it, so without this `process`
    // is undefined in the browser and the whole bundle throws before our code
    // runs (script loads, but nothing executes). Replace the checks…
    "process.env.NODE_ENV": JSON.stringify("production"),
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
    rollupOptions: {
      output: {
        // …and shim a process object as a backstop for any other bare `process`
        // access (e.g. process.emit in a dep's error path) so init never throws.
        banner:
          "window.process=window.process||{env:{NODE_ENV:'production'},emit:function(){},version:''};",
      },
    },
  },
});
