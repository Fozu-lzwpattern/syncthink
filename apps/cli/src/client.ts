import * as ed from '@noble/ed25519'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { AgentIdentity } from './identity.js'

export const DEFAULT_API_URL = process.env.SYNCTHINK_API ?? 'http://127.0.0.1:9527'
const SYNCTHINK_DIR = path.join(os.homedir(), '.syncthink')
const TOKEN_PATH = path.join(SYNCTHINK_DIR, 'token.b64')

export interface ClientConfig {
  identity: AgentIdentity
  apiUrl?: string
  capabilityToken?: string  // Bearer token（优先于 Ed25519 签名）
}

/**
 * 构建 Ed25519 签名 headers
 * 签名内容：`${timestamp}:${method}:${urlPath}:${payloadHash}`
 */
async function buildAuthHeaders(
  identity: AgentIdentity,
  method: string,
  urlPath: string,
  payload: string,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const { createHash } = await import('crypto')
  const payloadHash = createHash('sha256').update(payload).digest('hex')
  const message = `${timestamp}:${method.toUpperCase()}:${urlPath}:${payloadHash}`

  const msgBytes = Buffer.from(message, 'utf-8')
  const privBytes = Buffer.from(identity.privateKey, 'hex')
  const signature = await ed.signAsync(msgBytes, privBytes)
  const sigHex = Buffer.from(signature).toString('hex')

  return {
    'X-Node-Id': identity.nodeId,
    'X-Timestamp': timestamp,
    'X-Signature': sigHex,
    'X-Public-Key': identity.publicKey,
  }
}

/**
 * 读取本地保存的 capability token（base64url）
 */
export function loadCapabilityToken(): string | null {
  if (!fs.existsSync(TOKEN_PATH)) return null
  try {
    return fs.readFileSync(TOKEN_PATH, 'utf-8').trim()
  } catch {
    return null
  }
}

/**
 * 检查是否有 mTLS 证书
 */
function getMTLSAgent(): https.Agent | null {
  const certPath = path.join(SYNCTHINK_DIR, 'client.crt')
  const keyPath = path.join(SYNCTHINK_DIR, 'client.key')
  const caPath = path.join(SYNCTHINK_DIR, 'ca', 'ca.crt')
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath) || !fs.existsSync(caPath)) return null
  try {
    return new https.Agent({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      ca: fs.readFileSync(caPath),
    })
  } catch {
    return null
  }
}

/**
 * 底层 HTTP/HTTPS 请求工具
 */
function httpRequest(
  method: string,
  baseUrl: string,
  urlPath: string,
  headers: Record<string, string>,
  body: string | null,
  mtlsAgent: https.Agent | null,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl)
    const isHttps = url.protocol === 'https:'
    const mod = isHttps ? https : http

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }

    if (isHttps && mtlsAgent) {
      (options as https.RequestOptions).agent = mtlsAgent
    }

    const req = mod.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data })
      })
    })

    req.on('error', (err: Error) => {
      if (err.message.includes('ECONNREFUSED')) {
        reject(new Error(`无法连接到服务器 ${baseUrl}，请确认 SyncThink 服务正在运行`))
      } else {
        reject(err)
      }
    })

    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error(`请求超时（10s）：${baseUrl}${urlPath}`))
    })

    if (body) req.write(body)
    req.end()
  })
}

/**
 * 发送 POST 请求（自动签名）
 */
export async function apiPost(
  urlPath: string,
  body: unknown,
  config: ClientConfig,
): Promise<unknown> {
  const apiUrl = config.apiUrl ?? DEFAULT_API_URL
  const payload = JSON.stringify(body)
  const mtlsAgent = getMTLSAgent()

  // 优先使用 capability token，否则使用 Ed25519 签名
  let authHeaders: Record<string, string>
  const token = config.capabilityToken ?? loadCapabilityToken()
  if (token) {
    authHeaders = { Authorization: `Bearer ${token}` }
  } else {
    authHeaders = await buildAuthHeaders(config.identity, 'POST', urlPath, payload)
  }

  const result = await httpRequest('POST', apiUrl, urlPath, authHeaders, payload, mtlsAgent)
  return parseResponse(result)
}

/**
 * 发送 GET 请求（自动签名）
 */
export async function apiGet(
  urlPath: string,
  params: Record<string, string>,
  config: ClientConfig,
): Promise<unknown> {
  const apiUrl = config.apiUrl ?? DEFAULT_API_URL
  const qs = new URLSearchParams(params).toString()
  const fullPath = qs ? `${urlPath}?${qs}` : urlPath
  const mtlsAgent = getMTLSAgent()

  let authHeaders: Record<string, string>
  const token = config.capabilityToken ?? loadCapabilityToken()
  if (token) {
    authHeaders = { Authorization: `Bearer ${token}` }
  } else {
    authHeaders = await buildAuthHeaders(config.identity, 'GET', fullPath, '')
  }

  const result = await httpRequest('GET', apiUrl, fullPath, authHeaders, null, mtlsAgent)
  return parseResponse(result)
}

function parseResponse(result: { statusCode: number; body: string }): unknown {
  const { statusCode, body } = result

  if (statusCode === 401) {
    throw new Error('认证失败（401）：令牌已过期或无效，请运行 syncthink-agent token verify')
  }
  if (statusCode === 403) {
    throw new Error('权限不足（403）：当前令牌无此操作权限')
  }
  if (statusCode >= 400) {
    let detail = body
    try {
      const parsed = JSON.parse(body)
      detail = parsed.error ?? parsed.message ?? body
    } catch { /* ignore */ }
    throw new Error(`请求失败（${statusCode}）：${detail}`)
  }

  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    return { raw: body }
  }
}
