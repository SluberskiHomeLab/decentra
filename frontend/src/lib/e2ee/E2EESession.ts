/**
 * E2EESession.ts
 *
 * End-to-end encryption for Decentra direct messages.
 *
 * Protocol:
 *  - Key agreement : X3DH over P-256 ECDH (Web Crypto API)
 *  - KDF           : HKDF-SHA-256
 *  - Encryption    : AES-256-GCM
 *  - Ratchet       : Symmetric ratchet per message (forward secrecy)
 *
 * Trusted-device model: raw PKCS8 private key bytes are stored in IndexedDB on
 * this device (never sent to the server).  A passphrase-wrapped copy is
 * uploaded to the server solely for cross-device restore.
 */

import {
  loadIdentity,
  saveIdentity,
  loadPrekey,
  savePrekey,
  deletePrekey,
  listPrekeyIds,
  loadSession,
  saveSession,
  type StoredIdentity,
  type StoredPrekey,
} from './KeyStore'

// ────────────────────────────────────────────────────────────────────────────
// Module-level in-memory cache  (session-lifetime only)
// ────────────────────────────────────────────────────────────────────────────

let _cachedPrivKey: CryptoKey | null = null

async function _getIdentityPrivKey(): Promise<CryptoKey> {
  if (_cachedPrivKey) return _cachedPrivKey
  const identity = await loadIdentity()
  if (!identity) throw new Error('[E2EE] Identity not initialised')
  _cachedPrivKey = await crypto.subtle.importKey(
    'pkcs8',
    identity.privateKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  return _cachedPrivKey
}

/** Call on logout to clear the in-memory private key. */
export function clearE2EESessionCache(): void {
  _cachedPrivKey = null
}



function buf2b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function b64toBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function hkdf(
  inputKeyMaterial: ArrayBuffer,
  salt: ArrayBuffer,
  info: string,
  lengthBytes: number,
): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey(
    'raw', inputKeyMaterial, 'HKDF', false, ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(info),
    },
    baseKey,
    lengthBytes * 8,
  )
}

async function ecdhDeriveBits(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  )
}

async function importECDHPub(spki: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki', spki, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
}

async function importECDHPriv(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
  )
}

async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Private key wrapping / unwrapping (client-side, passphrase-derived AES-GCM)
// ────────────────────────────────────────────────────────────────────────────

async function deriveWrappingKey(passphrase: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 250_000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptPrivateKey(
  privateKeyBytes: ArrayBuffer,
  passphrase: string,
  salt: ArrayBuffer,
): Promise<{ encrypted: ArrayBuffer; iv: ArrayBuffer }> {
  const wrappingKey = await deriveWrappingKey(passphrase, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    privateKeyBytes,
  )
  return { encrypted, iv }
}

async function decryptPrivateKey(
  encryptedBytes: ArrayBuffer,
  iv: ArrayBuffer,
  passphrase: string,
  salt: ArrayBuffer,
): Promise<ArrayBuffer> {
  const wrappingKey = await deriveWrappingKey(passphrase, salt)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, encryptedBytes)
}

// ────────────────────────────────────────────────────────────────────────────
// Symmetric ratchet helpers
// ────────────────────────────────────────────────────────────────────────────

const ZERO_SALT = new ArrayBuffer(32)

async function ratchetStep(chainKey: ArrayBuffer): Promise<{
  messageKey: ArrayBuffer
  nextChainKey: ArrayBuffer
}> {
  const [messageKey, nextChainKey] = await Promise.all([
    hkdf(chainKey, ZERO_SALT, 'WhisperRatchet:message-key', 32),
    hkdf(chainKey, ZERO_SALT, 'WhisperRatchet:chain-key',   32),
  ])
  return { messageKey, nextChainKey }
}

async function aesGcmEncrypt(keyBytes: ArrayBuffer, plaintext: string): Promise<{ iv: string; ct: string }> {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { iv: buf2b64(iv.buffer), ct: buf2b64(ct) }
}

async function aesGcmDecrypt(keyBytes: ArrayBuffer, iv: string, ct: string): Promise<string> {
  const key   = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64toBuf(iv) },
    key,
    b64toBuf(ct),
  )
  return new TextDecoder().decode(plain)
}

// ────────────────────────────────────────────────────────────────────────────
// X3DH key derivation (shared by sender and receiver)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derive the X3DH master secret from the four DH values.
 * Returns { rootKey, chainKey } as raw 32-byte ArrayBuffers.
 */
