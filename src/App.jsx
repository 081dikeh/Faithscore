// src/App.jsx
import { useEffect, useState, useRef } from 'react'
import Toolbar from './components/Toolbar'
import ScoreRenderer from './components/ScoreRenderer'
import NoteEditor from './components/NoteEditor'
import { useScoreStore } from './store/scoreStore'
import { usePlayback } from './hooks/usePlayback'

const DURATION_KEYS = { '1':'w','2':'h','3':'q','4':'8','5':'16','6':'32' }
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
  const getSelectedNote        = useScoreStore(s => s.getSelectedNote)

  const addNote                = useScoreStore(s => s.addNote)
  const addMeasure             = useScoreStore(s => s.addMeasure)
  const deleteLastNote         = useScoreStore(s => s.deleteLastNote)
  const deleteNote             = useScoreStore(s => s.deleteNote)
  const addPart                = useScoreStore(s => s.addPart)
  const removePart             = useScoreStore(s => s.removePart)
  const clearMeasureColumn     = useScoreStore(s => s.clearMeasureColumn)
  const deleteMeasureColumn    = useScoreStore(s => s.deleteMeasureColumn)
  const setInputMode           = useScoreStore(s => s.setInputMode)
  const setDuration            = useScoreStore(s => s.setDuration)
  const setSelectedDots        = useScoreStore(s => s.setSelectedDots)
  const setChordMode           = useScoreStore(s => s.setChordMode)
  const navigateNote           = useScoreStore(s => s.navigateNote)
  const shiftPitchHalfStep     = useScoreStore(s => s.shiftPitchHalfStep)
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

  const { play, pause, stop, rewind } = usePlayback()

  const [contextMenu, setContextMenu] = useState(null)
  const ctxRef = useRef(null)

  // Close context menu on outside click
  useEffect(() => {
    const h = e => { if (ctxRef.current && !ctxRef.current.contains(e.target)) setContextMenu(null) }
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
          if (e.shiftKey && e.key === 'ArrowUp')   { e.preventDefault(); shiftPitchHalfStep(1);  return }
          if (e.shiftKey && e.key === 'ArrowDown')  { e.preventDefault(); shiftPitchHalfStep(-1); return }
          if (!e.shiftKey && e.key === 'ArrowUp')   { e.preventDefault(); shiftPitchStep(1);  return }
          if (!e.shiftKey && e.key === 'ArrowDown') { e.preventDefault(); shiftPitchStep(-1); return }
        }

        if (e.key === 'ArrowLeft')  { navigateNote(-1); return }
        if (e.key === 'ArrowRight') { navigateNote(1);  return }

        if ((e.key === 'Delete' || e.key === 'Backspace') && !selNote?.isRest) {
          deleteNote(selectedPartId, selectedMeasureIndex, selectedNoteId)
          return
        }
        if (e.key === 'Escape') { clearNoteSelection(); return }

        // Rest selected + note key → fill it
        if (selNote?.isRest && inputMode === 'note') {
          const step = KEY_TO_STEP[e.key.toLowerCase()]
          if (step) {
            fillSelectedRest({ step, octave: st().selectedOctave, accidental: null })
            return
          }
          if (e.key === 'Enter' && st().selectedNote) {
            const n = st().selectedNote
            fillSelectedRest({ step: n.step, octave: st().selectedOctave, accidental: n.accidental })
            return
          }
        }
      }

      // ── No note selected, measure selected ──
      if (selectedMeasureIndex !== null && !selectedNoteId) {
        if (e.key === 'Delete')    { clearMeasureColumn(selectedMeasureIndex); return }
        if (e.key === 'Backspace') { deleteLastNote(selectedPartId, selectedMeasureIndex); return }
      }

      // ── Note input: A–G ──
      if (inputMode === 'note' && selectedMeasureIndex !== null) {
        const step = KEY_TO_STEP[e.key.toLowerCase()]
        if (step) {
          const cur = st()
          const selNote = cur.getSelectedNote()
          const pitch   = { step, octave: cur.selectedOctave, accidental: null }
          if (selNote?.isRest) fillSelectedRest(pitch)
          else addNote(selectedPartId, selectedMeasureIndex, { pitch, duration: cur.selectedDuration, dots: cur.selectedDots || 0 })
          return
        }
        if (e.key === 'Enter' && st().selectedNote) {
          const cur = st()
          const n   = cur.selectedNote
          const pitch = { step: n.step, octave: cur.selectedOctave, accidental: n.accidental }
          const selNote = cur.getSelectedNote()
          if (selNote?.isRest) fillSelectedRest(pitch)
          else addNote(selectedPartId, selectedMeasureIndex, { pitch, duration: cur.selectedDuration, dots: cur.selectedDots || 0 })
          return
        }
      }

      // ── Global shortcuts ──
      if (e.key === 'n' || e.key === 'N') { setInputMode('note');   return }
      if (e.key === 's' || e.key === 'S') { setInputMode('select'); return }
      if (e.key === 'Escape')             { clearSelection(); setInputMode('select'); return }
      if (e.key === 'm' || e.key === 'M') { addMeasure(); return }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputMode, selectedDuration, selectedDots, selectedMeasureIndex, selectedPartId, selectedNoteId, selectedOctave, chordMode])

  const handleContextMenu = e => {
    e.preventDefault()
    if (selectedMeasureIndex !== null)
      setContextMenu({ x: e.clientX, y: e.clientY, col: selectedMeasureIndex })
  }

  const liveNote = getSelectedNote()

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">

      {/* ── Top menu bar ── */}
      <div className="bg-white border-b border-gray-200 flex items-center h-10 px-3 gap-1 flex-shrink-0 shadow-sm">
        <span className="text-blue-600 font-bold text-sm mr-3">🎵 ScoreAI</span>
        {['File','Edit','Add','Format','View','Tools'].map(m => (
          <button key={m} className="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors">{m}</button>
        ))}

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
            onClick={isPlaying ? pause : play}
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
          {/* Beat counter */}
          <span className="text-gray-400 text-xs ml-1 font-mono w-10">
            {playbackBeat !== null && playbackBeat !== undefined
              ? `${Math.floor(playbackBeat / 4)}:${(Math.floor(playbackBeat) % 4) + 1}`
              : '0:1'}
          </span>
        </div>

        {/* Part manager */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => addPart('treble')} className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-2.5 py-1 rounded transition-colors">+ Treble</button>
          <button onClick={() => addPart('bass')}   className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-100 px-2.5 py-1 rounded transition-colors">+ Bass</button>
          {score.parts.map(p => (
            <div key={p.id} className="flex items-center gap-1 border border-gray-300 rounded px-2 py-0.5 text-xs bg-white">
              <span className="text-gray-600">{p.name}</span>
              {score.parts.length > 1 && (
                <button onClick={() => removePart(p.id)} className="text-red-400 hover:text-red-600 ml-1 leading-none">✕</button>
              )}
            </div>
          ))}
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
          ['J','Chord'], ['↑↓','Step'], ['⇧↑↓','Half-step'],
          ['←→','Navigate'], ['Del','Delete note'], ['M','Add bar'],
          ['Right-click','Bar menu'],
        ].map(([k,v]) => (
          <span key={k}>
            <kbd className="bg-gray-100 border border-gray-300 px-1 py-0.5 rounded text-gray-600 font-mono">{k}</kbd>
            {' '}{v}
          </span>
        ))}
      </div>

      {/* ── Note editor panel ── */}
      <NoteEditor />

      {/* ── Score canvas ── */}
      <main className="flex-1 overflow-auto p-6">
        <div className="bg-white mx-auto shadow-lg rounded"
          style={{ maxWidth: 1100, minHeight: 640 }}
          onContextMenu={handleContextMenu}>

          {/* Score header */}
          <div className="pt-10 pb-3 px-10 text-center border-b border-gray-100">
            <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'Times New Roman, serif' }}>
              {score.title || 'Untitled Score'}
            </h1>
            {score.composer && (
              <p className="text-sm text-gray-500 mt-1 text-right pr-2" style={{ fontFamily: 'Times New Roman, serif' }}>
                {score.composer}
              </p>
            )}
          </div>

          {/* Score notation */}
          <div className="px-6 py-6 overflow-x-visible">
            <ScoreRenderer />
          </div>
        </div>
      </main>

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
