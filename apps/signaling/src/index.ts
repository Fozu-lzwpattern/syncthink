/**
 * SyncThink 极简信令服务器
 * 用于 y-webrtc 的 WebSocket 信令交换，不处理任何业务数据
 * 基于 y-webrtc 官方 bin/server.js 的最小实现
 *
 * 启动: npx tsx src/index.ts
 * 默认端口: 4444
 */

import * as http from 'http'
import * as WebSocket from 'ws'

const PORT = Number(process.env.PORT ?? 4444)
const HOST = process.env.HOST ?? '0.0.0.0'

// roomName → Set<WebSocket>
const rooms = new Map<string, Set<WebSocket.WebSocket>>()

function getOrCreateRoom(name: string): Set<WebSocket.WebSocket> {
  if (!rooms.has(name)) rooms.set(name, new Set())
  return rooms.get(name)!
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    service: 'syncthink-signaling',
    version: '0.1.0',
    rooms: rooms.size,
    peers: [...rooms.values()].reduce((s, r) => s + r.size, 0),
  }))
})

const wss = new WebSocket.WebSocketServer({ server })

wss.on('connection', (ws) => {
  let subscribedRooms = new Set<string>()

  ws.on('message', (raw) => {
    let msg: { type: string; topics?: string[]; topic?: string } | null = null
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!msg) return

    if (msg.type === 'subscribe' && Array.isArray(msg.topics)) {
      for (const topic of msg.topics) {
        getOrCreateRoom(topic).add(ws)
        subscribedRooms.add(topic)
      }
    } else if (msg.type === 'unsubscribe' && Array.isArray(msg.topics)) {
      for (const topic of msg.topics) {
        rooms.get(topic)?.delete(ws)
        subscribedRooms.delete(topic)
      }
    } else if (msg.type === 'publish' && msg.topic) {
      const room = rooms.get(msg.topic)
      if (room) {
        const data = raw.toString()
        room.forEach((peer) => {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(data)
          }
        })
      }
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }))
    }
  })

  ws.on('close', () => {
    for (const topic of subscribedRooms) {
      rooms.get(topic)?.delete(ws)
      if (rooms.get(topic)?.size === 0) rooms.delete(topic)
    }
    subscribedRooms.clear()
  })

  ws.on('error', () => ws.terminate())
})

server.listen(PORT, HOST, () => {
  console.log(`[syncthink-signaling] ws://${HOST}:${PORT}  ready ✅`)
})
