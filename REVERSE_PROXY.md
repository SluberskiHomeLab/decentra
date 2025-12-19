# Reverse Proxy Configuration for Decentra Chat

## Requirements

For WebRTC voice/video to work, your reverse proxy must:

1. **Provide HTTPS** - Browsers require secure context for microphone/camera access
2. **Support WebSocket upgrades** - For real-time chat and signaling
3. **Preserve headers** - For proper client IP and protocol detection

## Backend Configuration

The Decentra server runs on:
- **Port**: 8765
- **Protocol**: HTTP + WebSocket
- **Path**: All paths (/, /static/*, WebSocket on same port)

## Generic Reverse Proxy Requirements

### Headers Required
```
Upgrade: websocket (for WebSocket connections)
Connection: upgrade
Host: original-host
X-Real-IP: client-ip
X-Forwarded-For: client-ip
X-Forwarded-Proto: https
```

### Timeouts
- **WebSocket timeout**: 3600s (1 hour minimum)
- **Read timeout**: 300s
- **Connection timeout**: 60s

## Example Configurations

### Nginx

```nginx
upstream decentra_backend {
    server localhost:8765;
}

server {
    listen 443 ssl http2;
    server_name chat.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket and HTTP proxy
    location / {
        proxy_pass http://decentra_backend;
        proxy_http_version 1.1;
        
        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Preserve client info
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for WebSocket
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name chat.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Caddy

```caddy
chat.yourdomain.com {
    reverse_proxy localhost:8765 {
        # WebSocket support is automatic in Caddy
        
        # Preserve headers
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### Apache

```apache
<VirtualHost *:443>
    ServerName chat.yourdomain.com
    
    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem
    
    # Enable proxy modules
    # a2enmod proxy proxy_http proxy_wstunnel
    
    ProxyPreserveHost On
    ProxyPass / http://localhost:8765/
    ProxyPassReverse / http://localhost:8765/
    
    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           ws://localhost:8765/$1 [P,L]
    
    # Headers
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Real-IP %{REMOTE_ADDR}s
</VirtualHost>
```

### Traefik (docker-compose.yml)

```yaml
services:
  decentra-server:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.decentra.rule=Host(`chat.yourdomain.com`)"
      - "traefik.http.routers.decentra.entrypoints=websecure"
      - "traefik.http.routers.decentra.tls=true"
      - "traefik.http.routers.decentra.tls.certresolver=letsencrypt"
      - "traefik.http.services.decentra.loadbalancer.server.port=8765"
```

## Pangolin Configuration

If you're using Pangolin as your reverse proxy, please provide:
1. Configuration file format/location
2. Current proxy configuration
3. Documentation or example configs

Then I can create a specific configuration for it.

## Testing

After configuring your reverse proxy:

1. Access via HTTPS: `https://your-domain.com`
2. Open browser console (F12)
3. Try joining a voice channel
4. Browser should prompt for microphone permission
5. Check console for any WebSocket or connection errors

## Troubleshooting

### Microphone permission not asked
- Ensure you're accessing via HTTPS (not HTTP)
- Check SSL certificate is valid (not self-signed without exception)
- Try in incognito/private mode

### WebSocket connection fails
- Check proxy supports WebSocket upgrades
- Verify timeout settings are sufficient (>3600s)
- Look for "426 Upgrade Required" or "101 Switching Protocols" in network tab

### Audio doesn't connect
- Verify WebSocket connection is stable
- Check browser console for WebRTC errors
- Ensure firewall allows WebSocket traffic
- Test with the audio diagnostic page: `/static/audio-test.html`

## WebRTC P2P Considerations

This application uses **P2P WebRTC** for voice/video, meaning:
- Audio/video streams go **directly between users** (peer-to-peer)
- Only signaling data goes through the server
- Users may need to be on the same network or have proper NAT traversal
- STUN servers are configured (Google's public STUN servers)

For production use across different networks, consider adding a TURN server for NAT traversal.
