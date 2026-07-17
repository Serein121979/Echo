import { defineConfig } from "vite";

export default defineConfig({
  envDir: "..",
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
