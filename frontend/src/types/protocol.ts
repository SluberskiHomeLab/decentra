export type WsAuthSuccess = {
  type: 'auth_success'
  message?: string
  token: string
  theme_mode?: 'dark' | 'light' | 'high_contrast'
  keybinds?: Record<string, string>
}

export type Avatar = {
  avatar?: string
  avatar_type?: 'emoji' | 'image' | string
  avatar_data?: string | null
}

export type Profile = {
  bio?: string
  status_message?: string
  user_status?: 'online' | 'away' | 'busy' | 'offline'
}

export type ServerChannel = {
  id: string
  name: string
  type?: 'text' | 'voice' | string
  category_id?: string | null
  position?: number
}

export type ServerCategory = {
  id: string
  name: string
  position: number
}

export type ServerPermissions = {
  can_create_channel?: boolean
  can_edit_channel?: boolean
  can_delete_channel?: boolean
  can_edit_messages?: boolean
  can_delete_messages?: boolean
}

// --- Role system types ---

export type RolePermissions = {
  administrator?: boolean
  manage_server?: boolean
  manage_channels?: boolean
  manage_categories?: boolean
  manage_roles?: boolean
  create_invite?: boolean
  ban_members?: boolean
  delete_messages?: boolean
  edit_messages?: boolean
  send_files?: boolean
  access_settings?: boolean
  manage_emojis?: boolean
  send_messages?: boolean
  read_messages?: boolean
  view_channel?: boolean
  [key: string]: boolean | undefined
}

export type Role = {
  id: string
  role_id?: string
  server_id: string
  name: string
  color: string
  position: number
  permissions: RolePermissions
  hoist: boolean
  created_at?: string
}

export type ChannelPermissionOverride = {
  channel_id: string
  role_id: string
  role_name: string
  role_color: string
  permissions: RolePermissions
}

export type CategoryPermissionOverride = {
  category_id: string
  role_id: string
  role_name: string
  role_color: string
  permissions: RolePermissions
}

export type WsRoleCreated = {
  type: 'role_created'
  server_id: string
  role: Role
}

export type WsRoleUpdated = {
  type: 'role_updated'
  server_id: string
  role: Role
}

export type WsRoleDeleted = {
  type: 'role_deleted'
  server_id: string
  role_id: string
}

export type WsRolesReordered = {
  type: 'roles_reordered'
  server_id: string
  roles: Role[]
}

export type WsChannelPermissionsUpdated = {
  type: 'channel_permissions_updated'
  server_id: string
  channel_id: string
  overrides: ChannelPermissionOverride[]
}

export type WsCategoryPermissionsUpdated = {
  type: 'category_permissions_updated'
  server_id: string
  category_id: string
  overrides: CategoryPermissionOverride[]
}

export type UnreadChannelInfo = {
  unread_count: number
  has_mention: boolean
}

export type Server = {
  id: string
  name: string
  owner: string
  icon?: string
  icon_type?: 'emoji' | 'image' | string
  icon_data?: string | null
  channels: ServerChannel[]
  categories?: ServerCategory[]
  permissions?: ServerPermissions
  unread_count?: number
  has_mention?: boolean
  channel_unreads?: Record<string, UnreadChannelInfo>
}

export type Dm = {
  id: string
  username: string
  user_status?: 'online' | 'away' | 'busy' | 'offline'
  unread_count?: number
  has_mention?: boolean
} & Avatar

