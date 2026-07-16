import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// control_deck injects FRONTEND_PORT / BACKEND_PORT; fall back to standalone defaults.
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5177;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 8003;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: FRONTEND_PORT,
    strictPort: true,
    // Proxy API + WebSocket calls to the FastAPI backend so the key never
    // touches the browser.
    proxy: {
      "/api": { target: `http://127.0.0.1:${BACKEND_PORT}`, changeOrigin: true },
      "/ws": { target: `ws://127.0.0.1:${BACKEND_PORT}`, ws: true },
    },
  },
  build: { outDir: "dist" },
});
