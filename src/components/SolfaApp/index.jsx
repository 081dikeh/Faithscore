// src/components/SolfaApp/index.jsx
// FaithScore — Standalone Solfa Editor
//
// Duration buttons:
//   1 beat  = full beat    → "d"   stored as duration:1.0
//   ½ beat  = half beat    → ".d"  stored as duration:0.5
//   ¼ beat  = quarter beat → "d,"  stored as duration:0.25
//
// Octave buttons:  d₂  d₁  d  d¹  d²
// Keyboard:        <   ,   .  '   >
//
// Arrow keys: ← → move note to note; ↑ ↓ move voice to voice
// M = add bar, Backspace = delete selected bar
// d r m f s l t = insert note (in note mode)
// - = hold/sustain, Space = rest

import { useState, useEffect, useRef, useCallback } from 'react'
import SolfaRenderer from '../SolfaRenderer'
import { useSolfaStore, VOICE_COMBOS } from '../../store/solfaStore'
import { supabase } from '../../lib/supabase'

const SYLLABLES = ['d','r','m','f','s','l','t']
const CHROMATIC = ['de','ri','fe','se','ta']
const KEYS      = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']

const DURATIONS = [
  { label:'1',  v:1,    title:'Full beat (key 2) — "d"' },
  { label:'½',  v:0.5,  title:'Half beat (key 3) — ".d" (dot prefix in notation)' },
  { label:'¼',  v:0.25, title:'Quarter beat (key 4) — "d," (comma suffix in notation)' },
]

// Octave levels shown in toolbar
const OCTAVE_LEVELS = [
  { o:-2, label:<span>d<sub style={{fontSize:8}}>2</sub></span>, key:'<', title:'2 octaves below (key <)' },
  { o:-1, label:<span>d<sub style={{fontSize:8}}>1</sub></span>, key:',', title:'1 octave below (key ,)' },
  { o: 0, label:<span>d</span>,                                   key:'.', title:'Middle octave (key .)' },
  { o: 1, label:<span>d<sup style={{fontSize:8}}>1</sup></span>, key:"'", title:'1 octave above (key \')' },
  { o: 2, label:<span>d<sup style={{fontSize:8}}>2</sup></span>, key:'>', title:'2 octaves above (key >)' },
]

