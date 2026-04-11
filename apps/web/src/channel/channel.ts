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
import { signMessage, verifySignature } from '../identity/nodeIdentity'

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
    publicKey: owner.publicKey,
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
    publicKey: identity.publicKey,
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
  const issuedAt = Date.now()
  const expiry = issuedAt + ttlMs
  const oneTimeToken = nanoid(16)

  // 签名内容：channelId + ':' + expiry + ':' + oneTimeToken
  const payload = `${channelId}:${expiry}:${oneTimeToken}`
  const signature = await signMessage(payload)

  const inviteCode: InviteCode = {
    channelId,
    invitedBy: ownerNodeId,
    expiry,
    issuedAt,
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
): Promise<{ valid: boolean; reason?: 'invalid_invite' | 'invite_expired' | 'invite_used' | 'invite_revoked' }> {
  const invite = decodeInviteCode(encoded)
  if (!invite) return { valid: false, reason: 'invalid_invite' }

  // 1. channelId 匹配
  if (invite.channelId !== channel.channelId) return { valid: false, reason: 'invalid_invite' }

  // 2. 未过期
  if (invite.expiry < Date.now()) return { valid: false, reason: 'invite_expired' }

  // 3. 未被主动吊销
  //    3a. 全量吊销：invite.issuedAt <= channel.revokedBefore
  if (channel.revokedBefore && invite.issuedAt && invite.issuedAt <= channel.revokedBefore) {
    return { valid: false, reason: 'invite_revoked' }
  }
  //    3b. 单个 token 吊销
  if (channel.revokedTokens?.includes(invite.oneTimeToken)) {
    return { valid: false, reason: 'invite_revoked' }
  }

  // 4. 未使用过（oneTimeToken 防重放）
  if (channel.usedTokens?.includes(invite.oneTimeToken)) {
    return { valid: false, reason: 'invite_used' }
  }

  // 5. 签名验证：用 owner 的 Ed25519 publicKey 验证邀请码签名
  const ownerMember = channel.members.find(m => m.nodeId === invite.invitedBy)
  if (!ownerMember || !ownerMember.publicKey) return { valid: false, reason: 'invalid_invite' }

  // 签名内容与 generateInviteCode 保持一致
  const payload = `${invite.channelId}:${invite.expiry}:${invite.oneTimeToken}`
  const sigValid = await verifySignature(payload, invite.signature, ownerMember.publicKey)
  if (!sigValid) return { valid: false, reason: 'invalid_invite' }

  // incomingPublicKey 备用（未来可做 allow-once per key 扩展）
  void incomingPublicKey

  return { valid: true }
}

/**
 * 吊销一个邀请码（立即失效，即使未过期）
 * 只有 Channel owner 应该调用此函数
 */
export async function revokeInviteCode(
  channelId: string,
  oneTimeToken: string
): Promise<void> {
  const channel = await db.get<Channel>(`channel:${channelId}`)
  if (!channel) throw new Error(`Channel not found: ${channelId}`)

  // 避免重复添加
  if (channel.revokedTokens?.includes(oneTimeToken)) return

  const updated: Channel = {
    ...channel,
    revokedTokens: [...(channel.revokedTokens ?? []), oneTimeToken],
  }
  await db.set(`channel:${channelId}`, updated)
}

/**
 * 吊销该 Channel 下所有在当前时间之前生成的邀请码
 * 设置 revokedBefore = Date.now()，之后新生成的邀请码不受影响
 */
export async function revokeAllInviteCodes(channelId: string): Promise<void> {
  const channel = await db.get<Channel>(`channel:${channelId}`)
  if (!channel) throw new Error(`Channel not found: ${channelId}`)

  const updated: Channel = {
    ...channel,
    revokedBefore: Date.now(),
  }
  await db.set(`channel:${channelId}`, updated)
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
