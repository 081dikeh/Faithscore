// src/App.jsx — FaithScore
import { useEffect, useState, useRef } from 'react'
import Toolbar from './components/Toolbar'
import ScoreRenderer from './components/ScoreRenderer'
import NoteEditor from './components/NoteEditor'
import { useScoreStore, clearSavedScore, INSTRUMENTS } from './store/scoreStore'
import Sidebar from './components/Sidebar'
import { exportMusicXML, exportMIDI, printScore } from './utils/exportScore'
import { usePlayback } from './hooks/usePlayback'
import PianoKeyboard from './components/PianoKeyboard'

const DURATION_KEYS = { '1':'w','2':'h','3':'q','4':'8','5':'16','6':'32','7':'64' }
const KEY_TO_STEP   = { a:'A',b:'B',c:'C',d:'D',e:'E',f:'F',g:'G' }

export default function App() {
  const score                  = useScoreStore(s => s.score)
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
  const setPartInstrument      = useScoreStore(s => s.setPartInstrument)
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
  const isPlaying              = useScoreStore(s => s.isPlaying)
  const playbackBeat           = useScoreStore(s => s.playbackBeat)

  const { play, pause, stop, rewind, playFromBeat, toggleMetronome, toggleLoop } = usePlayback()

  // ── Local UI state ────────────────────────────────────────────────────────
  const [samplesLoaded, setSamplesLoaded]     = useState(false)
  const [samplesLoading, setSamplesLoading]   = useState(false)
  const [metronomeOn, setMetronomeOn]         = useState(false)
  const [loopOn, setLoopOn]                   = useState(false)
  const [showExportMenu, setShowExportMenu]   = useState(false)
  const [showAddPartMenu, setShowAddPartMenu] = useState(false)
  const [showPiano, setShowPiano]             = useState(false)
  const [contextMenu, setContextMenu]         = useState(null)
  const [darkMode, setDarkMode]               = useState(() => {
    try { return localStorage.getItem('faithscore_dark') === '1'
           || localStorage.getItem('scoreai_dark') === '1' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    document.body.style.background = darkMode ? '#111827' : ''
  }, [darkMode])

  const handlePlay = async () => {
    if (!samplesLoaded && !samplesLoading) setSamplesLoading(true)
    await play()
    setSamplesLoaded(true)
    setSamplesLoading(false)
  }

  const ctxRef = useRef(null)
  const addPartRef = useRef(null)

  useEffect(() => {
    const h = e => {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setContextMenu(null)
      if (addPartRef.current && !addPartRef.current.contains(e.target)) setShowAddPartMenu(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Chromatic note button click → insert note
  useEffect(() => {
    const unsub = useScoreStore.subscribe(s => s.selectedNote, (note) => {
      const st = useScoreStore.getState()
      if (st.inputMode !== 'note' || st.selectedMeasureIndex === null) return
      const pitch = { step: note.step, octave: st.selectedOctave, accidental: note.accidental }
      const selNote = st.getSelectedNote()
      if (selNote?.isRest) st.fillSelectedRest(pitch)
      else st.addNote(st.selectedPartId, st.selectedMeasureIndex, {
        pitch, duration: st.selectedDuration, dots: st.selectedDots || 0,
      })
    })
    return () => unsub()
  }, [])

  // Global keyboard handler
  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const st = () => useScoreStore.getState()

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

      if (selectedNoteId) {
        const selNote = st().getSelectedNote()
        if (!selNote?.isRest) {
          if (e.shiftKey && e.key === 'ArrowUp')   { e.preventDefault(); shiftPitchOctave(1);  return }
          if (e.shiftKey && e.key === 'ArrowDown')  { e.preventDefault(); shiftPitchOctave(-1); return }
          if (!e.shiftKey && e.key === 'ArrowUp')   { e.preventDefault(); shiftPitchStep(1);  return }
          if (!e.shiftKey && e.key === 'ArrowDown') { e.preventDefault(); shiftPitchStep(-1); return }
        }
        if (e.key === 'ArrowLeft')  { navigateNote(-1); return }
        if (e.key === 'ArrowRight') { navigateNote(1);  return }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !selNote?.isRest) {
          deleteNote(selectedPartId, selectedMeasureIndex, selectedNoteId); return
        }
        if (e.key === 'Escape') { clearNoteSelection(); return }
        if (selNote?.isRest && inputMode === 'note') {
          const step = KEY_TO_STEP[e.key.toLowerCase()]
          if (step) {
            fillSelectedRest({ step, octave: st().selectedOctave, accidental: null }); return
          }
          if (e.key === 'Enter' && st().selectedNote) {
            const n = st().selectedNote
            fillSelectedRest({ step: n.step, octave: st().selectedOctave, accidental: n.accidental }); return
          }
        }
      }

      if (selectedMeasureIndex !== null && !selectedNoteId) {
        if (e.key === 'Delete')    { clearMeasureColumn(selectedMeasureIndex); return }
        if (e.key === 'Backspace') { deleteLastNote(selectedPartId, selectedMeasureIndex); return }
      }

      if (inputMode === 'note' && selectedMeasureIndex !== null) {
        const step = KEY_TO_STEP[e.key.toLowerCase()]
        if (step) {
          const cur     = st()
          const selNote = cur.getSelectedNote()
          const pitch   = { step, octave: cur.selectedOctave, accidental: cur.selectedNote?.accidental ?? null }
          if ((e.shiftKey || cur.chordMode) && selectedNoteId && selNote && !selNote.isRest) {
            addChordNote(selectedPartId, selectedMeasureIndex, selectedNoteId, pitch); return
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
            addChordNote(selectedPartId, selectedMeasureIndex, selectedNoteId, pitch); return
          }
          if (selNote?.isRest) fillSelectedRest(pitch)
          else addNote(selectedPartId, selectedMeasureIndex, { pitch, duration: cur.selectedDuration, dots: cur.selectedDots || 0 })
          return
        }
      }

      if (e.key === 'n' || e.key === 'N') { setInputMode('note');   return }
      if (e.key === 's' || e.key === 'S') { setInputMode('select'); return }
      if (e.key === 'Escape')             { clearSelection(); setMeasureRange(null); setInputMode('select'); return }
      if (e.key === 'm' || e.key === 'M') { addMeasure(); return }
      if (e.key === 'p' || e.key === 'P') { setShowPiano(v => !v); return }
      if ((e.key === '3') && inputMode === 'note') { e.preventDefault(); insertTriplet(st().selectedDuration); return }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }

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

      if (e.key === 't' || e.key === 'T') { toggleTie(); return }
      if (e.shiftKey && e.key === 'S') { toggleSlurStart(); return }

      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp')    { e.preventDefault(); transposeSelection(1);   return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown')  { e.preventDefault(); transposeSelection(-1);  return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') { e.preventDefault(); transposeSelection(12);  return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft')  { e.preventDefault(); transposeSelection(-12); return }

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom + 0.1); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom(zoom - 0.1); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setZoom(1.0); return }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputMode, selectedDuration, selectedDots, selectedMeasureIndex, selectedPartId,
      selectedNoteId, selectedOctave, chordMode, addChordNote, undo, redo, copyMeasure,
      pasteMeasure, transposeSelection, toggleTie, toggleSlurStart, zoom, setZoom,
      setMeasureRange, insertTriplet])

  const handleContextMenu = e => {
    e.preventDefault()
    if (selectedMeasureIndex !== null)
      setContextMenu({ x: e.clientX, y: e.clientY, col: selectedMeasureIndex })
  }

  const liveNote = getSelectedNote()

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-100"}`}>

      {/* ── Sticky top chrome ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, flexShrink: 0 }}>

        {/* ── Menu bar ── */}
        <div className="bg-white border-b border-gray-200 flex items-center h-10 px-3 gap-1 shadow-sm">

          {/* Logo */}
          <span className="text-blue-600 font-bold text-sm mr-3 flex items-center gap-1.5">
            <span style={{ fontSize: 16 }}>🎼</span> FaithScore
          </span>

          {/* File menu */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowExportMenu(v => !v)}
              className="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors">
              File ▾
            </button>
            {showExportMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 100,
                background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 190, padding: 4,
              }} onMouseLeave={() => setShowExportMenu(false)}>
                {[
                  { label: '📄 Export MusicXML', action: () => { exportMusicXML(score); setShowExportMenu(false) } },
                  { label: '🎹 Export MIDI',      action: () => { exportMIDI(score);     setShowExportMenu(false) } },
                  { label: '🖨️  Print / PDF',      action: () => { printScore(score);    setShowExportMenu(false) } },
                  { label: '📂 New Score',         action: () => { if(confirm('Discard current score and start fresh?')) { clearSavedScore(); window.location.reload() } } },
                ].map(item => (
                  <button key={item.label} onClick={item.action}
                    style={{ display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 12px', fontSize: 12, border: 'none', background: 'none',
                      cursor: 'pointer', borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background='none'}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {['Edit','Add','Format','View','Tools'].map(m => (
            <button key={m} className="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors">{m}</button>
          ))}

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
            <button onClick={rewind}
              className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-100 text-gray-600 text-xs transition-colors">⏮</button>
            <button onClick={isPlaying ? pause : handlePlay}
              className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition-colors
                ${isPlaying ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={stop}
              className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-100 text-gray-600 text-xs transition-colors">⏹</button>
            <button onClick={() => { const v = toggleMetronome(); setMetronomeOn(v) }}
              title="Metronome"
              className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors
                ${metronomeOn ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
              𝅘
            </button>
            <button onClick={() => setShowPiano(v => !v)} title="Toggle piano keyboard (P)"
              className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors
                ${showPiano ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
              🎹
            </button>
            <button onClick={() => { const v = toggleLoop(); setLoopOn(v) }} title="Loop playback"
              className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors
                ${loopOn ? 'bg-green-100 border-green-400 text-green-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
              🔁
            </button>
            {samplesLoading ? (
              <span className="text-amber-500 text-xs ml-1 animate-pulse" title="Loading piano samples…">🎹 loading…</span>
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
            localStorage.setItem('faithscore_dark', next ? '1' : '0')
            document.documentElement.classList.toggle('dark', next)
          }}
            title="Toggle dark mode"
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-100 text-xs mr-2">
            {darkMode ? '☀️' : '🌙'}
          </button>

          {/* ── Part manager with instrument picker ── */}
          <div className="flex items-center gap-1.5">
            {/* Add Part button with dropdown */}
            <div style={{ position: 'relative' }} ref={addPartRef}>
              <button onClick={() => setShowAddPartMenu(v => !v)}
                className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-2.5 py-1 rounded transition-colors">
                + Part ▾
              </button>
              {showAddPartMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, zIndex: 100,
                  background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 200,
                  padding: 4, maxHeight: 320, overflowY: 'auto',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af',
                    padding: '4px 10px 2px', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Add Instrument
                  </div>
                  {INSTRUMENTS.map(instr => (
                    <button key={instr.id}
                      onClick={() => {
                        addPart(instr.defaultClef, instr.label, instr.id)
                        setShowAddPartMenu(false)
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', textAlign: 'left', padding: '5px 10px',
                        fontSize: 12, border: 'none', background: 'none', cursor: 'pointer',
                        borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background='none'}>
                      <span style={{ fontSize: 11, color: '#9ca3af', width: 38 }}>
                        {instr.defaultClef === 'bass' ? '𝄢 bass' : '𝄞 treble'}
                      </span>
                      {instr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Part chips */}
            {score.parts.map(p => {
              const instrInfo = INSTRUMENTS.find(i => i.id === p.instrument)
              return (
                <div key={p.id}
                  className={`flex items-center gap-0.5 border rounded px-1.5 py-0.5 text-xs bg-white
                    ${p.id === selectedPartId ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}>
                  {/* Instrument selector */}
                  <select
                    value={p.instrument || 'piano'}
                    onChange={e => setPartInstrument(p.id, e.target.value)}
                    title="Change instrument"
                    style={{ border: 'none', background: 'transparent', fontSize: 11,
                      color: '#374151', cursor: 'pointer', outline: 'none',
                      maxWidth: 90, padding: 0 }}>
                    {INSTRUMENTS.map(i => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                  </select>
                  {score.parts.length > 1 && (
                    <>
                      <button onClick={() => movePartUp(p.id)}
                        className="text-gray-400 hover:text-gray-700 leading-none px-0.5"
                        title="Move part up">↑</button>
                      <button onClick={() => movePartDown(p.id)}
                        className="text-gray-400 hover:text-gray-700 leading-none px-0.5"
                        title="Move part down">↓</button>
                      <button onClick={() => { if(confirm(`Remove "${p.name}"?`)) removePart(p.id) }}
                        className="text-red-400 hover:text-red-600 ml-0.5 leading-none"
                        title="Remove part">✕</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
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

          <button onClick={toggleTie} title="Toggle tie on selected note (T)"
            className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-2.5 py-1.5 rounded transition-colors">
            ⌢ Tie
          </button>
          <button onClick={toggleSlurStart} title="Toggle slur (Shift+S)"
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
        <Sidebar />

        {/* ── Score canvas — A4 page layout ── */}
        <main className="flex-1 overflow-auto bg-gray-300 p-6" id="score-main"
          style={{ paddingBottom: showPiano ? 180 : 48 }}>
          <div style={{ display: 'flex', justifyContent: 'center', minHeight: `${1556 * zoom}px` }}>
            <div style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              width: '100%', maxWidth: 1100, flexShrink: 0,
            }}>
              <div
                className="score-page bg-white mx-auto shadow-lg"
                style={{
                  width: '100%', maxWidth: 1100,
                  minHeight: 1556,
                  padding: '60px 60px 60px 60px',
                  marginBottom: 24, boxSizing: 'border-box', position: 'relative',
                }}
                onContextMenu={handleContextMenu}
              >
                {/* Score header */}
                <div data-print-header="1" style={{
                  textAlign: 'center', marginBottom: 20,
                  borderBottom: '1px solid #e5e7eb', paddingBottom: 12,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Times New Roman, serif', color: '#111', margin: 0 }}>
                    {score.title || 'Untitled Score'}
                  </div>
                  {score.composer && (
                    <div style={{ fontSize: 13, color: '#555', textAlign: 'right', fontFamily: 'Times New Roman, serif', margin: '4px 0 0' }}>
                      {score.composer}
                    </div>
                  )}
                </div>

                {/* Score notation */}
                <div style={{ width: '100%', overflow: 'visible' }}>
                  <ScoreRenderer />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ── Piano keyboard ── */}
      {showPiano && (
        <div style={{
          position: 'fixed', bottom: 32, left: 0, right: 0,
          zIndex: 59, boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        }}>
          <PianoKeyboard />
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 32, background: '#1e293b', borderTop: '1px solid #334155',
        display: 'flex', alignItems: 'center', padding: '0 12px',
        zIndex: 60, gap: 8,
      }}>
        <button onClick={() => setShowPiano(v => !v)} title="Toggle piano keyboard (P)"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '2px 10px', borderRadius: 4, border: 'none',
            background: showPiano ? '#3b82f6' : '#334155',
            color: showPiano ? 'white' : '#94a3b8',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
          }}>
          🎹 Piano Keyboard {showPiano ? '▲' : '▼'}
        </button>
        <span style={{ color: '#475569', fontSize: 10 }}>
          Press P to toggle · Click key to insert note
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#334155', fontSize: 10, fontWeight: 600 }}>FaithScore v1.0</span>
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