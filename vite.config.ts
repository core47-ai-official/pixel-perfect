// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null, // src/lib/pwa-register.ts is the only registrar
        devOptions: { enabled: false },
        filename: "sw.js",
        strategies: "generateSW",
        includeAssets: ["favicon.ico", "push-sw.js"],
        manifest: {
          name: "MediCore HMS",
          short_name: "MediCore",
          start_url: "/dashboard",
          scope: "/",
          display: "standalone",
          theme_color: "#168054",
          background_color: "#ffffff",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
        },
        workbox: {
          importScripts: ["/push-sw.js"], // web-push handlers live in the same worker
          globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: { cacheName: "mc-pages", networkTimeoutSeconds: 4, expiration: { maxEntries: 50 } },
            },
          ],
        },
      }),
    ],
  },
});
