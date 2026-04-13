/**
 * SyncThink 局域网自动发现模块
 *
 * 功能：
 * - 通过 mDNS (_syncthink._tcp) 广播本机信令服务
 * - 发现局域网内其他 SyncThink 实例
 * - 维护活跃节点列表，支持节点上下线回调
 * - 在 TXT 记录中携带 nodeId / startTime，用于 Leader 宕机后的选主
 *
 * 使用方式：
 * ```ts
 * const discovery = new LanDiscovery({ port: 4444, nodeId: 'abc12345', verbose: true })
 * await discovery.scan(3000)           // 先扫描 3000ms，判断是否已有 Leader
 * const peers = discovery.getPeers()  // 获取当前发现的节点列表
 * discovery.startAdvertising()        // 成为 Leader 后开始广播自己
 * discovery.on('peer:found', ...)
 * discovery.on('peer:lost', ...)
 * discovery.stop()                    // 停止
 * ```
 */

import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { EventEmitter } from 'events'

const SERVICE_TYPE = 'syncthink'
const SERVICE_PROTOCOL = 'tcp'

export interface SignalingPeer {
  /** 节点唯一标识（UUID v4 前8位） */
  nodeId: string
  /** 局域网 IP */
  host: string
  /** 信令端口 */
  port: number
  /** 节点启动时间戳（用于选主） */
  startTime: number
  /** mDNS 实例名（内部去重用） */
  instanceName: string
}

export interface LanDiscoveryOptions {
  port: number
  nodeId: string
  verbose?: boolean
}

export class LanDiscovery extends EventEmitter {
  private bonjour: Bonjour
  private browser: Browser | null = null
  private service: ReturnType<Bonjour['publish']> | null = null

  private port: number
  private nodeId: string
  private startTime: number
  private verbose: boolean

  /** key = instanceName */
  private peers = new Map<string, SignalingPeer>()

  constructor(opts: LanDiscoveryOptions) {
    super()
    this.port = opts.port
    this.nodeId = opts.nodeId
    this.startTime = Date.now()
    this.verbose = opts.verbose ?? true
    this.bonjour = new Bonjour()
  }

  private log(...args: unknown[]) {
    if (this.verbose) console.log('[discovery]', ...args)
  }

  /**
   * 扫描局域网 mDNS，等待指定毫秒数后返回
   * 在此期间收到的节点会加入 peers 列表
   * 调用前不广播自己（避免自己发现自己）
   */
  scan(waitMs = 3000): Promise<SignalingPeer[]> {
    return new Promise((resolve) => {
      this.log(`scanning LAN for ${waitMs}ms…`)

      this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL })

      this.browser.on('up', (service: Service) => {
        this._onServiceUp(service)
      })

      this.browser.on('down', (service: Service) => {
        this._onServiceDown(service)
      })

      setTimeout(() => {
        this.log(`scan complete, found ${this.peers.size} peer(s)`)
        resolve(this.getPeers())
      }, waitMs)
    })
  }

  /**
   * 开始广播本机信令服务（成为 Leader 后调用）
   */
  startAdvertising() {
    if (this.service) return // 已经在广播

    const instanceName = `SyncThink-${this.nodeId}`
    this.log(`advertising as "${instanceName}" on port ${this.port}`)

    this.service = this.bonjour.publish({
      name: instanceName,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.port,
      txt: {
        nodeId: this.nodeId,
        startTime: String(this.startTime),
        version: '1',
      },
    })

    this.service.on('error', (err: Error) => {
      this.log('advertise error:', err.message)
    })
  }

  /**
   * 停止广播（Follower 模式不需要广播）
   */
  stopAdvertising() {
    if (this.service) {
      this.service.stop?.()
      this.service = null
      this.log('stopped advertising')
    }
  }

  /**
   * 获取当前发现的所有节点（按 startTime 升序排列，最早的在前）
   */
  getPeers(): SignalingPeer[] {
    return [...this.peers.values()].sort((a, b) => a.startTime - b.startTime)
  }

  /**
   * 获取最早启动的节点（Leader 候选）
   */
  getOldestPeer(): SignalingPeer | null {
    const sorted = this.getPeers()
    return sorted.length > 0 ? sorted[0] : null
  }

  /**
   * 停止所有 mDNS 活动（广播 + 发现）
   */
  stop() {
    this.stopAdvertising()
    if (this.browser) {
      this.browser.stop()
      this.browser = null
    }
    this.bonjour.destroy()
    this.peers.clear()
    this.log('stopped')
  }

  // ─── 内部处理 ──────────────────────────────────────────────────────────────

  private _onServiceUp(service: Service) {
    const instanceName = service.name
    const host = service.host ?? service.referer?.address ?? ''
    const port = service.port
    const txt = service.txt as Record<string, string> | undefined

    // 过滤自己（instanceName 相同）
    if (instanceName === `SyncThink-${this.nodeId}`) return

    if (!host || !port) {
      this.log(`peer found but missing host/port, skipping: ${instanceName}`)
      return
    }

    const peer: SignalingPeer = {
      nodeId: txt?.nodeId ?? instanceName,
      host,
      port,
      startTime: txt?.startTime ? Number(txt.startTime) : 0,
      instanceName,
    }

    this.peers.set(instanceName, peer)
    this.log(`peer found: ${peer.nodeId} @ ${peer.host}:${peer.port} (startTime=${peer.startTime})`)
    this.emit('peer:found', peer)
  }

  private _onServiceDown(service: Service) {
    const instanceName = service.name
    const peer = this.peers.get(instanceName)
    if (peer) {
      this.peers.delete(instanceName)
      this.log(`peer lost: ${peer.nodeId} @ ${peer.host}:${peer.port}`)
      this.emit('peer:lost', peer)
    }
  }
}
