import type React from 'react'
import { useRef, useState } from 'react'
import { getStoredAuth } from '../auth/storage'
import { useAppStore } from '../store/appStore'
import { useToastStore } from '../store/toastStore'

const EXECUTABLE_EXTENSIONS = ['.exe', '.sh', '.bat', '.ps1', '.cmd', '.com', '.msi', '.scr', '.vbs', '.js', '.jar']
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov']

interface UseFileUploadParams {
  /** Admin settings (local ChatPage state) — used for max_attachment_size_mb validation */
  adminSettings: Record<string, any>
  /** Called after media files are uploaded so the caller can append the embed URLs to the draft */
  onUrlsReady: (urls: string[]) => void
}

export function useFileUpload({ adminSettings, onUrlsReady }: UseFileUploadParams) {
  const authToken = useAppStore((s) => s.authToken)
  const pushToast = useToastStore((s) => s.push)

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const maxSizeBytes = () => (adminSettings.max_attachment_size_mb || 10) * 1024 * 1024
  const maxSizeMb = () => adminSettings.max_attachment_size_mb || 10

  // ── Validate & queue files for attachment (non-media or manual select) ──

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const max = maxSizeBytes()
    const valid: File[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
      if (EXECUTABLE_EXTENSIONS.includes(ext)) {
        pushToast({ kind: 'error', message: `${file.name}: Executable files are not allowed` })
        continue
      }
      if (file.size > max) {
        pushToast({ kind: 'error', message: `${file.name}: File exceeds maximum size of ${maxSizeMb()}MB` })
        continue
      }
      valid.push(file)
    }
    setSelectedFiles(prev => [...prev, ...valid])
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // ── Drag-and-drop handlers ──

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files) {
      await handleDroppedFiles(e.dataTransfer.files)
    }
  }

  /** Categorises dropped files: embeds media immediately, queues the rest. */
  const handleDroppedFiles = async (files: FileList) => {
    if (!files || files.length === 0) return
    const max = maxSizeBytes()
    const toEmbed: File[] = []
    const toAttach: File[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
      if (EXECUTABLE_EXTENSIONS.includes(ext)) {
        pushToast({ kind: 'error', message: `${file.name}: Executable files are not allowed` })
        continue
      }
      if (file.size > max) {
        pushToast({ kind: 'error', message: `${file.name}: File exceeds maximum size of ${maxSizeMb()}MB` })
        continue
      }
      if (IMAGE_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext)) {
        toEmbed.push(file)
      } else {
        toAttach.push(file)
      }
    }

    if (toAttach.length > 0) setSelectedFiles(prev => [...prev, ...toAttach])
    if (toEmbed.length > 0) await uploadAndEmbedFiles(toEmbed)
  }

  // ── Upload helpers ──

  /** Uploads media files to the server and calls onUrlsReady with the resulting URLs. */
  const uploadAndEmbedFiles = async (files: File[]) => {
    const token = authToken || getStoredAuth().token
    if (!token) {
      pushToast({ kind: 'error', message: 'Authentication required' })
      return
    }

    setIsUploading(true)
    try {
      const uploadedUrls: string[] = []
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('token', token)
        formData.append('message_id', '0')
        try {
          const response = await fetch('/api/upload-attachment', {
            method: 'POST',
            body: formData,
          })
          if (!response.ok) {
            const data = await response.json()
            pushToast({ kind: 'error', message: data.error || `Failed to upload ${file.name}` })
          } else {
            const data = await response.json()
            if (data.success && data.attachment) {
              const url = `/api/download-attachment/${data.attachment.attachment_id}/${encodeURIComponent(data.attachment.filename)}`
              uploadedUrls.push(url)
            }
          }
        } catch {
          pushToast({ kind: 'error', message: `Failed to upload ${file.name}` })
        }
      }
      if (uploadedUrls.length > 0) {
        onUrlsReady(uploadedUrls)
        pushToast({ kind: 'success', message: `${uploadedUrls.length} file(s) ready to embed` })
      }
    } finally {
      setIsUploading(false)
    }
  }

  return {
    // State
    selectedFiles, setSelectedFiles,
    isUploading, setIsUploading,
    isDragging,
    fileInputRef,
    // Handlers
    handleFileSelect,
    removeFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDroppedFiles,
    uploadAndEmbedFiles,
  }
}
