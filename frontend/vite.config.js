import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    open: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/images': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/webhook': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
})
