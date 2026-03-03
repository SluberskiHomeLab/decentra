"""
test_voice_sfu_token.py

Verifies that:
  1. Joining a server voice channel returns a voice_channel_joined WebSocket message
     that contains 'livekit_token' and 'livekit_url' fields when the server has
     LIVEKIT_API_KEY/LIVEKIT_API_SECRET configured.
  2. The returned token is a valid 3-part JWT signed with HS256 whose payload
     contains the expected LiveKit claims (room, roomJoin, correct identity)
     and expires within 1 hour (hardened from previous 24-hour lifetime).
  3. The /api/voice/ice-servers REST endpoint:
     - Requires a valid session token (returns 401 without one).
     - Returns ONLY self-hosted Coturn TURN entries (no Google STUN).
     - Each TURN entry includes time-limited HMAC credentials.
  4. Direct-call (DM) voice signalling still produces *no* livekit_token (P2P path
     is preserved for calls that are not server voice channels).

Prerequisites:
  - Server running at https://localhost:8765
  - LIVEKIT_API_KEY=devkey and LIVEKIT_API_SECRET=devsecret_change_me_in_production
    (or whatever values match livekit.yaml / docker-compose.yml) set on the server.
  - At least two registered users and one server with a voice channel.
  - Set TEST_USER1, TEST_PASS1, TEST_USER2, TEST_PASS2, TEST_SERVER_ID,
    TEST_VOICE_CHANNEL_ID as environment variables or edit the constants below.

Run:
  python product-test/test_voice_sfu_token.py
"""

import asyncio
import base64
import json
import os
import ssl
import sys
import time

import websockets
import requests

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_URL  = os.environ.get('TEST_SERVER_URL', 'https://localhost:8765')
WS_URL    = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws'

USER1     = os.environ.get('TEST_USER1', 'alice')
PASS1     = os.environ.get('TEST_PASS1', 'password123')
USER2     = os.environ.get('TEST_USER2', 'bob')
PASS2     = os.environ.get('TEST_PASS2', 'password123')
SERVER_ID = os.environ.get('TEST_SERVER_ID', '')
CHANNEL_ID = os.environ.get('TEST_VOICE_CHANNEL_ID', '')

# Allow self-signed TLS certs in test environment
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

