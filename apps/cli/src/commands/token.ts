import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadIdentity } from '../identity.js'
import { apiPost, apiGet, loadCapabilityToken, DEFAULT_API_URL } from '../client.js'

const SYNCTHINK_DIR = path.join(os.homedir(), '.syncthink')
const TOKEN_PATH = path.join(SYNCTHINK_DIR, 'token.b64')

/**
 * syncthink-agent token show
 * 显示当前能力令牌详情
 */
export async function runTokenShow(_opts: Record<string, never>): Promise<void> {
  const token = loadCapabilityToken()

  if (!token) {
    console.log('❌ 未配置能力令牌')
    console.log('   运行 syncthink-agent token set <token> 设置令牌')
    return
  }

  console.log('🎫 当前能力令牌')
  console.log('─'.repeat(50))
  console.log(`令牌（前 40 字符）: ${token.slice(0, 40)}...`)
  console.log('')

  // 尝试解析 JWT 结构
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'))
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))

      console.log(`格式   : JWT (${header.alg ?? 'unknown'})`)
      if (payload.iss) console.log(`颁发者 : ${payload.iss}`)
      if (payload.aud) console.log(`受众   : ${payload.aud}`)

      if (payload.nbf) {
        console.log(`生效时间: ${new Date(payload.nbf * 1000).toLocaleString()}`)
      }
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000)
        const now = Date.now()
        const expired = expDate.getTime() < now
        console.log(`过期时间: ${expDate.toLocaleString()} ${expired ? '❌ 已过期' : '✅'}`)
        if (!expired) {
          const remainMs = expDate.getTime() - now
          const remainH = Math.floor(remainMs / 3600000)
          const remainM = Math.floor((remainMs % 3600000) / 60000)
          console.log(`剩余时间: ${remainH}h ${remainM}m`)
        }
      }
      if (payload.cap) {
        console.log('')
        console.log('能力范围:')
        for (const [resource, actions] of Object.entries(payload.cap as Record<string, string[]>)) {
          console.log(`  ${resource}: [${actions.join(', ')}]`)
        }
      }
      if (payload.nonce) console.log(`Nonce  : ${payload.nonce}`)
    } else {
      console.log('格式   : raw (非标准 JWT)')
    }
  } catch {
    console.log('格式   : 无法解析（可能是自定义格式）')
  }

  console.log('─'.repeat(50))
}

/**
 * syncthink-agent token set <token>
 * 保存能力令牌到 ~/.syncthink/token.b64
 */
export async function runTokenSet(token: string): Promise<void> {
  if (!token || !token.trim()) {
    throw new Error('令牌内容不能为空')
  }

  fs.mkdirSync(SYNCTHINK_DIR, { recursive: true })
  fs.writeFileSync(TOKEN_PATH, token.trim(), 'utf-8')
  fs.chmodSync(TOKEN_PATH, 0o600)

  console.log('✅ 能力令牌已保存')
  console.log(`   路径: ~/.syncthink/token.b64`)
  console.log('   运行 syncthink-agent token show 查看详情')
}

/**
 * syncthink-agent token verify
 * 验证当前令牌的有效性
 */
export async function runTokenVerify(opts: { apiUrl?: string }): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL

  const token = loadCapabilityToken()
  if (!token) {
    console.log('❌ 未找到能力令牌，请先运行 syncthink-agent token set <token>')
    return
  }

  const identity = loadIdentity()
  if (!identity) {
    throw new Error('未找到身份信息，请先运行 syncthink-agent setup')
  }

  console.log('🔍 验证能力令牌...')

  try {
    const result = await apiGet('/token/verify', {}, {
      identity,
      apiUrl,
      capabilityToken: token,
    })
    const data = result as Record<string, unknown>

    if (data?.valid === false) {
      console.log(`❌ 令牌无效: ${data.reason ?? '未知原因'}`)
    } else {
      console.log('✅ 令牌有效')
      if (data?.exp) {
        console.log(`   过期时间: ${new Date((data.exp as number) * 1000).toLocaleString()}`)
      }
      if (data?.cap) {
        const caps = Object.entries(data.cap as Record<string, string[]>)
          .map(([k, v]) => `${k}:[${v.join(',')}]`)
          .join(', ')
        console.log(`   能力范围: ${caps}`)
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('401')) {
      console.log('❌ 令牌已过期或已被撤销')
    } else {
      console.log(`❌ 验证失败: ${msg}`)
    }
  }
}

/**
 * syncthink-agent token issue --aud <nodeId> --role <role>
 * 颁发令牌（需要是 owner，使用管理员令牌）
 */
export async function runTokenIssue(opts: {
  aud: string
  role: string
  expiresInMs?: number
  apiUrl?: string
}): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL

  if (!opts.aud) throw new Error('必须指定 --aud <nodeId>')
  if (!opts.role) throw new Error('必须指定 --role <role>')

  const identity = loadIdentity()
  if (!identity) {
    throw new Error('未找到身份信息，请先运行 syncthink-agent setup')
  }

  const adminToken = loadCapabilityToken()
  if (!adminToken) {
    throw new Error('未找到能力令牌，颁发令牌需要管理员令牌')
  }

  // 根据 role 设定能力范围
  const capabilityMap: Record<string, Record<string, string[]>> = {
    observer: {
      'syncthink:canvas': ['read'],
      'syncthink:chat': ['read'],
    },
    collaborator: {
      'syncthink:shape': ['create', 'update'],
      'syncthink:chat': ['send', 'read'],
      'syncthink:canvas': ['read'],
    },
    admin: {
      'syncthink:shape': ['create', 'update', 'delete', 'confirm'],
      'syncthink:chat': ['send', 'read', 'distill'],
      'syncthink:canvas': ['read', 'clear'],
      'syncthink:agent': ['register', 'revoke'],
    },
  }

  const cap = capabilityMap[opts.role]
  if (!cap) {
    throw new Error(`未知角色: ${opts.role}，可用角色: observer / collaborator / admin`)
  }

  const expiresInMs = opts.expiresInMs ?? 86400_000  // 默认 24 小时

  console.log(`🎫 颁发能力令牌`)
  console.log(`   受众   : ${opts.aud}`)
  console.log(`   角色   : ${opts.role}`)
  console.log(`   有效期 : ${expiresInMs / 3600_000}h`)

  const result = await apiPost('/token/issue', {
    aud: opts.aud,
    cap,
    expiresInMs,
  }, { identity, apiUrl, capabilityToken: adminToken })

  const data = result as Record<string, unknown>

  if (data?.token) {
    console.log('')
    console.log('✅ 令牌已颁发:')
    console.log('')
    console.log(data.token as string)
    console.log('')
    console.log('请将以上令牌发送给对方，对方运行:')
    console.log('  syncthink-agent token set <token>')
  } else {
    console.log('✅ 颁发成功')
    console.log(JSON.stringify(data, null, 2))
  }
}
