// src/store/solfaStore.js
// FaithScore — Solfa Store
//
// ══════════════════════════════════════════════════════════════════
// BEAT MODEL
// ══════════════════════════════════════════════════════════════════
// Each measure is divided into BEAT SLOTS.
// Each beat slot can be subdivided into sub-slots:
//   subdivision: 1   → one slot  = full beat  "d"
//   subdivision: 2   → two slots = half beats  "d." + ".d"
//   subdivision: 4   → four slots = quarter beats "d," ",d" ",,d" ",,,d"
//
// A slot contains: { type:'note'|'rest'|'sustain', syllable, octave, lyric }
// Slots that are not explicitly filled = rest.
//
// MEASURE STRUCTURE:
//   measure.beats = array of beat objects, length = time signature top
//   beat = { subdivision: 1|2|4, slots: Slot[] }
//   slot = { id, type, syllable, octave, lyric }
//
// NOTATION RENDERING:
//   subdivision 1: "d"  (whole beat)
//   subdivision 2: "d. .d" (two halves)
//   subdivision 4: "d, ,d ,,d ,,,d" (four quarters)
//   3/4 beat = subdivision 4 but first 3 slots filled: "d. .d.,"
//              stored as subdivision:4, slots[0..2] filled, slots[3] rest
//
// "/" separator: inserted at fixed midpoints per time signature:
//   4/4  → after beat 2
//   6/4  → after beat 3
//   6/8  → after beat 3
//   9/8  → after beats 3 and 6
//   12/8 → after beats 3, 6, 9
//   3/4, 2/4, 2/2 → no slash
//
// OCTAVE: 0=middle, 1=d¹, 2=d², -1=d₁, -2=d₂

import { create } from 'zustand'

export const SOLFA_SEMITONES = {
  d:0,de:1,r:2,ri:3,m:4,f:5,fe:6,s:7,se:8,l:9,ta:10,t:11,
}
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

// A single rhythmic slot (one subdivision within a beat)
function makeSlot(type='rest') {
  return { id:uid(), type, syllable:null, octave:0, lyric:null }
}

// A beat with `subdivision` equal slots
function makeBeat(subdivision=1) {
  return {
    id: uid(),
    subdivision,  // 1=whole, 2=half, 4=quarter
    slots: Array.from({length:subdivision}, ()=>makeSlot('rest')),
  }
}

// A measure with `beats` beats, all whole (subdivision=1)
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
  const combo = VOICE_COMBOS[voiceComboKey]||VOICE_COMBOS.satb
  return {
    id:uid(), type:'solfa', title:'Untitled', key,
    tempo:80, timeSignature:{beats,beatType:4},
    voiceCombo:voiceComboKey,
    parts:combo.voices.map(v=>makePart(v,numMeasures,beats)),
    sections:[], _savedAt:null, _cloudId:null,
  }
}

// Where "/" separators go (after which beat index, 0-based)
// Returns a Set of beat indices AFTER which a "/" is inserted
export function slashPositions(beats, beatType) {
  // Simple time (beatType=4)
  if (beatType===4) {
    if (beats===4) return new Set([1])      // 4/4: after beat 2 (index 1)
    if (beats===6) return new Set([2])      // 6/4: after beat 3 (index 2)
    if (beats===8) return new Set([3])      // 8/4: after beat 4
    return new Set()                        // 2/4, 3/4: no slash
  }
  // Compound time (beatType=8)
  if (beatType===8) {
    if (beats===6)  return new Set([2])           // 6/8:  after beat 3 (index 2)
    if (beats===9)  return new Set([2,5])          // 9/8:  after beats 3 and 6
    if (beats===12) return new Set([2,5,8])        // 12/8: after beats 3, 6, 9
    return new Set()
  }
  return new Set()
}

