// src/App.jsx
import { useEffect, useState, useRef } from 'react'
import Toolbar from './components/Toolbar'
import ScoreRenderer from './components/ScoreRenderer'
import NoteEditor from './components/NoteEditor'
import { useScoreStore, clearSavedScore } from './store/scoreStore'
import HomeScreen from './components/HomeScreen'
import AuthScreen from './components/AuthScreen'
import Sidebar from './components/Sidebar'
import { exportMusicXML, exportMIDI, printScore } from './utils/exportScore'
import { usePlayback } from './hooks/usePlayback'
import PianoKeyboard from './components/PianoKeyboard'
import { supabase } from './lib/supabase'

const DURATION_KEYS = { '1':'w','2':'h','3':'q','4':'8','5':'16','6':'32','7':'64' }
const KEY_TO_STEP   = { a:'A',b:'B',c:'C',d:'D',e:'E',f:'F',g:'G' }

export default function App() {
  const score                  = useScoreStore(s => s.score)
  const [appView, setAppView] = useState('home')
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [user, setUser]           = useState(null)
  const [authLoading, setAuthLoading] = useState(true)  // true while checking session

  // Auth: get session once on mount, then subscribe to changes.
  // We intentionally do NOT react to TOKEN_REFRESHED — that was causing
  // a re-render loop which hammered the refresh endpoint (429 errors),
  // which Supabase then rate-limited, responding with SIGNED_OUT.
  // getSession() reads directly from localStorage — no network call,
  // no rate limiting — so it's safe to call on every mount.
  useEffect(() => {
    // Step 1: read the existing session from localStorage immediately.
    // This is synchronous-ish and never hits the network.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })

    // Step 2: subscribe only to explicit login/logout events.
    // TOKEN_REFRESHED is intentionally excluded — we don't need to
    // re-render on token refresh; the user object doesn't change.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        setUser(session?.user ?? null)
        setAuthLoading(false)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setAuthLoading(false)
        setAppView('home')
      }
      // INITIAL_SESSION, TOKEN_REFRESHED, PASSWORD_RECOVERY — all ignored.
      // getSession() above already handles the initial state.
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    // onAuthStateChange SIGNED_OUT will clear user and reset view
  }

  const inputMode              = useScoreStore(s => s.inputMode)
  const selectedMeasureIndex   = useScoreStore(s => s.selectedMeasureIndex)
  const selectedPartId         = useScoreStore(s => s.selectedPartId)
  const selectedNoteId         = useScoreStore(s => s.selectedNoteId)
  const selectedDuration       = useScoreStore(s => s.selectedDuration)
  const selectedDots           = useScoreStore(s => s.selectedDots)
  const selectedOctave         = useScoreStore(s => s.selectedOctave)
  const chordMode              = useScoreStore(s => s.chordMode)
  const addChordNote           = useScoreStore(s => s.addChordNote)
  const undo                   = useScoreStore(s => s.undo)
  const redo                   = useScoreStore(s => s.redo)
  const copyMeasure            = useScoreStore(s => s.copyMeasure)
  const pasteMeasure           = useScoreStore(s => s.pasteMeasure)
  const copyMeasureRange       = useScoreStore(s => s.copyMeasureRange)
  const clipboard              = useScoreStore(s => s.clipboard)
  const selectedMeasureRange   = useScoreStore(s => s.selectedMeasureRange)
  const extendMeasureRange     = useScoreStore(s => s.extendMeasureRange)
  const setMeasureRange        = useScoreStore(s => s.setMeasureRange)
  const transposeSelection     = useScoreStore(s => s.transposeSelection)
  const toggleTie              = useScoreStore(s => s.toggleTie)
  const insertTriplet          = useScoreStore(s => s.insertTriplet)
  const toggleSlurStart        = useScoreStore(s => s.toggleSlurStart)
  const toggleSlurEnd          = useScoreStore(s => s.toggleSlurEnd)
  const zoom                   = useScoreStore(s => s.zoom)
  const setZoom                = useScoreStore(s => s.setZoom)
  const _undoStack             = useScoreStore(s => s._undoStack)
  const getSelectedNote        = useScoreStore(s => s.getSelectedNote)

  const addNote                = useScoreStore(s => s.addNote)
  const addMeasure             = useScoreStore(s => s.addMeasure)
  const deleteLastNote         = useScoreStore(s => s.deleteLastNote)
  const deleteNote             = useScoreStore(s => s.deleteNote)
  const addPart                = useScoreStore(s => s.addPart)
  const removePart             = useScoreStore(s => s.removePart)
  const movePartUp             = useScoreStore(s => s.movePartUp)
  const movePartDown           = useScoreStore(s => s.movePartDown)
  const clearMeasureColumn     = useScoreStore(s => s.clearMeasureColumn)
  const deleteMeasureColumn    = useScoreStore(s => s.deleteMeasureColumn)
  const setInputMode           = useScoreStore(s => s.setInputMode)
  const setDuration            = useScoreStore(s => s.setDuration)
  const setSelectedDots        = useScoreStore(s => s.setSelectedDots)
  const setChordMode           = useScoreStore(s => s.setChordMode)
  const navigateNote           = useScoreStore(s => s.navigateNote)
  const shiftPitchHalfStep     = useScoreStore(s => s.shiftPitchHalfStep)
  const shiftPitchOctave       = useScoreStore(s => s.shiftPitchOctave)
  const shiftPitchStep         = useScoreStore(s => s.shiftPitchStep)
  const clearNoteSelection     = useScoreStore(s => s.clearNoteSelection)
  const clearSelection         = useScoreStore(s => s.clearSelection)
  const fillSelectedRest       = useScoreStore(s => s.fillSelectedRest)
  const changeSelectedDuration = useScoreStore(s => s.changeSelectedDuration)
  const setTitle               = useScoreStore(s => s.setTitle)
  const setComposer            = useScoreStore(s => s.setComposer)
  const setTempo               = useScoreStore(s => s.setTempo)
  const selectNote             = useScoreStore(s => s.selectNote)

  const isPlaying    = useScoreStore(s => s.isPlaying)
  const playbackBeat = useScoreStore(s => s.playbackBeat)

  const { play, pause, stop, rewind, playFromBeat, toggleMetronome, toggleLoop } = usePlayback()

  // ── Local UI state — all declared together before any logic ───────────────
  const [samplesLoaded, setSamplesLoaded]     = useState(false)
  const [samplesLoading, setSamplesLoading]   = useState(false)
  const [metronomeOn, setMetronomeOn]         = useState(false)
  const [loopOn, setLoopOn]                   = useState(false)
  const [showExportMenu, setShowExportMenu]   = useState(false)
  const [showEditMenu, setShowEditMenu]       = useState(false)
  const [showAddMenu, setShowAddMenu]         = useState(false)
  const [showFormatMenu, setShowFormatMenu]   = useState(false)
  const [showViewMenu, setShowViewMenu]       = useState(false)
  const [showToolsMenu, setShowToolsMenu]     = useState(false)
  const [showPiano, setShowPiano]             = useState(false)
  const [contextMenu, setContextMenu]         = useState(null)
  const [darkMode, setDarkMode]               = useState(() => {
    try { return localStorage.getItem('scoreai_dark') === '1' } catch { return false }
  })

  // Apply dark mode class to <html> whenever darkMode changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    document.body.style.background = darkMode ? '#111827' : ''
  }, [darkMode])

  // FIX 3: Default zoom 80% on mount
  useEffect(() => { setZoom(0.8) }, [])

  // Intercept play to show loading state while piano samples fetch
  const handlePlay = async () => {
    if (!samplesLoaded && !samplesLoading) {
      setSamplesLoading(true)
    }
    await play()
    setSamplesLoaded(true)
    setSamplesLoading(false)
  }
  const ctxRef = useRef(null)

  // Close context menu + all dropdown menus on outside click
  useEffect(() => {
    const h = e => {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setContextMenu(null)
      // Close menus if clicking outside the menu bar area
      if (!e.target.closest?.('[data-menubar]')) {
        setShowExportMenu(false); setShowEditMenu(false); setShowAddMenu(false)
        setShowFormatMenu(false); setShowViewMenu(false); setShowToolsMenu(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Chromatic note button click → insert note (only when in note mode)
  useEffect(() => {
    const unsub = useScoreStore.subscribe(s => s.selectedNote, (note) => {
      const st = useScoreStore.getState()
      // Only auto-insert if in note mode AND a measure is selected
      if (st.inputMode !== 'note' || st.selectedMeasureIndex === null) return

      const pitch = { step: note.step, octave: st.selectedOctave, accidental: note.accidental }
      const selNote = st.getSelectedNote()

      if (selNote?.isRest) {
        st.fillSelectedRest(pitch)
      } else {
        st.addNote(st.selectedPartId, st.selectedMeasureIndex, {
          pitch,
          duration: st.selectedDuration,
          dots: st.selectedDots || 0,
        })
      }
    })
    return () => unsub()
  }, [])

  // Global keyboard handler
  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      const st = () => useScoreStore.getState()

      // ── Duration keys (always work; resize note if one is selected) ──
      if (DURATION_KEYS[e.key]) {
        const newDur  = DURATION_KEYS[e.key]
        const selNote = st().getSelectedNote()
        if (selNote) changeSelectedDuration(newDur, selNote.dots || 0)
        else         setDuration(newDur)
        return
      }
      if (e.key === '.') {
        const selNote = st().getSelectedNote()
        if (selNote) changeSelectedDuration(selNote.duration, selNote.dots ? 0 : 1)
        else         setSelectedDots(st().selectedDots ? 0 : 1)
        return
      }
      if (e.key === 'j' || e.key === 'J') { setChordMode(!st().chordMode); return }

      // ── When a note/rest is selected ──
      if (selectedNoteId) {
        const selNote = st().getSelectedNote()

        // Pitch shifts (only for real notes)
        if (!selNote?.isRest) {
          if (e.shiftKey && e.key === 'ArrowUp')   { e.preventDefault(); shiftPitchOctave(1);   return }
          if (e.shiftKey && e.key === 'ArrowDown')  { e.preventDefault(); shiftPitchOctave(-1);  return }
          if (!e.shiftKey && e.key === 'ArrowUp')   { e.preventDefault(); shiftPitchStep(1);  return }
          if (!e.shiftKey && e.key === 'ArrowDown') { e.preventDefault(); shiftPitchStep(-1); return }
        }

        if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateNote(-1); return }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigateNote(1);  return }

        if ((e.key === 'Delete' || e.key === 'Backspace') && !selNote?.isRest) {
          deleteNote(selectedPartId, selectedMeasureIndex, selectedNoteId)
          return
        }
        if (e.key === 'Escape') { clearNoteSelection(); return }

        // Rest selected + note key → fill it (works in both select and note mode)
        const step = KEY_TO_STEP[e.key.toLowerCase()]
        if (step && selNote?.isRest) {
          fillSelectedRest({ step, octave: st().selectedOctave, accidental: null })
          return
        }
        if (e.key === 'Enter' && st().selectedNote && selNote?.isRest) {
          const n = st().selectedNote
          fillSelectedRest({ step: n.step, octave: st().selectedOctave, accidental: n.accidental })
          return
        }
      }

      // ── Measure selected but no note — arrows enter the measure ──
      if (selectedMeasureIndex !== null && !selectedNoteId) {
        if (e.key === 'Delete')    { clearMeasureColumn(selectedMeasureIndex); return }
        if (e.key === 'Backspace') { deleteLastNote(selectedPartId, selectedMeasureIndex); return }
        if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
          // Enter measure by selecting its first note
          e.preventDefault()
          const cur = st()
          const part = cur.score.parts.find(p => p.id === selectedPartId)
          const notes = part?.measures[selectedMeasureIndex]?.notes.filter(n => !n.chordWith)
          const first = notes?.[0]
          if (first) cur.selectNote(first.id, selectedPartId, selectedMeasureIndex)
          return
        }
        if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          const cur = st()
          const part = cur.score.parts.find(p => p.id === selectedPartId)
          const notes = part?.measures[selectedMeasureIndex]?.notes.filter(n => !n.chordWith)
          const last = notes?.[notes.length - 1]
          if (last) cur.selectNote(last.id, selectedPartId, selectedMeasureIndex)
          return
        }
      }

      // ── Note input: A–G ──
      if (inputMode === 'note' && selectedMeasureIndex !== null) {
        const step = KEY_TO_STEP[e.key.toLowerCase()]
        if (step) {
          const cur     = st()
          const selNote = cur.getSelectedNote()
          const pitch   = { step, octave: cur.selectedOctave, accidental: cur.selectedNote?.accidental ?? null }

          // Shift+letter OR chordMode while a real note is selected = add chord
          if ((e.shiftKey || cur.chordMode) && selectedNoteId && selNote && !selNote.isRest) {
            addChordNote(selectedPartId, selectedMeasureIndex, selectedNoteId, pitch)
            return
          }
          if (selNote?.isRest) fillSelectedRest(pitch)
          else addNote(selectedPartId, selectedMeasureIndex, { pitch, duration: cur.selectedDuration, dots: cur.selectedDots || 0 })
          return
        }
        if (e.key === 'Enter' && st().selectedNote) {
          const cur     = st()
          const n       = cur.selectedNote
          const pitch   = { step: n.step, octave: cur.selectedOctave, accidental: n.accidental }
          const selNote = cur.getSelectedNote()
          if ((e.shiftKey || cur.chordMode) && selectedNoteId && selNote && !selNote.isRest) {
            addChordNote(selectedPartId, selectedMeasureIndex, selectedNoteId, pitch)
            return
          }
          if (selNote?.isRest) fillSelectedRest(pitch)
          else addNote(selectedPartId, selectedMeasureIndex, { pitch, duration: cur.selectedDuration, dots: cur.selectedDots || 0 })
          return
        }
      }

      // ── Global shortcuts ──
      if (e.key === 'n' || e.key === 'N') { setInputMode('note');   return }
      if (e.key === 's' || e.key === 'S') { setInputMode('select'); return }
      if (e.key === 'Escape')             { clearSelection(); setMeasureRange(null); setInputMode('select'); return }
      if (e.key === 'm' || e.key === 'M') { addMeasure(); return }
      if (e.key === 'p' || e.key === 'P') { setShowPiano(v => !v); return }
      // T3 or just '3' in note mode = insert triplet of current duration
      if ((e.key === '3') && inputMode === 'note') { e.preventDefault(); insertTriplet(st().selectedDuration); return }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }

      // Copy / Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        if (selectedMeasureIndex !== null) copyMeasure(selectedPartId, selectedMeasureIndex)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        if (selectedMeasureIndex !== null) pasteMeasure(selectedPartId, selectedMeasureIndex)
        return
      }

      // Tie (T)
      if (e.key === 't' || e.key === 'T') { toggleTie(); return }
      if (e.key === 'e' || e.key === 'E') { toggleSlurEnd(); return }
      // Slur (S already taken by Select — use Shift+S)
      if (e.shiftKey && e.key === 'S') { toggleSlurStart(); return }

      // Transpose (up/down by semitone when no note selected, by measure range)
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp')   { e.preventDefault(); transposeSelection(1);  return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') { e.preventDefault(); transposeSelection(-1); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight'){ e.preventDefault(); transposeSelection(12); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') { e.preventDefault(); transposeSelection(-12);return }

      // Zoom (Ctrl + / -)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom + 0.1); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom(zoom - 0.1); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setZoom(0.8); return }

      // Shift+click measure = extend range (handled in ScoreRenderer onClick)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputMode, selectedDuration, selectedDots, selectedMeasureIndex, selectedPartId, selectedNoteId, selectedOctave, chordMode, addChordNote, undo, redo, copyMeasure, pasteMeasure, transposeSelection, toggleTie, toggleSlurStart, zoom, setZoom, setMeasureRange, insertTriplet])

  const handleContextMenu = e => {
    e.preventDefault()
    if (selectedMeasureIndex !== null)
      setContextMenu({ x: e.clientX, y: e.clientY, col: selectedMeasureIndex })
  }

  const liveNote = getSelectedNote()

  // ── Save score with timestamp whenever score changes ──────────────────
  useEffect(() => {
    if (appView !== 'editor') return
    try {
      const scored = { ...score, _savedAt: Date.now() }
      localStorage.setItem('faithscore_autosave', JSON.stringify(scored))
    } catch(_) {}
  }, [score, appView])

  // ── Auth gate — show AuthScreen until user is logged in ──────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
        fontFamily: '-apple-system, sans-serif', fontSize: 14, color: '#6b7280' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎵</div>
          <div>Loading FaithScore…</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthScreen onAuth={(u) => setUser(u)} />
  }

  if (appView === 'home') {
    return <HomeScreen user={user} onOpenEditor={() => setAppView('editor')} onSignOut={handleSignOut} />
  }


  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-100"}`}>

      {/* ── Sticky top chrome: menu + status + toolbar + shortcuts ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, flexShrink: 0 }}>
      <div data-menubar className="bg-white border-b border-gray-200 flex items-center h-10 px-3 gap-1 shadow-sm">
        {/* ── Logo + Home button ────────────────────────────── */}
        <button onClick={() => setAppView('home')}
          title="Back to Home"
          style={{ display:'flex', alignItems:'center', gap:5, fontWeight:700,
            fontSize:13, color:'#2563eb', marginRight:8, letterSpacing:'-0.3px',
            border:'none', background:'none', cursor:'pointer', padding:'2px 6px',
            borderRadius:5 }}
          onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
          onMouseLeave={e=>e.currentTarget.style.background='none'}>
          🎵 FaithScore
        </button>

        {/* ── Menu system ─────────────────────────────────────────────── */}
        {(() => {
          const closeAll = () => {
            setShowExportMenu(false); setShowEditMenu(false); setShowAddMenu(false)
            setShowFormatMenu(false); setShowViewMenu(false); setShowToolsMenu(false)
          }

          // Separator line
          const Sep = () => <div style={{ height:1, background:'#e5e7eb', margin:'4px 0' }} />

          // Section label (non-clickable group header)
          const Label = ({ text }) => (
            <div style={{ padding:'4px 14px 2px', fontSize:10, fontWeight:700,
              color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>
              {text}
            </div>
          )

          // Menu item — with optional icon, shortcut, arrow for sub-menus, danger styling
          const Item = ({ icon, label, shortcut, onClick, disabled, danger, arrow }) => (
            <button disabled={disabled}
              onClick={() => { if (!disabled) { closeAll(); onClick?.() } }}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%',
                textAlign:'left', padding:'5px 14px 5px 10px',
                fontSize:12.5, border:'none', background:'none',
                cursor: disabled ? 'default' : 'pointer', borderRadius:3,
                color: danger ? '#dc2626' : disabled ? '#b0b8c8' : '#1e2433' }}
              onMouseEnter={e => { if (!disabled) e.currentTarget.style.background='#e8f0fe' }}
              onMouseLeave={e => { e.currentTarget.style.background='none' }}>
              <span style={{ width:18, flexShrink:0, fontSize:13, textAlign:'center',
                color: disabled ? '#b0b8c8' : '#5a6478' }}>{icon || ''}</span>
              <span style={{ flex:1 }}>{label}</span>
              {shortcut && <span style={{ fontSize:10.5, color:'#9ca3af', whiteSpace:'nowrap',
                marginLeft:16 }}>{shortcut}</span>}
              {arrow && <span style={{ fontSize:10, color:'#9ca3af', marginLeft:4 }}>▶</span>}
            </button>
          )

          // Checkmark item (for toggleable views)
          const CheckItem = ({ checked, label, shortcut, onClick }) => (
            <button onClick={() => { closeAll(); onClick?.() }}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%',
                textAlign:'left', padding:'5px 14px 5px 10px',
                fontSize:12.5, border:'none', background:'none',
                cursor:'pointer', borderRadius:3, color:'#1e2433' }}
              onMouseEnter={e => { e.currentTarget.style.background='#e8f0fe' }}
              onMouseLeave={e => { e.currentTarget.style.background='none' }}>
              <span style={{ width:18, flexShrink:0, fontSize:12, textAlign:'center',
                color:'#2563eb' }}>{checked ? '✓' : ''}</span>
              <span style={{ flex:1 }}>{label}</span>
              {shortcut && <span style={{ fontSize:10.5, color:'#9ca3af', whiteSpace:'nowrap',
                marginLeft:16 }}>{shortcut}</span>}
            </button>
          )

          // Dropdown container
          const MenuTitle = ({ children, w=220, open, toggle, menu }) => (
            <div style={{ position:'relative' }}>
              <button
                onClick={() => { closeAll(); if (!open) toggle(true) }}
                onMouseEnter={() => {
                  const anyOpen = [showExportMenu,showEditMenu,showAddMenu,
                    showFormatMenu,showViewMenu,showToolsMenu].some(Boolean)
                  if (anyOpen) { closeAll(); toggle(true) }
                }}
                style={{ padding:'3px 9px', fontSize:13, fontWeight:500,
                  border:'none', background: open ? '#dbeafe' : 'none',
                  borderRadius:4, cursor:'pointer',
                  color: open ? '#1d4ed8' : '#1e2433' }}>
                {children}
              </button>
              {open && (
                <div style={{ position:'absolute', top:'calc(100% + 2px)', left:0, zIndex:200,
                  background:'white', border:'1px solid #d1d5db', borderRadius:7,
                  boxShadow:'0 10px 30px rgba(0,0,0,0.14)', minWidth:w,
                  padding:'5px 0', userSelect:'none' }}
                  onMouseLeave={() => toggle(false)}>
                  {menu}
                </div>
              )}
            </div>
          )

          // ── FILE ───────────────────────────────────────────────────────────
          const fileMenu = <>
            <Item icon="📄" label="New…"              shortcut="Ctrl+N"
              onClick={() => { setAppView('home') }} />
            <Item icon="📂" label="Open…"             shortcut="Ctrl+O"   disabled />
            <Item icon=""   label="Open recent"       arrow               disabled />
            <Sep />
            <Item icon="💾" label="Save"              shortcut="Ctrl+S"
              onClick={async () => {
                // Always save to localStorage
                try { localStorage.setItem('faithscore_autosave', JSON.stringify({ ...score, _savedAt: Date.now() })) } catch(_) {}
                // Also save to cloud if logged in
                if (user) {
                  try {
                    await supabase.from('scores').upsert([{
                      user_id: user.id,
                      title: score.title || 'Untitled Score',
                      data: score,
                      updated_at: new Date().toISOString(),
                    }], { onConflict: 'id' })
                    alert('Score saved to cloud ☁')
                  } catch(e) { alert('Cloud save failed — saved locally instead.') }
                } else {
                  alert('Score saved to browser storage.')
                }
              }} />
            <Item icon=""   label="Save as…"          shortcut="Ctrl+Shift+S" disabled />
            <Item icon="☁️" label="Save to cloud…"                        disabled />
            <Sep />
            <Item icon=""   label="Export MusicXML"   shortcut="Ctrl+Shift+X"
              onClick={() => exportMusicXML(score)} />
            <Item icon=""   label="Export MIDI"        shortcut="Ctrl+Shift+M"
              onClick={() => exportMIDI(score)} />
            <Item icon=""   label="Export…"           arrow               disabled />
            <Sep />
            <Item icon="🖨️" label="Print…"            shortcut="Ctrl+P"
              onClick={() => { printScore(score) }} />
            <Sep />
            <Item icon=""   label="Score properties…"                     disabled />
            <Item icon="🚪" label="Quit"              shortcut="Ctrl+Q"   danger
              onClick={() => window.close()} />
          </>

          // ── EDIT ───────────────────────────────────────────────────────────
          const editMenu = <>
            <Item icon="↩" label="Undo"               shortcut="Ctrl+Z"
              onClick={undo} disabled={_undoStack.length === 0} />
            <Item icon="↪" label="Redo"               shortcut="Ctrl+Y"
              onClick={redo} />
            <Item icon=""  label="History"                                 disabled />
            <Sep />
            <Item icon="✂️" label="Cut"               shortcut="Ctrl+X"   disabled />
            <Item icon="📋" label="Copy"              shortcut="Ctrl+C"
              onClick={() => { if(selectedMeasureIndex!==null) copyMeasure(selectedPartId, selectedMeasureIndex) }} />
            <Item icon="📌" label="Paste"             shortcut="Ctrl+V"
              onClick={() => { if(selectedMeasureIndex!==null) pasteMeasure(selectedPartId, selectedMeasureIndex) }} />
            <Item icon=""  label="Paste half duration" shortcut="Ctrl+Shift+Q" disabled />
            <Item icon=""  label="Paste double duration" shortcut="Ctrl+Shift+W" disabled />
            <Item icon=""  label="Swap with clipboard" shortcut="Ctrl+Shift+X" disabled />
            <Sep />
            <Item icon="🗑" label="Delete"            shortcut="Del"
              onClick={() => { if(selectedNoteId) deleteNote(selectedPartId, selectedMeasureIndex, selectedNoteId)
                else if(selectedMeasureIndex!==null) clearMeasureColumn(selectedMeasureIndex) }} />
            <Sep />
            <Item icon=""  label="Select all"         shortcut="Ctrl+A"   disabled />
            <Item icon=""  label="Select section"                          disabled />
            <Item icon=""  label="Find / Go to"       shortcut="Ctrl+F"   disabled />
            <Sep />
            <Item icon="⚙️" label="Preferences…"                          disabled />
          </>

          // ── VIEW ───────────────────────────────────────────────────────────
          const viewMenu = <>
            <Item icon=""  label="Full screen"        shortcut="F11"
              onClick={() => { document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen() }} />
            <Sep />
            <CheckItem checked label="Palettes"       shortcut="F9"       onClick={() => {}} />
            <CheckItem checked={false} label="Master palette" shortcut="Shift+F9" onClick={() => {}} />
            <CheckItem checked label="Layout"         shortcut="F7"       onClick={() => {}} />
            <CheckItem checked label="Properties"     shortcut="F8"       onClick={() => {}} />
            <Item icon=""  label="Selection filter"                        disabled />
            <Item icon=""  label="History"                                 disabled />
            <Item icon=""  label="Navigator"                               disabled />
            <Sep />
            <Item icon="🎹" label="Piano keyboard"   shortcut="P"
              onClick={() => setShowPiano(v => !v)} />
            <Item icon=""  label="Mixer"              shortcut="F10"      disabled />
            <Item icon=""  label="Playback setup"                         disabled />
            <Sep />
            <Item icon=""  label="Toolbars"           arrow               disabled />
            <Item icon=""  label="Workspaces"         arrow               disabled />
            <Sep />
            <CheckItem checked={darkMode} label="Dark mode"
              onClick={() => { const n=!darkMode; setDarkMode(n); localStorage.setItem('faithscore_dark',n?'1':'0') }} />
            <Sep />
            <Item icon=""  label="Zoom in"            shortcut="Ctrl++"
              onClick={() => setZoom(Math.min(2, zoom + 0.1))} />
            <Item icon=""  label="Zoom out"           shortcut="Ctrl+−"
              onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} />
            <Item icon=""  label="Reset zoom (80%)"  shortcut="Ctrl+0"
              onClick={() => setZoom(0.8)} />
          </>

          // ── ADD ────────────────────────────────────────────────────────────
          const addMenu = <>
            <Item icon="♩"  label="Notes"             arrow               disabled />
            <Item icon=""   label="Intervals"         arrow               disabled />
            <Item icon=""   label="Tuplets"           arrow               disabled />
            <Sep />
            <Item icon=""   label="Measures"          arrow>
            </Item>
            <Label text="Measures" />
            <Item icon=""   label="Insert measure"    shortcut="Ins"
              onClick={addMeasure} />
            <Item icon=""   label="Insert measures…"                      disabled />
            <Item icon=""   label="Append measure"    shortcut="Ctrl+B"
              onClick={addMeasure} />
            <Item icon=""   label="Append measures…"                      disabled />
            <Sep />
            <Item icon=""   label="Frames"            arrow               disabled />
            <Item icon=""   label="Text"              arrow               disabled />
            <Sep />
            <Label text="Lines & markings" />
            <Item icon="⌢"  label="Tie"              shortcut="T"
              onClick={toggleTie} />
            <Item icon="⌣"  label="Slur"             shortcut="S"
              onClick={toggleSlurStart} />
            <Item icon="³"  label="Triplet"
              onClick={() => insertTriplet(selectedDuration)} />
            <Sep />
            <Item icon=""   label="Add rehearsal mark"
              onClick={() => {
                const idx = selectedMeasureIndex
                if (idx===null) { alert('Select a measure first.'); return }
                const letter = prompt('Rehearsal mark letter:', 'A')
                if (letter) useScoreStore.getState().addRehearsalMark(idx, letter.trim().slice(0,3))
              }} />
            <Item icon=""   label="Chords and fretboard diagrams" arrow   disabled />
          </>

          // ── FORMAT ─────────────────────────────────────────────────────────
          const formatMenu = <>
            <Item icon=""  label="Style…"                                  disabled />
            <Item icon=""  label="Page settings…"                          disabled />
            <Item icon=""  label="Measures per system…"
              onClick={() => {
                const v = prompt('Measures per line (1–8):', useScoreStore.getState().measuresPerLine ?? 4)
                const n = parseInt(v)
                if (!isNaN(n)) useScoreStore.getState().setMeasuresPerLine(n)
              }} />
            <Item icon=""  label="Stretch"            arrow               disabled />
            <Sep />
            <Item icon=""  label="Transpose up ½ step"  shortcut="Ctrl+↑"
              onClick={() => transposeSelection(1)} />
            <Item icon=""  label="Transpose down ½ step" shortcut="Ctrl+↓"
              onClick={() => transposeSelection(-1)} />
            <Item icon=""  label="Transpose up octave"   shortcut="Ctrl+→"
              onClick={() => transposeSelection(12)} />
            <Item icon=""  label="Transpose down octave" shortcut="Ctrl+←"
              onClick={() => transposeSelection(-12)} />
            <Sep />
            <Item icon=""  label="Reset text style overrides"
              onClick={() => {}} disabled />
            <Item icon=""  label="Reset beams"
              onClick={() => {}} disabled />
            <Item icon=""  label="Reset shapes and positions" shortcut="Ctrl+R"
              onClick={() => {}} disabled />
            <Item icon=""  label="Reset entire score to default layout"
              onClick={() => {}} disabled />
            <Sep />
            <Item icon=""  label="Load style…"                            disabled />
            <Item icon=""  label="Save style…"                            disabled />
          </>

          // ── TOOLS ──────────────────────────────────────────────────────────
          const toolsMenu = <>
            <Item icon=""  label="Transpose…"
              onClick={() => {
                const s = prompt('Semitones to transpose (positive=up, negative=down):', '0')
                const n = parseInt(s)
                if (!isNaN(n) && n !== 0) transposeSelection(n)
              }} />
            <Item icon=""  label="Explode"                                disabled />
            <Item icon=""  label="Implode"                                disabled />
            <Item icon=""  label="Realize chord symbols"                  disabled />
            <Item icon=""  label="Voices"             arrow               disabled />
            <Item icon=""  label="Measures"           arrow               disabled />
            <Sep />
            <Item icon="🗑" label="Remove selected range" shortcut="Ctrl+Del"
              onClick={() => { if(selectedMeasureIndex!==null) deleteMeasureColumn(selectedMeasureIndex) }} />
            <Item icon=""  label="Fill with slashes"                      disabled />
            <Item icon=""  label="Toggle rhythmic slash notation"         disabled />
            <Sep />
            <Item icon=""  label="Change enharmonic spelling"  shortcut="J" disabled />
            <Item icon=""  label="Optimize enharmonic spelling"           disabled />
            <Item icon=""  label="Regroup rhythms"                        disabled />
            <Item icon=""  label="Resequence rehearsal marks"             disabled />
            <Sep />
            <Item icon=""  label="Remove empty trailing measures"
              onClick={() => {}} disabled />
            <Sep />
            <Label text="AI Features" />
            <Item icon="🤖" label="AI: Generate melody…"
              onClick={() => alert('AI melody generation — coming soon!')} />
            <Item icon="🤖" label="AI: Harmonize…"
              onClick={() => alert('AI harmonization — coming soon!')} />
            <Item icon="🤖" label="AI: Generate lyrics…"
              onClick={() => alert('AI lyric generation — coming soon!')} />
          </>

          return (
            <>
              <MenuTitle open={showExportMenu} toggle={setShowExportMenu} w={240} menu={fileMenu}>File</MenuTitle>
              <MenuTitle open={showEditMenu}   toggle={setShowEditMenu}   w={310} menu={editMenu}>Edit</MenuTitle>
              <MenuTitle open={showViewMenu}   toggle={setShowViewMenu}   w={240} menu={viewMenu}>View</MenuTitle>
              <MenuTitle open={showAddMenu}    toggle={setShowAddMenu}    w={260} menu={addMenu}>Add</MenuTitle>
              <MenuTitle open={showFormatMenu} toggle={setShowFormatMenu} w={270} menu={formatMenu}>Format</MenuTitle>
              <MenuTitle open={showToolsMenu}  toggle={setShowToolsMenu}  w={320} menu={toolsMenu}>Tools</MenuTitle>
            </>
          )
        })()}

        <div className="w-px h-4 bg-gray-200 mx-1" />

        {/* Undo / Redo */}
        <button onClick={undo} disabled={_undoStack.length === 0} title="Undo (Ctrl+Z)"
          className="w-7 h-7 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-sm transition-colors">↩</button>
        <button onClick={redo} title="Redo (Ctrl+Y)"
          className="w-7 h-7 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-sm transition-colors">↪</button>

        {/* Zoom */}
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <button onClick={() => setZoom(zoom - 0.1)} title="Zoom out (Ctrl+-)"
          className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-sm">−</button>
        <span className="text-xs text-gray-500 w-9 text-center font-mono">{Math.round(zoom*100)}%</span>
        <button onClick={() => setZoom(zoom + 0.1)} title="Zoom in (Ctrl+=)"
          className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-sm">+</button>

        <div className="flex-1" />

        {/* Playback controls */}
        <div className="flex items-center gap-1.5 mr-4">
          {/* Rewind */}
          <button onClick={rewind}
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-100 text-gray-600 text-xs transition-colors">
            ⏮
          </button>
          {/* Play / Pause toggle */}
          <button
            onClick={isPlaying ? pause : handlePlay}
            className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition-colors
              ${isPlaying
                ? 'bg-orange-500 hover:bg-orange-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          {/* Stop */}
          <button onClick={stop}
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-100 text-gray-600 text-xs transition-colors">
            ⏹
          </button>
          {/* Metronome */}
          <button onClick={() => { const v = toggleMetronome(); setMetronomeOn(v) }}
            title="Metronome click during playback"
            className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors
              ${metronomeOn ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
            𝅘
          </button>
          {/* Piano keyboard toggle */}
          <button onClick={() => setShowPiano(v => !v)}
            title="Toggle piano keyboard (P)"
            className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors
              ${showPiano ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
            🎹
          </button>
          {/* Loop */}
          <button onClick={() => { const v = toggleLoop(); setLoopOn(v) }}
            title="Loop playback"
            className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors
              ${loopOn ? 'bg-green-100 border-green-400 text-green-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
            🔁
          </button>
          {/* Beat counter / loading indicator */}
          {samplesLoading ? (
            <span className="text-amber-500 text-xs ml-1 animate-pulse" title="Loading real piano samples...">
              🎹 loading…
            </span>
          ) : (
            <span className="text-gray-400 text-xs ml-1 font-mono w-10">
              {playbackBeat !== null && playbackBeat !== undefined
                ? `${Math.floor(playbackBeat / 4)}:${(Math.floor(playbackBeat) % 4) + 1}`
                : '0:1'}
            </span>
          )}
        </div>

        {/* Dark mode */}
        <button onClick={() => {
          const next = !darkMode; setDarkMode(next)
          localStorage.setItem('scoreai_dark', next ? '1' : '0')
          document.documentElement.classList.toggle('dark', next)
        }}
          title="Toggle dark mode"
          className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-100 text-xs mr-2">
          {darkMode ? '☀️' : '🌙'}
        </button>

        {/* Part manager moved to Sidebar → Parts tab */}

        {/* ── User badge + sign out ── */}
        {user && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:4 }}>
            <div style={{
              width:28, height:28, borderRadius:'50%',
              background:'linear-gradient(135deg,#2563eb,#7c3aed)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:11, fontWeight:700, color:'white', flexShrink:0,
            }}>
              {(user.user_metadata?.full_name || user.email || '?')[0].toUpperCase()}
            </div>
            <span style={{ fontSize:11, color:'#374151', maxWidth:100,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {user.user_metadata?.full_name || user.email?.split('@')[0]}
            </span>
            <button onClick={handleSignOut}
              title="Sign out"
              style={{ fontSize:11, color:'#6b7280', background:'none', border:'1px solid #e5e7eb',
                borderRadius:5, padding:'2px 8px', cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.color='#dc2626'}
              onMouseLeave={e=>e.currentTarget.style.color='#6b7280'}>
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* ── Score info + status bar ── */}
      <div className="bg-white border-b border-gray-200 px-5 py-2 flex items-center gap-5 flex-shrink-0">
        <input value={score.title} onChange={e => setTitle(e.target.value)}
          className="border-b border-gray-300 focus:border-blue-500 text-gray-800 text-sm font-semibold outline-none w-48 pb-0.5 bg-transparent"
          placeholder="Score Title" />
        <input value={score.composer || ''} onChange={e => setComposer(e.target.value)}
          className="border-b border-gray-300 focus:border-blue-500 text-gray-600 text-sm outline-none w-36 pb-0.5 bg-transparent"
          placeholder="Composer" />

        <div className="flex-1" />

        {/* Status indicators */}
        <div className="flex items-center gap-3 text-xs">
          <span className={`px-2.5 py-0.5 rounded-full font-medium border
            ${inputMode === 'note'
              ? 'bg-green-50 text-green-700 border-green-300'
              : 'bg-gray-100 text-gray-600 border-gray-300'
            }`}>
            {inputMode === 'note' ? '● Note Input' : '○ Select'}
          </span>

          {selectedMeasureIndex !== null && (
            <span className="text-gray-500">Bar {selectedMeasureIndex + 1}</span>
          )}

          {liveNote && (
            <span className={`font-medium ${liveNote.isRest ? 'text-sky-600' : 'text-orange-600'}`}>
              {liveNote.isRest
                ? `${liveNote.duration}${liveNote.dots?'.':''} rest`
                : `${liveNote.pitch?.step}${liveNote.pitch?.octave}`
              } selected
            </span>
          )}
        </div>

        {/* Tie / Slur / Transpose quick buttons */}
        <button onClick={toggleTie} title="Toggle tie on selected note (T)"
          className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-2.5 py-1.5 rounded transition-colors">
          ⌢ Tie
        </button>
        <button onClick={toggleSlurStart} title="Toggle slur on selected note (Shift+S)"
          className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-2.5 py-1.5 rounded transition-colors">
          ⌣ Slur
        </button>
        <button onClick={addMeasure}
          className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded transition-colors">
          + Bar (M)
        </button>
      </div>

      {/* ── Toolbar ── */}
      <Toolbar />

      {/* ── Keyboard shortcuts hint ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-1 flex gap-3 flex-wrap text-xs text-gray-400 flex-shrink-0">
        {[
          ['N','Note mode'], ['S','Select'], ['A–G','Natural note'],
          ['Enter','Chromatic'], ['1–6','Duration'], ['.','Dot'],
          ['⇧+A–G','Chord'], ['J','Chord mode'], ['T','Tie'], ['↑↓','Chromatic'], ['⇧↑↓','Octave'],
          ['←→','Navigate'], ['Del','Delete'], ['M','Add bar'],
          ['Ctrl+Z','Undo'], ['Ctrl+Y','Redo'], ['Ctrl+C','Copy bar'], ['Ctrl+V','Paste'],
          ['Ctrl+↑↓','Transpose ½'], ['Ctrl+←→','Transpose 8ve'],
          ['Ctrl+ +/-','Zoom'],
        ].map(([k,v]) => (
          <span key={k}>
            <kbd className="bg-gray-100 border border-gray-300 px-1 py-0.5 rounded text-gray-600 font-mono">{k}</kbd>
            {' '}{v}
          </span>
        ))}
      </div>

      {/* ── Note editor panel ── */}
      <NoteEditor />
      </div>{/* end sticky top chrome */}

      {/* ── Main area: Sidebar + Score canvas ── */}
      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar is position:fixed inside Sidebar.jsx — this spacer reserves its width */}
      <div style={{ width: 250, flexShrink: 0 }}>
        <Sidebar />
      </div>

      {/* ── Score canvas — A4 page layout ── */}
      <main className="flex-1 overflow-auto bg-gray-300 p-6" id="score-main" style={{ paddingBottom: showPiano ? 180 : 48 }}>
        {/*
          Zoom wrapper: scales the entire page (white paper + score) together.
          transform-origin: top center means it grows/shrinks from the top middle,
          keeping the page centred. The outer div has enough height to avoid clipping.
        */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          minHeight: `${1556 * zoom}px`,
        }}>
          <div style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            width: '100%',
            maxWidth: 1100,
            flexShrink: 0,
          }}>
        {/* Page 1 always has the title header */}
        <div
          className="score-page bg-white mx-auto shadow-lg"
          style={{
            width: '100%',
            maxWidth: 1100,   // comfortable screen width for editing
            minHeight: 1556,  // A4 proportions: 1100 × (297/210) ≈ 1556px
            padding: '60px 60px 60px 60px',  // 60px = ~15mm at screen scale
            marginBottom: 24,
            boxSizing: 'border-box',
            position: 'relative',
          }}
          onContextMenu={handleContextMenu}
        >
          {/* Score header — data-print-header marks elements for print extraction */}
          <div data-print-header="1" style={{ textAlign: 'center', marginBottom: 20, borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Times New Roman, serif', color: '#111', margin: 0 }}>
              {score.title || 'Untitled Score'}
            </div>
            {score.composer && (
              <div style={{ fontSize: 13, color: '#555', textAlign: 'right', fontFamily: 'Times New Roman, serif', margin: '4px 0 0' }}>
                {score.composer}
              </div>
            )}
          </div>

          {/* Score notation — renders into the page */}
          <div style={{ width: '100%', overflow: 'visible' }}>
            <ScoreRenderer />
          </div>
        </div>
          </div>{/* end zoom scale wrapper */}
        </div>{/* end zoom flex centering wrapper */}
      </main>
      </div>{/* end sidebar+canvas flex row */}

      {/* ── Piano keyboard — fixed above the bottom bar ── */}
      {showPiano && (
        <div style={{
          position: 'fixed', bottom: 32, left: 0, right: 0,
          zIndex: 59,
          boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        }}>
          <PianoKeyboard />
        </div>
      )}

      {/* ── Bottom bar — fixed at bottom of viewport ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 32, background: '#1e293b', borderTop: '1px solid #334155',
        display: 'flex', alignItems: 'center', padding: '0 12px',
        zIndex: 60, gap: 8,
      }}>
        <button
          onClick={() => setShowPiano(v => !v)}
          title="Toggle piano keyboard (P)"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '2px 10px', borderRadius: 4, border: 'none',
            background: showPiano ? '#3b82f6' : '#334155',
            color: showPiano ? 'white' : '#94a3b8',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}>
          🎹 Piano Keyboard {showPiano ? '▲' : '▼'}
        </button>
        <span style={{ color: '#475569', fontSize: 10 }}>
          Press P to toggle · Click key to insert note
        </span>
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div ref={ctxRef}
          className="fixed z-50 bg-white border border-gray-200 rounded shadow-xl py-1 w-52 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="px-3 py-1 text-gray-400 text-xs border-b border-gray-100 mb-1">
            Bar {contextMenu.col + 1}
          </div>
          <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-gray-700"
            onClick={() => { addMeasure(); setContextMenu(null) }}>➕ Add bar after</button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-gray-700"
            onClick={() => { clearMeasureColumn(contextMenu.col); setContextMenu(null) }}>🧹 Clear bar</button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600"
            onClick={() => { deleteMeasureColumn(contextMenu.col); setContextMenu(null) }}>🗑 Delete bar</button>
        </div>
      )}
    </div>
  )
}