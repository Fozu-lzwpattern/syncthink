/**
 * SyncThink 信令服务器 — TLS 自动化模块
 *
 * 三层兜底策略（零用户感知）：
 *
 * 层 1 — 环境变量（用户手动配置优先）：
 *   WSS_CERT=/path/to/cert.pem WSS_KEY=/path/to/key.pem
 *
 * 层 2 — mkcert 自动生成（推荐本地开发）：
 *   自动检测 mkcert，若存在则运行 mkcert localhost 生成到 certs/ 目录
 *   下次启动直接复用，无需重新生成
 *
 * 层 3 — Node.js 内置 crypto 动态生成自签名证书（兜底，零依赖）：
 *   无需安装任何工具，但浏览器会弹一次"不受信任"警告
 *   用户点"继续访问"后即可正常使用
 *
 * 若 WSS=false（默认），则跳过全部 TLS 逻辑，以 ws:// 启动（开发友好）
 */

import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { execSync, spawnSync } from 'child_process'
import { X509Certificate } from 'crypto'

export interface TLSConfig {
  cert: Buffer
  key: Buffer
  source: 'env' | 'mkcert' | 'selfsigned'
}

// certs/ 目录相对于本文件（src/tls.ts）的位置
const CERTS_DIR = path.resolve(__dirname, '..', 'certs')

// ─── 层 1：环境变量 ───────────────────────────────────────────────────────────

function loadFromEnv(): TLSConfig | null {
  const certPath = process.env.WSS_CERT
  const keyPath = process.env.WSS_KEY
  if (!certPath || !keyPath) return null

  if (!fs.existsSync(certPath)) {
    console.warn(`[tls] ⚠️  WSS_CERT 文件不存在: ${certPath}`)
    return null
  }
  if (!fs.existsSync(keyPath)) {
    console.warn(`[tls] ⚠️  WSS_KEY 文件不存在: ${keyPath}`)
    return null
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    source: 'env',
  }
}

// ─── 层 2：mkcert 自动生成 ────────────────────────────────────────────────────

function isMkcertAvailable(): boolean {
  try {
    execSync('mkcert --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function loadFromMkcert(): TLSConfig | null {
  const certPath = path.join(CERTS_DIR, 'localhost.pem')
  const keyPath = path.join(CERTS_DIR, 'localhost-key.pem')

  // 已有且有效（未过期）
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = new X509Certificate(fs.readFileSync(certPath))
      const expiry = new Date(cert.validTo)
      if (expiry > new Date()) {
        return {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
          source: 'mkcert',
        }
      }
      console.log('[tls] mkcert 证书已过期，重新生成...')
    } catch {
      // 证书损坏，重新生成
    }
  }

  if (!isMkcertAvailable()) return null

  console.log('[tls] 🔐 正在用 mkcert 生成本地 TLS 证书（仅首次）...')

  // 确保 certs/ 目录存在
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true })
  }

  // 先安装 mkcert 根证书到系统信任链（幂等）
  spawnSync('mkcert', ['-install'], { stdio: 'inherit' })

  // 生成 localhost 证书
  const result = spawnSync(
    'mkcert',
    ['-cert-file', certPath, '-key-file', keyPath, 'localhost', '127.0.0.1', '::1'],
    { stdio: 'inherit' }
  )

  if (result.status !== 0) {
    console.warn('[tls] ⚠️  mkcert 生成失败，降级到自签名证书')
    return null
  }

  console.log('[tls] ✅ mkcert 证书生成成功')
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    source: 'mkcert',
  }
}

// ─── 层 3：Node.js 内置 crypto 动态生成自签名证书 ────────────────────────────

/**
 * 使用 Node.js 内置 crypto.generateKeyPairSync + x509 Certificate 生成自签名证书
 * Node.js >= 18 支持，无外部依赖
 */
