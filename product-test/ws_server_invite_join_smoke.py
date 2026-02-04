#!/usr/bin/env python3
"""Smoke test: generate a server invite over WS, then join with it.

Runs against the running Docker stack (connects to wss://localhost:8765/ws).
Designed to be executed inside the `decentra-server` container so it can use
DATABASE_URL from the container environment for deterministic DB setup/cleanup.
"""

import asyncio
import json
import os
import random
import ssl
import string
import sys
from typing import Any, Callable, Optional

import bcrypt
from aiohttp import ClientSession, ClientWebSocketResponse

sys.path.insert(0, "/app")

from database import Database


def _suffix(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def _recv_json_until(
    ws: ClientWebSocketResponse,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout_s: float = 10.0,
) -> dict[str, Any]:
    async def _inner() -> dict[str, Any]:
        while True:
            msg = await ws.receive()
            if msg.type.name in {"CLOSED", "CLOSING"}:
                raise RuntimeError("WebSocket closed while waiting for message")
            if msg.type.name == "ERROR":
                raise RuntimeError(f"WebSocket error while waiting: {ws.exception()}")
            if msg.type.name != "TEXT":
                continue
            data = json.loads(msg.data)
            if isinstance(data, dict) and predicate(data):
                return data

    return await asyncio.wait_for(_inner(), timeout=timeout_s)


async def _login(ws: ClientWebSocketResponse, username: str, password: str) -> str:
    await ws.send_json({"type": "login", "username": username, "password": password})
    auth = await _recv_json_until(ws, lambda d: d.get("type") in {"auth_success", "auth_error", "2fa_required"})
    if auth.get("type") != "auth_success":
        raise RuntimeError(f"Login failed for {username}: {auth}")
    token = auth.get("token")
    if not token:
        raise RuntimeError(f"Missing token in auth_success for {username}: {auth}")
    return token


async def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set. Run this inside the server container or provide DATABASE_URL.")

    # Ensure server encryption key is present (server imports can require it).
    os.environ.setdefault("DECENTRA_ENCRYPTION_KEY", "test-encryption-key-for-ws-invite-smoke")

    db = Database(database_url)

    password = "InviteTestPass123!"
    suf = _suffix()
    alice = f"alice_inv_{suf}"
    bob = f"bob_inv_{suf}"
    server_id = f"server_inv_{suf}"
    channel_id = f"channel_inv_{suf}"

    created_invite_code: Optional[str] = None

    print("WS server invite/join smoke test")
    print(f"- alice: {alice}")
    print(f"- bob:   {bob}")
    print(f"- server_id: {server_id}")

    try:
        # DB setup
        assert db.create_user(alice, _hash_password(password), f"{alice}@example.com"), "Failed to create alice"
        assert db.create_user(bob, _hash_password(password), f"{bob}@example.com"), "Failed to create bob"
        assert db.create_server(server_id, "Invite Smoke Server", alice), "Failed to create server"
        assert db.create_channel(channel_id, server_id, "general", "text"), "Failed to create channel"
        print("✓ DB setup complete")

        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        async with ClientSession() as session:
            # Connect Alice
            async with session.ws_connect("wss://localhost:8765/ws", ssl=ssl_context) as ws_alice:
                await _login(ws_alice, alice, password)

                # Ask for server invite
                await ws_alice.send_json({"type": "generate_server_invite", "server_id": server_id})
                invite_msg = await _recv_json_until(ws_alice, lambda d: d.get("type") in {"server_invite_code", "error"})
                if invite_msg.get("type") != "server_invite_code":
                    raise RuntimeError(f"generate_server_invite failed: {invite_msg}")

                created_invite_code = invite_msg.get("code")
                if not created_invite_code:
                    raise RuntimeError(f"Missing code in server_invite_code: {invite_msg}")
                print(f"✓ Invite created: {created_invite_code}")

            # Connect Bob
            async with session.ws_connect("wss://localhost:8765/ws", ssl=ssl_context) as ws_bob:
                await _login(ws_bob, bob, password)

                await ws_bob.send_json({"type": "join_server_with_invite", "invite_code": created_invite_code})
                joined_msg = await _recv_json_until(ws_bob, lambda d: d.get("type") in {"server_joined", "error"})
                if joined_msg.get("type") != "server_joined":
                    raise RuntimeError(f"join_server_with_invite failed: {joined_msg}")

                server = joined_msg.get("server")
                if not isinstance(server, dict) or server.get("id") != server_id:
                    raise RuntimeError(f"server_joined payload mismatch: {joined_msg}")

                channels = server.get("channels")
                if not isinstance(channels, list) or not any(ch.get("id") == channel_id for ch in channels if isinstance(ch, dict)):
                    raise RuntimeError(f"server_joined missing expected channel: {joined_msg}")

                print("✓ Bob joined server via invite")

            # Verify DB effects
            members = db.get_server_members(server_id)
            member_usernames = {m.get("username") for m in members}
            assert bob in member_usernames, f"Bob not in server members: {member_usernames}"

            invite_still_exists = db.get_invite_code(created_invite_code)
            assert invite_still_exists is None, "Invite code was not deleted after use"

            usage = db.get_server_invite_usage(server_id)
            usage_codes = {u.get("invite_code") for u in usage}
            assert created_invite_code in usage_codes, f"Invite usage not logged for code {created_invite_code}"
            print("✓ DB membership + invite deletion + usage log verified")

        print("\nPASS")
        return 0

    finally:
        # Cleanup best-effort
        try:
            with db.get_connection() as conn:
                cur = conn.cursor()
                if created_invite_code:
                    cur.execute("DELETE FROM invite_usage WHERE invite_code = %s", (created_invite_code,))
                    cur.execute("DELETE FROM invite_codes WHERE code = %s", (created_invite_code,))
                cur.execute("DELETE FROM invite_usage WHERE server_id = %s", (server_id,))
                cur.execute("DELETE FROM invite_codes WHERE server_id = %s", (server_id,))
                cur.execute("DELETE FROM server_members WHERE server_id = %s", (server_id,))
                cur.execute("DELETE FROM channels WHERE server_id = %s", (server_id,))
                cur.execute("DELETE FROM servers WHERE server_id = %s", (server_id,))
                cur.execute("DELETE FROM users WHERE username IN (%s, %s)", (alice, bob))
                conn.commit()
            print("✓ Cleanup complete")
        except Exception as e:
            print(f"⚠ Cleanup warning: {e}")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
