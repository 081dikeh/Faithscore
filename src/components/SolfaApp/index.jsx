// src/components/SolfaApp/index.jsx
// FaithScore — Standalone Solfa Editor

import { useState, useEffect, useRef, useCallback } from 'react'
import SolfaRenderer from '../SolfaRenderer'
import { useSolfaStore, VOICE_COMBOS } from '../../store/solfaStore'
import { supabase } from '../../lib/supabase'

const SYLLABLES = ['d','r','m','f','s','l','t']
const CHROMATIC = ['de','ri','fe','se','ta']
const KEYS      = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']
const DURATIONS = [
  { label:'2',  v:2,    title:'Double note (2 beats) — key 1' },
  { label:'1',  v:1,    title:'One beat — key 2' },
  { label:'½',  v:0.5,  title:'Half beat — key 3' },
  { label:'¼',  v:0.25, title:'Quarter beat — key 4' },
]

export default function SolfaApp({ user, onGoHome }) {
  // ── Store ────────────────────────────────────────────────────────────────────
  const score              = useSolfaStore(s => s.score)
  const inputMode          = useSolfaStore(s => s.inputMode)
  const selDuration        = useSolfaStore(s => s.selectedDuration)
  const selOctave          = useSolfaStore(s => s.selectedOctave)
  const selectedNoteId     = useSolfaStore(s => s.selectedNoteId)
  const selectedPartId     = useSolfaStore(s => s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)

  const setInputMode       = useSolfaStore(s => s.setInputMode)
  const setDuration        = useSolfaStore(s => s.setSelectedDuration)
  const setTitle           = useSolfaStore(s => s.setTitle)
  const setKey             = useSolfaStore(s => s.setKey)
  const placeNote          = useSolfaStore(s => s.placeNote)
  const placeSustain       = useSolfaStore(s => s.placeSustain)
  const setLyric           = useSolfaStore(s => s.setLyric)
  const addMeasure         = useSolfaStore(s => s.addMeasure)
  const deleteMeasure      = useSolfaStore(s => s.deleteMeasure)
  const undo               = useSolfaStore(s => s.undo)
  const selectNote         = useSolfaStore(s => s.selectNote)
  const navigateNote       = useSolfaStore(s => s.navigateNote)
  const changeNoteOctave   = useSolfaStore(s => s.changeNoteOctave)

  // ── Octave setter: updates store + re-stamps selected note ───────────────────
  const setOctave = useCallback((o) => {
    useSolfaStore.getState().setSelectedOctave(o)
    const st = useSolfaStore.getState()
    if (st.selectedNoteId && st.selectedPartId !== null && st.selectedMeasureIdx !== null) {
      useSolfaStore.getState().changeNoteOctave(
        st.selectedPartId, st.selectedMeasureIdx, st.selectedNoteId, o
      )
    }
  }, [])

  // ── Local state ─────────────────────────────────────────────────────────────
  const [showChromatic, setShowChromatic] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [saveMsg, setSaveMsg]             = useState('')
  const [lyricModal, setLyricModal]       = useState(null)
  const lyricInputRef                     = useRef(null)
  const [zoom, setZoom]                   = useState(1.0)

  // Cursor = where the next note will be inserted
  const [cursor, setCursor] = useState({ partId:null, measureIdx:0, beatPos:0 })

  // Sync cursor to whatever note is selected
  useEffect(() => {
    if (!selectedNoteId || !selectedPartId || selectedMeasureIdx === null) return
    const part    = score.parts.find(p => p.id === selectedPartId)
    const note    = part?.measures[selectedMeasureIdx]?.notes.find(n => n.id === selectedNoteId)
    if (note) setCursor({ partId: selectedPartId, measureIdx: selectedMeasureIdx, beatPos: note.beatPos })
  }, [selectedNoteId, selectedPartId, selectedMeasureIdx])

  useEffect(() => {
    if (lyricModal) setTimeout(() => lyricInputRef.current?.focus(), 50)
  }, [lyricModal])

  // ── Note insertion ───────────────────────────────────────────────────────────
  function getInsertTarget() {
    if (cursor.partId) return cursor
    if (selectedPartId && selectedMeasureIdx !== null) {
      const part = score.parts.find(p => p.id === selectedPartId)
      const note = part?.measures[selectedMeasureIdx]?.notes.find(n => n.id === selectedNoteId)
      if (note) return { partId: selectedPartId, measureIdx: selectedMeasureIdx, beatPos: note.beatPos }
    }
    return { partId: score.parts[0]?.id, measureIdx: 0, beatPos: 0 }
  }

  function advanceCursor(partId, measureIdx, beatPos, duration) {
    const part     = score.parts.find(p => p.id === partId)
    const maxBeats = part?.measures[measureIdx]?.timeSignature?.beats || 4
    const newBeat  = beatPos + duration

    if (newBeat >= maxBeats - 0.001) {
      const nextM = measureIdx + 1
      if (nextM < (part?.measures?.length || 0)) {
        setCursor({ partId, measureIdx: nextM, beatPos: 0 })
        const nextNote = useSolfaStore.getState().score.parts
          .find(p => p.id === partId)?.measures[nextM]?.notes[0]
        if (nextNote) selectNote(nextNote.id, partId, nextM)
      }
    } else {
      setCursor({ partId, measureIdx, beatPos: newBeat })
      const updNote = useSolfaStore.getState().score.parts
        .find(p => p.id === partId)?.measures[measureIdx]?.notes
        .find(n => Math.abs(n.beatPos - newBeat) < 0.01)
      if (updNote) selectNote(updNote.id, partId, measureIdx)
    }
  }

  function insertSyllable(syl) {
    const { partId, measureIdx, beatPos } = getInsertTarget()
    if (!partId) return
    const st = useSolfaStore.getState()
    placeNote(partId, measureIdx, beatPos, syl, st.selectedOctave, st.selectedDuration)
    advanceCursor(partId, measureIdx, beatPos, st.selectedDuration)
  }

  function insertSustain() {
    const { partId, measureIdx, beatPos } = getInsertTarget()
    if (!partId) return
    const dur = useSolfaStore.getState().selectedDuration
    placeSustain(partId, measureIdx, beatPos, dur)
    advanceCursor(partId, measureIdx, beatPos, dur)
  }

  function insertRest() {
    const { partId, measureIdx, beatPos } = getInsertTarget()
    if (!partId) return
    const dur = useSolfaStore.getState().selectedDuration
    placeNote(partId, measureIdx, beatPos, null, 0, dur)
    advanceCursor(partId, measureIdx, beatPos, dur)
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Escape')              { setInputMode('select'); return }
      if (e.key === 'n' || e.key === 'N') { setInputMode('note');   return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return }

      // Duration
      if (e.key === '1') { setDuration(2);    return }
      if (e.key === '2') { setDuration(1);    return }
      if (e.key === '3') { setDuration(0.5);  return }
      if (e.key === '4') { setDuration(0.25); return }

      // Octave  , = lower  . = middle  ' = upper
      if (e.key === ',') { setOctave(-1); return }
      if (e.key === '.') { setOctave(0);  return }
      if (e.key === "'") { setOctave(1);  return }

      // Bar management
      if (e.key === 'm' || e.key === 'M')                 { addMeasure();    return }
      if (e.key === 'Backspace' || e.key === 'Delete')    { e.preventDefault(); deleteMeasure(); return }

      // Arrow navigation
      if (e.key === 'ArrowRight') { e.preventDefault(); navigateNote('right'); return }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateNote('left');  return }
      if (e.key === 'ArrowDown')  { e.preventDefault(); navigateNote('down');  return }
      if (e.key === 'ArrowUp')    { e.preventDefault(); navigateNote('up');    return }

      // Note entry (only in note mode)
      if (inputMode === 'note') {
        const map = { d:'d', r:'r', m:'m', f:'f', s:'s', l:'l', t:'t' }
        if (map[e.key.toLowerCase()]) { e.preventDefault(); insertSyllable(map[e.key.toLowerCase()]); return }
        if (e.key === '-') { insertSustain(); return }
        if (e.key === ' ') { e.preventDefault(); insertRest(); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputMode, cursor]) // eslint-disable-line

  // ── Cloud save ───────────────────────────────────────────────────────────────
  async function saveToCloud() {
    if (!user) return
    setSaving(true); setSaveMsg('')
    try {
      const payload = { user_id: user.id, title: score.title || 'Untitled', data: score }
      if (score._cloudId) {
        await supabase.from('scores')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', score._cloudId).eq('user_id', user.id)
      } else {
        const { data } = await supabase.from('scores').insert([payload]).select('id').single()
        if (data?.id) useSolfaStore.getState().setCloudId(data.id)
      }
      setSaveMsg('Saved ✓')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch { setSaveMsg('Save failed') }
    setSaving(false)
  }

  // ── Selected note (for live octave display) ──────────────────────────────────
  const selectedNote = (() => {
    if (!selectedNoteId || !selectedPartId || selectedMeasureIdx === null) return null
    return score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIdx]?.notes.find(n => n.id === selectedNoteId) || null
  })()
  const displayOctave = selectedNote?.type === 'note' ? selectedNote.octave : selOctave

  const comboInfo = VOICE_COMBOS[score.voiceCombo] || VOICE_COMBOS.satb

  // ── Shared button style ──────────────────────────────────────────────────────
  const btnStyle = ({ active, color = '#2563eb', danger, small } = {}) => ({
    padding:      small ? '2px 8px' : '4px 11px',
    fontSize:     small ? 11 : 12,
    fontWeight:   active ? 700 : 500,
    border:       `1px solid ${danger ? '#fca5a5' : active ? color : '#d1d5db'}`,
    background:   danger ? '#fef2f2' : active ? color + '18' : 'white',
    color:        danger ? '#dc2626' : active ? color : '#374151',
    borderRadius: 5,
    cursor:       'pointer',
    transition:   'all 0.1s',
    fontFamily:   '"Times New Roman", serif',
    lineHeight:   1.2,
  })

  const Sep = () => <div style={{ width:1, height:20, background:'#e5e7eb', flexShrink:0 }}/>

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column',
      background:'#f3f4f6', fontFamily:'system-ui, sans-serif' }}>

      {/* ── Menu bar ── */}
      <div style={{ background:'white', borderBottom:'1px solid #e5e7eb',
        display:'flex', alignItems:'center', height:42, padding:'0 12px',
        gap:8, flexShrink:0, boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
        position:'sticky', top:0, zIndex:50 }}>

        <button onClick={onGoHome}
          style={{ display:'flex', alignItems:'center', gap:6, background:'none',
            border:'none', cursor:'pointer', padding:'3px 8px', borderRadius:5,
            fontWeight:700, fontSize:13, color:'#2563eb' }}
          onMouseEnter={e => e.currentTarget.style.background='#eff6ff'}
          onMouseLeave={e => e.currentTarget.style.background='none'}>
          <img src="/FaithScore_logo.png" alt="" style={{ height:20, width:'auto' }}/>
          FaithScore
        </button>

        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4,
          background:'#fef3c7', color:'#92400e', letterSpacing:'0.05em' }}>
          SOLFA · {comboInfo.label}
        </span>

        <Sep/>

        <input value={score.title} onChange={e => setTitle(e.target.value)}
          style={{ border:'none', borderBottom:'1px solid #d1d5db', outline:'none',
            fontSize:14, fontWeight:600, color:'#1e2433', width:200, background:'transparent' }}
          placeholder="Score title"/>

        <div style={{ flex:1 }}/>

        <button onClick={undo} title="Undo (Ctrl+Z)"
          style={{ width:28, height:28, border:'1px solid #e5e7eb', borderRadius:5,
            background:'white', cursor:'pointer', fontSize:13, color:'#6b7280' }}>↩</button>

        {/* Zoom */}
        <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
          style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
            background:'white', cursor:'pointer', fontSize:13, color:'#6b7280' }}>−</button>
        <span style={{ fontSize:11, color:'#9ca3af', minWidth:32, textAlign:'center' }}>
          {Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(2, z + 0.1))}
          style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
            background:'white', cursor:'pointer', fontSize:13, color:'#6b7280' }}>+</button>

        <Sep/>

        {saveMsg && <span style={{ fontSize:11, color: saveMsg.includes('fail') ? '#dc2626':'#16a34a' }}>{saveMsg}</span>}
        <button onClick={saveToCloud} disabled={saving || !user}
          style={{ padding:'4px 14px', fontSize:12, fontWeight:600,
            background: saving ? '#93c5fd' : '#2563eb', color:'white',
            border:'none', borderRadius:6, cursor: saving||!user ? 'not-allowed':'pointer' }}>
          {saving ? 'Saving…' : '☁ Save'}
        </button>

        {user && (
          <div style={{ width:26, height:26, borderRadius:'50%',
            background:'linear-gradient(135deg,#2563eb,#7c3aed)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:11, fontWeight:700, color:'white' }}>
            {(user.user_metadata?.full_name || user.email || '?')[0].toUpperCase()}
          </div>
        )}
      </div>

      {/* ── Input toolbar ── */}
      <div style={{ background:'white', borderBottom:'1px solid #e5e7eb',
        padding:'5px 14px', display:'flex', flexWrap:'wrap',
        alignItems:'center', gap:7, flexShrink:0 }}>

        {/* Mode */}
        <div style={{ display:'flex', gap:3 }}>
          <button style={btnStyle({ active: inputMode==='select' })}
            onClick={() => setInputMode('select')} title="Select (Esc)">○ Select</button>
          <button style={btnStyle({ active: inputMode==='note', color:'#16a34a' })}
            onClick={() => setInputMode('note')} title="Note input (N)">● Note</button>
        </div>

        <Sep/>

        {/* Syllable buttons */}
        <div style={{ display:'flex', gap:2, alignItems:'center' }}>
          {SYLLABLES.map(syl => (
            <button key={syl}
              onClick={() => { if (inputMode === 'note') insertSyllable(syl) }}
              title={`${syl}  (keyboard: ${syl})`}
              style={{
                width:26, height:26, border:'1px solid #d1d5db', borderRadius:4,
                cursor: inputMode==='note' ? 'pointer':'not-allowed',
                background: inputMode==='note' ? 'white':'#f9fafb',
                fontSize:14, fontWeight:600,
                color: inputMode==='note' ? '#1e2433':'#c0c0c0',
                fontFamily:'"Times New Roman",serif',
              }}>
              {syl}
            </button>
          ))}

          <button onClick={() => setShowChromatic(v => !v)} title="Chromatic"
            style={{ padding:'0 7px', height:26, border:'1px solid #d1d5db',
              borderRadius:4, cursor:'pointer',
              background: showChromatic ? '#fef3c7':'white', fontSize:10, color:'#6b7280' }}>
            ♯♭
          </button>

          {showChromatic && CHROMATIC.map(syl => (
            <button key={syl}
              onClick={() => { if (inputMode==='note') insertSyllable(syl) }}
              style={{ padding:'0 7px', height:26, border:'1px solid #fbbf24',
                borderRadius:4, cursor:'pointer', background:'#fef3c7',
                fontSize:12, fontWeight:600, color:'#92400e',
                fontFamily:'"Times New Roman",serif' }}>
              {syl}
            </button>
          ))}
        </div>

        <Sep/>

        {/* Rest / Hold */}
        <div style={{ display:'flex', gap:3 }}>
          <button style={btnStyle({ small:true })} onClick={insertRest} title="Rest (Space)">○ Rest</button>
          <button style={btnStyle({ small:true })} onClick={insertSustain} title="Hold – (key: -)">– Hold</button>
        </div>

        <Sep/>

        {/* Duration */}
        <div style={{ display:'flex', alignItems:'center', gap:3 }}>
          <span style={{ fontSize:10, color:'#6b7280' }}>Dur:</span>
          {DURATIONS.map(d => (
            <button key={d.v} style={btnStyle({ active: selDuration===d.v, small:true })}
              onClick={() => setDuration(d.v)} title={d.title}>
              {d.label}
            </button>
          ))}
        </div>

        <Sep/>

        {/* Octave — shows d, / d / d' with real solfa notation */}
        <div style={{ display:'flex', alignItems:'center', gap:3 }}>
          <span style={{ fontSize:10, color:'#6b7280' }}>Oct:</span>

          {/* Lower (d with underline) */}
          <button onClick={() => setOctave(-1)} title="Lower octave — line below note (key: ,)"
            style={{ ...btnStyle({ active: displayOctave===-1 }), fontFamily:'"Times New Roman",serif',
              fontSize:13, padding:'1px 10px', display:'flex', alignItems:'center', flexDirection:'column', gap:0 }}>
            <span style={{ lineHeight:1.1 }}>d</span>
            <span style={{ display:'block', height:1.5, width:10, background: displayOctave===-1 ? '#2563eb':'#374151', borderRadius:1 }}/>
          </button>

          {/* Middle (plain d) */}
          <button onClick={() => setOctave(0)} title="Middle octave — no mark (key: .)"
            style={{ ...btnStyle({ active: displayOctave===0 }), fontFamily:'"Times New Roman",serif',
              fontSize:13, padding:'2px 10px' }}>
            d
          </button>

          {/* Upper (d with overline) */}
          <button onClick={() => setOctave(1)} title="Upper octave — line above note (key: ')"
            style={{ ...btnStyle({ active: displayOctave===1 }), fontFamily:'"Times New Roman",serif',
              fontSize:13, padding:'1px 10px', display:'flex', alignItems:'center', flexDirection:'column', gap:0 }}>
            <span style={{ display:'block', height:1.5, width:10, background: displayOctave===1 ? '#2563eb':'#374151', borderRadius:1 }}/>
            <span style={{ lineHeight:1.1 }}>d</span>
          </button>
        </div>

        <Sep/>

        {/* Key selector */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ fontSize:10, color:'#6b7280', fontStyle:'italic' }}>Doh =</span>
          <select value={score.key || 'C'} onChange={e => setKey(e.target.value)}
            style={{ fontSize:12, border:'1px solid #d1d5db', borderRadius:5,
              padding:'2px 6px', background:'white', color:'#374151' }}>
            {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <Sep/>

        {/* Add / Delete bar */}
        <div style={{ display:'flex', gap:3 }}>
          <button style={btnStyle({ small:true })} onClick={addMeasure} title="Add bar (M)">+ Bar</button>
          <button style={btnStyle({ small:true, danger:true })} onClick={() => deleteMeasure()}
            title="Delete selected bar (Backspace)">− Bar</button>
        </div>
      </div>

      {/* ── Shortcuts hint ── */}
      <div style={{ background:'white', borderBottom:'1px solid #e5e7eb',
        padding:'2px 14px', display:'flex', gap:10, flexWrap:'wrap',
        fontSize:10, color:'#9ca3af', flexShrink:0 }}>
        {[
          ['N','Note mode'], ['Esc','Select'],
          ['d r m f s l t','Insert note'], ['Space','Rest'], ['–','Hold'],
          ["'","Upper (d̄)"], [',','Lower (d̲)'], ['.','Middle'],
          ['1–4','Duration'], ['←→','Next/prev note'], ['↑↓','Change voice'],
          ['M','Add bar'], ['⌫','Delete bar'], ['Ctrl+Z','Undo'],
        ].map(([k, v]) => (
          <span key={k}>
            <kbd style={{ background:'#f3f4f6', border:'1px solid #e5e7eb',
              padding:'1px 4px', borderRadius:3, fontFamily:'monospace', fontSize:9 }}>
              {k}
            </kbd>{' '}{v}
          </span>
        ))}
      </div>

      {/* ── Score canvas ── */}
      <main style={{ flex:1, overflowY:'auto', overflowX:'hidden',
        background:'#e5e7eb', padding:'24px' }}>
        <div style={{ transform:`scale(${zoom})`, transformOrigin:'top center',
          minHeight:`${1200 * zoom}px` }}>
          <div style={{ background:'white', maxWidth:1100, margin:'0 auto',
            minHeight:1200, padding:'48px 32px',
            boxShadow:'0 4px 20px rgba(0,0,0,0.1)',
            borderRadius:4, boxSizing:'border-box' }}>

            {/* Title */}
            <div style={{ textAlign:'center', marginBottom:24,
              paddingBottom:12, borderBottom:'2px solid #1e2433' }}>
              <div style={{ fontSize:26, fontWeight:700,
                fontFamily:'"Times New Roman",serif', color:'#111' }}>
                {score.title || 'Untitled Score'}
              </div>
            </div>

            <SolfaRenderer
              onSelectNote={(noteId, partId, measureIdx) => {
                useSolfaStore.getState().selectNote(noteId, partId, measureIdx)
                const note = score.parts.find(p => p.id === partId)
                  ?.measures[measureIdx]?.notes.find(n => n.id === noteId)
                if (note) setCursor({ partId, measureIdx, beatPos: note.beatPos })
              }}
              onLyricEdit={(noteId, partId, measureIdx, current) => {
                setLyricModal({ noteId, partId, measureIdx, current })
              }}
            />
          </div>
        </div>
      </main>

      {/* ── Lyric modal ── */}
      {lyricModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'white', borderRadius:10, padding:24,
            width:320, boxShadow:'0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:12, color:'#1e2433' }}>
              Edit lyric
            </div>
            <input ref={lyricInputRef}
              defaultValue={lyricModal.current}
              placeholder="Enter lyric syllable…"
              style={{ width:'100%', padding:'8px 12px', fontSize:14,
                border:'1px solid #d1d5db', borderRadius:6, outline:'none',
                boxSizing:'border-box' }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setLyric(lyricModal.partId, lyricModal.measureIdx, lyricModal.noteId, e.target.value.trim())
                  setLyricModal(null)
                }
                if (e.key === 'Escape') setLyricModal(null)
              }}/>
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
              <button onClick={() => setLyricModal(null)}
                style={{ padding:'6px 14px', border:'1px solid #d1d5db',
                  borderRadius:6, background:'white', cursor:'pointer', fontSize:13 }}>
                Cancel
              </button>
              <button onClick={() => {
                  setLyric(lyricModal.partId, lyricModal.measureIdx,
                    lyricModal.noteId, lyricInputRef.current?.value.trim())
                  setLyricModal(null)
                }}
                style={{ padding:'6px 14px', border:'none', borderRadius:6,
                  background:'#2563eb', color:'white', cursor:'pointer',
                  fontSize:13, fontWeight:600 }}>
                Set
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}