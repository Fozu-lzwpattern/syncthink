/**
 * SyncThink mTLS 模块入口
 *
 * 提供：
 * - loadMtlsConfig()     从环境变量/配置文件加载 mTLS 配置
 * - applyMtlsToServer()  将 mTLS 中间件挂载到 HTTP 服务器（检查客户端证书）
 * - checkClientCert()    单次请求客户端证书检查
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as os   from 'os'
import type * as http from 'http'
import type { MtlsConfig, MtlsCheckResult } from './types.js'
export { checkClientCert } from './verify.js'
export type { MtlsConfig, ClientCertInfo, MtlsCheckResult } from './types.js'

// ─── 默认路径 ─────────────────────────────────────────────────────────────────

const SYNCTHINK_DIR = path.join(os.homedir(), '.syncthink', 'pki')

const DEFAULT_PATHS = {
  caCert:     path.join(SYNCTHINK_DIR, 'ca-cert.pem'),
  serverCert: path.join(SYNCTHINK_DIR, 'server-cert.pem'),
  serverKey:  path.join(SYNCTHINK_DIR, 'server-key.pem'),
}

// ─── 配置加载 ──────────────────────────────────────────────────────────────────

/**
 * 加载 mTLS 配置
 *
 * 优先顺序（高→低）：
 * 1. 环境变量 SYNCTHINK_CA_CERT / SYNCTHINK_SERVER_CERT / SYNCTHINK_SERVER_KEY
 * 2. 默认路径 ~/.syncthink/pki/
 * 3. enabled=false（PKI 文件不存在时）
 */
export function loadMtlsConfig(): MtlsConfig {
  const caCertPath     = process.env['SYNCTHINK_CA_CERT']     ?? DEFAULT_PATHS.caCert
  const serverCertPath = process.env['SYNCTHINK_SERVER_CERT'] ?? DEFAULT_PATHS.serverCert
  const serverKeyPath  = process.env['SYNCTHINK_SERVER_KEY']  ?? DEFAULT_PATHS.serverKey

  const enabled =
    fs.existsSync(caCertPath) &&
    fs.existsSync(serverCertPath) &&
    fs.existsSync(serverKeyPath)

  return { enabled, caCertPath, serverCertPath, serverKeyPath }
}

/**
 * 读取 mTLS TLS 选项（供 https.createServer 使用）
 *
 * 若 mTLS 未启用返回 null。
 */
export function readMtlsOptions(config: MtlsConfig): {
  ca:   Buffer
  cert: Buffer
  key:  Buffer
  requestCert:       true
  rejectUnauthorized: true
} | null {
  if (!config.enabled) return null

  try {
    return {
      ca:   fs.readFileSync(config.caCertPath),
      cert: fs.readFileSync(config.serverCertPath),
      key:  fs.readFileSync(config.serverKeyPath),
      requestCert:        true,
      rejectUnauthorized: true,
    }
  } catch (err) {
    console.warn('[mtls] ⚠️ failed to read PKI files:', err)
    return null
  }
}

// ─── 请求级别 mTLS 检查（可选中间件层） ────────────────────────────────────────

/**
 * 在 mTLS 模式下，对每个 HTTP 请求执行客户端证书检查
 *
 * 若 config.enabled=false，跳过检查直接放行。
 * 若检查失败，写入 401 响应并返回 false。
 * 若检查通过，返回 true，调用方继续处理。
 *
 * 使用场景：当 rejectUnauthorized=false 时（允许无证书客户端连接但在业务层拒绝），
 * 在每个路由 handler 开头调用此函数。
 */
export function guardMtls(
  config: MtlsConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  if (!config.enabled) return true

  const { checkClientCert } = require('./verify.js') as { checkClientCert: (req: http.IncomingMessage) => MtlsCheckResult }
  const result = checkClientCert(req)

  if (!result.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mtls_required', reason: result.reason }))
    return false
  }

  return true
}
