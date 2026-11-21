// ── Dal Segno / Da Capo navigation ────────────────────────────────────────
// Turns the navigation markers (Segno, D.S., D.S. al Fine, D.S. al Coda, D.C.,
// D.C. al Fine, D.C. al Coda, To Coda, Coda, Fine) into the actual PLAYBACK
// ORDER, computed once as a plain finite array — a jump marker is a label, not
// something with state, so "the jump happens once" is structural.
//
// Markers belong to a NOTE, not a bar:
//   • Segno / Coda      — playback resumes AT that note (the note itself plays).
//   • D.S. / D.C. / Fine / To Coda — playback stops AFTER that note (its whole
//     length, sustains included) and jumps; the rest of the bar is not played.
// A marker placed on a bar with no note chosen behaves as before: Segno/Coda
// at the start of the bar, the others at the end of it.
//
// markers: [{ type, measureIndex, from?, lastStart?, lastEnd? }]
//   from      — start offset of the note inside its bar (Segno / Coda)
//   lastStart — start offset of the note playback stops after
//   lastEnd   — end offset of that note
//   (offsets use the calling app's unit; null/undefined = bar level)
//
// Returns play ENTRIES in order: { m, from, lastStart, lastEnd } — measure
// index plus the slice of that bar to play (notes whose start offset lies in
// [from, lastStart]; the bar's sounding length ends at lastEnd). A whole bar is
// { from: 0, lastStart: Infinity, lastEnd: Infinity }.
const INF = Infinity
const wholeBar = (m) => ({ m, from: 0, lastStart: INF, lastEnd: INF })

export function buildPlaySegments(markers, totalMeasures) {
  const total = Math.max(0, totalMeasures)
  const q = (mk) => mk.from ?? mk.lastStart ?? 0
  const pos = (a, b) => a.measureIndex - b.measureIndex || q(a) - q(b)
  const byType = (...ts) => markers.filter((m) => ts.includes(m.type)).sort(pos)
  const startPt = (mk) => ({ m: mk.measureIndex, from: mk.from ?? 0 })
  const stopPt = (mk) => ({ m: mk.measureIndex, lastStart: mk.lastStart ?? INF, lastEnd: mk.lastEnd ?? INF })

  const linear = () => Array.from({ length: total }, (_, m) => wholeBar(m))

  // slice of the score from point `a` (inclusive) to stop point `b` (null = the end)
  const span = (a, b) => {
    const out = []
    const endM = b ? b.m : total - 1
    for (let m = a.m; m <= endM && m < total; m++) {
      out.push({
        m,
        from: m === a.m ? a.from || 0 : 0,
        lastStart: b && m === b.m ? b.lastStart : INF,
        lastEnd: b && m === b.m ? b.lastEnd : INF,
      })
    }
    return out
  }

  // The first D.S./D.C. in score order drives the one jump.
  const jump = byType('ds', 'ds-al-fine', 'ds-al-coda', 'dc', 'dc-al-fine', 'dc-al-coda')[0]
  if (!jump) return linear()
  const isDC = jump.type.startsWith('dc')
  const segno = byType('segno')[0]
  if (!isDC && !segno) return linear()

  const origin = isDC ? { m: 0, from: 0 } : startPt(segno)
  const originRef = isDC ? { measureIndex: 0, from: 0 } : segno
  const atOrAfter = (mk, ref) => pos(mk, ref) >= 0

  // First pass: from the top through the jump note itself. "To Coda" is
  // ordinary music on this pass — only the repeat pass looks at Coda markers.
  const out = span({ m: 0, from: 0 }, stopPt(jump))
  const kind = jump.type.replace(/^d[sc]/, '') // '' | '-al-fine' | '-al-coda'

  if (kind === '') {
    out.push(...span(origin, null))
  } else if (kind === '-al-fine') {
    const fine = byType('fine').find((f) => atOrAfter(f, originRef))
    out.push(...span(origin, fine ? stopPt(fine) : null))
  } else {
    const toCoda = byType('to-coda').find((t) => atOrAfter(t, originRef))
    const coda = byType('coda')[0]
    if (!toCoda || !coda) {
      // Can't resolve the coda jump without both markers: plain repeat instead.
      out.push(...span(origin, null))
    } else {
      out.push(...span(origin, stopPt(toCoda)))
      const fineInCoda = byType('fine').find((f) => atOrAfter(f, coda))
      out.push(...span(startPt(coda), fineInCoda ? stopPt(fineInCoda) : null))
    }
  }
  return out
}

