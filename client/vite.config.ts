import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    // 性能预算起点，后续按 PERF-005 收紧
    chunkSizeWarningLimit: 1200,
  },
})
