// src/components/SolfaApp/index.jsx
// FaithScore — Solfa Editor
//
// HOW INPUT WORKS:
//   1. Click any beat slot on the score to select it, OR use arrow keys to navigate.
//   2. Choose how to split the selected beat:
//        d     = whole beat (1 slot)      → renders "d"
//        d.d   = two halves (2 slots)     → renders "d.r" connecting with dot
//        d,d   = four quarters (4 slots)  → renders "d,r,m,f" connecting with comma
//   3. Type a syllable key: d r m f s l t (or click the buttons).
//      The cursor auto-advances to the next slot.
//   4. Use – for a hold/sustain, Space for a rest.
//
// WHAT YOU SEE ON SCREEN (matching handwritten samples):
//   Whole beats:    d :r :m :f
//   Beat split ½:   d.r :m :f       (dot connects the two halves)
//   Beat split ¼:   d,r,m,f :s :l   (comma connects the four quarters)
//   Mid-bar slash:  d :r / :m :f    (4/4 — slash instead of colon at midpoint)

import { useState, useEffect, useCallback } from 'react'
import SolfaRenderer from '../SolfaRenderer'
import { useSolfaStore, VOICE_COMBOS } from '../../store/solfaStore'
import { supabase } from '../../lib/supabase'

const SYLLABLES = ['d','r','m','f','s','l','t']
const CHROMATIC = ['de','ri','fe','se','ta']
const KEYS      = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']
const OCTAVE_LEVELS = [-2,-1,0,1,2]

