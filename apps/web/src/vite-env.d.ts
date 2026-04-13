/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 局域网信令服务器 URL，由 start.sh 自动注入（多人协作用）
   *  例：ws://192.168.1.5:3010
   *  未注入时 adapter 降级到 Vite proxy（单机开发）
   */
  readonly VITE_SIGNALING_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
