package com.decentra.chat.network

import com.decentra.chat.data.*
import retrofit2.Response
import retrofit2.http.*

interface DecentraApiService {
    @POST("api/auth")
    suspend fun authenticate(@Body request: AuthRequest): Response<AuthResponse>
    
    @GET("api/servers")
    suspend fun getServers(@Query("username") username: String): Response<ServersResponse>
    
    @GET("api/messages")
    suspend fun getMessages(
        @Query("context_type") contextType: String,
        @Query("context_id") contextId: String,
        @Query("limit") limit: Int = 100
    ): Response<MessagesResponse>
    
    @GET("api/friends")
    suspend fun getFriends(@Query("username") username: String): Response<FriendsResponse>
    
    @GET("api/dms")
    suspend fun getDMs(@Query("username") username: String): Response<DMsResponse>
}
