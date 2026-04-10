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
