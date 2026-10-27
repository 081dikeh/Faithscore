// src/components/DialogHost/index.jsx
//
// Draws FaithScore's own popups (see utils/dialog.js). Mount ONCE, at the root.
//
//  • Modals queue: if several are requested they appear one after another.
//  • Esc / clicking the backdrop dismisses (confirm → false, prompt → null,
//    choose → null) — unless the dialog says dismissible:false.
//  • Enter runs the primary action (a focused button runs itself instead).
//  • Focus moves into the dialog, Tab stays inside it, and focus returns to
//    where it was when it closes. While one is open, the app's own keyboard
//    shortcuts (A–G, Delete, Space…) are paused so typing can't edit the score.
//  • Toasts are small non-blocking notices, bottom centre.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { registerDialogHost } from '../../utils/dialog.js'

const TONES = {
  info:    { c: '#2563eb', bg: '#eff6ff', ring: '#bfdbfe', icon: 'i' },
  success: { c: '#16a34a', bg: '#f0fdf4', ring: '#bbf7d0', icon: '✓' },
  warn:    { c: '#d97706', bg: '#fffbeb', ring: '#fde68a', icon: '!' },
  danger:  { c: '#dc2626', bg: '#fef2f2', ring: '#fecaca', icon: '!' },
}
const DEFAULT_TITLE = {
  alert:   { info: 'Notice', success: 'Done', warn: 'Please check', danger: 'Something went wrong' },
  confirm: 'Are you sure?',
  prompt:  '',
  choose:  '',
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const BTN = {
  base: {
    fontFamily: FONT, fontSize: 14, fontWeight: 600, lineHeight: 1.2,
    padding: '9px 16px', borderRadius: 9, cursor: 'pointer', border: '1px solid transparent',
    transition: 'background .12s, box-shadow .12s, transform .06s',
    outline: 'none',
  },
  primary:   { background: '#2563eb', color: '#fff' },
  danger:    { background: '#dc2626', color: '#fff' },
  secondary: { background: '#fff', color: '#374151', borderColor: '#d1d5db' },
}

function buttonsFor(item) {
  switch (item.kind) {
    case 'alert':
      return [{ id: 'ok', label: item.okLabel || 'OK', variant: 'primary', primary: true }]
    case 'confirm':
      return [
        { id: 'cancel', label: item.cancelLabel || 'Cancel', variant: 'secondary' },
        { id: 'ok', label: item.confirmLabel || 'OK', variant: item.tone === 'danger' ? 'danger' : 'primary', primary: true },
      ]
    case 'prompt':
      return [
        { id: 'cancel', label: item.cancelLabel || 'Cancel', variant: 'secondary' },
        { id: 'ok', label: item.confirmLabel || 'OK', variant: 'primary', primary: true },
      ]
    case 'choose':
      return (item.actions || []).map((a, i, arr) => ({
        variant: 'secondary', ...a,
        primary: a.primary ?? (!arr.some((x) => x.primary) && i === arr.length - 1),
      }))
    default:
      return []
  }
}

export default function DialogHost() {
  const [queue, setQueue] = useState([])
  const [toasts, setToasts] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const cardRef = useRef(null)
  const inputRef = useRef(null)
  const returnFocusRef = useRef(null)
  const toastId = useRef(0)

  const current = queue[0] || null
  const currentRef = useRef(null)
  currentRef.current = current
  const textRef = useRef('')
  textRef.current = text

  // ── service wiring ──────────────────────────────────────────────────────
  useEffect(() => {
    registerDialogHost({
      openModal: (item) => setQueue((q) => [...q, item]),
      toast: (t) => {
        const id = ++toastId.current
        const tone = t.tone || 'info'
        const ms = t.duration ?? (tone === 'danger' ? 4500 : 2600)
        setToasts((a) => [...a, { id, ...t, tone }])
        setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), ms)
      },
    })
    return () => registerDialogHost(null)
  }, [])

  // ── per-dialog setup / teardown ────────────────────────────────────────
  useEffect(() => {
    if (!current) return
    returnFocusRef.current = document.activeElement
    setText(current.defaultValue != null ? String(current.defaultValue) : '')
    setError('')
    const t = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      } else {
        const btns = cardRef.current?.querySelectorAll('button[data-dlg]') || []
        // a destructive confirm focuses the SAFE button, so Enter can't delete by accident
        const safe = current.kind === 'confirm' && current.tone === 'danger'
        const target = safe ? btns[0] : [...btns].find((b) => b.dataset.primary === '1') || btns[0]
        target?.focus()
      }
    }, 0)
    return () => {
      clearTimeout(t)
      const el = returnFocusRef.current
      if (el && typeof el.focus === 'function') try { el.focus() } catch (_) {}
    }
  }, [current])

  const finish = useCallback((value) => {
    const item = currentRef.current
    if (!item) return
    item.resolve(value)
    setQueue((q) => q.slice(1))
  }, [])

  const dismiss = useCallback(() => {
    const item = currentRef.current
    if (!item || item.dismissible === false) return
    finish(item.kind === 'confirm' ? false : item.kind === 'alert' ? undefined : null)
  }, [finish])

  const act = useCallback((btn) => {
    const item = currentRef.current
    if (!item) return
    if (item.kind === 'alert') return finish(undefined)
    if (item.kind === 'confirm') return finish(btn.id === 'ok')
    if (item.kind === 'choose') return finish(btn.id)
    if (item.kind === 'prompt') {
      if (btn.id === 'cancel') return finish(null)
      const v = textRef.current
      const problem = item.validate ? item.validate(v) : ''
      if (problem) {
        setError(problem)
        inputRef.current?.focus()
        return
      }
      return finish(v)
    }
  }, [finish])

  // ── keyboard: Esc / Enter / Tab, and pause the app's shortcuts ──────────
  useEffect(() => {
    if (!current) return
    const onKey = (e) => {
      const card = cardRef.current
      if (!card) return
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation()
        dismiss()
        return
      }
      if (e.key === 'Tab') {
        const f = [...card.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled)
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus() }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        e.stopImmediatePropagation()
        return
      }
      if (e.key === 'Enter') {
        const onButton = document.activeElement?.tagName === 'BUTTON' && card.contains(document.activeElement)
        if (!onButton) {
          const primary = buttonsFor(currentRef.current).find((b) => b.primary)
          if (primary) { e.preventDefault(); act(primary) }
        }
        e.stopImmediatePropagation()
        return
      }
      // anything else: let it type into the input, but keep it away from the app
      e.stopImmediatePropagation()
    }
    const onKeyUp = (ev) => ev.stopImmediatePropagation()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [current, dismiss, act])

  const tone = TONES[current?.tone] || TONES.info
  const buttons = current ? buttonsFor(current) : []
  const title =
    current &&
    (current.title ??
      (current.kind === 'alert'
        ? DEFAULT_TITLE.alert[current.tone || 'info']
        : DEFAULT_TITLE[current.kind]))

  return createPortal(
    <>
      <style>{`
        @keyframes fsd-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fsd-pop  { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: none } }
        @keyframes fsd-toast{ from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) { .fsd-anim { animation: none !important } }
        .fsd-btn:hover { filter: brightness(0.94) }
        .fsd-btn:active { transform: translateY(1px) }
        .fsd-btn:focus-visible { box-shadow: 0 0 0 3px rgba(37,99,235,.35) }
      `}</style>

      {current && (
        <div
          className="fsd-anim"
          onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'rgba(17,24,39,0.5)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            animation: 'fsd-fade .12s ease-out', fontFamily: FONT,
          }}
        >
          <div
            ref={cardRef}
            role={current.kind === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="fsd-title"
            aria-describedby="fsd-msg"
            className="fsd-anim"
            style={{
              width: `min(100%, ${buttons.length >= 3 ? 540 : 440}px)`, maxHeight: '86vh', overflow: 'auto',
              background: '#fff', borderRadius: 16, padding: '22px 22px 18px',
              boxShadow: '0 24px 60px rgba(0,0,0,.3), 0 0 0 1px rgba(0,0,0,.05)',
              animation: 'fsd-pop .16s ease-out',
            }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div
                aria-hidden="true"
                style={{
                  flex: '0 0 auto', width: 38, height: 38, borderRadius: '50%',
                  background: tone.bg, color: tone.c, boxShadow: `0 0 0 4px ${tone.ring}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 18, fontFamily: 'Georgia, serif',
                }}
              >
                {tone.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {title ? (
                  <h2 id="fsd-title" style={{ margin: '2px 0 6px', fontSize: 17, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>
                    {title}
                  </h2>
                ) : (
                  <span id="fsd-title" style={{ display: 'none' }} />
                )}
                <div
                  id="fsd-msg"
                  style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: title ? 0 : 6 }}
                >
                  {current.message}
                </div>

                {current.kind === 'prompt' && (
                  <>
                    <input
                      ref={inputRef}
                      value={text}
                      type={current.inputType || 'text'}
                      placeholder={current.placeholder || ''}
                      aria-label={current.message}
                      aria-invalid={!!error}
                      onChange={(e) => { setText(e.target.value); if (error) setError('') }}
                      style={{
                        width: '100%', boxSizing: 'border-box', marginTop: 12, fontFamily: FONT, fontSize: 14,
                        padding: '9px 11px', borderRadius: 9, outline: 'none',
                        border: `1.5px solid ${error ? '#dc2626' : '#d1d5db'}`,
                      }}
                      onFocus={(e) => { e.target.style.borderColor = error ? '#dc2626' : '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,.18)' }}
                      onBlur={(e) => { e.target.style.borderColor = error ? '#dc2626' : '#d1d5db'; e.target.style.boxShadow = 'none' }}
                    />
                    {error && <div role="alert" style={{ color: '#dc2626', fontSize: 12.5, marginTop: 6 }}>{error}</div>}
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
              {buttons.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  data-dlg="1"
                  data-primary={b.primary ? '1' : '0'}
                  className="fsd-btn"
                  onClick={() => act(b)}
                  style={{ ...BTN.base, ...(BTN[b.variant] || BTN.secondary) }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div
        aria-live="polite"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 22, zIndex: 100001,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none', fontFamily: FONT,
        }}
      >
        {toasts.map((t) => {
          const c = TONES[t.tone] || TONES.info
          return (
            <div
              key={t.id}
              className="fsd-anim"
              onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}
              style={{
                pointerEvents: 'auto', cursor: 'pointer', maxWidth: 'min(92vw, 460px)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#111827', color: '#f9fafb', fontSize: 14, lineHeight: 1.4,
                padding: '10px 14px', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,.3)',
                animation: 'fsd-toast .18s ease-out', whiteSpace: 'pre-wrap',
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: c.c, color: '#fff', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
                {c.icon}
              </span>
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </>,
    document.body,
  )
}