// src/components/SolfaWizard/index.jsx
// FaithScore — New Solfa Score wizard
// Step 1: Choose voice combination
// Step 2: Key, time signature, tempo, title, composer

import { useState } from 'react'
import { VOICE_COMBOS, buildEmptySolfaScore } from '../../store/solfaStore'

const KEYS = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']
const TIME_SIGS = [{beats:2,label:'2/4'},{beats:3,label:'3/4'},{beats:4,label:'4/4'},{beats:6,label:'6/8'}]

// Voice combo cards with descriptions
const COMBO_INFO = {
  solo:       { icon:'♪',   desc:'Single melody line. Good for solo songs and unison.',           color:'#6366f1' },
  sa:         { icon:'♀♀',  desc:'Soprano and Alto. Standard two-part women\'s choir.',           color:'#ec4899' },
  tb:         { icon:'♂♂',  desc:'Tenor and Bass. Standard two-part men\'s choir.',               color:'#0ea5e9' },
  sab:        { icon:'♀♂',  desc:'Soprano, Alto, Bass. Three-part mixed choir.',                  color:'#10b981' },
  satb:       { icon:'♫',   desc:'Soprano, Alto, Tenor, Bass. Full four-part choral writing.',    color:'#f59e0b' },
  solo_satb:  { icon:'♪♫',  desc:'Solo melody above full SATB choir. Cantata/anthem style.',     color:'#8b5cf6' },
  satb_piano: { icon:'♫🎹', desc:'SATB choir with piano accompaniment line.',                     color:'#ef4444' },
  solo_piano: { icon:'♪🎹', desc:'Solo voice with piano accompaniment.',                           color:'#14b8a6' },
}

