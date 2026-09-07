import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri sets TAURI_DEV_HOST when developing against a remote device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/crates/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // The Emscripten build of Hunspell is CommonJS; pre-bundle it so the
  // worker never triggers a mid-session dependency re-optimisation.
  optimizeDeps: { include: ["hunspell-asm/dist/esm/lib/browser/hunspell.js"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
