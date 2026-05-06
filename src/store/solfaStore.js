// src/store/solfaStore.js
// FaithScore — Solfa notation store
//
// ── RHYTHM MODEL ──────────────────────────────────────────────────────────────
// All durations stored in BEATS (crotchet = 1 beat).
// Quarter-beat is the smallest unit = 0.25 beats.
//
// duration = 1.00  → full beat       (no prefix/suffix)   "d"
// duration = 0.50  → half beat       (. prefix)           ".d"
// duration = 0.25  → quarter beat    (, suffix on prev)   "d,"
//
// beatPos is cumulative from measure start, in beats.
// e.g. in 4/4:
//   beat 0 (full)    → beatPos:0,    duration:1
//   beat 0 (half)    → beatPos:0,    duration:0.5
//   beat 0.5 (half)  → beatPos:0.5,  duration:0.5
//   beat 0 (quarter) → beatPos:0,    duration:0.25
//   beat 0.25        → beatPos:0.25, duration:0.25  etc.
//
// OCTAVE:
//   0  = middle  (d)
//   1  = upper   (d¹, superscript)
//   2  = double upper (d²)
//  -1  = lower   (d₁, subscript)
//  -2  = double lower (d₂)

import { create } from 'zustand'

export const SOLFA_SEMITONES = {
  d:0, de:1, r:2, ri:3, m:4, f:5, fe:6, s:7, se:8, l:9, ta:10, t:11,
}
export const KEY_ROOTS = {
  C:60,'C#':61,Db:61,D:62,'D#':63,Eb:63,E:64,F:65,'F#':66,Gb:66,
  G:67,'G#':68,Ab:68,A:69,'A#':70,Bb:70,B:71,
}
export function solfaToMidi(syllable, octave=0, key='C') {
  const root   = KEY_ROOTS[key] ?? 60
  const offset = SOLFA_SEMITONES[syllable?.toLowerCase()] ?? 0
  return root + offset + octave * 12
}

export const VOICE_COMBOS = {
  solo:       { label:'Solo',         voices:[{id:'solo',name:'Voice',   label:'V'}] },
  sa:         { label:'SA',           voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'}] },
  tb:         { label:'TB',           voices:[{id:'t',name:'Tenor',  label:'T'},{id:'b',name:'Bass', label:'B'}] },
  sab:        { label:'SAB',          voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'b',name:'Bass',label:'B'}] },
  satb:       { label:'SATB',         voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}] },
  solo_satb:  { label:'Solo + SATB',  voices:[{id:'solo',name:'Solo',label:'Solo'},{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}] },
  satb_piano: { label:'SATB + Piano', voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'},{id:'piano',name:'Piano',label:'Pno'}] },
  solo_piano: { label:'Solo + Piano', voices:[{id:'solo',name:'Solo',label:'Solo'},{id:'piano',name:'Piano',label:'Pno'}] },
}

// ── helpers ───────────────────────────────────────────────────────────────────
function uid() { return crypto.randomUUID() }

// Round to 4 decimal places to kill float drift
function rnd(n) { return Math.round(n * 10000) / 10000 }

// A silent slot at beatPos for duration beats
function makeRest(beatPos, duration) {
  return { id:uid(), type:'rest', syllable:null, octave:0,
           duration:rnd(duration), beatPos:rnd(beatPos), lyric:null }
}

// Empty measure: one full-beat rest per beat
function makeEmptyMeasure(beats=4) {
  const notes = []
  for (let i=0; i<beats; i++) notes.push(makeRest(i, 1))
  return { id:uid(), timeSignature:{beats, beatType:4}, notes }
}

function makePart(voiceDef, numMeasures=12, beats=4) {
  return {
    id:       voiceDef.id,
    name:     voiceDef.name,
    label:    voiceDef.label,
    measures: Array.from({length:numMeasures}, ()=>makeEmptyMeasure(beats)),
  }
}

// Ensure notes array covers exactly [0, maxBeats) with no gaps or overlaps
function fillGaps(notes, maxBeats) {
  const sorted = [...notes].sort((a,b)=>a.beatPos-b.beatPos)
  const result = []
  let cursor = 0
  for (const n of sorted) {
    const bp = rnd(n.beatPos)
    if (bp > cursor + 0.001) result.push(makeRest(cursor, rnd(bp - cursor)))
    if (bp >= maxBeats - 0.001) break
    result.push({...n, beatPos:bp, duration:rnd(n.duration)})
    cursor = rnd(bp + n.duration)
  }
  if (cursor < maxBeats - 0.001) result.push(makeRest(cursor, rnd(maxBeats - cursor)))
  return result
}

