package com.decentra.chat.data

data class User(
    val username: String,
    val avatar: String = "👤",
    val avatarType: String = "emoji",
    val avatarData: String? = null
)

data class Server(
    val id: String,
    val name: String,
    val owner: String,
    val channels: List<Channel>
)

data class Channel(
    val id: String,
    val name: String,
    val type: String = "text" // "text" or "voice"
)

data class Message(
    val id: Int,
    val username: String,
    val content: String,
    val timestamp: String,
    val contextType: String,
    val contextId: String
)

data class DirectMessage(
    val dmId: String,
    val otherUser: String
)

data class AuthRequest(
    val username: String,
    val password: String
)

data class AuthResponse(
    val success: Boolean,
    val user: User? = null,
    val error: String? = null
)

data class ServersResponse(
    val success: Boolean,
    val servers: List<Server> = emptyList(),
    val error: String? = null
)

data class MessagesResponse(
    val success: Boolean,
    val messages: List<Message> = emptyList(),
    val error: String? = null
)

data class FriendsResponse(
    val success: Boolean,
    val friends: List<String> = emptyList(),
    val friendRequestsSent: List<String> = emptyList(),
    val friendRequestsReceived: List<String> = emptyList(),
    val error: String? = null
)

data class DMsResponse(
    val success: Boolean,
    val dms: List<DirectMessage> = emptyList(),
    val error: String? = null
)
