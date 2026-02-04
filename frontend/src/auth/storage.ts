const TOKEN_KEY = 'token'
const USERNAME_KEY = 'username'

export type StoredAuth = {
  token: string | null
  username: string | null
}

export function getStoredAuth(): StoredAuth {
  const token = localStorage.getItem(TOKEN_KEY)
  const username = localStorage.getItem(USERNAME_KEY)
  return { token, username }
}

export function setStoredAuth(next: { token: string; username: string }) {
  localStorage.setItem(TOKEN_KEY, next.token)
  localStorage.setItem(USERNAME_KEY, next.username)

  // Legacy pages use sessionStorage; keep in sync during migration.
  sessionStorage.setItem(TOKEN_KEY, next.token)
  sessionStorage.setItem(USERNAME_KEY, next.username)
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)

  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USERNAME_KEY)
}
