/**
 * KeyStore.ts
 *
 * IndexedDB-backed storage for the E2EE key material.
 *
 * Stores:
 *  - identity   : the user's long-term ECDH identity key pair
 *  - prekeys    : signed prekeys (spk:<id>) and one-time prekeys (opk:<id>)
 *  - sessions   : symmetric ratchet state per peer username
 */

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME    = 'decentra-e2ee'
const DB_VERSION = 1

// ────────────────────────────────────────────────────────────────────────────
// Types stored in IndexedDB (raw bytes; CryptoKeys are NOT serialisable)
// ────────────────────────────────────────────────────────────────────────────

/** The user's own identity store record. */
export interface StoredIdentity {
  id: 'self'
  registrationId: number
  /** SPKI-encoded public key bytes. */
  publicKeyBytes: ArrayBuffer
  /**
   * Raw PKCS8 private key bytes stored **only** on this device (trusted device
   * model, same as Signal/WhatsApp).  Never sent to the server in plaintext.
   */
  privateKeyBytes: ArrayBuffer
  /**
   * A passphrase-wrapped copy of the private key for server-side backup /
   * restore on a new device.  Passphrase is never sent to the server.
   */
  encryptedPrivateKey: ArrayBuffer
  encryptedPrivateKeyIv: ArrayBuffer
  /** The PBKDF2 salt used to derive the wrapping key. */
  pbkdf2Salt: ArrayBuffer
  /** Uploaded signed prekey ID (for prekey rotation tracking). */
  currentSignedPrekeyId: number
}

/** A signed or one-time prekey stored locally (full key pair). */
export interface StoredPrekey {
  /** 'spk:<id>' or 'opk:<id>' */
  id: string
  publicKeyBytes: ArrayBuffer
  privateKeyBytes: ArrayBuffer   // PKCS8
}

/** Symmetric ratchet session state per peer. */
export interface StoredSession {
  /** The other user's username. */
  peerId: string
  /** Whether the initial X3DH has been completed from OUR side. */
  established: boolean
  /** Root key bytes — used to ratchet new chain keys in future DH ratchet. */
  rootKeyBytes: ArrayBuffer
  /** Send chain key — ratcheted forward on each sent message. */
  sendChainKey: ArrayBuffer
  /** Receive chain key — ratcheted forward on each received message. */
  recvChainKey: ArrayBuffer
  sendCounter: number
  recvCounter: number
  /** Peer's identity public key bytes (SPKI) — for message authentication. */
  peerIdentityKeyBytes: ArrayBuffer
}

// ────────────────────────────────────────────────────────────────────────────
// Database open helper
// ────────────────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db: IDBPDatabase) {
        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('prekeys')) {
          db.createObjectStore('prekeys', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'peerId' })
        }
      },
    })
  }
  return dbPromise as Promise<IDBPDatabase>
}

// ────────────────────────────────────────────────────────────────────────────
// Identity
// ────────────────────────────────────────────────────────────────────────────

export async function loadIdentity(): Promise<StoredIdentity | undefined> {
  const db = await getDB()
  return db.get('identity', 'self')
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  const db = await getDB()
  await db.put('identity', identity)
}

// ────────────────────────────────────────────────────────────────────────────
// Prekeys
// ────────────────────────────────────────────────────────────────────────────

export async function loadPrekey(id: string): Promise<StoredPrekey | undefined> {
  const db = await getDB()
  return db.get('prekeys', id)
}

export async function savePrekey(prekey: StoredPrekey): Promise<void> {
  const db = await getDB()
  await db.put('prekeys', prekey)
}

export async function deletePrekey(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('prekeys', id)
}

export async function listPrekeyIds(prefix: 'spk' | 'opk'): Promise<string[]> {
  const db = await getDB()
  const allKeys = await db.getAllKeys('prekeys') as string[]
  return allKeys.filter(k => k.startsWith(prefix + ':'))
}

// ────────────────────────────────────────────────────────────────────────────
// Sessions
// ────────────────────────────────────────────────────────────────────────────

export async function loadSession(peerId: string): Promise<StoredSession | undefined> {
  const db = await getDB()
  return db.get('sessions', peerId)
}

export async function saveSession(session: StoredSession): Promise<void> {
  const db = await getDB()
  await db.put('sessions', session)
}

export async function deleteSession(peerId: string): Promise<void> {
  const db = await getDB()
  await db.delete('sessions', peerId)
}

// ────────────────────────────────────────────────────────────────────────────
// Entire store wipe (e.g. logout)
// ────────────────────────────────────────────────────────────────────────────

export async function clearAllE2EEData(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['identity', 'prekeys', 'sessions'], 'readwrite')
  await Promise.all([
    tx.objectStore('identity').clear(),
    tx.objectStore('prekeys').clear(),
    tx.objectStore('sessions').clear(),
  ])
  await tx.done
}
