// src/store/solfaStore.js
// FaithScore — Solfa Store
//
// ══════════════════════════════════════════════════════════════════════════
// CORE MODEL
// ══════════════════════════════════════════════════════════════════════════
//
// 1 beat = 4 quarter-units (Q1 Q2 Q3 Q4)
//
// A measure has N beats (N = time-sig numerator).
// Each beat has an array of EVENTS. An event occupies 1–4 quarter-units.
// The events in a beat must sum to exactly 4 quarter-units.
// Any quarter-unit not covered by a note/sustain is a REST (blank).
//
// EVENT:
//   { id, type:'note'|'sustain'|'rest', syllable, octave, lyric,
//     duration: 1|2|3|4 }   // in quarter-units
//
// NOTATION RENDERING:
//   duration=4  → "d"       (whole beat)
//   duration=3  → "d.,"     (3/4 beat — dot+comma suffix)
//   duration=2  → "d."      (half beat — dot suffix)   OR ".d" (if offset=2)
//   duration=1  → "d,"      (quarter — comma suffix)   OR ",d" ",",d etc.
//
// The OFFSET of each event = sum of durations of all previous events in beat.
// From the offset we derive the prefix notation:
//   offset=0 → no prefix
//   offset=1 → prefix ","
//   offset=2 → prefix "."
//   offset=3 → prefix ".,,"
//
// EMPTY BEAT: one rest event of duration=4 → renders as blank (no character)
//
// SLASH "/" positions (beat index AFTER which "/" appears — fixed per time sig):
//   2/x → none
//   3/x → none
//   4/x → after idx 1   → d :r / :m :f
//   5/x → after idx 2   → 3+2
//   6/x → after idx 2   → 3+3
//   7/x → after idx 3   → 4+3
//   8/x → after idx 3   → 4+4
//   9/x → after idx 2,5 → 3+3+3
//  12/x → after idx 2,5,8

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

// One event inside a beat
function makeEvent(type='rest', duration=4, syllable=null, octave=0, lyric=null) {
  return { id:uid(), type, syllable, octave, lyric, duration }
}

// An empty beat = one rest of duration 4 (fills whole beat, renders as blank)
function makeEmptyBeat() {
  return { id:uid(), events:[makeEvent('rest',4)] }
}

// A measure with `numBeats` empty beats
function makeEmptyMeasure(numBeats=4) {
  return {
    id:uid(),
    timeSignature:{beats:numBeats,beatType:4},
    beats:Array.from({length:numBeats},()=>makeEmptyBeat()),
  }
}

function makePart(voiceDef, numMeasures=12, numBeats=4) {
  return {
    id:voiceDef.id, name:voiceDef.name, label:voiceDef.label,
    measures:Array.from({length:numMeasures},()=>makeEmptyMeasure(numBeats)),
  }
}

export function buildEmptySolfaScore(voiceComboKey='satb',key='C',beats=4,numMeasures=12) {
  const combo=VOICE_COMBOS[voiceComboKey]||VOICE_COMBOS.satb
  return {
    id:uid(), type:'solfa', title:'Untitled', key,
    tempo:80, timeSignature:{beats,beatType:4},
    voiceCombo:voiceComboKey,
    parts:combo.voices.map(v=>makePart(v,numMeasures,beats)),
    sections:[], slurs:[], marks:[], _savedAt:null, _cloudId:null,
  }
}

// ── MIGRATION from old formats ────────────────────────────────────────────────
export function migrateMeasure(measure) {
  if (!measure) return makeEmptyMeasure(4)
  // Already new format (has beats with events arrays)
  if (Array.isArray(measure.beats) && measure.beats[0]?.events) return measure
  // Old slot-based format (beats with slots[])
  if (Array.isArray(measure.beats) && measure.beats[0]?.slots) {
    const nb=measure.beats.length
    const beats=measure.beats.map(b=>{
      const s=b.slots[0]
      if (s&&s.type!=='rest') {
        return {id:uid(), events:[makeEvent(s.type,4,s.syllable,s.octave||0,s.lyric||null)]}
      }
      return makeEmptyBeat()
    })
    return {...measure,beats}
  }
  // Old notes[] format
  const top=measure.timeSignature?.beats||4
  const beats=Array.from({length:top},(_,bi)=>{
    const note=(measure.notes||[]).find(n=>Math.abs(Math.floor(n.beatPos)-bi)<0.01)
    if (note&&note.type!=='rest')
      return {id:uid(),events:[makeEvent(note.type,4,note.syllable||null,note.octave||0,note.lyric||null)]}
    return makeEmptyBeat()
  })
  return {...measure,beats}
}

