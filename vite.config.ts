import { defineConfig } from "vite";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs plugin, no type declarations needed
import { galleryDevPlugin } from "./server/galleryDevPlugin.mjs";

export default defineConfig({
  plugins: [galleryDevPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        gallery: resolve(__dirname, "gallery.html"),
      },
    },
  },
});
