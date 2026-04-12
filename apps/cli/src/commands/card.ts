import { loadIdentity } from '../identity.js'
import { apiPost, apiGet, loadCapabilityToken, DEFAULT_API_URL } from '../client.js'

/**
 * syncthink-agent card create --channel <id> --type <cardType> --title <title> [--body <body>]
 */
export async function runCardCreate(opts: {
  channel: string
  type: string
  title: string
  body?: string
  x?: number
  y?: number
  apiUrl?: string
}): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL

  if (!opts.channel) throw new Error('必须指定 --channel <channelId>')
  if (!opts.type) throw new Error('必须指定 --type <cardType>')
  if (!opts.title) throw new Error('必须指定 --title <title>')

  const identity = loadIdentity()
  if (!identity) {
    throw new Error('未找到身份信息，请先运行 syncthink-agent setup')
  }

  const token = loadCapabilityToken()
  const config = { identity, apiUrl, capabilityToken: token ?? undefined }

  console.log(`🃏 创建卡片`)
  console.log(`   Channel : ${opts.channel}`)
  console.log(`   类型    : ${opts.type}`)
  console.log(`   标题    : ${opts.title}`)
  if (opts.body) console.log(`   正文    : ${opts.body.slice(0, 60)}${opts.body.length > 60 ? '...' : ''}`)

  const payload = {
    channelId: opts.channel,
    command: {
      action: 'shape:create',
      shape: {
        type: opts.type,
        props: {
          title: opts.title,
          body: opts.body ?? '',
        },
        x: opts.x ?? 100,
        y: opts.y ?? 100,
      },
    },
  }

  const result = await apiPost('/agent/command', payload, config)
  const data = result as Record<string, unknown>

  console.log(`✅ 卡片已创建`)
  if (data?.shapeId) console.log(`   卡片 ID: ${data.shapeId}`)
  if (data?.id) console.log(`   卡片 ID: ${data.id}`)
}

/**
 * syncthink-agent card list --channel <id>
 */
export async function runCardList(opts: {
  channel: string
  apiUrl?: string
}): Promise<void> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL

  if (!opts.channel) throw new Error('必须指定 --channel <channelId>')

  const identity = loadIdentity()
  if (!identity) {
    throw new Error('未找到身份信息，请先运行 syncthink-agent setup')
  }

  const token = loadCapabilityToken()
  const config = { identity, apiUrl, capabilityToken: token ?? undefined }

  const result = await apiGet('/canvas/elements', { channel: opts.channel }, config)
  const data = result as Record<string, unknown>

  const shapes = (data?.shapes ?? data?.cards ?? []) as unknown[]

  if (!Array.isArray(shapes) || shapes.length === 0) {
    console.log(`ℹ️  Channel ${opts.channel} 中暂无卡片`)
    return
  }

  console.log(`📋 Channel ${opts.channel} 的卡片列表（共 ${shapes.length} 张）:`)
  console.log('─'.repeat(60))

  for (const shape of shapes) {
    const s = shape as Record<string, unknown>
    const id = (s.id ?? s.shapeId ?? '?') as string
    const type = (s.type ?? '?') as string
    const props = (s.props ?? {}) as Record<string, unknown>
    const title = (props.title ?? props.text ?? s.title ?? '（无标题）') as string
    console.log(`  [${id.slice(0, 8)}] ${type.padEnd(12)} ${title}`)
  }

  console.log('─'.repeat(60))
}
