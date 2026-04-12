import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadIdentity } from '../identity.js'
import { apiGet, loadCapabilityToken, DEFAULT_API_URL } from '../client.js'

const SYNCTHINK_DIR = path.join(os.homedir(), '.syncthink')

/**
 * syncthink-agent status
 * 显示：
 * - Identity: nodeId（前16位）, publicKey（前16位）
 * - API: http://127.0.0.1:9527 [连接状态]
 * - mTLS: 已启用/未启用
 * - 能力令牌: 已设置/未设置（显示过期时间）
 * - 服务状态: GET /agent/status 的结果
 */
export async function runStatus(opts: { apiUrl?: string }): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL

  console.log('📊 SyncThink Agent 状态')
  console.log('─'.repeat(50))

  // Identity
  const identity = loadIdentity()
  if (identity) {
    console.log(`🔑 身份`)
    console.log(`   nodeId    : ${identity.nodeId.slice(0, 16)}...${identity.nodeId.slice(-8)}`)
    console.log(`   publicKey : ${identity.publicKey.slice(0, 16)}...${identity.publicKey.slice(-8)}`)
    console.log(`   创建时间  : ${new Date(identity.createdAt).toLocaleString()}`)
  } else {
    console.log(`🔑 身份        : ❌ 未初始化`)
    console.log(`   运行 syncthink-agent setup 初始化身份`)
  }

  console.log('')

  // API 连接状态
  console.log(`📡 API 地址     : ${apiUrl}`)
  if (!identity) {
    console.log(`   连接状态  : ⏭️  跳过（未初始化身份）`)
  } else {
    try {
      const result = await apiGet('/agent/status', {}, { identity, apiUrl })
      const data = result as Record<string, unknown>
      console.log(`   连接状态  : ✅ 在线`)
      if (data?.version) console.log(`   服务版本  : ${data.version}`)
      if (data?.uptime) console.log(`   运行时间  : ${data.uptime}`)
      if (data?.agents !== undefined) console.log(`   已注册 Agent: ${data.agents}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('无法连接') || msg.includes('ECONNREFUSED')) {
        console.log(`   连接状态  : ❌ 离线（服务未启动）`)
      } else {
        console.log(`   连接状态  : ⚠️  ${msg}`)
      }
    }
  }

  console.log('')

  // mTLS 状态
  const certPath = path.join(SYNCTHINK_DIR, 'client.crt')
  const keyPath = path.join(SYNCTHINK_DIR, 'client.key')
  const caPath = path.join(SYNCTHINK_DIR, 'ca', 'ca.crt')
  const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(caPath)
  console.log(`🔒 mTLS         : ${hasCert ? '✅ 已启用' : 'ℹ️  未配置（使用 HTTP）'}`)

  console.log('')

  // Capability Token
  const token = loadCapabilityToken()
  if (token) {
    console.log(`🎫 能力令牌     : ✅ 已设置`)
    // 尝试解析 JWT-like 结构（base64url payload）
    try {
      const parts = token.split('.')
      if (parts.length >= 2) {
        // 标准 JWT 格式
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
        if (payload.exp) {
          const expDate = new Date(payload.exp * 1000)
          const now = Date.now()
          if (expDate.getTime() < now) {
            console.log(`   过期时间  : ❌ 已过期（${expDate.toLocaleString()}）`)
          } else {
            const remainMs = expDate.getTime() - now
            const remainH = Math.floor(remainMs / 3600000)
            console.log(`   过期时间  : ${expDate.toLocaleString()}（剩余 ${remainH}h）`)
          }
        }
        if (payload.aud) console.log(`   受众      : ${payload.aud}`)
        if (payload.cap) {
          const caps = Object.entries(payload.cap as Record<string, string[]>)
            .map(([k, v]) => `${k}:[${v.join(',')}]`)
            .join(' ')
          console.log(`   能力范围  : ${caps}`)
        }
      } else {
        // 纯 base64url token，无法解析结构
        console.log(`   令牌前缀  : ${token.slice(0, 20)}...`)
      }
    } catch {
      console.log(`   令牌前缀  : ${token.slice(0, 20)}...`)
    }
  } else {
    console.log(`🎫 能力令牌     : ❌ 未配置`)
    console.log(`   运行 syncthink-agent token set <token> 设置令牌`)
  }

  console.log('')
  console.log('─'.repeat(50))
}
