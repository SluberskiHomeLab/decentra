export type WsAuthSuccess = {
  type: 'auth_success'
  message?: string
  token: string
}

export type Avatar = {
  avatar?: string
  avatar_type?: 'emoji' | 'image' | string
  avatar_data?: string | null
}

export type Profile = {
  bio?: string
  status_message?: string
}

export type ServerChannel = {
  id: string
  name: string
  type?: 'text' | 'voice' | string
}

export type ServerPermissions = {
  can_create_channel?: boolean
  can_edit_channel?: boolean
  can_delete_channel?: boolean
  can_edit_messages?: boolean
  can_delete_messages?: boolean
}

export type Server = {
  id: string
  name: string
  owner: string
  icon?: string
  icon_type?: 'emoji' | 'image' | string
  icon_data?: string | null
  channels: ServerChannel[]
  permissions?: ServerPermissions
}

export type Dm = {
  id: string
  username: string
} & Avatar

export type Friend = {
  username: string
} & Avatar &
  Profile

export type WsAuthError = {
  type: 'auth_error'
  message?: string
}

export type WsTwoFaRequired = {
  type: '2fa_required'
  message?: string
}

export type WsInit = {
  type: 'init'
  username: string
  is_admin?: boolean
  notification_mode?: string
  servers?: Server[]
  dms?: Dm[]
  friends?: Friend[]
  friend_requests_sent?: Friend[]
  friend_requests_received?: Friend[]
} & Avatar &
  Profile

export type WsDataSynced = {
  type: 'data_synced'
  servers?: Server[]
  dms?: Dm[]
  friends?: Friend[]
  friend_requests_sent?: Friend[]
  friend_requests_received?: Friend[]
}

export type WsSystem = {
  type: 'system'
  content?: string
  timestamp?: string
}

export type WsAnnouncementUpdate = {
  type: 'announcement_update'
  enabled: boolean
  message: string
  duration_minutes: number
  set_at: string | null
  max_message_length?: number
}

export type Attachment = {
  attachment_id: string
  filename: string
  content_type: string
  file_size: number
}

export type WsChatMessage = {
  type: 'message'
  id?: number
  username: string
  content: string
  timestamp: string
  context?: 'global' | 'server' | 'dm' | string
  context_id?: string | null
  messageKey?: string
  reactions?: unknown[]
  attachments?: Attachment[]
} & Avatar

export type WsHistory = {
  type: 'history'
  messages: WsChatMessage[]
}

export type WsChannelHistory = {
  type: 'channel_history'
  server_id: string
  channel_id: string
  messages: WsChatMessage[]
}

export type WsDmHistory = {
  type: 'dm_history'
  dm_id: string
  messages: WsChatMessage[]
}

export type WsError = {
  type: 'error'
  message: string
}

export type WsServerCreated = {
  type: 'server_created'
  server: Server
}

export type WsServerJoined = {
  type: 'server_joined'
  server: Pick<Server, 'id' | 'name' | 'owner' | 'channels' | 'icon' | 'icon_type' | 'icon_data'>
}

export type WsInviteCode = {
  type: 'invite_code'
  code: string
  message?: string
}

export type WsServerInviteCode = {
  type: 'server_invite_code'
  server_id: string
  code: string
  message?: string
}

export type ServerInviteUsageLog = {
  invite_code: string
  use_count: number
  first_used?: string | null
  last_used?: string | null
  users?: string[]
}

export type WsServerInviteUsage = {
  type: 'server_invite_usage'
  server_id: string
  usage_logs: ServerInviteUsageLog[]
}

export type WsChannelCreated = {
  type: 'channel_created'
  server_id: string
  channel: ServerChannel
}

export type WsDmStarted = {
  type: 'dm_started'
  dm: Dm & Profile
}

export type ServerMember = {
  username: string
  is_owner: boolean
  permissions?: ServerPermissions
} & Avatar & Profile

export type WsServerMembers = {
  type: 'server_members'
  server_id: string
  members: ServerMember[]
}

export type Ws2FASetup = {
  type: '2fa_setup'
  secret: string
  qr_code: string
  backup_codes: string[]
  warning?: string
}

export type Ws2FAEnabled = {
  type: '2fa_enabled'
  message?: string
}

export type Ws2FADisabled = {
  type: '2fa_disabled'
  message?: string
}

export type WsProfileUpdated = {
  type: 'profile_updated'
  bio?: string
  status_message?: string
}

export type WsAvatarUpdated = {
  type: 'avatar_updated'
} & Avatar

export type WsNotificationModeUpdated = {
  type: 'notification_mode_updated'
  notification_mode: string
}

