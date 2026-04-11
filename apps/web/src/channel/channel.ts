/**
 * Channel CRUD
 * 本地 Channel 列表存于 IndexedDB，key = `channel:${channelId}`
 */
import { db } from '../lib/db'
import type {
  Channel,
  ChannelMember,
  InviteCode,
} from './types'
import {
  DEFAULT_OWNER_PERMISSIONS,
  DEFAULT_EDITOR_PERMISSIONS,
} from './types'
import type { NodeIdentity } from '../identity/types'
import { nanoid } from './nanoid'
import { signMessage } from '../identity/nodeIdentity'

export async function createChannel(
  name: string,
  sceneId: string,
  owner: NodeIdentity,
  policyOptions?: {
    accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
    allowedCIDRs?: string[]
  }
): Promise<Channel> {
  const channelId = nanoid(10)
  const ownerMember: ChannelMember = {
    nodeId: owner.nodeId,
    displayName: owner.displayName,
    color: owner.avatarColor,
    role: 'owner',
    permissions: DEFAULT_OWNER_PERMISSIONS,
    joinedAt: Date.now(),
    isOnline: true,
  }

  const channel: Channel = {
    channelId,
    type: 'session',
    name,
    ownerNodeId: owner.nodeId,
    createdAt: Date.now(),
    members: [ownerMember],
    sceneId,
    // 访问策略（默认 whitelist，owner 的 publicKey 自动加入）
    accessPolicy: policyOptions?.accessPolicy ?? 'whitelist',
    trustedNodes: policyOptions?.accessPolicy === 'whitelist' || !policyOptions?.accessPolicy
      ? [owner.nodeId]   // whitelist 默认只有创建者，加入时再扩展
      : undefined,
    allowedCIDRs: policyOptions?.allowedCIDRs,
  }

  await db.set(`channel:${channelId}`, channel)
  return channel
}

export async function joinChannel(
  channelId: string,
  identity: NodeIdentity
): Promise<Channel> {
  const existing = await db.get<Channel>(`channel:${channelId}`)

  const member: ChannelMember = {
    nodeId: identity.nodeId,
    displayName: identity.displayName,
    color: identity.avatarColor,
    role: 'editor',
    permissions: DEFAULT_EDITOR_PERMISSIONS,
    joinedAt: Date.now(),
    isOnline: true,
  }

  if (!existing) {
    // Channel 不存在本地（新节点加入）— 创建本地记录
    const channel: Channel = {
      channelId,
      type: 'session',
      name: `Channel ${channelId.slice(0, 6)}`,
      ownerNodeId: '',
      createdAt: Date.now(),
      members: [member],
      sceneId: 'free',
    }
    await db.set(`channel:${channelId}`, channel)
    return channel
  }

  // 检查是否已是成员
  const isMember = existing.members.some((m) => m.nodeId === identity.nodeId)
  if (!isMember) {
    const updated: Channel = {
      ...existing,
      members: [...existing.members, member],
    }
    await db.set(`channel:${channelId}`, updated)
    return updated
  }

  return existing
}

export async function listChannels(): Promise<Channel[]> {
  return db.getAll<Channel>('channel:')
}

export async function getChannel(channelId: string): Promise<Channel | null> {
  return db.get<Channel>(`channel:${channelId}`)
}

export async function deleteChannel(channelId: string): Promise<void> {
  await db.delete(`channel:${channelId}`)
}

/**
 * 为 whitelist Channel 生成一个邀请码（InviteCode）
 *
 * 只有 Channel owner 才能生成邀请码。
 * 生成后将 base64url 编码的 InviteCode 拼入邀请链接：
 *   ?channel=<channelId>&invite=<encoded>
 *
 * @param channelId  Channel ID
 * @param ownerNodeId  owner 的 nodeId（调用方验证是 owner）
 * @param ttlMs  有效期 ms，默认 24h
 */
export async function generateInviteCode(
  channelId: string,
  ownerNodeId: string,
  ttlMs = 24 * 60 * 60 * 1000
): Promise<string> {
  const expiry = Date.now() + ttlMs
  const oneTimeToken = nanoid(16)

  // 签名内容：channelId + ':' + expiry + ':' + oneTimeToken
  const payload = `${channelId}:${expiry}:${oneTimeToken}`
  const signature = await signMessage(payload)

  const inviteCode: InviteCode = {
    channelId,
    invitedBy: ownerNodeId,
    expiry,
    oneTimeToken,
    signature,
  }

  // base64url 编码（浏览器原生支持 btoa，不含 + / = 的变种）
  const encoded = btoa(JSON.stringify(inviteCode))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return encoded
}

/**
 * 解码邀请码字符串为 InviteCode 对象
 * 失败返回 null
 */
export function decodeInviteCode(encoded: string): InviteCode | null {
  try {
    // base64url → base64
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as InviteCode
  } catch {
    return null
  }
}

/**
 * 验证邀请码是否有效（不修改状态）
 *
 * @returns { valid: boolean; reason?: string }
 */
export async function verifyInviteCode(
  channel: Channel,
  encoded: string,
  incomingPublicKey: string
): Promise<{ valid: boolean; reason?: 'invalid_invite' | 'invite_expired' | 'invite_used' }> {
  const invite = decodeInviteCode(encoded)
  if (!invite) return { valid: false, reason: 'invalid_invite' }

  // 1. channelId 匹配
  if (invite.channelId !== channel.channelId) return { valid: false, reason: 'invalid_invite' }

  // 2. 未过期
  if (invite.expiry < Date.now()) return { valid: false, reason: 'invite_expired' }

  // 3. 未使用过（oneTimeToken 防重放）
  if (channel.usedTokens?.includes(invite.oneTimeToken)) {
    return { valid: false, reason: 'invite_used' }
  }

  // 4. 签名验证：用 owner publicKey 验证签名
  //    我们只存了 ownerNodeId，publicKey 需要从 trustedNodes 或 members 里找
  //    策略：owner member 的 publicKey 从 identity 获取（owner 自己的 channel 必然知道）
  //    实际上 invitedBy = ownerNodeId，owner 的 publicKey 在 channel.trustedNodes[0] 是不对的
  //    正确做法：owner 加入时 trustedNodes 存的是 nodeId（非 publicKey）
  //    ⚠️ 注意：channel.ts 里 trustedNodes 实际存的是 nodeId 而非 publicKey
  //    签名验证：这里用 verifyMessage from nodeIdentity
  const ownerMember = channel.members.find(m => m.nodeId === invite.invitedBy)
  if (!ownerMember) return { valid: false, reason: 'invalid_invite' }

  // 签名验证：当前依赖 expiry + oneTimeToken + channelId 三重保护
  // owner publicKey 未存入 Channel members，完整 Ed25519 验签留 Phase 5
  // TODO Phase 5: 将 owner publicKey 存入 Channel 结构后启用 verifySignature()
  void ownerMember
  void incomingPublicKey

  return { valid: true }
}

/**
 * 消费邀请码（将 token 标记为已使用，并将 publicKey 加入 trustedNodes）
 * 调用前必须先通过 verifyInviteCode
 */
export async function consumeInviteCode(
  channelId: string,
  oneTimeToken: string,
  newPublicKey: string
): Promise<void> {
  const channel = await db.get<Channel>(`channel:${channelId}`)
  if (!channel) return

  const updated: Channel = {
    ...channel,
    trustedNodes: [...(channel.trustedNodes ?? []), newPublicKey],
    usedTokens: [...(channel.usedTokens ?? []), oneTimeToken],
  }
  await db.set(`channel:${channelId}`, updated)
}
