// src/store/solfaStore.js
// FaithScore — Solfa Store
//
// ══════════════════════════════════════════════════════════════════
// NOTATION MODEL (from real handwritten solfa samples)
// ══════════════════════════════════════════════════════════════════
//
// BEATS & SLOTS:
//   Each measure has N beats (N = time sig top number).
//   Each beat has a SUBDIVISION (1, 2, 3, or 4) and that many SLOTS.
//   Each slot holds one rhythmic event: note, rest, or sustain.
//
//   subdivision=1 → whole beat   → renders: "d"
//   subdivision=2 → two halves   → renders: "d.r"  (dot connects)
//   subdivision=3 → three thirds → renders: "d,r,m" (comma connects, compound)
//   subdivision=4 → four qtrs    → renders: "d,r,m,f" (comma connects)
//
// SEPARATORS (exactly as in the handwritten samples):
//   ":"  written BEFORE each beat from beat 2 onward  (pulse marker)
//   "/"  written at fixed midpoints of the bar (visual grouping, no timing)
//   "."  connects slots within a beat for subdivision=2
//   ","  connects slots within a beat for subdivision=3 or 4
//
// So 4/4 with all whole notes: "d :r :m :f"
// 4/4, beat1 split in 2:       "d.r :m :f"  (no extra colon inside beat)
// 4/4, beat1 split in 4:       "d,r,m,f :s :l :t"
//
// SLASH "/" positions (fixed per time signature):
//   4/4  → after beat index 1     → "d :r / :m :f"
//   6/4  → after beat index 2     → "d :r :m / :f :s :l"
//   6/8  → after beat index 2     → same
//   9/8  → after indices 2,5      → 3+3+3 groups
//   12/8 → after indices 2,5,8    → 3+3+3+3 groups
//   2/4, 3/4 → no slash
//
// OCTAVE (superscript/subscript right of syllable):
//   0=d  1=d¹  2=d²  -1=d₁  -2=d₂

import { create } from 'zustand'

export const SOLFA_SEMITONES = {d:0,de:1,r:2,ri:3,m:4,f:5,fe:6,s:7,se:8,l:9,ta:10,t:11}
export const KEY_ROOTS = {
  C:60,'C#':61,Db:61,D:62,'D#':63,Eb:63,E:64,F:65,'F#':66,Gb:66,
  G:67,'G#':68,Ab:68,A:69,'A#':70,Bb:70,B:71,
}
export function solfaToMidi(syllable,octave=0,key='C') {
  return (KEY_ROOTS[key]??60)+(SOLFA_SEMITONES[syllable?.toLowerCase()]??0)+octave*12
}

export const VOICE_COMBOS = {
  solo:       {label:'Solo',        voices:[{id:'solo',name:'Voice',  label:'V'}]},
  sa:         {label:'SA',          voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'}]},
  tb:         {label:'TB',          voices:[{id:'t',name:'Tenor',  label:'T'},{id:'b',name:'Bass', label:'B'}]},
  sab:        {label:'SAB',         voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'b',name:'Bass',label:'B'}]},
  satb:       {label:'SATB',        voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}]},
  solo_satb:  {label:'Solo + SATB', voices:[{id:'solo',name:'Solo',label:'Solo'},{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}]},
  satb_piano: {label:'SATB + Piano',voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'},{id:'piano',name:'Piano',label:'Pno'}]},
  solo_piano: {label:'Solo + Piano',voices:[{id:'solo',name:'Solo',label:'Solo'},{id:'piano',name:'Piano',label:'Pno'}]},
}

function uid() { return crypto.randomUUID() }

function makeSlot(type='rest') {
  return {id:uid(), type, syllable:null, octave:0, lyric:null}
}

function makeBeat(subdivision=1) {
  return {id:uid(), subdivision, slots:Array.from({length:subdivision},()=>makeSlot('rest'))}
}

function makeEmptyMeasure(beats=4) {
  return {
    id:uid(), timeSignature:{beats,beatType:4},
    beats:Array.from({length:beats},()=>makeBeat(1)),
  }
}

function makePart(voiceDef,numMeasures=12,beats=4) {
  return {
    id:voiceDef.id, name:voiceDef.name, label:voiceDef.label,
    measures:Array.from({length:numMeasures},()=>makeEmptyMeasure(beats)),
  }
}

export function buildEmptySolfaScore(voiceComboKey='satb',key='C',beats=4,numMeasures=12) {
  const combo=VOICE_COMBOS[voiceComboKey]||VOICE_COMBOS.satb
  return {
    id:uid(), type:'solfa', title:'Untitled', key,
    tempo:80, timeSignature:{beats,beatType:4},
    voiceCombo:voiceComboKey,
    parts:combo.voices.map(v=>makePart(v,numMeasures,beats)),
    sections:[], _savedAt:null, _cloudId:null,
  }
}

