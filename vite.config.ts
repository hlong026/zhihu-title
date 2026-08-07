import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(here, "renderer-dist"),
    emptyOutDir: true,
  },
});