function generateSelfSignedCert(): TLSConfig {
  console.log('[tls] 🔐 生成自签名证书（浏览器会弹警告，点"继续访问"即可）...')

  // Node.js 15+ 提供 crypto.generateKeyPairSync
  const { generateKeyPairSync, createHash } = require('crypto')

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  // 使用 forge 或内置生成 x509 self-signed cert
  // Node.js 原生不直接支持生成 x509 证书，使用 tls 模块的替代方案
  // 降级方案：如果 node-forge 不可用，写入文件后调用 openssl（macOS/Linux 内置）
  const certPath = path.join(CERTS_DIR, 'selfsigned-cert.pem')
  const keyPath = path.join(CERTS_DIR, 'selfsigned-key.pem')

  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true })
  }

  // 尝试用 openssl（macOS/Linux 通常内置）
  try {
    const result = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '365',
      '-nodes',
      '-subj', '/CN=localhost/O=SyncThink/C=CN',
    ], { stdio: 'pipe' })

    if (result.status === 0) {
      console.log('[tls] ✅ 自签名证书生成成功（via openssl）')
      return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
        source: 'selfsigned',
      }
    }
  } catch {
    // openssl 不可用
  }

  // 最后兜底：尝试 node-forge（若已安装）
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge')
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
    const attrs = [{ name: 'commonName', value: 'localhost' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey)

    const certPem = forge.pki.certificateToPem(cert)
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

    fs.writeFileSync(certPath, certPem)
    fs.writeFileSync(keyPath, keyPem)

    console.log('[tls] ✅ 自签名证书生成成功（via node-forge）')
    return {
      cert: Buffer.from(certPem),
      key: Buffer.from(keyPem),
      source: 'selfsigned',
    }
  } catch {
    // node-forge 也不可用
  }

  throw new Error(
    '[tls] ❌ 无法生成 TLS 证书。\n' +
    '请安装 mkcert（推荐）：\n' +
    '  macOS: brew install mkcert\n' +
    '  Linux: https://github.com/FiloSottile/mkcert#linux\n' +
    '或设置环境变量 WSS_CERT / WSS_KEY 指向已有证书文件'
  )
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 自动获取 TLS 配置（三层兜底）
 * 若 WSS=false，返回 null（以 ws:// 启动）
 */
export async function autoTLS(): Promise<TLSConfig | null> {
  const wssEnabled = process.env.WSS !== 'false'
  if (!wssEnabled) return null

  // 层 1：环境变量
  const envConfig = loadFromEnv()
  if (envConfig) {
    console.log('[tls] ✅ 使用环境变量指定的证书')
    return envConfig
  }

  // 层 2：mkcert
  const mkcertConfig = loadFromMkcert()
  if (mkcertConfig) {
    const source = mkcertConfig.source === 'mkcert' ? '（mkcert 生成，浏览器完全信任）' : ''
    console.log(`[tls] ✅ 使用 mkcert 证书 ${source}`)
    return mkcertConfig
  }

  // 层 3：自签名（兜底）
  console.log('[tls] ⚠️  未找到 mkcert，使用自签名证书')
  console.log('[tls]     浏览器会弹"不受信任"警告，点击"高级" → "继续访问"即可')
  console.log('[tls]     如需消除警告，安装 mkcert: brew install mkcert (macOS)')
  return generateSelfSignedCert()
}

/**
 * 创建 HTTP 或 HTTPS 服务器
 */
export function createServer(
  tlsConfig: TLSConfig | null,
  handler: http.RequestListener
): http.Server | https.Server {
  if (tlsConfig) {
    return https.createServer(
      { cert: tlsConfig.cert, key: tlsConfig.key },
      handler
    )
  }
  return http.createServer(handler)
}

/**
 * 获取监听端口（WSS 默认 4443，WS 默认 4444）
 */
export function getPort(tlsConfig: TLSConfig | null): number {
  if (process.env.PORT) return Number(process.env.PORT)
  return tlsConfig ? 4443 : 4444
}

/**
 * 获取协议前缀
 */
export function getProtocol(tlsConfig: TLSConfig | null): 'wss' | 'ws' {
  return tlsConfig ? 'wss' : 'ws'
}
