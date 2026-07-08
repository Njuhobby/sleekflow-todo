import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../shared/src"),
    },
  },
  server: {
    port: 5173,
    // No CORS anywhere: dev proxies /api to Fastify; prod serves the built SPA from it
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
