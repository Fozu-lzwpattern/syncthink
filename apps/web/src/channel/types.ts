/**
 * Channel 抽象 — A2A 网络的基本信道单元
 *
 * Phase 1 只实现 type='session'（临时会话）
 * type='persistent' 在 Stage 2 扩展，但结构已完整预留
 *
 * channelId = Yjs doc ID = y-webrtc roomName（三者统一，零歧义）
 */

export interface Channel {
  channelId: string           // nanoid(10)，全局唯一
  type: 'session' | 'persistent'
  name: string
  ownerNodeId: string         // 创建者 nodeId
  createdAt: number
  members: ChannelMember[]
  sceneId: string             // 'free' | 'meeting' | 'local-services-v1' | ...
  inviteCode?: string         // 邀请码（含签名）
  /**
   * 访问控制策略
   * - 'whitelist'（默认）：只有 trustedNodes 中的 publicKey 才能加入
   * - 'open'：任意节点可加入（需配合 bannedNodes 黑名单）
   */
  accessPolicy?: 'whitelist' | 'open'
  /**
   * 白名单：允许加入的节点 publicKey 列表（Ed25519 hex）
   * accessPolicy='whitelist' 时生效，不在列表内的节点握手被拒绝
   */
  trustedNodes?: string[]
  /**
   * 黑名单：禁止加入的节点 publicKey 列表（Ed25519 hex）
   * 预留字段，Phase 4+ 开放 Channel 场景实现
   * accessPolicy='open' 时用于踢出已加入的恶意节点
   */
  bannedNodes?: string[]
  metadata?: Record<string, unknown>
}

export interface ChannelMember {
  nodeId: string
  displayName: string
  color: string
  role: 'owner' | 'editor' | 'viewer'
  permissions: MemberPermissions
  joinedAt: number
  isOnline: boolean
}

export interface MemberPermissions {
  read: boolean
  write: boolean
  deleteOthers: boolean
  inviteMembers: boolean
  manageScene: boolean
}

export const DEFAULT_EDITOR_PERMISSIONS: MemberPermissions = {
  read: true,
  write: true,
  deleteOthers: false,
  inviteMembers: true,
  manageScene: false,
}

export const DEFAULT_OWNER_PERMISSIONS: MemberPermissions = {
  read: true,
  write: true,
  deleteOthers: true,
  inviteMembers: true,
  manageScene: true,
}
