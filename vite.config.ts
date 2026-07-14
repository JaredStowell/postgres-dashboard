import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  optimizeDeps: {
    exclude: ["cloudflare:workers"],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
  build: {
    sourcemap: true,
    rolldownOptions: {
      external: ["cloudflare:workers"],
    },
  },
});
