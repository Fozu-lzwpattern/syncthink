/**
 * SyncThink 能力令牌操作：颁发、验证、吊销、序列化
 *
 * 设计参考：syncthink-access-protocol-design.md §四
 *
 * 注意：使用 @noble/ed25519 v3
 *   import * as ed from '@noble/ed25519'
 *   ed.signAsync(message, privKey)      // Uint8Array → Uint8Array
 *   ed.verifyAsync(sig, message, pubKey) // 返回 boolean
 */

import * as ed from '@noble/ed25519'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'
import type { CapabilityToken, Capability, TokenRole } from './types.js'
import { ROLE_CAPABILITIES } from './types.js'
import type { TokenVerifyResult } from './types.js'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const SYNCTHINK_DIR       = path.join(os.homedir(), '.syncthink')
const REVOKED_TOKENS_PATH = path.join(SYNCTHINK_DIR, 'revoked-tokens.json')
const DEFAULT_TTL_MS      = 24 * 60 * 60 * 1000  // 24 小时

// ─── 内存吊销黑名单（启动时从磁盘加载） ────────────────────────────────────────

const revokedNonces: Set<string> = loadRevokedFromDisk()

function loadRevokedFromDisk(): Set<string> {
  try {
    if (!fs.existsSync(REVOKED_TOKENS_PATH)) return new Set()
    const raw = fs.readFileSync(REVOKED_TOKENS_PATH, 'utf8')
    const arr = JSON.parse(raw) as string[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function persistRevoked(): void {
  try {
    if (!fs.existsSync(SYNCTHINK_DIR)) fs.mkdirSync(SYNCTHINK_DIR, { recursive: true })
    fs.writeFileSync(REVOKED_TOKENS_PATH, JSON.stringify([...revokedNonces], null, 2), 'utf8')
  } catch (err) {
    console.warn('[capability-token] ⚠️ failed to persist revoked-tokens.json:', err)
  }
}

// ─── base64url 工具 ────────────────────────────────────────────────────────────

function toBase64Url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64Url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + '='.repeat(pad), 'base64')
}

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
}

// ─── 签名载荷构建 ──────────────────────────────────────────────────────────────

/**
 * 构建用于 Ed25519 签名的载荷字符串
 * 格式：`${iss}:${aud}:${cap.join(',')}:${nbf}:${exp}:${nonce}`
 */
export function buildTokenPayload(token: Omit<CapabilityToken, 'sig'>): string {
  return `${token.iss}:${token.aud}:${token.cap.join(',')}:${token.nbf}:${token.exp}:${token.nonce}`
}

// ─── 颁发令牌 ──────────────────────────────────────────────────────────────────

export interface IssueTokenParams {
  /** 颁发者节点 ID */
  issNodeId: string
  /** 颁发者 Ed25519 私钥（hex） */
  issPrivateKey: string
  /** 受众节点 ID */
  audNodeId: string
  /** 角色（用于从 ROLE_CAPABILITIES 映射能力；与 capabilities 二选一或互补） */
  role?: TokenRole
  /** 显式指定能力列表（优先级高于 role，若同时提供则取并集） */
  capabilities?: Capability[]
  /** 有效期（毫秒，默认 24 小时） */
  expiresInMs?: number
}

/**
 * 颁发能力令牌
 * 用 owner Ed25519 私钥签名，返回完整 CapabilityToken
 */
export async function issueToken(params: IssueTokenParams): Promise<CapabilityToken> {
  const {
    issNodeId,
    issPrivateKey,
    audNodeId,
    role,
    capabilities,
    expiresInMs = DEFAULT_TTL_MS,
  } = params

  // 合并能力
  const roleCaps: Capability[] = role ? ROLE_CAPABILITIES[role] : []
  const extraCaps: Capability[] = capabilities ?? []
  const capSet = new Set<Capability>([...roleCaps, ...extraCaps])
  const cap = [...capSet]

  const nowSec  = Math.floor(Date.now() / 1000)
  const expSec  = Math.floor((Date.now() + expiresInMs) / 1000)
  const nonce   = randomBytes(8).toString('hex')

  const partial: Omit<CapabilityToken, 'sig'> = {
    iss:   issNodeId,
    aud:   audNodeId,
    cap,
    nbf:   nowSec,
    exp:   expSec,
    nonce,
  }

  const payload  = buildTokenPayload(partial)
  const msgBytes = new TextEncoder().encode(payload)
  const privKey  = fromHex(issPrivateKey)

  const sigBytes = await ed.signAsync(msgBytes, privKey)
  const sig      = toBase64Url(sigBytes)

  return { ...partial, sig }
}

// ─── 验证令牌 ──────────────────────────────────────────────────────────────────