export function migrateScore(score) {
  if (!score) return buildEmptySolfaScore()
  return {
    ...score,
    slurs: score.slurs || [],
    marks: score.marks || [],
    parts:(score.parts||[]).map(p=>({
      ...p,measures:(p.measures||[]).map(m=>migrateMeasure(m)),
    })),
  }
}

// ── SLASH POSITIONS ───────────────────────────────────────────────────────────
// Returns Set of beat indices (0-based) AFTER which "/" appears.
export function slashPositions(beats,_beatType) {
  const n=beats
  if (n<=3)  return new Set()
  if (n===4) return new Set([1])
  if (n===5) return new Set([2])
  if (n===6) return new Set([2])
  if (n===7) return new Set([3])
  if (n===8) return new Set([3])
  if (n===9) return new Set([2,5])
  if (n===10)return new Set([4])
  if (n===12)return new Set([2,5,8])
  return new Set()
}

// ── BEAT MATH ────────────────────────────────────────────────────────────────
// Given a beat's events array, return the total quarter-units used
export function beatUsed(events) {
  return (events||[]).reduce((s,e)=>s+e.duration,0)
}

// Given a beat, return remaining quarter-units available (max 4)
export function beatRemaining(beat) {
  return 4 - beatUsed(beat?.events||[])
}

