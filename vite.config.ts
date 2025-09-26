import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    // visualizer({ filename: "dist/stats.html", gzipSize: true }), // npm i -D rollup-plugin-visualizer
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          firebase: ["firebase/auth", "firebase/firestore"],
        },
      },
    },
  },
});
