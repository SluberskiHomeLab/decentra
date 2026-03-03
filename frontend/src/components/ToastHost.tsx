import { useToastStore } from '../store/toastStore'

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)

  if (toasts.length === 0) return null

  return (
    <div className="fixed right-3 top-3 z-50 flex w-[320px] flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => remove(t.id)}
          className={
            'rounded-xl border px-3 py-2 text-left text-sm shadow-lg backdrop-blur transition hover:border-border-primary/50 ' +
            (t.kind === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-50'
              : t.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-50'
                : 'border-sky-500/25 bg-sky-500/10 text-sky-50')
          }
        >
          {t.message}
          <div className="mt-1 text-[11px] opacity-70">Click to dismiss</div>
        </button>
      ))}
    </div>
  )
}