/**
 * 验证令牌：签名 + 时间戳 + 吊销状态
 *
 * @param tokenStr      base64url 序列化的令牌字符串
 * @param ownerPublicKey owner 的 Ed25519 公钥（hex）
 */
export async function verifyToken(
  tokenStr: string,
  ownerPublicKey: string
): Promise<TokenVerifyResult> {
  // 1. 反序列化
  const token = deserializeToken(tokenStr)
  if (!token) {
    return { allowed: false, reason: 'invalid_token_format' }
  }

  // 2. 时间戳检查
  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec < token.nbf) {
    return { allowed: false, reason: 'token_not_yet_valid' }
  }
  if (nowSec > token.exp) {
    return { allowed: false, reason: 'token_expired' }
  }

  // 3. 吊销检查
  if (isRevoked(token.nonce)) {
    return { allowed: false, reason: 'token_revoked' }
  }

  // 4. 签名验证
  try {
    const payload  = buildTokenPayload(token)
    const msgBytes = new TextEncoder().encode(payload)
    const sigBytes = fromBase64Url(token.sig)
    const pubKey   = fromHex(ownerPublicKey)

    const valid = await ed.verifyAsync(
      new Uint8Array(sigBytes),
      msgBytes,
      pubKey
    )
    if (!valid) {
      return { allowed: false, reason: 'signature_invalid' }
    }
  } catch {
    return { allowed: false, reason: 'signature_invalid' }
  }

  return { allowed: true, token }
}

// ─── 吊销令牌 ──────────────────────────────────────────────────────────────────

/**
 * 吊销令牌：加入内存黑名单 + 持久化到磁盘
 *
 * @param nonce 令牌的 nonce 字段
 */
export function revokeToken(nonce: string): void {
  revokedNonces.add(nonce)
  persistRevoked()
}

/**
 * 检查 nonce 是否已被吊销
 */
export function isRevoked(nonce: string): boolean {
  return revokedNonces.has(nonce)
}

// ─── 序列化 / 反序列化 ────────────────────────────────────────────────────────

/**
 * 序列化令牌：JSON → base64url
 */
export function serializeToken(token: CapabilityToken): string {
  const json = JSON.stringify(token)
  return toBase64Url(Buffer.from(json, 'utf8'))
}

/**
 * 反序列化令牌：base64url → CapabilityToken | null
 */
export function deserializeToken(tokenStr: string): CapabilityToken | null {
  try {
    const buf  = fromBase64Url(tokenStr)
    const json = buf.toString('utf8')
    const obj  = JSON.parse(json) as CapabilityToken

    // 基础字段校验
    if (
      typeof obj.iss   !== 'string' ||
      typeof obj.aud   !== 'string' ||
      !Array.isArray(obj.cap)        ||
      typeof obj.nbf   !== 'number' ||
      typeof obj.exp   !== 'number' ||
      typeof obj.nonce !== 'string' ||
      typeof obj.sig   !== 'string'
    ) {
      return null
    }

    return obj
  } catch {
    return null
  }
}

// ─── Owner 密钥对管理（供 agentApi.ts 调用） ────────────────────────────────────

const OWNER_KEY_PATH = path.join(SYNCTHINK_DIR, 'owner.json')

export interface OwnerKeyPair {
  nodeId:     string
  publicKey:  string  // hex
  privateKey: string  // hex
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 加载或生成 owner 密钥对
 * - 从 `~/.syncthink/owner.json` 读取
 * - 若不存在，用 @noble/ed25519 生成并保存
 */
export async function loadOrCreateOwnerKeyPair(): Promise<OwnerKeyPair> {
  if (fs.existsSync(OWNER_KEY_PATH)) {
    const raw = fs.readFileSync(OWNER_KEY_PATH, 'utf8')
    return JSON.parse(raw) as OwnerKeyPair
  }

  // 生成新密钥对
  const privateKeyBytes = ed.utils.randomSecretKey()
  const publicKeyBytes  = await ed.getPublicKeyAsync(privateKeyBytes)

  const privateKey = toHex(privateKeyBytes)
  const publicKey  = toHex(publicKeyBytes)
  const nodeId     = `owner-${randomBytes(4).toString('hex')}`

  const pair: OwnerKeyPair = { nodeId, publicKey, privateKey }

  if (!fs.existsSync(SYNCTHINK_DIR)) fs.mkdirSync(SYNCTHINK_DIR, { recursive: true })
  fs.writeFileSync(OWNER_KEY_PATH, JSON.stringify(pair, null, 2), 'utf8')

  console.log(`[capability-token] ✅ generated owner key pair → ${OWNER_KEY_PATH}`)
  console.log(`[capability-token]    nodeId:    ${nodeId}`)
  console.log(`[capability-token]    publicKey: ${publicKey}`)

  return pair
}
