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
const isFaithLibraryPopup = new URLSearchParams(window.location.search).has('faithlibrary_popup')

if (isFaithLibraryPopup) {
  document.getElementById('root').innerHTML =
    '<div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;color:#374151;font-size:14px">Connecting to FaithLibrary…</div>'

  import('./lib/faithlibrary').then(({ getFaithLibrarySession }) => {
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