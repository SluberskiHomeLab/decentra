import { useState, useRef, useEffect } from 'react'
import type { ChangeEvent } from 'react'
import { getStoredAuth } from '../auth/storage'

export interface SearchResult {
  id: number
  username: string
  content: string
  timestamp: string
  context_type: 'server' | 'dm'
  context_id: string
  avatar?: string
  avatar_type?: 'emoji' | 'image'
  avatar_data?: string | null
}

interface SearchBarProps {
  currentUsername: string | null
  onResultClick: (result: SearchResult) => void
}

export function SearchBar({ currentUsername, onResultClick }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchDebounceRef = useRef<number | undefined>(undefined)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Close results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim() || !currentUsername) {
      setResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      const { token } = getStoredAuth()
      
      if (!token) {
        console.error('No authentication token available')
        setResults([])
        setIsSearching(false)
        return
      }

      const response = await fetch(
        `/api/search-messages?query=${encodeURIComponent(searchQuery)}&limit=50`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )
      const data = await response.json()
      
      if (data.success && data.results) {
        setResults(data.results)
        setShowResults(true)
      } else {
        setResults([])
      }
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleQueryChange = (value: string) => {
    setQuery(value)
    
    // Clear previous debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    // Debounce search
    if (value.trim()) {
      searchDebounceRef.current = window.setTimeout(() => {
        performSearch(value)
      }, 300)
    } else {
      setResults([])
      setShowResults(false)
    }
  }

  const handleResultClick = (result: SearchResult) => {
    onResultClick(result)
    setShowResults(false)
    setQuery('')
    setResults([])
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const highlightQuery = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text
    
    // Escape regex metacharacters to prevent errors and incorrect highlighting
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() 
        ? <mark key={i} className="bg-yellow-500/30 text-yellow-200">{part}</mark>
        : part
    )
  }

  const truncateContent = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '...'
  }

  const getContextLabel = (result: SearchResult) => {
    if (result.context_type === 'dm') {
      return 'DM'
    }
    // For server messages, extract server and channel from context_id
    if (result.context_id && result.context_id.includes('/')) {
      const parts = result.context_id.split('/')
      return `${parts[0]}/${parts[1]}`
    }
    return 'Server'
  }

  return (
    <div ref={searchContainerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleQueryChange(e.target.value)}
          onFocus={() => query.trim() && results.length > 0 && setShowResults(true)}
          placeholder="Search messages..."
          className="w-64 rounded-lg border border-border-primary bg-bg-primary/40 px-3 py-1.5 pr-8 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
        />
        {isSearching && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute top-full mt-2 w-96 max-h-64 overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary shadow-2xl z-50">
          <div className="p-2">
            <div className="mb-2 px-2 text-xs font-semibold text-text-muted">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </div>
            <div className="space-y-1">
              {results.map((result: SearchResult) => (
                <button
                  key={result.id}
                  onClick={() => handleResultClick(result)}
                  className="w-full rounded-lg bg-bg-primary/40 px-3 py-2 text-left hover:bg-bg-tertiary/50 transition"
                >
                  <div className="flex items-start gap-2">
                    <div className="shrink-0 mt-0.5">
                      {result.avatar_type === 'image' && result.avatar_data ? (
                        <img 
                          src={result.avatar_data} 
                          alt="" 
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center text-sm">
                          {result.avatar || '👤'}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-text-secondary">
                          {result.username}
                        </span>
                        <span className="text-xs text-text-muted">
                          {formatTimestamp(result.timestamp)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-text-secondary break-words">
                        {highlightQuery(truncateContent(result.content), query)}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        in {getContextLabel(result)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showResults && results.length === 0 && query.trim() && !isSearching && (
        <div className="absolute top-full mt-2 w-96 rounded-xl border border-border-primary bg-bg-secondary shadow-2xl p-4 z-50">
          <div className="text-sm text-text-muted text-center">
            No messages found for "{query}"
          </div>
        </div>
      )}
    </div>
  )
}
