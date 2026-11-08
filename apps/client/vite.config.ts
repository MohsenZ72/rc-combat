import { defineConfig } from "vite";

/**
 * `--mode pages` is the static GitHub Pages build: served under /<repo>/,
 * offline-only (races run in the browser against bots, no API or game
 * server), no source maps. See .github/workflows/pages.yml.
 */
export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? (process.env.PAGES_BASE ?? "/rc-combat/") : "/",
  define: mode === "pages" ? { "import.meta.env.VITE_OFFLINE_ONLY": JSON.stringify("1") } : {},
  envDir: "../..",
  resolve: { conditions: ["source", "browser", "module", "import", "default"] },
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: mode !== "pages",
    // Babylon core is one deliberately long-cached ~7 MB chunk (1.6 MB gzip).
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@babylonjs/loaders")) return "babylon-loaders";
          if (id.includes("@babylonjs")) return "babylon";
          if (id.includes("rapier")) return "rapier";
          return undefined;
        },
      },
    },
  },
}));
