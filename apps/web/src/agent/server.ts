/**
 * SyncThink Agent Server
 * 监听 localhost:9527，暴露 HTTP + WebSocket 接口给 AI Agent 程序化操作画布
 *
 * Phase 1 实现：
 * - POST /shapes        写入新 shape（text/arrow/sticky）
 * - DELETE /shapes/:id  删除 shape
 * - GET /shapes         读取当前画布所有 shape
 * - WS /events          实时推送画布变更事件
 *
 * Auth（Phase 1）：Bearer token = NodeIdentity.publicKey（hex）
 * Stage 2 升级为 Ed25519 消息签名验证
 */

export interface AgentShape {
  type: 'text' | 'arrow' | 'sticky' | 'geo'
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  color?: string
  /** arrow only */
  start?: { x: number; y: number }
  end?: { x: number; y: number }
}

export interface AgentCommand {
  action: 'create' | 'update' | 'delete' | 'clear'
  shape?: AgentShape
  id?: string
}

export interface AgentEvent {
  type: 'shape:added' | 'shape:updated' | 'shape:removed' | 'canvas:cleared'
  shapeId?: string
  shape?: AgentShape
  timestamp: number
}

/**
 * AgentBridge: 前端侧的桥接层
 * 注入 tldraw editor 引用后，接收来自 localhost:9527 的指令并执行
 *
 * 由于浏览器无法直接监听 TCP/WS 服务端，Phase 1 通过
 * SharedWorker + BroadcastChannel 实现跨 tab 的 Agent 指令转发。
 * 实际 HTTP/WS 服务由配套的 Electron 主进程 or Vite 插件代理处理。
 *
 * Phase 1 简化方案：Agent 通过 postMessage 写入 BroadcastChannel，
 * 页面监听后执行 tldraw editor 操作。
 */
export class AgentBridge {
  private channel: BroadcastChannel
  private listeners: Array<(event: AgentEvent) => void> = []

  constructor(channelName = 'syncthink-agent') {
    this.channel = new BroadcastChannel(channelName)
    this.channel.addEventListener('message', (e) => {
      const cmd = e.data as AgentCommand
      this._dispatch(cmd)
    })
  }

  /** 注册画布事件监听（用于向 Agent 推送变更） */
  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  /** 画布侧调用：通知 Agent 发生了变更 */
  emit(event: AgentEvent) {
    this.listeners.forEach((fn) => fn(event))
  }

  private _dispatch(cmd: AgentCommand) {
    // 触发内部事件，CanvasPage 监听后执行 tldraw 操作
    window.dispatchEvent(new CustomEvent('agent:command', { detail: cmd }))
  }

  destroy() {
    this.channel.close()
  }
}

/** 单例 AgentBridge，全局共用 */
export const agentBridge = new AgentBridge()