// Plain measure indices of the order (kept for callers that don't need slices).
export function buildMeasureOrder(markers, totalMeasures) {
  return buildPlaySegments(markers, totalMeasures).map((e) => e.m)
}

// ── Repeats & numbered endings (volta brackets) ───────────────────────────
// repeats: [{ id, start, end }]  — |: before bar `start`, :| after bar `end`
// voltas:  [{ id, startMeasure, endMeasure, numbers:[1], label }]
//   — a bracket over bars startMeasure..endMeasure that plays only on the
//     listed passes (1 = first time through, 2 = the repeat, …).
// A repeat's endings are the chain of voltas that starts inside the repeat
// (first one reaches the :|) and continues bar-to-bar after it. The repeat
// runs as many times as the highest ending number (min. 2; a repeat with no
// endings plays twice). Applied to a measure order (e.g. the Segno order) and
// returns a new, finite order — repeats are only taken on the first
// traversal; once finished, a later pass (after a D.S.) plays the LAST ending.
export function expandRepeats(order, repeats, voltas) {
  // `order` holds measure indices or play entries ({ m, from, lastStart, lastEnd })
  const mOf = (e) => (typeof e === 'number' ? e : e.m)
  const reps = [...(repeats || [])].sort((a, b) => a.start - b.start)
  const vs = [...(voltas || [])].sort((a, b) => a.startMeasure - b.startMeasure)
  if (!reps.length && !vs.length) return order

  const info = reps.map((r) => {
    const chain = []
    let v = vs.find((x) => x.startMeasure >= r.start && x.startMeasure <= r.end && x.endMeasure >= r.end)
    while (v) {
      chain.push(v)
      v = vs.find((x) => x.startMeasure === v.endMeasure + 1 && !chain.includes(x))
    }
    const top = Math.max(2, ...chain.flatMap((c) => c.numbers || [1]))
    return { r, chain, top }
  })
  const pass = new Map(info.map((x) => [x.r.id, 1]))
  const out = []
  const LIMIT = order.length * 40 + 1000
  let i = 0
  let guard = 0
  while (i < order.length && guard++ < LIMIT) {
    const m = mOf(order[i])
    let skip = null
    for (const x of info) {
      const p = pass.get(x.r.id)
      const hit = x.chain.find(
        (v) => m >= v.startMeasure && m <= v.endMeasure && !(v.numbers || [1]).includes(p),
      )
      if (hit) { skip = hit; break }
    }
    if (skip) {
      while (i < order.length && mOf(order[i]) >= skip.startMeasure && mOf(order[i]) <= skip.endMeasure) i++
      continue
    }
    out.push(order[i])   // keep the entry (bar + slice), not just its index
    // :| at the repeat's end — and at the end of every ending except the last
    // (a 2nd ending that has a 3rd after it also returns to the start).
    const x = info.find(
      (y) => y.r.end === m || y.chain.some((v, k) => k < y.chain.length - 1 && v.endMeasure === m),
    )
    if (x && pass.get(x.r.id) < x.top) {
      pass.set(x.r.id, pass.get(x.r.id) + 1)
      let j = i
      while (j >= 0 && mOf(order[j]) !== x.r.start) j--
      if (j >= 0) { i = j; continue }
    }
    i++
  }
  return out
}

// Printed bar number of measure index `i` (instruction/text bars aren't counted),
// and back. In the Staff app there are no text bars, so this is just i + 1.
export const barNumberOf = (measures, i) => (measures || []).slice(0, i + 1).filter((m) => m.kind !== 'text').length
export const indexOfBarNumber = (measures, n) => {
  let c = 0
  for (let i = 0; i < (measures || []).length; i++) { if (measures[i].kind !== 'text' && ++c === n) return i }
  return -1
}

// Label printed on an ending bracket: "1.", "1, 2." ... (or the custom label).
export const voltaLabel = (v) => v?.label || `${(v?.numbers || [1]).join(', ')}.`

