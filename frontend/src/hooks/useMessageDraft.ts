import { useState } from 'react'
import type { WsChatMessage } from '../types/protocol'

export function useMessageDraft() {
  // Outgoing message draft
  const [draft, setDraft] = useState('')

  // Reply-to state (shows the quoted message bar above the composer)
  const [replyingTo, setReplyingTo] = useState<WsChatMessage | null>(null)

  // Inline message-edit state
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  return {
    draft, setDraft,
    replyingTo, setReplyingTo,
    editingMessageId, setEditingMessageId,
    editDraft, setEditDraft,
  }
}
