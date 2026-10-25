// src/components/ScoreRenderer/index.jsx
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  StaveConnector,
  Dot,
  Beam,
  StaveTie,
  Tuplet,
  Barline,
} from "vexflow";
import {
  useScoreStore,
  DURATION_BEATS,
  noteDuration,
  measureCapacity,
  keySignatureAccidentals,
  planPlacement,
} from "../../store/scoreStore";
import {
  getNoteLyric,
  anyNoteHasVerse,
  inlineVersesForPart,
  belowScoreVerses,
  resolveVerses,
  wrapLyricBlock,
} from "../../utils/lyricVerses";
import {
  pitchFromStaffPos,
  staffPosFromY,
  staffPosFromPitch,
  yFromStaffPos,
  ledgerPositions,
  stemUpForPos,
  pointerToLocal,
  pickStaff,
  buildBeatAnchors,
  beatToX,
  xToBeat,
  gridStepFor,
  snapBeat,
} from "../../utils/notePlacement.js";
import {
  keySignatureToSolfaKey,
  NAME_TO_VOICE_ID,
  convertMeasureToSolfaBeats,
  resolveScoreSlurs,
} from "../../utils/staffToSolfa";

const MEASURES_PER_LINE = 5;

// Stable reference used as a fallback in selectors below — using `|| []` inline
// creates a NEW array every render, which (when that value sits in a useCallback
// dependency array) causes an infinite render loop. Reusing one constant avoids that.
const EMPTY_ARR = [];

// SP = pixels per staff space. Increase to make everything bigger, decrease for smaller.
// 10 = compact, 12 = medium, 14 = large, 16 = very large
const SP = 14;

const STAFF_HEIGHT = SP * 4; // 48px — full staff (4 spaces between 5 lines)
const PART_HEIGHT = SP * 11; // 154px — staff + gap to next staff in system
const SYSTEM_GAP = SP * 8; // 96px — gap between rows of systems
const STAVE_TOP = SP * 3; // 36px — top margin
const STAVE_HEIGHT = STAFF_HEIGHT + SP * 3; // 84px — click zone includes ledger lines
// ── Unified "above/below staff" clearance ──────────────────────────────────
// Every marking that sits above or below the staff (dynamics, hairpins,
// staff text/tempo, 8va/8vb, articulations) uses THIS SAME calculation, so
// they all sit at a consistent, correctly-scaled distance from the staff —
// previously each one had its own separate (and inconsistent) pixel offset.
//
// realSP = actual pixels-per-staff-space for this specific stave, derived
// directly from the zone's click-zone height (z.height = realSP * 7, since
// STAVE_HEIGHT = STAFF_HEIGHT(realSP*4) + realSP*3). This is more direct
// than the old "scale = z.height/98" ratio and avoids compounding error.
//
// Clearance = 1.2 staff-spaces — a clearly visible gap in real engraving
// terms, scaled correctly for whatever staff size is actually rendering.
function aboveBelowGap(zoneHeight) {
  const realSP = zoneHeight / 7;
  return realSP * 1.2;
}

// Middle of staff for rests — VexFlow places rest glyph at this key position.
// Bass clef lines (bottom→top): G2 B2 D3 F3 A3 — middle line = D3
// Treble clef lines (bottom→top): E4 G4 B4 D5 F5 — middle line = B4
// Per-duration rest positions — standard engraving rules:
// Treble: whole hangs from D5 (line 4), half sits on B4 (line 3), others on B4 (middle)
// Bass:   whole hangs from F3 (line 4), half sits on D3 (line 3), others on D3 (middle)
const REST_KEYS = {
  treble: {
    w: "d/5",
    h: "b/4",
    q: "b/4",
    8: "b/4",
    16: "b/4",
    32: "b/4",
    64: "b/4",
  },
  bass: {
    w: "f/3",
    h: "d/3",
    q: "d/3",
    8: "d/3",
    16: "d/3",
    32: "d/3",
    64: "d/3",
  },
};

function keyNumToVexflow(num) {
  const map = {
    0: "C",
    1: "G",
    2: "D",
    3: "A",
    4: "E",
    5: "B",
    6: "F#",
    7: "C#",
    "-1": "F",
    "-2": "Bb",
    "-3": "Eb",
    "-4": "Ab",
    "-5": "Db",
    "-6": "Gb",
    "-7": "Cb",
  };
  return map[String(num)] ?? "C";
}

// keySignatureAccidentals() is imported from scoreStore.js — the shared
// music-theory module also used by chromatic note entry, so both agree on
// exactly which letters a key signature alters.

