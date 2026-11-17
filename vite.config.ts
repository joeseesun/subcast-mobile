import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), {
    // Development only: the WebView's console lines arrive here (src/lib/devnav.ts) and go to /tmp/subcast-webview.log.
    name: "webview-log",
    apply: "serve",
    configureServer(server: any) {
      server.middlewares.use("/__log", (req: any, res: any) => {
        let body = "";
        req.on("data", (c: any) => (body += c));
        req.on("end", async () => { const fs = await import("node:fs"); fs.appendFileSync("/tmp/subcast-webview.log", body + "\n"); res.end("ok"); });
      });
    },
  }],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