// ── Migration (old notes[] → new beats[]) ────────────────────────────────────
export function migrateMeasure(measure) {
  if (!measure) return makeEmptyMeasure(4)
  if (Array.isArray(measure.beats)) return measure
  const top=measure.timeSignature?.beats||4
  const beats=Array.from({length:top},(_,bi)=>{
    const beat=makeBeat(1)
    const note=(measure.notes||[]).find(n=>Math.abs(Math.floor(n.beatPos)-bi)<0.01)
    if (note&&note.type!=='rest') {
      beat.slots[0]={id:uid(),type:note.type,syllable:note.syllable||null,octave:note.octave||0,lyric:note.lyric||null}
    }
    return beat
  })
  return {...measure,beats}
}

export function migrateScore(score) {
  if (!score) return buildEmptySolfaScore()
  return {
    ...score,
    parts:(score.parts||[]).map(p=>({
      ...p, measures:(p.measures||[]).map(m=>migrateMeasure(m)),
    })),
  }
}

// ── Slash positions (fixed per time sig) ─────────────────────────────────────
export function slashPositions(beats,beatType) {
  if (beatType===4||beatType===8) {
    if (beats===4||beats===6&&beatType===8) return new Set([2])   // 6/8: after beat 3 (idx 2)
    if (beats===4)  return new Set([1])   // 4/4: after beat 2 (idx 1)
    if (beats===6)  return new Set([2])   // 6/4: after beat 3 (idx 2)
    if (beats===8)  return new Set([3])   // 8/x: midpoint
    if (beats===9)  return new Set([2,5]) // 9/x
    if (beats===12) return new Set([2,5,8])
  }
  // Simple overrides:
  if (beats===4  && beatType===4) return new Set([1])
  if (beats===6  && beatType===4) return new Set([2])
  if (beats===6  && beatType===8) return new Set([2])
  if (beats===9  && beatType===8) return new Set([2,5])
  if (beats===12 && beatType===8) return new Set([2,5,8])
  return new Set()
}

// ── Connector between slots within one beat ───────────────────────────────────
// subdivision=2 → "."   (half-beat connector, as in "d.r")
// subdivision=3,4 → "," (quarter/third connector, as in "d,r,m")
export function slotConnector(subdivision) {
  return subdivision===2 ? '.' : ','
}