// Staff scores can also carry plain repeat BARLINES (score.barlines with type
// 'repeat-start' | 'repeat-end' | 'repeat-both'). Those become repeats too, so
// a score drawn with the old barline palette plays correctly. An explicit
// repeat that already ends on the same bar wins.
export function effectiveRepeats(score) {
  const explicit = score?.repeats || []
  const bl = [...(score?.barlines || [])]
    .filter((b) => b.type === 'repeat-start' || b.type === 'repeat-end' || b.type === 'repeat-both')
    .sort((a, b) => a.measureIndex - b.measureIndex)
  const derived = []
  let lastStart = 0
  bl.forEach((b) => {
    if (b.type === 'repeat-start') { lastStart = b.measureIndex; return }
    if (b.measureIndex >= lastStart) derived.push({ id: `bl-${b.id}`, start: lastStart, end: b.measureIndex })
    lastStart = b.measureIndex + 1
  })
  const ends = new Set(explicit.map((r) => r.end))
  return [...explicit, ...derived.filter((d) => !ends.has(d.end))]
}

// ── Staff app: markers live as free text (score.staffTexts), since that's
// the Staff app's existing annotation model — this recognizes the exact
// strings the Sidebar's Text palette places, so a plain text label stays a
// label (never parsed as a pitch), per the no-pitch/no-duration rule for
// these symbols.
const STAFF_TEXT_MARKERS = {
  '𝄋': 'segno',
  'Segno': 'segno',
  'D.S.': 'ds',
  'D.S. al Fine': 'ds-al-fine',
  'D.S. al Coda': 'ds-al-coda',
  'D.C.': 'dc',
  'D.C. al Fine': 'dc-al-fine',
  'D.C. al Coda': 'dc-al-coda',
  'To Coda': 'to-coda',
  '𝄌': 'coda',
  'Coda': 'coda',
  'Fine': 'fine',
}

// noteEndAt(partId, measureIndex, beat) → end beat of the note starting at `beat`
// (supplied by the caller, which knows note durations); optional.
export function markersFromStaffTexts(staffTexts, noteEndAt) {
  return (staffTexts || [])
    .map((t) => {
      const type = STAFF_TEXT_MARKERS[t.text]
      if (!type) return null
      const mk = { type, measureIndex: t.measureIndex }
      // Only a text placed ON A NOTE is note-level; one placed on a bar is bar-level.
      if (t.onNote && typeof t.beat === 'number') {
        mk.from = t.beat
        mk.lastStart = t.beat
        const end = noteEndAt ? noteEndAt(t.partId, t.measureIndex, t.beat) : null
        mk.lastEnd = typeof end === 'number' ? end : t.beat + 1e-3
      }
      return mk
    })
    .filter(Boolean)
}

// ── Solfa app: markers live as score.navigationMarkers (a typed list). A marker
// carries the note it was placed on (partId, beatIdx, eventIdx); its offset inside
// the bar is worked out here from that voice's own events, in quarter-units
// (1 beat = 4 units, the same unit the Solfa scheduler uses). A note's end
// includes the sustain (-) events that continue it.
export function solfaNoteSpan(score, partId, measureIdx, beatIdx, eventIdx) {
  const part = (score?.parts || []).find((p) => p.id === partId) || score?.parts?.[0]
  const m = part?.measures?.[measureIdx]
  if (!m?.beats) return null
  const flat = []
  let q = 0
  m.beats.forEach((beat, bi) => {
    ;(beat.events || []).forEach((ev, ei) => {
      flat.push({ q, end: q + (ev.duration || 0), type: ev.type, bi, ei })
      q += ev.duration || 0
    })
  })
  const idx = flat.findIndex((f) => f.bi === beatIdx && f.ei === (eventIdx || 0))
  if (idx < 0) return null
  let end = flat[idx].end
  for (let j = idx + 1; j < flat.length && flat[j].type === 'sustain'; j++) end = flat[j].end
  return { start: flat[idx].q, end }
}

export function markersFromNavigationMarkers(navigationMarkers, score) {
  const KNOWN = new Set(['segno', 'ds', 'ds-al-fine', 'ds-al-coda', 'dc', 'dc-al-fine', 'dc-al-coda', 'to-coda', 'coda', 'fine'])
  return (navigationMarkers || [])
    .filter((m) => KNOWN.has(m.type))
    .map((m) => {
      const mk = { type: m.type, measureIndex: m.atMeasure }
      if (m.beatIdx != null && score) {
        const span = solfaNoteSpan(score, m.partId, m.atMeasure, m.beatIdx, m.eventIdx)
        if (span) { mk.from = span.start; mk.lastStart = span.start; mk.lastEnd = span.end }
      }
      return mk
    })
}