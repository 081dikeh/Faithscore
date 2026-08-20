import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// If this window was opened specifically to complete the FaithLibrary
// OAuth connect flow (see connectGoogle in PublishToFaithLibrary), it
// exists only to finish that handshake and close itself.
//
// We detect that via a URL marker (?faithlibrary_popup=1), NOT
// window.opener. Google's own sign-in page sends a strict
// Cross-Origin-Opener-Policy header, which severs window.opener the
// moment this window navigates to accounts.google.com — permanently,
// even after it navigates back here. On localhost Chrome is looser about
// this, which is why this used to appear to work in dev and fail once
// deployed. The URL marker survives navigation regardless, and
// BroadcastChannel (below) doesn't need a window reference at all, so
// neither depends on window.opener still being intact.
const params = new URLSearchParams(window.location.search)
const isFaithLibraryPopup = params.has('faithlibrary_popup')
// 'google' the first time this window loads (opened directly here by
// connectGoogle) — it still needs to kick off the OAuth redirect itself.
// Absent on the second load, after Google redirects back here — at that
// point it just needs to wait for the session and notify the opener.
const pending = params.get('pending')

if (isFaithLibraryPopup) {
  document.getElementById('root').innerHTML =
    '<div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;color:#374151;font-size:14px">Connecting to FaithLibrary…</div>'

  import('./lib/faithlibrary').then(async ({ faithlibrary, getFaithLibrarySession }) => {
    if (pending === 'google') {
      // Kicking off signInWithOAuth and navigating to Google from *inside*
      // this window (a window navigating itself) rather than from the
      // opener (the opener reaching into this window from outside) is the
      // actual fix here — COOP only restricts the latter. See the comment
      // in connectGoogle for the full story.
      const { data, error } = await faithlibrary.auth.signInWithOAuth({
        provider: 'google',
        // No pending param this time — when Google redirects back here,
        // we want the branch below (wait for session, notify opener), not
        // another round of kicking off sign-in.
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}?faithlibrary_popup=1`,
          skipBrowserRedirect: true,
        },
      })
      if (error || !data?.url) {
        document.getElementById('root').innerHTML =
          `<div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;color:#dc2626;font-size:14px">Could not start Google sign-in${error?.message ? `: ${error.message}` : ''}. You can close this window and try again.</div>`
        return
      }
      // Self-navigation — always allowed under any COOP policy, on any
      // origin. This is the one thing the old code got backwards: it had
      // the *opener* set popup.location.href to this same URL instead.
      window.location.href = data.url
      return
    }

    const channel = new BroadcastChannel('faithlibrary-connect')

    const tryNotify = async (attemptsLeft = 20) => {
      const session = await getFaithLibrarySession()
      if (session) {
        channel.postMessage({ type: 'faithlibrary-connected' })
        channel.close()
        // A script-opened window can always close itself — this does NOT
        // require window.opener and isn't affected by COOP.
        window.close()
      } else if (attemptsLeft > 0) {
        setTimeout(() => tryNotify(attemptsLeft - 1), 300)
      } else {
        document.getElementById('root').innerHTML =
          '<div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;color:#dc2626;font-size:14px">Could not complete sign-in. You can close this window and try again.</div>'
      }
    }
    tryNotify()
  })
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}