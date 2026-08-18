// src/components/PublishToFaithLibrary/index.jsx
//
// Works for both staff scores and solfa scores — pass `mode` and, for
// solfa, `getSvgElement` (staff reads its SVG straight from the DOM via
// exportScorePdfBlob, same as Print already does).
import { useEffect, useRef, useState } from 'react'
import { X, Eye, EyeOff, UploadCloud, CheckCircle2, ExternalLink } from 'lucide-react'
import { faithlibrary, getFaithLibrarySession, FAITHLIBRARY_UPLOAD_URL } from '../../lib/faithlibrary'
import { exportScorePdfBlob } from '../../utils/exportScore'
import { exportSolfaPdfBlob } from '../../utils/exportSolfa'

// Mirrors FaithLibrary's lib/license.ts LICENSE_OPTIONS exactly — the value
// sent here must match one of these strings or FaithLibrary silently falls
// back to 'unknown'.
const LICENSE_OPTIONS = [
  { value: 'public_domain', label: 'Public Domain', hint: 'No copyright restrictions (e.g. composer died 70+ years ago, or explicitly released)' },
  { value: 'permission',    label: 'Copyrighted — Used with Permission', hint: "You have the rights holder's permission to share this arrangement" },
  { value: 'original',      label: 'Original Composition', hint: 'You wrote or arranged this yourself' },
  { value: 'unknown',       label: 'Unknown / Not Sure', hint: "You're not certain of the copyright status" },
]

