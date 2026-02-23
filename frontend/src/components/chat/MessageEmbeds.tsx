import React from 'react'
import { URL_REGEX, sanitizeUrl } from '../../lib/linkify'
import { getYouTubeVideoId, isImageUrl, isVideoUrl } from '../../lib/embeds'

export function MessageEmbeds({ content }: { content: string }): React.ReactElement | null {
  const urls = content.match(URL_REGEX)
  if (!urls) return null

  const processedUrls = new Set<string>()
  const embeds: React.ReactElement[] = []

  urls.forEach((url, index) => {
    if (processedUrls.has(url)) return
    processedUrls.add(url)

    const safeUrl = sanitizeUrl(url)
    if (!safeUrl) return

    // YouTube embed
    const youtubeId = getYouTubeVideoId(safeUrl)
    if (youtubeId) {
      embeds.push(
        <div key={`embed-${index}`} className="mt-2 overflow-hidden rounded-lg border border-border-primary bg-bg-secondary/40">
          <iframe
            src={`https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="YouTube video"
            className="w-full aspect-video"
          />
        </div>
      )
    }
    // Image embed
    else if (isImageUrl(safeUrl)) {
      embeds.push(
        <div key={`embed-${index}`} className="mt-2">
          <a href={safeUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={safeUrl}
              alt="Embedded image"
              loading="lazy"
              className="max-w-md rounded-lg border border-border-primary"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </a>
        </div>
      )
    }
    // Video embed
    else if (isVideoUrl(safeUrl)) {
      embeds.push(
        <div key={`embed-${index}`} className="mt-2 overflow-hidden rounded-lg border border-border-primary bg-bg-secondary/40">
          <video
            src={safeUrl}
            controls
            preload="metadata"
            className="w-full max-w-md"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
      )
    }
  })

  return <>{embeds}</>
}