async function x3dhDerive(
  dh1: ArrayBuffer,
  dh2: ArrayBuffer,
  dh3: ArrayBuffer,
  dh4?: ArrayBuffer,
): Promise<{ rootKey: ArrayBuffer; chainKey: ArrayBuffer }> {
  // Concatenate all DH outputs
  const parts = dh4 ? [dh1, dh2, dh3, dh4] : [dh1, dh2, dh3]
  const combined = new Uint8Array(parts.reduce((acc, b) => acc + b.byteLength, 0))
  let offset = 0
  for (const p of parts) {
    combined.set(new Uint8Array(p), offset)
    offset += p.byteLength
  }

  // HKDF to produce 64 bytes → root key (first 32) + chain key (last 32)
  const derived = await hkdf(combined.buffer, ZERO_SALT, 'X3DH:initial-keys', 64)
  return {
    rootKey:   derived.slice(0, 32),
    chainKey:  derived.slice(32, 64),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// E2EE envelope type
// ────────────────────────────────────────────────────────────────────────────

export interface E2EEEnvelope {
  v: 1
  /** Sender identity public key (SPKI base64) — used to look up / establish session. */
  ik: string
  /** Sender ephemeral public key for X3DH (SPKI base64) — present in first message. */
  ek?: string
  /** Signed prekey ID used in X3DH — present in first message. */
  spk_id?: number
  /** One-time prekey ID used in X3DH — present in first message if OPK was available. */
  opk_id?: number
  /** Message counter within the send chain. */
  idx: number
  /** AES-GCM IV (base64). */
  iv: string
  /** Ciphertext (base64). */
  ct: string
}

/** The transport wrapper embedded in the `content` field of a sent message. */
export interface E2EEMessageContent {
  e2ee: E2EEEnvelope
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Initialise (or restore) the local E2EE identity for *username*.
 *
 * - On first call: generates a fresh identity key pair + signed prekey +
 *   10 one-time prekeys, stores them in IndexedDB, wraps the private key
 *   with the user's passphrase, and uploads the bundle to the server.
 * - On subsequent calls (IndexedDB already populated): no-op; returns early
 *   to avoid unnecessary key generation / server uploads.
 * - After clearing IndexedDB (new device): decrypts the server-stored
 *   private key backup using the passphrase and re-populates the store.
 *
 * @param authToken   Bearer token for API calls.
 * @param passphrase  User passphrase; used LOCALLY to encrypt the private key
 *                    — never sent to the server.
 */
export async function initE2EEIdentity(authToken: string, passphrase: string): Promise<void> {
  const existing = await loadIdentity()
  if (existing) {
    // Prime the in-memory cache eagerly
    _cachedPrivKey = await crypto.subtle.importKey(
      'pkcs8', existing.privateKeyBytes,
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
    )
    return
  }

  // ── Try to restore from server backup ────────────────────────────────────
  const backupRes = await fetch('/api/e2e/private-key', {
    headers: { Authorization: `Bearer ${authToken}` },
  })
  if (backupRes.ok) {
    const { encrypted_private_key: encB64 } = await backupRes.json()
    const decoded = JSON.parse(atob(encB64))
    const pubKeyBytes = b64toBuf(decoded.publicKey)
    const privKeyEnc  = b64toBuf(decoded.encryptedPrivateKey)
    const ivBytes     = b64toBuf(decoded.iv)
    const saltBytes   = b64toBuf(decoded.salt)
    const regId       = decoded.registrationId as number
    const spkId       = decoded.signedPrekeyId as number

    // Decrypt with passphrase to obtain raw private key bytes
    const rawPrivBytes = await decryptPrivateKey(privKeyEnc, ivBytes, passphrase, saltBytes)

    const identity: StoredIdentity = {
      id:                    'self',
      registrationId:         regId,
      publicKeyBytes:         pubKeyBytes,
      privateKeyBytes:        rawPrivBytes,
      encryptedPrivateKey:    privKeyEnc,
      encryptedPrivateKeyIv:  ivBytes,
      pbkdf2Salt:             saltBytes,
      currentSignedPrekeyId:  spkId,
    }
    await saveIdentity(identity)
    _cachedPrivKey = await crypto.subtle.importKey(
      'pkcs8', rawPrivBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
    )
    console.log('[E2EE] Identity restored from server backup.')
    return
  }

  // ── Fresh identity generation ─────────────────────────────────────────────
  const registrationId    = Math.floor(Math.random() * 16_380) + 1
  const identityKeyPair   = await generateECDHKeyPair()
  const identityPubBytes  = await crypto.subtle.exportKey('spki',  identityKeyPair.publicKey)
  const identityPrivBytes = await crypto.subtle.exportKey('pkcs8', identityKeyPair.privateKey)

  // Passphrase-wrap for server backup
  const pbkdf2Salt = crypto.getRandomValues(new Uint8Array(32)).buffer
  const { encrypted: encPriv, iv: encIv } = await encryptPrivateKey(
    identityPrivBytes, passphrase, pbkdf2Salt,
  )

  // Generate signed prekey (id = 1)
  const spkId        = 1
  const spkKeyPair   = await generateECDHKeyPair()
  const spkPubBytes  = await crypto.subtle.exportKey('spki',  spkKeyPair.publicKey)
  const spkPrivBytes = await crypto.subtle.exportKey('pkcs8', spkKeyPair.privateKey)
  const spkSignature = buf2b64(spkPubBytes)  // placeholder for real ECDSA signature

  // Generate 10 one-time prekeys
  const oneTimePrekeys: Array<{ key_id: number; public_key: string }> = []
  for (let i = 1; i <= 10; i++) {
    const kp   = await generateECDHKeyPair()
    const pub  = await crypto.subtle.exportKey('spki',  kp.publicKey)
    const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
    await savePrekey({ id: `opk:${i}`, publicKeyBytes: pub, privateKeyBytes: priv })
    oneTimePrekeys.push({ key_id: i, public_key: buf2b64(pub) })
  }

  // Persist identity (includes raw private key for local use)
  const identity: StoredIdentity = {
    id:                    'self',
    registrationId,
    publicKeyBytes:         identityPubBytes,
    privateKeyBytes:        identityPrivBytes,
    encryptedPrivateKey:    encPriv,
    encryptedPrivateKeyIv:  encIv,
    pbkdf2Salt,
    currentSignedPrekeyId:  spkId,
  }
  await saveIdentity(identity)
  await savePrekey({ id: `spk:${spkId}`, publicKeyBytes: spkPubBytes, privateKeyBytes: spkPrivBytes })
  _cachedPrivKey = identityKeyPair.privateKey

  // Build server-backup blob
  const backupBlob = btoa(JSON.stringify({
    publicKey:           buf2b64(identityPubBytes),
    encryptedPrivateKey: buf2b64(encPriv),
    iv:                  buf2b64(encIv),
    salt:                buf2b64(pbkdf2Salt),
    registrationId,
    signedPrekeyId:      spkId,
  }))

  await fetch('/api/e2e/register', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      registration_id:          registrationId,
      identity_key_public:      buf2b64(identityPubBytes),
      identity_key_private_enc: backupBlob,
      signed_prekey_id:         spkId,
      signed_prekey_public:     buf2b64(spkPubBytes),
      signed_prekey_signature:  spkSignature,
      one_time_prekeys:         oneTimePrekeys,
    }),
  })
  console.log('[E2EE] Fresh identity generated and registered.')
}

