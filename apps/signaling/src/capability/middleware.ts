/**
 * SyncThink 能力令牌中间件
 * 提供 HTTP 请求中令牌提取和能力检查的工具函数
 */

import type * as http from 'http'
import { verifyToken } from './token.js'
import { ACTION_CAPABILITY_MAP } from './types.js'
import type { TokenVerifyResult } from './types.js'

// ─── Bearer Token 提取 ────────────────────────────────────────────────────────

/**
 * 从 HTTP 请求的 Authorization header 中提取 Bearer token
 *
 * @returns token 字符串，或 null（无 Bearer token）
 */
export function extractBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers['authorization']
  if (!auth || typeof auth !== 'string') return null

  const match = auth.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  return match[1].trim()
}

// ─── 能力检查 ─────────────────────────────────────────────────────────────────

/**
 * 验证请求中的能力令牌，并检查是否拥有执行 action 所需的能力
 *
 * @param req            HTTP 请求对象
 * @param action         需要执行的操作名称（对应 ACTION_CAPABILITY_MAP）
 * @param ownerPublicKey owner 的 Ed25519 公钥（hex），用于验签
 * @returns TokenVerifyResult（allowed 或 denied + reason）
 */
export async function checkCapability(
  req: http.IncomingMessage,
  action: string,
  ownerPublicKey: string
): Promise<TokenVerifyResult> {
  // 1. 提取 Bearer token
  const tokenStr = extractBearerToken(req)
  if (!tokenStr) {
    return { allowed: false, reason: 'no_bearer_token' }
  }

  // 2. 验证令牌签名 + 时间 + 吊销
  const verifyResult = await verifyToken(tokenStr, ownerPublicKey)
  if (!verifyResult.allowed) {
    return verifyResult
  }

  // 3. 检查 action 所需能力
  // 若 action 为空字符串或不在映射中，则不做能力限制（保持兼容）
  if (action) {
    const requiredCap = ACTION_CAPABILITY_MAP[action]
    if (requiredCap) {
      const hasCap = verifyResult.token.cap.includes(requiredCap)
      if (!hasCap) {
        return {
          allowed: false,
          reason: `capability_denied: action '${action}' requires '${requiredCap}', token has [${verifyResult.token.cap.join(', ')}]`,
        }
      }
    }
  }

  return verifyResult
}

// ─── 旧版鉴权检测 ─────────────────────────────────────────────────────────────

/**
 * 检查请求是否包含旧版 Ed25519 签名 headers
 *   X-Node-Id / X-Timestamp / X-Signature
 *
 * 用于向后兼容判断：有旧版 headers → 走旧版验签；有 Bearer → 走能力令牌。
 */
export function hasLegacyAuth(req: http.IncomingMessage): boolean {
  return (
    typeof req.headers['x-node-id']    === 'string' &&
    typeof req.headers['x-timestamp']  === 'string' &&
    typeof req.headers['x-signature']  === 'string'
  )
}
