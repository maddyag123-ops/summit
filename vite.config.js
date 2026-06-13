import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Use the manifest.json already in public/ — don't auto-generate one
      manifest: false,
      registerType: 'autoUpdate',
      // Inject the SW registration script into index.html automatically
      injectRegister: 'auto',
      workbox: {
        // Pre-cache all built assets so the app shell loads instantly offline
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA navigation: serve index.html for any unmatched route
        navigateFallback: 'index.html',
        // Don't intercept Supabase API/auth calls with the navigation fallback
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],
        // Take control of all clients immediately — prevents the old SW from
        // serving stale assets on the first launch after an update (the main
        // cause of the spinning-wheel-on-launch bug)
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Cache Supabase reads with NetworkFirst + 5s timeout so the app
            // still opens when launched offline (shows last-known data)
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Cache Google Fonts so the UI loads correctly offline
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
