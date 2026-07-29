import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    emptyOutDir: true,
    outDir: "../dist/client",
    target: "es2022"
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
