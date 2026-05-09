// src/components/SolfaApp/index.jsx
// FaithScore — Solfa Editor (slot-based model)
//
// HOW INPUT WORKS:
//   1. Click a beat slot to select it (or navigate with arrow keys)
//   2. The beat subdivision buttons (1 / ½ / ¼) control how that beat is divided
//      - Click "½" → the selected beat splits into 2 half-beat slots
//      - Click "¼" → the selected beat splits into 4 quarter-beat slots
//      - Click "1" → collapse back to whole beat
//   3. Then type a syllable key (d r m f s l t) to fill the selected slot
//   4. Cursor auto-advances to the next slot
//
// NOTATION PRODUCED:
//   whole beat "d"         → 1 slot, no decoration
//   two halves "d. .d"     → 2 slots, slot 0 gets "." suffix, slot 1 gets "." prefix
//   four quarters "d,d,d,d"→ 4 slots with comma decorations
//
// "/" separator: automatically placed at midpoints per time signature

import { useState, useEffect, useCallback } from 'react'
import SolfaRenderer from '../SolfaRenderer'
import { useSolfaStore, VOICE_COMBOS } from '../../store/solfaStore'
import { supabase } from '../../lib/supabase'

const SYLLABLES = ['d','r','m','f','s','l','t']
const CHROMATIC = ['de','ri','fe','se','ta']
const KEYS      = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']

const OCTAVE_LEVELS = [-2,-1,0,1,2]

function OctLabel({o}) {
  const s = {fontFamily:'"Times New Roman",serif',fontSize:13}
  if (o===0)  return <span style={s}>d</span>
  if (o===1)  return <span style={s}>d<sup style={{fontSize:8}}>1</sup></span>
  if (o===2)  return <span style={s}>d<sup style={{fontSize:8}}>2</sup></span>
  if (o===-1) return <span style={s}>d<sub style={{fontSize:8}}>1</sub></span>
  if (o===-2) return <span style={s}>d<sub style={{fontSize:8}}>2</sub></span>
  return null
}

