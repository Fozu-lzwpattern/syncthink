/**
 * useAccessControl — 准入逻辑 hook
 *
 * 处理 peer_joined / peer_admit 两个事件：
 * - owner 侧：检查黑名单 → 访问策略 → inviteCode 验签 → sendPeerAdmit / sendPeerReject
 * - 非 owner 侧：收到 peer_admit 后同步 trustPeer
 */
import { useEffect, useRef } from 'react'
import type { SyncAdapter } from '../sync/adapter'
import type { NodeIdentity } from '../identity/types'
import {
  getChannel,
  verifyInviteCode,
  consumeInviteCode,
} from '../channel/channel'
import type { AgentWsClient } from '../agent/wsClient'

interface Props {
  channelId: string
  identity: NodeIdentity
  adapterRef: React.MutableRefObject<SyncAdapter | null>
  wsClientRef: React.MutableRefObject<AgentWsClient | null>
}

export function useAccessControl({ channelId, identity, adapterRef, wsClientRef }: Props) {
  // 保持最新引用（避免 stale closure）
  const adapterRefInner = useRef(adapterRef)
  const wsClientRefInner = useRef(wsClientRef)
  useEffect(() => { adapterRefInner.current = adapterRef }, [adapterRef])
  useEffect(() => { wsClientRefInner.current = wsClientRef }, [wsClientRef])

  useEffect(() => {
    const handlePeerJoined = async (e: Event) => {
      const { nodeId, publicKey, inviteToken } = (e as CustomEvent<{
        nodeId: string
        publicKey: string
        inviteToken?: string
        timestamp: number
      }>).detail

      const channel = await getChannel(channelId)
      if (!channel) return

      const wsClient = wsClientRefInner.current.current
      const adapter = adapterRefInner.current.current
      if (!wsClient) return

      const isOwner = channel.ownerNodeId === identity.nodeId

      if (!isOwner) {
        // 非 owner：等待 peer_admit 到来后 trustPeer（见 handlePeerAdmit）
        return
      }

      // ① 黑名单检查
      if (channel.bannedNodes?.includes(publicKey)) {
        wsClient.sendPeerReject(nodeId, 'banned')
        return
      }

      const policy = channel.accessPolicy ?? 'whitelist'

      // ② 策略分支
      if (policy === 'open' || policy === 'lan-only' || policy === 'cidr') {
        adapter?.trustPeer(publicKey)
        wsClient.sendPeerAdmit(nodeId, publicKey, 'editor')
        return
      }

      // policy === 'whitelist'
      if (channel.trustedNodes?.includes(publicKey)) {
        adapter?.trustPeer(publicKey)
        wsClient.sendPeerAdmit(nodeId, publicKey, 'editor')
        return
      }

      // 不在白名单，检查 inviteCode
      if (!inviteToken) {
        wsClient.sendPeerReject(nodeId, 'not_trusted')
        return
      }

      const result = await verifyInviteCode(channel, inviteToken, publicKey)
      if (!result.valid) {
        wsClient.sendPeerReject(nodeId, result.reason ?? 'invalid_invite')
        return
      }

      // 验证通过：消费 token + trustPeer + peer_admit
      await consumeInviteCode(channelId, (() => {
        try {
          const b64 = inviteToken.replace(/-/g, '+').replace(/_/g, '/')
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
          const inv = JSON.parse(atob(padded)) as { oneTimeToken: string }
          return inv.oneTimeToken
        } catch {
          return inviteToken
        }
      })(), publicKey)

      adapter?.trustPeer(publicKey)
      wsClient.sendPeerAdmit(nodeId, publicKey, 'editor')
    }

    const handlePeerAdmit = (e: Event) => {
      const { publicKey } = (e as CustomEvent<{ publicKey: string }>).detail
      adapterRefInner.current.current?.trustPeer(publicKey)
    }

    window.addEventListener('syncthink:peer_joined', handlePeerJoined)
    window.addEventListener('syncthink:peer_admit', handlePeerAdmit)

    return () => {
      window.removeEventListener('syncthink:peer_joined', handlePeerJoined)
      window.removeEventListener('syncthink:peer_admit', handlePeerAdmit)
    }
  }, [channelId, identity.nodeId])
}
