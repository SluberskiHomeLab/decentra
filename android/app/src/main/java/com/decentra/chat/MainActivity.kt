package com.decentra.chat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.decentra.chat.ui.ChatScreen
import com.decentra.chat.ui.LoginScreen
import com.decentra.chat.ui.theme.DecentraTheme
import com.decentra.chat.viewmodel.ChatViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            DecentraTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    DecentraApp()
                }
            }
        }
    }
}

@Composable
fun DecentraApp(viewModel: ChatViewModel = viewModel()) {
    val user by viewModel.user.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val error by viewModel.error.collectAsState()
    
    if (user == null) {
        LoginScreen(
            onLogin = { username, password, serverUrl ->
                viewModel.login(username, password, serverUrl)
            },
            isLoading = isLoading,
            error = error,
            onErrorDismiss = { viewModel.clearError() }
        )
    } else {
        ChatScreen(
            viewModel = viewModel,
            onLogout = { viewModel.logout() }
        )
    }
}
