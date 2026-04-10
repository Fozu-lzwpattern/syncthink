/**
 * NodeIdentity — A2A 网络的基础身份单元
 * 首次启动自动生成，持久化存储于 IndexedDB，永不变更
 * nodeId = SHA-256(publicKey)，全网唯一，可验证
 */
export interface NodeIdentity {
  nodeId: string       // SHA-256(publicKey)，全局唯一标识
  publicKey: string    // Ed25519 公钥（hex），可公开分享
  displayName: string  // 人类可读名称
  avatarColor: string  // 光标颜色（派生自 nodeId，固定不变）
  createdAt: number
  version: string      // 身份版本，支持未来密钥轮换
}

/**
 * Agent 身份 — 与人类成员平级的网络参与者
 */
export interface AgentIdentity {
  nodeId: string
  displayName: string
  color: string
  isAgent: true
  ownerNodeId: string    // 属于哪个人类节点
  capabilities: AgentCapabilities
}

export interface AgentCapabilities {
  read: boolean
  write: boolean
  canWriteCardTypes?: string[]       // 限制可写的卡片类型
  requiresConfirmation: boolean      // 写入是否需要人工确认
  maxCardsPerMinute?: number
}
