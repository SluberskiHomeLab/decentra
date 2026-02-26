import { useState, useEffect, useCallback } from 'react'
import type { Bot, BotScope, BotIntent } from '../../types/protocol'

const ALL_SCOPES: { value: BotScope; label: string; description: string }[] = [
  { value: 'READ_MESSAGES', label: 'Read Messages', description: 'Read messages in channels' },
  { value: 'SEND_MESSAGES', label: 'Send Messages', description: 'Send messages to channels' },
  { value: 'MANAGE_MESSAGES', label: 'Manage Messages', description: 'Edit and delete messages' },
  { value: 'READ_MEMBERS', label: 'Read Members', description: 'View server member lists' },
  { value: 'MANAGE_MEMBERS', label: 'Manage Members', description: 'Kick and ban members' },
  { value: 'MANAGE_CHANNELS', label: 'Manage Channels', description: 'Create/edit/delete channels' },
  { value: 'MANAGE_ROLES', label: 'Manage Roles', description: 'Create/edit/assign roles' },
  { value: 'ADD_REACTIONS', label: 'Add Reactions', description: 'Add and remove reactions' },
  { value: 'MANAGE_THREADS', label: 'Manage Threads', description: 'Create and manage threads' },
  { value: 'USE_SLASH_COMMANDS', label: 'Slash Commands', description: 'Register slash commands' },
  { value: 'SEND_DMS', label: 'Send DMs', description: 'Send direct messages' },
  { value: 'MANAGE_SERVER', label: 'Manage Server', description: 'Edit server settings' },
  { value: 'READ_VOICE_STATE', label: 'Read Voice State', description: 'See voice channel users' },
  { value: 'ADMINISTRATOR', label: 'Administrator', description: 'Full access — all permissions' },
]

const ALL_INTENTS: { value: BotIntent; label: string }[] = [
  { value: 'GUILD_MESSAGES', label: 'Messages' },
  { value: 'GUILD_MEMBERS', label: 'Members' },
  { value: 'GUILD_REACTIONS', label: 'Reactions' },
  { value: 'GUILD_CHANNELS', label: 'Channels' },
  { value: 'GUILD_ROLES', label: 'Roles' },
  { value: 'GUILD_VOICE_STATE', label: 'Voice State' },
  { value: 'GUILD_THREADS', label: 'Threads' },
  { value: 'GUILD_POLLS', label: 'Polls' },
  { value: 'DIRECT_MESSAGES', label: 'Direct Messages' },
  { value: 'SLASH_COMMANDS', label: 'Slash Commands' },
]

type BotListItem = Bot & { server_count?: number }

