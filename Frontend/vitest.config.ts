import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts (dev server / production build) so the
// test runner doesn't need the Tailwind plugin or the API dev-proxy — these
// are unit/hook tests, not a rendered app.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
