import { defineConfig } from "vite";

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