// ── STORE ────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set,get) => ({
  score:              buildEmptySolfaScore(),
  selectedPartId:     null,
  selectedMeasureIdx: null,
  selectedBeatIdx:    null,   // which beat (0-based)
  selectedSlotIdx:    null,   // which slot within the beat (0-based)
  inputMode:          'select',
  selectedOctave:     0,
  _undoStack:         [],

  // ── metadata ──────────────────────────────────────────────────────────────
  setTitle:   t  => set(s=>({score:{...s.score,title:t}})),
  setKey:     k  => set(s=>({score:{...s.score,key:k}})),
  setTempo:   t  => set(s=>({score:{...s.score,tempo:t}})),
  setCloudId: id => set(s=>({score:{...s.score,_cloudId:id}})),
  setInputMode:      m => set({inputMode:m}),
  setSelectedOctave: o => set({selectedOctave:o}),

  loadScore: score => set({
    score, selectedPartId:score.parts[0]?.id??null,
    selectedMeasureIdx:null, selectedBeatIdx:null, selectedSlotIdx:null,
  }),

  // ── selection ─────────────────────────────────────────────────────────────
  selectSlot: (partId, measureIdx, beatIdx, slotIdx) => set({
    selectedPartId:partId, selectedMeasureIdx:measureIdx,
    selectedBeatIdx:beatIdx, selectedSlotIdx:slotIdx,
  }),
  clearSelection: () => set({
    selectedPartId:null, selectedMeasureIdx:null,
    selectedBeatIdx:null, selectedSlotIdx:null,
  }),

  // ── undo ──────────────────────────────────────────────────────────────────
  _snapshot: () => {
    const {score,_undoStack}=get()
    set({_undoStack:[..._undoStack.slice(-30),JSON.parse(JSON.stringify(score))]})
  },
  undo: () => {
    const {_undoStack}=get()
    if (!_undoStack.length) return
    set({score:_undoStack[_undoStack.length-1],_undoStack:_undoStack.slice(0,-1)})
  },

  // ── subdivide a beat ─────────────────────────────────────────────────────
  // Changes a beat's subdivision WITHOUT losing existing content where possible.
  // newSub: 1 | 2 | 4
  subdivideBeat: (partId, measureIdx, beatIdx, newSub) => {
    get()._snapshot()
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi) => {
          if (mi!==measureIdx) return m
          const beats = m.beats.map((b,bi) => {
            if (bi!==beatIdx) return b
            if (b.subdivision===newSub) return b  // already correct
            // Build new slots, preserving content from old slots where possible
            const newSlots = Array.from({length:newSub}, (_,si) => {
              // Try to map old slot content
              const oldSlotIdx = Math.floor(si * b.subdivision / newSub)
              const old = b.slots[oldSlotIdx]
              if (old && old.type!=='rest') {
                return {...makeSlot(old.type), syllable:old.syllable, octave:old.octave, lyric:old.lyric}
              }
              return makeSlot('rest')
            })
            return {...b, subdivision:newSub, slots:newSlots}
          })
          return {...m, beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // ── place note into a slot ────────────────────────────────────────────────
  placeNote: (partId, measureIdx, beatIdx, slotIdx, syllable) => {
    get()._snapshot()
    const octave = get().selectedOctave
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi) => {
          if (mi!==measureIdx) return m
          const beats = m.beats.map((b,bi) => {
            if (bi!==beatIdx) return b
            const slots = b.slots.map((sl,si) => {
              if (si!==slotIdx) return sl
              return {...sl,
                type: syllable?'note':'rest',
                syllable: syllable||null,
                octave,
              }
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

  // ── place sustain/hold ────────────────────────────────────────────────────
  placeSustain: (partId, measureIdx, beatIdx, slotIdx) => {
    get()._snapshot()
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi) => {
          if (mi!==measureIdx) return m
          const beats = m.beats.map((b,bi) => {
            if (bi!==beatIdx) return b
            const slots = b.slots.map((sl,si) => {
              if (si!==slotIdx) return sl
              return {...sl, type:'sustain', syllable:null}
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

  // ── change octave of selected slot ───────────────────────────────────────
  changeSlotOctave: (partId, measureIdx, beatIdx, slotIdx, newOctave) => {
    get()._snapshot()
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi) => {
          if (mi!==measureIdx) return m
          const beats = m.beats.map((b,bi) => {
            if (bi!==beatIdx) return b
            const slots = b.slots.map((sl,si) => {
              if (si!==slotIdx) return sl
              return {...sl, octave:newOctave}
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

  // ── set lyric ─────────────────────────────────────────────────────────────
  setLyric: (partId, measureIdx, beatIdx, slotIdx, lyric) => {
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi) => {
          if (mi!==measureIdx) return m
          const beats = m.beats.map((b,bi) => {
            if (bi!==beatIdx) return b
            const slots = b.slots.map((sl,si) => si!==slotIdx?sl:{...sl,lyric})
            return {...b,slots}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // ── measures ──────────────────────────────────────────────────────────────
  addMeasure: () => {
    set(s => {
      const beats = s.score.timeSignature.beats
      const parts = s.score.parts.map(p=>({...p,measures:[...p.measures,makeEmptyMeasure(beats)]}))
      return {score:{...s.score,parts}}
    })
  },

  deleteMeasure: (measureIdx) => {
    const {score,selectedMeasureIdx}=get()
    const numM = score.parts[0]?.measures?.length||0
    if (numM<=1) return
    get()._snapshot()
    const idx    = measureIdx!==undefined?measureIdx:selectedMeasureIdx!==null?selectedMeasureIdx:numM-1
    const newSel = Math.max(0,Math.min(idx,numM-2))
    set(s => {
      const parts = s.score.parts.map(p=>({...p,measures:p.measures.filter((_,i)=>i!==idx)}))
      return {score:{...s.score,parts},selectedMeasureIdx:newSel,selectedBeatIdx:null,selectedSlotIdx:null}
    })
  },

  // ── arrow navigation ──────────────────────────────────────────────────────
  // Navigates slot by slot across beats and measures
  navigateSlot: (direction) => {
    const {score,selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx} = get()
    const sel = get().selectSlot

    // Default: land on first slot
    if (selectedPartId===null || selectedMeasureIdx===null) {
      const p=score.parts[0], m=p?.measures[0]
      if (m?.beats[0]?.slots[0]) sel(p.id,0,0,0)
      return
    }

    const pi    = score.parts.findIndex(p=>p.id===selectedPartId)
    const part  = score.parts[pi]
    if (!part) return
    const meas  = part.measures[selectedMeasureIdx]
    if (!meas)  return

    const bi   = selectedBeatIdx??0
    const si   = selectedSlotIdx??0
    const beat = meas.beats[bi]
    if (!beat) return

    if (direction==='right') {
      // Next slot within same beat
      if (si < beat.slots.length-1) { sel(selectedPartId,selectedMeasureIdx,bi,si+1); return }
      // Next beat
      if (bi < meas.beats.length-1) { sel(selectedPartId,selectedMeasureIdx,bi+1,0); return }
      // Next measure
      if (selectedMeasureIdx < part.measures.length-1) {
        sel(selectedPartId,selectedMeasureIdx+1,0,0); return
      }
    } else if (direction==='left') {
      if (si > 0) { sel(selectedPartId,selectedMeasureIdx,bi,si-1); return }
      if (bi > 0) {
        const prevB = meas.beats[bi-1]
        sel(selectedPartId,selectedMeasureIdx,bi-1,prevB.slots.length-1); return
      }
      if (selectedMeasureIdx > 0) {
        const pm = part.measures[selectedMeasureIdx-1]
        const lb = pm.beats[pm.beats.length-1]
        sel(selectedPartId,selectedMeasureIdx-1,pm.beats.length-1,lb.slots.length-1); return
      }
    } else if (direction==='down') {
      if (pi < score.parts.length-1) {
        const np = score.parts[pi+1]
        const nb = np.measures[selectedMeasureIdx]?.beats[bi]
        const ns = nb ? Math.min(si, nb.slots.length-1) : 0
        sel(np.id,selectedMeasureIdx,bi,ns)
      }
    } else if (direction==='up') {
      if (pi > 0) {
        const pp = score.parts[pi-1]
        const pb = pp.measures[selectedMeasureIdx]?.beats[bi]
        const ps = pb ? Math.min(si, pb.slots.length-1) : 0
        sel(pp.id,selectedMeasureIdx,bi,ps)
      }
    }
  },

  addSection: (label,startMeasure,endMeasure) => {
    set(s=>({score:{...s.score,sections:[...s.score.sections,{id:uid(),label,startMeasure,endMeasure}]}}))
  },
}))