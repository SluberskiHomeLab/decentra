// Pure URL/embed helpers — no React dependency

export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?$/i
export const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov)(\?[^\s]*)?$/i
export const YOUTUBE_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i

export function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.test(url)
}

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

export function getYouTubeVideoId(url: string): string | null {
  const match = url.match(YOUTUBE_REGEX)
  return match ? match[1] : null
}
