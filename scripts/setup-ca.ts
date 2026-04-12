#!/usr/bin/env npx tsx
/**
 * SyncThink CA 管理工具（TypeScript 版，跨平台）
 *
 * 用法：
 *   npx tsx scripts/setup-ca.ts init            初始化 CA（生成 root CA + server cert）
 *   npx tsx scripts/setup-ca.ts issue <name>    为 Agent 颁发客户端证书
 *   npx tsx scripts/setup-ca.ts revoke <name>   吊销 Agent 证书
 *   npx tsx scripts/setup-ca.ts list            列出所有已颁发证书
 *   npx tsx scripts/setup-ca.ts status          查看 CA 状态
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const CA_DIR = path.join(os.homedir(), '.syncthink', 'ca')
const AGENT_CERTS_DIR = path.join(os.homedir(), '.syncthink', 'agent-certs')

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 检查 openssl 是否可用 */
function checkOpenSSL(): void {
  try {
    execSync('openssl version', { stdio: 'ignore' })
  } catch {
    console.error('❌ openssl 未找到，请安装 openssl 后重试')
    console.error('   macOS:  brew install openssl')
    console.error('   Ubuntu: sudo apt-get install openssl')
    console.error('   Windows: https://slproweb.com/products/Win32OpenSSL.html')
    process.exit(1)
  }
}

/** 检查 CA 是否已初始化 */
function checkCAInitialized(): void {
  if (!fs.existsSync(path.join(CA_DIR, 'ca.crt')) || !fs.existsSync(path.join(CA_DIR, 'ca.key'))) {
    console.error('❌ CA 尚未初始化，请先运行：')
    console.error('   npx tsx scripts/setup-ca.ts init')
    process.exit(1)
  }
}

/** 运行 openssl 命令，出错时打印详情并退出 */
function run(cmd: string): void {
  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: Buffer }
    console.error(`❌ openssl 命令失败：${cmd}`)
    if (e?.stderr) console.error(e.stderr.toString())
    process.exit(1)
  }
}

/** 运行 openssl 命令并返回输出字符串 */
function runOutput(cmd: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim()
  } catch {
    return ''
  }
}

// ─── init：初始化 CA ──────────────────────────────────────────────────────────

function initCA(): void {
  checkOpenSSL()

  if (fs.existsSync(path.join(CA_DIR, 'ca.crt'))) {
    console.error(`⚠️  CA 已存在：${CA_DIR}/ca.crt`)
    console.error(`   若要重新初始化，请先手动删除 ${CA_DIR} 目录`)
    process.exit(1)
  }

  console.log('🔐 初始化 SyncThink 私有 CA...')
  fs.mkdirSync(CA_DIR, { recursive: true })

  // 1. 生成 CA 私钥（4096位）
  console.log('  ① 生成 CA 私钥（4096位）...')
  run(`openssl genrsa -out "${path.join(CA_DIR, 'ca.key')}" 4096`)
  fs.chmodSync(path.join(CA_DIR, 'ca.key'), 0o600)

  // 2. 生成自签名 CA 证书（10年有效）
  console.log('  ② 生成自签名 CA 证书（有效期 10 年）...')
  run(
    `openssl req -x509 -new -nodes` +
    ` -key "${path.join(CA_DIR, 'ca.key')}"` +
    ` -sha256 -days 3650` +
    ` -out "${path.join(CA_DIR, 'ca.crt')}"` +
    ` -subj "/CN=SyncThink CA/O=SyncThink/C=CN"`
  )
  fs.chmodSync(path.join(CA_DIR, 'ca.crt'), 0o644)

  // 3. 生成 server 私钥（2048位）
  console.log('  ③ 生成 server 私钥（2048位）...')
  run(`openssl genrsa -out "${path.join(CA_DIR, 'server.key')}" 2048`)
  fs.chmodSync(path.join(CA_DIR, 'server.key'), 0o600)

  // 4. 创建 SAN 扩展配置文件
  const extCnfPath = path.join(CA_DIR, 'server_ext.cnf')
  fs.writeFileSync(extCnfPath, [
    '[req]',
    'req_extensions = v3_req',
    'distinguished_name = req_distinguished_name',
    '',
    '[req_distinguished_name]',
    '',
    '[v3_req]',
    'subjectAltName = @alt_names',
    '',
    '[alt_names]',
    'DNS.1 = localhost',
    'IP.1  = 127.0.0.1',
  ].join('\n'))

  // 5. 生成 server CSR（带 SAN）
  console.log('  ④ 生成 server CSR（SAN: localhost, 127.0.0.1）...')
  run(
    `openssl req -new` +
    ` -key "${path.join(CA_DIR, 'server.key')}"` +
    ` -out "${path.join(CA_DIR, 'server.csr')}"` +
    ` -subj "/CN=localhost/O=SyncThink/C=CN"` +
    ` -config "${extCnfPath}"`
  )

  // 6. 用 CA 签发 server 证书（2年有效）
  console.log('  ⑤ 用 CA 签发 server 证书（有效期 2 年）...')
  run(
    `openssl x509 -req` +
    ` -in "${path.join(CA_DIR, 'server.csr')}"` +
    ` -CA "${path.join(CA_DIR, 'ca.crt')}"` +
    ` -CAkey "${path.join(CA_DIR, 'ca.key')}"` +
    ` -CAcreateserial` +
    ` -out "${path.join(CA_DIR, 'server.crt')}"` +
    ` -days 730 -sha256` +
    ` -extfile "${extCnfPath}"` +
    ` -extensions v3_req`
  )
  fs.chmodSync(path.join(CA_DIR, 'server.crt'), 0o644)

  // 清理临时文件
  fs.unlinkSync(path.join(CA_DIR, 'server.csr'))
  fs.unlinkSync(extCnfPath)

  console.log('')
  console.log('✅ CA 初始化完成！文件位于：')
  console.log(`   CA 证书:     ${CA_DIR}/ca.crt`)
  console.log(`   CA 私钥:     ${CA_DIR}/ca.key  (请妥善保管)`)
  console.log(`   Server 证书: ${CA_DIR}/server.crt`)
  console.log(`   Server 私钥: ${CA_DIR}/server.key`)
  console.log('')
  console.log('📋 下一步：')
  console.log('   为 Agent 颁发客户端证书：')
  console.log('   npx tsx scripts/setup-ca.ts issue <agent-name>')
  console.log('')
  console.log('   重启 SyncThink signaling server 后 mTLS 将自动启用。')
}

