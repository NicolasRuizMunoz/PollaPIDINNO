import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo el frontend corre en :5173 y reenvia /api al backend en :4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
