package com.decentra.chat.network

import com.google.gson.GsonBuilder
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {
    private var baseUrl: String = "http://10.0.2.2:8765/"
    private var retrofit: Retrofit? = null
    
    fun setBaseUrl(url: String) {
        var normalizedUrl = url.trim()
        if (!normalizedUrl.endsWith("/")) {
            normalizedUrl += "/"
        }
        if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
            normalizedUrl = "http://$normalizedUrl"
        }
        baseUrl = normalizedUrl
        retrofit = null // Force recreation with new URL
    }
    
    fun getBaseUrl(): String = baseUrl
    
    private fun getRetrofit(): Retrofit {
        if (retrofit == null) {
            val logging = HttpLoggingInterceptor()
            logging.level = HttpLoggingInterceptor.Level.BODY
            
            val client = OkHttpClient.Builder()
                .addInterceptor(logging)
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build()
            
            val gson = GsonBuilder()
                .setLenient()
                .create()
            
            retrofit = Retrofit.Builder()
                .baseUrl(baseUrl)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create(gson))
                .build()
        }
        return retrofit!!
    }
    
    val apiService: DecentraApiService by lazy {
        getRetrofit().create(DecentraApiService::class.java)
    }
}
