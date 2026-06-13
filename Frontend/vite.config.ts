import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev server proxies API + media to the Django backend so the SPA and API share
// an origin in development (keeps the httpOnly refresh cookie same-site).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
