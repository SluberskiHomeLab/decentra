import React from 'react'
import { parseMessageFormat } from '../../lib/messageFormat'
import type { CustomEmoji, Server } from '../../types/protocol'

interface MessageRendererProps {
  content: string
  messageContext?: string
  messageContextId?: string | null
  serverEmojis: Record<string, CustomEmoji[]>
  currentUsername?: string
  servers?: Server[]
  onChannelClick?: (serverId: string, channelId: string) => void
}

export function MessageRenderer({
  content,
  messageContext,
  messageContextId,
  serverEmojis,
  currentUsername,
  servers,
  onChannelClick,
}: MessageRendererProps): React.ReactElement {
  // Determine which server's emojis to use based on message context
  let availableEmojis: CustomEmoji[] = []

  // Infer context if not provided but contextId exists
  let actualContext = messageContext
  if (!actualContext && messageContextId) {
    if (messageContextId.includes('/')) {
      actualContext = 'server'
    } else if (messageContextId.startsWith('dm_')) {
      actualContext = 'dm'
    }
  }

  if (actualContext === 'server' && messageContextId) {
    const serverId = messageContextId.split('/')[0]
    availableEmojis = serverEmojis[serverId] || []
  }

  // Helper function to process mentions and custom emojis within text
  const processTextWithEmojisAndMentions = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts = text.split(/(@\w+|:\w+:|#\[[^\|\]]+\|[^\]]+\])/g)
    return parts.map((part, index) => {
      const key = `${keyPrefix}-${index}`

      // Handle channel mentions: #[channelName|channelId]
      const channelMentionMatch = part.match(/^#\[([^\|\]]+)\|([^\]]+)\]$/)
      if (channelMentionMatch) {
        const [, chName, chId] = channelMentionMatch
        // Find what server this channel belongs to
        const server = servers?.find((s) => s.channels?.some((ch) => ch.id === chId))
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              if (server && onChannelClick) {
                onChannelClick(server.id, chId)
              }
            }}
            className="inline-flex items-center gap-0.5 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 hover:text-sky-200 px-1.5 py-0.5 rounded font-medium text-sm transition cursor-pointer"
            title={`Go to #${chName}`}
          >
            #{chName}
          </button>
        )
      }

      // Handle mentions
      if (part.match(/^@\w+$/)) {
        const mentionedUser = part.slice(1)
        const isCurrentUser = mentionedUser === currentUsername
        return (
          <span
            key={key}
            className={`font-semibold ${
              isCurrentUser
                ? 'bg-sky-500/30 text-sky-300 px-1 rounded'
                : 'text-sky-400'
            }`}
          >
            {part}
          </span>
        )
      }

      // Handle custom emojis
      if (part.match(/^:\w+:$/)) {
        const emojiName = part.slice(1, -1)
        const emoji = availableEmojis.find(e => e.name === emojiName)
        if (emoji) {
          return (
            <img
              key={key}
              src={emoji.image_data}
              alt={`:${emojiName}:`}
              title={`:${emojiName}:`}
              className="inline-block w-5 h-5 object-contain align-text-bottom mx-0.5"
            />
          )
        }
        return <span key={key}>{part}</span>
      }

      return <span key={key}>{part}</span>
    })
  }

  // Parse message formatting
  const tokens = parseMessageFormat(content)

  // Render formatted tokens with mention and emoji support
  const rendered = tokens.map((token, index) => {
    const key = `fmt-${index}`

    switch (token.type) {
      case 'bold':
        return (
          <strong key={key} className="font-bold">
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </strong>
        )

      case 'italic':
        return (
          <em key={key} className="italic">
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </em>
        )

      case 'boldItalic':
        return (
          <strong key={key} className="font-bold italic">
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </strong>
        )

      case 'code':
        return (
          <code key={key} className="bg-bg-tertiary/60 text-sky-300 px-1.5 py-0.5 rounded text-sm font-mono">
            {token.content}
          </code>
        )

      case 'codeBlock':
        return (
          <pre key={key} className="bg-bg-tertiary/60 text-text-secondary p-3 rounded-lg overflow-x-auto my-1 border border-white/5">
            <code className="text-sm font-mono block">
              {token.language && (
                <div className="text-xs text-text-muted mb-1">{token.language}</div>
              )}
              {token.content}
            </code>
          </pre>
        )

      case 'strikethrough':
        return (
          <s key={key} className="line-through opacity-75">
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </s>
        )

      case 'spoiler':
        return (
          <span
            key={key}
            className="bg-bg-tertiary text-bg-tertiary hover:text-text-secondary cursor-pointer px-1 rounded transition-colors select-none"
            title="Click to reveal spoiler"
            onClick={(e) => {
              const target = e.currentTarget
              target.classList.toggle('text-bg-tertiary')
              target.classList.toggle('text-text-secondary')
            }}
          >
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </span>
        )

      case 'quote':
        return (
          <div key={key} className="border-l-2 border-border-secondary pl-3 py-0.5 italic text-text-secondary my-1">
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </div>
        )

      case 'text':
      default:
        return (
          <span key={key}>
            {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
          </span>
        )
    }
  })

  return <>{rendered}</>
}
