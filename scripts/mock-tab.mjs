/**
 * mock-tab.mjs — 模拟浏览器 tab 连到信令服务
 * 
 * 运行：node --experimental-vm-modules scripts/mock-tab.mjs [channelId]
 * 依赖：从 apps/signaling/node_modules 取 ws + @noble/ed25519
 */

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'

const require = createRequire(import.meta.url)
const { WebSocket } = require('../apps/signaling/node_modules/ws/index.js')
const ed = require('../apps/signaling/node_modules/@noble/ed25519/index.js')

const SIGNALING_URL = 'wss://localhost:3010'
const IDENTITY_PATH = '/root/.syncthink/identity.json'

const channelId = process.argv[2] || `mock-ch-${Date.now()}`
const identity = JSON.parse(readFileSync(IDENTITY_PATH, 'utf8'))
const { nodeId, publicKey, privateKey } = identity

console.log(`[mock-tab] nodeId  : ${nodeId.slice(0, 16)}...`)
console.log(`[mock-tab] channel : ${channelId}`)
console.log(`[mock-tab] connect : ${SIGNALING_URL}`)

const ws = new WebSocket(SIGNALING_URL, { rejectUnauthorized: false })

ws.on('open', async () => {
  console.log('[mock-tab] ✓ connected')

  const timestamp = Date.now()
  const payload = `${nodeId}:${channelId}:${timestamp}`
  const msgBytes = Buffer.from(payload, 'utf-8')
  const privBytes = Buffer.from(privateKey, 'hex')

  const sig = await ed.signAsync(msgBytes, privBytes)
  const signature = Buffer.from(sig).toString('hex')

  const handshake = {
    type: 'syncthink:join',
    nodeId,
    publicKey,
    roomId: channelId,
    timestamp,
    signature,
    displayName: 'MockTab-E2E',
    isAgent: false,
  }

  ws.send(JSON.stringify(handshake))
  console.log('[mock-tab] → handshake sent')
})

ws.on('message', (data) => {
  let msg
  try { msg = JSON.parse(data.toString()) } catch { 
    console.log('[mock-tab] raw:', data.toString().slice(0, 100))
    return
  }

  const type = msg.type || '?'
  console.log(`[mock-tab] ← ${type}`)

  if (type === 'syncthink:join_ack') {
    console.log(`\n[mock-tab] ✅ JOIN ACK — channel: ${channelId}`)
    // 发 y-webrtc subscribe，让 agentApi 能在 rooms 里找到这个 tab
    const subscribeMsg = { type: 'subscribe', topics: [channelId] }
    ws.send(JSON.stringify(subscribeMsg))
    console.log(`[mock-tab] → subscribed to room "${channelId}"`)
    console.log('[mock-tab] Waiting for agent commands...\n')
    console.log(`  CLI test: node apps/cli/dist/index.js card create --channel ${channelId} --type idea --title "Hello from CLI"`)
    console.log(`            node apps/cli/dist/index.js send --channel ${channelId} "test message"\n`)
  }

  if (type === 'syncthink:join_rejected') {
    console.error('[mock-tab] ❌ JOIN REJECTED:', msg.reason)
    process.exit(1)
  }

  // Agent 写入指令：回复 ack 让 agentApi 解除等待
  if (type === 'syncthink:agent_command' || type === 'syncthink:canvas_query') {
    console.log('\n[mock-tab] 🤖 AGENT COMMAND:')
    console.log(JSON.stringify(msg, null, 2))

    const ack = {
      type: 'syncthink:agent_command_result',
      requestId: msg.requestId,
      success: true,
      result: {
        received: true,
        shapes: [],
        note: 'mock-tab received (no real Yjs canvas)',
      },
      timestamp: Date.now(),
    }
    ws.send(JSON.stringify(ack))
    console.log(`[mock-tab] → ack sent (requestId: ${msg.requestId})\n`)
  }
})

ws.on('error', (err) => console.error('[mock-tab] error:', err.message))
ws.on('close', (code) => {
  console.log(`[mock-tab] closed (code=${code})`)
  process.exit(0)
})

process.on('SIGINT', () => { ws.close(); process.exit(0) })