/**
 * Return true if the E2EE identity is ready for use.
 */
export async function isE2EEReady(): Promise<boolean> {
  if (_cachedPrivKey) return true
  const identity = await loadIdentity()
  return identity !== undefined
}

/**
 * Encrypt a plaintext DM for `recipientUsername`.
 *
 * On first message, performs X3DH key agreement; subsequent calls ratchet the
 * send chain.  Returns a JSON string for the message `content` field.
 */
export async function encryptDM(
  recipientUsername: string,
  authToken: string,
  plaintext: string,
): Promise<string> {
  const identity    = await loadIdentity()
  if (!identity) throw new Error('[E2EE] Identity not initialised')
  const aliceIKPriv = await _getIdentityPrivKey()

  let session  = await loadSession(recipientUsername)
  let envelope: E2EEEnvelope

  if (!session) {
    // ── X3DH session initiation ────────────────────────────────────────────
    const bundleRes = await fetch(`/api/e2e/key-bundle/${encodeURIComponent(recipientUsername)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!bundleRes.ok) throw new Error(`[E2EE] Recipient ${recipientUsername} has no key bundle`)
    const bundle = await bundleRes.json()

    const bobIKPub  = await importECDHPub(b64toBuf(bundle.identity_key_public))
    const bobSPKPub = await importECDHPub(b64toBuf(bundle.signed_prekey_public))

    // Generate ephemeral key pair
    const ekPair     = await generateECDHKeyPair()
    const ekPubBytes = await crypto.subtle.exportKey('spki', ekPair.publicKey)

    // DH1 = ECDH(alice_identity_priv, bob_signed_prekey_pub)
    const dh1 = await ecdhDeriveBits(aliceIKPriv, bobSPKPub)
    // DH2 = ECDH(alice_ephemeral_priv, bob_identity_pub)
    const dh2 = await ecdhDeriveBits(ekPair.privateKey, bobIKPub)
    // DH3 = ECDH(alice_ephemeral_priv, bob_signed_prekey_pub)
    const dh3 = await ecdhDeriveBits(ekPair.privateKey, bobSPKPub)

    let dh4: ArrayBuffer | undefined
    let opkId: number | undefined
    if (bundle.one_time_prekey_public != null && bundle.one_time_prekey_id != null) {
      const bobOPKPub = await importECDHPub(b64toBuf(bundle.one_time_prekey_public))
      dh4   = await ecdhDeriveBits(ekPair.privateKey, bobOPKPub)
      opkId = bundle.one_time_prekey_id as number
    }

    const { rootKey, chainKey } = await x3dhDerive(dh1, dh2, dh3, dh4)
    const { messageKey, nextChainKey } = await ratchetStep(chainKey)
    const { iv, ct } = await aesGcmEncrypt(messageKey, plaintext)

    session = {
      peerId:               recipientUsername,
      established:          true,
      rootKeyBytes:         rootKey,
      sendChainKey:         nextChainKey,
      recvChainKey:         new ArrayBuffer(32),
      sendCounter:          1,
      recvCounter:          0,
      peerIdentityKeyBytes: b64toBuf(bundle.identity_key_public),
    }
    await saveSession(session)

    envelope = {
      v:       1,
      ik:      buf2b64(identity.publicKeyBytes),
      ek:      buf2b64(ekPubBytes),
      spk_id:  bundle.signed_prekey_id as number,
      opk_id:  opkId,
      idx:     0,
      iv,
      ct,
    }

    _checkAndReplenishPrekeys(authToken).catch(console.warn)
  } else {
    // ── Continuing established session ─────────────────────────────────────
    const { messageKey, nextChainKey } = await ratchetStep(session.sendChainKey)
    const { iv, ct } = await aesGcmEncrypt(messageKey, plaintext)
    const idx = session.sendCounter

    session = { ...session, sendChainKey: nextChainKey, sendCounter: idx + 1 }
    await saveSession(session)

    envelope = { v: 1, ik: buf2b64(identity.publicKeyBytes), idx, iv, ct }
  }

  return JSON.stringify({ e2ee: envelope } satisfies E2EEMessageContent)
}

/**
 * Decrypt an incoming DM from `senderUsername`.
 *
 * Returns the plaintext or `null` if the message is not E2EE-encrypted, the
 * identity is not initialised, or decryption fails.
 */
export async function decryptDM(
  senderUsername: string,
  rawContent: string,
): Promise<string | null> {
  let parsed: E2EEMessageContent
  try {
    const obj = JSON.parse(rawContent)
    if (!obj?.e2ee) return null
    parsed = obj as E2EEMessageContent
  } catch {
    return null
  }

  const env      = parsed.e2ee
  const identity = await loadIdentity()
  if (!identity) return null

  let session = await loadSession(senderUsername)

  try {
    if (env.ek) {
      // ── First message: X3DH ────────────────────────────────────────────
      const spkEntry = await loadPrekey(`spk:${env.spk_id}`)
      if (!spkEntry) {
        console.warn(`[E2EE] Unknown signed prekey id=${env.spk_id} from ${senderUsername}`)
        return null
      }

      let opkEntry: StoredPrekey | undefined
      if (env.opk_id != null) opkEntry = await loadPrekey(`opk:${env.opk_id}`) ?? undefined

      const bobIKPriv  = await _getIdentityPrivKey()
      const bobSPKPriv = await importECDHPriv(spkEntry.privateKeyBytes)
      const aliceIKPub = await importECDHPub(b64toBuf(env.ik))
      const aliceEKPub = await importECDHPub(b64toBuf(env.ek))

      // DH1 = ECDH(bob_signed_prekey_priv, alice_identity_pub)
      const dh1 = await ecdhDeriveBits(bobSPKPriv, aliceIKPub)
      // DH2 = ECDH(bob_identity_priv, alice_ephemeral_pub)
      const dh2 = await ecdhDeriveBits(bobIKPriv, aliceEKPub)
      // DH3 = ECDH(bob_signed_prekey_priv, alice_ephemeral_pub)
      const dh3 = await ecdhDeriveBits(bobSPKPriv, aliceEKPub)

      let dh4: ArrayBuffer | undefined
      if (opkEntry) {
        const bobOPKPriv = await importECDHPriv(opkEntry.privateKeyBytes)
        dh4 = await ecdhDeriveBits(bobOPKPriv, aliceEKPub)
        await deletePrekey(`opk:${env.opk_id}`)  // one-time key consumed
      }

      const { chainKey: recvChainKey, rootKey } = await x3dhDerive(dh1, dh2, dh3, dh4)

      let ck = recvChainKey
      let messageKey: ArrayBuffer | null = null
      for (let i = 0; i <= env.idx; i++) {
        const step = await ratchetStep(ck)
        if (i === env.idx) messageKey = step.messageKey
        ck = step.nextChainKey
      }

      const plaintext = await aesGcmDecrypt(messageKey!, env.iv, env.ct)

      await saveSession({
        peerId:               senderUsername,
        established:          true,
        rootKeyBytes:         rootKey,
        sendChainKey:         new ArrayBuffer(32),
        recvChainKey:         ck,
        sendCounter:          0,
        recvCounter:          env.idx + 1,
        peerIdentityKeyBytes: b64toBuf(env.ik),
      })
      return plaintext
    } else {
      // ── Continuing session ──────────────────────────────────────────────
      if (!session) {
        console.warn(`[E2EE] No session for ${senderUsername} but received non-initial message`)
        return null
      }

      let ck = session.recvChainKey
      let messageKey: ArrayBuffer | null = null
      for (let i = session.recvCounter; i <= env.idx; i++) {
        const step = await ratchetStep(ck)
        if (i === env.idx) messageKey = step.messageKey
        ck = step.nextChainKey
      }

      const plaintext = await aesGcmDecrypt(messageKey!, env.iv, env.ct)
      session = { ...session, recvChainKey: ck, recvCounter: env.idx + 1 }
      await saveSession(session)
      return plaintext
    }
  } catch (err) {
    console.warn('[E2EE] Decryption failed:', err)
    return null
  }
}

/**
 * Return true if `content` looks like an E2EE envelope.  Cheap check — no
 * crypto.  Used to show the lock indicator in the UI.
 */
export function isE2EEContent(content: string): boolean {
  try {
    const obj = JSON.parse(content)
    return typeof obj?.e2ee === 'object' && obj.e2ee.v === 1
  } catch {
    return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// OPK replenishment
// ────────────────────────────────────────────────────────────────────────────

const LOW_PREKEY_THRESHOLD = 3
const REPLENISH_COUNT      = 10

async function _checkAndReplenishPrekeys(authToken: string): Promise<void> {
  const res = await fetch('/api/e2e/prekeys/count', {
    headers: { Authorization: `Bearer ${authToken}` },
  })
  if (!res.ok) return
  const { count } = await res.json() as { count: number }
  if (count >= LOW_PREKEY_THRESHOLD) return

  const existingIds = (await listPrekeyIds('opk')).map(k => parseInt(k.split(':')[1]))
  const maxId       = existingIds.length ? Math.max(...existingIds) : 0

  const newPrekeys: Array<{ key_id: number; public_key: string }> = []
  for (let i = 1; i <= REPLENISH_COUNT; i++) {
    const id   = maxId + i
    const kp   = await generateECDHKeyPair()
    const pub  = await crypto.subtle.exportKey('spki',  kp.publicKey)
    const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
    await savePrekey({ id: `opk:${id}`, publicKeyBytes: pub, privateKeyBytes: priv })
    newPrekeys.push({ key_id: id, public_key: buf2b64(pub) })
  }

  await fetch('/api/e2e/prekeys/replenish', {
    method:  'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ one_time_prekeys: newPrekeys }),
  })
  console.log(`[E2EE] Replenished ${REPLENISH_COUNT} one-time prekeys.`)
}