export default function SolfaApp({user, onGoHome}) {
  const score              = useSolfaStore(s=>s.score)
  const inputMode          = useSolfaStore(s=>s.inputMode)
  const selOctave          = useSolfaStore(s=>s.selectedOctave)
  const selectedPartId     = useSolfaStore(s=>s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s=>s.selectedMeasureIdx)
  const selectedBeatIdx    = useSolfaStore(s=>s.selectedBeatIdx)
  const selectedSlotIdx    = useSolfaStore(s=>s.selectedSlotIdx)

  const setInputMode    = useSolfaStore(s=>s.setInputMode)
  const setTitle        = useSolfaStore(s=>s.setTitle)
  const setKey          = useSolfaStore(s=>s.setKey)
  const placeNote       = useSolfaStore(s=>s.placeNote)
  const placeSustain    = useSolfaStore(s=>s.placeSustain)
  const subdivideBeat   = useSolfaStore(s=>s.subdivideBeat)
  const addMeasure      = useSolfaStore(s=>s.addMeasure)
  const deleteMeasure   = useSolfaStore(s=>s.deleteMeasure)
  const undo            = useSolfaStore(s=>s.undo)
  const selectSlot      = useSolfaStore(s=>s.selectSlot)
  const navigateSlot    = useSolfaStore(s=>s.navigateSlot)

  const setOctave = useCallback((o) => {
    useSolfaStore.getState().setSelectedOctave(o)
    const st = useSolfaStore.getState()
    if (st.selectedPartId!==null && st.selectedMeasureIdx!==null &&
        st.selectedBeatIdx!==null && st.selectedSlotIdx!==null) {
      useSolfaStore.getState().changeSlotOctave(
        st.selectedPartId,st.selectedMeasureIdx,
        st.selectedBeatIdx,st.selectedSlotIdx,o
      )
    }
  },[])

  const [showChromatic, setShowChromatic] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [saveMsg, setSaveMsg]             = useState('')
  const [zoom, setZoom]                   = useState(1.0)

  // Get the currently selected beat's subdivision (for toolbar display)
  const currentSubdivision = (() => {
    if (selectedPartId===null||selectedMeasureIdx===null||selectedBeatIdx===null) return 1
    const part = score.parts.find(p=>p.id===selectedPartId)
    return part?.measures[selectedMeasureIdx]?.beats[selectedBeatIdx]?.subdivision||1
  })()

  // Get selected slot info
  const selectedSlot = (() => {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return null
    const part = score.parts.find(p=>p.id===selectedPartId)
    const beat = part?.measures[selectedMeasureIdx]?.beats[selectedBeatIdx]
    return beat?.slots[selectedSlotIdx]||null
  })()

  const dispOct = selectedSlot?.type==='note' ? selectedSlot.octave : selOctave

  // ── Advance cursor to next slot ───────────────────────────────────────────
  function advanceSlot() {
    navigateSlot('right')
  }

  // ── Note insertion ─────────────────────────────────────────────────────────
  function doInsert(syl) {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return
    placeNote(selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx,syl)
    setTimeout(advanceSlot,0)
  }

  function doSustain() {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return
    placeSustain(selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx)
    setTimeout(advanceSlot,0)
  }

  function doRest() {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return
    placeNote(selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx,null)
    setTimeout(advanceSlot,0)
  }

  // ── Subdivide the selected beat ───────────────────────────────────────────
  function doSubdivide(newSub) {
    if (selectedPartId===null||selectedMeasureIdx===null||selectedBeatIdx===null) return
    subdivideBeat(selectedPartId,selectedMeasureIdx,selectedBeatIdx,newSub)
    // After subdividing, select slot 0 of this beat
    selectSlot(selectedPartId,selectedMeasureIdx,selectedBeatIdx,0)
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const onKey = e => {
      const tag = e.target.tagName
      if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return

      if (e.key==='Escape')          { setInputMode('select'); return }
      if (e.key==='n'||e.key==='N') { setInputMode('note');   return }
      if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo(); return }

      // Beat subdivision
      if (e.key==='1') { doSubdivide(1); return }
      if (e.key==='2') { doSubdivide(2); return }
      if (e.key==='4') { doSubdivide(4); return }

      // Octave
      if (e.key===',') { setOctave(-1); return }
      if (e.key==='.') { setOctave(0);  return }
      if (e.key==="'") { setOctave(1);  return }
      if (e.key==='<') { setOctave(-2); return }
      if (e.key==='>') { setOctave(2);  return }

      // Bar management
      if (e.key==='m'||e.key==='M')              { addMeasure(); return }
      if (e.key==='Backspace'||e.key==='Delete') { e.preventDefault(); deleteMeasure(); return }

      // Navigation
      if (e.key==='ArrowRight') { e.preventDefault(); navigateSlot('right'); return }
      if (e.key==='ArrowLeft')  { e.preventDefault(); navigateSlot('left');  return }
      if (e.key==='ArrowDown')  { e.preventDefault(); navigateSlot('down');  return }
      if (e.key==='ArrowUp')    { e.preventDefault(); navigateSlot('up');    return }

      // Note entry
      if (inputMode==='note') {
        const map={d:'d',r:'r',m:'m',f:'f',s:'s',l:'l',t:'t'}
        if (map[e.key?.toLowerCase()]) { e.preventDefault(); doInsert(map[e.key.toLowerCase()]); return }
        if (e.key==='-') { doSustain(); return }
        if (e.key===' ') { e.preventDefault(); doRest(); return }
      }
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[inputMode,selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx])

  // ── Cloud save ─────────────────────────────────────────────────────────────
  async function saveToCloud() {
    if (!user) return
    setSaving(true); setSaveMsg('')
    try {
      const payload={user_id:user.id,title:score.title||'Untitled',data:score}
      if (score._cloudId) {
        await supabase.from('scores').update({...payload,updated_at:new Date().toISOString()})
          .eq('id',score._cloudId).eq('user_id',user.id)
      } else {
        const {data}=await supabase.from('scores').insert([payload]).select('id').single()
        if (data?.id) useSolfaStore.getState().setCloudId(data.id)
      }
      setSaveMsg('Saved ✓'); setTimeout(()=>setSaveMsg(''),3000)
    } catch { setSaveMsg('Save failed') }
    setSaving(false)
  }

  const comboInfo = VOICE_COMBOS[score.voiceCombo]||VOICE_COMBOS.satb

  // Position display
  const posDisp = (selectedBeatIdx!==null&&selectedSlotIdx!==null&&selectedMeasureIdx!==null)
    ? `Bar ${selectedMeasureIdx+1} · Beat ${selectedBeatIdx+1} · Slot ${selectedSlotIdx+1}/${currentSubdivision}`
    : ''

  const Sep = ()=><div style={{width:1,height:20,background:'#e5e7eb',flexShrink:0}}/>
  const abtn = (active,color='#2563eb')=>({
    padding:'3px 10px',fontSize:12,fontWeight:active?700:500,
    border:`1px solid ${active?color:'#d1d5db'}`,
    background:active?color+'18':'white',color:active?color:'#374151',
    borderRadius:5,cursor:'pointer',transition:'all 0.1s',
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

        {posDisp && (
          <span style={{fontSize:10,color:'#6b7280',fontFamily:'monospace',
            background:'#f3f4f6',padding:'2px 7px',borderRadius:3}}>
            {posDisp}
          </span>
        )}

        <button onClick={undo} title="Undo (Ctrl+Z)"
          style={{width:28,height:28,border:'1px solid #e5e7eb',borderRadius:5,
            background:'white',cursor:'pointer',fontSize:13,color:'#6b7280'}}>↩</button>

        <button onClick={()=>setZoom(z=>Math.max(0.5,z-0.1))}
          style={{width:24,height:24,border:'1px solid #e5e7eb',borderRadius:4,
            background:'white',cursor:'pointer',fontSize:14,color:'#6b7280'}}>−</button>
        <span style={{fontSize:11,color:'#9ca3af',minWidth:32,textAlign:'center'}}>
          {Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(z=>Math.min(2,z+0.1))}
          style={{width:24,height:24,border:'1px solid #e5e7eb',borderRadius:4,
            background:'white',cursor:'pointer',fontSize:14,color:'#6b7280'}}>+</button>

        <Sep/>

        {saveMsg&&<span style={{fontSize:11,color:saveMsg.includes('fail')?'#dc2626':'#16a34a'}}>{saveMsg}</span>}
        <button onClick={saveToCloud} disabled={saving||!user}
          style={{padding:'4px 14px',fontSize:12,fontWeight:600,
            background:saving?'#93c5fd':'#2563eb',color:'white',
            border:'none',borderRadius:6,cursor:saving||!user?'not-allowed':'pointer'}}>
          {saving?'Saving…':'☁ Save'}
        </button>

        {user&&(
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
          <button style={abtn(inputMode==='select')} onClick={()=>setInputMode('select')}>○ Select</button>
          <button style={abtn(inputMode==='note','#16a34a')} onClick={()=>setInputMode('note')}>● Note</button>
        </div>

        <Sep/>

        {/* Syllables */}
        <div style={{display:'flex',gap:2,alignItems:'center'}}>
          {SYLLABLES.map(syl=>(
            <button key={syl} onClick={()=>{if(inputMode==='note')doInsert(syl)}}
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
          {showChromatic&&CHROMATIC.map(syl=>(
            <button key={syl} onClick={()=>{if(inputMode==='note')doInsert(syl)}}
              style={{padding:'0 7px',height:26,border:'1px solid #fbbf24',borderRadius:4,
                cursor:'pointer',background:'#fef3c7',fontSize:12,fontWeight:600,
                color:'#92400e',fontFamily:'"Times New Roman",serif'}}>
              {syl}
            </button>
          ))}
        </div>

        <Sep/>

        <button onClick={doRest} title="Rest (Space)"
          style={{...abtn(false),padding:'3px 10px'}}>○ Rest</button>
        <button onClick={doSustain} title="Hold/sustain (key: -)"
          style={{...abtn(false),padding:'3px 10px',fontFamily:'"Times New Roman",serif'}}>– Hold</button>

        <Sep/>

        {/* Beat subdivision — this is the key UI element */}
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontSize:10,color:'#6b7280',fontWeight:600}}>Beat split:</span>

          <button onClick={()=>doSubdivide(1)} title="Whole beat — 1 slot (key 1)"
            style={{...abtn(currentSubdivision===1),minWidth:44,
              fontFamily:'"Times New Roman",serif',fontSize:13}}>
            d
          </button>

          <button onClick={()=>doSubdivide(2)} title="Split into 2 halves: d. and .d (key 2)"
            style={{...abtn(currentSubdivision===2),minWidth:52,
              fontFamily:'"Times New Roman",serif',fontSize:13}}>
            d.d
          </button>

          <button onClick={()=>doSubdivide(4)} title="Split into 4 quarters: d, ,d ,,d ,,,d (key 4)"
            style={{...abtn(currentSubdivision===4),minWidth:52,
              fontFamily:'"Times New Roman",serif',fontSize:13}}>
            d,d
          </button>
        </div>

        <Sep/>

        {/* Octave */}
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'#6b7280'}}>Octave:</span>
          {OCTAVE_LEVELS.map(o=>(
            <button key={o} onClick={()=>setOctave(o)}
              title={o===0?'Middle (.)':o>0?`${o} up (${o===1?"'":">"})`:`${Math.abs(o)} down (${o===-1?',':'<'})`}
              style={{minWidth:32,height:28,padding:'0 5px',
                border:`1px solid ${dispOct===o?'#2563eb':'#d1d5db'}`,
                borderRadius:4,cursor:'pointer',
                background:dispOct===o?'#eff6ff':'white',
                color:dispOct===o?'#2563eb':'#374151',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
              <OctLabel o={o}/>
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

        <button onClick={addMeasure} title="Add bar (M)"
          style={{...abtn(false),padding:'3px 10px',fontSize:11}}>+ Bar</button>
        <button onClick={()=>deleteMeasure()} title="Delete bar (Backspace)"
          style={{padding:'3px 10px',fontSize:11,fontWeight:500,
            border:'1px solid #fca5a5',borderRadius:5,
            background:'#fef2f2',color:'#dc2626',cursor:'pointer'}}>− Bar</button>
      </div>

      {/* ── How-to hint ── */}
      <div style={{background:'#f0fdf4',borderBottom:'1px solid #bbf7d0',
        padding:'4px 14px',fontSize:10,color:'#166534',flexShrink:0,
        display:'flex',gap:14,flexWrap:'wrap',alignItems:'center'}}>
        <strong>How to enter notes:</strong>
        <span>1. Click a beat to select it</span>
        <span>2. Choose beat split: <strong>d</strong>=whole · <strong>d.d</strong>=halves · <strong>d,d</strong>=quarters</span>
        <span>3. Click the slot you want, then type <strong>d r m f s l t</strong></span>
        <span>4. Cursor auto-advances. Skip a slot with <kbd style={{background:'white',border:'1px solid #bbf7d0',padding:'0 3px',borderRadius:2}}>Space</kbd></span>
        <span style={{marginLeft:8}}><kbd style={{background:'white',border:'1px solid #bbf7d0',padding:'0 3px',borderRadius:2}}>← →</kbd> navigate · <kbd style={{background:'white',border:'1px solid #bbf7d0',padding:'0 3px',borderRadius:2}}>↑ ↓</kbd> change voice</span>
      </div>

      {/* ── Score canvas ── */}
      <main style={{flex:1,overflowY:'auto',overflowX:'hidden',background:'#e5e7eb',padding:'24px'}}>
        <div style={{transform:`scale(${zoom})`,transformOrigin:'top center',minHeight:`${1200*zoom}px`}}>
          <div style={{background:'white',maxWidth:1100,margin:'0 auto',minHeight:1200,
            padding:'48px 32px',boxShadow:'0 4px 20px rgba(0,0,0,0.1)',
            borderRadius:4,boxSizing:'border-box'}}>

            <div style={{textAlign:'center',marginBottom:24,paddingBottom:12,borderBottom:'2px solid #1e2433'}}>
              <div style={{fontSize:26,fontWeight:700,fontFamily:'"Times New Roman",serif',color:'#111'}}>
                {score.title||'Untitled Score'}
              </div>
            </div>

            <SolfaRenderer onSelectSlot={(partId,mIdx,bi,si)=>{
              useSolfaStore.getState().selectSlot(partId,mIdx,bi,si)
            }}/>
          </div>
        </div>
      </main>
    </div>
  )
}