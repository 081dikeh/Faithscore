// src/components/SolfaApp/index.jsx
// FaithScore — Standalone Solfa Editor
// Completely separate from the staff notation editor.
// Has its own menu bar, toolbar, canvas, and state.

import { useState, useEffect, useRef } from 'react'
import SolfaRenderer from '../SolfaRenderer'
import { useSolfaStore, VOICE_COMBOS } from '../../store/solfaStore'
import { supabase } from '../../lib/supabase'

const SYLLABLES = ['d','r','m','f','s','l','t']
const CHROMATIC = ['de','ri','fe','se','ta']
const KEYS      = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']
const DURATIONS = [
  {label:'●●', v:2,    title:'Double (2 beats)'},
  {label:'●',  v:1,    title:'Beat (1 beat)'},
  {label:'◐',  v:0.5,  title:'Half beat (.)'},
  {label:'◑',  v:0.25, title:'Quarter beat (,)'},
]

export default function SolfaApp({user, onGoHome}) {
  const score        = useSolfaStore(s=>s.score)
  const inputMode    = useSolfaStore(s=>s.inputMode)
  const selDuration  = useSolfaStore(s=>s.selectedDuration)
  const selOctave    = useSolfaStore(s=>s.selectedOctave)
  const selectedNoteId = useSolfaStore(s=>s.selectedNoteId)
  const selectedPartId = useSolfaStore(s=>s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s=>s.selectedMeasureIdx)
  const setInputMode = useSolfaStore(s=>s.setInputMode)
  const setDuration  = useSolfaStore(s=>s.setSelectedDuration)
  const setOctave    = useSolfaStore(s=>s.setSelectedOctave)
  const setTitle     = useSolfaStore(s=>s.setTitle)
  const setKey       = useSolfaStore(s=>s.setKey)
  const placeNote    = useSolfaStore(s=>s.placeNote)
  const placeSustain = useSolfaStore(s=>s.placeSustain)
  const setLyric     = useSolfaStore(s=>s.setLyric)
  const addMeasure   = useSolfaStore(s=>s.addMeasure)
  const undo         = useSolfaStore(s=>s.undo)
  const selectNote   = useSolfaStore(s=>s.selectNote)

  const [showChromatic, setShowChromatic] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [saveMsg, setSaveMsg]             = useState('')
  const [lyricModal, setLyricModal]       = useState(null) // {noteId,partId,measureIdx,current}
  const lyricInputRef                     = useRef(null)
  const [zoom, setZoom]                   = useState(1.0)

  // Auto-advance cursor: track beat position
  const [cursor, setCursor] = useState({partId:null, measureIdx:0, beatPos:0})

  // Sync cursor to selected note
  useEffect(() => {
    if (selectedNoteId && selectedPartId !== null && selectedMeasureIdx !== null) {
      const part    = score.parts.find(p=>p.id===selectedPartId)
      const measure = part?.measures[selectedMeasureIdx]
      const note    = measure?.notes.find(n=>n.id===selectedNoteId)
      if (note) setCursor({partId:selectedPartId, measureIdx:selectedMeasureIdx, beatPos:note.beatPos})
    }
  }, [selectedNoteId, selectedPartId, selectedMeasureIdx])

  // Focus lyric input when modal opens
  useEffect(() => {
    if (lyricModal) setTimeout(()=>lyricInputRef.current?.focus(), 50)
  }, [lyricModal])

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      if (tag==='INPUT'||tag==='TEXTAREA') return

      if (e.key==='Escape') { setInputMode('select'); return }
      if (e.key==='n'||e.key==='N') { setInputMode('note'); return }
      if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo(); return }
      if (e.key==='m'||e.key==='M') { addMeasure(); return }

      // Duration keys
      if (e.key==='1') { setDuration(2);    return }
      if (e.key==='2') { setDuration(1);    return }
      if (e.key==='3') { setDuration(0.5);  return }
      if (e.key==='4') { setDuration(0.25); return }

      // Octave
      if (e.key===',') { setOctave(-1); return }
      if (e.key==='.') { setOctave(0);  return }
      if (e.key==="'") { setOctave(1);  return }

      // Note input via keyboard
      if (inputMode==='note' && cursor.partId) {
        const keyMap = {d:'d',r:'r',m:'m',f:'f',s:'s',l:'l',t:'t'}
        if (keyMap[e.key.toLowerCase()]) {
          e.preventDefault()
          insertSyllable(keyMap[e.key.toLowerCase()])
          return
        }
        if (e.key==='-') { insertSustain(); return }
        if (e.key===' ') { e.preventDefault(); insertRest(); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return ()=>window.removeEventListener('keydown', onKey)
  }, [inputMode, cursor, selDuration, selOctave])

  // ── Note insertion ──────────────────────────────────────────────────────────
  function getInsertTarget() {
    // Use cursor if set, otherwise use selected note position
    if (cursor.partId) return cursor
    if (selectedPartId && selectedMeasureIdx !== null) {
      const part    = score.parts.find(p=>p.id===selectedPartId)
      const measure = part?.measures[selectedMeasureIdx]
      const note    = measure?.notes.find(n=>n.id===selectedNoteId)
      if (note) return {partId:selectedPartId, measureIdx:selectedMeasureIdx, beatPos:note.beatPos}
    }
    // Default to first part, first measure, beat 0
    return {partId: score.parts[0]?.id, measureIdx:0, beatPos:0}
  }

  function advanceCursor(partId, measureIdx, beatPos, duration) {
    const part    = score.parts.find(p=>p.id===partId)
    const measure = part?.measures[measureIdx]
    const maxBeats = measure?.timeSignature?.beats || 4
    const newBeat = beatPos + duration

    if (newBeat >= maxBeats - 0.001) {
      // Advance to next measure
      const nextMIdx = measureIdx + 1
      if (nextMIdx < (part?.measures?.length||0)) {
        setCursor({partId, measureIdx:nextMIdx, beatPos:0})
        // Select first note of next measure
        const nextNote = part.measures[nextMIdx]?.notes[0]
        if (nextNote) selectNote(nextNote.id, partId, nextMIdx)
      }
    } else {
      setCursor({partId, measureIdx, beatPos:newBeat})
      // Select next note at new beat position
      const nextNote = measure?.notes.find(n=>Math.abs(n.beatPos-newBeat)<0.01)
      if (nextNote) selectNote(nextNote.id, partId, measureIdx)
    }
  }

  function insertSyllable(syl) {
    const {partId, measureIdx, beatPos} = getInsertTarget()
    if (!partId) return
    placeNote(partId, measureIdx, beatPos, syl, selOctave, selDuration)
    advanceCursor(partId, measureIdx, beatPos, selDuration)
  }

  function insertSustain() {
    const {partId, measureIdx, beatPos} = getInsertTarget()
    if (!partId) return
    placeSustain(partId, measureIdx, beatPos, selDuration)
    advanceCursor(partId, measureIdx, beatPos, selDuration)
  }

  function insertRest() {
    const {partId, measureIdx, beatPos} = getInsertTarget()
    if (!partId) return
    placeNote(partId, measureIdx, beatPos, null, 0, selDuration)
    advanceCursor(partId, measureIdx, beatPos, selDuration)
  }

  // ── Cloud save ──────────────────────────────────────────────────────────────
  async function saveToCloud() {
    if (!user) return
    setSaving(true); setSaveMsg('')
    try {
      const payload = {user_id:user.id, title:score.title||'Untitled', data:score}
      if (score._cloudId) {
        await supabase.from('scores').update({...payload, updated_at:new Date().toISOString()})
          .eq('id', score._cloudId).eq('user_id', user.id)
      } else {
        const {data} = await supabase.from('scores').insert([payload]).select('id').single()
        if (data?.id) useSolfaStore.getState().setCloudId(data.id)
      }
      setSaveMsg('Saved ✓')
      setTimeout(()=>setSaveMsg(''), 3000)
    } catch(e) { setSaveMsg('Save failed') }
    setSaving(false)
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────
  const Btn = ({label, active, onClick, title, color='#2563eb', small}) => (
    <button onClick={onClick} title={title} style={{
      padding: small ? '3px 8px' : '4px 12px',
      fontSize: small ? 11 : 12, fontWeight:active?700:500,
      border:`1px solid ${active?color:'#d1d5db'}`,
      background:active?color+'18':'white',
      color:active?color:'#374151',
      borderRadius:5, cursor:'pointer', transition:'all 0.1s',
      fontFamily:'"Times New Roman", serif',
    }}>{label}</button>
  )

  const comboInfo = VOICE_COMBOS[score.voiceCombo] || VOICE_COMBOS.satb

  return (
    <div style={{minHeight:'100vh', display:'flex', flexDirection:'column',
      background:'#f3f4f6', fontFamily:'system-ui, sans-serif'}}>

      {/* ── Menu bar ── */}
      <div style={{background:'white', borderBottom:'1px solid #e5e7eb',
        display:'flex', alignItems:'center', height:42, padding:'0 12px',
        gap:8, flexShrink:0, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', position:'sticky', top:0, zIndex:50}}>

        {/* Logo + back */}
        <button onClick={onGoHome}
          style={{display:'flex',alignItems:'center',gap:6,background:'none',
            border:'none',cursor:'pointer',padding:'3px 8px',borderRadius:5,
            fontWeight:700,fontSize:13,color:'#2563eb'}}
          onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
          onMouseLeave={e=>e.currentTarget.style.background='none'}>
          <img src="/FaithScore_logo.png" alt="" style={{height:20,width:'auto'}}/>
          FaithScore
        </button>

        {/* Mode badge */}
        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,
          background:'#fef3c7',color:'#92400e',letterSpacing:'0.05em'}}>
          SOLFA · {comboInfo.label}
        </span>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Title input */}
        <input value={score.title} onChange={e=>setTitle(e.target.value)}
          style={{border:'none',borderBottom:'1px solid #d1d5db',outline:'none',
            fontSize:14,fontWeight:600,color:'#1e2433',width:200,background:'transparent'}}
          placeholder="Score title"/>

        <div style={{flex:1}}/>

        {/* Undo */}
        <button onClick={undo} title="Undo (Ctrl+Z)"
          style={{width:28,height:28,border:'1px solid #e5e7eb',borderRadius:5,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>↩</button>

        {/* Zoom */}
        <button onClick={()=>setZoom(z=>Math.max(0.5,z-0.1))}
          style={{width:24,height:24,border:'1px solid #e5e7eb',borderRadius:4,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>−</button>
        <span style={{fontSize:11,color:'#9ca3af',minWidth:32,textAlign:'center'}}>
          {Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(z=>Math.min(2,z+0.1))}
          style={{width:24,height:24,border:'1px solid #e5e7eb',borderRadius:4,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>+</button>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Save */}
        {saveMsg && <span style={{fontSize:11,color:saveMsg.includes('fail')?'#dc2626':'#16a34a'}}>{saveMsg}</span>}
        <button onClick={saveToCloud} disabled={saving||!user}
          style={{padding:'4px 14px',fontSize:12,fontWeight:600,
            background:saving?'#93c5fd':'#2563eb',color:'white',
            border:'none',borderRadius:6,cursor:saving||!user?'not-allowed':'pointer'}}>
          {saving?'Saving…':'☁ Save'}
        </button>

        {/* User badge */}
        {user && <div style={{display:'flex',alignItems:'center',gap:4}}>
          <div style={{width:26,height:26,borderRadius:'50%',
            background:'linear-gradient(135deg,#2563eb,#7c3aed)',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:11,fontWeight:700,color:'white'}}>
            {(user.user_metadata?.full_name||user.email||'?')[0].toUpperCase()}
          </div>
        </div>}
      </div>

      {/* ── Input toolbar ── */}
      <div style={{background:'white',borderBottom:'1px solid #e5e7eb',
        padding:'6px 14px',display:'flex',flexWrap:'wrap',
        alignItems:'center',gap:8,flexShrink:0}}>

        {/* Mode */}
        <div style={{display:'flex',gap:3}}>
          <Btn label="○ Select" active={inputMode==='select'} onClick={()=>setInputMode('select')} title="Select mode (Esc)"/>
          <Btn label="● Note" active={inputMode==='note'} onClick={()=>setInputMode('note')} title="Note input (N)" color="#16a34a"/>
        </div>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Syllable buttons */}
        <div style={{display:'flex',gap:2,flexWrap:'wrap'}}>
          {SYLLABLES.map(syl=>(
            <button key={syl} onClick={()=>insertSyllable(syl)}
              disabled={inputMode!=='note'}
              title={`Insert ${syl} (key: ${syl})`}
              style={{width:28,height:28,border:'1px solid #d1d5db',
                borderRadius:5,cursor:inputMode==='note'?'pointer':'not-allowed',
                background:inputMode==='note'?'white':'#f9fafb',
                fontSize:14,fontWeight:600,color:inputMode==='note'?'#1e2433':'#9ca3af',
                fontFamily:'"Times New Roman",serif',
                transition:'all 0.1s'}}
              onMouseEnter={e=>{if(inputMode==='note')e.currentTarget.style.background='#eff6ff'}}
              onMouseLeave={e=>e.currentTarget.style.background=inputMode==='note'?'white':'#f9fafb'}>
              {syl}
            </button>
          ))}

          {/* Chromatic toggle */}
          <button onClick={()=>setShowChromatic(v=>!v)}
            title="Chromatic alterations"
            style={{padding:'0 8px',height:28,border:'1px solid #d1d5db',
              borderRadius:5,cursor:'pointer',background:showChromatic?'#fef3c7':'white',
              fontSize:10,color:'#6b7280'}}>♯♭</button>

          {showChromatic && CHROMATIC.map(syl=>(
            <button key={syl} onClick={()=>insertSyllable(syl)}
              disabled={inputMode!=='note'}
              style={{padding:'0 8px',height:28,border:'1px solid #fbbf24',
                borderRadius:5,cursor:'pointer',background:'#fef3c7',
                fontSize:12,fontWeight:600,color:'#92400e',
                fontFamily:'"Times New Roman",serif'}}>
              {syl}
            </button>
          ))}
        </div>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Rest / Sustain */}
        <div style={{display:'flex',gap:3}}>
          <Btn label="○ Rest" active={false} onClick={insertRest} small
            title="Rest (Space)"/>
          <Btn label="– Hold" active={false} onClick={insertSustain} small
            title="Sustain / hold (–)"/>
        </div>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Duration */}
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'#6b7280'}}>Duration:</span>
          {DURATIONS.map(d=>(
            <Btn key={d.v} label={d.label} active={selDuration===d.v}
              onClick={()=>setDuration(d.v)} title={d.title} small/>
          ))}
        </div>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Octave */}
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'#6b7280'}}>Octave:</span>
          {[[-1,'Low (,)'],[0,'Mid (.)'],[1,"High (')"]] .map(([o,title])=>(
            <button key={o} onClick={()=>setOctave(o)} title={title}
              style={{width:28,height:24,border:'1px solid '+(selOctave===o?'#2563eb':'#d1d5db'),
                borderRadius:4,cursor:'pointer',background:selOctave===o?'#eff6ff':'white',
                fontSize:10,fontWeight:600,color:selOctave===o?'#2563eb':'#6b7280'}}>
              {o===1?'↑':o===-1?'↓':'–'}
            </button>
          ))}
        </div>

        <div style={{width:1,height:20,background:'#e5e7eb'}}/>

        {/* Key */}
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontSize:10,color:'#6b7280',fontStyle:'italic'}}>Doh=</span>
          <select value={score.key||'C'} onChange={e=>setKey(e.target.value)}
            style={{fontSize:12,border:'1px solid #d1d5db',borderRadius:5,
              padding:'2px 6px',background:'white',color:'#374151'}}>
            {KEYS.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        {/* Add measure */}
        <button onClick={addMeasure}
          style={{marginLeft:'auto',padding:'4px 12px',fontSize:11,
            border:'1px solid #d1d5db',borderRadius:5,background:'white',
            cursor:'pointer',color:'#374151'}}>
          + Bar (M)
        </button>
      </div>

      {/* ── Shortcuts hint ── */}
      <div style={{background:'white',borderBottom:'1px solid #e5e7eb',
        padding:'3px 14px',display:'flex',gap:12,flexWrap:'wrap',
        fontSize:10,color:'#9ca3af',flexShrink:0}}>
        {[['N','Note mode'],['Esc','Select'],['d·r·m·f·s·l·t','Insert note'],
          ['Space','Rest'],['–','Hold'],["'","Upper oct"],[',','Lower oct'],
          ['1-4','Duration'],['M','Add bar'],['Ctrl+Z','Undo']].map(([k,v])=>(
          <span key={k}>
            <kbd style={{background:'#f3f4f6',border:'1px solid #e5e7eb',
              padding:'1px 4px',borderRadius:3,fontFamily:'monospace',fontSize:9}}>{k}</kbd>
            {' '}{v}
          </span>
        ))}
      </div>

      {/* ── Score canvas ── */}
      <main style={{flex:1,overflowY:'auto',overflowX:'hidden',
        background:'#e5e7eb',padding:'24px'}}>
        <div style={{
          transform:`scale(${zoom})`,transformOrigin:'top center',
          minHeight:`${1200*zoom}px`,
        }}>
          <div style={{background:'white',maxWidth:1100,margin:'0 auto',
            minHeight:1200,padding:'48px 32px',boxShadow:'0 4px 20px rgba(0,0,0,0.1)',
            borderRadius:4, boxSizing:'border-box'}}>

            {/* Score title + composer header */}
            <div style={{textAlign:'center',marginBottom:24,
              paddingBottom:12,borderBottom:'2px solid #1e2433'}}>
              <div style={{fontSize:26,fontWeight:700,
                fontFamily:'"Times New Roman",serif',color:'#111'}}>
                {score.title||'Untitled Score'}
              </div>
            </div>

            <SolfaRenderer
              onSelectNote={(noteId, partId, measureIdx) => {
                useSolfaStore.getState().selectNote(noteId, partId, measureIdx)
                setCursor({partId, measureIdx, beatPos:
                  score.parts.find(p=>p.id===partId)
                    ?.measures[measureIdx]?.notes
                    .find(n=>n.id===noteId)?.beatPos || 0
                })
              }}
              onLyricEdit={(noteId, partId, measureIdx, current) => {
                setLyricModal({noteId, partId, measureIdx, current})
              }}
            />
          </div>
        </div>
      </main>

      {/* ── Lyric input modal ── */}
      {lyricModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',
          display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div style={{background:'white',borderRadius:10,padding:24,
            width:320,boxShadow:'0 10px 40px rgba(0,0,0,0.2)'}}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:'#1e2433'}}>
              Edit lyric
            </div>
            <input ref={lyricInputRef}
              defaultValue={lyricModal.current}
              placeholder="Enter lyric syllable…"
              style={{width:'100%',padding:'8px 12px',fontSize:14,
                border:'1px solid #d1d5db',borderRadius:6,outline:'none',
                boxSizing:'border-box'}}
              onKeyDown={e=>{
                if (e.key==='Enter') {
                  setLyric(lyricModal.partId, lyricModal.measureIdx,
                    lyricModal.noteId, e.target.value.trim())
                  setLyricModal(null)
                }
                if (e.key==='Escape') setLyricModal(null)
              }}/>
            <div style={{display:'flex',gap:8,marginTop:12,justifyContent:'flex-end'}}>
              <button onClick={()=>setLyricModal(null)}
                style={{padding:'6px 14px',border:'1px solid #d1d5db',
                  borderRadius:6,background:'white',cursor:'pointer',fontSize:13}}>
                Cancel
              </button>
              <button onClick={()=>{
                  const val = lyricInputRef.current?.value.trim()
                  setLyric(lyricModal.partId, lyricModal.measureIdx,
                    lyricModal.noteId, val)
                  setLyricModal(null)
                }}
                style={{padding:'6px 14px',border:'none',borderRadius:6,
                  background:'#2563eb',color:'white',cursor:'pointer',fontSize:13,fontWeight:600}}>
                Set
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}