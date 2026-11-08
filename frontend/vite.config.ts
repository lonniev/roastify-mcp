import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { agentGuide } from '@tollbooth-dpyc/web/agent-guide'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Short git commit SHA at build time. Cloudflare Pages injects
// CF_PAGES_COMMIT_SHA; CI sets COMMIT_SHA; local dev falls back to
// `git rev-parse`; last resort is "dev" so the footer never renders
// undefined.
function resolveCommit(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7)
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [
    react(), tailwindcss(),
    agentGuide({
      name: "Roastify Design Bench",
      summary: "A web app for curating coffee packaging. Browse the Roastify catalog, open the designs you saved in Roastify's Design Studio, and generate new packaging artwork by changing the words on a template you already made.",
      site: "https://roastify.tollbooth-dpyc.com",
      mcpUrl: "https://roastify-mcp.fastmcp.app/mcp",
      toolPrefix: "roastify",
      source: "https://github.com/lonniev/roastify-mcp",
      registryName: "io.github.lonniev/roastify-mcp",
      body: "agent-guide.md",
      links: [{ label: "Roastify", url: "https://roastify.app" }],
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_COMMIT__: JSON.stringify(resolveCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { outDir: 'dist' },
})
