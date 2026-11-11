import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Defaults to '/' for this project's own Vercel deployment. Set
  // VITE_BASE_PATH=/secretary-app-dist/ only when building the copy
  // embedded into the root app's own static tree (same pattern as
  // patient-app/vite.config.js -- see patient-app-dist/README.md).
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
})