export function buildEmptySolfaScore(voiceComboKey='satb', key='C', beats=4, numMeasures=12) {
  const combo = VOICE_COMBOS[voiceComboKey] || VOICE_COMBOS.satb
  return {
    id:            uid(),
    type:          'solfa',
    title:         'Untitled',
    key,
    tempo:         80,
    timeSignature: {beats, beatType:4},
    voiceCombo:    voiceComboKey,
    parts:         combo.voices.map(v => makePart(v, numMeasures, beats)),
    sections:      [],
    _savedAt:      null,
    _cloudId:      null,
  }
}

// ── STORE ─────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set, get) => ({
  score:              buildEmptySolfaScore(),
  selectedPartId:     null,
  selectedMeasureIdx: null,
  selectedNoteId:     null,
  inputMode:          'select',
  selectedDuration:   1,      // 1 | 0.5 | 0.25
  selectedOctave:     0,      // -2 | -1 | 0 | 1 | 2
  _undoStack:         [],

  // ── metadata ──────────────────────────────────────────────────────────────
  setTitle:   t  => set(s=>({score:{...s.score,title:t}})),
  setKey:     k  => set(s=>({score:{...s.score,key:k}})),
  setTempo:   t  => set(s=>({score:{...s.score,tempo:t}})),
  setCloudId: id => set(s=>({score:{...s.score,_cloudId:id}})),
  setInputMode:        m => set({inputMode:m}),
  setSelectedDuration: d => set({selectedDuration:d}),
  setSelectedOctave:   o => set({selectedOctave:o}),

  loadScore: score => set({
    score,
    selectedPartId:     score.parts[0]?.id ?? null,
    selectedMeasureIdx: null,
    selectedNoteId:     null,
  }),

  // ── selection ─────────────────────────────────────────────────────────────
  selectNote: (noteId, partId, measureIdx) => set({
    selectedNoteId:noteId, selectedPartId:partId, selectedMeasureIdx:measureIdx,
  }),
  clearSelection: () => set({selectedNoteId:null, selectedMeasureIdx:null}),

  // ── undo ──────────────────────────────────────────────────────────────────
  _snapshot: () => {
    const {score,_undoStack} = get()
    set({_undoStack:[..._undoStack.slice(-30), JSON.parse(JSON.stringify(score))]})
  },
  undo: () => {
    const {_undoStack} = get()
    if (!_undoStack.length) return
    set({score:_undoStack[_undoStack.length-1], _undoStack:_undoStack.slice(0,-1)})
  },

  // ── place note ────────────────────────────────────────────────────────────
  // beatPos and duration are both in beats.
  // Any existing notes that overlap [beatPos, beatPos+duration) are removed,
  // then fillGaps() patches the remainder with rests.
  placeNote: (partId, measureIdx, beatPos, syllable, octave, duration) => {
    get()._snapshot()
    const st     = get()
    const dur    = duration !== undefined ? duration : st.selectedDuration
    const oct    = (octave !== undefined && octave !== null) ? octave : st.selectedOctave
    const bp     = rnd(beatPos)
    const newEnd = rnd(bp + dur)

    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const max      = m.timeSignature.beats
          const filtered = m.notes.filter(n => {
            const nEnd = rnd(n.beatPos + n.duration)
            return nEnd <= bp + 0.001 || n.beatPos >= newEnd - 0.001
          })
          const newNote = {
            id:uid(), type:syllable?'note':'rest',
            syllable:syllable||null, octave:oct,
            duration:rnd(Math.min(dur, max-bp)), beatPos:bp, lyric:null,
          }
          return {...m, notes:fillGaps([...filtered,newNote].sort((a,b)=>a.beatPos-b.beatPos), max)}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // place a hold/sustain dash
  placeSustain: (partId, measureIdx, beatPos, duration) => {
    get()._snapshot()
    const dur    = duration ?? get().selectedDuration
    const bp     = rnd(beatPos)
    const newEnd = rnd(bp + dur)
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m,mi) => {
          if (mi !== measureIdx) return m
          const max      = m.timeSignature.beats
          const filtered = m.notes.filter(n=>{
            const nEnd=rnd(n.beatPos+n.duration)
            return nEnd<=bp+0.001||n.beatPos>=newEnd-0.001
          })
          const s2 = {id:uid(),type:'sustain',syllable:null,octave:0,
            duration:rnd(Math.min(dur,max-bp)),beatPos:bp,lyric:null}
          return {...m,notes:fillGaps([...filtered,s2].sort((a,b)=>a.beatPos-b.beatPos),max)}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // change octave of the selected note in-place
  changeNoteOctave: (partId, measureIdx, noteId, newOctave) => {
    if (!noteId) return
    get()._snapshot()
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          return {...m,notes:m.notes.map(n=>n.id===noteId?{...n,octave:newOctave}:n)}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // ── lyric ─────────────────────────────────────────────────────────────────
  setLyric: (partId, measureIdx, noteId, lyric) => {
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id!==partId) return p
        const measures = p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          return {...m,notes:m.notes.map(n=>n.id===noteId?{...n,lyric}:n)}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // ── measures ──────────────────────────────────────────────────────────────
  addMeasure: () => {
    set(s=>{
      const beats = s.score.timeSignature.beats
      const parts = s.score.parts.map(p=>({...p,measures:[...p.measures,makeEmptyMeasure(beats)]}))
      return {score:{...s.score,parts}}
    })
  },

  deleteMeasure: (measureIdx) => {
    const {score,selectedMeasureIdx} = get()
    const numM = score.parts[0]?.measures?.length||0
    if (numM<=1) return
    get()._snapshot()
    const idx    = measureIdx!==undefined ? measureIdx
                 : selectedMeasureIdx!==null ? selectedMeasureIdx : numM-1
    const newSel = Math.max(0, Math.min(idx, numM-2))
    set(s=>{
      const parts = s.score.parts.map(p=>({...p,measures:p.measures.filter((_,i)=>i!==idx)}))
      return {score:{...s.score,parts},selectedMeasureIdx:newSel,selectedNoteId:null}
    })
  },

  addSection: (label, startMeasure, endMeasure) => {
    set(s=>({score:{...s.score,sections:[...s.score.sections,{id:uid(),label,startMeasure,endMeasure}]}}))
  },

  // ── arrow navigation ──────────────────────────────────────────────────────
  navigateNote: (direction) => {
    const {score,selectedPartId,selectedMeasureIdx,selectedNoteId} = get()
    const sel = get().selectNote
    if (!selectedPartId||selectedMeasureIdx===null) {
      const p=score.parts[0], n=p?.measures[0]?.notes[0]
      if (n) sel(n.id,p.id,0); return
    }
    const pi   = score.parts.findIndex(p=>p.id===selectedPartId)
    const part = score.parts[pi]; if (!part) return
    const m    = part.measures[selectedMeasureIdx]; if (!m) return
    const ns   = m.notes
    const ni   = ns.findIndex(n=>n.id===selectedNoteId)
    const beat = ni>=0 ? ns[ni].beatPos : 0

    if (direction==='right') {
      if (ni>=0&&ni<ns.length-1) sel(ns[ni+1].id,selectedPartId,selectedMeasureIdx)
      else if (selectedMeasureIdx<part.measures.length-1) {
        const nm=part.measures[selectedMeasureIdx+1]
        if (nm?.notes[0]) sel(nm.notes[0].id,selectedPartId,selectedMeasureIdx+1)
      }
    } else if (direction==='left') {
      if (ni>0) sel(ns[ni-1].id,selectedPartId,selectedMeasureIdx)
      else if (selectedMeasureIdx>0) {
        const pm=part.measures[selectedMeasureIdx-1]
        const ln=pm?.notes[pm.notes.length-1]
        if (ln) sel(ln.id,selectedPartId,selectedMeasureIdx-1)
      }
    } else if (direction==='down') {
      if (pi<score.parts.length-1) {
        const np=score.parts[pi+1]
        const mn=np.measures[selectedMeasureIdx]?.notes||[]
        const t=mn.find(n=>Math.abs(n.beatPos-beat)<0.01)||mn[0]
        if (t) sel(t.id,np.id,selectedMeasureIdx)
      }
    } else if (direction==='up') {
      if (pi>0) {
        const pp=score.parts[pi-1]
        const mn=pp.measures[selectedMeasureIdx]?.notes||[]
        const t=mn.find(n=>Math.abs(n.beatPos-beat)<0.01)||mn[0]
        if (t) sel(t.id,pp.id,selectedMeasureIdx)
      }
    }
  },
}))