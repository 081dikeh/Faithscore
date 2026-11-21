// Segno / D.S. / D.C. / Fine / To Coda belong to a NOTE, not a bar.
import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.crypto ??= (await import('node:crypto')).webcrypto
const { buildPlaySegments, expandRepeats, markersFromStaffTexts, markersFromNavigationMarkers } =
  await import('../utils/segnoNavigation.js')
const { useSolfaStore, buildEmptySolfaScore } = await import('../store/solfaStore.js')

const INF = Infinity
// compact view:  bar[@from][<lastStart]   (bar numbers are 1-based here)
const show = (entries) =>
  entries.map(e => `${e.m + 1}${e.from ? '@' + e.from : ''}${e.lastStart !== INF ? '<' + e.lastStart : ''}`).join(' ')

test('Segno on the 3rd note of bar 1, D.S. on the 2nd note of bar 8 (4/4)', () => {
  // beats as offsets: 3rd note = 2, 2nd note = 1 (each note lasts 1)
  const markers = [
    { type: 'segno', measureIndex: 0, from: 2, lastStart: 2, lastEnd: 3 },
    { type: 'ds', measureIndex: 7, from: 1, lastStart: 1, lastEnd: 2 },
  ]
  assert.equal(show(buildPlaySegments(markers, 10)), '1 2 3 4 5 6 7 8<1 1@2 2 3 4 5 6 7 8 9 10')
})

test('bar-level markers keep the old whole-bar behaviour', () => {
  const markers = [{ type: 'segno', measureIndex: 1 }, { type: 'ds', measureIndex: 3 }]
  assert.equal(show(buildPlaySegments(markers, 6)), '1 2 3 4 2 3 4 5 6')
})

test('D.S. al Fine: stops after the Fine note', () => {
  const markers = [
    { type: 'segno', measureIndex: 1, from: 1, lastStart: 1, lastEnd: 2 },
    { type: 'ds-al-fine', measureIndex: 4, from: 3, lastStart: 3, lastEnd: 4 },
    { type: 'fine', measureIndex: 2, from: 2, lastStart: 2, lastEnd: 3 },
  ]
  assert.equal(show(buildPlaySegments(markers, 6)), '1 2 3 4 5<3 2@1 3<2')
})

test('D.C. goes back to the very start; D.C. al Fine stops at the Fine note', () => {
  const dc = [{ type: 'dc', measureIndex: 2, from: 1, lastStart: 1, lastEnd: 2 }]
  assert.equal(show(buildPlaySegments(dc, 5)), '1 2 3<1 1 2 3 4 5')
  const dcFine = [
    { type: 'dc-al-fine', measureIndex: 3, from: 2, lastStart: 2, lastEnd: 3 },
    { type: 'fine', measureIndex: 1, from: 0, lastStart: 0, lastEnd: 1 },
  ]
  assert.equal(show(buildPlaySegments(dcFine, 6)), '1 2 3 4<2 1 2<0')
})

test('D.S. al Coda: To Coda note ends the repeat, Coda note starts the coda', () => {
  const markers = [
    { type: 'segno', measureIndex: 0, from: 0, lastStart: 0, lastEnd: 1 },
    { type: 'to-coda', measureIndex: 1, from: 2, lastStart: 2, lastEnd: 3 },
    { type: 'ds-al-coda', measureIndex: 3, from: 1, lastStart: 1, lastEnd: 2 },
    { type: 'coda', measureIndex: 4, from: 1, lastStart: 1, lastEnd: 2 },
  ]
  assert.equal(show(buildPlaySegments(markers, 6)), '1 2 3 4<1 1 2<2 5@1 6')
})

test('repeats / endings still unroll on top of note-level slices', () => {
  const order = buildPlaySegments([], 6)
  const out = expandRepeats(order, [{ id: 'r', start: 0, end: 2 }],
    [{ id: 'a', startMeasure: 2, endMeasure: 2, numbers: [1] }, { id: 'b', startMeasure: 3, endMeasure: 3, numbers: [2] }])
  assert.deepEqual(out.map(e => e.m), [0, 1, 2, 0, 1, 3, 4, 5])
})

test('Solfa: a marker stored on a note resolves to that note\'s position in its voice', () => {
  useSolfaStore.getState().loadScore(buildEmptySolfaScore('satb', 'C', 4, 8))
  const sc = useSolfaStore.getState().score
  const pid = sc.parts[0].id
  // give the first voice a clean 4/4 bar: four quarter notes
  sc.parts[0].measures.forEach(m => m.beats.forEach(b => { b.events = [{ type: 'note', syllable: 'd', octave: 0, duration: 4 }] }))
  const st = useSolfaStore.getState()
  st.addNavigationMarker('segno', 0, 's', null, 2, 0, pid)
  st.addNavigationMarker('ds', 7, 'D.S.', null, 1, 0, pid)
  st.addNavigationMarker('fine', 3, 'Fine') // bar-level
  const score = useSolfaStore.getState().score
  const mk = markersFromNavigationMarkers(score.navigationMarkers, score)
  const segno = mk.find(m => m.type === 'segno'), ds = mk.find(m => m.type === 'ds'), fine = mk.find(m => m.type === 'fine')
  assert.deepEqual([segno.from, segno.lastEnd], [8, 12])   // 3rd note: starts at 8 (quarter-units), ends at 12
  assert.deepEqual([ds.lastStart, ds.lastEnd], [4, 8])     // 2nd note
  assert.equal(fine.lastStart, undefined)                  // bar-level
})

test('Staff: a text counts as note-level only when it was placed on a note', () => {
  const texts = [
    { partId: 'p', measureIndex: 0, beat: 2, text: 'Segno', onNote: true },
    { partId: 'p', measureIndex: 7, beat: 1, text: 'D.S.', onNote: true },
    { partId: 'p', measureIndex: 4, beat: 0, text: 'Fine' },   // placed on a bar
    { partId: 'p', measureIndex: 5, beat: 0, text: 'just a label' },
  ]
  const mk = markersFromStaffTexts(texts, (pid, mi, beat) => beat + 1)
  assert.equal(mk.length, 3)
  assert.deepEqual([mk[0].from, mk[0].lastEnd], [2, 3])
  assert.equal(mk[2].lastStart, undefined)
})