import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// If this window was opened via window.open() (see connectGoogle in
// PublishToFaithLibrary), it exists only to complete the FaithLibrary
// OAuth handshake — the actual FaithLibrary Supabase client (imported
// below) picks the session up from the URL automatically on load and
// writes it to localStorage, which the opener tab shares. We just wait
// for that, tell the opener, and close — the real editor never mounts
// here, and more importantly never *reloads* in the opener tab either.
if (window.opener && window.opener !== window) {
  document.getElementById('root').innerHTML =
    '<div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;color:#374151;font-size:14px">Connecting to FaithLibrary…</div>'

  import('./lib/faithlibrary').then(({ getFaithLibrarySession }) => {
    const tryNotify = async (attemptsLeft = 20) => {
      const session = await getFaithLibrarySession()
      if (session) {
        window.opener.postMessage({ type: 'faithlibrary-connected' }, window.location.origin)
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
