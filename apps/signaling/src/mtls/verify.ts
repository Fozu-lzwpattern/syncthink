/**
 * SyncThink mTLS 客户端证书验证
 *
 * 在 TLS 握手之后、业务逻辑之前，从 TLSSocket 提取客户端证书信息并验证。
 *
 * 注意：仅当 https.createServer({ requestCert: true, rejectUnauthorized: false }) 时，
 * 未持有证书的客户端也能"连接"，但会被此模块在业务层拒绝。
 * 若设置 rejectUnauthorized: true，则未持有证书的客户端直接被 TLS 层拒绝。
 */

import type * as http  from 'http'
import type * as tls   from 'tls'
import * as crypto     from 'crypto'
import type { ClientCertInfo, MtlsCheckResult } from './types.js'

// ─── 客户端证书检查 ────────────────────────────────────────────────────────────

/**
 * 从 HTTP 请求中提取并验证客户端证书
 *
 * @param req  HTTP 请求（底层 socket 应为 TLSSocket）
 * @returns MtlsCheckResult
 */
export function checkClientCert(req: http.IncomingMessage): MtlsCheckResult {
  const socket = req.socket as tls.TLSSocket

  // 判断是否为 TLS 连接（未启用 TLS 时直接放行）
  if (!socket || typeof socket.getPeerCertificate !== 'function') {
    return { ok: false, reason: 'not_tls_connection' }
  }

  const cert = socket.getPeerCertificate(true)

  // 客户端未提供证书
  if (!cert || !cert.subject) {
    return { ok: false, reason: 'no_client_certificate' }
  }

  // 证书未被 CA 授权（authorized=false 且有 authorizationError 说明 CA 校验失败）
  if (!socket.authorized) {
    const errMsg = socket.authorizationError
    return { ok: false, reason: `certificate_not_authorized: ${errMsg}` }
  }

  // 提取关键字段（CN 可能是 string | string[]，取第一个值）
  const rawCn       = cert.subject?.CN ?? ''
  const cn          = Array.isArray(rawCn) ? (rawCn[0] ?? '') : rawCn
  const rawIssuerCn = cert.issuer?.CN ?? ''
  const issuerCn    = Array.isArray(rawIssuerCn) ? (rawIssuerCn[0] ?? '') : rawIssuerCn
  const validFrom   = new Date(cert.valid_from)
  const validTo     = new Date(cert.valid_to)

  // 计算 SHA-256 指纹（格式：无冒号 hex）
  const fingerprint = computeFingerprint(cert.raw)

  const now = new Date()
  if (now < validFrom || now > validTo) {
    return { ok: false, reason: 'certificate_expired_or_not_yet_valid' }
  }

  if (!cn) {
    return { ok: false, reason: 'certificate_missing_cn' }
  }

  const clientInfo: ClientCertInfo = {
    cn,
    fingerprint,
    issuerCn,
    validFrom,
    validTo,
  }

  return { ok: true, clientInfo }
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

/**
 * 计算 DER 编码证书的 SHA-256 指纹（无冒号 hex）
 */
function computeFingerprint(raw: Buffer | undefined): string {
  if (!raw) return ''
  return crypto.createHash('sha256').update(raw).digest('hex')
}
