import { useState } from 'react'
import { wsClient } from '../api/wsClient'
import type { ServerInviteUsageLog } from '../types/protocol'

export function useInviteUsage() {
  // Which server's usage logs are currently open in the modal
  const [inviteUsageServerId, setInviteUsageServerId] = useState<string | null>(null)
  const [inviteUsageLogs, setInviteUsageLogs] = useState<ServerInviteUsageLog[] | null>(null)
  const [isLoadingInviteUsage, setIsLoadingInviteUsage] = useState(false)

  // Invite creation limits
  const [serverInviteMaxUses, setServerInviteMaxUses] = useState<number | null>(null)
  const [instanceInviteMaxUses, setInstanceInviteMaxUses] = useState<number | null>(null)

  // Instance-wide invite list
  const [instanceInvitesList, setInstanceInvitesList] = useState<any[] | null>(null)
  const [showInstanceInvitesList, setShowInstanceInvitesList] = useState(false)

  /** Request invite usage logs for a server via WebSocket. */
  const loadInviteUsage = (serverId: string) => {
    setIsLoadingInviteUsage(true)
    setInviteUsageServerId(serverId)
    wsClient.getServerInviteUsage({ type: 'get_server_invite_usage', server_id: serverId })
  }

  return {
    // State
    inviteUsageServerId, setInviteUsageServerId,
    inviteUsageLogs, setInviteUsageLogs,
    isLoadingInviteUsage, setIsLoadingInviteUsage,
    serverInviteMaxUses, setServerInviteMaxUses,
    instanceInviteMaxUses, setInstanceInviteMaxUses,
    instanceInvitesList, setInstanceInvitesList,
    showInstanceInvitesList, setShowInstanceInvitesList,
    // Actions
    loadInviteUsage,
  }
}