// ── Tie / slur curve geometry ────────────────────────────────────────────────
// A longer tie or slur should get LONGER, not dramatically DEEPER — using
// unbounded `distance * factor` produces absurdly tall arcs on wide gaps.
// Depth is a small base amount plus a shallow slope on distance, clamped to
// a sane min/max. Ties and slurs are tuned separately on purpose: a tie is
// short/tight/closely bound to its two noteheads (same pitch, duration
// glue), while a slur is a broader, more graceful phrase arc that can span
// many notes — so it gets a taller base depth and ceiling.
function clampVal(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
const TIE_BASE_DEPTH = 6;
const TIE_DEPTH_FACTOR = 0.045;
const TIE_MIN_DEPTH = 6;
const TIE_MAX_DEPTH = 15;
function tieCurveDepth(distancePx) {
  return clampVal(
    TIE_BASE_DEPTH + distancePx * TIE_DEPTH_FACTOR,
    TIE_MIN_DEPTH,
    TIE_MAX_DEPTH,
  );
}
const SLUR_BASE_DEPTH = 14;
const SLUR_DEPTH_FACTOR = 0.075;
const SLUR_MIN_DEPTH = 14;
const SLUR_MAX_DEPTH = 38;
function slurCurveDepth(distancePx) {
  return clampVal(
    SLUR_BASE_DEPTH + distancePx * SLUR_DEPTH_FACTOR,
    SLUR_MIN_DEPTH,
    SLUR_MAX_DEPTH,
  );
}

// ── Stem direction helper ────────────────────────────────────────────────────
// Returns 1 (up) or -1 (down) based on note position relative to middle line.
// Standard engraving rule:
//   Notes BELOW the middle line → stem UP   (1)
//   Notes ABOVE the middle line → stem DOWN (-1)
//   Middle line note → stem UP by default   (1)
//
// For chords: compute average diatonic position of all notes; stem direction
// follows the note farthest from the middle line.
//
// Diatonic position = octave × 7 + step index (C=0 D=1 E=2 F=3 G=4 A=5 B=6)
// Middle-line positions by clef:
//   treble → B4 = 4×7+6 = 34
//   bass   → D3 = 3×7+1 = 22
//   alto   → C4 = 4×7+0 = 28  (alto C-clef, middle line = C4)
//   tenor  → A3 = 3×7+5 = 26  (tenor C-clef, middle line = A3)

const STEP_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const MIDDLE_LINE = { treble: 34, bass: 22, alto: 28, tenor: 26 };

function diatonicPos(pitch) {
  if (!pitch?.step) return 34; // treble middle line fallback
  return (pitch.octave || 4) * 7 + (STEP_IDX[pitch.step] ?? 0);
}

function stemDir(note, chordExtras, clef) {
  // Whole notes never have stems
  if (note.duration === "w") return 1;

  const mid = MIDDLE_LINE[clef] || MIDDLE_LINE.treble;
  const allPitches = [note, ...chordExtras]
    .filter((n) => n.pitch && !n.isRest)
    .map((n) => diatonicPos(n.pitch));

  if (!allPitches.length) return 1;

  // Rule: note AT or ABOVE the middle line → stem DOWN (-1)
  //       note BELOW the middle line       → stem UP   (1)
  //
  // For chords: find the note farthest from the middle line.
  // That note decides the direction. If equidistant, the lower note wins
  // (standard: stem goes UP when ambiguous).
  const distAbove = Math.max(...allPitches.map((p) => p - mid)); // > 0 means above mid
  const distBelow = Math.max(...allPitches.map((p) => mid - p)); // > 0 means below mid

  // If furthest note is above or ON the middle line → stem DOWN
  if (distAbove >= distBelow) return -1;
  // If furthest note is strictly below the middle line → stem UP
  return 1;
}

function buildVfNote(
  n,
  clef,
  isSelected,
  chordExtras = [],
  keySigAccidentals = {},
  accidentalState = {},
) {
  const restKeyMap = REST_KEYS[clef] || REST_KEYS.treble;
  const restKey = restKeyMap[n.duration] || restKeyMap["8"]; // per-duration position
  const clefOpt = clef === "bass" ? { clef: "bass" } : {};

  if (n.isRest) {
    const sn = new StaveNote({
      keys: [restKey],
      duration: n.duration + "r",
      dots: n.dots || 0,
      type: "r",
      ...clefOpt,
    });
    if (n.dots) Dot.buildAndAttach([sn]);
    if (isSelected)
      sn.setStyle({ fillStyle: "#2563eb", strokeStyle: "#2563eb" });
    return sn;
  }

  const defKey = clef === "bass" ? "f/3" : "b/4";
  const allNotes = [n, ...chordExtras];
  const keys = allNotes.map((nn) =>
    nn.pitch ? `${nn.pitch.step.toLowerCase()}/${nn.pitch.octave}` : defKey,
  );

  // ── Calculate stem direction from pitch position ──────────────────────────
  const direction = stemDir(n, chordExtras, clef);

  const sn = new StaveNote({
    keys,
    duration: n.duration,
    dots: n.dots || 0,
    stem_direction: direction, // VexFlow 3 API
    ...clefOpt,
  });
  // VexFlow 4 API — must call this explicitly too, as Formatter can reset stem_direction
  try {
    sn.setStemDirection(direction);
  } catch (_) {}
  if (n.dots) Dot.buildAndAttach([sn]);
  if (isSelected) sn.setStyle({ fillStyle: "#ea580c", strokeStyle: "#ea580c" });
  else if (n.triplet)
    sn.setStyle({ fillStyle: "#0d9488", strokeStyle: "#0d9488" });

  allNotes.forEach((nn, ki) => {
    if (!nn.pitch) return;
    const letter = nn.pitch.step;
    const octave = nn.pitch.octave;
    const stateKey = `${letter}${octave}`;
    const actual = nn.pitch.accidental || null; // '#' | 'b' | null (natural)
    // What's already "in effect" for this exact letter+octave: an earlier
    // accidental on the SAME pitch this bar (accidentals only carry within
    // one bar and don't cross octaves), or — if nothing's overridden it
    // yet — whatever the key signature itself implies for that letter.
    const implied = Object.prototype.hasOwnProperty.call(
      accidentalState,
      stateKey,
    )
      ? accidentalState[stateKey]
      : keySigAccidentals[letter] || null;
    if (actual !== implied) {
      // VexFlow's accidental code for "natural" (cancel a sharp/flat) is 'n'.
      sn.addModifier(new Accidental(actual || "n"), ki);
    }
    accidentalState[stateKey] = actual;
  });

  // Lyrics are NOT attached here as a VexFlow Annotation modifier — that
  // auto-positions relative to each note's OWN bounding box (which varies
  // with stem direction, beaming, ledger lines...), which is exactly what
  // produced a ragged, inconsistent lyric line instead of a straight one.
  // They're drawn manually instead, after the whole system is laid out,
  // at one shared baseline per staff row — see the ctx.fillText pass right
  // after voice.draw(ctx, stave) below.
  return sn;
}

// Rendered width (px) of a lyric syllable as it is actually drawn:
// ctx.setFont("Times New Roman", 11, ...) is 11 POINTS in VexFlow 5, i.e.
// 11 * 4/3 = 14.67 CSS px. Measured with a canvas (cached) so bar widths and
// note spacing reflect the real text, not a characters-times-constant guess.
const LYRIC_FONT_PX = (11 * 4) / 3;
let _lyricMeasureCtx;
const _lyricMeasureCache = new Map();
function measureLyricPx(text) {
  const t = String(text || "");
  if (!t) return 0;
  const hit = _lyricMeasureCache.get(t);
  if (hit != null) return hit;
  let w;
  try {
    if (!_lyricMeasureCtx && typeof document !== "undefined") {
      _lyricMeasureCtx = document.createElement("canvas").getContext("2d");
      _lyricMeasureCtx.font = `${LYRIC_FONT_PX}px "Times New Roman", Times, serif`;
    }
    w = _lyricMeasureCtx
      ? _lyricMeasureCtx.measureText(t).width
      : t.length * LYRIC_FONT_PX * 0.5;
  } catch (_) {
    w = t.length * LYRIC_FONT_PX * 0.5;
  }
  if (_lyricMeasureCache.size > 2000) _lyricMeasureCache.clear();
  _lyricMeasureCache.set(t, w);
  return w;
}

// A translucent note that follows the pointer. Pure presentation: it knows
// nothing about the score, only where (x, y in local px), which staff position
// (pos), and how big a line spacing (ls) to draw at — so it scales with the
// staff size and the zoom (the zoom is a CSS scale on the whole page).
const GHOST_TONES = {
  ok: ["rgba(37,99,235,0.88)", "rgba(37,99,235,0.35)", "#1d4ed8"],
  chord: ["rgba(124,58,237,0.88)", "rgba(124,58,237,0.35)", "#6d28d9"],
  invalid: ["rgba(220,38,38,0.88)", "rgba(220,38,38,0.35)", "#b91c1c"],
  drag: ["rgba(234,88,12,0.88)", "rgba(234,88,12,0.35)", "#c2410c"],
};
function GhostNote({ x, y, pos, ls, top, duration, dots, tone, label, sub, showBeatGuide, bare }) {
  const [color, glow, badge] = GHOST_TONES[tone] || GHOST_TONES.ok;
  const w = ls * 1.32;
  const h = ls * 0.95;
  const filled = duration !== "w" && duration !== "h";
  const hasStem = !bare && duration !== "w";
  const flags = bare ? 0 : { 8: 1, 16: 2, 32: 3, 64: 4 }[duration] || 0;
  const up = stemUpForPos(pos);
  const stemLen = ls * 3.4;
  const sw = Math.max(1.2, ls * 0.15);
  const stemX = up ? x + w / 2 - sw : x - w / 2;
  const stemTop = up ? y - stemLen : y;
  const common = { position: "absolute", pointerEvents: "none" };
  return (
    <>
      {showBeatGuide && (
        <div
          style={{
            ...common,
            left: x - 0.5,
            top: top - ls * 1.2,
            width: 1,
            height: ls * 6.4,
            background: glow,
            zIndex: 17,
          }}
        />
      )}
      {ledgerPositions(pos).map((q) => (
        <div
          key={q}
          style={{
            ...common,
            left: x - ls * 1.1,
            top: yFromStaffPos(q, top, ls) - 1,
            width: ls * 2.2,
            height: Math.max(1.5, ls * 0.15),
            background: color,
            opacity: 0.8,
            zIndex: 18,
          }}
        />
      ))}
      <div
        style={{
          ...common,
          left: x - w / 2,
          top: y - h / 2,
          width: w,
          height: h,
          borderRadius: "50%",
          background: filled ? color : "transparent",
          border: `${Math.max(1.5, ls * 0.17)}px solid ${color}`,
          boxSizing: "border-box",
          boxShadow: `0 0 ${ls * 0.8}px ${glow}`,
          transform: "rotate(-20deg)",
          zIndex: 18,
        }}
      />
      {hasStem && (
        <div style={{ ...common, left: stemX, top: stemTop, width: sw, height: stemLen, background: color, zIndex: 18 }} />
      )}
      {Array.from({ length: flags }).map((_, i) => (
        <div
          key={i}
          style={{
            ...common,
            left: stemX + (up ? sw : 0),
            top: up ? stemTop + i * ls * 0.55 : stemTop + stemLen - i * ls * 0.55,
            width: ls * 1.0,
            height: Math.max(1.5, ls * 0.2),
            background: color,
            transformOrigin: "left center",
            transform: `rotate(${up ? 38 : -38}deg)`,
            zIndex: 18,
          }}
        />
      ))}
      {dots ? (
        <div
          style={{
            ...common,
            left: x + w / 2 + ls * 0.35,
            top: y - ls * 0.2 - (pos % 2 === 0 ? ls * 0.5 : 0),
            width: ls * 0.4,
            height: ls * 0.4,
            borderRadius: "50%",
            background: color,
            zIndex: 18,
          }}
        />
      ) : null}
      <div
        style={{
          ...common,
          left: x + w / 2 + ls * 0.9,
          top: y - ls * 2.1,
          background: badge,
          color: "white",
          fontSize: Math.max(10, ls * 1.0),
          fontWeight: 700,
          lineHeight: 1.25,
          padding: "1px 6px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          zIndex: 19,
        }}
      >
        {label}
        {sub ? (
          <span style={{ fontWeight: 500, opacity: 0.9, marginLeft: 6, fontSize: "0.85em" }}>
            {sub}
          </span>
        ) : null}
      </div>
    </>
  );
}

export default function ScoreRenderer() {
  const containerRef = useRef(null);
  const [zones, setZones] = useState([]);
  const rootRef = useRef(null); // the positioned wrapper — the single coordinate origin
  const gestureRef = useRef(null); // a note-input press in progress { pointerId }
  const noteDragRef = useRef(null); // an existing-note pitch drag in progress
  const lastPtrRef = useRef(null); // last pointer position, to refresh the ghost after edits
  const [pitchDrag, setPitchDrag] = useState(null); // preview while dragging a notehead
  // cursor: tracks mouse position in note mode — the "ghost note" that follows the cursor
  // { partId, measureIndex, zKey, beat, pitch, ghostX, ghostY, isChord }
  const [cursor, setCursor] = useState(null);
  const cursorRef = useRef(null); // always-fresh cursor for click handler
  const playbackCursorElRef = useRef(null); // the playback cursor's own DOM element, for scroll-follow
  const lastScrollTopRef = useRef(null); // last row Y we auto-scrolled to, so we only scroll on row changes

  const score = useScoreStore((s) => s.score);
  const selectedMeasureIndex = useScoreStore((s) => s.selectedMeasureIndex);
  const selectedPartId = useScoreStore((s) => s.selectedPartId);
  const selectedNoteId = useScoreStore((s) => s.selectedNoteId);
  const selectMeasure = useScoreStore((s) => s.selectMeasure);
  const selectNote = useScoreStore((s) => s.selectNote);
  const selectedMarking = useScoreStore((s) => s.selectedMarking);
  const selectMarking = useScoreStore((s) => s.selectMarking);
  const moveNote = useScoreStore((s) => s.moveNote);
  const setNotePitch = useScoreStore((s) => s.setNotePitch);
  const playbackBeat = useScoreStore((s) => s.playbackBeat);
  const dropNoteAtBeat = useScoreStore((s) => s.dropNoteAtBeat);
  const addChordNote = useScoreStore((s) => s.addChordNote);
  const chordMode = useScoreStore((s) => s.chordMode);
  const selectedNoteId_store = useScoreStore((s) => s.selectedNoteId);
  const inputMode = useScoreStore((s) => s.inputMode);
  const selectedDuration = useScoreStore((s) => s.selectedDuration);
  const selectedDots = useScoreStore((s) => s.selectedDots);
  const zoom = useScoreStore((s) => s.zoom);
  const measuresPerLine = useScoreStore((s) => s.measuresPerLine ?? 4);
  const autoLayout = useScoreStore((s) => s.autoLayout ?? true);
  const staffSize = useScoreStore((s) => s.staffSize ?? 10);
  const dynamics = useScoreStore((s) => s.score.dynamics || EMPTY_ARR);
  const hairpins = useScoreStore((s) => s.score.hairpins || EMPTY_ARR);
  const rehearsalMarks = useScoreStore(
    (s) => s.score.rehearsalMarks || EMPTY_ARR,
  );
  const barlines = useScoreStore((s) => s.score.barlines || EMPTY_ARR);
  const octaveLines = useScoreStore((s) => s.score.octaveLines || EMPTY_ARR);
  const staffTextsForLanes = useScoreStore(
    (s) => s.score.staffTexts || EMPTY_ARR,
  );

  // Multiple text/line-based markings (dynamics, staff text) can land on the
  // same bar. Without this they'd render on top of each other. Assign each one a
  // "lane" so they stack outward from the staff instead.
  // NOTE: Hairpins (crescendos) and octave lines always stay directly on/below
  // the staff (lane 0) — they do not participate in the lane stacking system.
  const textLaneIndex = useMemo(() => {
    const byMeasure = new Map(); // "partId::measureIndex::side" -> [{id, beat}]
    const push = (partId, measureIndex, id, beat, side) => {
      const key = `${partId}::${measureIndex}::${side}`;
      if (!byMeasure.has(key)) byMeasure.set(key, []);
      byMeasure.get(key).push({ id, beat });
    };
    dynamics.forEach((d) =>
      push(d.partId, d.measureIndex, d.id, d.beat, "above"),
    );
    staffTextsForLanes.forEach((t) =>
      push(t.partId, t.measureIndex, t.id, t.beat, "above"),
    );
    // hairpins and octaveLines omitted — they use their own fixed positioning
    const map = new Map();
    byMeasure.forEach((list) => {
      list.sort((a, b) => a.beat - b.beat);
      list.forEach((item, idx) => map.set(item.id, idx));
    });
    return map;
  }, [dynamics, staffTextsForLanes]);

  const render = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    // Dynamic layout values from store (user-adjustable in Layout tab)
    // ── Dynamic layout constants ─────────────────────────────────────────────
    const SP = staffSize;
    const STAFF_HEIGHT = SP * 4;
    // Extra headroom when the sol-fa-above-staff overlay is on: a fixed,
    // generous clearance for the sol-fa row (see the "Vertical clearance"
    // comment further down) needs real room reserved for it, or it
    // collides with the previous part's lyric line. Only grown when the
    // feature is actually in use, so normal scores keep the compact
    // spacing they already had.
    const PART_HEIGHT = score.showSolfaAbove ? SP * 12 : SP * 9;
    const SYSTEM_GAP = SP * 5;
    // The very first system has no earlier system's content above it to
    // share space with, so its own top margin has to fit the sol-fa
    // clearance directly — otherwise the first system's row renders at a
    // negative Y, off the top of the page entirely.
    const STAVE_TOP = score.showSolfaAbove ? SP * 6 : SP * 4;
    const STAVE_HEIGHT = STAFF_HEIGHT + SP * 3;
    const LEFT_MARGIN = 20;
    const RIGHT_MARGIN = 20;

    const numParts = score.parts.length;
    const totalCols = Math.max(...score.parts.map((p) => p.measures.length), 1);
    // ── Verses ────────────────────────────────────────────────────────────
    // Which verse lines hang under each voice. A verse on "auto" voices shows
    // under every voice that actually has text for it; a verse pinned to a
    // list of voices shows under exactly those. Each extra line makes that
    // staff row a little taller so lines never collide with the next staff.
    const partVerseList = score.parts.map((part) =>
      inlineVersesForPart(score, part, (v) =>
        anyNoteHasVerse(
          part.measures.flatMap((m) => m.notes),
          v.number,
        ),
      ),
    );
    const LYRIC_LINE_H = SP * 1.7;
    const partHeights = partVerseList.map(
      (l) => PART_HEIGHT + Math.max(0, l.length - 1) * LYRIC_LINE_H,
    );
    const partOff = [];
    {
      let acc = 0;
      partHeights.forEach((h) => {
        partOff.push(acc);
        acc += h;
      });
    }
    const partsTotalH = partHeights.reduce((a, b) => a + b, 0);
    // "1." "2." … are printed at the start of each line once the score has
    // more than one inline verse.
    const showVerseTags =
      resolveVerses(score).filter((v) => v.placement === "inline").length > 1;
    const systemH = partsTotalH + SYSTEM_GAP;

    // ── Measure width calculation ─────────────────────────────────────────────
    // Compute minimum pixel width for each measure based on content density.
    // This is the core of the dynamic layout — denser measures get more space.
    const NOTE_PX = {
      w: SP * 7,
      h: SP * 5,
      q: SP * 3.6,
      8: SP * 2.6,
      16: SP * 2.1,
      32: SP * 1.8,
      64: SP * 1.6,
    };
    const MIN_MEASURE_WIDTH = SP * 11;
    const MAX_MEASURE_WIDTH = SP * 100;

    function getMeasureContentWidth(colIdx) {
      let maxNotePx = 0;
      for (const part of score.parts) {
        const m = part.measures[colIdx];
        if (!m) continue;
        const nonChord = m.notes.filter((n) => !n.chordWith);
        // A note's slot has to be wide enough for its lyric as well: lyrics
        // are centred on their notes, so two neighbours need their centres
        // at least (L1 + L2) / 2 + a gap apart — the very same rule the
        // formatter applies below (see "per-note lyric room"), so the bar is
        // always given at least the width that spacing needs.
        const tickW = getLyricTickWidths(colIdx);
        let posAcc = 0;
        const Ls = nonChord.map((n) => {
          const key = Math.round(posAcc * 1000);
          posAcc += noteDuration(n);
          return tickW.get(key) || 0;
        });
        const notePx = nonChord.reduce((sum, n, i) => {
          const durationPx =
            (NOTE_PX[n.duration] || SP * 3) +
            (n.dots ? SP : 0) +
            (n.pitch?.accidental ? SP * 0.8 : 0);
          const L = Ls[i];
          const Ln = i + 1 < Ls.length ? Ls[i + 1] : null;
          const needPx =
            Ln != null
              ? (L + Ln) / 2 + (L > 0 && Ln > 0 ? SP * 0.8 : 0)
              : L / 2 + SP * 1.2; // last note: half its word + barline room
          return sum + Math.max(durationPx, needPx);
        }, 0);
        if (notePx > maxNotePx) maxNotePx = notePx;
      }
      const estimate = Math.max(
        MIN_MEASURE_WIDTH,
        Math.min(MAX_MEASURE_WIDTH, maxNotePx),
      );
      // The estimate above is a fixed width per note value; it can't know
      // about accidentals, dots, beamed 16ths/32nds, ties… that make a bar
      // physically need more room. So a bar is NEVER narrower than what
      // VexFlow itself says its notes need (plus lyric room). It is only
      // limited by the page: a bar can't be wider than a whole line.
      const needed = getVexMinContent(colIdx);
      const wanted = Math.max(estimate, needed);
      const pageCap = USABLE_W - getGlyphOverhead(colIdx, true) - SP * 1.2;
      return Math.max(MIN_MEASURE_WIDTH, Math.min(wanted, pageCap));
    }

    // Minimum width (px) a bar's notes need, per VexFlow's own metrics: the
    // notes are packed at their minimum spacing (no justification) and the
    // widest part wins, so every stave in the system can share one width.
    // Lyric spacing is added with the same rule the formatter uses later.
    const vexMinCache = {};
    function getVexMinContent(colIdx) {
      if (vexMinCache[colIdx] != null) return vexMinCache[colIdx];
      let best = 0;
      try {
        const tickW = getLyricTickWidths(colIdx);
        for (const part of score.parts) {
          const measure = part.measures[colIdx];
          if (!measure) continue;
          const clef = part.clef || "treble";
          const chordMap = {};
          measure.notes.forEach((n) => {
            if (n.chordWith) (chordMap[n.chordWith] ||= []).push(n);
          });
          const seq = measure.notes.filter((n) => !n.chordWith);
          if (!seq.length) continue;
          const keyAcc = keySignatureAccidentals(measure.keySignature ?? 0);
          const accState = {};
          const vfs = seq.map((n) =>
            buildVfNote(n, clef, false, chordMap[n.id] || [], keyAcc, accState),
          );
          const voice = new Voice({
            numBeats: measure.timeSignature.beats,
            beatValue: measure.timeSignature.beatType,
          }).setStrict(false);
          voice.addTickables(vfs);
          const f = new Formatter().joinVoices([voice]);
          f.createTickContexts([voice]);
          f.preFormat(0);
          const tcs = vfs.map((v) => v.getTickContext());
          const xs = tcs.map((tc) => tc.getX());
          const trailing = Math.max(0, f.getMinTotalWidth() - xs[xs.length - 1]);
          let pos = 0;
          const Ls = seq.map((n) => {
            const key = Math.round(pos * 1000);
            pos += noteDuration(n);
            return tickW.get(key) || 0;
          });
          let total = trailing + Math.max(0, Ls[Ls.length - 1] / 2 - SP * 1.3);
          for (let i = 0; i < xs.length - 1; i++) {
            const need =
              (Ls[i] + Ls[i + 1]) / 2 +
              (Ls[i] > 0 && Ls[i + 1] > 0 ? SP * 0.8 : 0);
            total += Math.max(xs[i + 1] - xs[i], need);
          }
          total += Math.max(0, Ls[0] / 2 - SP * 2.2) + xs[0];
          if (total > best) best = total;
        }
      } catch (_) {
        best = 0;
      }
      // + the formatter's own left padding and a little breathing room
      best = best > 0 ? best + Stave.defaultPadding + SP * 0.8 : 0;
      return (vexMinCache[colIdx] = best);
    }

    // Widest lyric starting at each beat position of bar `colIdx`, across ALL
    // parts. Using the shared maximum (not each part's own lyric) means voices
    // with the same rhythm still get identical note spacing, so notes stay
    // vertically aligned even when only some voices carry that lyric.
    const lyricTickWidthCache = {};
    function getLyricTickWidths(colIdx) {
      if (lyricTickWidthCache[colIdx]) return lyricTickWidthCache[colIdx];
      const map = new Map();
      score.parts.forEach((part, pIdx) => {
        const m = part.measures[colIdx];
        if (!m) return;
        const verses = partVerseList[pIdx];
        let pos = 0;
        m.notes
          .filter((n) => !n.chordWith)
          .forEach((n) => {
            const key = Math.round(pos * 1000);
            let w = 0;
            for (const v of verses) {
              const t = getNoteLyric(n, v.number);
              if (t) w = Math.max(w, measureLyricPx(t));
            }
            if (w > (map.get(key) || 0)) map.set(key, w);
            pos += noteDuration(n);
          });
      });
      return (lyricTickWidthCache[colIdx] = map);
    }

    // Real width taken by the clef / key signature / time signature (and any
    // mid-line change glyphs) on this bar, measured from an actual VexFlow
    // Stave. Falls back to the old estimate if that can't be measured.
    const overheadCache = {};
    function getGlyphOverhead(colIdx, isFirstInLine) {
      const ck = `${colIdx}:${isFirstInLine ? 1 : 0}`;
      if (overheadCache[ck] != null) return overheadCache[ck];
      let v;
      try {
        v = 0;
        for (const part of score.parts) {
          const measure = part.measures[colIdx];
          if (!measure) continue;
          const st = new Stave(0, 0, 4000);
          const prev = part.measures[colIdx - 1];
          const ks = measure.keySignature ?? 0;
          const prevKs = prev?.keySignature;
          const ts = measure.timeSignature;
          if (isFirstInLine) {
            st.addClef(part.clef || "treble");
            st.addKeySignature(
              keyNumToVexflow(ks),
              prevKs !== undefined && prevKs !== ks
                ? keyNumToVexflow(prevKs)
                : undefined,
            );
            st.addTimeSignature(`${ts.beats}/${ts.beatType}`);
          } else {
            if ((prevKs ?? 0) !== ks) {
              st.addKeySignature(keyNumToVexflow(ks), keyNumToVexflow(prevKs ?? 0));
            }
            const pts = prev?.timeSignature;
            if (pts && (pts.beats !== ts.beats || pts.beatType !== ts.beatType)) {
              st.addTimeSignature(`${ts.beats}/${ts.beatType}`);
            }
          }
          v = Math.max(v, st.getNoteStartX());
        }
        if (!(v > 0)) v = estimateGlyphOverhead(colIdx, isFirstInLine);
      } catch (_) {
        v = estimateGlyphOverhead(colIdx, isFirstInLine);
      }
      return (overheadCache[ck] = v);
    }

    // First-measure overhead: clef + key sig + time sig (rough estimate)
    function estimateGlyphOverhead(colIdx, isFirstInLine) {
      if (isFirstInLine) {
        const keySig = score.parts[0]?.measures[colIdx]?.keySignature ?? 0;
        return SP * 2.2 + Math.abs(keySig) * SP * 0.7 + SP * 1.6 + SP * 0.6;
      }
      // Mid-line meter/key change: reserve room for whichever glyphs
      // actually land on this bar, even though it isn't first in its line.
      const prevTs = score.parts[0]?.measures[colIdx - 1]?.timeSignature;
      const thisTs = score.parts[0]?.measures[colIdx]?.timeSignature;
      const tsChanged =
        prevTs &&
        thisTs &&
        (prevTs.beats !== thisTs.beats || prevTs.beatType !== thisTs.beatType);
      const prevKs = score.parts[0]?.measures[colIdx - 1]?.keySignature ?? 0;
      const thisKs = score.parts[0]?.measures[colIdx]?.keySignature ?? 0;
      const keyChanged = prevKs !== thisKs;

      let overhead = SP * 1.2;
      if (keyChanged) {
        overhead += (Math.abs(thisKs) + Math.abs(prevKs)) * SP * 0.7 + SP * 0.4;
      }
      if (tsChanged) overhead += SP * 1.6 + SP * 0.4;
      return overhead;
    }

    // ── Dynamic line breaking (MuseScore-style) ───────────────────────────────
    // Distribute measures across lines so no line exceeds DRAW_W.
    // Preferred bars per line is a soft target — we break earlier if content
    // is too wide, or fit more if content is sparse.
    // Walk up DOM to get available width
    let PAGE_W = 0;
    let el = containerRef.current?.parentElement;
    while (el && PAGE_W < 50) {
      PAGE_W = Math.floor(el.clientWidth);
      el = el.parentElement;
    }
    if (PAGE_W < 50) PAGE_W = 720;
    let SCALE = SP / 10;
    let DRAW_W = Math.round(PAGE_W / SCALE);
    let DRAW_H = Math.round((totalCols * 100) / SCALE); // temporary value for line breaking
    const USABLE_W = DRAW_W - LEFT_MARGIN - RIGHT_MARGIN;

    // Build lines: each line is an array of column indices
    const lines = [];
    let lineStart = 0;
    while (lineStart < totalCols) {
      let lineWidth = 0;
      let colCount = 0;
      // Only enforced when the user has explicitly chosen a fixed layout —
      // in autoLayout (default) mode, lines fill purely by available width,
      // exactly like MuseScore/Dorico/Sibelius. This was previously always
      // applied and capped every line at ~4 bars regardless of how much
      // width was left over, which is what caused the large empty gaps.
      const preferredMax = autoLayout ? 0 : measuresPerLine;

      for (let c = lineStart; c < totalCols; c++) {
        const isFirst = colCount === 0;
        const overhead = getGlyphOverhead(c, isFirst);
        const content = getMeasureContentWidth(c);
        const needed = overhead + content + SP * 1.2;

        // Hard break: adding this measure would exceed usable width
        if (colCount > 0 && lineWidth + needed > USABLE_W) break;
        // Soft break: reached preferred bars-per-line (manual mode only)
        if (colCount >= preferredMax && preferredMax > 0) break;

        lineWidth += needed;
        colCount++;
        if (c === totalCols - 1) break; // last measure
      }

      if (colCount === 0) colCount = 1; // always include at least 1 measure
      lines.push({
        cols: Array.from({ length: colCount }, (_, i) => lineStart + i),
      });
      lineStart += colCount;
    }

    const totalLines = lines.length;

    // Walk up the DOM to find a container with a real non-zero width.
    // containerRef.current = VexFlow SVG div
    // parentElement = div wrapper (width:100%)
    // parentElement.parentElement = .score-page card
    PAGE_W = 0;
    el = containerRef.current?.parentElement;
    while (el && PAGE_W < 50) {
      PAGE_W = Math.floor(el.clientWidth);
      el = el.parentElement;
    }
    if (PAGE_W < 50) PAGE_W = 720; // absolute fallback

    // Subtract horizontal padding of the score-page card (37px each side = 74px)
    // so the SVG canvas exactly fills the white paper between margins
    // Symbol scale factor: SP=10 is VexFlow default size.
    // At SP=14, symbols are 40% bigger. We scale the drawing context
    // and adjust the internal coordinate space accordingly.
    SCALE = SP / 10; // e.g. SP=14 → SCALE=1.4
    DRAW_W = Math.round(PAGE_W / SCALE); // internal drawing width
    DRAW_H = Math.round((totalLines * systemH + 80) / SCALE);
    const canvasW = PAGE_W; // actual SVG pixel width = container width
    // Verses set to "Below score" print as ordinary text under the last system.
    const blockVerses = belowScoreVerses(score);
    const BLOCK_LINE_H = SP * 1.7;
    const BLOCK_HEAD_H = SP * 2;
    const blockMaxW = Math.max(120, USABLE_W - SP * 3);
    const blockPrepared = blockVerses.map((v) => ({
      ...v,
      lines: wrapLyricBlock(v.text, blockMaxW, measureLyricPx),
    }));
    const blockH = blockPrepared.length
      ? SP * 3.6 +
        blockPrepared.reduce(
          (sum, v) => sum + BLOCK_HEAD_H + v.lines.length * BLOCK_LINE_H + SP,
          0,
        )
      : 0;
    const canvasH = totalLines * systemH + 80 + blockH; // actual SVG pixel height

    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    renderer.resize(canvasW, canvasH);
    const ctx = renderer.getContext();

    // Scale symbols UP — ctx.scale makes noteheads, clefs, stems all bigger/smaller
    // The SVG viewBox is set to DRAW_W × DRAW_H so content fills full width
    const svgEl = containerRef.current.querySelector("svg");
    if (svgEl) {
      svgEl.setAttribute("viewBox", `0 0 ${DRAW_W} ${DRAW_H}`);
      svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
    }

    ctx.scale(SCALE, SCALE);
    ctx.setFont("Times New Roman", 10);

    const allZones = [];

    // ── Precompute sol-fa conversion for every part, once, up front ─────────
    // Reuses the SAME conversion engine as the real "convert to Solfa score"
    // feature (convertMeasureToSolfaBeats) rather than a second, hand-rolled
    // duration/tie/rhythm engine living only in this file. That earlier
    // approach kept drifting from correct behavior — most importantly, it
    // only ever looked at ties WITHIN a single measure, so a note tied
    // across a barline (extremely common in real hymn writing — see any
    // "de r | r. m f" style passage) was never recognized as a
    // continuation at all. This is computed for the WHOLE part up front,
    // not per-system, because tie-across-measures needs the true measure-0
    // -onward sequence — a system only shows a slice of a part's measures,
    // and slicing first would break that carry-over.
    const solfaByPart = new Map();
    if (score.showSolfaAbove) {
      score.parts.forEach((part) => {
        const voiceId =
          NAME_TO_VOICE_ID[(part.name || "").trim().toLowerCase()] || "solo";
        const notePositions = new Map();
        const measuresBeats = [];
        let carryPitch;
        for (let mi = 0; mi < part.measures.length; mi++) {
          const measure = part.measures[mi];
          const ts = measure.timeSignature ||
            score.parts[0]?.measures[0]?.timeSignature || {
              beats: 4,
              beatType: 4,
            };
          const keySig = measure.keySignature ?? 0;
          const key = keySignatureToSolfaKey(keySig);
          const { beats, endOpenPitch } = convertMeasureToSolfaBeats(
            measure.notes,
            ts,
            key,
            voiceId,
            [],
            carryPitch,
            mi,
            notePositions,
          );
          measuresBeats.push(beats);
          carryPitch = endOpenPitch;
        }
        const scoreSlurs = resolveScoreSlurs(part);
        const slurs = [];
        for (const { startNoteId, endNoteId } of scoreSlurs) {
          const startPos = notePositions.get(startNoteId);
          const endPos = notePositions.get(endNoteId);
          if (!startPos || !endPos) continue;
          slurs.push({ startPos, endPos });
        }
        solfaByPart.set(part, { measuresBeats, notePositions, slurs });
      });
    }

    // Inside the drawing loop, use DRAW_W as the effective page width
    // so staves span the full width of the scaled coordinate space
    // EFFECTIVE_W replaced by USABLE_W in dynamic layout

    if (blockPrepared.length) {
      // Top of this area = bottom of the last system's staves + a margin.
      let by = (totalLines - 1) * systemH + STAVE_TOP + partsTotalH + SP * 3.4;
      blockPrepared.forEach((v) => {
        try {
          ctx.setFont("Times New Roman", 12, "bold");
          ctx.fillText(v.label || `Verse ${v.number}`, LEFT_MARGIN + 4, by);
          by += BLOCK_HEAD_H;
          ctx.setFont("Times New Roman", 11, "normal");
          v.lines.forEach((ln) => {
            if (ln) ctx.fillText(ln, LEFT_MARGIN + SP, by);
            by += BLOCK_LINE_H;
          });
          by += SP;
          ctx.setFont("Times New Roman", 10);
        } catch (_) {}
      });
    }

    for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
      const { cols: lineCols } = lines[lineIdx];
      const startCol = lineCols[0];
      const endCol = lineCols[lineCols.length - 1] + 1;
      const sysY = lineIdx * systemH + STAVE_TOP;

      // Measure number label
      ctx.save();
      ctx.setFont("Arial", 9);
      ctx.fillText(String(startCol + 1), 24, sysY - 10);
      ctx.restore();

      let firstStave = null,
        lastStave = null;

      // ── Per-column widths using dynamic content-based calculation ────────────
      const colMinWidths = lineCols.map((col, colIdx) => {
        const isFirst = colIdx === 0;
        const overhead = getGlyphOverhead(col, isFirst);
        const content = getMeasureContentWidth(col);
        return overhead + content + SP * 1.2;
      });

      // Justify: scale widths proportionally to fill full usable width
      const totalMinW = colMinWidths.reduce((a, b) => a + b, 0);
      const isLastLine = lineIdx === totalLines - 1;
      // Last line: don't stretch — leave natural spacing
      const justifyScale =
        totalMinW > USABLE_W
          ? USABLE_W / totalMinW // never run off the page
          : !isLastLine
            ? USABLE_W / totalMinW
            : 1;
      const colWidths = colMinWidths.map((w) => Math.floor(w * justifyScale));
      // Distribute rounding remainder to last column
      const allocated = colWidths.reduce((a, b) => a + b, 0);
      if (!isLastLine) colWidths[colWidths.length - 1] += USABLE_W - allocated;

      const colX = [];
      let cx = LEFT_MARGIN;
      for (const w of colWidths) {
        colX.push(cx);
        cx += w;
      }

      score.parts.forEach((part, pIdx) => {
        const partY = sysY + partOff[pIdx];
        const clef = part.clef || "treble";

        for (let colInLine = 0; colInLine < lineCols.length; colInLine++) {
          const col = lineCols[colInLine];
          const measure = part.measures[col];
          if (!measure) continue;
          const isFirst = colInLine === 0;
          const width = colWidths[colInLine];
          const x = colX[colInLine];

          const stave = new Stave(x, partY, width);
          if (isFirst) {
            stave.addClef(clef);
            // Courtesy cancellation: if this line's opening key differs
            // from whatever was active in the immediately preceding bar
            // (i.e. we're picking up mid-modulation, not just restating
            // the same key at a new system), show natural signs for the
            // old key's accidentals before the new key signature.
            const prevKeyAtLineStart = part.measures[col - 1]?.keySignature;
            const openingKeyChanged =
              prevKeyAtLineStart !== undefined &&
              prevKeyAtLineStart !== (measure.keySignature ?? 0);
            stave.addKeySignature(
              keyNumToVexflow(measure.keySignature ?? 0),
              openingKeyChanged
                ? keyNumToVexflow(prevKeyAtLineStart)
                : undefined,
            );
            stave.addTimeSignature(
              `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`,
            );
          } else {
            // Mid-line meter/key change — VexFlow only auto-shows clef/key/
            // time at a line's first measure, so a change landing further
            // along the same system needs its glyph added explicitly here.
            const prevKs = part.measures[col - 1]?.keySignature ?? 0;
            const thisKs = measure.keySignature ?? 0;
            const keyChanged = prevKs !== thisKs;
            if (keyChanged) {
              stave.addKeySignature(
                keyNumToVexflow(thisKs),
                keyNumToVexflow(prevKs),
              );
            }
            const prevTs = part.measures[col - 1]?.timeSignature;
            const tsChanged =
              prevTs &&
              (prevTs.beats !== measure.timeSignature.beats ||
                prevTs.beatType !== measure.timeSignature.beatType);
            if (tsChanged) {
              stave.addTimeSignature(
                `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`,
              );
            }
          }

          // ── Custom barline (applies to every part's stave in this column,
          // so the line reads as continuous across the whole system) ──────
          const barlineEntry = barlines.find((b) => b.measureIndex === col);
          if (barlineEntry) {
            const END_TYPES = {
              double: Barline.type.DOUBLE,
              final: Barline.type.END,
              "repeat-end": Barline.type.REPEAT_END,
              "repeat-both": Barline.type.REPEAT_BOTH,
            };
            if (barlineEntry.type === "repeat-start") {
              stave.setBegBarType(Barline.type.REPEAT_BEGIN);
            } else if (END_TYPES[barlineEntry.type]) {
              stave.setEndBarType(END_TYPES[barlineEntry.type]);
            }
          }

          const isMeasureSel =
            col === selectedMeasureIndex &&
            part.id === selectedPartId &&
            !selectedNoteId;
          if (isMeasureSel)
            stave.setStyle({ fillStyle: "#1d4ed8", strokeStyle: "#1d4ed8" });
          stave.setContext(ctx).draw();

          // Rehearsal mark (square box above staff) — only on first part
          if (pIdx === 0) {
            const rm = rehearsalMarks.find((r) => r.measureIndex === col);
            if (rm) {
              ctx.save();
              ctx.setFont("Arial", 13);
              const rmW = Math.max(20, rm.text.length * 10 + 8);
              ctx.setFillStyle("#1d3a6e");
              ctx.fillRect(x + 2, partY - 30, rmW, 20);
              ctx.setFillStyle("white");
              ctx.fillText(rm.text, x + 5, partY - 14);
              ctx.restore();
            }
          }

          // Part name labels removed — clean score appearance like MuseScore default
          // (names show in the parts panel/sidebar instead)

          if (isFirst && numParts > 1) {
            if (pIdx === 0) firstStave = stave;
            if (pIdx === numParts - 1) lastStave = stave;
          }

          // Build chord map
          const chordMap = {};
          measure.notes
            .filter((n) => n.chordWith)
            .forEach((n) => {
              if (!chordMap[n.chordWith]) chordMap[n.chordWith] = [];
              chordMap[n.chordWith].push(n);
            });

          // Render sequence = all non-chord notes (including rests already stored)
          const renderSeq = measure.notes.filter((n) => !n.chordWith);

          if (renderSeq.length === 0) {
            allZones.push({
              type: "measure",
              partId: part.id,
              measureIndex: col,
              x,
              y: partY,
              width,
              height: STAVE_HEIGHT,
              selected: isMeasureSel,
            });
            continue;
          }

          try {
            // Fresh per-measure accidental tracking — an accidental only
            // stays "in effect" for the rest of THIS bar, so this must
            // reset every measure, not persist across the piece.
            const keySigAccidentals = keySignatureAccidentals(
              measure.keySignature ?? 0,
            );
            const accidentalState = {};
            const vfNotes = renderSeq.map((n) =>
              buildVfNote(
                n,
                clef,
                n.id === selectedNoteId,
                chordMap[n.id] || [],
                keySigAccidentals,
                accidentalState,
              ),
            );

            // FIX: VexFlow 5 requires camelCase (numBeats/beatValue).
            // snake_case keys are silently ignored, causing every Voice
            // to default to 4/4 internally — corrupting all other meters.
            const voice = new Voice({
              numBeats: measure.timeSignature.beats,
              beatValue: measure.timeSignature.beatType,
            }).setStrict(false);
            voice.addTickables(vfNotes);
            // Formatter width = stave width minus glyph overhead.
            // getGlyphOverhead() accounts for clef + key sig accidentals + time sig.
            const glyphOverhead = getGlyphOverhead(col, isFirst);
            // Breathing room from the barlines — kept asymmetric on
            // purpose. The LEFT side (right after the clef/key/time
            // glyphs, before the first note) keeps its original spacing.
            // The RIGHT side (after the last note, before the next
            // barline) was reserving the same amount, which is where the
            // visible "dead space after the last note" was coming from —
            // reduced, not removed, and the reclaimed width is handed
            // straight to VexFlow's own Formatter.format() call below, so
            // it naturally redistributes it across every note's spacing
            // instead of just shrinking the trailing gap in isolation.
            const BARLINE_PAD_LEFT = SP * 2;
            const BARLINE_PAD_RIGHT = SP * 0.8;
            // Use the stave's real note area (what is left after the clef /
            // key / time glyphs it actually drew), not an estimate of it —
            // an underestimate here is what pushed notes past the barline.
            const formatterWidth = Math.max(
              40,
              stave.getNoteEndX() -
                stave.getNoteStartX() -
                Stave.defaultPadding -
                BARLINE_PAD_RIGHT * 0.5,
            );
            const formatter = new Formatter().joinVoices([voice]);
            let formatted = false;
            try {
              // VexFlow justifies a bar by note DURATION and ignores each
              // note's own minimum room, so a long syllable under a short
              // note crowds its neighbour. So after VexFlow has laid the bar
              // out we re-place the notes ourselves:
              //   * lyrics are drawn centred on their notes, so two
              //     neighbours need their centres at least (L1 + L2) / 2 +
              //     a small gap apart (never less than VexFlow's own
              //     minimum for the notes themselves);
              //   * any width left over after that is shared out in
              //     proportion to VexFlow's own spacing, so the bar still
              //     fills its width and keeps its duration-proportional feel;
              //   * the first / last lyric also get room towards the
              //     barlines so they don't spill into the next bar.
              const tickW = getLyricTickWidths(col);
              if (tickW.size) {
                const softmax = formatter.formatterOptions?.softmaxFactor;
                if (softmax) voice.setSoftmaxFactor(softmax);
                formatter.createTickContexts([voice]);
                const tcs = vfNotes.map((vfn) => vfn.getTickContext());

                formatter.preFormat(0); // notes packed at their minimum
                const minX = tcs.map((tc) => tc.getX());
                formatter.preFormat(formatterWidth, undefined, [voice]);
                const idealX = tcs.map((tc) => tc.getX());

                let pos = 0;
                const Ls = renderSeq.map((n) => {
                  const key = Math.round(pos * 1000);
                  pos += noteDuration(n);
                  return tickW.get(key) || 0;
                });
                const n = tcs.length;
                if (n > 1) {
                  const LYRIC_GAP_PX = SP * 0.8;
                  const minD = [];
                  const idealD = [];
                  for (let i = 0; i < n - 1; i++) {
                    const need =
                      (Ls[i] + Ls[i + 1]) / 2 +
                      (Ls[i] > 0 && Ls[i + 1] > 0 ? LYRIC_GAP_PX : 0);
                    minD.push(Math.max(minX[i + 1] - minX[i], need));
                    idealD.push(Math.max(idealX[i + 1] - idealX[i], 0.01));
                  }
                  // Keep the first / last lyric clear of the barlines.
                  const startShift = Math.max(0, Ls[0] / 2 - SP * 2.2);
                  const endShift = Math.max(0, Ls[n - 1] / 2 - (BARLINE_PAD_RIGHT + SP * 0.5));
                  const x0 = idealX[0] + startShift;
                  const span = Math.max(0, idealX[n - 1] - endShift - x0);
                  const minSum = minD.reduce((a, d) => a + d, 0);
                  const idealSum = idealD.reduce((a, d) => a + d, 0);
                  const surplus = Math.max(0, span - minSum);
                  let x = x0;
                  tcs[0].setX(x);
                  for (let i = 0; i < n - 1; i++) {
                    x += minD[i] + (surplus * idealD[i]) / idealSum;
                    tcs[i + 1].setX(x);
                  }
                }
                formatted = true;
              }
            } catch (_) {
              formatted = false;
            }
            if (!formatted) {
              // Fallback: plain VexFlow formatting (no lyric-aware spacing).
              new Formatter().joinVoices([voice]).format([voice], formatterWidth);
            }

            // Re-apply stem directions AFTER formatting — Formatter.format() resets
            // stem_direction to its own auto-calculated value, overriding ours.
            // We must re-set explicitly here to enforce our engraving rules.
            renderSeq.forEach((seqNote, ni) => {
              if (seqNote.isRest) return;
              try {
                const dir = stemDir(
                  seqNote,
                  Object.values(chordMap[seqNote.id] || {}),
                  clef,
                );
                vfNotes[ni].setStemDirection(dir);
              } catch (_) {}
            });

            // ── Beaming ─────────────────────────────────────────────────────
            //
            // Beam grouping follows MuseScore's defaults. Groups below are in
            // EIGHTH-NOTE units and apply to EIGHTH notes:
            //   4/4  → [4,4]       beats 1–2 | 3–4 (never across the middle)
            //   3/4  → [2,2,2]     one beam per beat
            //   2/4  → [4]         all four eighths together
            //   2/2  → [4,4]       like 4/4
            //   5/4  → [6,4]       3+2
            //   7/4  → [6,4,4]     3+2+2
            //   6/8  → [3,3]  9/8 → [3,3,3]  12/8 → [3,3,3,3]
            //   5/8  → [3,2]       7/8 → [3,2,2]
            // SIXTEENTH (and shorter) notes break more finely: at every beat
            // in simple meters (groups of 4 sixteenths), and at the group
            // boundaries above in compound/irregular (8-based) meters.
            //
            // Algorithm:
            //   1. Walk vfNotes in original order (never pre-filter).
            //   2. Non-beamable note or rest → close current run immediately.
            //   3. A note starting on a break point FOR ITS OWN DURATION
            //      closes the current run and starts a new one.
            //   4. Run of 2+ beamable notes → build Beam with group-avg stem dir.

            function getBeamGrouping(ts) {
              const beats = ts?.beats || 4;
              const beatType = ts?.beatType || 4;
              if (beatType === 4) {
                if (beats === 2) return [4];
                if (beats === 3) return [2, 2, 2];
                if (beats === 4) return [4, 4];
                if (beats === 5) return [6, 4];
                if (beats === 6) return [4, 4, 4];
                if (beats === 7) return [6, 4, 4];
                return Array(beats).fill(2);
              }
              if (beatType === 2) {
                return Array(beats).fill(4);
              }
              if (beatType === 8) {
                if (beats % 3 === 0) return Array(beats / 3).fill(3);
                const IRR = { 5: [3, 2], 7: [3, 2, 2], 11: [3, 3, 3, 2] };
                if (IRR[beats]) return IRR[beats];
                const g = [];
                let r = beats;
                while (r > 3) {
                  g.push(2);
                  r -= 2;
                }
                if (r > 0) g.push(r);
                return g;
              }
              return Array(beats).fill(1);
            }

            const beamGroups = [];
            {
              // VexFlow RESOLUTION = 16384; 1 eighth note = 2048 ticks
              const VF_8TH_TICKS = 16384 / 8; // 2048
              const BEAMABLE = new Set(["8", "16", "32", "64"]);

              const grouping = getBeamGrouping(measure.timeSignature);
              let boundAcc = 0;
              const bounds = grouping.map((g) => {
                boundAcc += g * VF_8TH_TICKS;
                return boundAcc;
              });

              // Internal group boundaries (the end of the bar is not a break).
              const groupBreaks = bounds.slice(0, -1);
              // 8-based meters group by the dotted-beat groups above; every
              // other meter has a plain quarter-note beat for 16ths and below.
              const quarterBeat = (measure.timeSignature?.beatType || 4) !== 8;
              const EPS = 1;
              function isBreak(tick, denom) {
                if (groupBreaks.some((b) => Math.abs(tick - b) < EPS)) return true;
                if (denom >= 16 && quarterBeat) {
                  const q = 16384 / 4;
                  const r = tick % q;
                  if (r < EPS || q - r < EPS) return true;
                }
                return false;
              }

              // Set a single stem direction across the entire run based on
              // the average pitch of all notes in the run.
              function applyGroupDir(runVfNotes, runSeqNotes) {
                if (!runVfNotes.length) return;
                const mid = MIDDLE_LINE[clef] || MIDDLE_LINE.treble;
                let sum = 0,
                  cnt = 0;
                runSeqNotes.forEach((sn) => {
                  if (!sn || sn.isRest || !sn.pitch) return;
                  sum += diatonicPos(sn.pitch);
                  cnt++;
                  const extras = chordMap[sn.id] || [];
                  extras.forEach((cn) => {
                    if (cn.pitch) {
                      sum += diatonicPos(cn.pitch);
                      cnt++;
                    }
                  });
                });
                const dir = cnt > 0 && sum / cnt >= mid ? -1 : 1;
                runVfNotes.forEach((vfn) => {
                  try {
                    vfn.setStemDirection(dir);
                  } catch (_) {}
                });
              }

              function flushRun(runVfNotes, runSeqNotes) {
                if (runVfNotes.length < 2) return;
                applyGroupDir(runVfNotes, runSeqNotes);
                try {
                  const beam = new Beam(runVfNotes, false);
                  runVfNotes.forEach((vfn) => {
                    try {
                      vfn.setFlagStyle({
                        fillStyle: "transparent",
                        strokeStyle: "transparent",
                      });
                    } catch (_) {}
                  });
                  beamGroups.push(beam);
                } catch (_) {}
              }

              let run = [],
                runSeq = [],
                tickPos = 0;

              vfNotes.forEach((vfNote, ni) => {
                let dur = "",
                  isBeamable = false,
                  denom = 4;
                try {
                  dur = vfNote.getDuration();
                  const isRest = vfNote.isRest ? vfNote.isRest() : false;
                  isBeamable = BEAMABLE.has(dur) && !isRest;
                  denom = parseInt(dur, 10) || 4;
                } catch (_) {}

                // Real sounding length of this note, from the same model the
                // rest of the app uses (noteDuration: quarter = 1 beat). This
                // covers dots on ANY value (dotted quarter, dotted half…),
                // half/whole notes, and tuplets (a triplet eighth is 1/3 beat,
                // not 1/2). A previous version only counted dots on eighths
                // and shorter and treated every half/whole note as a quarter,
                // which pushed every later beam boundary in the bar off.
                const seqN = renderSeq[ni];
                const noteTicks = seqN
                  ? noteDuration(seqN) * (16384 / 4)
                  : 16384 / 4;

                if (!isBeamable) {
                  flushRun(run, runSeq);
                  run = [];
                  runSeq = [];
                } else {
                  if (run.length > 0 && isBreak(tickPos, denom)) {
                    flushRun(run, runSeq);
                    run = [];
                    runSeq = [];
                  }
                  run.push(vfNote);
                  runSeq.push(renderSeq[ni]);
                }
                tickPos += noteTicks;
              });
              flushRun(run, runSeq);
            }

            voice.draw(ctx, stave);
            beamGroups.forEach((b) => {
              try {
                b.setContext(ctx).draw();
              } catch (_) {}
            });

            // ── Lyrics ──────────────────────────────────────────────────────
            // Drawn manually at ONE shared baseline for this entire staff
            // row (not per-note), which is what actually makes them line
            // up straight — getAbsoluteX() is only valid now, after
            // voice.draw() has finished formatting/positioning every note.
            // Uses stave.getBottomLineY() — the RAW bottom-line position,
            // no padding included — plus our own single, explicit offset.
            // getBottomY() was tried first and overshot into the next
            // staff: per VexFlow's own source (stave.js), getBottomY() =
            // getYForLine(numLines) + spaceBelowStaffLn*spacing — it
            // already bakes in VexFlow's own default "space below staff"
            // margin, so adding another offset on top of it was stacking
            // two paddings. getBottomLineY() has none of that, so there's
            // exactly one offset in play, not two compounding ones.
            const lyricY = stave.getBottomLineY() + SP * 1.5;
            const verseRows = partVerseList[pIdx];
            if (verseRows.length) {
              ctx.setFont("Times New Roman", 11, "normal");
              verseRows.forEach((verse, vk) => {
                const rowY = lyricY + vk * LYRIC_LINE_H;
                renderSeq.forEach((seqNote, ni) => {
                  const text = getNoteLyric(seqNote, verse.number);
                  if (!text) return;
                  try {
                    // Centered under the notehead; measureText gives the
                    // syllable's real rendered width so centering is exact.
                    const { width } = ctx.measureText(text);
                    const noteX = vfNotes[ni].getAbsoluteX();
                    ctx.fillText(text, noteX - width / 2, rowY);
                  } catch (_) {}
                });
                // Verse number at the start of each system.
                if (showVerseTags && isFirst) {
                  try {
                    ctx.setFont("Times New Roman", 11, "bold");
                    ctx.fillText(verse.tag, stave.getX() + SP * 1.3, rowY);
                    ctx.setFont("Times New Roman", 11, "normal");
                  } catch (_) {}
                }
              });
              // Explicit reset (not save/restore) so whatever draws next —
              // measure numbers, rehearsal marks — isn't left inheriting
              // size-11 lyric text as its font.
              ctx.setFont("Times New Roman", 10);
            }

            // ── Articulations ────────────────────────────────────────────────
            // Draw articulation marks above/below noteheads using canvas primitives.
            // VexFlow 4's Articulation import is unreliable across builds, so we
            // draw directly on the canvas for maximum compatibility.
            // A note can carry several marks at once — they stack outward from
            // the staff (closest first) so none overlap.
            try {
              renderSeq.forEach((seqNote, ni) => {
                const marks =
                  seqNote.articulations ||
                  (seqNote.articulation ? [seqNote.articulation] : []);
                if (!marks.length || seqNote.isRest) return;
                const vfNote = vfNotes[ni];
                const nx = vfNote.getAbsoluteX() + 4;

                // Default: just above the staff, using the SAME clearance
                // (1.2 staff-spaces) as dynamics/hairpins/text/8va, so every
                // "above staff" marking sits at a consistent distance. If the
                // notehead itself sits higher (on ledger lines above the
                // staff), lift the whole stack just enough to clear it —
                // capped so it never drifts far from the staff.
                let baseAy = partY - SP * 1.2;
                try {
                  const ys = vfNote.getYs ? vfNote.getYs() : [];
                  if (ys.length) {
                    const topY = Math.min(...ys);
                    if (topY < baseAy) {
                      baseAy = Math.max(topY - SP, partY - SP * 4);
                    }
                  }
                } catch (_) {}

                const STACK_GAP = SP * 1.7; // vertical spacing between stacked marks
                const artFontSize = SP * 1.6;

                marks.forEach((art, markIndex) => {
                  const ay = baseAy - markIndex * STACK_GAP;

                  ctx.save();
                  ctx.setFont("Times New Roman", artFontSize);
                  ctx.setFillStyle("#1e293b");

                  if (art === "staccato") {
                    ctx.beginPath();
                    ctx.arc(nx, ay, SP * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                  } else if (art === "tenuto") {
                    ctx.fillRect(nx - SP * 0.8, ay, SP * 1.6, SP * 0.35);
                  } else if (art === "accent") {
                    ctx.font = `bold ${SP * 2.2}px serif`;
                    ctx.fillText(">", nx - SP * 0.8, ay + SP * 0.6);
                  } else if (art === "marcato") {
                    ctx.font = `bold ${SP * 2}px serif`;
                    ctx.fillText("^", nx - SP * 0.6, ay + SP * 0.2);
                  } else if (art === "fermata") {
                    ctx.font = `bold ${SP * 2.4}px serif`;
                    ctx.fillText("𝄐", nx - SP * 0.8, ay + SP * 0.2);
                  } else if (art === "trill") {
                    ctx.font = `italic bold ${SP * 1.8}px serif`;
                    ctx.fillText("tr", nx - SP * 0.6, ay + SP * 0.2);
                  } else if (art === "mordent") {
                    ctx.font = `bold ${SP * 2}px serif`;
                    ctx.fillText("𝆁", nx - SP * 0.6, ay + SP * 0.2);
                  } else if (art === "turn") {
                    ctx.font = `bold ${SP * 2}px serif`;
                    ctx.fillText("𝆃", nx - SP * 0.6, ay + SP * 0.2);
                  } else if (art === "staccatissimo") {
                    ctx.beginPath();
                    ctx.moveTo(nx, ay - SP * 0.5);
                    ctx.lineTo(nx - SP * 0.4, ay + SP * 0.3);
                    ctx.lineTo(nx + SP * 0.4, ay + SP * 0.3);
                    ctx.closePath();
                    ctx.fill();
                  } else if (art === "portato") {
                    ctx.fillRect(
                      nx - SP * 0.7,
                      ay + SP * 0.2,
                      SP * 1.4,
                      SP * 0.3,
                    );
                    ctx.beginPath();
                    ctx.arc(nx, ay - SP * 0.4, SP * 0.3, 0, Math.PI * 2);
                    ctx.fill();
                  } else if (art === "harmonic") {
                    ctx.strokeStyle = "#1e293b";
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    ctx.arc(nx, ay, 5, 0, Math.PI * 2);
                    ctx.stroke();
                  } else if (art === "snap-pizz") {
                    ctx.font = "bold 20px serif";
                    ctx.fillText("⊙", nx - 6, ay + 5);
                  } else if (art === "vibrato") {
                    // Short wavy squiggle above the note
                    ctx.strokeStyle = "#1e293b";
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    const wy = ay - 2;
                    ctx.moveTo(nx - 8, wy);
                    for (let i = -8; i <= 8; i += 4) {
                      ctx.quadraticCurveTo(nx + i + 2, wy - 3, nx + i + 4, wy);
                    }
                    ctx.stroke();
                  }
                  ctx.restore();
                });
              });
            } catch (_) {}

            // ── Tuplet brackets ─────────────────────────────────────────────
            // Group tuplet notes by their tripletGroupId and draw a bracket
            // once the FULL group is present — not just "2 or more", which
            // would draw a malformed bracket over a partial/incomplete group
            // (e.g. if a member note failed to render for some reason).
            try {
              const tupletGroups = {};
              renderSeq.forEach((seqNote, ni) => {
                const groupId =
                  seqNote.tripletGroupId || seqNote.tuplet?.groupId;
                if (!groupId) return;
                if (!tupletGroups[groupId]) tupletGroups[groupId] = [];
                tupletGroups[groupId].push({ note: vfNotes[ni], seqNote });
              });
              Object.values(tupletGroups).forEach((group) => {
                const expected =
                  group[0].seqNote.tripletOf ||
                  group[0].seqNote.tuplet?.num ||
                  3;
                if (group.length < expected) return; // incomplete group — skip rather than draw a broken bracket
                const ratio = group[0].seqNote.tuplet || { num: 3, den: 2 };
                const tupletNotes = group.map((g) => g.note);
                // Bracket sits opposite the notes' own stem direction (same
                // convention as ties/slurs elsewhere in this renderer) —
                // not hardcoded to always sit above, which collides with
                // ledger lines on low passages (bass clef, etc).
                let stemUp = true;
                try {
                  stemUp = tupletNotes[0].getStemDirection() === 1;
                } catch (_) {}
                const tuplet = new Tuplet(tupletNotes, {
                  num_notes: ratio.num,
                  notes_occupied: ratio.den,
                  ratioed: false,
                  bracketed: true,
                  location: stemUp
                    ? Tuplet.LOCATION_TOP
                    : Tuplet.LOCATION_BOTTOM,
                });
                tuplet.setContext(ctx).draw();
              });
            } catch (_) {}

            // ── Helper: same pitch? ─────────────────────────────────────────
            const samePitch = (a, b) =>
              a?.pitch &&
              b?.pitch &&
              a.pitch.step === b.pitch.step &&
              a.pitch.octave === b.pitch.octave &&
              (a.pitch.accidental ?? null) === (b.pitch.accidental ?? null);

            // ── drawTieCanvas ────────────────────────────────────────────────
            // Draws a professional tie arc directly on the canvas.
            // x1,y1 = notehead center of first note
            // x2,y2 = notehead center of second note
            // stemUp: true → tie bows BELOW the noteheads (away from stem)
            //         false → tie bows ABOVE (away from stem)
            // This matches engraving convention exactly as seen in printed scores.
            // drawTieCanvas — tapered bezier arc matching slur thickness.
            // stemUp=true → bows downward (away from stem); false → bows upward.
            // Touches notehead by using a tiny INS inset (not large gap).
            // drawTieCanvas — filled lens shape identical to VexFlow's Curve (slur).
            // Draws two bezier curves forming a closed path and fills it black.
            // This gives the same visual weight as the slur automatically.
            // bow: pixels of arc height (positive = curves down, negative = curves up)
            // depthFn: distance(px) -> depth(px) — ties and slurs are tuned
            // separately on purpose (see slurCurveDepth/tieCurveDepth above:
            // a tie is tight glue between two notes, a slur is a broader,
            // more graceful phrase arc), so this is a parameter rather than
            // hardcoded, letting both reuse the exact same clearance/inset
            // geometry instead of two separately-tuned (and previously
            // inconsistent) drawing paths.
            const drawTieCanvas = (
              x1,
              y1,
              x2,
              y2,
              stemUp,
              depthFn = tieCurveDepth,
            ) => {
              try {
                ctx.save();
                // Depth scales gently with distance between the two
                // noteheads (clamped) rather than a fixed 12px for every
                // tie regardless of how far apart the notes are.
                const dist = Math.abs(x2 - x1);
                const depth = depthFn(dist);
                const bow = stemUp ? depth : -depth; // arc direction and height
                // Small inset from the passed-in x1/x2 anchors. Reduced
                // from 3 to 1: x1/x2 are now VexFlow's own getTieRightX()/
                // getTieLeftX() notehead-edge anchors (see the TIES/SLURS
                // call sites), not a rough guess — so this only needs to
                // supply a hairline of clearance, not pull back a large,
                // separately-guessed offset on top of an already-guessed
                // anchor. A curve that reaches all the way to (or just
                // past) the notehead edge, the way real engraving software
                // draws it, needs this to stay small.
                const INS = 1;
                const lx1 = x1 + INS;
                const lx2 = x2 - INS;
                // Outer arc control points (the "outside" of the lens)
                const oc1x = lx1 + (lx2 - lx1) * 0.25;
                const oc1y = y1 + bow * 1.3;
                const oc2x = lx1 + (lx2 - lx1) * 0.75;
                const oc2y = y2 + bow * 1.3;
                // Inner arc control points (the "inside" — closer to baseline)
                // The distance between outer and inner determines thickness at peak
                const THICK = 4.0; // max thickness at centre in px
                const ic1y = oc1y - Math.sign(bow) * THICK;
                const ic2y = oc2y - Math.sign(bow) * THICK;

                ctx.beginPath();
                // Draw outer arc left→right
                ctx.moveTo(lx1, y1);
                ctx.bezierCurveTo(oc1x, oc1y, oc2x, oc2y, lx2, y2);
                // Draw inner arc right→left (closing the lens)
                ctx.bezierCurveTo(oc2x, ic2y, oc1x, ic1y, lx1, y1);
                ctx.closePath();
                ctx.fillStyle = "#1a1a1a";
                ctx.fill();
                ctx.restore();
              } catch (_) {}
            };

            // ── TIES ──────────────────────────────────────────────────────────
            // Pure canvas rendering — NO StaveTie used anywhere.
            // StaveTie was causing a spurious "U" bracket before the second note.
            // We draw a single tapered bezier: thin at endpoints, thicker in the middle.
            // The arc bows AWAY from the stem (stem up → bow downward; stem down → bow upward).

            renderSeq.forEach((seqNote, ni) => {
              if (!seqNote.tieStart || seqNote.isRest) return;

              const vfN = vfNotes[ni];
              let nx, ny, stemUp;
              try {
                // getTieRightX() is VexFlow's OWN canonical "where a tie/
                // slur should leave this notehead" anchor — it accounts
                // for notehead displacement (seconds/dyads) and any
                // modifier-context shift. The previous getAbsoluteX() +
                // guessed pixel offset didn't know about either, so it
                // landed short of (or past) the real notehead edge
                // depending on that particular note's glyph width —
                // exactly the "slur doesn't reach the note" symptom.
                nx = vfN.getTieRightX();
                ny = vfN.getYs()[0];
                stemUp = vfN.getStemDirection() === 1;
              } catch (_) {
                nx = colX[colInLine] + 30;
                ny = partY + STAFF_HEIGHT / 2;
                stemUp = true;
              }

              const targetIdx = renderSeq.findIndex(
                (n, i) => i > ni && !n.isRest && samePitch(seqNote, n),
              );

              let tx, ty;
              if (targetIdx >= 0) {
                try {
                  // getTieLeftX() — the mirrored canonical anchor for
                  // where an incoming tie/slur should land on this note.
                  tx = vfNotes[targetIdx].getTieLeftX();
                  ty = vfNotes[targetIdx].getYs()[0];
                } catch (_) {
                  tx = nx + 60;
                  ty = ny;
                }
              } else {
                // No same-pitch note in this bar: arc runs to right barline
                tx = x + width - 8;
                ty = ny;
              }

              drawTieCanvas(nx, ny, tx, ty, stemUp);
            });

            // Arriving arc removed — the departing arc from the previous bar
            // already crosses the barline. A second arriving arc causes a "U" shape.

            // ── SLURS ──────────────────────────────────────────────────────────
            // Slur: connects slurStart → slurEnd.
            // DEFAULT (no slurEnd set): connects to the VERY NEXT real note only.
            // With explicit slurEnd: connects slurStart → that specific note
            // (which may itself be a rest — a slur can explicitly anchor to
            // an empty beat, e.g. phrasing into a written rest).
            // Slur bows OPPOSITE to stem direction (same rule as ties).
            // Drawn with the SAME canvas bezier-lens shape as ties
            // (drawTieCanvas, with slurCurveDepth instead of tieCurveDepth
            // for the broader, more open arc a slur should have) instead of
            // VexFlow's own Curve class — Curve's default anchor points sit
            // essentially AT the notehead with no clearance, which is what
            // made a slur look like it touched the noteheads head-to-head
            // instead of curving cleanly beside them the way a tie already
            // does via drawTieCanvas's INS inset.
            //
            // Crossing a barline: mirrors the tie convention directly above
            // — renderSeq is scoped to ONE measure, so a slur whose end note
            // lives in a LATER measure will never be found by index here.
            // Rather than silently drawing nothing (the previous behavior),
            // draw a "departing" arc from the start note to this measure's
            // right edge, exactly like a tie does when its target isn't
            // found in-bar. The next measure draws no "arriving" stub for
            // the same reason ties don't: a second arc would create a "U"
            // shape at the barline instead of one continuous-looking curve.

            renderSeq.forEach((seqNote, ni) => {
              if (!seqNote.slurStart) return;

              // Find the end note:
              // Priority 1: explicit slurEnd mark on a later note (rests
              // allowed here — an explicit mark means the user really did
              // ask to slur into that empty beat).
              // Priority 2: NEXT real note only (not last note in bar!) —
              // rests excluded here since this is the SILENT default
              // behavior; auto-landing on a rest the user never marked
              // would be surprising, not helpful.
              let endIdx = renderSeq.findIndex((n, i) => i > ni && n.slurEnd);
              if (endIdx < 0) {
                endIdx = renderSeq.findIndex((n, i) => i > ni && !n.isRest);
              }

              const vfStart = vfNotes[ni];
              let nx, ny, stemUp;
              try {
                // Same canonical anchor as the tie fix above — see that
                // comment for why getAbsoluteX() + a guessed pixel offset
                // was landing short of the real notehead edge.
                nx = vfStart.getTieRightX();
                ny = vfStart.getYs()[0];
                stemUp = vfStart.getStemDirection() === 1;
              } catch (_) {
                nx = colX[colInLine] + 30;
                ny = partY + STAFF_HEIGHT / 2;
                stemUp = true;
              }

              if (endIdx < 0 || endIdx <= ni) {
                // No end note anywhere in this bar — the slur continues
                // into the next measure. Draw only the departing half.
                const tx = x + width - 8;
                drawTieCanvas(nx, ny, tx, ny, stemUp, slurCurveDepth);
                return;
              }

              let tx, ty;
              try {
                tx = vfNotes[endIdx].getTieLeftX();
                ty = vfNotes[endIdx].getYs()[0];
              } catch (_) {
                tx = nx + 60;
                ty = ny;
              }

              drawTieCanvas(nx, ny, tx, ty, stemUp, slurCurveDepth);
            });

            // ── MIXED NOTATION: sol-fa syllable above each note ────────────────
            // Purely a read-only display overlay — draws the sung tonic sol-fa
            // syllable above each note's attack, matching how real printed
            // choir scores in this tradition already look (sol-fa line above
            // the staff, notation, lyrics below). Reuses the EXACT
            // pitch→syllable math staffToSolfa.js uses for actual Score→Solfa
            // conversion, not a separate/simplified implementation, so what's
            // shown here always agrees with what a real conversion produces.
            if (score.showSolfaAbove) {
              // Uses the SAME conversion engine as the real "Convert to
              // Solfa" feature (convertMeasureToSolfaBeats, precomputed
              // for the whole part above) instead of a second, separately
              // hand-maintained rhythm/tie engine — so a tie across a
              // barline, a triplet, or an odd meter behaves exactly like
              // it already does in the Solfa app and in a converted score,
              // not like an approximation of it.
              const partSolfa = solfaByPart.get(part);
              const beats = partSolfa?.measuresBeats?.[col];

              if (beats) {
                const solfaY = partY - SP * -0.5;
                const solfaFont = `600 ${SP * 1.4}px Georgia, serif`;
                const rhythmFont = `600 ${SP * 1.1}px Georgia, serif`;
                // Octave number — sized relative to the main syllable the
                // same way SolfaRenderer sizes its own OCT_SZ relative to
                // its NOTE_SZ (8/14 of the main glyph).
                const octFont = `700 ${SP * 1.4 * (8 / 14)}px Georgia, serif`;

                const drawChar = (ch, cx, font, color) => {
                  if (cx == null) return;
                  try {
                    ctx.save();
                    ctx.font = font;
                    ctx.fillStyle = color;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "alphabetic";
                    ctx.fillText(ch, cx, solfaY);
                    ctx.restore();
                  } catch (_) {}
                };

                // ── Layout: a proportional grid, not note positions ──────
                // This mirrors SolfaRenderer's OWN layout algorithm exactly
                // (QW px per quarter-unit of duration, a beat separator of
                // fixed width, syllable centered within its own event's
                // width) rather than snapping each syllable to wherever
                // VexFlow happened to place the corresponding notehead.
                // That note-position approach was the earlier version of
                // this block — it produced visibly uneven spacing within a
                // beat whenever VexFlow's own optical spacing wasn't even,
                // which it usually isn't. Pass A below measures the row's
                // natural (unscaled) width the exact way SolfaRenderer's
                // own measureWidth() does; Pass B scales that to fit this
                // measure's real rendered width and draws left-to-right.
                const k = SP / 10; // same base-10 reference every other
                                   // SP-scaled constant in this file uses
                const QW_B = 9 * k, SEP_W_B = 10 * k, SYM_W_B = 5 * k, PAD_B = 8 * k;

                const sufFor = (ev, offset, duration, isLast) => {
                  if (ev?.tuplet) {
                    const end = offset + duration;
                    return end >= 4 - 0.01 || isLast ? "" : ",";
                  }
                  const end = offset + duration;
                  if (end >= 4 || isLast) return "";
                  if (duration === 3) return ".,";
                  if (duration === 2) return ".";
                  if (duration === 1) return ",";
                  return "";
                };

                // Pass A — intrinsic width at the base pixel scale.
                let intrinsicW = PAD_B * 2;
                beats.forEach((beat, bi) => {
                  const events = beat?.events || [];
                  let beatW = 0, offset = 0;
                  events.forEach((ev, ei) => {
                    const isRest = ev.type === "rest";
                    const isLast = ei === events.length - 1;
                    const suf = isRest ? "" : sufFor(ev, offset, ev.duration, ei === events.length - 1 ? true : isLast);
                    const octW = ev.type === "note" && ev.octave ? SYM_W_B * 1.1 : 0;
                    beatW += ev.duration * QW_B + octW + suf.length * SYM_W_B;
                    offset += ev.duration;
                  });
                  if (beatW === 0) beatW = QW_B * 4;
                  intrinsicW += beatW;
                  if (bi < beats.length - 1) intrinsicW += SEP_W_B;
                });

                const scale = Math.max(0.4, Math.min(3, (width - 6) / Math.max(intrinsicW, 1)));
                const QWs = QW_B * scale, SEPs = SEP_W_B * scale, SYMs = SYM_W_B * scale, PADs = PAD_B * scale;

                // Opening bar mark — an actual drawn line, matching how
                // SolfaRenderer itself draws bar lines (a stroke, not a
                // text "|" glyph, so it stays crisp at any size).
                try {
                  ctx.save();
                  ctx.strokeStyle = "#1a1a1a";
                  ctx.lineWidth = Math.max(1, SP * 0.08);
                  ctx.beginPath();
                  ctx.moveTo(x, solfaY - SP * 1.3);
                  ctx.lineTo(x, solfaY + SP * 0.5);
                  ctx.stroke();
                  ctx.restore();
                } catch (_) {}

                // Pass B — draw left-to-right from the measure's own X,
                // recording each event's center X for slurs afterward.
                let curX = x + PADs;
                const posCX = new Map();

                beats.forEach((beat, bi) => {
                  if (bi > 0) {
                    drawChar(":", curX + SEPs / 2, rhythmFont, "#4b5563");
                    curX += SEPs;
                  }
                  let offset = 0;
                  const events = beat?.events || [];
                  events.forEach((ev, ei) => {
                    const isLast = ei === events.length - 1;
                    const isRest = ev.type === "rest";
                    const suf = isRest ? "" : sufFor(ev, offset, ev.duration, isLast);
                    const bodyW = ev.duration * QWs;
                    const noteX = curX;
                    const noteCX = noteX + bodyW / 2;
                    posCX.set(`${bi}-${ei}`, noteCX);

                    // Extra width reserved to the right of the note when
                    // it carries an octave digit — without this, a suffix
                    // "." or the next event starts at noteX+bodyW exactly,
                    // which is where the digit ITSELF sits, so the dot
                    // lands jammed against (or under) the digit instead of
                    // after it. One digit's width is close enough for the
                    // single-digit octave counts this ever shows.
                    const octW = ev.type === "note" && ev.octave ? SYMs * 1.1 : 0;

                    if (ev.type === "note") {
                      drawChar(ev.syllable || "?", noteCX, solfaFont, "#1a1a1a");
                      // Octave NUMBER (not a dot) placed just after the
                      // letter's own width — superscript above the row
                      // for a higher octave, subscript below for a lower
                      // one. This is SolfaRenderer's exact convention
                      // (a digit counting how many octaves, not a dot
                      // per octave) — matches "s₁", "l₁", "t₁" etc. in
                      // the reference, not a stack of dots.
                      if (ev.octave) {
                        try {
                          ctx.save();
                          ctx.font = octFont;
                          ctx.fillStyle = "#1a1a1a";
                          ctx.textAlign = "left";
                          ctx.textBaseline = ev.octave > 0 ? "alphabetic" : "hanging";
                          const octY = ev.octave > 0 ? solfaY - SP * 0.55 : solfaY + SP * 0.1;
                          ctx.fillText(String(Math.abs(ev.octave)), noteX + bodyW, octY);
                          ctx.restore();
                        } catch (_) {}
                      }
                    } else if (ev.type === "sustain") {
                      drawChar("–", noteCX, solfaFont, "#1a1a1a");
                    }
                    // type === "rest" → blank, matches printed convention.

                    if (suf) {
                      drawChar(suf, noteX + bodyW + octW + (suf.length * SYMs) / 2, rhythmFont, "#4b5563");
                    }

                    curX += bodyW + octW + suf.length * SYMs;
                    offset += ev.duration;
                  });
                });

                // ── Slurs, shown as a phrase arc above the row too ──────
                // Ties are already the dash convention above — that IS
                // how tonic sol-fa marks a held note. A slur phrases
                // together notes of DIFFERENT pitch, so it gets its own
                // arc. Positions now come from the grid above (posCX),
                // not Score note X positions. Only drawn when both ends
                // fall in this same measure.
                for (const { startPos, endPos } of partSolfa.slurs) {
                  if (startPos.measureIdx !== col || endPos.measureIdx !== col) continue;
                  const sx = posCX.get(`${startPos.beatIdx}-${startPos.eventIdx}`);
                  const ex = posCX.get(`${endPos.beatIdx}-${endPos.eventIdx}`);
                  if (sx == null || ex == null || ex <= sx) continue;
                  const arcY = solfaY - SP * 0.9;
                  drawTieCanvas(sx, arcY, ex, arcY, false, () => SP * 0.6);
                }
              }
            }

            // Measure background zone — store actual note area X so cursor is accurate
            // VexFlow formats notes starting after the clef/key/time glyphs.
            // We store the first and last note X to get a precise mapping.
            const noteXPositions = [];
            vfNotes.forEach((vn) => {
              try {
                noteXPositions.push(vn.getAbsoluteX());
              } catch (_) {}
            });
            const firstNoteX = noteXPositions[0] ?? (isFirst ? x + 55 : x + 10);
            const lastNoteX =
              noteXPositions[noteXPositions.length - 1] ?? x + width - 20;
            // noteAreaStart: pixel X of beat 0 in this measure
            // noteAreaWidth: total pixel span of the note area
            const noteAreaStart = firstNoteX - 6;
            const noteAreaWidth = Math.max(20, x + width - 15 - noteAreaStart);

            // Store actual VexFlow staff line Y positions for pitch mapping
            let staveTopLineY = partY + 30; // fallback
            let staveLineSpacing = 10; // VexFlow default
            try {
              staveTopLineY = stave.getYForLine(0); // top line (line 0)
              const botLineY = stave.getYForLine(4); // bottom line (line 4)
              staveLineSpacing = (botLineY - staveTopLineY) / 4;
            } catch (_) {}

            // Where beat 1 and the end of the bar really are, for note placement
            // (the old noteAreaStart/Width stay as they were for dynamics etc.)
            let beat0X = firstNoteX + 5.5;
            let endX = x + width - 12;
            try {
              endX = stave.getNoteEndX() - 8;
            } catch (_) {}

            allZones.push({
              type: "measure",
              partId: part.id,
              measureIndex: col,
              x,
              y: partY,
              width,
              height: STAVE_HEIGHT,
              selected: isMeasureSel,
              beat0X,
              endX,
              noteAreaStart,
              noteAreaWidth,
              staveTopLineY, // actual pixel Y of top staff line
              staveLineSpacing, // pixel spacing between staff lines (usually 10)
            });

            // Beat at which each rendered event starts (for placement anchors)
            const noteStarts = [];
            {
              let acc = 0;
              renderSeq.forEach((n) => {
                noteStarts.push(acc);
                acc += noteDuration(n);
              });
            }

            // Per-note/rest zones — base notes AND individual chord note zones
            vfNotes.forEach((vfNote, ni) => {
              try {
                const nx = vfNote.getAbsoluteX();
                const seqNote = renderSeq[ni];

                // ── Hit zones, built from the REAL staff geometry ────────────
                // (They used to be a fixed box from the top of the system, which
                // only reached 2–3 spaces down the staff — a note on the lower
                // lines could not be grabbed at all.)
                //   rest        → the whole staff band
                //   note        → a box round its notehead AND stem
                //   chord tone  → a small box round its own notehead
                const lsU = staveLineSpacing;
                const topU = staveTopLineY;
                const clefKey = part.clef || "treble";
                const halfW = lsU * 1.4;
                const posOf = (pitch) => staffPosFromPitch(pitch, clefKey);
                const headY = (pitch) => yFromStaffPos(posOf(pitch), topU, lsU);

                let zoneY = topU - lsU * 0.5;
                let zoneH = lsU * 5;
                if (!seqNote.isRest && seqNote.pitch) {
                  const hy = headY(seqNote.pitch);
                  const up = stemUpForPos(posOf(seqNote.pitch));
                  zoneY = hy - (up ? lsU * 3.9 : lsU * 1.0);
                  zoneH = lsU * 4.9;
                }

                allZones.push({
                  type: seqNote.isRest ? "rest" : "note",
                  noteId: seqNote.id,
                  partId: part.id,
                  measureIndex: col,
                  x: nx + 5.5 - halfW,
                  y: zoneY,
                  width: halfW * 2,
                  height: zoneH,
                  selected: seqNote.id === selectedNoteId,
                  isRest: seqNote.isRest,
                  isBase: true,
                  beatStart: noteStarts[ni],
                  noteX: nx + 5.5, // centre of the notehead
                });

                // Individual chord-tone zones, each at its own pitch
                const chordCompanions = chordMap[seqNote.id] || [];
                chordCompanions.forEach((cn, ci) => {
                  const hy = cn.pitch ? headY(cn.pitch) : topU + ci * lsU;
                  allZones.push({
                    type: "note",
                    noteId: cn.id,
                    partId: part.id,
                    measureIndex: col,
                    x: nx + 5.5 - halfW,
                    y: hy - lsU * 0.8,
                    width: halfW * 2,
                    height: lsU * 1.6,
                    selected: cn.id === selectedNoteId,
                    isRest: false,
                    isChordNote: true,
                    baseNoteId: seqNote.id,
                    noteX: nx + 5.5,
                  });
                });
              } catch (_) {}
            });
          } catch (e) {
            console.warn(`Render err col=${col} part=${part.name}:`, e.message);
            allZones.push({
              type: "measure",
              partId: part.id,
              measureIndex: col,
              x,
              y: partY,
              width,
              height: STAVE_HEIGHT,
              selected: isMeasureSel,
            });
          }
        }
      });

      if (numParts > 1 && firstStave && lastStave) {
        try {
          new StaveConnector(firstStave, lastStave)
            .setType(StaveConnector.type.BRACKET)
            .setContext(ctx)
            .draw();
          new StaveConnector(firstStave, lastStave)
            .setType(StaveConnector.type.BRACE)
            .setContext(ctx)
            .draw();
        } catch (_) {}
      }
    }

    // Zones are measured in drawing units, but everything that uses them
    // (hit areas, the ghost note, highlights) is positioned in screen pixels.
    // At the default staff size the two are equal; at any other size they are
    // SCALE apart — so convert once, here.
    const GEOM = [
      "x", "y", "width", "height", "noteAreaStart", "noteAreaWidth",
      "staveTopLineY", "staveLineSpacing", "noteX", "beat0X", "endX",
    ];
    setZones(
      SCALE === 1
        ? allZones
        : allZones.map((z) => {
            const o = { ...z };
            for (const f of GEOM) if (typeof o[f] === "number") o[f] *= SCALE;
            return o;
          }),
    );
  }, [
    score,
    selectedMeasureIndex,
    selectedPartId,
    selectedNoteId,
    measuresPerLine,
    autoLayout,
    staffSize,
    barlines,
    rehearsalMarks,
  ]);

  useEffect(() => {
    render();
  }, [render]);

  // Re-render when the score-page card resizes (window resize, zoom, sidebar toggle)
  useEffect(() => {
    // Walk up to find the .score-page element
    let el = containerRef.current?.parentElement;
    while (el && !el.classList?.contains("score-page")) {
      el = el.parentElement;
    }
    if (!el) el = containerRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Small delay so layout has settled before we measure
      setTimeout(() => render(), 10);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [render]);

  const measureZones = zones.filter((z) => z.type === "measure");
  const noteZones = zones.filter((z) => z.type === "note" || z.type === "rest");

  // ── Playback cursor position calculation ──────────────────────────────────
  // Convert the fractional beat position into a pixel X coordinate by
  // finding which measure zone the beat falls in, then interpolating within it.
  // measureZones store the x/width of each bar — we match beat → column → x.
  // This runs on every render (cheap — just array lookups and arithmetic).
  const cursorStyle = (() => {
    if (playbackBeat === null || playbackBeat === undefined) return null;
    if (zones.length === 0) return null;

    // Beat counter: we need to know the beat START of each measure column
    // We derive this from score data (tempo doesn't affect pixel position)
    const { parts } = score;
    if (!parts.length) return null;

    // Build a map: measureIndex → { beatStart, totalBeats }
    let runningBeat = 0;
    const measureBeatMap = {};
    const numMeasures = Math.max(...parts.map((p) => p.measures.length), 0);
    for (let i = 0; i < numMeasures; i++) {
      const beats = measureCapacity(parts[0]?.measures[i]?.timeSignature);
      measureBeatMap[i] = { beatStart: runningBeat, totalBeats: beats };
      runningBeat += beats;
    }

    // Find which measure column the cursor is in
    let targetCol = numMeasures - 1;
    for (let i = 0; i < numMeasures; i++) {
      const { beatStart, totalBeats } = measureBeatMap[i];
      if (playbackBeat >= beatStart && playbackBeat < beatStart + totalBeats) {
        targetCol = i;
        break;
      }
    }

    const { beatStart, totalBeats } = measureBeatMap[targetCol] || {
      beatStart: 0,
      totalBeats: 4,
    };
    const fracWithinMeasure = Math.min(
      1,
      (playbackBeat - beatStart) / totalBeats,
    );

    // Find a zone for this column to get its x and width
    const zone = zones.find(
      (z) => z.type === "measure" && z.measureIndex === targetCol,
    );
    if (!zone) return null;

    // Pixel X: zone.x is the stave left edge; add clef/key/time glyph offset
    // The first measure has wider left margin (~55px for clef+key+time glyphs)
    const noteAreaStart = targetCol === 0 ? zone.x + 55 : zone.x + 10;
    const noteAreaWidth = zone.width - (targetCol === 0 ? 60 : 15);
    const cursorX = noteAreaStart + fracWithinMeasure * noteAreaWidth;

    return {
      position: "absolute",
      left: cursorX,
      top: zone.y - 8,
      width: 2,
      height: score.parts.length * 120 + 16, // span all parts
      background: "rgba(239, 68, 68, 0.85)", // red-500
      borderRadius: 1,
      pointerEvents: "none",
      zIndex: 20,
      boxShadow: "0 0 6px rgba(239,68,68,0.5)",
      transition: "left 0.05s linear", // smooth 50ms interpolation
    };
  })();

  // Follow playback — the page scrolls to keep the cursor in view once it
  // moves to a new system/row, matching SolfaRenderer's exact behavior
  // (see the comment there). Only scrolls on a row change (not every
  // frame within the same row), so it doesn't fight a manual scroll while
  // the cursor is just moving sideways across the current line.
  useEffect(() => {
    if (!cursorStyle) {
      lastScrollTopRef.current = null;
      return;
    }
    if (cursorStyle.top !== lastScrollTopRef.current) {
      lastScrollTopRef.current = cursorStyle.top;
      playbackCursorElRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  }, [cursorStyle?.top]);

  // ══ Note placement ═══════════════════════════════════════════════════════
  // One path for everything: pointer → local px (zoom-corrected) → staff →
  // staff position + beat → planPlacement (read-only) → ghost. Committing calls
  // the same plan through dropNoteAtBeat, so the ghost never lies.
  const computeCursor = useCallback(
    (e) => {
      const root = rootRef.current;
      if (!root || inputMode !== "note") return null;
      const { x, y } = pointerToLocal(e, root);

      const z = pickStaff(measureZones, x, y);
      if (!z) return null;
      const part = score.parts.find((p) => p.id === z.partId);
      const measure = part?.measures[z.measureIndex];
      if (!measure) return null;

      const clef = part.clef || "treble";
      const cap = measureCapacity(measure.timeSignature);
      const ls = z.staveLineSpacing || 10;
      const top = z.staveTopLineY;

      // Y → nearest line or space → pitch for THIS staff's clef
      const pos = Math.max(-10, Math.min(18, staffPosFromY(y, top, ls)));
      const pitch = pitchFromStaffPos(pos, clef);

      // X → beat, anchored on the REAL x of the notes already in the bar
      const real = noteZones
        .filter(
          (n) =>
            n.partId === z.partId &&
            n.measureIndex === z.measureIndex &&
            !n.isRest &&
            !n.isChordNote &&
            n.beatStart != null,
        )
        .map((n) => ({ beatStart: n.beatStart, x: n.noteX }));
      const anchors = buildBeatAnchors(
        z.beat0X ?? z.noteAreaStart,
        z.endX ?? z.noteAreaStart + z.noteAreaWidth,
        cap,
        real,
      );
      const beat = snapBeat(
        xToBeat(anchors, x),
        gridStepFor(selectedDuration),
        cap,
        real.map((r) => r.beatStart),
      );

      const plan = planPlacement(measure, beat, selectedDuration, selectedDots);
      const at = plan.ok ? plan.beat : beat;
      const keyAcc = keySignatureAccidentals(measure.keySignature ?? 0);

      return {
        partId: z.partId,
        measureIndex: z.measureIndex,
        zKey: `${z.partId}-${z.measureIndex}`,
        beat: at,
        pitch,
        pos,
        ls,
        top,
        ghostX: beatToX(anchors, at),
        ghostY: yFromStaffPos(pos, top, ls),
        keyAlter: keyAcc[pitch.step] || "",
        isChord: plan.ok && plan.kind === "chord",
        valid: plan.ok,
        clipped: !!plan.clipped,
        reason: plan.ok ? null : plan.reason,
      };
    },
    [inputMode, measureZones, noteZones, score, selectedDuration, selectedDots],
  );

  const sameCursor = (a, b) =>
    a === b ||
    (a &&
      b &&
      a.zKey === b.zKey &&
      a.beat === b.beat &&
      a.pos === b.pos &&
      a.valid === b.valid &&
      a.isChord === b.isChord &&
      a.ghostX === b.ghostX &&
      a.ghostY === b.ghostY);

  const showCursor = (c) => {
    if (sameCursor(c, cursorRef.current)) return;
    cursorRef.current = c;
    setCursor(c);
  };

  // Commit what the ghost shows. Invalid spots change nothing.
  const commitPlacement = (c) => {
    if (!c || !c.valid) return;
    dropNoteAtBeat(
      c.partId,
      c.measureIndex,
      c.pitch,
      selectedDuration,
      selectedDots,
      c.beat,
    );
  };

  const cancelInteractions = () => {
    gestureRef.current = null;
    noteDragRef.current = null;
    setPitchDrag(null);
    showCursor(null);
  };

  // Escape cancels a press, a pitch drag, and hides the ghost.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") cancelInteractions();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving note mode clears everything transient.
  useEffect(() => {
    if (inputMode !== "note") {
      gestureRef.current = null;
      showCursor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode]);

  // After the score re-lays out (a note was placed, duration changed, zoom…)
  // re-evaluate the ghost at the last pointer position so it never goes stale.
  useEffect(() => {
    if (inputMode !== "note" || !lastPtrRef.current) return;
    showCursor(computeCursor(lastPtrRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, selectedDuration, selectedDots, inputMode]);

  const handlePointerMove = (e) => {
    if (inputMode !== "note") return;
    lastPtrRef.current = { clientX: e.clientX, clientY: e.clientY };
    showCursor(computeCursor(e));
  };

  const handlePointerDown = (e) => {
    if (inputMode !== "note") return;
    if (e.pointerType === "mouse" && e.button !== 0) return; // primary only
    lastPtrRef.current = { clientX: e.clientX, clientY: e.clientY };
    showCursor(computeCursor(e));
    gestureRef.current = { pointerId: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault(); // no text selection / native drag while placing
  };

  // Release = commit at the RELEASE position. So both a plain click and a
  // press-drag-release place the note where the ghost was last shown; letting
  // go outside any staff places nothing.
  const handlePointerUp = (e) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    commitPlacement(computeCursor(e));
  };

  // ── Dragging an existing notehead: vertical = pitch only ──────────────────
  const handleNotePointerDown = (e, z) => {
    if (inputMode === "note" || z.isRest || z.isChordNote) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    selectNote(z.noteId, z.partId, z.measureIndex);
    noteDragRef.current = {
      noteId: z.noteId,
      partId: z.partId,
      measureIndex: z.measureIndex,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      last: null,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleNotePointerMove = (e) => {
    const d = noteDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4)
      return; // a click, not yet a drag
    d.moved = true;
    const mz = measureZones.find(
      (m) => m.partId === d.partId && m.measureIndex === d.measureIndex,
    );
    const root = rootRef.current;
    if (!mz || !root) return;
    const part = score.parts.find((p) => p.id === d.partId);
    const { x, y } = pointerToLocal(e, root);
    const ls = mz.staveLineSpacing || 10;
    const pos = Math.max(-10, Math.min(18, staffPosFromY(y, mz.staveTopLineY, ls)));
    const pitch = pitchFromStaffPos(pos, part?.clef || "treble");
    d.last = { pitch, pos };
    const nz = noteZones.find((n) => n.noteId === d.noteId);
    const target = e.altKey ? pickStaff(measureZones, x, y) : null;
    setPitchDrag({
      noteId: d.noteId,
      pitch,
      pos,
      ls,
      top: mz.staveTopLineY,
      ghostX: nz?.noteX ?? mz.beat0X,
      ghostY: yFromStaffPos(pos, mz.staveTopLineY, ls),
      moveTo:
        target &&
        (target.partId !== d.partId || target.measureIndex !== d.measureIndex)
          ? target
          : null,
    });
  };

  const handleNotePointerUp = (e) => {
    const d = noteDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    noteDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    setPitchDrag(null);
    if (!d.moved) return; // plain click: selection already happened
    if (e.altKey && rootRef.current) {
      // Alt-drag: move the note into the bar under the pointer
      const { x, y } = pointerToLocal(e, rootRef.current);
      const t = pickStaff(measureZones, x, y);
      if (t && (t.partId !== d.partId || t.measureIndex !== d.measureIndex)) {
        moveNote(d.noteId, d.partId, d.measureIndex, t.partId, t.measureIndex);
      }
      return;
    }
    if (d.last) setNotePitch(d.partId, d.measureIndex, d.noteId, d.last.pitch);
  };

  const handleNotePointerCancel = () => {
    noteDragRef.current = null;
    setPitchDrag(null);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "inline-block",
        minWidth: "100%",
        lineHeight: 0,
        cursor: inputMode === "note" ? "crosshair" : "default",
        // no scroll-by-touch / text selection fighting the placement gesture
        touchAction: inputMode === "note" ? "none" : "auto",
        userSelect: inputMode === "note" ? "none" : undefined,
        WebkitUserSelect: inputMode === "note" ? "none" : undefined,
      }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        gestureRef.current = null;
        showCursor(null);
      }}
      onPointerLeave={() => {
        if (inputMode === "note" && !gestureRef.current) {
          lastPtrRef.current = null;
          showCursor(null);
        }
      }}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (inputMode !== "note") return;
        if (e.key === "Enter" || e.key === " ") {
          if (!cursorRef.current) return;
          e.preventDefault();
          commitPlacement(cursorRef.current);
        }
      }}
    >
      <div ref={containerRef} style={{ display: "block" }} />

      {/* Measure zones — click a bar to select it (select mode only; in note
          mode the wrapper handles every pointer event). */}
      {measureZones.map((z) => {
        const zKey = `${z.partId}-${z.measureIndex}`;
        return (
          <div
            key={zKey}
            onClick={() => {
              if (inputMode !== "note") selectMeasure(z.partId, z.measureIndex);
            }}
            style={{
              position: "absolute",
              left: z.x,
              top: z.y - 10, // small margin for ledger-line clicks
              width: z.width,
              height: z.height + 32, // room below for ledger lines / octave markings
              cursor: inputMode === "note" ? "crosshair" : "pointer",
              borderRadius: 2,
              boxSizing: "border-box",
              border: "none",
              backgroundColor: "transparent",
              zIndex: inputMode === "note" ? 0 : 1,
              pointerEvents: inputMode === "note" ? "none" : "auto",
            }}
          />
        );
      })}

      {/* Visible selection highlight — hugs the staff plus room for ledger lines. */}
      {measureZones.map((z) => {
        const zKey = `${z.partId}-${z.measureIndex}`;
        const isMoveTarget =
          pitchDrag?.moveTo &&
          pitchDrag.moveTo.partId === z.partId &&
          pitchDrag.moveTo.measureIndex === z.measureIndex;
        if (inputMode === "note" || (!z.selected && !isMoveTarget)) return null;
        return (
          <div
            key={`hl-${zKey}`}
            style={{
              position: "absolute",
              left: z.x,
              top: z.y - 8,
              width: z.width,
              height: z.height + 28,
              borderRadius: 2,
              boxSizing: "border-box",
              pointerEvents: "none",
              zIndex: 2,
              border: isMoveTarget ? "2px dashed #c2410c" : "2px solid #1d4ed8",
              backgroundColor: isMoveTarget
                ? "rgba(194,65,12,0.10)"
                : "rgba(29,78,216,0.14)",
            }}
          />
        );
      })}

      {/* Ghost note while placing (note mode) */}
      {cursor && (
        <GhostNote
          x={cursor.ghostX}
          y={cursor.ghostY}
          pos={cursor.pos}
          ls={cursor.ls}
          top={cursor.top}
          duration={selectedDuration}
          dots={selectedDots}
          tone={!cursor.valid ? "invalid" : cursor.isChord ? "chord" : "ok"}
          showBeatGuide
          label={`${cursor.isChord ? "+" : ""}${cursor.pitch.step}${cursor.keyAlter}${cursor.pitch.octave}${selectedDots ? "." : ""}`}
          sub={
            cursor.valid
              ? `beat ${Math.round((cursor.beat + 1) * 100) / 100}${cursor.clipped ? " · shortened to fit" : ""}`
              : cursor.reason === "occupied"
                ? "occupied — pick an empty beat"
                : "no room here"
          }
        />
      )}

      {/* Ghost while dragging an existing notehead to a new pitch */}
      {pitchDrag && (
        <GhostNote
          x={pitchDrag.ghostX}
          y={pitchDrag.ghostY}
          pos={pitchDrag.pos}
          ls={pitchDrag.ls}
          top={pitchDrag.top}
          duration="q"
          dots={0}
          tone="drag"
          bare
          label={
            pitchDrag.moveTo
              ? "move to this bar"
              : `${pitchDrag.pitch.step}${pitchDrag.pitch.octave}`
          }
        />
      )}

      {/* Note / rest zones. In note mode they let every pointer event through
          to the wrapper (they used to swallow clicks, so nothing could be
          placed on a rest). In select mode: click selects, drag a note up or
          down to change its pitch (Alt-drag moves it to another bar). */}
      {noteZones.map((z) => (
        <div
          key={`n-${z.noteId}`}
          onPointerDown={(e) => handleNotePointerDown(e, z)}
          onPointerMove={handleNotePointerMove}
          onPointerUp={handleNotePointerUp}
          onPointerCancel={handleNotePointerCancel}
          onClick={(e) => {
            if (inputMode === "note") return;
            e.stopPropagation();
            selectNote(z.noteId, z.partId, z.measureIndex);
          }}
          title={
            z.isRest
              ? "Rest — click to select, then press A–G to fill"
              : z.isChordNote
                ? "Chord note — click to select, Del to remove from chord"
                : "Note — click to select · drag up/down to change pitch · Alt-drag to another bar"
          }
          style={{
            position: "absolute",
            left: z.x,
            top: z.y,
            width: z.width,
            height: z.height,
            cursor: z.isRest || z.isChordNote ? "pointer" : pitchDrag ? "ns-resize" : "grab",
            boxSizing: "border-box",
            zIndex: z.isChordNote ? 12 : 10,
            pointerEvents: inputMode === "note" ? "none" : "auto",
            touchAction: "none",
            // MuseScore-style selection: NO big box, just a subtle underline
            border: "none",
            borderBottom: z.selected
              ? z.isRest
                ? "2px solid #2563eb"
                : z.isChordNote
                  ? "2px solid #7c3aed"
                  : "2px solid #ea580c"
              : "none",
            backgroundColor: "transparent",
          }}
        />
      ))}
      {/* Playback cursor — red vertical line tracking beat position */}
      {cursorStyle && <div ref={playbackCursorElRef} style={cursorStyle} />}

      {/* ── Dynamics overlays ─────────────────────────────────────────── */}
      {dynamics.map((dyn) => {
        const z = measureZones.find(
          (mz) =>
            mz.partId === dyn.partId && mz.measureIndex === dyn.measureIndex,
        );
        if (!z) return null;
        const noteStart =
          z.noteAreaStart ?? (dyn.measureIndex === 0 ? z.x + 55 : z.x + 10);
        const noteWidth =
          z.noteAreaWidth ?? z.width - (dyn.measureIndex === 0 ? 60 : 15);
        const part = score.parts.find((p) => p.id === dyn.partId);
        const beats = measureCapacity(
          part?.measures[dyn.measureIndex]?.timeSignature,
        );
        const px = noteStart + (dyn.beat / beats) * noteWidth;
        const isSel =
          selectedMarking?.kind === "dynamic" && selectedMarking?.id === dyn.id;
        const lane = textLaneIndex.get(dyn.id) || 0;
        const realSP = z.height / 7;
        const fontSize = realSP * 2.0; // bigger, clearly legible
        const gap = aboveBelowGap(z.height);
        // "top" is the text box's TOP edge, and text renders DOWNWARD from
        // there — so clearing the staff requires offsetting by the text's own
        // height too, not just a small gap, or the glyph itself dips into the
        // staff even though its anchor point is numerically above it.
        const laneStep = fontSize + gap;
        return (
          <div
            key={dyn.id}
            onClick={(e) => {
              e.stopPropagation();
              selectMarking("dynamic", dyn.id);
            }}
            title="Click to select, then press Delete to remove"
            style={{
              position: "absolute",
              left: px - 8,
              top: z.y - gap - fontSize - lane * laneStep + 50,
              fontSize,
              fontStyle: "italic",
              fontFamily: "Times New Roman, serif",
              fontWeight: 800,
              color: "#1e293b",
              pointerEvents: "auto",
              cursor: "pointer",
              zIndex: 30,
              whiteSpace: "nowrap",
              userSelect: "none",
              padding: "1px 4px",
              borderRadius: 3,
              background: isSel ? "rgba(37,99,235,0.15)" : "transparent",
              outline: isSel ? "1.5px solid #2563eb" : "none",
            }}
          >
            {dyn.value}
          </div>
        );
      })}

      {/* ── Hairpin overlays (crescendo/decrescendo wedges) ────────────── */}
      {hairpins.map((hp) => {
        const z1 = measureZones.find(
          (mz) =>
            mz.partId === hp.partId && mz.measureIndex === hp.startMeasure,
        );
        const z2 =
          measureZones.find(
            (mz) =>
              mz.partId === hp.partId && mz.measureIndex === hp.endMeasure,
          ) || z1;
        if (!z1) return null;
        const beatToX = (z, beat) => {
          const ns = z.measureIndex === 0 ? z.x + 55 : z.x + 10;
          const nw = z.width - (z.measureIndex === 0 ? 60 : 15);
          const part = score.parts.find((p) => p.id === hp.partId);
          const beats = measureCapacity(
            part?.measures[z.measureIndex]?.timeSignature,
          );
          return ns + (beat / beats) * nw;
        };
        const x1 = beatToX(z1, hp.startBeat);
        const x2 = beatToX(z2, hp.endBeat);
        const realSP = z1.height / 7;
        const fontSize = realSP * -4.0;
        const gap = aboveBelowGap(z1.height); // consistent clearance from staff
        const y = z1.y - gap - fontSize; // directly above staff (no stacking with dynamics)
        const mid = realSP * 0.45;
        const isC = hp.type === "cresc";
        const isSel =
          selectedMarking?.kind === "hairpin" && selectedMarking?.id === hp.id;
        // Draw SVG wedge inline
        const d = isC
          ? `M ${x1} ${y} L ${x2} ${y - mid} M ${x1} ${y} L ${x2} ${y + mid}`
          : `M ${x1} ${y - mid} L ${x2} ${y} M ${x1} ${y + mid} L ${x2} ${y}`;
        return (
          <svg
            key={hp.id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 30,
              overflow: "visible",
            }}
          >
            {/* Wide invisible path for easy clicking */}
            <path
              d={d}
              stroke="transparent"
              strokeWidth="14"
              fill="none"
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                selectMarking("hairpin", hp.id);
              }}
            />
            <path
              d={d}
              stroke={isSel ? "#2563eb" : "#1e293b"}
              strokeWidth={(isSel ? 3.4 : 3) * (realSP / 14)}
              fill="none"
            />
          </svg>
        );
      })}

      {/* ── Octave line overlays (8va / 8vb) ─────────────────────────────── */}
      {octaveLines.map((ol) => {
        const z1 = measureZones.find(
          (mz) =>
            mz.partId === ol.partId && mz.measureIndex === ol.startMeasure,
        );
        const z2 =
          measureZones.find(
            (mz) =>
              mz.partId === ol.partId && mz.measureIndex === ol.endMeasure,
          ) || z1;
        if (!z1) return null;
        const x1 = z1.noteAreaStart ?? z1.x;
        const x2 = (z2.noteAreaStart ?? z2.x) + (z2.noteAreaWidth ?? z2.width);
        const isAbove = ol.type === "8va";
        const realSP = z1.height / 7;
        const fontSize = realSP * 2.6;
        const lineGap = aboveBelowGap(z1.height); // clearance between dashed line and staff
        // z1.height is the oversized click-zone, NOT the real staff height.
        // Real staff is exactly 4/7 of click-zone height (STAFF_HEIGHT / STAVE_HEIGHT).
        const realStaffBottom = z1.y + z1.height * (4 / 3.5);
        // Dashed line positioned directly above (8va) or below (8vb) the staff
        const lineY = isAbove ? z1.y - lineGap : realStaffBottom + lineGap;
        // Text sits on the far side of the line from the staff
        const textTop = isAbove ? lineY - fontSize : lineY;
        const isSel =
          selectedMarking?.kind === "octaveLine" &&
          selectedMarking?.id === ol.id;
        const color = isSel ? "#2563eb" : "#1e293b";
        return (
          <div
            key={ol.id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              pointerEvents: "none",
              zIndex: 30,
            }}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                selectMarking("octaveLine", ol.id);
              }}
              title="Click to select, then press Delete to remove"
              style={{
                position: "absolute",
                left: x1,
                top: textTop,
                fontSize,
                fontStyle: "italic",
                fontFamily: "Times New Roman, serif",
                fontWeight: 800,
                color,
                whiteSpace: "nowrap",
                pointerEvents: "auto",
                cursor: "pointer",
                padding: "0 3px",
                background: isSel ? "rgba(37,99,235,0.15)" : "transparent",
                borderRadius: 3,
              }}
            >
              {ol.type}
            </div>
            <svg
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                overflow: "visible",
              }}
              width="1"
              height="1"
            >
              <line
                x1={x1 + 26 * (realSP / 14)}
                y1={lineY}
                x2={x2}
                y2={lineY}
                stroke={color}
                strokeWidth={1.6 * (realSP / 14)}
                strokeDasharray="4,3"
              />
              <line
                x1={x2}
                y1={lineY}
                x2={x2}
                y2={lineY + (isAbove ? 6 : -6) * (realSP / 14)}
                stroke={color}
                strokeWidth={1.6 * (realSP / 14)}
              />
            </svg>
          </div>
        );
      })}

      {/* ── Staff text overlays ────────────────────────────────────────── */}
      {(score.staffTexts || EMPTY_ARR).map((st) => {
        const z = measureZones.find(
          (mz) =>
            mz.partId === st.partId && mz.measureIndex === st.measureIndex,
        );
        if (!z) return null;
        const ns = z.measureIndex === 0 ? z.x + 55 : z.x + 10;
        const nw = z.width - (z.measureIndex === 0 ? 60 : 15);
        const part = score.parts.find((p) => p.id === st.partId);
        const beats = measureCapacity(
          part?.measures[st.measureIndex]?.timeSignature,
        );
        const px = ns + (st.beat / beats) * nw;
        const isSel =
          selectedMarking?.kind === "staffText" &&
          selectedMarking?.id === st.id;
        const lane = textLaneIndex.get(st.id) || 0;
        const realSP = z.height / 7;
        const fontSize = realSP * 2.0;
        const gap = aboveBelowGap(z.height);
        const laneStep = fontSize + gap - 15;
        return (
          <div
            key={st.id}
            onClick={(e) => {
              e.stopPropagation();
              selectMarking("staffText", st.id);
            }}
            title="Click to select, then press Delete to remove"
            style={{
              position: "absolute",
              left: px,
              top: z.y - gap - fontSize - lane * laneStep + 50,
              fontSize,
              fontFamily: "Times New Roman, serif",
              fontWeight: 800,
              color: isSel ? "#2563eb" : "#374151",
              pointerEvents: "auto",
              cursor: "pointer",
              zIndex: 30,
              whiteSpace: "nowrap",
              fontStyle: "italic",
              padding: "1px 4px",
              borderRadius: 3,
              background: isSel ? "rgba(37,99,235,0.15)" : "transparent",
              outline: isSel ? "1.5px solid #2563eb" : "none",
            }}
          >
            {st.text}
          </div>
        );
      })}
    </div>
  );
}