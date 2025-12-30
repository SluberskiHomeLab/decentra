package com.decentra.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.decentra.chat.data.DirectMessage
import com.decentra.chat.data.Message
import com.decentra.chat.data.Server
import com.decentra.chat.viewmodel.ChatViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: ChatViewModel,
    onLogout: () -> Unit
) {
    val servers by viewModel.servers.collectAsState()
    val dms by viewModel.dms.collectAsState()
    val messages by viewModel.messages.collectAsState()
    val currentContext by viewModel.currentContext.collectAsState()
    val user by viewModel.user.collectAsState()
    val incomingMessage by viewModel.incomingMessages.collectAsState()
    
    var selectedServer by remember { mutableStateOf<Server?>(null) }
    var showMenu by remember { mutableStateOf(false) }
    var messageText by remember { mutableStateOf("") }
    
    // Update messages when new message arrives via WebSocket
    LaunchedEffect(incomingMessage) {
        if (incomingMessage != null && currentContext != null) {
            val msg = incomingMessage!!
            if (msg.contextType == currentContext!!.type && msg.contextId == currentContext!!.id) {
                // Message is for current context, reload messages
                when (currentContext!!.type) {
                    "server" -> {
                        val parts = currentContext!!.id.split("/")
                        if (parts.size == 2) {
                            viewModel.selectChannel(parts[0], parts[1], currentContext!!.name)
                        }
                    }
                    "dm" -> {
                        viewModel.selectDM(currentContext!!.id, currentContext!!.name)
                    }
                }
            }
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Text(currentContext?.name ?: "Decentra Chat") 
                },
                actions = {
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, "Menu")
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Logout") },
                            onClick = {
                                showMenu = false
                                onLogout()
                            }
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Left sidebar - Servers and DMs
            Surface(
                modifier = Modifier
                    .width(200.dp)
                    .fillMaxHeight(),
                color = MaterialTheme.colorScheme.surfaceVariant
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize()
                ) {
                    item {
                        Text(
                            text = "Servers",
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.padding(16.dp, 16.dp, 16.dp, 8.dp)
                        )
                    }
                    
                    items(servers) { server ->
                        ServerItem(
                            server = server,
                            isSelected = selectedServer?.id == server.id,
                            onClick = { selectedServer = server }
                        )
                    }
                    
                    item {
                        Divider(modifier = Modifier.padding(vertical = 8.dp))
                        Text(
                            text = "Direct Messages",
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.padding(16.dp, 8.dp, 16.dp, 8.dp)
                        )
                    }
                    
                    items(dms) { dm ->
                        DMItem(
                            dm = dm,
                            isSelected = currentContext?.type == "dm" && currentContext?.id == dm.dmId,
                            onClick = {
                                selectedServer = null
                                viewModel.selectDM(dm.dmId, dm.otherUser)
                            }
                        )
                    }
                }
            }
            
            // Middle sidebar - Channels (when server is selected)
            if (selectedServer != null) {
                Surface(
                    modifier = Modifier
                        .width(150.dp)
                        .fillMaxHeight(),
                    color = MaterialTheme.colorScheme.surface
                ) {
                    LazyColumn {
                        item {
                            Text(
                                text = "Channels",
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier.padding(16.dp, 16.dp, 16.dp, 8.dp)
                            )
                        }
                        
                        items(selectedServer!!.channels) { channel ->
                            ChannelItem(
                                channel = channel,
                                isSelected = currentContext?.id == "${selectedServer!!.id}/${channel.id}",
                                onClick = {
                                    viewModel.selectChannel(
                                        selectedServer!!.id,
                                        channel.id,
                                        "#${channel.name}"
                                    )
                                }
                            )
                        }
                    }
                }
            }
            
            // Main chat area
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .weight(1f)
            ) {
                if (currentContext == null) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Select a channel or DM to start chatting",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    // Messages list
                    val listState = rememberLazyListState()
                    
                    LaunchedEffect(messages.size) {
                        if (messages.isNotEmpty()) {
                            listState.animateScrollToItem(messages.size - 1)
                        }
                    }
                    
                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(16.dp),
                        state = listState
                    ) {
                        items(messages) { message ->
                            MessageItem(
                                message = message,
                                isCurrentUser = message.username == user?.username
                            )
                        }
                    }
                    
                    // Message input
                    Divider()
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = { messageText = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Type a message...") },
                            maxLines = 3
                        )
                        
                        Spacer(modifier = Modifier.width(8.dp))
                        
                        IconButton(
                            onClick = {
                                if (messageText.isNotBlank()) {
                                    viewModel.sendMessage(messageText)
                                    messageText = ""
                                }
                            },
                            enabled = messageText.isNotBlank()
                        ) {
                            Icon(Icons.Default.Send, "Send")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ServerItem(server: Server, isSelected: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    ) {
        Row(
            modifier = Modifier.padding(16.dp, 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.GroupWork,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = server.name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun ChannelItem(channel: com.decentra.chat.data.Channel, isSelected: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = if (isSelected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface
    ) {
        Row(
            modifier = Modifier.padding(16.dp, 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (channel.type == "voice") Icons.Default.VolumeUp else Icons.Default.Tag,
                contentDescription = null,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = channel.name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun DMItem(dm: DirectMessage, isSelected: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    ) {
        Row(
            modifier = Modifier.padding(16.dp, 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Person,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = dm.otherUser,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun MessageItem(message: Message, isCurrentUser: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = if (isCurrentUser) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = if (isCurrentUser) 
                MaterialTheme.colorScheme.primaryContainer 
            else 
                MaterialTheme.colorScheme.secondaryContainer,
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp)
            ) {
                if (!isCurrentUser) {
                    Text(
                        text = message.username,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                }
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}
