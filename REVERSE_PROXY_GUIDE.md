# Reverse Proxy Guide for Decentra

This guide covers placing Decentra behind a reverse proxy using five common options. Each section assumes you have Decentra running via `docker compose up -d` and that DNS for your domain already points to your server's public IP.

---

## Port Reference

| Service | Container Port | Host Port | Protocol | Notes |
|---|---|---|---|---|
| Frontend (App) | 8443 | 8765 | HTTPS/WSS | Main entry point for the reverse proxy |
| LiveKit Signaling | 7880 | 7880 | HTTP/WS | Proxied or exposed directly |
| LiveKit WebRTC TCP | 7881 | 7881 | TCP | Must be exposed directly — not proxiable |
| LiveKit WebRTC UDP | 7882 | 7882 | UDP | Must be exposed directly — not proxiable |
| Coturn TURN UDP | 3478 | 3478 | UDP | Must be exposed directly — not proxiable |
| Coturn TURN TCP | 3478 | 3478 | TCP | Must be exposed directly — not proxiable |
| Coturn TURN TLS | 5349 | 5349 | TCP | Must be exposed directly — not proxiable |
| Coturn Relay Range | 49152–49200 | 49152–49200 | UDP | TURN media relay; must be exposed directly |

> **Important:** The frontend container speaks **HTTPS** internally (self-signed certificate). Your reverse proxy must either terminate TLS and proxy to `https://localhost:8765` with SSL verification disabled, or pass the connection through (SSL passthrough). WebRTC/TURN ports **cannot** be proxied by an HTTP reverse proxy — they must be forwarded directly to the host.
>
> **Security:** Decentra enforces `iceTransportPolicy: 'relay'`, which means **all** voice/video media is routed through the self-hosted Coturn TURN server. If Coturn is unreachable from clients, voice calls will not connect. Ensure the Coturn ports above are open in your firewall.

---

## Table of Contents

