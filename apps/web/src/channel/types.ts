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
   * - 'lan-only'：只允许 RFC1918 局域网 IP 的节点加入（信令服务器检测源 IP）
   * - 'cidr'：自定义 IP 段白名单，配合 allowedCIDRs 使用
   */
  accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
  /**
   * 白名单：允许加入的节点 publicKey 列表（Ed25519 hex）
   * accessPolicy='whitelist' 时生效，不在列表内的节点握手被拒绝
   */
  trustedNodes?: string[]
  /**
   * IP 段白名单：允许加入的 CIDR 列表
   * accessPolicy='cidr' 时生效，例如：['10.0.0.0/8', '192.168.1.0/24']
   * 信令服务器以 WS 握手时的 socket.remoteAddress 为准（不可伪造）
   */
  allowedCIDRs?: string[]
  /**
   * 黑名单：禁止加入的节点 publicKey 列表（Ed25519 hex）
   * 预留字段，Phase 4+ 开放 Channel 场景实现
   * accessPolicy='open' 时用于踢出已加入的恶意节点
   */
  bannedNodes?: string[]
  /**
   * 已使用的 inviteCode oneTimeToken 列表（防重放）
   * 每次验证通过后将 token 加入此列表，拒绝重复使用
   */
  usedTokens?: string[]
  /**
   * 已吊销的 inviteCode oneTimeToken 列表（单个吊销）
   * owner 主动吊销时加入此列表，立即失效即使未过期
   */
  revokedTokens?: string[]
  /**
   * 全量吊销时间戳（Unix ms）
   * 所有 issuedAt <= revokedBefore 的邀请码立即失效
   * 之后新生成的邀请码（issuedAt > revokedBefore）不受影响
   */
  revokedBefore?: number
  metadata?: Record<string, unknown>
}

/**
 * 邀请码（用于 whitelist 策略下允许新节点加入）
 *
 * 生成：由 Channel owner 调用 generateInviteCode()
 * 使用：新节点携带 inviteToken 参数加入，owner 侧浏览器验证
 *
 * 验证流程：
 * 1. expiry > Date.now()（未过期）
 * 2. oneTimeToken 未被使用过（channel.usedTokens）
 * 3. Ed25519 签名验证（owner 私钥签名）
 */
export interface InviteCode {
  channelId: string
  invitedBy: string        // owner nodeId
  expiry: number           // Unix ms，默认 now + 24h
  issuedAt: number         // Unix ms，生成时间（用于全量吊销时比较）
  oneTimeToken: string     // nanoid(16)，防重放
  signature: string        // Ed25519 sign(channelId + expiry + oneTimeToken, ownerPrivKey)
}

/**
 * 准入结果（peer_admit / peer_reject）
 */
export interface PeerAdmitMsg {
  type: 'syncthink:peer_admit'
  nodeId: string
  publicKey: string
  role: 'owner' | 'editor' | 'viewer'
  timestamp: number
}

export interface PeerRejectMsg {
  type: 'syncthink:peer_reject'
  nodeId: string
  reason: 'banned' | 'not_trusted' | 'invalid_invite' | 'invite_expired' | 'invite_used' | 'invite_revoked'
  timestamp: number
}

export interface ChannelMember {
  nodeId: string
  /** Ed25519 公钥 hex（用于 InviteCode 签名验证） */
  publicKey: string
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
