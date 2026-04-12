import * as ed from '@noble/ed25519'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const SYNCTHINK_DIR = path.join(os.homedir(), '.syncthink')
const IDENTITY_PATH = path.join(SYNCTHINK_DIR, 'identity.json')

export interface AgentIdentity {
  nodeId: string       // SHA-256(publicKey) hex
  publicKey: string    // Ed25519 公钥 hex
  privateKey: string   // Ed25519 私钥 hex
  createdAt: number
}

/**
 * 计算 nodeId：SHA-256(publicKey bytes)
 */
export function computeNodeId(publicKeyHex: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyHex, 'hex'))
    .digest('hex')
}

/**
 * 只加载（不创建），不存在返回 null
 */
export function loadIdentity(): AgentIdentity | null {
  if (!fs.existsSync(IDENTITY_PATH)) return null
  try {
    const raw = fs.readFileSync(IDENTITY_PATH, 'utf-8')
    return JSON.parse(raw) as AgentIdentity
  } catch {
    return null
  }
}

/**
 * 生成 Ed25519 密钥对，保存到 ~/.syncthink/identity.json
 */
export async function createIdentity(): Promise<AgentIdentity> {
  // @noble/ed25519 v3 API: randomPrivateKey() renamed to randomSecretKey()
  const privateKeyBytes = ed.utils.randomSecretKey()           // Uint8Array 32 bytes
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes) // Uint8Array 32 bytes

  const privateKey = Buffer.from(privateKeyBytes).toString('hex')
  const publicKey = Buffer.from(publicKeyBytes).toString('hex')
  const nodeId = computeNodeId(publicKey)
  const createdAt = Date.now()

  const identity: AgentIdentity = { nodeId, publicKey, privateKey, createdAt }

  // 确保目录存在
  fs.mkdirSync(SYNCTHINK_DIR, { recursive: true })
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), 'utf-8')
  // 限制文件权限（仅 owner 可读写）
  fs.chmodSync(IDENTITY_PATH, 0o600)

  return identity
}

/**
 * 生成或加载 identity（同步包装异步创建）
 * 注意：调用者可能需要先检查是否已存在再决定是否调用此函数
 */
export async function getOrCreateIdentity(): Promise<AgentIdentity> {
  const existing = loadIdentity()
  if (existing) return existing
  return createIdentity()
}