1. [Nginx](#1-nginx)
2. [Traefik](#2-traefik)
3. [Caddy](#3-caddy)
4. [Nginx Proxy Manager](#4-nginx-proxy-manager)
5. [Cloudflare Tunnel](#5-cloudflare-tunnel)

---

## 1. Nginx

### Prerequisites

- Nginx installed on the host (or in a separate container)
- A valid TLS certificate (e.g., from Let's Encrypt via Certbot)
- Your domain: `chat.example.com`

### Step 1 — Obtain a Certificate

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d chat.example.com
```

Certificates are written to `/etc/letsencrypt/live/chat.example.com/`.

### Step 2 — Write the Nginx Configuration

Create `/etc/nginx/sites-available/decentra.conf`:

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Increase maximum upload size to match Decentra's 25 MB limit
    client_max_body_size 26m;

    location / {
        proxy_pass https://127.0.0.1:8765;
        proxy_ssl_verify off;                    # self-signed cert inside container

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # WebSocket support (used by /ws path)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Step 3 — Enable and Reload

```bash
sudo ln -s /etc/nginx/sites-available/decentra.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 4 — LiveKit WebRTC Signaling (optional proxy)

If you want the LiveKit signaling port (7880) behind a subdomain, add a second server block:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name livekit.example.com;

    ssl_certificate     /etc/letsencrypt/live/livekit.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;
    }
}
```

Then set `LIVEKIT_URL=wss://livekit.example.com` in your `.env`.

> UDP ports 7882 and 3478 must still be open in your firewall and are not handled by Nginx.

---

## 2. Traefik

This approach runs Traefik as an additional Docker service alongside Decentra, using Docker labels for automatic routing.

### Step 1 — Create a Shared External Network

```bash
docker network create traefik-public
```

### Step 2 — Deploy Traefik

Create `traefik/docker-compose.yml`:

```yaml
services:
  traefik:
    image: traefik:v3.1
    container_name: traefik
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.tlschallenge=true
      - --certificatesresolvers.letsencrypt.acme.email=admin@example.com
      - --certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-acme:/acme
    networks:
      - traefik-public

volumes:
  traefik-acme:

networks:
  traefik-public:
    external: true
```

```bash
cd traefik && docker compose up -d
```

### Step 3 — Add Labels to Decentra's docker-compose.yml

Add the `traefik-public` network and labels to the `frontend` service:

```yaml
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: decentra-frontend
    ports:
      - "8765:8443"
    networks:
      - decentra-network
      - traefik-public
    restart: unless-stopped
    depends_on:
      - server
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik-public"

      # Router — HTTPS
      - "traefik.http.routers.decentra.rule=Host(`chat.example.com`)"
      - "traefik.http.routers.decentra.entrypoints=websecure"
      - "traefik.http.routers.decentra.tls.certresolver=letsencrypt"
      - "traefik.http.routers.decentra.service=decentra"

      # Service — target the HTTPS port inside the container
      - "traefik.http.services.decentra.loadbalancer.server.scheme=https"
      - "traefik.http.services.decentra.loadbalancer.server.port=8443"
      - "traefik.http.services.decentra.loadbalancer.serverstransport=insecure@internal"

      # HTTP → HTTPS redirect
      - "traefik.http.routers.decentra-http.rule=Host(`chat.example.com`)"
      - "traefik.http.routers.decentra-http.entrypoints=web"
      - "traefik.http.routers.decentra-http.middlewares=redirect-https"
      - "traefik.http.middlewares.redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.redirect-https.redirectscheme.permanent=true"

# Add the external network reference at the bottom of the file
networks:
  decentra-network:
    driver: bridge
  traefik-public:
    external: true
```

### Step 4 — Allow Insecure Backend Transport

Traefik v3 requires explicit permission to connect to backends with self-signed certificates. Add a static configuration file `traefik/traefik.yml` (or add to the command flags):

```yaml
serversTransport:
  insecureSkipVerify: true
```

Or add this flag to the Traefik service command:

```yaml
- --serversTransport.insecureSkipVerify=true
```

### Step 5 — Redeploy

```bash
docker compose down && docker compose up -d
```

### LiveKit with Traefik

Add a similar set of labels to the `livekit` service targeting port `7880` with `scheme=http`. UDP ports 7881, 7882, and 3478 must be exposed directly and cannot be routed through Traefik.

---

## 3. Caddy

Caddy handles TLS certificates automatically with no extra tooling required.

### Prerequisites

- Caddy installed: https://caddyserver.com/docs/install
- Your domain `chat.example.com` points to your server

### Step 1 — Write the Caddyfile

Create `/etc/caddy/Caddyfile` (or `Caddyfile` in any directory if running standalone):

```caddyfile
chat.example.com {
    # Caddy automatically obtains and renews a Let's Encrypt certificate.

    # Increase body size limit to match Decentra's 25 MB allowance
    request_body {
        max_size 26MB
    }

    reverse_proxy https://localhost:8765 {
        # The frontend container uses a self-signed certificate
        transport http {
            tls_insecure_skip_verify
        }

        # Forward real client information
        header_up Host              {upstream_hostport}
        header_up X-Real-IP         {remote_host}
        header_up X-Forwarded-For   {remote_host}
        header_up X-Forwarded-Proto https
    }
}
```

### Step 2 — Optional: LiveKit Signaling on a Subdomain

```caddyfile
livekit.example.com {
    reverse_proxy localhost:7880 {
        header_up Host            {upstream_hostport}
        header_up X-Forwarded-For {remote_host}
    }
}
```

Set `LIVEKIT_URL=wss://livekit.example.com` in `.env`.

### Step 3 — Start Caddy

```bash
# If using the systemd service
sudo systemctl reload caddy

# Or run directly
caddy run --config /etc/caddy/Caddyfile
```

### Step 4 — Verify

```bash
caddy validate --config /etc/caddy/Caddyfile
curl -I https://chat.example.com
```

> Caddy's WebSocket proxying is automatic — no special headers are needed.

---

## 4. Nginx Proxy Manager

Nginx Proxy Manager (NPM) provides a web GUI on top of Nginx with built-in Let's Encrypt support.

### Step 1 — Deploy Nginx Proxy Manager

Add NPM to a separate `docker-compose.yml` or alongside Decentra:

```yaml
services:
  npm:
    image: jc21/nginx-proxy-manager:2.14.0
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "80:80"      # HTTP
      - "443:443"    # HTTPS
      - "81:81"      # NPM Admin UI
    volumes:
      - npm-data:/data
      - npm-certs:/etc/letsencrypt
    networks:
      - decentra-network   # same network so NPM can reach the frontend container

volumes:
  npm-data:
  npm-certs:

networks:
  decentra-network:
    external: true          # reference the existing Decentra network
```

> If running on a separate host, omit the `decentra-network` and use `127.0.0.1:8765` as the hostname below.

```bash
docker compose up -d
```

### Step 2 — Log In to the Admin UI

Open `http://<your-server-ip>:81` and log in with:

- **Email:** `admin@example.com`
- **Password:** `changeme`

Change these credentials immediately after first login.

### Step 3 — Create a Proxy Host

1. Click **Proxy Hosts → Add Proxy Host**
2. Fill in the **Details** tab:
   - **Domain Names:** `chat.example.com`
   - **Scheme:** `https`
   - **Forward Hostname / IP:** `decentra-frontend` *(container name, since NPM is on the same Docker network)* — or `127.0.0.1` if on the host
   - **Forward Port:** `8443`
   - Enable **Cache Assets**: off (chat apps should not cache dynamic responses)
   - Enable **Block Common Exploits**: on
   - Enable **Websockets Support**: **on** ← required for real-time chat
3. Switch to the **SSL** tab:
   - **SSL Certificate:** Request a new Let's Encrypt certificate
   - **Force SSL:** on
   - **HTTP/2 Support:** on
   - **HSTS Enabled:** on (optional but recommended)
4. Switch to the **Advanced** tab and add the following to disable upstream SSL verification:

```nginx
proxy_ssl_verify off;
```

5. Click **Save**.

### Step 4 — LiveKit Signaling (optional)

Repeat Step 3 for a second proxy host:

- **Domain Names:** `livekit.example.com`
- **Scheme:** `http`
- **Forward Hostname / IP:** `decentra-livekit` or `127.0.0.1`
- **Forward Port:** `7880`
- **Websockets Support:** on

Set `LIVEKIT_URL=wss://livekit.example.com` in `.env`, then redeploy Decentra.

> NPM cannot proxy UDP ports. Ports 7881, 7882, and 3478 must be exposed directly in `docker-compose.yml` and open in the host firewall.

---

## 5. Cloudflare Tunnel

Cloudflare Tunnel (`cloudflared`) creates an outbound-only encrypted tunnel from your server to Cloudflare's edge. No inbound ports need to be opened on your firewall, and Cloudflare handles TLS termination.

> **Limitation:** Cloudflare Tunnel routes HTTP/HTTPS traffic only. LiveKit's WebRTC UDP ports (7882, 3478) and TCP port (7881) **cannot** be tunneled. Voice/video will only work if those ports are separately reachable by clients — either directly exposed on the server or via a TURN server. See the LiveKit note at the end of this section.

### Prerequisites

- A domain added to Cloudflare (with Cloudflare as the DNS provider)
- A Cloudflare account with Zero Trust enabled (free tier is sufficient)

### Step 1 — Install cloudflared

**Debian/Ubuntu:**

```bash
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-archive-keyring.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
```

**Docker (alternative):**

```bash
docker pull cloudflare/cloudflared:latest
```

### Step 2 — Authenticate

```bash
cloudflared tunnel login
```

A browser window opens asking you to authorize the tunnel for your Cloudflare zone. The credentials file is saved to `~/.cloudflared/cert.pem`.

### Step 3 — Create the Tunnel

```bash
cloudflared tunnel create decentra
```

Note the **Tunnel ID** printed in the output (e.g., `abc12345-...`).

### Step 4 — Configure the Tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR_TUNNEL_ID>
credentials-file: /root/.cloudflared/<YOUR_TUNNEL_ID>.json

ingress:
  # Main Decentra application
  - hostname: chat.example.com
    service: https://localhost:8765
    originRequest:
      noTLSVerify: true          # self-signed cert inside the container
      httpHostHeader: chat.example.com

  # LiveKit HTTP/WS signaling (optional)
  - hostname: livekit.example.com
    service: http://localhost:7880

  # Required catch-all rule
  - service: http_status:404
```

Replace `<YOUR_TUNNEL_ID>` with the value from Step 3.

### Step 5 — Create DNS Records

```bash
cloudflared tunnel route dns decentra chat.example.com
cloudflared tunnel route dns decentra livekit.example.com   # if using LiveKit subdomain
```

This creates `CNAME` records in Cloudflare DNS pointing to the tunnel.

### Step 6 — Run the Tunnel

**Test (foreground):**

```bash
cloudflared tunnel run decentra
```

**As a systemd service (production):**

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**As a Docker container:**

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    command: tunnel --config /etc/cloudflared/config.yml run
    volumes:
      - ~/.cloudflared:/etc/cloudflared:ro
    network_mode: host   # required to reach localhost:8765
```

### Step 7 — Cloudflare Dashboard Settings

In the Cloudflare dashboard under **SSL/TLS**:

- Set encryption mode to **Full** (not Full (Strict), since the origin uses a self-signed cert)
- Enable **WebSockets** under **Network → WebSockets** (required for real-time chat)

### LiveKit & WebRTC with Cloudflare Tunnel

Cloudflare Tunnel cannot carry WebRTC UDP or raw TCP. For voice/video to work you have two options:

**Option A — Expose WebRTC ports directly (recommended for self-hosted)**

Keep the LiveKit ports exposed in `docker-compose.yml` and open them in your firewall:

```bash
# UFW example
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 3478/udp
```

Set `LIVEKIT_URL=wss://livekit.example.com` and point `livekit.example.com` as a regular DNS A record (not via the tunnel) to your server's IP.

**Option B — Use a Cloudflare-compatible TURN/relay service**

Use a third-party TURN provider (e.g., Metered, Xirsys) and configure LiveKit's `turn` section in `livekit.yaml` accordingly.

---

## General Firewall Checklist

Regardless of which reverse proxy you choose, ensure these ports are open on your host:

| Port | Protocol | Required for |
|---|---|---|
| 80 | TCP | HTTP → HTTPS redirect |
| 443 | TCP | HTTPS (app traffic) |
| 7881 | TCP | LiveKit WebRTC TCP fallback |
| 7882 | UDP | LiveKit WebRTC media |
| 3478 | UDP+TCP | Coturn TURN relay (required — relay-only ICE is enforced) |
| 5349 | TCP | Coturn TURN over TLS (recommended for restrictive networks) |
| 49152–49200 | UDP | Coturn TURN media relay range |

```bash
# UFW quick reference
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:49200/udp
sudo ufw enable
```

> **Note:** Since `iceTransportPolicy: 'relay'` is enforced client-side, all voice/video traffic routes through Coturn. If Coturn ports are unreachable, voice calls will fail silently.

---

## Environment Variables After Setup

After configuring a reverse proxy, update your `.env` to match your domain:

```env
# Use wss:// for the LiveKit URL so the browser connects over WebSocket Secure
LIVEKIT_URL=wss://livekit.example.com

# Coturn TURN relay — set to your public domain/IP
COTURN_URL=turn:chat.example.com:3478
COTURN_REALM=chat.example.com
# Generate a strong secret: python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
COTURN_SECRET=YOUR_COTURN_SECRET_HERE
```

Then restart Decentra:

```bash
docker compose down && docker compose up -d
```
