// src/store/solfaStore.js
// FaithScore — Solfa Store
//
// BEAT MODEL:
//   Each measure has N beats (N = time sig numerator).
//   Each beat has a subdivision and that many slots.
//
//   subdivision=1 → 1 slot  "d"         (whole beat)
//   subdivision=2 → 2 slots "d.r"       (two halves, dot connector)
//   subdivision=3 → 3 slots "d,r,m"     (three thirds, comma connector — triplet/compound)
//   subdivision=4 → 4 slots "d,r,m,f"   (four quarters, comma connector)
//   subdivision=3q → special: 3 quarter-units (half + quarter = "d. ,")
//     This is stored as subdivision=3 but with the first slot spanning 2 units
//     and the last slot spanning 1 unit. We handle this in the renderer.
//
// SEPARATORS:
//   ":"  before each beat from beat 2 onward
//   "/"  at fixed midpoints per time signature (visual grouping only)
//
// SLASH "/" POSITIONS (beat index AFTER which slash appears, 0-based):
//   Pattern: the bar is split into equal halves or thirds
//   2/4  → none          (2 beats, too short to need splitting)
//   3/4  → none          (3 beats, odd — no clean split)
//   4/4  → after idx 1   (2+2: d :r / :m :f)
//   5/4  → after idx 2   (3+2 or 2+3: d :r :m / :f :s)
//   6/4  → after idx 2   (3+3: d :r :m / :f :s :l)
//   7/4  → after idx 3   (4+3: d :r :m :f / :s :l :t)
//   8/4  → after idx 3   (4+4)
//   6/8  → after idx 2   (3+3)
//   7/8  → after idx 3   (4+3)
//   8/8  → after idx 3   (4+4)
//   9/8  → after idx 2,5 (3+3+3)
//  12/8  → after idx 2,5,8 (3+3+3+3)
//   5/8  → after idx 2   (3+2)
//   3/8  → none
//   2/2  → none
//   4/2  → after idx 1

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

// subdivision: 1=whole, 2=halves, 3=thirds/triplet, 4=quarters
// specialSub: '3q' = three-quarter beat (half+quarter: slots of size 2+1 units)
function makeBeat(subdivision=1, specialSub=null) {
  return {
    id: uid(),
    subdivision,
    specialSub: specialSub||null,
    slots: Array.from({length: subdivision}, ()=>makeSlot('rest')),
  }
}

function makeEmptyMeasure(beats=4) {
  return {
    id: uid(),
    timeSignature: {beats, beatType:4},
    beats: Array.from({length:beats}, ()=>makeBeat(1)),
  }
}

function makePart(voiceDef, numMeasures=12, beats=4) {
  return {
    id:voiceDef.id, name:voiceDef.name, label:voiceDef.label,
    measures: Array.from({length:numMeasures}, ()=>makeEmptyMeasure(beats)),
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

// ── Migration ─────────────────────────────────────────────────────────────────
export function migrateMeasure(measure) {
  if (!measure) return makeEmptyMeasure(4)
  if (Array.isArray(measure.beats)) return measure
  const top=measure.timeSignature?.beats||4
  const beats=Array.from({length:top},(_,bi)=>{
    const beat=makeBeat(1)
    const note=(measure.notes||[]).find(n=>Math.abs(Math.floor(n.beatPos)-bi)<0.01)
    if (note&&note.type!=='rest')
      beat.slots[0]={id:uid(),type:note.type,syllable:note.syllable||null,octave:note.octave||0,lyric:note.lyric||null}
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

// ── SLASH POSITIONS ───────────────────────────────────────────────────────────
// Returns a Set of beat indices (0-based) AFTER which "/" appears.
// The slash splits the bar into equal visual groups for readability.
// It REPLACES the ":" at that beat boundary.
//
// RULE: slash goes at the midpoint(s) of the bar.
// For a bar of N beats:
//   N=2: no slash (too short)
//   N=3: no slash (odd, no clean midpoint)
//   N=4: slash after beat 1 (idx 1) → 2+2
//   N=5: slash after beat 2 (idx 2) → 3+2  (common grouping)
//   N=6: slash after beat 2 (idx 2) → 3+3
//   N=7: slash after beat 3 (idx 3) → 4+3
//   N=8: slash after beat 3 (idx 3) → 4+4
//   N=9: slash after beats 2,5       → 3+3+3
//   N=12: slash after beats 2,5,8    → 3+3+3+3
export function slashPositions(beats, beatType) {
  // Normalise: compound time (bottom=8) with groups of 3
  // 6/8 = 2 big beats of 3 quavers, 9/8 = 3 big beats, 12/8 = 4 big beats
  // We store beats as the raw top number, so 6/8 has 6 beat slots
  const n = beats
  if (n <= 3) return new Set()          // 2/x, 3/x — no slash
  if (n === 4) return new Set([1])       // 4/x → 2+2
  if (n === 5) return new Set([2])       // 5/x → 3+2
  if (n === 6) return new Set([2])       // 6/x → 3+3
  if (n === 7) return new Set([3])       // 7/x → 4+3
  if (n === 8) return new Set([3])       // 8/x → 4+4
  if (n === 9) return new Set([2,5])     // 9/x → 3+3+3
  if (n === 10) return new Set([4])      // 10/x → 5+5
  if (n === 12) return new Set([2,5,8])  // 12/x → 3+3+3+3
  return new Set()
}

// Connector character between slots within a beat
// subdivision=2 → "."  (half-beat: d.r)
// subdivision=3 → ","  (triplet/third: d,r,m)
// subdivision=4 → ","  (quarter: d,r,m,f)
// specialSub='3q' → no connector needed (handled specially)
export function slotConnector(subdivision) {
  return subdivision === 2 ? '.' : ','
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
    set({score,selectedPartId:score.parts[0]?.id??null,
      selectedMeasureIdx:null,selectedBeatIdx:null,selectedSlotIdx:null})
  },

  selectSlot: (partId,measureIdx,beatIdx,slotIdx) => set({
    selectedPartId:partId,selectedMeasureIdx:measureIdx,
    selectedBeatIdx:beatIdx,selectedSlotIdx:slotIdx,
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

  // ── Subdivide beat ────────────────────────────────────────────────────────
  // newSub: 1=whole, 2=halves, 3=triplet/thirds, 4=quarters
  // specialSub: '3q' = three-quarter beat (half+quarter)
  subdivideBeat: (partId,measureIdx,beatIdx,newSub,specialSub=null) => {
    get()._snapshot()
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            if (b.subdivision===newSub&&b.specialSub===specialSub) return b
            const first=b.slots[0]
            // For 3q (three-quarter), we use 2 slots: [half, quarter]
            const numSlots = specialSub==='3q' ? 2 : newSub
            const newSlots=Array.from({length:numSlots},(_,si)=>{
              if (si===0&&first&&first.type!=='rest')
                return {...makeSlot(first.type),syllable:first.syllable,octave:first.octave,lyric:first.lyric}
              return makeSlot('rest')
            })
            return {...b,subdivision:newSub,specialSub,slots:newSlots}
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