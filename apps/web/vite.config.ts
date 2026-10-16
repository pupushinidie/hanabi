import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";
import { gmPreload } from "./gm-preload-plugin";

const WEB_PORT = Number(process.env.WEB_PORT ?? 5295);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3024);

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/hanabi/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette), gmPreload()],
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/socket.io": { target: `http://localhost:${SERVER_PORT}`, ws: true },
      "/health": `http://localhost:${SERVER_PORT}`
    }
  }
});
