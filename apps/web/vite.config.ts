import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // WS proxy: 浏览器连 ws://localhost:5173/signaling → 转发到 wss://localhost:4443
      // 绕过自签名证书问题（secure: false）
      '/signaling': {
        target: 'wss://localhost:4443',
        ws: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/signaling/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['yjs'],
  },
})