// ── STORE ────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set,get) => ({
  score:              buildEmptySolfaScore(),
  selectedPartId:     null,
  selectedMeasureIdx: null,
  selectedBeatIdx:    null,
  selectedEventIdx:   null,   // which event within the beat
  inputMode:          'select',
  selectedDuration:   4,      // quarter-units: 4=whole, 3=3/4, 2=half, 1=quarter
  selectedOctave:     0,
  _undoStack:         [],

  // Slur placement state
  slurStart:          null,   // { partId, measureIdx, beatIdx, eventIdx } | null

  setTitle:   t  => set(s=>({score:{...s.score,title:t}})),
  setKey:     k  => set(s=>({score:{...s.score,key:k}})),
  setTempo:   t  => set(s=>({score:{...s.score,tempo:t}})),
  setCloudId: id => set(s=>({score:{...s.score,_cloudId:id}})),
  setInputMode:       m => set({inputMode:m, slurStart: m !== 'slur' ? null : get().slurStart}),
  setSelectedDuration:d => set({selectedDuration:d}),
  setSelectedOctave:  o => set({selectedOctave:o}),

  // ── Slur actions ─────────────────────────────────────────────────────────
  setSlurStart: (ref) => set({ slurStart: ref }),
  clearSlurStart: () => set({ slurStart: null }),

  addSlur: (partId, startMeasure, startBeat, startEvent, endMeasure, endBeat, endEvent) => {
    get()._snapshot()
    const slur = {
      id: uid(), partId,
      startMeasure, startBeat, startEvent,
      endMeasure, endBeat, endEvent,
    }
    set(s => ({ score: { ...s.score, slurs: [...(s.score.slurs||[]), slur] } }))
  },

  removeSlur: (slurId) => {
    get()._snapshot()
    set(s => ({ score: { ...s.score, slurs: (s.score.slurs||[]).filter(sl => sl.id !== slurId) } }))
  },

  // ── Active part (sidebar "Parts" tab) ─────────────────────────────────────
  setActivePart: (partId) => set({ selectedPartId: partId }),

  // ── Marks: tempo text / dynamics / expression text pinned above a beat ────
  addMark: (partId, measureIdx, beatIdx, value, kind='text') => {
    if (partId==null || measureIdx==null || beatIdx==null) return
    get()._snapshot()
    const mark = { id: uid(), partId, measureIdx, beatIdx, value, kind }
    set(s => ({ score: { ...s.score, marks: [...(s.score.marks||[]), mark] } }))
  },

  removeMark: (markId) => {
    get()._snapshot()
    set(s => ({ score: { ...s.score, marks: (s.score.marks||[]).filter(m => m.id !== markId) } }))
  },

  loadScore: rawScore => {
    const score=migrateScore(rawScore)
    set({score,selectedPartId:score.parts[0]?.id??null,
      selectedMeasureIdx:null,selectedBeatIdx:null,selectedEventIdx:null})
  },

  // Select an event within a beat
  selectEvent: (partId,measureIdx,beatIdx,eventIdx) => set({
    selectedPartId:partId, selectedMeasureIdx:measureIdx,
    selectedBeatIdx:beatIdx, selectedEventIdx:eventIdx,
  }),
  clearSelection: () => set({
    selectedPartId:null,selectedMeasureIdx:null,selectedBeatIdx:null,selectedEventIdx:null,
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

  // ── Place a note/rest/sustain event into a beat ───────────────────────────
  // This replaces whatever was at the cursor position (beatIdx) with a new
  // event of the given syllable and selectedDuration, adjusting the beat's
  // event array so it always sums to 4.
  //
  // Strategy:
  //   1. Start fresh: the beat gets one rest of duration 4.
  //   2. If there are existing events we want to keep, we preserve them.
  //   But the simplest correct model:
  //   - placeEvent inserts at beatOffset (quarter-unit offset within beat).
  //   - It removes any events that overlap, then fills the rest with rests.
  placeEvent: (partId,measureIdx,beatIdx,beatOffset,syllable,duration) => {
    get()._snapshot()
    const st=get()
    const dur = duration!==undefined ? duration : st.selectedDuration
    const oct = st.selectedOctave
    const type = syllable ? 'note' : 'rest'

    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b

            // Build new events array:
            // Remove events that overlap [beatOffset, beatOffset+dur)
            // then insert the new event, then fill gaps with rests
            const existing=b.events||[makeEvent('rest',4)]
            const newEnd=beatOffset+dur
            const kept=[]
            let cursor=0

            for (const ev of existing) {
              const evEnd=cursor+ev.duration
              // Does this event overlap the new range?
              if (evEnd<=beatOffset || cursor>=newEnd) {
                // no overlap — keep it
                kept.push({...ev, _start:cursor})
              }
              cursor+=ev.duration
            }

            // Rebuild events array with kept events + new event + rests for gaps
            const newEvent=makeEvent(type,dur,syllable||null,oct,null)
            const allEvents=[
              ...kept.map(e=>({...e})),
              {_start:beatOffset, ...newEvent},
            ].sort((a,b)=>a._start-b._start)

            // Fill gaps
            const final=[]
            let pos=0
            for (const ev of allEvents) {
              const st2=ev._start
              if (st2>pos) final.push(makeEvent('rest',st2-pos))
              const evDur=ev.duration
              const cleanEv={...ev}
              delete cleanEv._start
              final.push(cleanEv)
              pos=st2+evDur
            }
            if (pos<4) final.push(makeEvent('rest',4-pos))

            return {...b, events:final}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // Place a sustain/hold into the beat at beatOffset
  placeSustain: (partId,measureIdx,beatIdx,beatOffset,duration) => {
    const st=get()
    const dur=duration!==undefined?duration:st.selectedDuration
    get().placeEvent(partId,measureIdx,beatIdx,beatOffset,null,dur)
    // Then mark it as sustain
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const events=b.events.map(ev=>{
              // find the event at beatOffset
              let pos=0
              let found=false
              for (const e of b.events) {
                if (pos===beatOffset) { found=true; break }
                pos+=e.duration
              }
              return ev
            })
            // Actually just update the event at beatOffset
            let pos=0
            const updEvents=b.events.map(ev=>{
              const start=pos
              pos+=ev.duration
              if (start===beatOffset) return {...ev,type:'sustain',syllable:null}
              return ev
            })
            return {...b,events:updEvents}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // Change the duration of a selected event
  changeEventDuration: (partId,measureIdx,beatIdx,eventIdx,newDuration) => {
    get()._snapshot()
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const events=[...b.events]
            if (eventIdx>=events.length) return b
            const ev=events[eventIdx]
            const oldDur=ev.duration
            const delta=newDuration-oldDur
            // Can we extend? Check remaining space
            const used=beatUsed(events)
            if (used+delta>4) return b  // no room
            if (newDuration<1) return b // min 1 quarter

            const updated={...ev,duration:newDuration}
            events[eventIdx]=updated
            // Adjust trailing rest if needed
            if (delta!==0) {
              // Rebuild: after this event, fill remainder with rests
              const before=events.slice(0,eventIdx+1)
              const usedBefore=before.reduce((s,e)=>s+e.duration,0)
              const remaining=4-usedBefore
              if (remaining>0) before.push(makeEvent('rest',remaining))
              return {...b,events:before}
            }
            return {...b,events}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // Change octave of selected event
  changeEventOctave: (partId,measureIdx,beatIdx,eventIdx,newOctave) => {
    get()._snapshot()
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const events=b.events.map((ev,ei)=>ei===eventIdx?{...ev,octave:newOctave}:ev)
            return {...b,events}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  setLyric: (partId,measureIdx,beatIdx,eventIdx,lyric) => {
    set(s=>{
      const parts=s.score.parts.map(p=>{
        if (p.id!==partId) return p
        const measures=p.measures.map((m,mi)=>{
          if (mi!==measureIdx) return m
          const beats=m.beats.map((b,bi)=>{
            if (bi!==beatIdx) return b
            const events=b.events.map((ev,ei)=>ei===eventIdx?{...ev,lyric}:ev)
            return {...b,events}
          })
          return {...m,beats}
        })
        return {...p,measures}
      })
      return {score:{...s.score,parts}}
    })
  },

  // ── Measures ──────────────────────────────────────────────────────────────
  // Delete selected event — replaces it with a rest of same duration,
  // then merges adjacent rests so the beat stays clean.
  deleteEvent: (partId, measureIdx, beatIdx, eventIdx) => {
    get()._snapshot()
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const beats = m.beats.map((b, bi) => {
            if (bi !== beatIdx) return b
            const events = [...(b.events || [])]
            if (eventIdx >= events.length) return b
            // Replace with rest of same duration
            const ev = events[eventIdx]
            events[eventIdx] = { id: crypto.randomUUID(), type: 'rest',
              syllable: null, octave: 0, lyric: null, duration: ev.duration }
            // Merge adjacent rests
            const merged = []
            for (const e of events) {
              const last = merged[merged.length - 1]
              if (last && last.type === 'rest' && e.type === 'rest') {
                last.duration += e.duration
              } else {
                merged.push({...e})
              }
            }
            return { ...b, events: merged }
          })
          return { ...m, beats }
        })
        return { ...p, measures }
      })
      return { score: { ...s.score, parts } }
    })
  },

  addMeasure: () => {
    set(s=>{
      const beats=s.score.timeSignature.beats
      const parts=s.score.parts.map(p=>({
        ...p,measures:[...p.measures,makeEmptyMeasure(beats)],
      }))
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
      const parts=s.score.parts.map(p=>({
        ...p,measures:p.measures.filter((_,i)=>i!==idx),
      }))
      return {score:{...s.score,parts},selectedMeasureIdx:newSel,selectedBeatIdx:null,selectedEventIdx:null}
    })
  },

  changeTimeSig: (newBeats,newBeatType) => {
    set(s=>{
      const ts={beats:newBeats,beatType:newBeatType}
      const parts=s.score.parts.map(p=>({
        ...p,
        measures:p.measures.map(m=>{
          let beats=[...(m.beats||[])]
          while (beats.length<newBeats) beats.push(makeEmptyBeat())
          if (beats.length>newBeats) beats=beats.slice(0,newBeats)
          return {...m,timeSignature:ts,beats}
        }),
      }))
      return {score:{...s.score,timeSignature:ts,parts}}
    })
  },

  addSection: (label,startMeasure,endMeasure) => {
    set(s=>({score:{...s.score,sections:[...s.score.sections,{id:uid(),label,startMeasure,endMeasure}]}}))
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  // Navigates event by event within a beat, then beat by beat, then measure
  navigateEvent: (direction) => {
    const {score,selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedEventIdx}=get()
    const sel=get().selectEvent

    if (selectedPartId===null||selectedMeasureIdx===null) {
      const p=score.parts[0],m=p?.measures[0]
      if (m?.beats[0]) sel(p.id,0,0,0)
      return
    }
    const pi=score.parts.findIndex(p=>p.id===selectedPartId)
    const part=score.parts[pi]; if (!part) return
    const meas=migrateMeasure(part.measures[selectedMeasureIdx]); if (!meas) return
    const bi=selectedBeatIdx??0
    const ei=selectedEventIdx??0
    const beat=meas.beats[bi]; if (!beat) return
    const evts=beat.events||[]

    if (direction==='right') {
      if (ei<evts.length-1){sel(selectedPartId,selectedMeasureIdx,bi,ei+1);return}
      if (bi<meas.beats.length-1){sel(selectedPartId,selectedMeasureIdx,bi+1,0);return}
      if (selectedMeasureIdx<part.measures.length-1){sel(selectedPartId,selectedMeasureIdx+1,0,0);return}
    } else if (direction==='left') {
      if (ei>0){sel(selectedPartId,selectedMeasureIdx,bi,ei-1);return}
      if (bi>0){
        const pb=migrateMeasure(part.measures[selectedMeasureIdx])?.beats[bi-1]
        sel(selectedPartId,selectedMeasureIdx,bi-1,(pb?.events?.length||1)-1);return
      }
      if (selectedMeasureIdx>0){
        const pm=migrateMeasure(part.measures[selectedMeasureIdx-1])
        const lb=pm.beats[pm.beats.length-1]
        sel(selectedPartId,selectedMeasureIdx-1,pm.beats.length-1,(lb?.events?.length||1)-1);return
      }
    } else if (direction==='down') {
      if (pi<score.parts.length-1){
        const np=score.parts[pi+1]
        const nb=migrateMeasure(np.measures[selectedMeasureIdx])?.beats[bi]
        sel(np.id,selectedMeasureIdx,bi,Math.min(ei,(nb?.events?.length||1)-1))
      }
    } else if (direction==='up') {
      if (pi>0){
        const pp=score.parts[pi-1]
        const pb=migrateMeasure(pp.measures[selectedMeasureIdx])?.beats[bi]
        sel(pp.id,selectedMeasureIdx,bi,Math.min(ei,(pb?.events?.length||1)-1))
      }
    }
  },
}))