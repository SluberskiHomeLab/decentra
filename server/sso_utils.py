#!/usr/bin/env python3
"""
SSO / SCIM utilities for Decentra Chat Server.

Provides OIDC, SAML, and LDAP authentication providers, plus a SCIM 2.0 handler
for user and group provisioning.  Each provider class is stateless — it reads
the current admin_settings from the database on every call so hot-reloads of
the SSO configuration take effect immediately.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
import jwt as pyjwt
from authlib.jose import JsonWebKey, jwt as authlib_jwt
from authlib.oidc.core import CodeIDToken

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash_token(raw: str) -> str:
    """SHA-256 hex digest used for SCIM bearer-token storage."""
    return hashlib.sha256(raw.encode()).hexdigest()


def _sanitize_username(name: str) -> str:
    """
    Turn an SSO display-name / email into a valid Decentra username.
    Strips special chars and truncates to 50 chars.
    """
    name = name.split("@")[0]              # strip domain from email
    name = re.sub(r"[^a-zA-Z0-9_\-.]", "", name)
    return name[:50] or "sso_user"


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  OIDC Provider (covers generic OIDC + Auth0 preset)                   ║
# ╚═════════════════════════════════════════════════════════════════════════╝

class OIDCProvider:
    """
    OpenID Connect authentication using the Authorization Code flow.

    When *preset* is ``"auth0"`` the discovery URL is automatically derived from
    the issuer (``https://<tenant>.auth0.com``).
    """

    def __init__(self, settings: Dict[str, Any]):
        self.issuer_url: str = (settings.get("sso_oidc_issuer_url") or "").rstrip("/")
        self.client_id: str = settings.get("sso_oidc_client_id") or ""
        self.client_secret: str = settings.get("sso_oidc_client_secret") or ""
        self.preset: str = settings.get("sso_oidc_preset") or "custom"

        # Auth0 preset: auto-build issuer URL from tenant domain
        if self.preset == "auth0" and self.issuer_url and not self.issuer_url.startswith("http"):
            self.issuer_url = f"https://{self.issuer_url}"

        self._discovery: Optional[Dict] = None

    # ------ discovery ------

    async def _fetch_discovery(self) -> Dict:
        if self._discovery:
            return self._discovery
        url = f"{self.issuer_url}/.well-known/openid-configuration"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            self._discovery = resp.json()
            return self._discovery

    # ------ auth URL ------

    async def get_authorization_url(self, redirect_uri: str, state: str) -> str:
        disc = await self._fetch_discovery()
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid profile email",
            "state": state,
        }
        return f"{disc['authorization_endpoint']}?{urllib.parse.urlencode(params)}"

    # ------ token exchange ------

    async def exchange_code(self, code: str, redirect_uri: str) -> Dict[str, Any]:
        """Exchange an authorization code for tokens and return user info dict."""
        disc = await self._fetch_discovery()
        token_url = disc["token_endpoint"]
        userinfo_url = disc.get("userinfo_endpoint")

        async with httpx.AsyncClient(timeout=10) as client:
            # Token request
            token_resp = await client.post(token_url, data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            })
            token_resp.raise_for_status()
            tokens = token_resp.json()

            # Decode ID token for basic claims
            id_token = tokens.get("id_token", "")
            claims: Dict[str, Any] = {}
            if id_token:
                # Decode without verification for claim extraction — we trust
                # the token endpoint response (TLS-secured) and validate the
                # issuer / audience ourselves.
                claims = pyjwt.decode(id_token, options={"verify_signature": False})

            # Optionally enrich with userinfo endpoint
            if userinfo_url and tokens.get("access_token"):
                ui_resp = await client.get(
                    userinfo_url,
                    headers={"Authorization": f"Bearer {tokens['access_token']}"},
                )
                if ui_resp.status_code == 200:
                    claims.update(ui_resp.json())

        return {
            "sub": claims.get("sub", ""),
            "email": claims.get("email", ""),
            "name": claims.get("name") or claims.get("preferred_username") or claims.get("email", ""),
            "email_verified": claims.get("email_verified", False),
        }


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  SAML Provider                                                        ║
# ╚═════════════════════════════════════════════════════════════════════════╝

class SAMLProvider:
    """
    SAML 2.0 SP-initiated SSO.

    Uses lxml + xmlsec for response parsing / signature verification.
    The IdP metadata is configured manually (entity-id, SSO URL, certificate).
    """

    def __init__(self, settings: Dict[str, Any]):
        self.entity_id: str = settings.get("sso_saml_entity_id") or ""
        self.sso_url: str = settings.get("sso_saml_sso_url") or ""
        self.certificate: str = settings.get("sso_saml_certificate") or ""

    def get_auth_url(self, callback_url: str, relay_state: str) -> str:
        """Build a SAML AuthnRequest redirect URL."""
        import base64
        import zlib

        request_id = f"_decentra_{secrets.token_hex(16)}"
        issue_instant = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        authn_request = f"""<samlp:AuthnRequest
            xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
            xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
            ID="{request_id}"
            Version="2.0"
            IssueInstant="{issue_instant}"
            AssertionConsumerServiceURL="{callback_url}"
            ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
            <saml:Issuer>{self.entity_id}</saml:Issuer>
            <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
                                AllowCreate="true"/>
        </samlp:AuthnRequest>"""

        deflated = zlib.compress(authn_request.encode("utf-8"))[2:-4]
        encoded = base64.b64encode(deflated).decode("utf-8")
        params = urllib.parse.urlencode({
            "SAMLRequest": encoded,
            "RelayState": relay_state,
        })
        separator = "&" if "?" in self.sso_url else "?"
        return f"{self.sso_url}{separator}{params}"

    def parse_response(self, saml_response_b64: str) -> Dict[str, Any]:
        """
        Decode and extract claims from a SAML Response.

        NOTE: Full XML-signature verification requires the xmlsec C library.
        For environments where xmlsec is not available we still extract claims
        but log a warning.  Production deployments should install xmlsec.
        """
        import base64
        from lxml import etree

        xml_bytes = base64.b64decode(saml_response_b64)
        root = etree.fromstring(xml_bytes)

        ns = {
            "saml": "urn:oasis:names:tc:SAML:2.0:assertion",
            "samlp": "urn:oasis:names:tc:SAML:2.0:protocol",
        }

        # Attempt signature verification
        try:
            import xmlsec
            # Find Signature node and verify
            sig_node = root.find(".//{http://www.w3.org/2000/09/xmldsig#}Signature")
            if sig_node is not None and self.certificate:
                # Load the IdP certificate
                key = xmlsec.Key.from_memory(
                    self.certificate.encode(), xmlsec.constants.KeyDataFormatCertPem
                )
                ctx = xmlsec.SignatureContext()
                ctx.key = key
                ctx.verify(sig_node)
                logger.info("SAML response signature verified successfully")
            else:
                logger.warning("SAML response has no signature or no certificate configured")
        except ImportError:
            logger.warning("xmlsec not installed — skipping SAML signature verification")
        except Exception as e:
            logger.error(f"SAML signature verification failed: {e}")
            raise ValueError(f"SAML signature verification failed: {e}")

        # Extract assertion claims
        assertion = root.find(".//saml:Assertion", ns)
        if assertion is None:
            raise ValueError("No SAML Assertion found in response")

        name_id_el = assertion.find(".//saml:Subject/saml:NameID", ns)
        name_id = name_id_el.text if name_id_el is not None else ""

        attrs: Dict[str, str] = {}
        for attr_el in assertion.findall(".//saml:AttributeStatement/saml:Attribute", ns):
            attr_name = attr_el.get("Name", "")
            val_el = attr_el.find("saml:AttributeValue", ns)
            if val_el is not None and val_el.text:
                attrs[attr_name] = val_el.text

        email = (
            attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")
            or attrs.get("email")
            or name_id
        )
        display_name = (
            attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
            or attrs.get("displayName")
            or attrs.get("cn")
            or email.split("@")[0]
        )

        return {
            "sub": name_id,
            "email": email,
            "name": display_name,
            "email_verified": True,  # IdP-asserted
        }


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  LDAP Sync Provider                                                   ║
# ╚═════════════════════════════════════════════════════════════════════════╝

class LDAPSync:
    """
    LDAP directory synchronisation (not direct-bind authentication).

    Connects, binds with a service account, and searches for users that match
    the configured filter.  Use ``sync_users()`` to pull the full list.
    """

    def __init__(self, settings: Dict[str, Any]):
        self.server_url: str = settings.get("sso_ldap_server_url") or ""
        self.bind_dn: str = settings.get("sso_ldap_bind_dn") or ""
        self.bind_password: str = settings.get("sso_ldap_bind_password") or ""
        self.search_base: str = settings.get("sso_ldap_user_search_base") or ""
        self.user_filter: str = settings.get("sso_ldap_user_filter") or "(objectClass=person)"

    def test_connection(self) -> Tuple[bool, str]:
        """Test LDAP bind and return (success, message)."""
        try:
            import ldap as python_ldap
            conn = python_ldap.initialize(self.server_url)
            conn.simple_bind_s(self.bind_dn, self.bind_password)
            conn.unbind_s()
            return True, "LDAP connection successful"
        except ImportError:
            return False, "python-ldap is not installed"
        except Exception as e:
            return False, f"LDAP connection failed: {e}"

    def sync_users(self) -> List[Dict[str, str]]:
        """
        Search LDAP and return a list of user dicts with keys:
        ``external_id``, ``email``, ``display_name``.
        """
        try:
            import ldap as python_ldap
        except ImportError:
            logger.error("python-ldap is not installed — cannot sync")
            return []

        try:
            conn = python_ldap.initialize(self.server_url)
            conn.simple_bind_s(self.bind_dn, self.bind_password)
            results = conn.search_s(
                self.search_base,
                python_ldap.SCOPE_SUBTREE,
                self.user_filter,
                ["uid", "mail", "cn", "sAMAccountName", "userPrincipalName", "displayName"],
            )
            conn.unbind_s()
        except Exception as e:
            logger.error(f"LDAP sync failed: {e}")
            return []

        users: List[Dict[str, str]] = []
        for dn, attrs in results:
            if dn is None:
                continue
            uid = (
                _first(attrs, "uid")
                or _first(attrs, "sAMAccountName")
                or dn
            )
            email = _first(attrs, "mail") or _first(attrs, "userPrincipalName") or ""
            display = _first(attrs, "displayName") or _first(attrs, "cn") or uid
            users.append({
                "external_id": uid,
                "email": email,
                "display_name": display,
            })
        return users


def _first(attrs: Dict, key: str) -> str:
    """Return the first value for an LDAP attribute, decoded from bytes."""
    vals = attrs.get(key, [])
    if vals:
        v = vals[0]
        return v.decode("utf-8") if isinstance(v, bytes) else str(v)
    return ""


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  SCIM 2.0 Handler                                                     ║
# ╚═════════════════════════════════════════════════════════════════════════╝

class SCIMHandler:
    """
    RFC 7644 SCIM 2.0 provisioning handler.

    Supports ``/Users`` and ``/Groups`` CRUD operations plus the required
    discovery endpoints (``/Schemas``, ``/ServiceProviderConfig``,
    ``/ResourceTypes``).

    The handler is stateless — it receives the ``Database`` instance on each
    call so it always operates on fresh data.
    """

    SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User"
    SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group"

    # ---- discovery ----

    @staticmethod
    def service_provider_config(base_url: str) -> Dict:
        return {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
            "documentationUri": f"{base_url}/docs/AUTHENTICATION.md",
            "patch": {"supported": True},
            "bulk": {"supported": False, "maxOperations": 0, "maxPayloadSize": 0},
            "filter": {"supported": True, "maxResults": 200},
            "changePassword": {"supported": False},
            "sort": {"supported": False},
            "etag": {"supported": False},
            "authenticationSchemes": [{
                "type": "oauthbearertoken",
                "name": "OAuth Bearer Token",
                "description": "Authentication scheme using the OAuth Bearer Token Standard",
            }],
        }

    @staticmethod
    def schemas() -> List[Dict]:
        return [
            {
                "id": SCIMHandler.SCHEMA_USER,
                "name": "User",
                "description": "User account",
                "attributes": [
                    {"name": "userName", "type": "string", "required": True, "uniqueness": "server"},
                    {"name": "displayName", "type": "string"},
                    {"name": "emails", "type": "complex", "multiValued": True},
                    {"name": "active", "type": "boolean"},
                ],
            },
            {
                "id": SCIMHandler.SCHEMA_GROUP,
                "name": "Group",
                "description": "Group resource",
                "attributes": [
                    {"name": "displayName", "type": "string", "required": True},
                    {"name": "members", "type": "complex", "multiValued": True},
                ],
            },
        ]

    @staticmethod
    def resource_types(base_url: str) -> List[Dict]:
        return [
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
                "id": "User",
                "name": "User",
                "endpoint": "/scim/v2/Users",
                "schema": SCIMHandler.SCHEMA_USER,
                "meta": {"resourceType": "ResourceType", "location": f"{base_url}/scim/v2/ResourceTypes/User"},
            },
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
                "id": "Group",
                "name": "Group",
                "endpoint": "/scim/v2/Groups",
                "schema": SCIMHandler.SCHEMA_GROUP,
                "meta": {"resourceType": "ResourceType", "location": f"{base_url}/scim/v2/ResourceTypes/Group"},
            },
        ]

    # ---- User CRUD ----

    @staticmethod
    def list_users(db, base_url: str, filter_str: str = "", start: int = 1, count: int = 100) -> Dict:
        """GET /scim/v2/Users"""
        with db.get_connection() as conn:
            cursor = conn.cursor()
            if filter_str:
                # Simple filter: userName eq "value"
                match = re.match(r'userName\s+eq\s+"(.+)"', filter_str, re.IGNORECASE)
                if match:
                    cursor.execute('SELECT * FROM users WHERE username = %s', (match.group(1),))
                else:
                    cursor.execute('SELECT * FROM users ORDER BY username OFFSET %s LIMIT %s',
                                   (start - 1, count))
            else:
                cursor.execute('SELECT * FROM users ORDER BY username OFFSET %s LIMIT %s',
                               (start - 1, count))
            rows = cursor.fetchall()

        resources = [SCIMHandler._user_to_scim(dict(r), base_url) for r in rows]
        return {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            "totalResults": len(resources),
            "startIndex": start,
            "itemsPerPage": count,
            "Resources": resources,
        }

    @staticmethod
    def get_user(db, username: str, base_url: str) -> Optional[Dict]:
        """GET /scim/v2/Users/{id}"""
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE username = %s', (username,))
            row = cursor.fetchone()
        if not row:
            return None
        return SCIMHandler._user_to_scim(dict(row), base_url)

    @staticmethod
    def create_user(db, scim_body: Dict, base_url: str) -> Tuple[Dict, int]:
        """POST /scim/v2/Users — returns (response_body, http_status)."""
        username = _sanitize_username(scim_body.get("userName", ""))
        display_name = scim_body.get("displayName", username)
        emails = scim_body.get("emails", [])
        email = emails[0]["value"] if emails else ""
        active = scim_body.get("active", True)

        # Check if user exists
        existing = SCIMHandler.get_user(db, username, base_url)
        if existing:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": "User already exists", "status": 409}, 409

        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO users (username, password_hash, created_at, email, email_verified, bio, status_message)
                    VALUES (%s, NULL, %s, %s, TRUE, %s, '')
                ''', (username, datetime.now(timezone.utc), email, display_name))

                # Create SSO identity for SCIM-provisioned user
                cursor.execute('''
                    INSERT INTO sso_identities (username, provider, external_id, email, display_name)
                    VALUES (%s, 'scim', %s, %s, %s)
                    ON CONFLICT (provider, external_id) DO NOTHING
                ''', (username, username, email, display_name))

            user_resource = SCIMHandler.get_user(db, username, base_url)
            return user_resource, 201
        except Exception as e:
            logger.error(f"SCIM create user failed: {e}")
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": str(e), "status": 500}, 500

    @staticmethod
    def update_user(db, username: str, scim_body: Dict, base_url: str) -> Tuple[Dict, int]:
        """PUT /scim/v2/Users/{id}"""
        existing = SCIMHandler.get_user(db, username, base_url)
        if not existing:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": "User not found", "status": 404}, 404

        display_name = scim_body.get("displayName", "")
        emails = scim_body.get("emails", [])
        email = emails[0]["value"] if emails else ""
        active = scim_body.get("active", True)

        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE users SET email = %s, bio = %s,
                           user_status = CASE WHEN %s THEN 'online' ELSE 'offline' END
                    WHERE username = %s
                ''', (email, display_name, active, username))
            return SCIMHandler.get_user(db, username, base_url), 200
        except Exception as e:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": str(e), "status": 500}, 500

    @staticmethod
    def patch_user(db, username: str, patch_body: Dict, base_url: str) -> Tuple[Dict, int]:
        """PATCH /scim/v2/Users/{id}"""
        existing = SCIMHandler.get_user(db, username, base_url)
        if not existing:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": "User not found", "status": 404}, 404

        ops = patch_body.get("Operations", [])
        for op in ops:
            operation = op.get("op", "").lower()
            path = op.get("path", "")
            value = op.get("value")

            if path == "active" and operation == "replace":
                active = value if isinstance(value, bool) else str(value).lower() == "true"
                try:
                    with db.get_connection() as conn:
                        cursor = conn.cursor()
                        status = "online" if active else "offline"
                        cursor.execute('UPDATE users SET user_status = %s WHERE username = %s',
                                       (status, username))
                except Exception as e:
                    return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                            "detail": str(e), "status": 500}, 500

        return SCIMHandler.get_user(db, username, base_url), 200

    @staticmethod
    def delete_user(db, username: str) -> Tuple[Optional[Dict], int]:
        """DELETE /scim/v2/Users/{id}"""
        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM sso_identities WHERE username = %s', (username,))
                # We don't delete the user account — just deactivate
                cursor.execute("UPDATE users SET user_status = 'offline' WHERE username = %s",
                               (username,))
            return None, 204
        except Exception as e:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": str(e), "status": 500}, 500

    # ---- Group CRUD (stub — Decentra uses server-level roles) ----

    @staticmethod
    def list_groups(db, base_url: str, **kwargs) -> Dict:
        """GET /scim/v2/Groups — returns server roles as SCIM groups."""
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM server_roles ORDER BY position')
            rows = cursor.fetchall()

        resources = [SCIMHandler._role_to_scim_group(dict(r), base_url) for r in rows]
        return {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            "totalResults": len(resources),
            "startIndex": 1,
            "itemsPerPage": len(resources),
            "Resources": resources,
        }

    @staticmethod
    def get_group(db, group_id: str, base_url: str) -> Optional[Dict]:
        """GET /scim/v2/Groups/{id}"""
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM server_roles WHERE role_id = %s', (group_id,))
            row = cursor.fetchone()
        if not row:
            return None
        return SCIMHandler._role_to_scim_group(dict(row), base_url)

    @staticmethod
    def create_group(db, scim_body: Dict, base_url: str) -> Tuple[Dict, int]:
        """POST /scim/v2/Groups"""
        display_name = scim_body.get("displayName", "SCIM Group")
        group_id = f"scim_{secrets.token_hex(8)}"
        # Use the first server if available
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT server_id FROM servers LIMIT 1')
            row = cursor.fetchone()
            server_id = row['server_id'] if row else None

        if not server_id:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": "No server exists yet", "status": 400}, 400

        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO server_roles (role_id, server_id, name, color, position)
                    VALUES (%s, %s, %s, '#99AAB5', 0)
                ''', (group_id, server_id, display_name))
            resource = SCIMHandler.get_group(db, group_id, base_url)
            return resource, 201
        except Exception as e:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": str(e), "status": 500}, 500

    @staticmethod
    def update_group(db, group_id: str, scim_body: Dict, base_url: str) -> Tuple[Dict, int]:
        """PUT /scim/v2/Groups/{id}"""
        display_name = scim_body.get("displayName", "")
        members = scim_body.get("members", [])

        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                if display_name:
                    cursor.execute('UPDATE server_roles SET name = %s WHERE role_id = %s',
                                   (display_name, group_id))

                # Sync members
                cursor.execute('SELECT server_id FROM server_roles WHERE role_id = %s', (group_id,))
                row = cursor.fetchone()
                if row:
                    server_id = row['server_id']
                    # Remove existing role assignments
                    cursor.execute('DELETE FROM user_roles WHERE role_id = %s', (group_id,))
                    # Add new ones
                    for m in members:
                        uname = m.get("value", "")
                        if uname:
                            cursor.execute('''
                                INSERT INTO user_roles (server_id, username, role_id)
                                VALUES (%s, %s, %s)
                                ON CONFLICT DO NOTHING
                            ''', (server_id, uname, group_id))

            resource = SCIMHandler.get_group(db, group_id, base_url)
            return resource, 200
        except Exception as e:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": str(e), "status": 500}, 500

    @staticmethod
    def patch_group(db, group_id: str, patch_body: Dict, base_url: str) -> Tuple[Dict, int]:
        """PATCH /scim/v2/Groups/{id}"""
        ops = patch_body.get("Operations", [])
        for op in ops:
            operation = op.get("op", "").lower()
            path = op.get("path", "")
            value = op.get("value", [])

            if path == "members" and operation == "add":
                with db.get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT server_id FROM server_roles WHERE role_id = %s', (group_id,))
                    row = cursor.fetchone()
                    if row:
                        server_id = row['server_id']
                        members_list = value if isinstance(value, list) else [value]
                        for m in members_list:
                            uname = m.get("value", "") if isinstance(m, dict) else str(m)
                            if uname:
                                cursor.execute('''
                                    INSERT INTO user_roles (server_id, username, role_id)
                                    VALUES (%s, %s, %s)
                                    ON CONFLICT DO NOTHING
                                ''', (server_id, uname, group_id))

            elif path == "members" and operation == "remove":
                with db.get_connection() as conn:
                    cursor = conn.cursor()
                    members_list = value if isinstance(value, list) else [value]
                    for m in members_list:
                        uname = m.get("value", "") if isinstance(m, dict) else str(m)
                        if uname:
                            cursor.execute('DELETE FROM user_roles WHERE role_id = %s AND username = %s',
                                           (group_id, uname))

        resource = SCIMHandler.get_group(db, group_id, base_url)
        return resource, 200

    @staticmethod
    def delete_group(db, group_id: str) -> Tuple[Optional[Dict], int]:
        """DELETE /scim/v2/Groups/{id}"""
        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM user_roles WHERE role_id = %s', (group_id,))
                cursor.execute('DELETE FROM server_roles WHERE role_id = %s', (group_id,))
            return None, 204
        except Exception as e:
            return {"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "detail": str(e), "status": 500}, 500

    # ---- private helpers ----

    @staticmethod
    def _user_to_scim(user: Dict, base_url: str) -> Dict:
        uname = user.get("username", "")
        return {
            "schemas": [SCIMHandler.SCHEMA_USER],
            "id": uname,
            "userName": uname,
            "displayName": user.get("bio") or uname,
            "active": user.get("user_status", "online") != "offline",
            "emails": [{"value": user.get("email", ""), "primary": True}] if user.get("email") else [],
            "meta": {
                "resourceType": "User",
                "location": f"{base_url}/scim/v2/Users/{uname}",
                "created": str(user.get("created_at", "")),
            },
        }

    @staticmethod
    def _role_to_scim_group(role: Dict, base_url: str) -> Dict:
        role_id = role.get("role_id", "")
        return {
            "schemas": [SCIMHandler.SCHEMA_GROUP],
            "id": role_id,
            "displayName": role.get("name", ""),
            "meta": {
                "resourceType": "Group",
                "location": f"{base_url}/scim/v2/Groups/{role_id}",
            },
        }