// ── STORE ────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set,get) => ({
  score:              buildEmptySolfaScore(),
  selectedPartId:     null,
  selectedMeasureIdx: null,
  selectedBeatIdx:    null,
  selectedSlotIdx:    null,
  inputMode:          'select',
  selectedOctave:     0,
  _undoStack:         [],

  setTitle:   t  => set(s=>({score:{...s.score,title:t}})),
  setKey:     k  => set(s=>({score:{...s.score,key:k}})),
  setTempo:   t  => set(s=>({score:{...s.score,tempo:t}})),
  setCloudId: id => set(s=>({score:{...s.score,_cloudId:id}})),
  setInputMode:      m => set({inputMode:m}),
  setSelectedOctave: o => set({selectedOctave:o}),

  loadScore: rawScore => {
    const score=migrateScore(rawScore)
    set({score, selectedPartId:score.parts[0]?.id??null,
      selectedMeasureIdx:null, selectedBeatIdx:null, selectedSlotIdx:null})
  },

  selectSlot: (partId,measureIdx,beatIdx,slotIdx) => set({
    selectedPartId:partId, selectedMeasureIdx:measureIdx,
    selectedBeatIdx:beatIdx, selectedSlotIdx:slotIdx,
  }),
  clearSelection: () => set({
    selectedPartId:null,selectedMeasureIdx:null,selectedBeatIdx:null,selectedSlotIdx:null,
  }),

  _snapshot: () => {
    const {score,_undoStack}=get()
    set({_undoStack:[..._undoStack.slice(-30),JSON.parse(JSON.stringify(score))]})
  },
  undo: () => {
    const {_undoStack}=get()
    if (!_undoStack.length) return
    set({score:_undoStack[_undoStack.length-1],_undoStack:_undoStack.slice(0,-1)})
  },

  subdivideBeat: (partId,measureIdx,beatIdx,newSub) => {
    get()._snapshot()
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            if (b.subdivision===newSub) return b
            const first=b.slots[0]
            const newSlots=Array.from({length:newSub},(_,si)=>{
              if (si===0&&first&&first.type!=='rest')
                return {...makeSlot(first.type),syllable:first.syllable,octave:first.octave,lyric:first.lyric}
              return makeSlot('rest')
            })
            return {...b,subdivision:newSub,slots:newSlots}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  placeNote: (partId,measureIdx,beatIdx,slotIdx,syllable) => {
    get()._snapshot()
    const octave=get().selectedOctave
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const slots=b.slots.map((sl,si)=>si!==slotIdx?sl:{
              ...sl,type:syllable?'note':'rest',syllable:syllable||null,octave,
            })
            return {...b,slots}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  placeSustain: (partId,measureIdx,beatIdx,slotIdx) => {
    get()._snapshot()
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const slots=b.slots.map((sl,si)=>si!==slotIdx?sl:{...sl,type:'sustain',syllable:null})
            return {...b,slots}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  changeSlotOctave: (partId,measureIdx,beatIdx,slotIdx,newOctave) => {
    get()._snapshot()
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const slots=b.slots.map((sl,si)=>si!==slotIdx?sl:{...sl,octave:newOctave})
            return {...b,slots}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  setLyric: (partId,measureIdx,beatIdx,slotIdx,lyric) => {
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const slots=b.slots.map((sl,si)=>si!==slotIdx?sl:{...sl,lyric})
            return {...b,slots}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  addMeasure: () => {
    set(s=>{
      const beats=s.score.timeSignature.beats
      const parts=s.score.parts.map(p=>({...p,measures:[...p.measures,makeEmptyMeasure(beats)]}))
      return {score:{...s.score,parts}}
    })
  },

  deleteMeasure: (measureIdx) => {
    const {score,selectedMeasureIdx}=get()
    const numM=score.parts[0]?.measures?.length||0
    if (numM<=1) return
    get()._snapshot()
    const idx=measureIdx!==undefined?measureIdx:selectedMeasureIdx!==null?selectedMeasureIdx:numM-1
    const newSel=Math.max(0,Math.min(idx,numM-2))
    set(s=>{
      const parts=s.score.parts.map(p=>({...p,measures:p.measures.filter((_,i)=>i!==idx)}))
      return {score:{...s.score,parts},selectedMeasureIdx:newSel,selectedBeatIdx:null,selectedSlotIdx:null}
    })
  },

  addSection: (label,startMeasure,endMeasure) => {
    set(s=>({score:{...s.score,sections:[...s.score.sections,{id:uid(),label,startMeasure,endMeasure}]}}))
  },

  navigateSlot: (direction) => {
    const {score,selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx}=get()
    const sel=get().selectSlot
    if (selectedPartId===null||selectedMeasureIdx===null) {
      const p=score.parts[0],m=p?.measures[0]
      if (m?.beats[0]?.slots[0]) sel(p.id,0,0,0)
      return
    }
    const pi=score.parts.findIndex(p=>p.id===selectedPartId)
    const part=score.parts[pi]; if (!part) return
    const meas=migrateMeasure(part.measures[selectedMeasureIdx]); if (!meas) return
    const bi=selectedBeatIdx??0, si=selectedSlotIdx??0
    const beat=meas.beats[bi]; if (!beat) return

    if (direction==='right') {
      if (si<beat.slots.length-1){sel(selectedPartId,selectedMeasureIdx,bi,si+1);return}
      if (bi<meas.beats.length-1){sel(selectedPartId,selectedMeasureIdx,bi+1,0);return}
      if (selectedMeasureIdx<part.measures.length-1){sel(selectedPartId,selectedMeasureIdx+1,0,0);return}
    } else if (direction==='left') {
      if (si>0){sel(selectedPartId,selectedMeasureIdx,bi,si-1);return}
      if (bi>0){const pb=meas.beats[bi-1];sel(selectedPartId,selectedMeasureIdx,bi-1,pb.slots.length-1);return}
      if (selectedMeasureIdx>0){
        const pm=migrateMeasure(part.measures[selectedMeasureIdx-1])
        const lb=pm.beats[pm.beats.length-1]
        sel(selectedPartId,selectedMeasureIdx-1,pm.beats.length-1,lb.slots.length-1);return
      }
    } else if (direction==='down') {
      if (pi<score.parts.length-1){
        const np=score.parts[pi+1]
        const nb=migrateMeasure(np.measures[selectedMeasureIdx])?.beats[bi]
        sel(np.id,selectedMeasureIdx,bi,Math.min(si,(nb?.slots.length||1)-1))
      }
    } else if (direction==='up') {
      if (pi>0){
        const pp=score.parts[pi-1]
        const pb=migrateMeasure(pp.measures[selectedMeasureIdx])?.beats[bi]
        sel(pp.id,selectedMeasureIdx,bi,Math.min(si,(pb?.slots.length||1)-1))
      }
    }
  },
}))