// ─── issueCert：颁发 Agent 证书 ──────────────────────────────────────────────

function issueCert(name: string | undefined): void {
  if (!name) {
    console.error('❌ 用法: npx tsx scripts/setup-ca.ts issue <name>')
    console.error('   例如: npx tsx scripts/setup-ca.ts issue openclaw-agent')
    process.exit(1)
  }

  checkOpenSSL()
  checkCAInitialized()

  fs.mkdirSync(AGENT_CERTS_DIR, { recursive: true })

  const keyPath = path.join(AGENT_CERTS_DIR, `${name}.key`)
  const csrPath = path.join(AGENT_CERTS_DIR, `${name}.csr`)
  const crtPath = path.join(AGENT_CERTS_DIR, `${name}.crt`)

  if (fs.existsSync(crtPath)) {
    console.error(`⚠️  证书已存在: ${crtPath}`)
    console.error(`   如需重新颁发，请先运行: npx tsx scripts/setup-ca.ts revoke ${name}`)
    process.exit(1)
  }

  console.log(`🔏 为 Agent '${name}' 颁发客户端证书...`)

  // 1. 生成 Agent 私钥（2048位）
  run(`openssl genrsa -out "${keyPath}" 2048`)
  fs.chmodSync(keyPath, 0o600)

  // 2. 生成 CSR
  run(
    `openssl req -new` +
    ` -key "${keyPath}"` +
    ` -out "${csrPath}"` +
    ` -subj "/CN=${name}/O=SyncThink-Agent/C=CN"`
  )

  // 3. 用 CA 签发证书（180天）
  run(
    `openssl x509 -req` +
    ` -in "${csrPath}"` +
    ` -CA "${path.join(CA_DIR, 'ca.crt')}"` +
    ` -CAkey "${path.join(CA_DIR, 'ca.key')}"` +
    ` -CAcreateserial` +
    ` -out "${crtPath}"` +
    ` -days 180 -sha256`
  )
  fs.chmodSync(crtPath, 0o644)

  // 清理 CSR
  fs.unlinkSync(csrPath)

  const expiry = runOutput(`openssl x509 -noout -enddate -in "${crtPath}"`).replace('notAfter=', '')

  console.log('')
  console.log(`✅ 证书颁发完成：${name}`)
  console.log(`   证书: ${crtPath}`)
  console.log(`   私钥: ${keyPath}`)
  console.log(`   到期: ${expiry}`)
  console.log('')
  console.log('📋 使用方式：')
  console.log('   CLI 参数（Node.js）:')
  console.log(`     --cert ${crtPath} \\`)
  console.log(`     --key  ${keyPath} \\`)
  console.log(`     --ca   ${path.join(CA_DIR, 'ca.crt')}`)
  console.log('')
  console.log('   环境变量：')
  console.log(`     SYNCTHINK_CLIENT_CERT=${crtPath}`)
  console.log(`     SYNCTHINK_CLIENT_KEY=${keyPath}`)
  console.log(`     SYNCTHINK_CA_CERT=${path.join(CA_DIR, 'ca.crt')}`)
}

// ─── listCerts：列出所有证书 ──────────────────────────────────────────────────

