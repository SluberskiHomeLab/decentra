import { useState, useEffect } from 'react'
import { wsClient } from '../../api/wsClient'

interface User {
  username: string
  email: string | null
  created_at: string
}

export function UsersPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    // Request users list when component mounts
    loadUsers()

    // Listen for user list updates
    const unsubscribe = wsClient.onMessage((data) => {
      if (data.type === 'registered_users') {
        setUsers(data.users || [])
        setLoading(false)
      } else if (data.type === 'user_deleted') {
        // Remove the deleted user from the list
        setUsers(prev => prev.filter(u => u.username !== data.username))
        setDeletingUser(null)
        setConfirmDelete(null)
      } else if (data.type === 'error' && deletingUser) {
        // Handle error during deletion
        setDeletingUser(null)
      }
    })

    return unsubscribe
  }, [deletingUser])

  const loadUsers = () => {
    setLoading(true)
    wsClient.send({ type: 'get_registered_users' })
  }

  const handleDeleteUser = (username: string) => {
    setDeletingUser(username)
    wsClient.send({ 
      type: 'delete_registered_user', 
      username 
    })
  }

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-text-muted">Loading users...</div>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-text-muted">No users found.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">
          Total Users: <span className="font-semibold text-text-secondary">      {users.length}</span>
        </div>
        <button
          type="button"
          onClick={loadUsers}
          className="rounded-lg bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-tertiary/70"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-primary/40">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border-primary bg-bg-secondary/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Username
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Registered
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-secondary">
              {users.map((user) => (
                <tr key={user.username} className="hover:bg-bg-secondary/30">
                  <td className="px-4 py-3 text-sm font-medium text-text-primary">
                    {user.username}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-secondary">
                    {user.email || <span className="text-text-muted italic">No email</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmDelete === user.username ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-text-muted">Confirm deletion?</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user.username)}
                          disabled={deletingUser === user.username}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {deletingUser === user.username ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          disabled={deletingUser === user.username}
                          className="rounded-lg bg-bg-tertiary px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-tertiary/70"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(user.username)}
                        disabled={deletingUser !== null}
                        className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        🚫 Kick User
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="flex items-start gap-2">
          <span className="text-amber-400 text-lg">⚠️</span>
          <div className="text-xs text-amber-200/80">
            <strong className="font-semibold">Warning:</strong> Kicking a user will permanently delete their account. 
            Their messages will remain visible but will show as sent by <code className="rounded bg-black/30 px-1 py-0.5">[Deleted User]</code>.
            This action cannot be undone.
          </div>
        </div>
      </div>
    </div>
  )
}