export type WsPasswordResetRequested = {
  type: 'password_reset_requested'
  message?: string
}

export type WsMessage =
  | WsAuthSuccess
  | WsAuthError
  | WsTwoFaRequired
  | WsVerificationRequired
  | WsInit
  | WsDataSynced
  | WsSystem
  | WsAnnouncementUpdate
  | WsChatMessage
  | WsHistory
  | WsChannelHistory
  | WsDmHistory
  | WsError
  | WsServerCreated
  | WsServerJoined
  | WsChannelCreated
  | WsDmStarted
  | WsServerMembers
  | WsInviteCode
  | WsServerInviteCode
  | WsServerInviteUsage
  | Ws2FASetup
  | Ws2FAEnabled
  | Ws2FADisabled
  | WsProfileUpdated
  | WsAvatarUpdated
  | WsNotificationModeUpdated
  | WsPasswordResetRequested
  | WsServerIconUpdate
  | WsCustomEmojiAdded
  | WsCustomEmojiDeleted
  | WsServerEmojis
  | { type: string; [k: string]: any }

export type WsOutboundLogin = {
  type: 'login'
  username: string
  password: string
  totp_code?: string
}

export type WsOutboundSignup = {
  type: 'signup'
  username: string
  password: string
  email: string
  invite_code?: string
}

export type WsOutboundVerifyEmail = {
  type: 'verify_email'
  username: string
  code: string
}

export type WsVerificationRequired = {
  type: 'verification_required'
  message?: string
}

export type WsOutboundTokenAuth = {
  type: 'token'
  token: string
}

export type WsOutboundSyncData = {
  type: 'sync_data'
}

export type WsOutboundGetChannelHistory = {
  type: 'get_channel_history'
  server_id: string
  channel_id: string
}

export type WsOutboundGetDmHistory = {
  type: 'get_dm_history'
  dm_id: string
}

export type WsOutboundSendMessage = {
  type: 'message'
  content: string
  context?: 'global' | 'server' | 'dm'
  context_id?: string | null
}

export type WsOutboundCreateServer = {
  type: 'create_server'
  name: string
}

export type WsOutboundCreateChannel = {
  type: 'create_channel'
  server_id: string
  name: string
  channel_type?: 'text' | 'voice'
}

export type WsOutboundCreateVoiceChannel = {
  type: 'create_voice_channel'
  server_id: string
  name: string
}

export type WsOutboundStartDm = {
  type: 'start_dm'
  username: string
}

export type WsOutboundGenerateInvite = {
  type: 'generate_invite'
}

export type WsOutboundGenerateServerInvite = {
  type: 'generate_server_invite'
  server_id: string
}

export type WsOutboundJoinServerWithInvite = {
  type: 'join_server_with_invite'
  invite_code: string
}

export type WsOutboundGetServerInviteUsage = {
  type: 'get_server_invite_usage'
  server_id: string
}

export type WsOutboundGetServerMembers = {
  type: 'get_server_members'
  server_id: string
}

export type WsOutboundUpdateProfile = {
  type: 'update_profile'
  bio?: string
  status_message?: string
}

export type WsOutboundSetAvatar = {
  type: 'set_avatar'
  avatar_type: 'emoji' | 'image'
  avatar?: string
  avatar_data?: string
}

export type WsOutboundSetup2FA = {
  type: 'setup_2fa'
}

export type WsOutboundVerify2FASetup = {
  type: 'verify_2fa_setup'
  code: string
}

export type WsOutboundDisable2FA = {
  type: 'disable_2fa'
  password: string
  code: string
}

export type WsOutboundSetNotificationMode = {
  type: 'set_notification_mode'
  notification_mode: 'all' | 'mentions' | 'none'
}

export type WsOutboundRequestPasswordReset = {
  type: 'request_password_reset'
  identifier: string
}

export type CustomEmoji = {
  emoji_id: string
  server_id: string
  name: string
  image_data: string
  uploader: string
  created_at: string
}

export type WsServerIconUpdate = {
  type: 'server_icon_update'
  server_id: string
  icon?: string
  icon_type: 'emoji' | 'image'
  icon_data?: string | null
}

export type WsCustomEmojiAdded = {
  type: 'custom_emoji_added'
  server_id: string
  emoji: CustomEmoji
}

export type WsCustomEmojiDeleted = {
  type: 'custom_emoji_deleted'
  server_id: string
  emoji_id: string
}

export type WsServerEmojis = {
  type: 'server_emojis'
  server_id: string
  emojis: CustomEmoji[]
}
