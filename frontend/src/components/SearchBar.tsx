import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { getStoredAuth } from '../auth/storage'
import type { Server, Dm, Friend } from '../types/protocol'

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
  pinned?: boolean
}

interface SearchBarProps {
  currentUsername: string | null
  onResultClick: (result: SearchResult) => void
  servers?: Server[]
  dms?: Dm[]
  friends?: Friend[]
}

// ---- Filter syntax definitions ----
const FILTER_KEYS = ['from', 'mentions', 'in', 'has', 'before', 'after', 'during', 'is'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

const HAS_OPTIONS = ['file', 'link', 'image', 'video', 'audio', 'embed']
const IS_OPTIONS = ['pinned']
const DATE_SHORTCUTS = ['today', 'yesterday', '7d', '30d']

// Regex that matches filter tokens in the query string for highlighting
const FILTER_TOKEN_RE = /(?:^|\s)((?:from|mentions|in|has|before|after|during|is):(?:"[^"]*"|\S+))/gi

// ---- Help data ----
const FILTER_HELP: { key: string; desc: string; example: string }[] = [
  { key: 'from:', desc: 'From a user', example: 'from:alice' },
  { key: 'mentions:', desc: 'Mentioning a user', example: 'mentions:bob' },
  { key: 'in:', desc: 'In a channel or DMs', example: 'in:general  in:dm' },
  { key: 'has:', desc: 'Contains media', example: 'has:file  has:link  has:image' },
  { key: 'before:', desc: 'Before a date', example: 'before:2025-06-01  before:7d' },
  { key: 'after:', desc: 'After a date', example: 'after:2025-01-01  after:30d' },
  { key: 'during:', desc: 'On a specific date', example: 'during:today' },
  { key: 'is:', desc: 'Message flags', example: 'is:pinned' },
]

export function SearchBar({ currentUsername, onResultClick, servers, dms, friends }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [filtersApplied, setFiltersApplied] = useState(false)

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)

  const searchDebounceRef = useRef<number | undefined>(undefined)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Build username list for from:/mentions: autocomplete
  const knownUsers = useMemo(() => {
    const set = new Set<string>()
    if (currentUsername) set.add(currentUsername)
    friends?.forEach((f) => set.add(f.username))
    dms?.forEach((d) => set.add(d.username))
    servers?.forEach((s) => {
      // Server owner is always a member
      if (s.owner) set.add(s.owner)
    })
    return Array.from(set).sort()
  }, [currentUsername, friends, dms, servers])

  // Build channel name list for in: autocomplete
  const knownChannels = useMemo(() => {
    const names = new Set<string>()
    names.add('dm')
    servers?.forEach((s) => {
      names.add(s.name)
      s.channels?.forEach((ch) => names.add(ch.name))
    })
    return Array.from(names).sort()
  }, [servers])

  // Close results / suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowResults(false)
        setShowSuggestions(false)
        setShowHelp(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ---- Autocomplete logic ----
  const computeSuggestions = useCallback(
    (value: string): string[] => {
      if (!value) return []
      const cursorPos = inputRef.current?.selectionStart ?? value.length
      const textBeforeCursor = value.slice(0, cursorPos)

      // Check if cursor is right after a filter key or partial value
      // Match pattern: key:partialValue at end
      const filterMatch = textBeforeCursor.match(/(from|mentions|in|has|before|after|during|is):(\S*)$/i)
      if (!filterMatch) {
        // Maybe the user is typing a filter key prefix
        const keyPrefix = textBeforeCursor.match(/(?:^|\s)(\w+)$/)?.[1]?.toLowerCase()
        if (keyPrefix && keyPrefix.length >= 1) {
          const matchingKeys = FILTER_KEYS.filter((k) => k.startsWith(keyPrefix) && k !== keyPrefix)
          if (matchingKeys.length > 0) {
            return matchingKeys.map((k) => k + ':')
          }
        }
        return []
      }

      const key = filterMatch[1].toLowerCase() as FilterKey
      const partial = filterMatch[2].toLowerCase()

      let options: string[] = []
      if (key === 'from' || key === 'mentions') {
        options = knownUsers
      } else if (key === 'in') {
        options = knownChannels
      } else if (key === 'has') {
        options = HAS_OPTIONS
      } else if (key === 'is') {
        options = IS_OPTIONS
      } else if (key === 'before' || key === 'after' || key === 'during') {
        options = DATE_SHORTCUTS
      }

      if (partial) {
        options = options.filter((o) => o.toLowerCase().startsWith(partial) && o.toLowerCase() !== partial)
      }

      return options.slice(0, 8)
    },
    [knownUsers, knownChannels],
  )

  // ---- Search execution ----
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
        setResults([])
        setIsSearching(false)
        return
      }

      const response = await fetch(`/api/search-messages?query=${encodeURIComponent(searchQuery)}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (data.success && data.results) {
        setResults(data.results)
        setShowResults(true)
        setFiltersApplied(!!data.filters_applied)
      } else {
        setResults([])
        setFiltersApplied(false)
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

    // Clear previous debounce
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)

    // Update suggestions
    const newSuggestions = computeSuggestions(value)
    setSuggestions(newSuggestions)
    setSelectedSuggestion(-1)
    setShowSuggestions(newSuggestions.length > 0)

    // Debounce actual search
    if (value.trim()) {
      searchDebounceRef.current = window.setTimeout(() => {
        performSearch(value)
      }, 400)
    } else {
      setResults([])
      setShowResults(false)
      setFiltersApplied(false)
    }
  }

  const applySuggestion = (suggestion: string) => {
    const cursorPos = inputRef.current?.selectionStart ?? query.length
    const textBeforeCursor = query.slice(0, cursorPos)
    const textAfterCursor = query.slice(cursorPos)

    // Find the partial text to replace
    const filterMatch = textBeforeCursor.match(/((?:from|mentions|in|has|before|after|during|is):)(\S*)$/i)
    const keyPrefixMatch = textBeforeCursor.match(/(?:^|\s)(\w+)$/)

    let newQuery: string
    if (filterMatch) {
      // Replace the partial value
      const beforeFilter = textBeforeCursor.slice(0, textBeforeCursor.length - filterMatch[0].length)
      const needsQuote = suggestion.includes(' ')
      const val = needsQuote ? `"${suggestion}"` : suggestion
      newQuery = beforeFilter + filterMatch[1] + val + (textAfterCursor.startsWith(' ') ? '' : ' ') + textAfterCursor
    } else if (keyPrefixMatch) {
      // Replace partial key with full key:
      const beforeKey = textBeforeCursor.slice(0, textBeforeCursor.length - keyPrefixMatch[1].length)
      newQuery = beforeKey + suggestion + textAfterCursor
    } else {
      newQuery = query + suggestion + ' '
    }

    setQuery(newQuery.trimEnd() + (newQuery.endsWith(':') ? '' : ' '))
    setShowSuggestions(false)
    setSuggestions([])
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSuggestion((prev) => (prev + 1) % suggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (selectedSuggestion >= 0) {
          e.preventDefault()
          applySuggestion(suggestions[selectedSuggestion])
          return
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false)
        return
      }
    }

    if (e.key === 'Escape') {
      setShowResults(false)
      setShowHelp(false)
    }
  }

  const handleResultClick = (result: SearchResult) => {
    onResultClick(result)
    setShowResults(false)
    setQuery('')
    setResults([])
    setFiltersApplied(false)
  }

  // ---- Formatting helpers ----
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

  const highlightQuery = (text: string, q: string): React.ReactNode => {
    // Extract free-text portion (strip filter tokens)
    const freeText = q.replace(FILTER_TOKEN_RE, '').trim()
    if (!freeText) return text
    const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === freeText.toLowerCase() ? (
        <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    )
  }

  const truncateContent = (content: string, maxLength: number = 120) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '…'
  }

  const getContextLabel = (result: SearchResult) => {
    if (result.context_type === 'dm') return 'DM'
    if (result.context_id?.includes('/')) {
      const parts = result.context_id.split('/')
      // Try to resolve to friendly names
      const server = servers?.find((s) => s.id === parts[0])
      const channel = server?.channels?.find((ch) => ch.id === parts[1])
      if (server && channel) return `${server.name} › #${channel.name}`
      return `${parts[0]}/${parts[1]}`
    }
    return 'Server'
  }

  return (
    <div ref={searchContainerRef} className="relative">
      {/* Input row */}
      <div className="relative flex items-center gap-1">
        <div className="relative flex-1">
          {/* Styled overlay (shows colored filter tokens) */}
          <div
            className="pointer-events-none absolute inset-0 flex items-center px-3 py-1.5 text-sm whitespace-pre overflow-hidden"
            aria-hidden
          >
            <span className="invisible">{query || ' '}</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleQueryChange(e.target.value)}
            onFocus={() => {
              if (query.trim() && results.length > 0) setShowResults(true)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search… (try from: in: has: before:)"
            className="w-72 rounded-lg border border-border-primary bg-bg-primary/40 px-3 py-1.5 pr-16 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
          />
          {/* Spinner */}
          {isSearching && (
            <div className="absolute right-8 top-1/2 -translate-y-1/2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
            </div>
          )}
          {/* Help button */}
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent-primary transition text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center border border-border-primary/50 hover:border-accent-primary/50"
            title="Search filters help"
          >
            ?
          </button>
        </div>
      </div>

      {/* Autocomplete suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full mt-1 w-72 rounded-lg border border-border-primary bg-bg-secondary shadow-xl z-[60] overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              type="button"
              key={s}
              onClick={() => applySuggestion(s)}
              className={`w-full px-3 py-1.5 text-left text-sm transition ${
                i === selectedSuggestion
                  ? 'bg-accent-primary/20 text-accent-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Help popover */}
      {showHelp && (
        <div className="absolute top-full mt-2 right-0 w-80 rounded-xl border border-border-primary bg-bg-secondary shadow-2xl z-[60] p-3">
          <div className="text-xs font-semibold text-text-muted mb-2">Search Filters</div>
          <div className="space-y-1.5">
            {FILTER_HELP.map((h) => (
              <div key={h.key} className="flex gap-2 text-xs">
                <code className="shrink-0 rounded bg-accent-primary/15 text-accent-primary px-1 py-0.5 font-mono">
                  {h.key}
                </code>
                <div className="min-w-0">
                  <span className="text-text-secondary">{h.desc}</span>
                  <div className="text-text-muted mt-0.5">{h.example}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border-primary text-xs text-text-muted">
            Combine filters freely: <code className="text-accent-primary">from:alice has:image after:7d</code>
          </div>
        </div>
      )}

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute top-full mt-2 w-[28rem] max-h-80 overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary shadow-2xl z-50">
          <div className="p-2">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-xs font-semibold text-text-muted">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </span>
              {filtersApplied && (
                <span className="text-xs rounded bg-accent-primary/15 text-accent-primary px-1.5 py-0.5">
                  Filtered
                </span>
              )}
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
                        <img src={result.avatar_data} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center text-sm">{result.avatar || '👤'}</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-text-secondary">{result.username}</span>
                        <div className="flex items-center gap-1.5">
                          {result.pinned && (
                            <span className="text-xs text-yellow-400" title="Pinned">
                              📌
                            </span>
                          )}
                          <span className="text-xs text-text-muted">{formatTimestamp(result.timestamp)}</span>
                        </div>
                      </div>
                      <div className="mt-0.5 text-xs text-text-secondary break-words">
                        {highlightQuery(truncateContent(result.content), query)}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">in {getContextLabel(result)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {showResults && results.length === 0 && query.trim() && !isSearching && (
        <div className="absolute top-full mt-2 w-[28rem] rounded-xl border border-border-primary bg-bg-secondary shadow-2xl p-4 z-50">
          <div className="text-sm text-text-muted text-center">
            No messages found for &ldquo;{query}&rdquo;
          </div>
          <div className="mt-2 text-xs text-text-muted text-center">
            💡 Try filter operators like{' '}
            <code className="text-accent-primary cursor-pointer" onClick={() => setShowHelp(true)}>
              from: in: has:
            </code>
          </div>
        </div>
      )}
    </div>
  )
}
