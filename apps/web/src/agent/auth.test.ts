/**
 * Ed25519 鉴权测试
 * 运行方式：npx tsx src/agent/auth.test.ts
 *
 * 测试场景：
 * 1. 正常签名验证通过
 * 2. 签名被篡改 → 验证失败
 * 3. payload 被篡改 → 验证失败
 * 4. timestamp 过期（>30s）→ 验证失败
 * 5. 未来时间戳（>30s）→ 验证失败
 */

import * as ed from '@noble/ed25519'
import { createHash } from 'crypto'
import { signCommand, verifyCommand, type AgentCommandPayload } from './auth'

// noble/ed25519 v2 需要注入 sha512（Node 环境，用内置 crypto）
ed.etc.sha512Async = async (...msgs: Uint8Array[]) => {
  const data = ed.etc.concatBytes(...msgs)
  return new Uint8Array(createHash('sha512').update(data).digest())
}

// ------ helpers ------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sha256hex(data: Uint8Array): string {
  return hex(new Uint8Array(createHash('sha256').update(data).digest()))
}

async function setup() {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  const publicKeyHex = hex(publicKey)
  const nodeId = await sha256hex(publicKey)
  return { privateKey, publicKeyHex, nodeId }
}

// ------ test runner ------

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${(e as Error).message}`)
    failed++
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

// ------ tests ------

async function run() {
  console.log('\n🔐 SyncThink Ed25519 Auth Tests\n')

  const { privateKey, publicKeyHex, nodeId } = await setup()
  const payload: AgentCommandPayload = { action: 'create', data: { type: 'text', x: 100, y: 100 } }

  await test('正常签名 → 验证通过', async () => {
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    const result = await verifyCommand(cmd)
    assert(result.ok === true, `Expected ok=true, got ${JSON.stringify(result)}`)
  })

  await test('签名被篡改 → signature_invalid', async () => {
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    // 修改签名最后两个字符
    const tampered = cmd.signature.slice(0, -2) + (cmd.signature.endsWith('ff') ? '00' : 'ff')
    const result = await verifyCommand({ ...cmd, signature: tampered })
    assert(result.ok === false && (result as { ok: false; reason: string }).reason === 'signature_invalid',
      `Expected signature_invalid, got ${JSON.stringify(result)}`)
  })

  await test('payload 被篡改 → signature_invalid', async () => {
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    // 修改 payload
    const result = await verifyCommand({ ...cmd, payload: { action: 'clear' } })
    assert(result.ok === false && (result as { ok: false; reason: string }).reason === 'signature_invalid',
      `Expected signature_invalid, got ${JSON.stringify(result)}`)
  })

  await test('timestamp 过期 → expired', async () => {
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    // 将时间戳往过去推 31 秒
    const result = await verifyCommand({ ...cmd, timestamp: cmd.timestamp - 31_000 })
    assert(result.ok === false && (result as { ok: false; reason: string }).reason === 'expired',
      `Expected expired, got ${JSON.stringify(result)}`)
  })

  await test('未来时间戳过大 → expired', async () => {
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    // 将时间戳往未来推 31 秒
    const result = await verifyCommand({ ...cmd, timestamp: cmd.timestamp + 31_000 })
    assert(result.ok === false && (result as { ok: false; reason: string }).reason === 'expired',
      `Expected expired, got ${JSON.stringify(result)}`)
  })

  await test('字段缺失 → malformed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await verifyCommand({ payload, nodeId } as any)
    assert(result.ok === false && (result as { ok: false; reason: string }).reason === 'malformed',
      `Expected malformed, got ${JSON.stringify(result)}`)
  })

  await test('不同 nodeId 不影响签名验证（publicKey 才是真正验证依据）', async () => {
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    // nodeId 可以被替换，但签名依然用 publicKey 验证 → 仍然通过
    // （nodeId 是 SHA-256(publicKey)，只是个标识符，不参与签名验证）
    const result = await verifyCommand({ ...cmd, nodeId: 'deadbeef'.repeat(8) })
    assert(result.ok === true, `Expected ok=true with different nodeId, got ${JSON.stringify(result)}`)
  })

  await test('不同 publicKey 篡改 → signature_invalid', async () => {
    const { publicKeyHex: otherPubKey } = await setup()
    const cmd = await signCommand(payload, privateKey, publicKeyHex, nodeId)
    // 用别人的 publicKey 来验证 → 失败
    const result = await verifyCommand({ ...cmd, publicKey: otherPubKey })
    assert(result.ok === false && (result as { ok: false; reason: string }).reason === 'signature_invalid',
      `Expected signature_invalid, got ${JSON.stringify(result)}`)
  })

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  console.log('All tests passed! 🎉\n')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
