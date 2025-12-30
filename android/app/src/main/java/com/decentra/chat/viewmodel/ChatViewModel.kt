package com.decentra.chat.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.decentra.chat.data.*
import com.decentra.chat.network.RetrofitClient
import com.decentra.chat.network.WebSocketManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class ChatViewModel : ViewModel() {
    private val webSocketManager = WebSocketManager()
    
    private val _user = MutableStateFlow<User?>(null)
    val user: StateFlow<User?> = _user
    
    private val _servers = MutableStateFlow<List<Server>>(emptyList())
    val servers: StateFlow<List<Server>> = _servers
    
    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages
    
    private val _friends = MutableStateFlow<List<String>>(emptyList())
    val friends: StateFlow<List<String>> = _friends
    
    private val _dms = MutableStateFlow<List<DirectMessage>>(emptyList())
    val dms: StateFlow<List<DirectMessage>> = _dms
    
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading
    
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    
    private val _currentContext = MutableStateFlow<ChatContext?>(null)
    val currentContext: StateFlow<ChatContext?> = _currentContext
    
    val connectionState = webSocketManager.connectionState
    val incomingMessages = webSocketManager.incomingMessages
    
    data class ChatContext(
        val type: String, // "server" or "dm"
        val id: String,
        val name: String
    )
    
    fun setServerUrl(url: String) {
        RetrofitClient.setBaseUrl(url)
    }
    
    fun login(username: String, password: String, serverUrl: String) {
        viewModelScope.launch {
            try {
                _isLoading.value = true
                _error.value = null
                
                // Set server URL
                setServerUrl(serverUrl)
                
                // Authenticate via REST API
                val response = RetrofitClient.apiService.authenticate(
                    AuthRequest(username, password)
                )
                
                if (response.isSuccessful && response.body()?.success == true) {
                    _user.value = response.body()?.user
                    
                    // Connect WebSocket
                    webSocketManager.connect(serverUrl, username, password)
                    
                    // Load initial data
                    loadServers()
                    loadFriends()
                    loadDMs()
                } else {
                    _error.value = response.body()?.error ?: "Login failed"
                }
            } catch (e: Exception) {
                Log.e("ChatViewModel", "Login error", e)
                _error.value = "Connection error: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }
    
    fun loadServers() {
        viewModelScope.launch {
            try {
                val username = _user.value?.username ?: return@launch
                val response = RetrofitClient.apiService.getServers(username)
                
                if (response.isSuccessful && response.body()?.success == true) {
                    _servers.value = response.body()?.servers ?: emptyList()
                }
            } catch (e: Exception) {
                Log.e("ChatViewModel", "Error loading servers", e)
            }
        }
    }
    
    fun loadFriends() {
        viewModelScope.launch {
            try {
                val username = _user.value?.username ?: return@launch
                val response = RetrofitClient.apiService.getFriends(username)
                
                if (response.isSuccessful && response.body()?.success == true) {
                    _friends.value = response.body()?.friends ?: emptyList()
                }
            } catch (e: Exception) {
                Log.e("ChatViewModel", "Error loading friends", e)
            }
        }
    }
    
    fun loadDMs() {
        viewModelScope.launch {
            try {
                val username = _user.value?.username ?: return@launch
                val response = RetrofitClient.apiService.getDMs(username)
                
                if (response.isSuccessful && response.body()?.success == true) {
                    _dms.value = response.body()?.dms ?: emptyList()
                }
            } catch (e: Exception) {
                Log.e("ChatViewModel", "Error loading DMs", e)
            }
        }
    }
    
    fun selectChannel(serverId: String, channelId: String, channelName: String) {
        _currentContext.value = ChatContext(
            type = "server",
            id = "$serverId/$channelId",
            name = channelName
        )
        loadMessages("server", "$serverId/$channelId")
    }
    
    fun selectDM(dmId: String, otherUser: String) {
        _currentContext.value = ChatContext(
            type = "dm",
            id = dmId,
            name = otherUser
        )
        loadMessages("dm", dmId)
    }
    
    private fun loadMessages(contextType: String, contextId: String) {
        viewModelScope.launch {
            try {
                val response = RetrofitClient.apiService.getMessages(contextType, contextId, 100)
                
                if (response.isSuccessful && response.body()?.success == true) {
                    _messages.value = response.body()?.messages ?: emptyList()
                }
            } catch (e: Exception) {
                Log.e("ChatViewModel", "Error loading messages", e)
            }
        }
    }
    
    fun sendMessage(content: String) {
        val context = _currentContext.value ?: return
        webSocketManager.sendMessage(content, context.type, context.id)
    }
    
    fun clearError() {
        _error.value = null
    }
    
    fun logout() {
        webSocketManager.disconnect()
        _user.value = null
        _servers.value = emptyList()
        _messages.value = emptyList()
        _friends.value = emptyList()
        _dms.value = emptyList()
        _currentContext.value = null
    }
    
    override fun onCleared() {
        super.onCleared()
        webSocketManager.disconnect()
    }
}
