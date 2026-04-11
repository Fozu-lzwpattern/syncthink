/**
 * AgentClient — Agent 侧发指令的封装
 *
 * 功能：
 * - 首次调用自动生成 Ed25519 密钥对（存 localStorage）
 * - 每次 send() 自动签名，通过 BroadcastChannel 发送给 AgentBridge
 * - 支持浏览器端和 Node.js 环境（测试 / CI 脚本）
 *
 * 用法（浏览器控制台或 Agent 脚本）：
 * ```ts
 * const client = await AgentClient.create()
 * await client.send({ action: 'create', data: { type: 'text', x: 100, y: 100, text: 'hello from agent' } })
 * await client.send({ action: 'clear' })
 * ```
 */

import * as ed from '@noble/ed25519'
import { signCommand, type AgentCommandPayload } from './auth'

// noble/ed25519 v2 sha512 shim
if (typeof crypto !== 'undefined' && crypto.subtle) {
  ed.etc.sha512Async = async (...msgs: Uint8Array[]) => {
    const data = ed.etc.concatBytes(...msgs)
    const buf = await crypto.subtle.digest('SHA-512', data.buffer as ArrayBuffer)
    return new Uint8Array(buf)
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer)
  return hex(new Uint8Array(buf))
}

const STORAGE_KEY = 'syncthink:agent_key_v1'

interface StoredKeyPair {
  privateKey: number[]  // Uint8Array → 普通数组，方便 JSON 序列化
  publicKey: string     // hex
  nodeId: string
}

export class AgentClient {
  private privateKey: Uint8Array
  readonly publicKey: string
  readonly nodeId: string
  private channel: BroadcastChannel

  private constructor(
    privateKey: Uint8Array,
    publicKey: string,
    nodeId: string,
    channelName: string
  ) {
    this.privateKey = privateKey
    this.publicKey = publicKey
    this.nodeId = nodeId
    this.channel = new BroadcastChannel(channelName)
  }

  /**
   * 工厂方法：初始化 AgentClient
   * 已有密钥则从 localStorage 恢复，否则生成新密钥
   */
  static async create(channelName = 'syncthink-agent'): Promise<AgentClient> {
    let stored: StoredKeyPair | null = null

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) stored = JSON.parse(raw) as StoredKeyPair
    } catch {
      // localStorage 不可用（Node 环境），继续生成
    }

    let privateKey: Uint8Array
    let publicKeyHex: string
    let nodeId: string

    if (stored) {
      privateKey = new Uint8Array(stored.privateKey)
      publicKeyHex = stored.publicKey
      nodeId = stored.nodeId
      console.log(`[AgentClient] restored identity: nodeId=${nodeId.slice(0, 12)}…`)
    } else {
      privateKey = ed.utils.randomPrivateKey()
      const publicKey = await ed.getPublicKeyAsync(privateKey)
      publicKeyHex = hex(publicKey)
      nodeId = await sha256hex(publicKey)

      try {
        const toStore: StoredKeyPair = {
          privateKey: Array.from(privateKey),
          publicKey: publicKeyHex,
          nodeId,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
      } catch {
        // 静默失败（Node 环境）
      }

      console.log(`[AgentClient] new identity: nodeId=${nodeId.slice(0, 12)}…`)
    }

    return new AgentClient(privateKey, publicKeyHex, nodeId, channelName)
  }

  /**
   * 发送指令（自动签名）
   */
  async send(payload: AgentCommandPayload): Promise<void> {
    const signed = await signCommand(payload, this.privateKey, this.publicKey, this.nodeId)
    this.channel.postMessage(signed)
    console.log(`[AgentClient] sent: action=${payload.action}, nodeId=${this.nodeId.slice(0, 12)}…`)
  }

  /**
   * 便捷方法：发送 create shape 指令
   */
  async createShape(shape: {
    type: 'text' | 'arrow' | 'sticky' | 'geo'
    x: number
    y: number
    w?: number
    h?: number
    text?: string
    color?: string
  }): Promise<void> {
    await this.send({ action: 'create', data: { shape } })
  }

  /**
   * 便捷方法：删除 shape
   */
  async deleteShape(id: string): Promise<void> {
    await this.send({ action: 'delete', data: { id } })
  }

  /**
   * 便捷方法：清空画布
   */
  async clearCanvas(): Promise<void> {
    await this.send({ action: 'clear' })
  }

  /**
   * 便捷方法：向 ConversationNode 追加一条消息
   * @param conversationId  目标 ConversationNode 的 shape ID（tldraw shape:xxx 格式）
   * @param content         消息内容
   * @param senderName      发送方名称（可选，默认用 nodeId 前缀）
   */
  async appendToConversation(
    conversationId: string,
    content: string,
    senderName?: string
  ): Promise<void> {
    await this.send({
      action: 'conversation:append',
      data: {
        conversationId,
        senderName: senderName ?? `Agent[${this.nodeId.slice(0, 6)}]`,
        content,
        isAgentMessage: true,
      },
    })
  }

  /**
   * P3: 生成并发送握手包给信令服务器
   * 节点加入 y-webrtc room 前，先通过此方法宣告身份
   *
   * 握手包签名内容：`${nodeId}:${roomId}:${timestamp}`
   * 信令服务器验签（AUTH_REQUIRED=true 时），通过后 room 内其他节点收到 peer_joined 事件
   *
   * @param signalingWs  已连接的信令 WebSocket
   * @param roomId       要加入的 room（= channelId）
   */
  /**
   * 向信令服务器发送握手包，宣告身份并（可选）携带 Channel 访问策略
   *
   * @param signalingWs    已连接的信令 WebSocket
   * @param roomId         要加入的 room（= channelId）
   * @param policyOptions  可选：Channel 创建者首次加入时携带策略，服务器缓存后对后续节点执行
   *                       - accessPolicy: 'lan-only' | 'cidr' | 'open' | 'whitelist'
   *                       - allowedCIDRs: ['10.0.0.0/8', '192.168.1.0/24']（cidr 策略时必填）
   */
  async joinChannel(
    signalingWs: WebSocket,
    roomId: string,
    policyOptions?: {
      accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
      allowedCIDRs?: string[]
    }
  ): Promise<void> {
    const timestamp = Date.now()
    const message = `${this.nodeId}:${roomId}:${timestamp}`
    const msgBytes = new TextEncoder().encode(message)
    const sigBytes = await ed.signAsync(msgBytes, this.privateKey)
    const signature = hex(sigBytes)

    const handshake: Record<string, unknown> = {
      type: 'syncthink:join',
      nodeId: this.nodeId,
      publicKey: this.publicKey,
      roomId,
      timestamp,
      signature,
    }

    // 携带访问策略（Channel 创建者首次加入时）
    if (policyOptions?.accessPolicy) {
      handshake.accessPolicy = policyOptions.accessPolicy
      if (policyOptions.allowedCIDRs) {
        handshake.allowedCIDRs = policyOptions.allowedCIDRs
      }
    }

    signalingWs.send(JSON.stringify(handshake))
    const policyLabel = policyOptions?.accessPolicy
      ? ` policy=${policyOptions.accessPolicy}`
      : ''
    console.log(`[AgentClient] join handshake sent: room=${roomId}, nodeId=${this.nodeId.slice(0, 12)}…${policyLabel}`)
  }

  destroy() {
    this.channel.close()
  }
}
