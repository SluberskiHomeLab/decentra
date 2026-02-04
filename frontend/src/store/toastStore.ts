import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export type Toast = {
  id: string
  kind: ToastKind
  message: string
}

type ToastState = {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>, opts?: { ttlMs?: number }) => void
  remove: (id: string) => void
  clear: () => void
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast, opts) => {
    const id = makeId()
    const ttlMs = opts?.ttlMs ?? 4500

    set((state) => ({ toasts: [...state.toasts, { id, ...toast }] }))

    window.setTimeout(() => {
      // only remove if still present
      if (get().toasts.some((t) => t.id === id)) {
        get().remove(id)
      }
    }, ttlMs)
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))