export default function SolfaWizard({onDone, onCancel}) {
  const [step,     setStep]     = useState(1)
  const [combo,    setCombo]    = useState('satb')
  const [key,      setKey]      = useState('C')
  const [timeSig,  setTimeSig]  = useState({beats:4, beatType:4})
  const [tempo,    setTempo]    = useState(80)
  const [title,    setTitle]    = useState('')
  const [composer, setComposer] = useState('')
  const [measures, setMeasures] = useState(12)

  function finish() {
    const score = buildEmptySolfaScore(combo, key, timeSig.beats, measures)
    score.title    = title    || 'Untitled'
    score.composer = composer || ''
    score.tempo    = tempo
    score.timeSignature = timeSig
    onDone(score)
  }

  const S = {
    overlay: {position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,
      fontFamily:'system-ui, sans-serif'},
    card: {background:'white',borderRadius:16,width:'100%',maxWidth:700,
      maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.25)'},
    header: {padding:'24px 28px 16px',borderBottom:'1px solid #e5e7eb'},
    body:   {padding:'24px 28px'},
    footer: {padding:'16px 28px',borderTop:'1px solid #e5e7eb',
      display:'flex',alignItems:'center',justifyContent:'space-between'},
    label:  {fontSize:12,fontWeight:600,color:'#374151',display:'block',marginBottom:6},
    input:  {width:'100%',padding:'9px 12px',fontSize:14,border:'1px solid #d1d5db',
      borderRadius:7,outline:'none',boxSizing:'border-box',color:'#1e2433'},
  }

  return (
    <div style={S.overlay}>
      <div style={S.card}>

        {/* Header */}
        <div style={S.header}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:'#9ca3af',
                letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>
                New Solfa Score · Step {step} of 2
              </div>
              <div style={{fontSize:20,fontWeight:700,color:'#1e2433'}}>
                {step===1 ? 'Choose voice combination' : 'Score details'}
              </div>
            </div>
            <button onClick={onCancel}
              style={{width:32,height:32,borderRadius:'50%',border:'1px solid #e5e7eb',
                background:'white',cursor:'pointer',fontSize:16,color:'#9ca3af'}}>✕</button>
          </div>

          {/* Step dots */}
          <div style={{display:'flex',gap:6,marginTop:14}}>
            {[1,2].map(s=>(
              <div key={s} style={{height:4,flex:1,borderRadius:2,
                background:s<=step?'#2563eb':'#e5e7eb',
                transition:'background 0.2s'}}/>
            ))}
          </div>
        </div>

        {/* Step 1 — Voice combo */}
        {step===1 && (
          <div style={S.body}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}}>
              {Object.entries(VOICE_COMBOS).map(([key, combo_def])=>{
                const info = COMBO_INFO[key] || {}
                const isSelected = combo===key
                return (
                  <button key={key} onClick={()=>setCombo(key)}
                    style={{
                      display:'flex',alignItems:'flex-start',gap:12,
                      padding:'14px 16px',borderRadius:10,cursor:'pointer',
                      border:`2px solid ${isSelected?(info.color||'#2563eb'):'#e5e7eb'}`,
                      background:isSelected?((info.color||'#2563eb')+'11'):'white',
                      textAlign:'left',transition:'all 0.15s',
                    }}>
                    <div style={{width:40,height:40,borderRadius:8,flexShrink:0,
                      background:isSelected?((info.color||'#2563eb')+'22'):'#f3f4f6',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:18}}>
                      {info.icon||'♫'}
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,
                        color:isSelected?(info.color||'#2563eb'):'#1e2433',marginBottom:3}}>
                        {combo_def.label}
                      </div>
                      <div style={{fontSize:11.5,color:'#6b7280',lineHeight:1.4}}>
                        {info.desc||''}
                      </div>
                      {/* Voice labels */}
                      <div style={{display:'flex',gap:4,marginTop:6}}>
                        {combo_def.voices.map(v=>(
                          <span key={v.id} style={{fontSize:10,fontWeight:700,
                            padding:'1px 6px',borderRadius:3,
                            background:isSelected?((info.color||'#2563eb')+'22'):'#f3f4f6',
                            color:isSelected?(info.color||'#2563eb'):'#6b7280'}}>
                            {v.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2 — Score details */}
        {step===2 && (
          <div style={S.body}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>

              <div style={{gridColumn:'1/-1'}}>
                <label style={S.label}>Score title</label>
                <input value={title} onChange={e=>setTitle(e.target.value)}
                  placeholder="e.g. Lead us Home" style={S.input}
                  onFocus={e=>e.target.style.borderColor='#2563eb'}
                  onBlur={e=>e.target.style.borderColor='#d1d5db'}/>
              </div>

              <div style={{gridColumn:'1/-1'}}>
                <label style={S.label}>Composer / Arranger</label>
                <input value={composer} onChange={e=>setComposer(e.target.value)}
                  placeholder="Optional" style={S.input}
                  onFocus={e=>e.target.style.borderColor='#2563eb'}
                  onBlur={e=>e.target.style.borderColor='#d1d5db'}/>
              </div>

              <div>
                <label style={S.label}>Key (Doh is…)</label>
                <select value={key} onChange={e=>setKey(e.target.value)}
                  style={{...S.input}}>
                  {KEYS.map(k=><option key={k} value={k}>{k} — Doh is {k}</option>)}
                </select>
              </div>

              <div>
                <label style={S.label}>Time signature</label>
                <div style={{display:'flex',gap:6}}>
                  {TIME_SIGS.map(ts=>(
                    <button key={ts.label}
                      onClick={()=>setTimeSig({beats:ts.beats,beatType:ts.beats===6?8:4})}
                      style={{flex:1,padding:'8px 0',border:`2px solid ${timeSig.beats===ts.beats?'#2563eb':'#e5e7eb'}`,
                        borderRadius:6,background:timeSig.beats===ts.beats?'#eff6ff':'white',
                        cursor:'pointer',fontSize:14,fontWeight:700,
                        color:timeSig.beats===ts.beats?'#2563eb':'#374151',
                        fontFamily:'"Times New Roman",serif'}}>
                      {ts.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={S.label}>Tempo ♩= {tempo}</label>
                <input type="range" min={40} max={200} value={tempo}
                  onChange={e=>setTempo(Number(e.target.value))}
                  style={{width:'100%',accentColor:'#2563eb'}}/>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#9ca3af',marginTop:2}}>
                  <span>40 (Largo)</span><span>120 (Allegro)</span><span>200</span>
                </div>
              </div>

              <div>
                <label style={S.label}>Number of measures</label>
                <input type="number" min={4} max={64} value={measures}
                  onChange={e=>setMeasures(Math.max(4,Math.min(64,parseInt(e.target.value)||12)))}
                  style={{...S.input,width:'50%'}}/>
              </div>

            </div>

            {/* Summary box */}
            <div style={{marginTop:20,padding:'14px 16px',borderRadius:8,
              background:'#f0fdf4',border:'1px solid #bbf7d0'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#166534',marginBottom:6}}>
                Score summary
              </div>
              <div style={{fontSize:12,color:'#374151',display:'grid',
                gridTemplateColumns:'1fr 1fr',gap:4}}>
                <span>Voice: <strong>{VOICE_COMBOS[combo]?.label}</strong></span>
                <span>Key: <strong>Doh is {key}</strong></span>
                <span>Time: <strong>{timeSig.beats}/{timeSig.beatType}</strong></span>
                <span>Tempo: <strong>♩={tempo}</strong></span>
                <span>Bars: <strong>{measures}</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={S.footer}>
          <button onClick={step===1?onCancel:()=>setStep(1)}
            style={{padding:'9px 20px',border:'1px solid #d1d5db',borderRadius:7,
              background:'white',cursor:'pointer',fontSize:13,color:'#374151'}}>
            {step===1?'Cancel':'← Back'}
          </button>
          <button
            onClick={step===1?()=>setStep(2):finish}
            style={{padding:'9px 24px',border:'none',borderRadius:7,
              background:'#2563eb',color:'white',cursor:'pointer',
              fontSize:13,fontWeight:700}}>
            {step===1?'Next →':'Create score'}
          </button>
        </div>
      </div>
    </div>
  )
}