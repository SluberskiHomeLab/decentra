package com.decentra.chat.network

import android.util.Log
import com.decentra.chat.data.Message
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.*
import java.util.concurrent.TimeUnit

class WebSocketManager {
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()
    
    private val gson = Gson()
    
    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState
    
    private val _incomingMessages = MutableStateFlow<Message?>(null)
    val incomingMessages: StateFlow<Message?> = _incomingMessages
    
    private var username: String? = null
    
    enum class ConnectionState {
        DISCONNECTED, CONNECTING, CONNECTED
    }
    
    suspend fun connect(serverUrl: String, user: String, password: String) = withContext(Dispatchers.IO) {
        try {
            _connectionState.value = ConnectionState.CONNECTING
            username = user
            
            // Extract base URL and create WebSocket URL
            var wsUrl = serverUrl.trim()
            if (wsUrl.endsWith("/")) {
                wsUrl = wsUrl.substring(0, wsUrl.length - 1)
            }
            wsUrl = wsUrl.replace("http://", "ws://").replace("https://", "wss://")
            wsUrl += "/ws"
            
            Log.d("WebSocketManager", "Connecting to: $wsUrl")
            
            val request = Request.Builder()
                .url(wsUrl)
                .build()
            
            webSocket = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    Log.d("WebSocketManager", "WebSocket connected")
                    _connectionState.value = ConnectionState.CONNECTED
                    
                    // Send authentication
                    val authMessage = JsonObject().apply {
                        addProperty("type", "auth")
                        addProperty("username", user)
                        addProperty("password", password)
                    }
                    webSocket.send(gson.toJson(authMessage))
                }
                
                override fun onMessage(webSocket: WebSocket, text: String) {
                    Log.d("WebSocketManager", "Received: $text")
                    try {
                        val json = gson.fromJson(text, JsonObject::class.java)
                        val type = json.get("type")?.asString
                        
                        when (type) {
                            "auth_result" -> {
                                val success = json.get("success")?.asBoolean ?: false
                                if (success) {
                                    Log.d("WebSocketManager", "Authentication successful")
                                } else {
                                    Log.e("WebSocketManager", "Authentication failed")
                                    _connectionState.value = ConnectionState.DISCONNECTED
                                }
                            }
                            "message" -> {
                                // Parse incoming message
                                val message = Message(
                                    id = json.get("id")?.asInt ?: 0,
                                    username = json.get("username")?.asString ?: "",
                                    content = json.get("content")?.asString ?: "",
                                    timestamp = json.get("timestamp")?.asString ?: "",
                                    contextType = json.get("context_type")?.asString ?: "",
                                    contextId = json.get("context_id")?.asString ?: ""
                                )
                                _incomingMessages.value = message
                            }
                        }
                    } catch (e: Exception) {
                        Log.e("WebSocketManager", "Error parsing message", e)
                    }
                }
                
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.e("WebSocketManager", "WebSocket error", t)
                    _connectionState.value = ConnectionState.DISCONNECTED
                }
                
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    Log.d("WebSocketManager", "WebSocket closed: $reason")
                    _connectionState.value = ConnectionState.DISCONNECTED
                }
            })
        } catch (e: Exception) {
            Log.e("WebSocketManager", "Connection error", e)
            _connectionState.value = ConnectionState.DISCONNECTED
        }
    }
    
    fun sendMessage(content: String, contextType: String, contextId: String) {
        val message = JsonObject().apply {
            addProperty("type", "message")
            addProperty("content", content)
            addProperty("context_type", contextType)
            addProperty("context_id", contextId)
        }
        webSocket?.send(gson.toJson(message))
        Log.d("WebSocketManager", "Sent message: $content")
    }
    
    fun disconnect() {
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        _connectionState.value = ConnectionState.DISCONNECTED
        username = null
    }
    
    fun isConnected(): Boolean {
        return _connectionState.value == ConnectionState.CONNECTED
    }
}
