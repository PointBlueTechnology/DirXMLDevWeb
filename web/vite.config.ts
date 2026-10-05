import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the page with hot reload and forwards /api to a running
// `bin/idmweb serve <tree> --port 8787 --no-open`; open the dev URL with that server's #token.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } } },
  build: { chunkSizeWarningLimit: 6000 },
  test: { environment: "jsdom" },
});
