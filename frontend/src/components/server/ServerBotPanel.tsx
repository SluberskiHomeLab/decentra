import { useState, useEffect, useCallback } from 'react'
import type { Bot, SlashCommand } from '../../types/protocol'

interface Props {
  serverId: string
}

export default function ServerBotPanel({ serverId }: Props) {
  const [serverBots, setServerBots] = useState<Bot[]>([])
  const [allBots, setAllBots] = useState<Bot[]>([])
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddBot, setShowAddBot] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const token = localStorage.getItem('token')

  const loadServerBots = useCallback(async () => {
    try {
      const [botsRes, cmdsRes] = await Promise.all([
        fetch(`/api/servers/${serverId}/bots`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/servers/${serverId}/commands`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (botsRes.ok) {
        const data = await botsRes.json()
        setServerBots(data.bots || [])
      }
      if (cmdsRes.ok) {
        const data = await cmdsRes.json()
        setCommands(data.commands || [])
      }
    } catch (err) {
      console.error('Failed to load server bots:', err)
    } finally {
      setLoading(false)
    }
  }, [serverId, token])

  const loadAllBots = useCallback(async () => {
    try {
      const res = await fetch(`/api/bots`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        setAllBots(data.bots || [])
      }
    } catch (err) {
      console.error('Failed to load all bots:', err)
    }
  }, [token])

  useEffect(() => { loadServerBots() }, [loadServerBots])

  const handleAddBot = async (botId: string) => {
    try {
      const res = await fetch(`/api/bots/${botId}/servers/${serverId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Bot added to server' })
        loadServerBots()
        setShowAddBot(false)
      } else {
        const data = await res.json()
        setFeedback({ type: 'error', message: data.error || 'Failed to add bot' })
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error' })
    }
  }

  const handleRemoveBot = async (botId: string) => {
    if (!confirm('Remove this bot from the server? It will lose access to all channels.')) return
    try {
      const res = await fetch(`/api/bots/${botId}/servers/${serverId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Bot removed from server' })
        loadServerBots()
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to remove bot' })
    }
  }

  const handleToggleCommand = async (commandId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/servers/${serverId}/commands/${commandId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !currentEnabled }),
      })
      if (res.ok) loadServerBots()
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to toggle command' })
    }
  }

  const openAddBot = () => {
    loadAllBots()
    setShowAddBot(true)
  }

  const availableBots = allBots.filter(
    b => b.is_active && !serverBots.some(sb => sb.bot_id === b.bot_id)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Manage bots and slash commands in this server.</p>
        <button
          type="button"
          onClick={openAddBot}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 transition"
        >
          + Add Bot
        </button>
      </div>

      {feedback && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          feedback.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : 'bg-red-500/20 text-red-300 border border-red-500/30'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* Add Bot Picker */}
      {showAddBot && (
        <div className="rounded-lg border border-white/10 bg-slate-800/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Add Bot to Server</h4>
            <button type="button" onClick={() => setShowAddBot(false)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
          </div>
          {availableBots.length === 0 ? (
            <p className="text-xs text-slate-500">No available bots. Create one first in Admin &gt; Bots.</p>
          ) : (
            <div className="space-y-2">
              {availableBots.map(bot => (
                <div key={bot.bot_id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{bot.avatar || '🤖'}</span>
                    <div>
                      <span className="text-sm font-medium text-white">{bot.name}</span>
                      <p className="text-[10px] text-slate-500">@{bot.username}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddBot(bot.bot_id)}
                    className="rounded bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500 transition"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Server Bots List */}
      {loading ? (
        <p className="text-sm text-slate-500">Loading bots...</p>
      ) : serverBots.length === 0 ? (
        <p className="text-sm text-slate-500">No bots in this server yet.</p>
      ) : (
        <div className="space-y-3">
          {serverBots.map(bot => (
            <div key={bot.bot_id} className="rounded-lg border border-white/10 bg-slate-800/30 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{bot.avatar || '🤖'}</span>
                  <span className="font-semibold text-white text-sm">{bot.name}</span>
                  <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">BOT</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveBot(bot.bot_id)}
                  className="rounded bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/30 transition"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slash Commands */}
      {commands.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-white mt-4">Slash Commands</h4>
          {commands.map(cmd => (
            <div key={cmd.command_id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-sky-300">/{cmd.name}</code>
                  {cmd.bot_name && <span className="text-[10px] text-slate-500">by {cmd.bot_name}</span>}
                </div>
                {cmd.description && <p className="text-xs text-slate-500">{cmd.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleToggleCommand(cmd.command_id, cmd.enabled)}
                className={`rounded px-3 py-1 text-xs font-semibold transition ${
                  cmd.enabled
                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }`}
              >
                {cmd.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
