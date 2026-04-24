// src/components/AuthScreen/index.jsx
// FaithScore — Login / Sign-up screen with email+password and Google OAuth

import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function AuthScreen({ onAuth }) {
  const [mode, setMode]         = useState('login')  // 'login' | 'signup' | 'forgot'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')
  const [showPass, setShowPass] = useState(false)

  const clearMessages = () => { setError(''); setMessage('') }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setMessage('Password reset link sent — check your email.')
        setLoading(false)
        return
      }
      if (mode === 'signup') {
        if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return }
        if (password.length < 6) { setError('Password must be at least 6 characters.'); setLoading(false); return }
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name.trim() } },
        })
        if (error) throw error
        if (data?.user?.identities?.length === 0) {
          setError('An account with this email already exists. Try logging in.')
          setLoading(false); return
        }
        if (!data.session) {
          setMessage('Account created! Check your email to confirm, then log in.')
          setMode('login'); setLoading(false); return
        }
        onAuth(data.session.user)
        return
      }
      // Login
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      onAuth(data.user)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  const handleGoogle = async () => {
    clearMessages()
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  const inp = {
    width: '100%', padding: '10px 14px', fontSize: 14,
    border: '1px solid #d1d5db', borderRadius: 8, outline: 'none',
    background: 'white', color: '#111', boxSizing: 'border-box',
  }
  const btnBlue = {
    width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 700,
    background: loading ? '#93c5fd' : '#2563eb', color: 'white',
    border: 'none', borderRadius: 8,
    cursor: loading ? 'not-allowed' : 'pointer',
  }

  const titles    = { login: 'Welcome back', signup: 'Create your account', forgot: 'Reset password' }
  const subtitles = {
    login:  'Log in to access your scores',
    signup: 'Start writing music with FaithScore',
    forgot: 'We\'ll email you a reset link',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 42, marginBottom: 6 }}>🎵</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1e40af', letterSpacing: '-0.5px' }}>FaithScore</div>
          <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Music Notation</div>
        </div>

        {/* Card */}
        <div style={{
          background: 'white', borderRadius: 16, padding: '32px 32px 28px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.09)',
        }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111' }}>{titles[mode]}</h2>
          <p style={{ margin: '0 0 22px', fontSize: 13, color: '#6b7280' }}>{subtitles[mode]}</p>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
              padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
              padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#16a34a' }}>
              {message}
            </div>
          )}

          {/* Google */}
          {mode !== 'forgot' && (
            <>
              <button onClick={handleGoogle} disabled={loading} style={{
                width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 600,
                background: 'white', color: '#374151', border: '1px solid #d1d5db',
                borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                marginBottom: 16,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>or</span>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              </div>
            </>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'signup' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Full name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name" required autoFocus style={inp}
                  onFocus={e => e.target.style.borderColor = '#2563eb'}
                  onBlur={e => e.target.style.borderColor = '#d1d5db'} />
              </div>
            )}

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required
                autoFocus={mode !== 'signup'} style={inp}
                onFocus={e => e.target.style.borderColor = '#2563eb'}
                onBlur={e => e.target.style.borderColor = '#d1d5db'} />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Password</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => { setMode('forgot'); clearMessages() }}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: '#2563eb', cursor: 'pointer', padding: 0 }}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <input type={showPass ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                    required style={{ ...inp, paddingRight: 44 }}
                    onFocus={e => e.target.style.borderColor = '#2563eb'}
                    onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af' }}>
                    {showPass ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" disabled={loading} style={btnBlue}>
              {loading ? '…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
          </form>

          {/* Mode switcher */}
          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
            {mode === 'login' && <>
              Don't have an account?{' '}
              <button onClick={() => { setMode('signup'); clearMessages() }}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: 13, padding: 0 }}>
                Sign up free
              </button>
            </>}
            {mode === 'signup' && <>
              Already have an account?{' '}
              <button onClick={() => { setMode('login'); clearMessages() }}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: 13, padding: 0 }}>
                Log in
              </button>
            </>}
            {mode === 'forgot' && (
              <button onClick={() => { setMode('login'); clearMessages() }}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: 13, padding: 0 }}>
                ← Back to login
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: '#9ca3af' }}>
          By continuing you agree to FaithScore's Terms of Service
        </p>
      </div>
    </div>
  )
}