export default function BotPanel() {
  const [bots, setBots] = useState<BotListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [newBotToken, setNewBotToken] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [selectedBot, setSelectedBot] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formAvatar, setFormAvatar] = useState('🤖')
  const [formScopes, setFormScopes] = useState<BotScope[]>(['READ_MESSAGES', 'SEND_MESSAGES', 'USE_SLASH_COMMANDS'])
  const [formIntents, setFormIntents] = useState<BotIntent[]>(['GUILD_MESSAGES', 'SLASH_COMMANDS'])
  const [formRateMsgs, setFormRateMsgs] = useState(30)
  const [formRateApi, setFormRateApi] = useState(120)

  const token = localStorage.getItem('token')

  const loadBots = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/bots`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setBots(data.bots || [])
      }
    } catch (err) {
      console.error('Failed to load bots:', err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { loadBots() }, [loadBots])

  const handleCreateBot = async () => {
    if (!formName.trim() || !formUsername.trim()) {
      setFeedback({ type: 'error', message: 'Name and username are required' })
      return
    }
    setCreating(true)
    setFeedback(null)
    try {
      const response = await fetch(`/api/bots`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formName.trim(),
          username: formUsername.trim(),
          description: formDescription.trim(),
          avatar: formAvatar,
          scopes: formScopes,
          intents: formIntents,
          rate_limit_messages: formRateMsgs,
          rate_limit_api: formRateApi,
        }),
      })
      const data = await response.json()
      if (response.ok && data.success) {
        setNewBotToken(data.bot.token)
        setFeedback({ type: 'success', message: `Bot "${formName}" created! Copy the token below — it won't be shown again.` })
        setShowCreateForm(false)
        resetForm()
        loadBots()
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to create bot' })
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteBot = async (botId: string) => {
    if (!confirm('Are you sure you want to delete this bot? This cannot be undone.')) return
    try {
      const response = await fetch(`/api/bots/${botId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        setFeedback({ type: 'success', message: 'Bot deleted' })
        loadBots()
        if (selectedBot === botId) setSelectedBot(null)
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to delete bot' })
    }
  }

  const handleRegenerateToken = async (botId: string) => {
    if (!confirm('Regenerate token? The old token will immediately stop working.')) return
    try {
      const response = await fetch(`/api/bots/${botId}/regenerate-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (response.ok && data.success) {
        setNewBotToken(data.token)
        setCopiedToken(false)
        setFeedback({ type: 'success', message: 'Token regenerated! Copy it below — it won\'t be shown again.' })
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to regenerate token' })
    }
  }

  const handleToggleActive = async (botId: string, currentlyActive: boolean) => {
    try {
      const response = await fetch(`/api/bots/${botId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: !currentlyActive }),
      })
      if (response.ok) {
        loadBots()
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to toggle bot' })
    }
  }

  const copyToken = () => {
    if (newBotToken) {
      navigator.clipboard.writeText(newBotToken)
      setCopiedToken(true)
      setTimeout(() => setCopiedToken(false), 3000)
    }
  }

  const resetForm = () => {
    setFormName('')
    setFormUsername('')
    setFormDescription('')
    setFormAvatar('🤖')
    setFormScopes(['READ_MESSAGES', 'SEND_MESSAGES', 'USE_SLASH_COMMANDS'])
    setFormIntents(['GUILD_MESSAGES', 'SLASH_COMMANDS'])
    setFormRateMsgs(30)
    setFormRateApi(120)
  }

  const toggleScope = (scope: BotScope) => {
    setFormScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    )
  }

  const toggleIntent = (intent: BotIntent) => {
    setFormIntents(prev =>
      prev.includes(intent) ? prev.filter(i => i !== intent) : [...prev, intent]
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Manage bots for this instance. Bots can connect via WebSocket and REST API to interact with servers.
        </p>
        <button
          type="button"
          onClick={() => { setShowCreateForm(!showCreateForm); setNewBotToken(null) }}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 transition"
        >
          {showCreateForm ? 'Cancel' : '+ Create Bot'}
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          feedback.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : 'bg-red-500/20 text-red-300 border border-red-500/30'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* New Bot Token Display */}
      {newBotToken && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-300">⚠️ Bot Token — Copy it now! It won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-slate-950/60 px-3 py-2 text-xs text-amber-200 font-mono break-all select-all">
              {newBotToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className={`rounded px-3 py-2 text-xs font-semibold transition ${
                copiedToken ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              }`}
            >
              {copiedToken ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setNewBotToken(null); setFeedback(null) }}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create Bot Form */}
      {showCreateForm && (
        <div className="rounded-lg border border-white/10 bg-slate-800/50 p-4 space-y-4">
          <h4 className="text-sm font-semibold text-white">Create New Bot</h4>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-slate-300">Bot Name</span>
              <input
                type="text" value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="My Bot"
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-300">Username (unique)</span>
              <input
                type="text" value={formUsername} onChange={e => setFormUsername(e.target.value)}
                placeholder="mybot"
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-slate-300">Description</span>
            <textarea
              value={formDescription} onChange={e => setFormDescription(e.target.value)}
              placeholder="What does this bot do?"
              rows={2}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-slate-300">Avatar Emoji</span>
              <input
                type="text" value={formAvatar} onChange={e => setFormAvatar(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </label>
            <div>
              <span className="text-xs text-slate-300">Rate Limits</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="number" value={formRateMsgs} onChange={e => setFormRateMsgs(Number(e.target.value))}
                  className="w-1/2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  title="Messages per 10 seconds"
                />
                <input
                  type="number" value={formRateApi} onChange={e => setFormRateApi(Number(e.target.value))}
                  className="w-1/2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  title="API calls per minute"
                />
              </div>
              <span className="text-[10px] text-slate-500">msgs/10s | api/min</span>
            </div>
          </div>

          {/* Scopes */}
          <div>
            <span className="text-xs text-slate-300 font-semibold">Permission Scopes</span>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {ALL_SCOPES.map(s => (
                <label key={s.value} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5 cursor-pointer" title={s.description}>
                  <input
                    type="checkbox"
                    checked={formScopes.includes(s.value)}
                    onChange={() => toggleScope(s.value)}
                    className="accent-sky-500"
                  />
                  <span className="text-xs text-slate-300">{s.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Intents */}
          <div>
            <span className="text-xs text-slate-300 font-semibold">Event Intents</span>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {ALL_INTENTS.map(i => (
                <label key={i.value} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIntents.includes(i.value)}
                    onChange={() => toggleIntent(i.value)}
                    className="accent-sky-500"
                  />
                  <span className="text-xs text-slate-300">{i.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCreateBot}
            disabled={creating}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition"
          >
            {creating ? 'Creating...' : 'Create Bot'}
          </button>
        </div>
      )}

      {/* Bot List */}
      {loading ? (
        <p className="text-sm text-slate-500">Loading bots...</p>
      ) : bots.length === 0 ? (
        <p className="text-sm text-slate-500">No bots created yet. Use the button above to create one.</p>
      ) : (
        <div className="space-y-3">
          {bots.map(bot => (
            <div key={bot.bot_id} className="rounded-lg border border-white/10 bg-slate-800/30 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{bot.avatar || '🤖'}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{bot.name}</span>
                      <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">BOT</span>
                      {!bot.is_active && (
                        <span className="rounded bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-300">DISABLED</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">@{bot.username} · {bot.server_count || 0} servers</p>
                    {bot.description && <p className="text-xs text-slate-500 mt-0.5">{bot.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(bot.bot_id, bot.is_active)}
                    className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                      bot.is_active
                        ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    }`}
                  >
                    {bot.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegenerateToken(bot.bot_id)}
                    className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-600 transition"
                  >
                    Regen Token
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBot(bot.bot_id)}
                    className="rounded bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/30 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Scopes & Intents summary */}
              <div className="mt-3 flex flex-wrap gap-1">
                {(bot.scopes || []).map(s => (
                  <span key={s} className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">{s}</span>
                ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(bot.intents || []).map(i => (
                  <span key={i} className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">{i}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