function OctLabel({o}) {
  const s={fontFamily:'"Times New Roman",serif',fontSize:13,lineHeight:1}
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

  const setInputMode   = useSolfaStore(s=>s.setInputMode)
  const setTitle       = useSolfaStore(s=>s.setTitle)
  const setKey         = useSolfaStore(s=>s.setKey)
  const placeNote      = useSolfaStore(s=>s.placeNote)
  const placeSustain   = useSolfaStore(s=>s.placeSustain)
  const subdivideBeat  = useSolfaStore(s=>s.subdivideBeat)
  const addMeasure     = useSolfaStore(s=>s.addMeasure)
  const deleteMeasure  = useSolfaStore(s=>s.deleteMeasure)
  const undo           = useSolfaStore(s=>s.undo)
  const selectSlot     = useSolfaStore(s=>s.selectSlot)
  const navigateSlot   = useSolfaStore(s=>s.navigateSlot)

  // Octave: update toolbar state AND re-stamp currently selected slot
  const setOctave = useCallback((o)=>{
    useSolfaStore.getState().setSelectedOctave(o)
    const st=useSolfaStore.getState()
    if (st.selectedPartId!==null&&st.selectedMeasureIdx!==null&&
        st.selectedBeatIdx!==null&&st.selectedSlotIdx!==null) {
      useSolfaStore.getState().changeSlotOctave(
        st.selectedPartId,st.selectedMeasureIdx,
        st.selectedBeatIdx,st.selectedSlotIdx,o
      )
    }
  },[])

  const [showChromatic,setShowChromatic] = useState(false)
  const [saving,setSaving]               = useState(false)
  const [saveMsg,setSaveMsg]             = useState('')
  const [zoom,setZoom]                   = useState(1.0)

  // Current beat subdivision (to show active button)
  const currentSub = (()=>{
    if (selectedPartId===null||selectedMeasureIdx===null||selectedBeatIdx===null) return 1
    const part=score.parts.find(p=>p.id===selectedPartId)
    return part?.measures[selectedMeasureIdx]?.beats[selectedBeatIdx]?.subdivision||1
  })()

  // Selected slot (for live octave display)
  const selectedSlot=(()=>{
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return null
    const part=score.parts.find(p=>p.id===selectedPartId)
    return part?.measures[selectedMeasureIdx]?.beats[selectedBeatIdx]?.slots[selectedSlotIdx]||null
  })()
  const dispOct=selectedSlot?.type==='note'?selectedSlot.octave:selOctave

  // ── Subdivide + select slot 0 ─────────────────────────────────────────────
  function doSubdivide(newSub) {
    if (selectedPartId===null||selectedMeasureIdx===null||selectedBeatIdx===null) return
    subdivideBeat(selectedPartId,selectedMeasureIdx,selectedBeatIdx,newSub)
    selectSlot(selectedPartId,selectedMeasureIdx,selectedBeatIdx,0)
  }

  // ── Note insertion ────────────────────────────────────────────────────────
  function doInsert(syl) {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return
    placeNote(selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx,syl)
    setTimeout(()=>navigateSlot('right'),0)
  }

  function doSustain() {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return
    placeSustain(selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx)
    setTimeout(()=>navigateSlot('right'),0)
  }

  function doRest() {
    if (selectedPartId===null||selectedMeasureIdx===null||
        selectedBeatIdx===null||selectedSlotIdx===null) return
    placeNote(selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx,null)
    setTimeout(()=>navigateSlot('right'),0)
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(()=>{
    const onKey=e=>{
      const tag=e.target.tagName
      if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return

      if (e.key==='Escape')          {setInputMode('select');return}
      if (e.key==='n'||e.key==='N') {setInputMode('note');  return}
      if ((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();return}

      // Beat subdivision keys
      if (e.key==='1'){doSubdivide(1);return}
      if (e.key==='2'){doSubdivide(2);return}
      if (e.key==='4'){doSubdivide(4);return}

      // Octave keys
      if (e.key===','){setOctave(-1);return}
      if (e.key==='.'){setOctave(0); return}
      if (e.key==="'"){setOctave(1); return}
      if (e.key==='<'){setOctave(-2);return}
      if (e.key==='>'){setOctave(2); return}

      // Bar management
      if (e.key==='m'||e.key==='M')             {addMeasure();return}
      if (e.key==='Backspace'||e.key==='Delete'){e.preventDefault();deleteMeasure();return}

      // Navigation
      if (e.key==='ArrowRight'){e.preventDefault();navigateSlot('right');return}
      if (e.key==='ArrowLeft') {e.preventDefault();navigateSlot('left'); return}
      if (e.key==='ArrowDown') {e.preventDefault();navigateSlot('down'); return}
      if (e.key==='ArrowUp')   {e.preventDefault();navigateSlot('up');   return}

      // Note entry
      if (inputMode==='note'){
        const map={d:'d',r:'r',m:'m',f:'f',s:'s',l:'l',t:'t'}
        if (map[e.key?.toLowerCase()]){e.preventDefault();doInsert(map[e.key.toLowerCase()]);return}
        if (e.key==='-'){doSustain();return}
        if (e.key===' '){e.preventDefault();doRest();return}
      }
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[inputMode,selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx])

  // ── Cloud save ────────────────────────────────────────────────────────────
  async function saveToCloud(){
    if (!user) return
    setSaving(true);setSaveMsg('')
    try {
      const payload={user_id:user.id,title:score.title||'Untitled',data:score}
      if (score._cloudId){
        await supabase.from('scores').update({...payload,updated_at:new Date().toISOString()})
          .eq('id',score._cloudId).eq('user_id',user.id)
      } else {
        const {data}=await supabase.from('scores').insert([payload]).select('id').single()
        if (data?.id) useSolfaStore.getState().setCloudId(data.id)
      }
      setSaveMsg('Saved ✓');setTimeout(()=>setSaveMsg(''),3000)
    } catch {setSaveMsg('Save failed')}
    setSaving(false)
  }

  const comboInfo=VOICE_COMBOS[score.voiceCombo]||VOICE_COMBOS.satb

  // Position display
  const posDisp=(selectedBeatIdx!==null&&selectedSlotIdx!==null&&selectedMeasureIdx!==null)
    ?`Bar ${selectedMeasureIdx+1} · Beat ${selectedBeatIdx+1}·${selectedSlotIdx+1}/${currentSub}`
    :''

  const Sep=()=><div style={{width:1,height:20,background:'#e5e7eb',flexShrink:0}}/>

  // Active button style
  const abtn=(active,color='#2563eb')=>({
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

        {posDisp&&(
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
          <button style={abtn(inputMode==='select')} onClick={()=>setInputMode('select')} title="Select mode (Esc)">○ Select</button>
          <button style={abtn(inputMode==='note','#16a34a')} onClick={()=>setInputMode('note')} title="Note input mode (N)">● Note</button>
        </div>

        <Sep/>

        {/* Syllable buttons */}
        <div style={{display:'flex',gap:2,alignItems:'center'}}>
          {SYLLABLES.map(syl=>(
            <button key={syl} onClick={()=>{if(inputMode==='note')doInsert(syl)}}
              title={`Insert ${syl} (key: ${syl})`}
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

        {/* Rest / Hold */}
        <button onClick={doRest} title="Rest — silent slot (Space)"
          style={{...abtn(false),padding:'3px 10px'}}>○ Rest</button>
        <button onClick={doSustain} title="Hold/sustain dash (key: -)"
          style={{...abtn(false),padding:'3px 10px',fontFamily:'"Times New Roman",serif'}}>– Hold</button>

        <Sep/>

        {/* Beat split — the most important UI control */}
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontSize:10,color:'#6b7280',fontWeight:600}}>Beat:</span>

          {/* Whole beat */}
          <button onClick={()=>doSubdivide(1)} title="Whole beat — 1 slot (key 1)"
            style={{...abtn(currentSub===1),minWidth:36,
              fontFamily:'"Times New Roman",serif',fontSize:13}}>
            d
          </button>

          {/* Two halves: d.d — dot connector */}
          <button onClick={()=>doSubdivide(2)} title="Split into 2 halves — slots joined by dot: d.r (key 2)"
            style={{...abtn(currentSub===2),minWidth:46,
              fontFamily:'"Times New Roman",serif',fontSize:13}}>
            d.d
          </button>

          {/* Four quarters: d,d — comma connector */}
          <button onClick={()=>doSubdivide(4)} title="Split into 4 quarters — slots joined by comma: d,r,m,f (key 4)"
            style={{...abtn(currentSub===4),minWidth:46,
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
              title={o===0?'Middle (key .)'
                :o>0?`${o} octave${o>1?'s':''} up (key ${o===1?"'":'>'})`
                :`${Math.abs(o)} octave${Math.abs(o)>1?'s':''} down (key ${o===-1?',':'<'})`}
              style={{minWidth:34,height:28,padding:'0 5px',
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

        {/* Bar management */}
        <button onClick={addMeasure} title="Add bar (M)"
          style={{...abtn(false),padding:'3px 10px',fontSize:11}}>+ Bar</button>
        <button onClick={()=>deleteMeasure()} title="Delete selected bar (Backspace)"
          style={{padding:'3px 10px',fontSize:11,fontWeight:500,
            border:'1px solid #fca5a5',borderRadius:5,
            background:'#fef2f2',color:'#dc2626',cursor:'pointer'}}>− Bar</button>
      </div>

      {/* ── Shortcut reference ── */}
      <div style={{background:'#f0f9ff',borderBottom:'1px solid #bae6fd',
        padding:'3px 14px',fontSize:10,color:'#0369a1',flexShrink:0,
        display:'flex',gap:14,flexWrap:'wrap',alignItems:'center'}}>
        <span><strong>Notation:</strong></span>
        <span>Whole beat → <code style={{background:'white',padding:'0 3px',borderRadius:2}}>d</code></span>
        <span>Halves → <code style={{background:'white',padding:'0 3px',borderRadius:2}}>d.r</code> (beat split d.d)</span>
        <span>Quarters → <code style={{background:'white',padding:'0 3px',borderRadius:2}}>d,r,m,f</code> (beat split d,d)</span>
        <span>Hold → <code style={{background:'white',padding:'0 3px',borderRadius:2}}>–</code></span>
        <span style={{marginLeft:4}}><strong>Keys:</strong> N=note · d r m f s l t · –=hold · Space=rest · 1/2/4=split · , . ' &lt; &gt;=octave · ← → ↑ ↓=navigate · M/⌫=bar</span>
      </div>

      {/* ── Score canvas ── */}
      <main style={{flex:1,overflowY:'auto',overflowX:'hidden',background:'#e5e7eb',padding:'24px'}}>
        <div style={{transform:`scale(${zoom})`,transformOrigin:'top center',minHeight:`${1200*zoom}px`}}>
          <div style={{background:'white',maxWidth:1100,margin:'0 auto',minHeight:1200,
            padding:'48px 32px',boxShadow:'0 4px 20px rgba(0,0,0,0.1)',
            borderRadius:4,boxSizing:'border-box'}}>

            {/* Score title */}
            <div style={{textAlign:'center',marginBottom:24,paddingBottom:12,borderBottom:'2px solid #1e2433'}}>
              <div style={{fontSize:26,fontWeight:700,fontFamily:'"Times New Roman",serif',color:'#111'}}>
                {score.title||'Untitled Score'}
              </div>
            </div>

            <SolfaRenderer
              onSelectSlot={(partId,mIdx,bi,si)=>{
                useSolfaStore.getState().selectSlot(partId,mIdx,bi,si)
              }}
            />
          </div>
        </div>
      </main>
    </div>
  )
}