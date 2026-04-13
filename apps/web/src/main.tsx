import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// NOTE: StrictMode 在开发模式下会双重执行 useEffect，导致 y-webrtc / Yjs
// 对同一 room 建立两个 Doc 并报错 "A Yjs Doc connected to room already exists"。
// SyncThink 的 CRDT 副作用（WebrtcProvider / IndexeddbPersistence）不兼容双重 mount，
// 因此移除 StrictMode，使用普通渲染。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.Fragment>
    <App />
  </React.Fragment>
)
