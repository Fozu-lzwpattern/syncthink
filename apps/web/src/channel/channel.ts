/**
 * Channel CRUD
 * 本地 Channel 列表存于 IndexedDB，key = `channel:${channelId}`
 */
import { db } from '../lib/db'
import type {
  Channel,
  ChannelMember,
} from './types'
import {
  DEFAULT_OWNER_PERMISSIONS,
  DEFAULT_EDITOR_PERMISSIONS,
} from './types'
import type { NodeIdentity } from '../identity/types'
import { nanoid } from './nanoid'

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
