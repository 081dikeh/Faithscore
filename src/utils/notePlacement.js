// src/utils/notePlacement.js
//
// Pure helpers behind note placement in the Staff app. Nothing here touches
// React, the DOM tree or the score store, so every rule can be tested alone.
// The interaction layer (ScoreRenderer) turns pointer events into these inputs
// and the store applies the result — click, drag and keyboard all share this.
//
// ── Coordinate systems (the thing that used to go wrong) ─────────────────────
//   client px  : what a pointer event reports (affected by page zoom/scroll)
//   local px   : layout pixels inside the score container — what the overlay
//                divs, measure zones and the ghost note are positioned in
//   Staff positions are counted in half line-spacings (a line OR a space):
//                pos 0 = top staff line, 2 = second line, 8 = bottom line,
//                negative = above the staff, > 8 = below it.
// pointerToLocal() is the ONLY place client → local conversion happens, and it
// divides out any CSS transform (the app's zoom is `transform: scale()`), so
// the ghost note stays under the pointer at any zoom level.

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

// Pitch on the TOP staff line for each clef.
export const CLEF_TOP_LINE = {
  treble: { step: "F", octave: 5 },
  bass: { step: "A", octave: 3 },
  alto: { step: "G", octave: 4 },
  tenor: { step: "E", octave: 4 },
};

const diatonic = (p) => p.octave * 7 + LETTERS.indexOf(p.step);

/** Pitch at staff position `pos` (0 = top line, +1 per line/space downward). */
export function pitchFromStaffPos(pos, clef = "treble") {
  const top = CLEF_TOP_LINE[clef] || CLEF_TOP_LINE.treble;
  const abs = diatonic(top) - pos;
  return {
    step: LETTERS[((abs % 7) + 7) % 7],
    octave: Math.floor(abs / 7),
    accidental: null,
  };
}

/** Inverse of pitchFromStaffPos (ignores the accidental). */
export function staffPosFromPitch(pitch, clef = "treble") {
  const top = CLEF_TOP_LINE[clef] || CLEF_TOP_LINE.treble;
  return diatonic(top) - diatonic(pitch);
}

/** Nearest staff position (line or space) for a local-px Y. */
export function staffPosFromY(y, topLineY, lineSpacing) {
  return Math.round((y - topLineY) / (lineSpacing / 2)) || 0; // `|| 0` turns -0 into 0
}

/** Local-px Y of staff position `pos`. */
export function yFromStaffPos(pos, topLineY, lineSpacing) {
  return topLineY + pos * (lineSpacing / 2);
}

/**
 * Staff positions that need a ledger line to show a note at `pos`.
 * (Lines sit at even positions; above the staff they are -2, -4 …, below
 * it 10, 12 …. A note in the SPACE beyond the last ledger line still needs it.)
 */
export function ledgerPositions(pos) {
  const out = [];
  if (pos <= -2) for (let q = -2; q >= pos; q -= 2) out.push(q);
  else if (pos >= 10) for (let q = 10; q <= pos; q += 2) out.push(q);
  return out;
}

/** Stem points up for notes below the middle line (pos > 4), else down. */
export const stemUpForPos = (pos) => pos > 4;

/**
 * Convert a pointer event to LOCAL px inside `el` (the score container).
 * Divides out ancestor transforms: scale = rendered width / layout width.
 * Returns { x, y, scale }.
 */
export function pointerToLocal(e, el) {
  const rect = el.getBoundingClientRect();
  const layoutW = el.offsetWidth || rect.width || 1;
  const layoutH = el.offsetHeight || rect.height || 1;
  const sx = rect.width / layoutW || 1;
  const sy = rect.height / layoutH || 1;
  return {
    x: (e.clientX - rect.left) / sx,
    y: (e.clientY - rect.top) / sy,
    scale: sx,
  };
}

/**
 * Which staff (measure zone) the pointer is over.
 *   zones : measure zones { x, width, staveTopLineY, staveLineSpacing, … }
 *   Only zones whose horizontal span contains `x` count; of those the one
 *   whose staff is VERTICALLY NEAREST wins, so two staves stacked close
 *   together (a piano grand staff) never steal each other's pointer.
 *   `ledgerRoom` = how many ledger lines above/below still count as "on" it.
 */