function listCerts(): void {
  if (!fs.existsSync(AGENT_CERTS_DIR)) {
    console.log(`📋 暂无颁发的 Agent 证书（${AGENT_CERTS_DIR} 不存在）`)
    return
  }

  const certs = fs.readdirSync(AGENT_CERTS_DIR)
    .filter(f => f.endsWith('.crt'))
    .sort()

  if (certs.length === 0) {
    console.log('📋 暂无颁发的 Agent 证书')
    return
  }

  console.log('📋 已颁发的 Agent 证书：')
  console.log('')
  console.log(`  ${'名称'.padEnd(30)} ${'CN'.padEnd(25)} 到期时间`)
  console.log(`  ${'─'.repeat(30)} ${'─'.repeat(25)} ${'─'.repeat(25)}`)

  for (const crtFile of certs) {
    const name = crtFile.replace(/\.crt$/, '')
    const crtPath = path.join(AGENT_CERTS_DIR, crtFile)
    const cn = runOutput(`openssl x509 -noout -subject -in "${crtPath}"`)
      .replace(/.*CN\s*=\s*/, '')
      .replace(/,.*/, '')
      .trim()
    const expiry = runOutput(`openssl x509 -noout -enddate -in "${crtPath}"`)
      .replace('notAfter=', '')
    console.log(`  ${name.padEnd(30)} ${cn.padEnd(25)} ${expiry}`)
  }

  console.log('')
}

// ─── status：查看 CA 状态 ─────────────────────────────────────────────────────

function status(): void {
  console.log('📊 SyncThink CA 状态')
  console.log('')

  const caCrtPath = path.join(CA_DIR, 'ca.crt')
  const serverCrtPath = path.join(CA_DIR, 'server.crt')

  if (!fs.existsSync(caCrtPath)) {
    console.log('  CA: ❌ 未初始化')
    console.log('')
    console.log('  运行以下命令初始化：')
    console.log('    npx tsx scripts/setup-ca.ts init')
    return
  }

  const caExpiry = runOutput(`openssl x509 -noout -enddate -in "${caCrtPath}"`).replace('notAfter=', '')
  const caCN = runOutput(`openssl x509 -noout -subject -in "${caCrtPath}"`)
    .replace(/.*CN\s*=\s*/, '').replace(/,.*/, '').trim()

  console.log(`  CA 证书:     ✅ ${caCrtPath}`)
  console.log(`  CA CN:       ${caCN}`)
  console.log(`  CA 到期:     ${caExpiry}`)
  console.log('')

  if (fs.existsSync(serverCrtPath)) {
    const serverExpiry = runOutput(`openssl x509 -noout -enddate -in "${serverCrtPath}"`).replace('notAfter=', '')
    console.log(`  Server 证书: ✅ ${serverCrtPath}`)
    console.log(`  Server 到期: ${serverExpiry}`)
  } else {
    console.log(`  Server 证书: ❌ 不存在（运行 npx tsx scripts/setup-ca.ts init 生成）`)
  }

  console.log('')

  // 统计 Agent 证书数量
  let agentCount = 0
  if (fs.existsSync(AGENT_CERTS_DIR)) {
    agentCount = fs.readdirSync(AGENT_CERTS_DIR).filter(f => f.endsWith('.crt')).length
  }
  console.log(`  Agent 证书数: ${agentCount}`)
  if (agentCount > 0) {
    console.log('  （运行 npx tsx scripts/setup-ca.ts list 查看详情）')
  }
  console.log('')
}

// ─── CLI 入口 ─────────────────────────────────────────────────────────────────

const cmd = process.argv[2]

switch (cmd) {
  case 'init':
    initCA()
    break
  case 'issue':
    issueCert(process.argv[3])
    break
  case 'revoke': {
    const name = process.argv[3]
    if (!name) {
      console.error('❌ 用法: npx tsx scripts/setup-ca.ts revoke <name>')
      process.exit(1)
    }
    const keyPath = path.join(AGENT_CERTS_DIR, `${name}.key`)
    const crtPath = path.join(AGENT_CERTS_DIR, `${name}.crt`)
    if (!fs.existsSync(crtPath)) {
      console.error(`❌ 证书不存在: ${crtPath}`)
      process.exit(1)
    }
    console.log(`🗑️  吊销 Agent '${name}' 的证书...`)
    fs.unlinkSync(crtPath)
    if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath)
    console.log(`✅ 已删除证书和私钥`)
    console.log('⚠️  注意：重启 SyncThink signaling server 以使吊销即时生效。')
    break
  }
  case 'list':
    listCerts()
    break
  case 'status':
    status()
    break
  default:
    console.log('SyncThink CA 管理工具（TypeScript 版）')
    console.log('')
    console.log('用法: npx tsx scripts/setup-ca.ts <init|issue|revoke|list|status>')
    console.log('')
    console.log('子命令：')
    console.log('  init            初始化 CA（生成 root CA + server cert）')
    console.log('  issue <name>    为 Agent 颁发客户端证书（180天有效）')
    console.log('  revoke <name>   吊销 Agent 证书')
    console.log('  list            列出所有已颁发证书')
    console.log('  status          查看 CA 状态')
    console.log('')
    console.log('示例：')
    console.log('  npx tsx scripts/setup-ca.ts init')
    console.log('  npx tsx scripts/setup-ca.ts issue openclaw-agent')
    console.log('  npx tsx scripts/setup-ca.ts list')
    process.exit(1)
}
