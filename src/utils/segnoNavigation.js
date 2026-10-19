// ── Dal Segno navigation ──────────────────────────────────────────────────
// Turns a flat list of navigation markers (segno, D.S./D.S. al Fine/D.S. al
// Coda, To Coda, Coda, Fine) into the actual measure-by-measure PLAYBACK
// ORDER — the sequence of measure indices to play, in order, including the
// repeated Segno→D.S. span.
//
// This is computed ONCE, as a plain finite array, rather than as runtime
// jump/loop logic inside the scheduler. That's deliberate: a jump marker
// is a label, not something with its own duration or state, and resolving
// the whole path up front — rather than branching on it while scheduling
// audio events — is what makes "the jump happens once" a structural
// guarantee instead of something a loop-guard has to enforce. There is no
// code path here that can revisit the same instruction twice, because the
// result is just an array; nothing about building it is cyclic.
//
// markers: [{ type, measureIndex }], where type is one of:
//   'segno' | 'ds' | 'ds-al-fine' | 'ds-al-coda' | 'fine' | 'to-coda' | 'coda'
// totalMeasures: the piece's total measure count (for the no-markers /
// plain-D.S. fallback cases, where playback simply runs to the end).
//
// Returns: an array of measure indices (0-based), in playback order. May
// repeat indices (the Segno→D.S. span plays twice). If there's no segno/
// D.S. pair at all, returns the plain 0..totalMeasures-1 — i.e. this is a
// no-op for every score that doesn't use these markers.
export function buildMeasureOrder(markers, totalMeasures) {
  const byType = (t) => markers.filter((m) => m.type === t).sort((a, b) => a.measureIndex - b.measureIndex)

  const segno = byType('segno')[0]
  // The first D.S.-family instruction encountered, in score order — there's
  // normally just one, but if a sheet writes it more than once, only the
  // first drives the jump; a second one found later (e.g. inside what's
  // now the second pass) would already be unreachable in the resulting
  // order, which is correct — "unless the sheet writes the instruction
  // again" still means only ONE jump is ever resolved per pass through
  // this function, matching "the jump happens once."
  const dsCandidates = [...byType('ds'), ...byType('ds-al-fine'), ...byType('ds-al-coda')]
    .sort((a, b) => a.measureIndex - b.measureIndex)
  const ds = dsCandidates[0]

  const linear = () => Array.from({ length: Math.max(0, totalMeasures) }, (_, i) => i)

  if (!segno || !ds) return linear()

  const order = []
  // First pass: straight through from the top, up to and including the
  // D.S. instruction's own measure. This naturally already contains the
  // segno→D.S. span once (segno precedes the D.S. marker in the score),
  // and naturally plays through any "To Coda" measure as ordinary music
  // on this pass — the jump-to-coda behavior is only ever applied below,
  // for the SECOND pass, which is what "ignore the coda on the first
  // pass" means here: there's no special-case needed for it, because nothing
  // on the first pass ever looks at the Coda markers at all.
  for (let i = 0; i <= ds.measureIndex && i < totalMeasures; i++) order.push(i)

  if (ds.type === 'ds') {
    // Plain Dal Segno: back to the segno, then straight through to the end.
    for (let i = segno.measureIndex; i < totalMeasures; i++) order.push(i)
    return order
  }

  if (ds.type === 'ds-al-fine') {
    const fine = byType('fine').find((m) => m.measureIndex >= segno.measureIndex) || { measureIndex: totalMeasures - 1 }
    for (let i = segno.measureIndex; i <= fine.measureIndex && i < totalMeasures; i++) order.push(i)
    return order
  }

  // ds-al-coda
  const toCoda = byType('to-coda').find((m) => m.measureIndex >= segno.measureIndex)
  const coda = byType('coda')[0]
  if (!toCoda || !coda) {
    // Can't resolve the coda jump without both markers placed — fall back
    // to a plain Dal Segno (repeat from the segno to the end) rather than
    // silently dropping the repeat entirely.
    for (let i = segno.measureIndex; i < totalMeasures; i++) order.push(i)
    return order
  }
  for (let i = segno.measureIndex; i <= toCoda.measureIndex && i < totalMeasures; i++) order.push(i)
  const fineInCoda = byType('fine').find((m) => m.measureIndex >= coda.measureIndex)
  const codaEnd = fineInCoda ? fineInCoda.measureIndex : totalMeasures - 1
  for (let i = coda.measureIndex; i <= codaEnd && i < totalMeasures; i++) order.push(i)
  return order
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
  'To Coda': 'to-coda',
  '𝄌': 'coda',
  'Coda': 'coda',
  'Fine': 'fine',
}

export function markersFromStaffTexts(staffTexts) {
  return (staffTexts || [])
    .map((t) => {
      const type = STAFF_TEXT_MARKERS[t.text]
      return type ? { type, measureIndex: t.measureIndex } : null
    })
    .filter(Boolean)
}

// ── Solfa app: markers live as score.navigationMarkers (a typed list) —
// just renaming the field (atMeasure -> measureIndex) to the shape
// buildMeasureOrder expects.
export function markersFromNavigationMarkers(navigationMarkers) {
  const KNOWN = new Set(['segno', 'ds', 'ds-al-fine', 'ds-al-coda', 'to-coda', 'coda', 'fine'])
  return (navigationMarkers || [])
    .filter((m) => KNOWN.has(m.type))
    .map((m) => ({ type: m.type, measureIndex: m.atMeasure }))
}