export function pickStaff(zones, x, y, ledgerRoom = 5) {
  let best = null;
  let bestDist = Infinity;
  for (const z of zones) {
    if (x < z.x || x > z.x + z.width) continue;
    const ls = z.staveLineSpacing || 10;
    const top = z.staveTopLineY;
    const bottom = top + ls * 4;
    const reach = ls * (ledgerRoom + 0.5);
    if (y < top - reach || y > bottom + reach) continue;
    const centre = (top + bottom) / 2;
    const d = Math.abs(y - centre);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best;
}

/**
 * Beat ↔ x mapping inside one measure.
 * Notes are not laid out on a linear pixel grid (the engraver spaces them by
 * duration, accidentals, dots …), so a straight "fraction of the bar" mapping
 * drifts away from where notes really are. Instead, anchor the map at the
 * REAL x of every sounding note, plus the bar's note-area start and end, and
 * interpolate between anchors.
 *   realNotes: [{ beatStart, x }]   x = local-px centre of that notehead
 */
export function buildBeatAnchors(noteAreaStart, noteAreaEnd, capacity, realNotes = []) {
  const pts = [{ beat: 0, x: noteAreaStart }];
  for (const n of [...realNotes].sort((a, b) => a.beatStart - b.beatStart)) {
    if (n.beatStart <= 1e-6) {
      pts[0] = { beat: 0, x: n.x }; // a note on beat 1 pins the start
    } else if (n.beatStart < capacity - 1e-6) {
      pts.push({ beat: n.beatStart, x: n.x });
    }
  }
  pts.push({ beat: capacity, x: Math.max(noteAreaEnd, pts[pts.length - 1].x + 1) });
  // keep x strictly increasing so the map is invertible
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x <= pts[i - 1].x) pts[i] = { ...pts[i], x: pts[i - 1].x + 0.5 };
  }
  return pts;
}

export function beatToX(anchors, beat) {
  const b = Math.max(0, Math.min(anchors[anchors.length - 1].beat, beat));
  for (let i = 1; i < anchors.length; i++) {
    if (b <= anchors[i].beat + 1e-9) {
      const a = anchors[i - 1];
      const c = anchors[i];
      const t = c.beat === a.beat ? 0 : (b - a.beat) / (c.beat - a.beat);
      return a.x + t * (c.x - a.x);
    }
  }
  return anchors[anchors.length - 1].x;
}

export function xToBeat(anchors, x) {
  if (x <= anchors[0].x) return 0;
  for (let i = 1; i < anchors.length; i++) {
    if (x <= anchors[i].x) {
      const a = anchors[i - 1];
      const c = anchors[i];
      const t = (x - a.x) / (c.x - a.x);
      return a.beat + t * (c.beat - a.beat);
    }
  }
  return anchors[anchors.length - 1].beat;
}

/**
 * Rhythmic grid the pointer snaps to, in quarter-note beats: the selected
 * note value, but never coarser than one beat (so a half note can still be
 * dropped on beat 2) and never finer than a 32nd.
 */
export function gridStepFor(durationKey) {
  const base = { w: 4, h: 2, q: 1, 8: 0.5, 16: 0.25, 32: 0.125, 64: 0.0625 }[durationKey] ?? 1;
  return Math.max(0.125, Math.min(1, base));
}

/**
 * Snap a raw beat to the grid — but if a real note STARTS close by (within
 * `magnet` beats), snap to it instead, so clicking beside an existing note adds
 * to that chord rather than creating a nearly-coincident second note.
 */
export function snapBeat(rawBeat, step, capacity, noteOnsets = [], magnet = 0.2) {
  let best = Math.round(rawBeat / step) * step;
  let nearest = null;
  let nearestD = Infinity;
  for (const o of noteOnsets) {
    const d = Math.abs(rawBeat - o);
    if (d < nearestD) {
      nearestD = d;
      nearest = o;
    }
  }
  if (nearest != null && nearestD <= magnet + 1e-9) best = nearest;
  return Math.max(0, Math.min(best, Math.max(0, capacity - 0.125)));
}