import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],

  root: resolve(__dirname, "src/client"),

  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@client": resolve(__dirname, "src/client"),
      "@server": resolve(__dirname, "src/server"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },

  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          state: ["zustand", "@tanstack/react-query"],
        },
      },
    },
  },

  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },

  preview: {
    port: 4173,
    proxy: {
      "/api/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
