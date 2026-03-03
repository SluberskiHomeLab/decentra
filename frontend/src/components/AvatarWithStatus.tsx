export function AvatarWithStatus({
  avatar,
  avatar_type,
  avatar_data,
  user_status,
  size = 'md',
  showStatus = true,
}: {
  avatar?: string
  avatar_type?: string
  avatar_data?: string | null
  user_status?: 'online' | 'away' | 'busy' | 'offline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showStatus?: boolean
}) {
  const sizeClasses = {
    sm: 'h-6 w-6 text-sm',
    md: 'h-8 w-8 text-lg',
    lg: 'h-12 w-12 text-2xl',
    xl: 'h-20 w-20 text-4xl',
  }

  const statusSizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
    xl: 'h-4 w-4',
  }

  const statusColorClasses = {
    online: 'bg-green-500',
    away: 'bg-yellow-500',
    busy: 'bg-red-500',
    offline: 'bg-gray-500',
  }

  return (
    <div className="relative inline-block">
      <span className={`flex ${sizeClasses[size]} items-center justify-center overflow-hidden rounded-full bg-bg-tertiary`}>
        {avatar_type === 'image' && avatar_data ? (
          <img src={avatar_data} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <>{avatar ?? '👤'}</>
        )}
      </span>
      {showStatus && user_status && (
        <span
          className={`absolute bottom-0 right-0 ${statusSizeClasses[size]} ${statusColorClasses[user_status]} rounded-full border-2 border-bg-primary`}
          title={user_status}
        />
      )}
    </div>
  )
}
