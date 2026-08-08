import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    watch: {
      // Large binary GLB assets are runtime inputs, not source files. Ignoring
      // them prevents Windows ReadDirectoryChangesW/EBUSY watcher failures.
      ignored: ['**/src-tauri/target/**', '**/public/assets/**/*.glb'],
    },
  },
  build: {
    target: 'es2022',
    // 性能预算起点，后续按 PERF-005 收紧
    chunkSizeWarningLimit: 1200,
  },
})
