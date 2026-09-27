import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: path.resolve(projectDirectory, "../portal/dist/outlook-addin"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(projectDirectory, "events.html"),
      output: {
        format: "iife",
        entryFileNames: "assets/events.js",
      },
    },
  },
});
