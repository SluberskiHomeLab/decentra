// URL linkification helpers — depends on React for ReactNode return types
import React from 'react'

export const URL_REGEX = /(https?:\/\/[^\s]+|\/api\/download-attachment\/[^\s]+)/gi

export function sanitizeUrl(url: string): string | null {
  try {
    // Allow relative URLs (like /api/download-attachment/...)
    if (url.startsWith('/')) {
      return url
    }
    // For absolute URLs, validate protocol
    const urlObj = new URL(url)
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      return urlObj.toString()
    }
    return null
  } catch {
    return null
  }
}

export function linkifyText(text: string, mentionRenderer?: (content: string) => React.ReactNode): React.ReactNode[] {
  // First, handle mentions if a renderer is provided
  if (mentionRenderer) {
    const mentionParts = text.split(/(@\w+)/g)
    const processedParts: React.ReactNode[] = []

    mentionParts.forEach((part, mentionIndex) => {
      if (part.match(/^@\w+$/)) {
        // This is a mention - render it with the mention renderer
        processedParts.push(
          <span key={`mention-${mentionIndex}`}>
            {mentionRenderer(part)}
          </span>
        )
      } else if (part) {
        // This is regular text - apply custom renderer to it (for emojis) then linkify URLs
        const linkified = linkifyTextPartWithRenderer(part, `part-${mentionIndex}`, mentionRenderer)
        processedParts.push(...linkified)
      }
    })

    return processedParts.length > 0 ? processedParts : [<span key="text-0">{text}</span>]
  }

  // No mention renderer - just linkify normally
  return linkifyTextPart(text, 'text')
}

export function linkifyTextPart(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const regex = new RegExp(URL_REGEX)
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
    }

    const url = match[0]
    const safeUrl = sanitizeUrl(url)

    if (safeUrl) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          {url}
        </a>
      )
    } else {
      parts.push(<span key={`${keyPrefix}-unsafe-${match.index}`}>{url}</span>)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key={`${keyPrefix}-0`}>{text}</span>]
}

export function linkifyTextPartWithRenderer(text: string, keyPrefix: string, renderer: (content: string) => React.ReactNode): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const regex = new RegExp(URL_REGEX)
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the URL (with emoji rendering)
    if (match.index > lastIndex) {
      const textBeforeUrl = text.slice(lastIndex, match.index)
      parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{renderer(textBeforeUrl)}</span>)
    }

    const url = match[0]
    const safeUrl = sanitizeUrl(url)

    if (safeUrl) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          {url}
        </a>
      )
    } else {
      parts.push(<span key={`${keyPrefix}-unsafe-${match.index}`}>{url}</span>)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text (with emoji rendering)
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex)
    parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{renderer(remainingText)}</span>)
  }

  return parts.length > 0 ? parts : [<span key={`${keyPrefix}-0`}>{renderer(text)}</span>]
}