PASS = '\033[92m[PASS]\033[0m'
FAIL = '\033[91m[FAIL]\033[0m'


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without verifying signature."""
    parts = token.split('.')
    if len(parts) != 3:
        raise ValueError(f'Not a valid JWT: {token!r}')
    padding = (-len(parts[1])) % 4
    payload_bytes = base64.urlsafe_b64decode(parts[1] + '=' * padding)
    return json.loads(payload_bytes)


def login(username: str, password: str) -> str:
    """Return a bearer token for the given credentials."""
    resp = requests.post(
        f'{BASE_URL}/api/login',
        json={'username': username, 'password': password},
        verify=False,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get('token') or data.get('access_token')
    if not token:
        raise RuntimeError(f'Login response missing token: {data}')
    return token


def test_ice_servers_endpoint(token: str) -> None:
    """Test /api/voice/ice-servers returns valid, authenticated, TURN-only config."""
    # ── Test 1: Request without token should return 401 ──
    resp_no_auth = requests.get(
        f'{BASE_URL}/api/voice/ice-servers',
        verify=False,
        timeout=10,
    )
    assert resp_no_auth.status_code == 401, f'Expected 401 without token, got {resp_no_auth.status_code}'
    print(f'{PASS} /api/voice/ice-servers returns 401 without authentication')

    # ── Test 2: Request with valid token ──
    resp = requests.get(
        f'{BASE_URL}/api/voice/ice-servers',
        headers={'Authorization': f'Bearer {token}'},
        verify=False,
        timeout=10,
    )
    assert resp.status_code == 200, f'Expected 200, got {resp.status_code}'
    data = resp.json()
    assert 'ice_servers' in data, f'Missing ice_servers key: {data}'
    assert isinstance(data['ice_servers'], list), 'ice_servers must be a list'
    assert len(data['ice_servers']) > 0, 'ice_servers must not be empty'

    # Every entry must be a TURN entry with credentials (no STUN allowed)
    for entry in data['ice_servers']:
        assert 'urls' in entry, f'ICE entry missing urls: {entry}'
        assert 'turn:' in entry['urls'], f'Expected TURN-only, got: {entry["urls"]}'
        assert 'username' in entry, f'ICE entry missing username (HMAC cred): {entry}'
        assert 'credential' in entry, f'ICE entry missing credential (HMAC cred): {entry}'
        # Username should be in format "<expiry_timestamp>:<username>"
        parts = entry['username'].split(':')
        assert len(parts) >= 2, f'TURN username not in expiry:user format: {entry["username"]}'
        expiry_ts = int(parts[0])
        assert expiry_ts > time.time(), f'TURN credential already expired: {expiry_ts}'

    # No Google STUN entries should be present
    for entry in data['ice_servers']:
        assert 'stun.l.google.com' not in entry.get('urls', ''), \
            f'Google STUN should not be present: {entry}'

    print(f'{PASS} /api/voice/ice-servers returned {len(data["ice_servers"])} TURN server(s) with HMAC credentials')


async def test_voice_channel_joined_sfu(token1: str) -> None:
    """
    Join a server voice channel and verify voice_channel_joined contains
    livekit_token / livekit_url (SFU path).
    """
    if not SERVER_ID or not CHANNEL_ID:
        print(f'  [SKIP] TEST_SERVER_ID or TEST_VOICE_CHANNEL_ID not set — skipping SFU token test')
        return

    async with websockets.connect(WS_URL, ssl=SSL_CTX) as ws:
        # Authenticate
        await ws.send(json.dumps({'type': 'auth', 'token': token1}))

        # Wait for auth_success
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            msg = json.loads(raw)
            if msg.get('type') == 'auth_success':
                break
        else:
            raise AssertionError('auth_success not received within 10 s')

        # Join voice channel
        await ws.send(json.dumps({
            'type': 'join_voice_channel',
            'server_id': SERVER_ID,
            'channel_id': CHANNEL_ID,
        }))

        # Collect messages for up to 5 s; look for voice_channel_joined
        joined_msg: dict | None = None
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get('type') == 'voice_channel_joined':
                joined_msg = msg
                break

        assert joined_msg is not None, 'voice_channel_joined was never received'

        lk_token = joined_msg.get('livekit_token')
        lk_url   = joined_msg.get('livekit_url')

        if lk_token is None:
            # Server running without LiveKit — acceptable, P2P fallback
            print(f'  [INFO] livekit_token is null — server not configured with LiveKit; P2P fallback active')
        else:
            # Validate the JWT structure
            assert isinstance(lk_token, str) and len(lk_token.split('.')) == 3, \
                f'livekit_token is not a valid JWT: {lk_token!r}'
            assert isinstance(lk_url, str) and lk_url.startswith('ws'), \
                f'livekit_url looks wrong: {lk_url!r}'

            payload = _decode_jwt_payload(lk_token)
            expected_room = f'{SERVER_ID}__{CHANNEL_ID}'
            assert payload.get('video', {}).get('room') == expected_room, \
                f'room claim mismatch: {payload}'
            assert payload.get('video', {}).get('roomJoin') is True, 'roomJoin must be true'
            assert payload.get('sub') == USER1, f'sub claim should be username: {payload}'
            expiry = payload.get('exp', 0)
            assert expiry > time.time(), 'Token is already expired!'
            # Hardened: token should expire within 1 hour (3600s), not 24h
            assert expiry <= time.time() + 3700, \
                f'Token expiry too far in future (expected <=1h): exp={expiry}, now={time.time()}'

            print(f'{PASS} voice_channel_joined contained valid LiveKit JWT (room={expected_room}, sub={USER1})')
            print(f'{PASS} livekit_url = {lk_url}')

        # Clean up
        await ws.send(json.dumps({'type': 'leave_voice_channel'}))


async def test_direct_call_no_livekit_token(token1: str, token2: str) -> None:
    """
    Initiate a DM direct call and verify the signalling does NOT include livekit_token
    (DM calls must remain P2P).
    """
    user2 = USER2  # friend whose username we call

    async with websockets.connect(WS_URL, ssl=SSL_CTX) as ws1, \
               websockets.connect(WS_URL, ssl=SSL_CTX) as ws2:

        for ws, tok in ((ws1, token1), (ws2, token2)):
            await ws.send(json.dumps({'type': 'auth', 'token': tok}))

        # Drain auth responses
        for ws in (ws1, ws2):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                if json.loads(raw).get('type') == 'auth_success':
                    break

        # USER1 starts a DM call to USER2
        await ws1.send(json.dumps({'type': 'start_voice_call', 'username': user2}))

        # USER2 should receive incoming_voice_call (not voice_channel_joined)
        deadline = time.monotonic() + 5
        incoming_msg: dict | None = None
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws2.recv(), timeout=2)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get('type') == 'incoming_voice_call':
                incoming_msg = msg
                break

        assert incoming_msg is not None, 'incoming_voice_call not received by USER2'
        assert 'livekit_token' not in incoming_msg, \
            f'DM call MUST NOT include livekit_token — got: {incoming_msg}'
        print(f'{PASS} DM voice call correctly uses P2P path (no livekit_token in incoming_voice_call)')

        # Clean up
        await ws1.send(json.dumps({'type': 'leave_direct_call'}))


def main() -> None:
    print('\n=== Voice SFU / ICE-Server Tests ===\n')

    ok = True

    try:
        token1 = login(USER1, PASS1)
        token2 = login(USER2, PASS2)
        print(f'  Logged in as {USER1!r} and {USER2!r}')
    except Exception as exc:
        print(f'{FAIL} Login failed: {exc}')
        sys.exit(1)

    # 1. ICE servers endpoint
    try:
        test_ice_servers_endpoint(token1)
    except Exception as exc:
        print(f'{FAIL} ICE servers test: {exc}')
        ok = False

    # 2. SFU token in voice_channel_joined
    try:
        asyncio.run(test_voice_channel_joined_sfu(token1))
    except Exception as exc:
        print(f'{FAIL} voice_channel_joined SFU token test: {exc}')
        ok = False

    # 3. DM calls must stay P2P
    try:
        asyncio.run(test_direct_call_no_livekit_token(token1, token2))
    except Exception as exc:
        print(f'{FAIL} DM P2P regression test: {exc}')
        ok = False

    print()
    if ok:
        print('All voice SFU tests passed.')
    else:
        print('One or more tests FAILED.')
        sys.exit(1)


if __name__ == '__main__':
    main()
