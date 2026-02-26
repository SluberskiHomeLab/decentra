import { useState, useEffect, useCallback, useRef } from 'react'
import type { SlashCommand } from '../../types/protocol'

interface Props {
  serverId: string
  visible: boolean
  filter: string
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

export default function SlashCommandPicker({ serverId, visible, filter, onSelect, onClose }: Props) {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const token = localStorage.getItem('token')

  const loadCommands = useCallback(async () => {
    if (!serverId) return
    try {
      const res = await fetch(`/api/servers/${serverId}/commands`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setCommands((data.commands || []).filter((c: SlashCommand) => c.enabled))
      }
    } catch (err) {
      console.error('Failed to load slash commands:', err)
    }
  }, [serverId, token])

  useEffect(() => {
    if (visible) loadCommands()
  }, [visible, loadCommands])

  const filtered = commands.filter(
    cmd => cmd.name.toLowerCase().includes(filter.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Handle keyboard navigation from parent
  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (filtered.length > 0) {
          e.preventDefault()
          onSelect(filtered[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [visible, filtered, selectedIndex, onSelect, onClose])

  if (!visible || filtered.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 w-80 max-h-60 overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary shadow-xl z-50"
    >
      <div className="p-2 text-xs font-semibold text-text-muted border-b border-white/5 px-3">
        Slash Commands
      </div>
      {filtered.map((cmd, idx) => (
        <button
          key={cmd.command_id}
          type="button"
          onClick={() => onSelect(cmd)}
          className={`w-full text-left px-3 py-2 flex items-start gap-2 transition ${
            idx === selectedIndex ? 'bg-sky-500/20' : 'hover:bg-white/5'
          }`}
        >
          <code className="text-sky-400 text-sm shrink-0">/{cmd.name}</code>
          <div className="min-w-0 flex-1">
            {cmd.description && <p className="text-xs text-slate-400 truncate">{cmd.description}</p>}
            {cmd.bot_name && <p className="text-[10px] text-slate-600">by {cmd.bot_name}</p>}
          </div>
        </button>
      ))}
    </div>
  )
}
