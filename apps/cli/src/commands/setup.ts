import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getOrCreateIdentity, loadIdentity, createIdentity } from '../identity.js'
import { apiPost, DEFAULT_API_URL } from '../client.js'

const SYNCTHINK_DIR = path.join(os.homedir(), '.syncthink')

/**
 * syncthink-agent setup
 * 1. 检查 identity，不存在则创建
 * 2. 向 POST /agent/register 注册
 * 3. 检查 mTLS 证书状态
 * 4. 打印当前状态
 */
export async function runSetup(opts: { apiUrl?: string; force?: boolean }): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  console.log('🔧 SyncThink Agent 初始化')
  console.log(`📡 API 地址: ${apiUrl}`)
  console.log('')

  // Step 1: 处理 identity
  let identity = loadIdentity()
  if (identity && !opts.force) {
    console.log(`✅ 已有身份: nodeId = ${identity.nodeId.slice(0, 16)}...`)
    console.log(`   公钥: ${identity.publicKey.slice(0, 16)}...`)
    console.log(`   创建时间: ${new Date(identity.createdAt).toLocaleString()}`)
  } else {
    if (opts.force && identity) {
      console.log('⚠️  --force 模式，重新生成身份...')
    } else {
      console.log('🔑 未找到身份，生成新的 Ed25519 密钥对...')
    }
    identity = await createIdentity()
    console.log(`✅ 身份已创建: nodeId = ${identity.nodeId.slice(0, 16)}...`)
    console.log(`   保存位置: ~/.syncthink/identity.json`)
  }

  console.log('')

  // Step 2: 注册到服务器
  console.log('📤 向服务器注册...')
  try {
    const result = await apiPost('/agent/register', {
      nodeId: identity.nodeId,
      publicKey: identity.publicKey,
    }, { identity, apiUrl })
    console.log(`✅ 注册成功`)
    const data = result as Record<string, unknown>
    if (data?.message) console.log(`   服务器消息: ${data.message}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('无法连接')) {
      console.log(`⚠️  服务器暂时不可达，注册跳过`)
      console.log(`   请确认 SyncThink signaling server 已启动后重新运行 setup`)
    } else {
      console.log(`⚠️  注册失败: ${msg}`)
    }
  }

  console.log('')

  // Step 3: 检查 mTLS 证书
  const certPath = path.join(SYNCTHINK_DIR, 'client.crt')
  const keyPath = path.join(SYNCTHINK_DIR, 'client.key')
  const caPath = path.join(SYNCTHINK_DIR, 'ca', 'ca.crt')
  const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(caPath)

  if (hasCert) {
    console.log(`✅ mTLS 证书: 已找到`)
    console.log(`   证书路径: ~/.syncthink/client.crt`)
  } else {
    console.log(`ℹ️  mTLS 证书: 未配置（可选）`)
    console.log(`   如需启用 mTLS，请将证书文件放到:`)
    console.log(`   - ~/.syncthink/client.crt`)
    console.log(`   - ~/.syncthink/client.key`)
    console.log(`   - ~/.syncthink/ca/ca.crt`)
  }

  console.log('')

  // Step 4: 检查 capability token
  const tokenPath = path.join(SYNCTHINK_DIR, 'token.b64')
  const hasToken = fs.existsSync(tokenPath)
  if (hasToken) {
    console.log(`✅ 能力令牌: 已配置`)
    console.log(`   运行 syncthink-agent token show 查看详情`)
  } else {
    console.log(`ℹ️  能力令牌: 未配置`)
    console.log(`   请向 SyncThink owner 申请令牌，然后运行:`)
    console.log(`   syncthink-agent token set <your-token>`)
  }

  console.log('')
  console.log('🎉 初始化完成！运行 syncthink-agent status 查看完整状态')
}