export type Friend = {
  username: string
  user_status?: 'online' | 'away' | 'busy' | 'offline'
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
  email?: string
  email_verified?: boolean
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

export type Reaction = {
  username: string
  emoji: string
  emoji_type: 'standard' | 'custom'
  created_at: string
}

export type WsChatMessage = {
  type: 'message'
  id?: number
  username: string
  content: string
  timestamp: string
  edited_at?: string | null
  context?: 'global' | 'server' | 'dm' | 'thread' | string
  context_id?: string | null
  messageKey?: string
  nonce?: string
  reactions?: Reaction[]
  attachments?: Attachment[]
  mentions?: string[]
  role_mentions?: string[]
  user_status?: 'online' | 'away' | 'busy' | 'offline'
  role_color?: string
  pinned?: boolean
  pinned_by?: string | null
  pinned_at?: string | null
  thread_id?: string
  reply_data?: {
    id: number
    username: string
    content: string
    deleted: boolean
  }
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
  max_uses?: number | null
  description?: string
  message?: string
}

export type WsServerInviteCode = {
  type: 'server_invite_code'
  server_id: string
  code: string
  max_uses?: number | null
  description?: string
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

export type InviteListItem = {
  code: string
  creator: string
  created_at: string
  max_uses?: number | null
  is_active: boolean
  description?: string
  current_uses: number
}

export type WsInstanceInvitesList = {
  type: 'instance_invites_list'
  invites: InviteListItem[]
}

export type WsServerInvitesList = {
  type: 'server_invites_list'
  server_id: string
  invites: InviteListItem[]
}

export type WsInstanceInviteUsage = {
  type: 'instance_invite_usage'
  usage_logs: ServerInviteUsageLog[]
}

export type WsInviteRevoked = {
  type: 'invite_revoked'
  code: string
  message?: string
}

export type WsServerInviteRevoked = {
  type: 'server_invite_revoked'
  server_id: string
  code: string
  message?: string
}

export type WsServerInfoPreview = {
  type: 'server_info_preview'
  server: {
    id: string
    name: string
    icon?: string
    icon_type?: string
    icon_data?: string
    description?: string
    member_count: number
  }
  invite_code: string
}

export type WsChannelCreated = {
  type: 'channel_created'
  server_id: string
  channel: ServerChannel
}

export type WsChannelCategoryUpdated = {
  type: 'channel_category_updated'
  server_id: string
  channel_id: string
  category_id: string | null
}

export type WsChannelDeleted = {
  type: 'channel_deleted'
  server_id: string
  channel_id: string
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

export type WsEmailChanged = {
  type: 'email_changed'
  email: string
  email_verified: boolean
}

export type WsEmailVerified = {
  type: 'email_verified'
  email: string
  email_verified: boolean
}

export type WsUsernameChanged = {
  type: 'username_changed'
  old_username: string
  new_username: string
  token: string
}

export type WsUserRenamed = {
  type: 'user_renamed'
  old_username: string
  new_username: string
}

export type WsPasswordResetRequested = {
  type: 'password_reset_requested'
  message?: string
}

export type WsMessageEdited = {
  type: 'message_edited'
  message_id: number
  content: string
  edited_at: string
  context_type: string
  context_id: string | null
}

export type WsMessageDeleted = {
  type: 'message_deleted'
  message_id: number
  context_type: string
  context_id: string | null
}

export type WsReactionAdded = {
  type: 'reaction_added'
  message_id: number
  reactions: Reaction[]
}

export type WsReactionRemoved = {
  type: 'reaction_removed'
  message_id: number
  reactions: Reaction[]
}

export type WsUserStatusChanged = {
  type: 'user_status_changed'
  username: string
  user_status: 'online' | 'away' | 'busy' | 'offline'
}

export type WsMentionNotification = {
  type: 'mention_notification'
  message_id: number
  mentioned_by: string
  content: string
  context_type: 'global' | 'server' | 'dm'
  context_id?: string | null
}

// ── Typing indicators ────────────────────────────────────

export type WsUserTyping = {
  type: 'user_typing'
  username: string
  context: string
  context_id: string | null
  avatar?: string
  avatar_type?: string
  avatar_data?: string | null
}

export type WsUserStoppedTyping = {
  type: 'user_stopped_typing'
  username: string
  context: string
  context_id: string | null
}

// ── Threads ───────────────────────────────────────────────

export type Thread = {
  thread_id: string
  server_id: string
  channel_id?: string | null
  parent_message_id?: number | null
  name: string
  is_private: boolean
  created_by: string
  is_closed: boolean
  created_at?: string
}

export type WsThreadCreated = {
  type: 'thread_created'
  thread: Thread
}

export type WsThreadClosed = {
  type: 'thread_closed'
  thread_id: string
  server_id: string
}

export type WsThreadHistory = {
  type: 'thread_history'
  thread_id: string
  thread: Thread
  messages: WsChatMessage[]
}

export type WsThreadsList = {
  type: 'threads_list'
  server_id: string
  threads: Thread[]
}

export type WsOutboundCreateThread = {
  type: 'create_thread'
  server_id: string
  parent_message_id?: number | null
  name: string
  is_private?: boolean
  invited_users?: string[]
}

export type WsOutboundCloseThread = {
  type: 'close_thread'
  thread_id: string
}

export type WsOutboundGetThreadHistory = {
  type: 'get_thread_history'
  thread_id: string
}

export type WsOutboundListThreads = {
  type: 'list_threads'
  server_id: string
}

export type WsOutboundSendThreadMessage = {
  type: 'thread_message'
  thread_id: string
  content: string
  nonce?: string
}

// ── Pinned messages ───────────────────────────────────────

export type WsMessagePinned = {
  type: 'message_pinned'
  message_id: number
  pinned_by: string
  context_type: string
  context_id: string | null
}

export type WsMessageUnpinned = {
  type: 'message_unpinned'
  message_id: number
  context_type: string
  context_id: string | null
}

export type WsPinnedMessages = {
  type: 'pinned_messages'
  context_type: string
  context_id: string | null
  messages: WsChatMessage[]
}

export type WsOutboundPinMessage = {
  type: 'pin_message'
  message_id: number
}

export type WsOutboundUnpinMessage = {
  type: 'unpin_message'
  message_id: number
}

export type WsOutboundGetPinnedMessages = {
  type: 'get_pinned_messages'
  context_type: string
  context_id: string | null
}

export type WsOutboundTypingStart = {
  type: 'typing_start'
  context: string
  context_id: string | null
}

export type WsOutboundTypingStop = {
  type: 'typing_stop'
  context: string
  context_id: string | null
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
  | WsChannelCategoryUpdated
  | WsChannelDeleted
  | WsDmStarted
  | WsServerMembers
  | WsInviteCode
  | WsServerInviteCode
  | WsServerInviteUsage
  | WsInstanceInvitesList
  | WsServerInvitesList
  | WsInstanceInviteUsage
  | WsInviteRevoked
  | WsServerInviteRevoked
  | WsServerInfoPreview
  | Ws2FASetup
  | Ws2FAEnabled
  | Ws2FADisabled
  | WsProfileUpdated
  | WsAvatarUpdated
  | WsNotificationModeUpdated
  | WsEmailChanged
  | WsEmailVerified
  | WsUsernameChanged
  | WsUserRenamed
  | WsPasswordResetRequested
  | WsServerIconUpdate
  | WsCustomEmojiAdded
  | WsCustomEmojiDeleted
  | WsServerEmojis
  | WsMessageEdited
  | WsMessageDeleted
  | WsReactionAdded
  | WsReactionRemoved
  | WsInboundLicenseInfo
  | WsInboundLicenseUpdated
  | WsVoiceChannelJoined
  | WsDirectCallStarted
  | WsUserJoinedVoice
  | WsUserLeftVoice
  | WsVoiceStateUpdate
  | WsWebRTCOffer
  | WsWebRTCAnswer
  | WsWebRTCIceCandidate
  | WsUserStatusChanged
  | WsMentionNotification
  | WsUserTyping
  | WsUserStoppedTyping
  | WsThreadCreated
  | WsThreadClosed
  | WsThreadHistory
  | WsThreadsList
  | WsMessagePinned
  | WsMessageUnpinned
  | WsPinnedMessages
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
  mentions?: string[]
  role_mentions?: string[]
  messageKey?: string
  reply_to?: number
  nonce?: string
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
  category_id?: string
  position?: number
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
  max_uses?: number | null
  description?: string
}

export type WsOutboundGenerateServerInvite = {
  type: 'generate_server_invite'
  server_id: string
  max_uses?: number | null
  description?: string
}

export type WsOutboundJoinServerWithInvite = {
  type: 'join_server_with_invite'
  invite_code: string
}

export type WsOutboundGetServerInviteUsage = {
  type: 'get_server_invite_usage'
  server_id: string
}

export type WsOutboundListInstanceInvites = {
  type: 'list_instance_invites'
}

export type WsOutboundListServerInvites = {
  type: 'list_server_invites'
  server_id: string
}

export type WsOutboundGetInstanceInviteUsage = {
  type: 'get_instance_invite_usage'
}

export type WsOutboundRevokeInvite = {
  type: 'revoke_instance_invite'
  code: string
}

export type WsOutboundRevokeServerInvite = {
  type: 'revoke_server_invite'
  server_id: string
  code: string
}

export type WsOutboundGetServerInfoByInvite = {
  type: 'get_server_info_by_invite'
  invite_code: string
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

export type WsOutboundChangeEmail = {
  type: 'change_email'
  new_email: string
  password: string
}

export type WsOutboundChangeUsername = {
  type: 'change_username'
  new_username: string
  password: string
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

export type WsOutboundEditMessage = {
  type: 'edit_message'
  message_id: number
  content: string
}

export type WsOutboundDeleteMessage = {
  type: 'delete_message'
  message_id: number
}

export type WsOutboundAddReaction = {
  type: 'add_reaction'
  message_id: number
  emoji: string
  emoji_type: 'standard' | 'custom'
}

export type WsOutboundRemoveReaction = {
  type: 'remove_reaction'
  message_id: number
  emoji: string
}

export type WsOutboundJoinVoiceChannel = {
  type: 'join_voice_channel'
  server_id: string
  channel_id: string
}

export type WsOutboundLeaveVoiceChannel = {
  type: 'leave_voice_channel'
}

export type WsOutboundStartDirectCall = {
  type: 'start_direct_call'
  target_username: string
}

export type WsOutboundLeaveDirectCall = {
  type: 'leave_direct_call'
}

export type WsOutboundVoiceStateUpdate = {
  type: 'voice_state_update'
  muted: boolean
  video: boolean
  screen_sharing: boolean
}

export type WsOutboundWebRTCOffer = {
  type: 'webrtc_offer'
  target_username: string
  offer: RTCSessionDescriptionInit
}

export type WsOutboundWebRTCAnswer = {
  type: 'webrtc_answer'
  target_username: string
  answer: RTCSessionDescriptionInit
}

export type WsOutboundWebRTCIceCandidate = {
  type: 'webrtc_ice_candidate'
  target_username: string
  candidate: RTCIceCandidateInit
}

export type WsVoiceChannelJoined = {
  type: 'voice_channel_joined'
  server_id: string
  channel_id: string
  participants: string[]
}

export type WsDirectCallStarted = {
  type: 'direct_call_started'
  caller: string
}

export type WsUserJoinedVoice = {
  type: 'user_joined_voice'
  username: string
  server_id?: string
  channel_id?: string
}

export type WsUserLeftVoice = {
  type: 'user_left_voice'
  username: string
  server_id?: string
  channel_id?: string
}

export type WsVoiceStateUpdate = {
  type: 'voice_state_update'
  server_id?: string
  channel_id?: string
  username: string
  state?: string
  muted?: boolean
  video?: boolean
  screen_sharing?: boolean
  voice_members?: Array<{
    username: string
    avatar?: string
    avatar_type?: string
    muted: boolean
    video: boolean
    screen_sharing: boolean
  }>
}

export type WsWebRTCOffer = {
  type: 'webrtc_offer'
  from_username: string
  offer: RTCSessionDescriptionInit
}

export type WsWebRTCAnswer = {
  type: 'webrtc_answer'
  from_username: string
  answer: RTCSessionDescriptionInit
}

export type WsWebRTCIceCandidate = {
  type: 'webrtc_ice_candidate'
  from_username: string
  candidate: RTCIceCandidateInit
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

// ── License System ──────────────────────────────────────

export interface LicenseFeatures {
  voice_chat: boolean
  file_uploads: boolean
  webhooks: boolean
  custom_emojis: boolean
  audit_logs: boolean
  sso: boolean
}

export interface LicenseLimits {
  max_users: number
  max_servers: number
  max_channels_per_server: number
  max_file_size_mb: number
  max_messages_history: number
}

export interface LicenseInfo {
  tier: string
  features: LicenseFeatures
  limits: LicenseLimits
  customer?: {
    name: string
    email: string
    company: string
  }
  expires_at?: string
  is_admin: boolean
  last_check_at?: string
  is_in_grace_period?: boolean
  grace_days_remaining?: number
}

export interface WsOutboundGetLicenseInfo {
  type: 'get_license_info'
}

export interface WsOutboundUpdateLicense {
  type: 'update_license'
  license_key: string
}

export interface WsOutboundRemoveLicense {
  type: 'remove_license'
}

// ── Read Status System ──────────────────────────────────────

export type WsMarkAsRead = {
  type: 'mark_as_read'
  context_type: 'server' | 'dm' | 'global'
  context_id: string
}

export type WsUnreadCounts = {
  type: 'unread_counts'
  dm_counts: Record<string, { unread_count: number; has_mention: boolean }>
  server_counts: Record<string, { 
    unread_count: number
    has_mention: boolean
    channels: Record<string, { unread_count: number; has_mention: boolean }>
  }>
}

export type WsUnreadUpdate = {
  type: 'unread_update'
  context_type: 'server' | 'dm'
  context_id: string
  dm_id?: string
  server_id?: string
  channel_id?: string
  unread_count: number
  has_mention: boolean
}

export interface WsInboundLicenseInfo {
  type: 'license_info'
  data: LicenseInfo
}

export interface WsInboundLicenseUpdated {
  type: 'license_updated'
  data: LicenseInfo
}

// ── User Preferences System ──────────────────────────────────────

export type WsOutboundUpdateUserPreferences = {
  type: 'update_user_preferences'
  theme_mode?: 'dark' | 'light' | 'high_contrast'
  keybinds?: Record<string, string>
}

export type WsInboundUserPreferencesUpdated = {
  type: 'user_preferences_updated'
  theme_mode: 'dark' | 'light' | 'high_contrast'
  keybinds: Record<string, string>
}
