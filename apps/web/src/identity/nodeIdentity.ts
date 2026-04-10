/**
 * NodeIdentity 管理器
 * - 首次启动自动生成 Ed25519 密钥对
 * - nodeId = SHA-256(publicKey)
 * - 私钥存储于独立 keystore（不混入普通 DB）
 * - avatarColor 由 nodeId 确定性派生（永不变更）
 */
import * as ed from '@noble/ed25519'
import { db } from '../lib/db'
import type { NodeIdentity } from './types'

// noble/ed25519 v2 需要手动注入 sha512（浏览器环境用 WebCrypto）
ed.etc.sha512Async = async (...msgs: Uint8Array[]) => {
  const data = ed.etc.concatBytes(...msgs)
  const buf = await crypto.subtle.digest('SHA-512', data.buffer as ArrayBuffer)
  return new Uint8Array(buf)
}

const IDENTITY_KEY = 'node_identity_v1'
const PRIVATE_KEY_KEY = 'private_key_v1'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer)
  return hex(new Uint8Array(buf))
}

/**
 * 由 nodeId 确定性派生头像颜色（HSL 色系，视觉友好）
 * 同一 nodeId 永远对应同一颜色
 */
export function deriveAvatarColor(nodeId: string): string {
  // 取 nodeId 前8字符算哈希
  const n = parseInt(nodeId.slice(0, 8), 16)
  const hue = n % 360
  return `hsl(${hue}, 70%, 60%)`
}

/**
 * 初始化节点身份
 * 已存在则直接返回，不存在则生成新的
 */
export async function initNodeIdentity(): Promise<NodeIdentity> {
  const existing = await db.get<NodeIdentity>(IDENTITY_KEY)
  if (existing) return existing

  // 生成 Ed25519 密钥对
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  const nodeId = await sha256hex(publicKey)

  // 私钥存入独立 keystore（不混入普通 DB）
  await db.set(PRIVATE_KEY_KEY, Array.from(privateKey))

  const identity: NodeIdentity = {
    nodeId,
    publicKey: hex(publicKey),
    displayName: `Node-${nodeId.slice(0, 6)}`,
    avatarColor: deriveAvatarColor(nodeId),
    createdAt: Date.now(),
    version: '1',
  }

  await db.set(IDENTITY_KEY, identity)
  return identity
}

/**
 * 更新 displayName（唯一可变字段）
 */
export async function updateDisplayName(name: string): Promise<NodeIdentity> {
  const identity = await getNodeIdentity()
  const updated = { ...identity, displayName: name }
  await db.set(IDENTITY_KEY, updated)
  return updated
}

export async function getNodeIdentity(): Promise<NodeIdentity> {
  const identity = await db.get<NodeIdentity>(IDENTITY_KEY)
  if (!identity) throw new Error('NodeIdentity not initialized')
  return identity
}

/**
 * 用私钥对消息签名（用于 Agent API 鉴权）
 */
export async function signMessage(message: string): Promise<string> {
  const privateKeyArr = await db.get<number[]>(PRIVATE_KEY_KEY)
  if (!privateKeyArr) throw new Error('Private key not found')
  const privateKey = new Uint8Array(privateKeyArr)
  const msgBytes = new TextEncoder().encode(message)
  const sig = await ed.signAsync(msgBytes, privateKey)
  return hex(sig)
}

/**
 * 验证签名（用于验证其他节点消息）
 */
export async function verifySignature(
  message: string,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const msgBytes = new TextEncoder().encode(message)
    const sig = Uint8Array.from(
      signatureHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
    )
    const pubKey = Uint8Array.from(
      publicKeyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
    )
    return await ed.verifyAsync(sig, msgBytes, pubKey)
  } catch {
    return false
  }
}
