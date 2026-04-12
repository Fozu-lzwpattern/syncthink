import { loadIdentity } from '../identity.js'
import { apiPost, loadCapabilityToken, DEFAULT_API_URL } from '../client.js'

/**
 * syncthink-agent send --channel <id> <message>
 * 发送消息到指定 channel 的 chat（使用 conversation:append action）
 */
export async function runSend(opts: {
  channel: string
  message: string
  sender?: string
  apiUrl?: string
}): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  const sender = opts.sender ?? 'Agent'

  if (!opts.channel) {
    throw new Error('必须指定 --channel <channelId>')
  }
  if (!opts.message) {
    throw new Error('消息内容不能为空')
  }

  const identity = loadIdentity()
  if (!identity) {
    throw new Error('未找到身份信息，请先运行 syncthink-agent setup')
  }

  const token = loadCapabilityToken()
  const config = { identity, apiUrl, capabilityToken: token ?? undefined }

  console.log(`📤 发送消息到 channel: ${opts.channel}`)
  console.log(`   发送者: ${sender}`)
  console.log(`   内容: ${opts.message.slice(0, 50)}${opts.message.length > 50 ? '...' : ''}`)

  const payload = {
    action: 'conversation:append',
    channelId: opts.channel,
    message: {
      sender,
      content: opts.message,
      timestamp: Date.now(),
    },
  }

  const result = await apiPost('/agent/action', payload, config)
  const data = result as Record<string, unknown>

  console.log(`✅ 消息已发送`)
  if (data?.messageId) console.log(`   消息 ID: ${data.messageId}`)
  if (data?.timestamp) {
    console.log(`   服务器时间: ${new Date(data.timestamp as number).toLocaleString()}`)
  }
}