export default function SolfaApp({ user, onGoHome }) {
  const score              = useSolfaStore(s=>s.score)
  const inputMode          = useSolfaStore(s=>s.inputMode)
  const selDuration        = useSolfaStore(s=>s.selectedDuration)
  const selOctave          = useSolfaStore(s=>s.selectedOctave)
  const selectedNoteId     = useSolfaStore(s=>s.selectedNoteId)
  const selectedPartId     = useSolfaStore(s=>s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s=>s.selectedMeasureIdx)

  const setInputMode       = useSolfaStore(s=>s.setInputMode)
  const setDuration        = useSolfaStore(s=>s.setSelectedDuration)
  const setTitle           = useSolfaStore(s=>s.setTitle)
  const setKey             = useSolfaStore(s=>s.setKey)
  const placeNote          = useSolfaStore(s=>s.placeNote)
  const placeSustain       = useSolfaStore(s=>s.placeSustain)
  const addMeasure         = useSolfaStore(s=>s.addMeasure)
  const deleteMeasure      = useSolfaStore(s=>s.deleteMeasure)
  const undo               = useSolfaStore(s=>s.undo)
  const selectNote         = useSolfaStore(s=>s.selectNote)
  const navigateNote       = useSolfaStore(s=>s.navigateNote)

  // Octave: updates store + re-stamps selected note immediately
  const setOctave = useCallback((o) => {
    useSolfaStore.getState().setSelectedOctave(o)
    const st = useSolfaStore.getState()
    if (st.selectedNoteId && st.selectedPartId !== null && st.selectedMeasureIdx !== null) {
      useSolfaStore.getState().changeNoteOctave(
        st.selectedPartId, st.selectedMeasureIdx, st.selectedNoteId, o
      )
    }
  }, [])

  const [showChromatic, setShowChromatic] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [saveMsg, setSaveMsg]             = useState('')
  const [zoom, setZoom]                   = useState(1.0)

  // cursor = where the next note will be inserted {partId, measureIdx, beatPos}
  const [cursor, setCursor] = useState({ partId:null, measureIdx:0, beatPos:0 })

  // Keep cursor in sync with selection
  useEffect(() => {
    if (!selectedNoteId||!selectedPartId||selectedMeasureIdx===null) return
    const part = score.parts.find(p=>p.id===selectedPartId)
    const note = part?.measures[selectedMeasureIdx]?.notes.find(n=>n.id===selectedNoteId)
    if (note) setCursor({partId:selectedPartId, measureIdx:selectedMeasureIdx, beatPos:note.beatPos})
  }, [selectedNoteId, selectedPartId, selectedMeasureIdx])

  // ── note insertion ─────────────────────────────────────────────────────────
  function getTarget() {
    if (cursor.partId) return cursor
    if (selectedPartId && selectedMeasureIdx !== null) {
      const part = score.parts.find(p=>p.id===selectedPartId)
      const note = part?.measures[selectedMeasureIdx]?.notes.find(n=>n.id===selectedNoteId)
      if (note) return {partId:selectedPartId, measureIdx:selectedMeasureIdx, beatPos:note.beatPos}
    }
    return {partId:score.parts[0]?.id, measureIdx:0, beatPos:0}
  }

  function advance(partId, measureIdx, beatPos, duration) {
    const part     = score.parts.find(p=>p.id===partId)
    const maxBeats = part?.measures[measureIdx]?.timeSignature?.beats || 4
    const newBeat  = Math.round((beatPos + duration) * 10000) / 10000

    if (newBeat >= maxBeats - 0.001) {
      const nextM = measureIdx + 1
      if (nextM < (part?.measures?.length||0)) {
        setCursor({partId, measureIdx:nextM, beatPos:0})
        const nn = useSolfaStore.getState().score.parts
          .find(p=>p.id===partId)?.measures[nextM]?.notes[0]
        if (nn) selectNote(nn.id, partId, nextM)
      }
    } else {
      setCursor({partId, measureIdx, beatPos:newBeat})
      const nn = useSolfaStore.getState().score.parts
        .find(p=>p.id===partId)?.measures[measureIdx]?.notes
        .find(n=>Math.abs(n.beatPos-newBeat)<0.001)
      if (nn) selectNote(nn.id, partId, measureIdx)
    }
  }

  function doInsert(syl) {
    const {partId, measureIdx, beatPos} = getTarget()
    if (!partId) return
    const st = useSolfaStore.getState()
    placeNote(partId, measureIdx, beatPos, syl, st.selectedOctave, st.selectedDuration)
    advance(partId, measureIdx, beatPos, st.selectedDuration)
  }

  function doSustain() {
    const {partId,measureIdx,beatPos} = getTarget()
    if (!partId) return
    const dur = useSolfaStore.getState().selectedDuration
    placeSustain(partId, measureIdx, beatPos, dur)
    advance(partId, measureIdx, beatPos, dur)
  }

  function doRest() {
    const {partId,measureIdx,beatPos} = getTarget()
    if (!partId) return
    const dur = useSolfaStore.getState().selectedDuration
    placeNote(partId, measureIdx, beatPos, null, 0, dur)
    advance(partId, measureIdx, beatPos, dur)
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return

      if (e.key==='Escape')           { setInputMode('select'); return }
      if (e.key==='n'||e.key==='N')  { setInputMode('note');   return }
      if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo(); return }

      if (e.key==='2') { setDuration(1);    return }
      if (e.key==='3') { setDuration(0.5);  return }
      if (e.key==='4') { setDuration(0.25); return }

      // Octave
      if (e.key===',') { setOctave(-1); return }
      if (e.key==='.') { setOctave(0);  return }
      if (e.key==="'") { setOctave(1);  return }
      if (e.key==='<') { setOctave(-2); return }
      if (e.key==='>') { setOctave(2);  return }

      // Bar
      if (e.key==='m'||e.key==='M')              { addMeasure(); return }
      if (e.key==='Backspace'||e.key==='Delete') { e.preventDefault(); deleteMeasure(); return }

      // Navigation
      if (e.key==='ArrowRight') { e.preventDefault(); navigateNote('right'); return }
      if (e.key==='ArrowLeft')  { e.preventDefault(); navigateNote('left');  return }
      if (e.key==='ArrowDown')  { e.preventDefault(); navigateNote('down');  return }
      if (e.key==='ArrowUp')    { e.preventDefault(); navigateNote('up');    return }

      // Note entry
      if (inputMode==='note') {
        const map={d:'d',r:'r',m:'m',f:'f',s:'s',l:'l',t:'t'}
        if (map[e.key.toLowerCase()]) { e.preventDefault(); doInsert(map[e.key.toLowerCase()]); return }
        if (e.key==='-') { doSustain(); return }
        if (e.key===' ') { e.preventDefault(); doRest(); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputMode, cursor]) // eslint-disable-line

  // ── save ───────────────────────────────────────────────────────────────────
  async function saveToCloud() {
    if (!user) return
    setSaving(true); setSaveMsg('')
    try {
      const payload = {user_id:user.id, title:score.title||'Untitled', data:score}
      if (score._cloudId) {
        await supabase.from('scores')
          .update({...payload, updated_at:new Date().toISOString()})
          .eq('id',score._cloudId).eq('user_id',user.id)
      } else {
        const {data} = await supabase.from('scores').insert([payload]).select('id').single()
        if (data?.id) useSolfaStore.getState().setCloudId(data.id)
      }
      setSaveMsg('Saved ✓')
      setTimeout(()=>setSaveMsg(''),3000)
    } catch { setSaveMsg('Save failed') }
    setSaving(false)
  }

  // Live octave display from selected note
  const selNote = (() => {
    if (!selectedNoteId||!selectedPartId||selectedMeasureIdx===null) return null
    return score.parts.find(p=>p.id===selectedPartId)
      ?.measures[selectedMeasureIdx]?.notes.find(n=>n.id===selectedNoteId)||null
  })()
  const dispOct = selNote?.type==='note' ? selNote.octave : selOctave

  const comboInfo = VOICE_COMBOS[score.voiceCombo]||VOICE_COMBOS.satb

  // Cursor beat display
  const beatDisp = (() => {
    if (!cursor.partId || inputMode!=='note') return ''
    const bp = cursor.beatPos
    const whole = Math.floor(bp)
    const frac  = Math.round((bp - whole) * 4) // quarter-beat remainder
    const fracStr = frac===0?''  : frac===1?'+¼' : frac===2?'+½' : '+¾'
    return `Bar ${cursor.measureIdx+1}, beat ${whole+1}${fracStr}`
  })()

  const Sep = () => <div style={{width:1,height:20,background:'#e5e7eb',flexShrink:0}}/>

  const activeBtn = (active, color='#2563eb') => ({
    padding:'3px 11px', fontSize:12, fontWeight:active?700:500,
    border:`1px solid ${active?color:'#d1d5db'}`,
    background:active?color+'18':'white',
    color:active?color:'#374151',
    borderRadius:5, cursor:'pointer', transition:'all 0.1s',
  })

  return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',
      background:'#f3f4f6',fontFamily:'system-ui,sans-serif'}}>

      {/* ── Menu bar ── */}
      <div style={{background:'white',borderBottom:'1px solid #e5e7eb',
        display:'flex',alignItems:'center',height:42,padding:'0 12px',
        gap:8,flexShrink:0,boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
        position:'sticky',top:0,zIndex:50}}>

        <button onClick={onGoHome}
          style={{display:'flex',alignItems:'center',gap:6,background:'none',
            border:'none',cursor:'pointer',padding:'3px 8px',borderRadius:5,
            fontWeight:700,fontSize:13,color:'#2563eb'}}
          onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
          onMouseLeave={e=>e.currentTarget.style.background='none'}>
          <img src="/FaithScore_logo.png" alt="" style={{height:20,width:'auto'}}/>
          FaithScore
        </button>

        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,
          background:'#fef3c7',color:'#92400e',letterSpacing:'0.05em'}}>
          SOLFA · {comboInfo.label}
        </span>

        <Sep/>

        <input value={score.title} onChange={e=>setTitle(e.target.value)}
          style={{border:'none',borderBottom:'1px solid #d1d5db',outline:'none',
            fontSize:14,fontWeight:600,color:'#1e2433',width:200,background:'transparent'}}
          placeholder="Score title"/>

        <div style={{flex:1}}/>

        {beatDisp && (
          <span style={{fontSize:10,color:'#6b7280',fontFamily:'monospace',
            background:'#f3f4f6',padding:'2px 7px',borderRadius:3}}>
            ✎ {beatDisp}
          </span>
        )}

        <button onClick={undo} title="Undo (Ctrl+Z)"
          style={{width:28,height:28,border:'1px solid #e5e7eb',borderRadius:5,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>↩</button>

        <button onClick={()=>setZoom(z=>Math.max(0.5,z-0.1))}
          style={{width:24,height:24,border:'1px solid #e5e7eb',borderRadius:4,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>−</button>
        <span style={{fontSize:11,color:'#9ca3af',minWidth:32,textAlign:'center'}}>
          {Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(z=>Math.min(2,z+0.1))}
          style={{width:24,height:24,border:'1px solid #e5e7eb',borderRadius:4,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>+</button>

        <Sep/>

        {saveMsg && <span style={{fontSize:11,color:saveMsg.includes('fail')?'#dc2626':'#16a34a'}}>{saveMsg}</span>}
        <button onClick={saveToCloud} disabled={saving||!user}
          style={{padding:'4px 14px',fontSize:12,fontWeight:600,
            background:saving?'#93c5fd':'#2563eb',color:'white',
            border:'none',borderRadius:6,cursor:saving||!user?'not-allowed':'pointer'}}>
          {saving?'Saving…':'☁ Save'}
        </button>

        {user && (
          <div style={{width:26,height:26,borderRadius:'50%',
            background:'linear-gradient(135deg,#2563eb,#7c3aed)',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:11,fontWeight:700,color:'white'}}>
            {(user.user_metadata?.full_name||user.email||'?')[0].toUpperCase()}
          </div>
        )}
      </div>

      {/* ── Input toolbar ── */}
      <div style={{background:'white',borderBottom:'1px solid #e5e7eb',
        padding:'5px 14px',display:'flex',flexWrap:'wrap',
        alignItems:'center',gap:7,flexShrink:0}}>

        {/* Mode */}
        <div style={{display:'flex',gap:3}}>
          <button style={activeBtn(inputMode==='select')} onClick={()=>setInputMode('select')}>○ Select</button>
          <button style={activeBtn(inputMode==='note','#16a34a')} onClick={()=>setInputMode('note')}>● Note</button>
        </div>

        <Sep/>

        {/* Syllables */}
        <div style={{display:'flex',gap:2,alignItems:'center'}}>
          {SYLLABLES.map(syl=>(
            <button key={syl}
              onClick={()=>{ if(inputMode==='note') doInsert(syl) }}
              title={`${syl} (key: ${syl})`}
              style={{width:26,height:26,border:'1px solid #d1d5db',borderRadius:4,
                cursor:inputMode==='note'?'pointer':'not-allowed',
                background:inputMode==='note'?'white':'#f9fafb',
                fontSize:14,fontWeight:600,
                color:inputMode==='note'?'#1e2433':'#c0c0c0',
                fontFamily:'"Times New Roman",serif'}}>
              {syl}
            </button>
          ))}
          <button onClick={()=>setShowChromatic(v=>!v)}
            style={{padding:'0 7px',height:26,border:'1px solid #d1d5db',borderRadius:4,
              cursor:'pointer',background:showChromatic?'#fef3c7':'white',
              fontSize:10,color:'#6b7280'}}>♯♭</button>
          {showChromatic && CHROMATIC.map(syl=>(
            <button key={syl} onClick={()=>{ if(inputMode==='note') doInsert(syl) }}
              style={{padding:'0 7px',height:26,border:'1px solid #fbbf24',borderRadius:4,
                cursor:'pointer',background:'#fef3c7',fontSize:12,fontWeight:600,
                color:'#92400e',fontFamily:'"Times New Roman",serif'}}>
              {syl}
            </button>
          ))}
        </div>

        <Sep/>

        {/* Rest / Hold */}
        <button onClick={doRest} title="Silent beat (Space)"
          style={{...activeBtn(false),padding:'3px 10px'}}>○ Rest</button>
        <button onClick={doSustain} title="Hold/sustain dash (key: -)"
          style={{...activeBtn(false),padding:'3px 10px',fontFamily:'"Times New Roman",serif'}}>– Hold</button>

        <Sep/>

        {/* Duration */}
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'#6b7280'}}>Duration:</span>
          {DURATIONS.map(d=>(
            <button key={d.v} style={activeBtn(selDuration===d.v)}
              onClick={()=>setDuration(d.v)} title={d.title}>
              {d.label}
            </button>
          ))}
        </div>

        <Sep/>

        {/* Octave */}
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'#6b7280'}}>Octave:</span>
          {OCTAVE_LEVELS.map(({o,label,title})=>(
            <button key={o} onClick={()=>setOctave(o)} title={title}
              style={{
                minWidth:32,height:28,padding:'0 5px',
                border:`1px solid ${dispOct===o?'#2563eb':'#d1d5db'}`,
                borderRadius:4,cursor:'pointer',
                background:dispOct===o?'#eff6ff':'white',
                color:dispOct===o?'#2563eb':'#374151',
                fontFamily:'"Times New Roman",serif',
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>
              {label}
            </button>
          ))}
        </div>

        <Sep/>

        {/* Key */}
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontSize:10,color:'#6b7280',fontStyle:'italic'}}>Doh=</span>
          <select value={score.key||'C'} onChange={e=>setKey(e.target.value)}
            style={{fontSize:12,border:'1px solid #d1d5db',borderRadius:5,
              padding:'2px 6px',background:'white',color:'#374151'}}>
            {KEYS.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <Sep/>

        {/* Bars */}
        <button onClick={addMeasure} title="Add bar (M)"
          style={{...activeBtn(false),padding:'3px 10px',fontSize:11}}>+ Bar</button>
        <button onClick={()=>deleteMeasure()} title="Delete selected bar (Backspace)"
          style={{padding:'3px 10px',fontSize:11,fontWeight:500,
            border:'1px solid #fca5a5',borderRadius:5,
            background:'#fef2f2',color:'#dc2626',cursor:'pointer'}}>− Bar</button>
      </div>

      {/* ── Shortcut hint bar ── */}
      <div style={{background:'#fffbeb',borderBottom:'1px solid #fde68a',
        padding:'3px 14px',fontSize:10,color:'#92400e',flexShrink:0,
        display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
        <strong>Notation:</strong>
        <span>Full beat → <code>d</code></span>
        <span>Half beat → <code>.d</code> (select ½ first)</span>
        <span>Quarter beat → <code>d,</code> (select ¼ first)</span>
        <span>Hold → <code>–</code></span>
        <span style={{marginLeft:8}}><strong>Keys:</strong> N=note mode · d r m f s l t=note · -=hold · Space=rest</span>
        <span>, . ' &lt; &gt; = octave · ← → ↑ ↓ = navigate · M=+bar · ⌫=−bar</span>
      </div>

      {/* ── Score canvas ── */}
      <main style={{flex:1,overflowY:'auto',overflowX:'hidden',
        background:'#e5e7eb',padding:'24px'}}>
        <div style={{transform:`scale(${zoom})`,transformOrigin:'top center',
          minHeight:`${1200*zoom}px`}}>
          <div style={{background:'white',maxWidth:1100,margin:'0 auto',
            minHeight:1200,padding:'48px 32px',
            boxShadow:'0 4px 20px rgba(0,0,0,0.1)',
            borderRadius:4,boxSizing:'border-box'}}>

            <div style={{textAlign:'center',marginBottom:24,
              paddingBottom:12,borderBottom:'2px solid #1e2433'}}>
              <div style={{fontSize:26,fontWeight:700,
                fontFamily:'"Times New Roman",serif',color:'#111'}}>
                {score.title||'Untitled Score'}
              </div>
            </div>

            <SolfaRenderer
              onSelectNote={(noteId,partId,measureIdx)=>{
                useSolfaStore.getState().selectNote(noteId,partId,measureIdx)
                const note = score.parts.find(p=>p.id===partId)
                  ?.measures[measureIdx]?.notes.find(n=>n.id===noteId)
                if (note) setCursor({partId,measureIdx,beatPos:note.beatPos})
              }}
            />
          </div>
        </div>
      </main>
    </div>
  )
}