import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,   // 禁止 fallback 到 5174，确保 IndexedDB origin 稳定
    host: true,
    proxy: {
      // WS proxy: 浏览器连 ws://<host>:5173/signaling → 转发到本机 ws://localhost:3010
      // start.sh 默认 WSS=false，信令服务器跑 ws:// 纯 HTTP 模式，端口 3010
      '/signaling': {
        target: 'ws://localhost:3010',
        ws: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/signaling/, ''),
      },
      // HTTP proxy: GET /signaling-peers → 本机信令服务的 /peers 端点（LAN Discovery 用）
      '/signaling-peers': {
        target: 'http://localhost:3010',
        secure: false,
        rewrite: () => '/peers',
      },
    },
  },
  optimizeDeps: {
    exclude: ['yjs'],
  },
})
