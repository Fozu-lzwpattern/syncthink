/**
 * useInvite — 邀请链接生成 & 吊销 hook
 */
import { useState, useCallback } from 'react'
import { getChannel, revokeAllInviteCodes } from '../channel/channel'
import type { NodeIdentity } from '../identity/types'
import { safeCopyText } from '../utils/clipboard'

interface Props {
  channelId: string
  identity: NodeIdentity
}

export function useInvite({ channelId, identity }: Props) {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteUrl, setInviteUrl] = useState(
    `${window.location.origin}${window.location.pathname}?channel=${channelId}`
  )
  const [copied, setCopied] = useState(false)
  const [inviteIsOwner, setInviteIsOwner] = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const openInvite = useCallback(async () => {
    const channel = await getChannel(channelId)
    const policy = channel?.accessPolicy ?? 'whitelist'
    const isOwner = channel?.ownerNodeId === identity.nodeId

    setInviteIsOwner(isOwner)
    setRevokeConfirm(false)

    if (policy === 'whitelist' && isOwner) {
      const { generateInviteCode } = await import('../channel/channel')
      const encoded = await generateInviteCode(channelId, identity.nodeId)
      setInviteUrl(
        `${window.location.origin}${window.location.pathname}?channel=${channelId}&invite=${encoded}`
      )
    } else {
      setInviteUrl(`${window.location.origin}${window.location.pathname}?channel=${channelId}`)
    }

    setShowInvite(true)
  }, [channelId, identity.nodeId])

  const closeInvite = useCallback(() => setShowInvite(false), [])

  const copyInvite = useCallback(() => {
    safeCopyText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(console.error)
  }, [inviteUrl])

  const revokeAll = useCallback(async () => {
    if (!revokeConfirm) {
      setRevokeConfirm(true)
      return
    }
    setRevoking(true)
    try {
      await revokeAllInviteCodes(channelId)
      const { generateInviteCode } = await import('../channel/channel')
      const encoded = await generateInviteCode(channelId, identity.nodeId)
      setInviteUrl(
        `${window.location.origin}${window.location.pathname}?channel=${channelId}&invite=${encoded}`
      )
      setRevokeConfirm(false)
    } finally {
      setRevoking(false)
    }
  }, [channelId, identity.nodeId, revokeConfirm])

  return {
    showInvite,
    inviteUrl,
    copied,
    inviteIsOwner,
    revokeConfirm,
    revoking,
    openInvite,
    closeInvite,
    copyInvite,
    revokeAll,
    setRevokeConfirm,
  }
}
