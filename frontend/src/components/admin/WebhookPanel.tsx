import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'

interface Webhook {
  id: string
  name: string
  url: string
  channel_id: string
  avatar: string
  created_by: string
  created_at: string
}

interface WebhookPanelProps {
  serverId?: string
  isAdmin?: boolean
}

export function WebhookPanel({ serverId, isAdmin = false }: WebhookPanelProps) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newWebhook, setNewWebhook] = useState({
    name: '',
    channel_id: '',
    avatar: isAdmin ? '📢' : '🔗',
  })
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([])
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    loadWebhooks()
    if (serverId && !isAdmin) {
      loadChannels()
    }
  }, [serverId, isAdmin])

  const loadWebhooks = async () => {
    try {
      setLoading(true)
      const endpoint = isAdmin 
        ? '/api/instance-webhooks'
        : `/api/webhooks/server/${serverId}`
      
      const response = await fetch(`${window.location.origin}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      
      const data = await response.json()
      if (data.success) {
        setWebhooks(data.webhooks || [])
      }
    } catch (error) {
      console.error('Failed to load webhooks:', error)
      setFeedback({ kind: 'error', message: 'Failed to load webhooks' })
    } finally {
      setLoading(false)
    }
  }

  const loadChannels = async () => {
    // Get channels from the app store
    const { init } = useAppStore.getState()
    const server = init?.servers?.find((s: any) => s.id === serverId)
    if (server) {
      setChannels(server.channels || [])
    }
  }

  const handleCreateWebhook = async () => {
    if (!newWebhook.name.trim()) {
      setFeedback({ kind: 'error', message: 'Webhook name is required' })
      return
    }

    if (!isAdmin && !newWebhook.channel_id) {
      setFeedback({ kind: 'error', message: 'Please select a channel' })
      return
    }

    try {
      setCreating(true)
      setFeedback(null)

      const endpoint = isAdmin ? '/api/instance-webhooks' : '/api/webhooks'
      const body = isAdmin
        ? {
            name: newWebhook.name,
            avatar: newWebhook.avatar || '📢',
          }
        : {
            server_id: serverId,
            channel_id: newWebhook.channel_id,
            name: newWebhook.name,
            avatar: newWebhook.avatar,
          }

      const response = await fetch(`${window.location.origin}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (data.success) {
        setFeedback({ kind: 'success', message: 'Webhook created successfully' })
        setShowCreateForm(false)
        setNewWebhook({ name: '', channel_id: '', avatar: isAdmin ? '📢' : '🔗' })
        await loadWebhooks()
      } else {
        setFeedback({ kind: 'error', message: data.error || 'Failed to create webhook' })
      }
    } catch (error) {
      console.error('Failed to create webhook:', error)
      setFeedback({ kind: 'error', message: 'Failed to create webhook' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) {
      return
    }

    try {
      const endpoint = isAdmin
        ? `/api/instance-webhooks/${webhookId}`
        : `/api/webhooks/${webhookId}`

      const response = await fetch(`${window.location.origin}${endpoint}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      })

      const data = await response.json()
      if (data.success) {
        setFeedback({ kind: 'success', message: 'Webhook deleted successfully' })
        await loadWebhooks()
      } else {
        setFeedback({ kind: 'error', message: data.error || 'Failed to delete webhook' })
      }
    } catch (error) {
      console.error('Failed to delete webhook:', error)
      setFeedback({ kind: 'error', message: 'Failed to delete webhook' })
    }
  }

  const copyWebhookUrl = (webhookId: string, url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(webhookId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-secondary">Loading webhooks...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {isAdmin ? 'Instance Webhooks' : 'Server Webhooks'}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            {isAdmin
              ? 'Create incoming webhooks that broadcast messages to all instance users'
              : 'Create webhooks to send messages from external applications'}
          </p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="rounded bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Create Webhook
          </button>
        )}
      </div>

      {/* Feedback Messages */}
      {feedback && (
        <div
          className={`rounded-md p-3 ${
            feedback.kind === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="rounded-lg bg-bg-secondary p-6 space-y-4">
          <h3 className="text-lg font-semibold text-text-primary">Create New Webhook</h3>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Webhook Name
            </label>
            <input
              type="text"
              value={newWebhook.name}
              onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
              placeholder="My Awesome Webhook"
              className="w-full rounded bg-bg-tertiary px-3 py-2 text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary"
            />
          </div>

          {!isAdmin && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Channel
                </label>
                <select
                  value={newWebhook.channel_id}
                  onChange={(e) => setNewWebhook({ ...newWebhook, channel_id: e.target.value })}
                  className="w-full rounded bg-bg-tertiary px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="">Select a channel</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Avatar {isAdmin && <span className="text-xs text-text-muted">(emoji)</span>}
            </label>
            <input
              type="text"
              value={newWebhook.avatar}
              onChange={(e) => setNewWebhook({ ...newWebhook, avatar: e.target.value })}
              placeholder={isAdmin ? "📢" : "🔗"}
              className="w-full rounded bg-bg-tertiary px-3 py-2 text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary"
            />
            {isAdmin && (
              <p className="text-xs text-text-muted mt-1">
                This webhook can be POSTed to from external applications and will broadcast to all users
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreateWebhook}
              disabled={creating}
              className="rounded bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false)
                setNewWebhook({ name: '', channel_id: '', avatar: isAdmin ? '📢' : '🔗' })
              }}
              className="rounded bg-bg-tertiary px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-tertiary/70 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Webhooks List */}
      <div className="space-y-3">
        {webhooks.length === 0 ? (
          <div className="rounded-lg bg-bg-secondary p-8 text-center">
            <div className="text-4xl mb-3">🔗</div>
            <p className="text-text-secondary">No webhooks yet</p>
            <p className="text-sm text-text-muted mt-1">
              Create a webhook to get started
            </p>
          </div>
        ) : (
          webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="rounded-lg bg-bg-secondary p-4 hover:bg-bg-secondary/80 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="text-2xl">{webhook.avatar || '🔗'}</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-text-primary font-medium">{webhook.name}</h4>
                    <p className="text-sm text-text-muted mt-1">
                      Created by {webhook.created_by} • {new Date(webhook.created_at).toLocaleDateString()}
                    </p>
                    {webhook.url && (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 rounded bg-bg-tertiary px-2 py-1 text-xs text-text-secondary font-mono overflow-x-auto">
                          {webhook.url}
                        </code>
                        <button
                          onClick={() => copyWebhookUrl(webhook.id, webhook.url)}
                          className="flex-shrink-0 rounded bg-bg-tertiary px-3 py-1 text-xs text-text-primary hover:bg-bg-tertiary/70 transition-colors"
                        >
                          {copiedId === webhook.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteWebhook(webhook.id)}
                  className="ml-3 rounded p-2 text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Delete webhook"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
