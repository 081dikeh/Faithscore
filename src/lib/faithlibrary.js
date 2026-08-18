// src/lib/faithlibrary.js
//
// FaithScore and FaithLibrary are TWO SEPARATE Supabase projects, so a
// FaithScore login session cannot be used to authenticate against
// FaithLibrary. This client is a second, independent connection — a user
// has to sign into it explicitly (see PublishToFaithLibrary) before Publish
// will work, same as "connecting" any third-party account.
import { createClient } from '@supabase/supabase-js'

// TODO: fill these in with FaithLibrary's actual Supabase project URL and
// anon key (Project Settings → API in the FaithLibrary Supabase project —
// the same values already sitting in FaithLibrary's own lib/supabase/client.ts).
// The anon key is safe to ship client-side; it's not a secret.
const FAITHLIBRARY_URL  = 'https://uyxbdyvnirxcunlfteje.supabase.co'
const FAITHLIBRARY_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5eGJkeXZuaXJ4Y3VubGZ0ZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDg3NjYsImV4cCI6MjA5MjYyNDc2Nn0.zjFL1-I9ppfkxCv2BhzVJp1gkk2JfMxVRbah2YSeVJE'

export const FAITHLIBRARY_UPLOAD_URL = 'https://faith-library.vercel.app/api/external-upload'

// A distinct storageKey keeps this session in its own localStorage slot,
// completely separate from FaithScore's own session (src/lib/supabase.js).
// Without this they'd collide (both default to the same key) and each
// sign-in would silently stomp the other.
export const faithlibrary = createClient(FAITHLIBRARY_URL, FAITHLIBRARY_ANON, {
  auth: {
    storageKey: 'faithlibrary-auth',
    persistSession: true,
    autoRefreshToken: true,
  },
})

// Returns a valid (non-expired) FaithLibrary session, refreshing it first if
// it's expired or about to expire, or null if the user has never connected
// their FaithLibrary account (or the refresh token has been revoked).
export async function getFaithLibrarySession() {
  const { data: { session } } = await faithlibrary.auth.getSession()
  if (!session) return null

  const expiresAtMs = (session.expires_at || 0) * 1000
  if (Date.now() > expiresAtMs - 60_000) {
    const { data, error } = await faithlibrary.auth.refreshSession()
    if (error) return null
    return data.session
  }
  return session
}

export async function disconnectFaithLibrary() {
  await faithlibrary.auth.signOut()
}