export default function PublishToFaithLibrary({ score, mode, getSvgElement, onClose }) {
  const [session, setSession]     = useState(undefined) // undefined = checking, null = not connected
  const [connecting, setConnecting] = useState(false)
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [authError, setAuthError] = useState('')

  const [title, setTitle]         = useState(score?.title || 'Untitled Score')
  const [composer, setComposer]   = useState(score?.composer || '')
  const [description, setDescription] = useState('')
  const [license, setLicense]     = useState('unknown')
  const [isPublic, setIsPublic]   = useState(true)

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [published, setPublished] = useState(null) // { id } on success

  useEffect(() => {
    getFaithLibrarySession().then(setSession)
  }, [])

  // Popup-based connect: the main editor tab (and whatever unsaved score
  // is open in it) never navigates away. See src/main.jsx for the popup
  // side of this handshake.
  const popupRef = useRef(null)
  useEffect(() => {
    const handleMessage = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'faithlibrary-connected') {
        getFaithLibrarySession().then(s => { setSession(s); setConnecting(false) })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const connectGoogle = async () => {
    setAuthError('')
    setConnecting(true)

    const popup = window.open('', 'faithlibrary-connect', 'width=480,height=640')
    if (!popup) {
      setAuthError('Please allow popups for this site, then try again.')
      setConnecting(false)
      return
    }
    popupRef.current = popup

    const { data, error } = await faithlibrary.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, skipBrowserRedirect: true },
    })
    if (error || !data?.url) {
      setAuthError(error?.message || 'Could not start Google sign-in.')
      setConnecting(false)
      popup.close()
      return
    }
    popup.location.href = data.url

    // If the person just closes the popup instead of completing sign-in,
    // stop spinning instead of waiting forever for a message that'll never come.
    const watchClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(watchClosed)
        setConnecting(false)
      }
    }, 500)
  }

  const connectEmail = async (e) => {
    e.preventDefault()
    setAuthError('')
    setConnecting(true)
    try {
      const { data, error } = await faithlibrary.auth.signInWithPassword({ email, password })
      if (error) throw error
      setSession(data.session)
    } catch (err) {
      setAuthError(err.message || 'Could not connect to FaithLibrary.')
    } finally {
      setConnecting(false)
    }
  }

  const publish = async () => {
    setPublishError('')
    setPublishing(true)
    try {
      const fresh = await getFaithLibrarySession()
      if (!fresh) { setSession(null); throw new Error('Your FaithLibrary connection expired — please reconnect.') }

      const pdfBlob = mode === 'solfa'
        ? await exportSolfaPdfBlob(score, getSvgElement?.())
        : await exportScorePdfBlob(score)

      const metadata = {
        title: title.trim() || 'Untitled Score',
        description: description.trim() || null,
        category: 'score',
        tags: [],
        is_public: isPublic,
        license_status: license,
      }

      const formData = new FormData()
      formData.append('file', pdfBlob, `${metadata.title}.pdf`)
      formData.append('metadata', JSON.stringify(metadata))

      const res = await fetch(FAITHLIBRARY_UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fresh.access_token}` },
        body: formData,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `Publish failed (${res.status})`)

      setPublished(body.file)
    } catch (err) {
      setPublishError(err.message || 'Something went wrong publishing this score.')
    } finally {
      setPublishing(false)
    }
  }

  const inp = {
    width: '100%', padding: '9px 12px', fontSize: 13,
    border: '1px solid #d1d5db', borderRadius: 7, outline: 'none',
    background: 'white', color: '#111', boxSizing: 'border-box',
  }
  const label = { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div
        style={{ width: '100%', maxWidth: 440, background: 'white', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
            <UploadCloud size={18} strokeWidth={2} color="#2563eb" />
            Publish to FaithLibrary
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '18px 20px 22px' }}>
          {session === undefined && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Checking your FaithLibrary connection…</p>
          )}

          {session === null && (
            <>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
                Connect your FaithLibrary account once to publish scores directly from FaithScore.
              </p>
              {authError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#dc2626' }}>
                  {authError}
                </div>
              )}
              <button onClick={connectGoogle} disabled={connecting} style={{
                width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 600,
                background: 'white', color: '#374151', border: '1px solid #d1d5db',
                borderRadius: 8, cursor: connecting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14,
              }}>
                Continue with Google
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>or</span>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              </div>
              <form onSubmit={connectEmail} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={label}>FaithLibrary email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inp} />
                </div>
                <div>
                  <label style={label}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPass ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)} required style={{ ...inp, paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowPass(v => !v)} style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex',
                    }}>
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={connecting} style={{
                  width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 700,
                  background: connecting ? '#93c5fd' : '#2563eb', color: 'white',
                  border: 'none', borderRadius: 8, cursor: connecting ? 'not-allowed' : 'pointer',
                }}>
                  {connecting ? 'Connecting…' : 'Connect & Continue'}
                </button>
              </form>
            </>
          )}

          {session && !published && (
            <>
              <div style={{ fontSize: 12, color: '#16a34a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={14} /> Connected to FaithLibrary as {session.user?.email}
              </div>

              {publishError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#dc2626' }}>
                  {publishError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={label}>Title</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={label}>Composer</label>
                  <input value={composer} onChange={e => setComposer(e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={label}>Description (optional)</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                    style={{ ...inp, resize: 'vertical' }} />
                </div>
                <div>
                  <label style={label}>Copyright status</label>
                  <select value={license} onChange={e => setLicense(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                    {LICENSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <p style={{ marginTop: 5, fontSize: 11.5, color: '#9ca3af' }}>
                    {LICENSE_OPTIONS.find(o => o.value === license)?.hint}
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                  <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                  Make this score public on FaithLibrary
                </label>

                <button onClick={publish} disabled={publishing} style={{
                  width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 700, marginTop: 4,
                  background: publishing ? '#93c5fd' : '#2563eb', color: 'white',
                  border: 'none', borderRadius: 8, cursor: publishing ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  {publishing ? 'Publishing…' : <><UploadCloud size={15} /> Publish to FaithLibrary</>}
                </button>
              </div>
            </>
          )}

          {published && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <CheckCircle2 size={36} color="#16a34a" style={{ marginBottom: 10 }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4 }}>Published!</p>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 18 }}>Your score is now live on FaithLibrary.</p>
              <a href={`https://faith-library.vercel.app/view/${published.id}`} target="_blank" rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                  color: '#2563eb', textDecoration: 'none',
                }}>
                View on FaithLibrary <ExternalLink size={13} />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
