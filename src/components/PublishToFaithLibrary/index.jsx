// src/components/PublishToFaithLibrary/index.jsx
//
// Works for both staff scores and solfa scores — pass `mode` and, for
// solfa, `getSvgElement` (staff reads its SVG straight from the DOM via
// exportScorePdfBlob, same as Print already does).
import { useEffect, useRef, useState } from 'react'
import { X, Eye, EyeOff, UploadCloud, CheckCircle2, ExternalLink } from 'lucide-react'
import { faithlibrary, getFaithLibrarySession } from '../../lib/faithlibrary'
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
  //
  // This listens via BroadcastChannel, not window.postMessage/window.opener
  // — Google's sign-in page sends a strict Cross-Origin-Opener-Policy
  // header that severs window.opener the moment the popup navigates to
  // accounts.google.com, permanently, even after it comes back to our own
  // origin. BroadcastChannel is same-origin messaging that doesn't need a
  // window reference at all, so it isn't affected by that.
  const connectTimeoutRef = useRef(null)
  useEffect(() => {
    const channel = new BroadcastChannel('faithlibrary-connect')
    channel.onmessage = (e) => {
      if (e.data?.type === 'faithlibrary-connected') {
        clearTimeout(connectTimeoutRef.current)
        getFaithLibrarySession().then(s => { setSession(s); setConnecting(false) })
      }
    }
    return () => channel.close()
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

    // The ?faithlibrary_popup=1 marker is how src/main.jsx recognizes this
    // window as the connect popup — see the comment there for why that
    // can't rely on window.opener either.
    const redirectTo = `${window.location.origin}${window.location.pathname}?faithlibrary_popup=1`

    const { data, error } = await faithlibrary.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error || !data?.url) {
      setAuthError(error?.message || 'Could not start Google sign-in.')
      setConnecting(false)
      popup.close()
      return
    }
    popup.location.href = data.url

    // We can't reliably poll popup.closed (COOP blocks that too, once the
    // popup has navigated to Google). If the person closes it manually
    // instead of completing sign-in, this timeout stops the spinner
    // instead of waiting forever for a message that'll never come.
    clearTimeout(connectTimeoutRef.current)
    connectTimeoutRef.current = setTimeout(() => {
      setConnecting(false)
      setAuthError(prev => prev || 'Sign-in window closed before finishing. Please try again.')
    }, 90_000)
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

      const cleanTitle = title.trim() || 'Untitled Score'

      // Upload straight to FaithLibrary's Supabase Storage and insert the
      // files row directly — same as FaithLibrary's own UploadForm does —
      // rather than relaying the PDF through a Vercel serverless function.
      // Vercel functions cap request bodies at 4.5MB, which a multi-page
      // score PDF can easily exceed; going straight to Supabase Storage
      // has no such limit and sidesteps CORS entirely, since we're calling
      // Supabase's own API (which already handles it) instead of a
      // same-origin-only Next.js route.
      const storagePath = `${fresh.user.id}/${Date.now()}.pdf`

      const { error: storageError } = await faithlibrary.storage
        .from('faithlibrary-files')
        .upload(storagePath, pdfBlob, { contentType: 'application/pdf', upsert: false })
      if (storageError) throw new Error(storageError.message)

      const { data: { publicUrl } } = faithlibrary.storage
        .from('faithlibrary-files')
        .getPublicUrl(storagePath)

      const { data: fileRecord, error: dbError } = await faithlibrary
        .from('files')
        .insert({
          user_id: fresh.user.id,
          title: cleanTitle,
          description: description.trim() || null,
          category: 'score',
          tags: [],
          is_public: isPublic,
          license_status: license,
          file_url: publicUrl,
          source: 'notation_app',
        })
        .select()
        .single()
      if (dbError) throw new Error(dbError.message)

      setPublished(fileRecord)
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