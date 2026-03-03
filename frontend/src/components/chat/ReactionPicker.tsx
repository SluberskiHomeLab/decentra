import { REACTION_EMOJIS } from '../../constants/reactions'

interface ReactionPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export function ReactionPicker({ onSelect, onClose }: ReactionPickerProps) {
  return (
    <div className="mt-2 relative">
      <div className="absolute left-0 top-0 z-10 rounded-lg border border-border-primary bg-bg-secondary p-3 shadow-xl max-w-xs">
        <div className="mb-2 text-xs font-semibold text-text-muted">Add Reaction</div>
        <div className="grid grid-cols-8 gap-1 max-h-32 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {REACTION_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSelect(emoji)}
              className="text-lg hover:bg-bg-tertiary rounded p-1 transition"
            >
              {emoji}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 text-xs text-text-muted hover:text-text-secondary"
        >
          Close
        </button>
      </div>
    </div>
  )
}
