import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  resolve: { conditions: ["source", "browser", "module", "import", "default"] },
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: true,
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
});
