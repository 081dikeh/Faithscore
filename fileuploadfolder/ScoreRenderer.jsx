// src/components/ScoreRenderer/index.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Annotation,
  StaveConnector,
  Dot,
  Beam,
  StaveTie,
  Curve,
  Tuplet,
} from "vexflow";
import {
  useScoreStore,
  DURATION_BEATS,
  noteDuration,
} from "../../store/scoreStore";

const MEASURES_PER_LINE = 5;

// SP = pixels per staff space. Increase to make everything bigger, decrease for smaller.
// 10 = compact, 12 = medium, 14 = large, 16 = very large
const SP = 14;

const STAFF_HEIGHT = SP * 4; // 48px — full staff (4 spaces between 5 lines)
const PART_HEIGHT = SP * 9; // 108px — staff + gap to next staff in system
const SYSTEM_GAP = SP * 8; // 96px — gap between rows of systems
const STAVE_TOP = SP * 3; // 36px — top margin
const STAVE_HEIGHT = STAFF_HEIGHT + SP * 3; // 84px — click zone includes ledger lines

// Middle of staff for rests — VexFlow places rest glyph at this key position.
// Bass clef lines (bottom→top): G2 B2 D3 F3 A3 — middle line = D3
// Treble clef lines (bottom→top): E4 G4 B4 D5 F5 — middle line = B4
const REST_KEY = { treble: "b/4", bass: "d/3" };

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

function buildVfNote(n, clef, isSelected, chordExtras = []) {
  const restKey = REST_KEY[clef] || "b/4";
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
    if (nn.pitch?.accidental)
      sn.addModifier(new Accidental(nn.pitch.accidental), ki);
  });

  if (n.lyric) {
    sn.addModifier(
      new Annotation(n.lyric)
        .setVerticalJustification(Annotation.VerticalJustify.BOTTOM)
        .setFont("serif", 11),
    );
  }
  return sn;
}

export default function ScoreRenderer() {
  const containerRef = useRef(null);
  const [zones, setZones] = useState([]);
  const [dragState, setDragState] = useState(null); // existing-note drag (move)
  const [dropTarget, setDropTarget] = useState(null); // drop highlight key
  // cursor: tracks mouse position in note mode — the "ghost note" that follows the cursor
  // { partId, measureIndex, zKey, beat, pitch, ghostX, ghostY, isChord }
  const [cursor, setCursor] = useState(null);
  const cursorRef = useRef(null); // always-fresh cursor for click handler

  const score = useScoreStore((s) => s.score);
  const selectedMeasureIndex = useScoreStore((s) => s.selectedMeasureIndex);
  const selectedPartId = useScoreStore((s) => s.selectedPartId);
  const selectedNoteId = useScoreStore((s) => s.selectedNoteId);
  const selectMeasure = useScoreStore((s) => s.selectMeasure);
  const selectNote = useScoreStore((s) => s.selectNote);
  const moveNote = useScoreStore((s) => s.moveNote);
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
  const staffSize = useScoreStore((s) => s.staffSize ?? 10);
  const dynamics = useScoreStore((s) => s.score.dynamics || []);
  const hairpins = useScoreStore((s) => s.score.hairpins || []);
  const rehearsalMarks = useScoreStore((s) => s.score.rehearsalMarks || []);

  const render = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    // Dynamic layout values from store (user-adjustable in Layout tab)
    // ── Dynamic layout constants ─────────────────────────────────────────────
    const SP = staffSize;
    const STAFF_HEIGHT = SP * 4;
    const PART_HEIGHT = SP * 9;
    const SYSTEM_GAP = SP * 8;
    const STAVE_TOP = SP * 3;
    const STAVE_HEIGHT = STAFF_HEIGHT + SP * 3;
    const LEFT_MARGIN = 20;
    const RIGHT_MARGIN = 20;

    const numParts = score.parts.length;
    const totalCols = Math.max(...score.parts.map((p) => p.measures.length), 1);
    const systemH = numParts * PART_HEIGHT + SYSTEM_GAP;

    // ── Measure width calculation ─────────────────────────────────────────────
    // Compute minimum pixel width for each measure based on content density.
    // This is the core of the dynamic layout — denser measures get more space.
    const NOTE_PX = {
      w: SP * 5,
      h: SP * 4,
      q: SP * 3,
      8: SP * 2.5,
      16: SP * 2,
      32: SP * 1.8,
      64: SP * 1.6,
    };
    const MIN_MEASURE_WIDTH = SP * 8; // absolute minimum (very sparse measures)
    const MAX_MEASURE_WIDTH = SP * 40; // absolute maximum (very dense measures)

    function getMeasureContentWidth(colIdx) {
      let maxNotePx = 0;
      for (const part of score.parts) {
        const m = part.measures[colIdx];
        if (!m) continue;
        const nonChord = m.notes.filter((n) => !n.chordWith);
        const notePx = nonChord.reduce((sum, n) => {
          const px = NOTE_PX[n.duration] || SP * 3;
          return (
            sum + px + (n.dots ? SP : 0) + (n.pitch?.accidental ? SP * 0.8 : 0)
          );
        }, 0);
        if (notePx > maxNotePx) maxNotePx = notePx;
      }
      return Math.max(
        MIN_MEASURE_WIDTH,
        Math.min(MAX_MEASURE_WIDTH, maxNotePx),
      );
    }

    // First-measure overhead: clef + key sig + time sig
    function getGlyphOverhead(colIdx, isFirstInLine) {
      if (!isFirstInLine) return SP * 2;
      const keySig = score.parts[0]?.measures[colIdx]?.keySignature ?? 0;
      return SP * 3 + Math.abs(keySig) * SP + SP * 2 + SP;
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
      const preferredMax = measuresPerLine; // soft limit from store

      for (let c = lineStart; c < totalCols; c++) {
        const isFirst = colCount === 0;
        const overhead = getGlyphOverhead(c, isFirst);
        const content = getMeasureContentWidth(c);
        const needed = overhead + content + SP * 2;

        // Hard break: adding this measure would exceed usable width
        if (colCount > 0 && lineWidth + needed > USABLE_W + SP * 4) break;
        // Soft break: reached preferred bars-per-line
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
    const canvasH = totalLines * systemH + 80; // actual SVG pixel height

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

    // Inside the drawing loop, use DRAW_W as the effective page width
    // so staves span the full width of the scaled coordinate space
    // EFFECTIVE_W replaced by USABLE_W in dynamic layout

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
        return overhead + content + SP * 2;
      });

      // Justify: scale widths proportionally to fill full usable width
      const totalMinW = colMinWidths.reduce((a, b) => a + b, 0);
      const isLastLine = lineIdx === totalLines - 1;
      // Last line: don't stretch — leave natural spacing
      const justifyScale =
        !isLastLine && totalMinW < USABLE_W ? USABLE_W / totalMinW : 1;
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
        const partY = sysY + pIdx * PART_HEIGHT;
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
            stave.addKeySignature(keyNumToVexflow(measure.keySignature ?? 0));
            if (pIdx === 0)
              stave.addTimeSignature(
                `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`,
              );
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
            const vfNotes = renderSeq.map((n) =>
              buildVfNote(
                n,
                clef,
                n.id === selectedNoteId,
                chordMap[n.id] || [],
              ),
            );

            const voice = new Voice({
              num_beats: measure.timeSignature.beats,
              beat_value: measure.timeSignature.beatType,
            }).setStrict(false);
            voice.addTickables(vfNotes);
            // Formatter width = stave width minus glyph overhead.
            // getGlyphOverhead() accounts for clef + key sig accidentals + time sig.
            const glyphOverhead = getGlyphOverhead(col, isFirst);
            const formatterWidth = Math.max(40, width - glyphOverhead);
            new Formatter().joinVoices([voice]).format([voice], formatterWidth);

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
            // Our buildVfNote already set stem_direction correctly per engraving rules.
            // We pass auto_stem:false so generateBeams respects our explicit stem dirs.
            // Flag transparency is set BEFORE voice.draw() to suppress individual flags.
            let beamGroups = [];
            try {
              const beamable = vfNotes.filter((n) => {
                try {
                  const dur = n.getDuration();
                  return (
                    (dur === "8" ||
                      dur === "16" ||
                      dur === "32" ||
                      dur === "64") &&
                    !n.isRest?.()
                  );
                } catch (_) {
                  return false;
                }
              });
              if (beamable.length > 0) {
                beamGroups = Beam.generateBeams(beamable, {
                  auto_stem: false, // respect our pre-calculated stem directions
                  beam_rests: false,
                  show_stemlets: false,
                });
                beamGroups.forEach((beam) => {
                  beam.getNotes().forEach((note) => {
                    try {
                      // Hide flag so beam line replaces it (not both drawn)
                      note.setFlagStyle({
                        fillStyle: "transparent",
                        strokeStyle: "transparent",
                      });
                    } catch (_) {}
                  });
                });
              }
            } catch (_) {}

            voice.draw(ctx, stave);
            beamGroups.forEach((b) => {
              try {
                b.setContext(ctx).draw();
              } catch (_) {}
            });

            // ── Articulations ────────────────────────────────────────────────
            // Draw articulation marks above/below noteheads using canvas primitives.
            // VexFlow 4's Articulation import is unreliable across builds, so we
            // draw directly on the canvas for maximum compatibility.
            try {
              renderSeq.forEach((seqNote, ni) => {
                if (!seqNote.articulation || seqNote.isRest) return;
                const vfNote = vfNotes[ni];
                const nx = vfNote.getAbsoluteX() + 4;
                const ny = partY + STAFF_HEIGHT / 2;

                ctx.save();
                ctx.setFont("Times New Roman", 12);
                ctx.setFillStyle("#1e293b");

                const art = seqNote.articulation;
                // Place above staff
                const ay = partY - 8;

                if (art === "staccato") {
                  ctx.beginPath();
                  ctx.arc(nx, ay, 2.5, 0, Math.PI * 2);
                  ctx.fill();
                } else if (art === "tenuto") {
                  ctx.fillRect(nx - 6, ay, 12, 2);
                } else if (art === "accent") {
                  ctx.font = "bold 14px serif";
                  ctx.fillText(">", nx - 6, ay + 4);
                } else if (art === "marcato") {
                  ctx.font = "bold 12px serif";
                  ctx.fillText("^", nx - 4, ay);
                } else if (art === "fermata") {
                  ctx.font = "16px serif";
                  ctx.fillText("𝄐", nx - 6, ay);
                } else if (art === "trill") {
                  ctx.font = "italic bold 11px serif";
                  ctx.fillText("tr", nx - 4, ay);
                } else if (art === "mordent") {
                  ctx.font = "13px serif";
                  ctx.fillText("𝆁", nx - 4, ay);
                } else if (art === "turn") {
                  ctx.font = "13px serif";
                  ctx.fillText("𝆃", nx - 4, ay);
                } else if (art === "staccatissimo") {
                  ctx.beginPath();
                  ctx.moveTo(nx, ay - 4);
                  ctx.lineTo(nx - 3, ay + 2);
                  ctx.lineTo(nx + 3, ay + 2);
                  ctx.closePath();
                  ctx.fill();
                } else if (art === "portato") {
                  ctx.fillRect(nx - 6, ay + 2, 12, 2);
                  ctx.beginPath();
                  ctx.arc(nx, ay - 3, 2, 0, Math.PI * 2);
                  ctx.fill();
                } else if (art === "harmonic") {
                  ctx.strokeStyle = "#1e293b";
                  ctx.lineWidth = 1.2;
                  ctx.beginPath();
                  ctx.arc(nx, ay, 4, 0, Math.PI * 2);
                  ctx.stroke();
                } else if (art === "snap-pizz") {
                  ctx.font = "12px serif";
                  ctx.fillText("⊙", nx - 5, ay + 4);
                }
                ctx.restore();
              });
            } catch (_) {}

            // ── Tuplet brackets ─────────────────────────────────────────────
            // Group triplet notes by their tripletGroupId and draw Tuplet bracket
            try {
              const tripletGroups = {};
              renderSeq.forEach((seqNote, ni) => {
                if (!seqNote.triplet || !seqNote.tripletGroupId) return;
                if (!tripletGroups[seqNote.tripletGroupId])
                  tripletGroups[seqNote.tripletGroupId] = [];
                tripletGroups[seqNote.tripletGroupId].push({
                  note: vfNotes[ni],
                  seqNote,
                });
              });
              Object.values(tripletGroups).forEach((group) => {
                if (group.length < 2) return;
                const tupletNotes = group.map((g) => g.note);
                const tuplet = new Tuplet(tupletNotes, {
                  num_notes: 3,
                  notes_occupied: 2,
                  ratioed: false,
                  bracketed: true,
                  location: Tuplet.LOCATION_TOP,
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
            const drawTieCanvas = (x1, y1, x2, y2, stemUp) => {
              try {
                ctx.save();
                const bow = stemUp ? 12 : -12; // arc direction and height
                const INS = 3; // inset so arc starts near notehead center
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
                nx = vfN.getAbsoluteX();
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
                  tx = vfNotes[targetIdx].getAbsoluteX();
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

              // Anchor: right edge of notehead → left edge of target notehead
              // nx is getAbsoluteX() (left of notehead) so add ~6px for right edge
              drawTieCanvas(nx + 6, ny, tx - 2, ty, stemUp);
            });

            // Arriving arc removed — the departing arc from the previous bar
            // already crosses the barline. A second arriving arc causes a "U" shape.

            // ── SLURS ──────────────────────────────────────────────────────────
            // Slur: connects slurStart → slurEnd.
            // DEFAULT (no slurEnd set): connects to the VERY NEXT real note only.
            // With explicit slurEnd: connects slurStart → that specific note.
            // Slur bows OPPOSITE to stem direction (same rule as ties).
            // Uses Curve from VexFlow for proper engraving-quality arc.

            renderSeq.forEach((seqNote, ni) => {
              if (!seqNote.slurStart || seqNote.isRest) return;

              // Find the end note:
              // Priority 1: explicit slurEnd mark on a later note
              // Priority 2: NEXT real note only (not last note in bar!)
              let endIdx = renderSeq.findIndex(
                (n, i) => i > ni && n.slurEnd && !n.isRest,
              );
              if (endIdx < 0) {
                // Default: just the NEXT real note
                endIdx = renderSeq.findIndex((n, i) => i > ni && !n.isRest);
              }
              if (endIdx < 0 || endIdx <= ni) return;

              // Get stem directions for arc orientation
              let stemUp = true;
              try {
                stemUp = vfNotes[ni].getStemDirection() === 1;
              } catch (_) {}
              // Slur bows OPPOSITE to stem: stem up → slur below; stem down → slur above
              const cpY = stemUp ? 20 : -20;

              try {
                new Curve(vfNotes[ni], vfNotes[endIdx], {
                  cps: [
                    { x: 0, y: cpY },
                    { x: 0, y: cpY },
                  ],
                })
                  .setContext(ctx)
                  .draw();
              } catch (_) {
                // Canvas fallback
                let sx1, sx2, sy1, sy2;
                try {
                  sx1 = vfNotes[ni].getAbsoluteX() + 4;
                  sy1 = vfNotes[ni].getYs()[0];
                } catch (_) {
                  sx1 = x + 20;
                  sy1 = partY + STAFF_HEIGHT / 2;
                }
                try {
                  sx2 = vfNotes[endIdx].getAbsoluteX() - 4;
                  sy2 = vfNotes[endIdx].getYs()[0];
                } catch (_) {
                  sx2 = x + 80;
                  sy2 = sy1;
                }
                try {
                  ctx.save();
                  const ey = stemUp
                    ? Math.max(sy1, sy2) + 16
                    : Math.min(sy1, sy2) - 16;
                  ctx.beginPath();
                  ctx.moveTo(sx1, sy1);
                  ctx.bezierCurveTo(
                    sx1 + (sx2 - sx1) * 0.3,
                    ey,
                    sx1 + (sx2 - sx1) * 0.7,
                    ey,
                    sx2,
                    sy2,
                  );
                  ctx.strokeStyle = "#1a1a1a";
                  ctx.lineWidth = 1.6;
                  ctx.lineCap = "round";
                  ctx.stroke();
                  // Inner curve for thickness
                  ctx.beginPath();
                  const ey2 = stemUp ? ey - 5 : ey + 5;
                  ctx.moveTo(sx1, sy1);
                  ctx.bezierCurveTo(
                    sx1 + (sx2 - sx1) * 0.3,
                    ey2,
                    sx1 + (sx2 - sx1) * 0.7,
                    ey2,
                    sx2,
                    sy2,
                  );
                  ctx.lineWidth = 0.8;
                  ctx.stroke();
                  ctx.restore();
                } catch (_) {}
              }
            });

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

            allZones.push({
              type: "measure",
              partId: part.id,
              measureIndex: col,
              x,
              y: partY,
              width,
              height: STAVE_HEIGHT,
              selected: isMeasureSel,
              noteAreaStart,
              noteAreaWidth,
              staveTopLineY, // actual pixel Y of top staff line
              staveLineSpacing, // pixel spacing between staff lines (usually 10)
            });

            // Per-note/rest zones — base notes AND individual chord note zones
            vfNotes.forEach((vfNote, ni) => {
              try {
                const nx = vfNote.getAbsoluteX();
                const seqNote = renderSeq[ni];

                // Base note / rest zone (full height — click anywhere on the column)
                allZones.push({
                  type: seqNote.isRest ? "rest" : "note",
                  noteId: seqNote.id,
                  partId: part.id,
                  measureIndex: col,
                  x: nx - 10,
                  y: partY + 2,
                  width: 28,
                  height: STAVE_HEIGHT - 4,
                  selected: seqNote.id === selectedNoteId,
                  isRest: seqNote.isRest,
                  isBase: true,
                });

                // Individual chord note zones — smaller, Y-positioned by pitch
                // so each note in the chord is independently clickable
                const chordCompanions = chordMap[seqNote.id] || [];
                chordCompanions.forEach((cn, ci) => {
                  // Estimate Y from pitch: map pitch to staff position
                  // Higher pitch = lower Y (higher on screen)
                  // We space chord zones evenly within the note column
                  const TREBLE_ORDER = [
                    "C4",
                    "D4",
                    "E4",
                    "F4",
                    "G4",
                    "A4",
                    "B4",
                    "C5",
                    "D5",
                    "E5",
                    "F5",
                    "G5",
                    "A5",
                    "B5",
                  ];
                  const BASS_ORDER = [
                    "C2",
                    "D2",
                    "E2",
                    "F2",
                    "G2",
                    "A2",
                    "B2",
                    "C3",
                    "D3",
                    "E3",
                    "F3",
                    "G3",
                    "A3",
                    "B3",
                  ];
                  const order = clef === "bass" ? BASS_ORDER : TREBLE_ORDER;
                  const pitchKey = cn.pitch
                    ? `${cn.pitch.step}${cn.pitch.octave}`
                    : "";
                  const pitchIdx = order.indexOf(pitchKey);
                  // Y position: higher pitch → closer to top of staff
                  const staffH = STAVE_HEIGHT - 8;
                  const noteY =
                    pitchIdx >= 0
                      ? partY +
                        staffH -
                        (pitchIdx / (order.length - 1)) * staffH
                      : partY + 20 + ci * 14; // fallback: stack evenly

                  allZones.push({
                    type: "note",
                    noteId: cn.id,
                    partId: part.id,
                    measureIndex: col,
                    x: nx - 10,
                    y: Math.max(partY + 2, noteY - 8),
                    width: 28,
                    height: 16, // small zone — just around this pitch
                    selected: cn.id === selectedNoteId,
                    isRest: false,
                    isChordNote: true,
                    baseNoteId: seqNote.id,
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

    setZones(allZones);
  }, [
    score,
    selectedMeasureIndex,
    selectedPartId,
    selectedNoteId,
    measuresPerLine,
    staffSize,
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
      const beats = parts[0]?.measures[i]?.timeSignature?.beats ?? 4;
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

  // ── Shared pitch/beat calculation helpers (used by both mousemove and zone handlers)
  const computeCursorFromEvent = useCallback(
    (e) => {
      if (inputMode !== "note") return null;
      const container = containerRef.current?.parentElement;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Find which measure zone the mouse is over
      // Zone height is visually expanded for ledger lines, so check with 30px padding
      const z = measureZones.find(
        (mz) =>
          mouseX >= mz.x &&
          mouseX <= mz.x + mz.width &&
          mouseY >= mz.y - 30 &&
          mouseY <= mz.y + mz.height + 30,
      );
      if (!z) return null;

      const part = score.parts.find((p) => p.id === z.partId);
      const clef = part?.clef || "treble";
      const beats = part?.measures[z.measureIndex]?.timeSignature?.beats ?? 4;

      // X → beat using actual note area coordinates stored in the zone
      const noteStart =
        z.noteAreaStart ?? (z.measureIndex === 0 ? z.x + 55 : z.x + 10);
      const noteWidth =
        z.noteAreaWidth ?? z.width - (z.measureIndex === 0 ? 60 : 15);
      const frac = Math.max(0, Math.min(1, (mouseX - noteStart) / noteWidth));
      const rawBeat = frac * beats;
      const beat = Math.round(rawBeat / 0.25) * 0.25;

      // Y → pitch using actual stave coordinates stored during rendering
      // staveTopLineY = pixel Y of the top staff line (F5 treble / A3 bass)
      // staveLineSpacing = pixels between lines (typically 10px)
      // Each staff position (line OR space) = staveLineSpacing / 2 pixels
      const topLineY = z.staveTopLineY ?? z.y + (staffSize ?? 10);
      const lineSpacing = z.staveLineSpacing ?? staffSize ?? 10;
      const posSpacing = lineSpacing / 2; // pixels per staff position (5px normally)
      const rawPos = (mouseY - topLineY) / posSpacing;
      const pos = Math.max(-6, Math.min(14, Math.round(rawPos)));

      const TREBLE_POS = [
        { s: "E", o: 6 },
        { s: "D", o: 6 },
        { s: "C", o: 6 },
        { s: "B", o: 5 },
        { s: "A", o: 5 },
        { s: "G", o: 5 },
        { s: "F", o: 5 },
        { s: "E", o: 5 },
        { s: "D", o: 5 },
        { s: "C", o: 5 },
        { s: "B", o: 4 },
        { s: "A", o: 4 },
        { s: "G", o: 4 },
        { s: "F", o: 4 },
        { s: "E", o: 4 },
        { s: "D", o: 4 },
        { s: "C", o: 4 },
        { s: "B", o: 3 },
        { s: "A", o: 3 },
        { s: "G", o: 3 },
        { s: "F", o: 3 },
      ];
      const BASS_POS = [
        { s: "C", o: 5 },
        { s: "B", o: 4 },
        { s: "A", o: 4 },
        { s: "G", o: 4 },
        { s: "F", o: 4 },
        { s: "E", o: 4 },
        { s: "A", o: 3 },
        { s: "G", o: 3 },
        { s: "F", o: 3 },
        { s: "E", o: 3 },
        { s: "D", o: 3 },
        { s: "C", o: 3 },
        { s: "B", o: 2 },
        { s: "A", o: 2 },
        { s: "G", o: 2 },
        { s: "F", o: 2 },
        { s: "E", o: 2 },
        { s: "D", o: 2 },
        { s: "C", o: 2 },
        { s: "B", o: 1 },
        { s: "A", o: 1 },
      ];
      const table = clef === "treble" ? TREBLE_POS : BASS_POS;
      const entry = table[Math.max(0, Math.min(table.length - 1, pos + 6))];
      const pitch = { step: entry.s, octave: entry.o, accidental: null };

      // Pixel X for the ghost note — clamped to actual note area
      const ghostX =
        noteStart + Math.max(0, Math.min(1, beat / beats)) * noteWidth;
      const ghostY = topLineY + pos * posSpacing;

      const isChord = chordMode && selectedNoteId_store;
      const zKey = `${z.partId}-${z.measureIndex}`;

      return {
        partId: z.partId,
        measureIndex: z.measureIndex,
        zKey,
        beat,
        pitch,
        ghostX,
        ghostY,
        isChord,
      };
    },
    [inputMode, measureZones, score, chordMode, selectedNoteId_store],
  );

  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        minWidth: "100%",
        lineHeight: 0,
        cursor: inputMode === "note" ? "none" : "default",
      }}
      onMouseMove={(e) => {
        if (inputMode !== "note") {
          if (cursor) {
            setCursor(null);
            cursorRef.current = null;
          }
          return;
        }
        const result = computeCursorFromEvent(e);
        setCursor(result);
        cursorRef.current = result;
      }}
      onMouseLeave={() => {
        if (inputMode === "note") {
          setCursor(null);
          cursorRef.current = null;
        }
      }}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (inputMode !== "note") return;
        if (e.key === "Enter" || e.key === " ") {
          const cur = cursorRef.current;
          if (!cur) return;
          e.preventDefault();
          const { partId, measureIndex, beat, pitch } = cur;
          const part = score.parts.find((p) => p.id === partId);
          const measure = part?.measures[measureIndex];
          if (!measure) return;
          let beatCursor = 0;
          let noteAtBeat = null;
          for (const n of measure.notes.filter((x) => !x.chordWith)) {
            if (!n.isRest && Math.abs(beatCursor - beat) < 0.13) {
              noteAtBeat = n;
              break;
            }
            beatCursor += noteDuration(n);
          }
          if (noteAtBeat)
            addChordNote(partId, measureIndex, noteAtBeat.id, pitch);
          else
            dropNoteAtBeat(
              partId,
              measureIndex,
              pitch,
              selectedDuration,
              selectedDots,
              beat,
            );
        }
      }}
      onClick={(e) => {
        const cur = cursorRef.current;
        if (inputMode !== "note" || !cur) return;
        e.stopPropagation();

        const { partId, measureIndex, beat, pitch } = cur;

        // Walk the measure to find if this beat already has a real note
        // If yes → auto-chord. If no → place new note.
        const part = score.parts.find((p) => p.id === partId);
        const measure = part?.measures[measureIndex];
        if (!measure) return;

        let beatCursor = 0;
        let noteAtBeat = null;
        for (const n of measure.notes.filter((x) => !x.chordWith)) {
          if (!n.isRest && Math.abs(beatCursor - beat) < 0.13) {
            noteAtBeat = n;
            break;
          }
          beatCursor += noteDuration(n);
        }

        if (noteAtBeat) {
          addChordNote(partId, measureIndex, noteAtBeat.id, pitch);
        } else {
          dropNoteAtBeat(
            partId,
            measureIndex,
            pitch,
            selectedDuration,
            selectedDots,
            beat,
          );
        }
      }}
    >
      <div ref={containerRef} style={{ display: "block" }} />

      {/* Measure zones — handle both ghost-note drags (note mode) and existing-note moves */}
      {measureZones.map((z) => {
        const zKey = `${z.partId}-${z.measureIndex}`;
        const isExistDrop = dropTarget === zKey;
        const isGhostDrop = cursor?.zKey === zKey;

        const part = score.parts.find((p) => p.id === z.partId);
        const clef = part?.clef || "treble";
        const beats = part?.measures[z.measureIndex]?.timeSignature?.beats ?? 4;

        return (
          <div
            key={zKey}
            onClick={(e) => {
              if (inputMode !== "note") selectMeasure(z.partId, z.measureIndex);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(zKey);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragState) {
                moveNote(
                  dragState.noteId,
                  dragState.partId,
                  dragState.measureIndex,
                  z.partId,
                  z.measureIndex,
                );
              }
              setDragState(null);
              setDropTarget(null);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget))
                setDropTarget(null);
            }}
            style={{
              position: "absolute",
              left: z.x,
              top: z.y - 35, // extend above staff for ledger line detection
              width: z.width,
              height: z.height + 70, // extend below staff for ledger line detection
              cursor: inputMode === "note" ? "none" : "pointer",
              borderRadius: 2,
              boxSizing: "border-box",
              // In note mode: completely invisible — no border, no background
              // Outer div handles all note placement via mousemove
              zIndex: inputMode === "note" ? 0 : 1,
              border:
                inputMode === "note"
                  ? "none"
                  : isExistDrop
                    ? "1px dashed #ea580c"
                    : z.selected
                      ? "1px solid rgba(29,78,216,0.4)"
                      : "none",
              backgroundColor:
                inputMode === "note"
                  ? "transparent"
                  : isExistDrop
                    ? "rgba(234,88,12,0.05)"
                    : z.selected
                      ? "rgba(29,78,216,0.04)"
                      : "transparent",
              pointerEvents: inputMode === "note" ? "none" : "auto",
            }}
          />
        );
      })}

      {/* Ghost note preview — floating note dot + pitch label while dragging in note mode */}
      {cursor &&
        (() => {
          const label = `${cursor.pitch.step}${cursor.pitch.accidental ?? ""}${cursor.pitch.octave}`;
          const isWhole = selectedDuration === "w";
          const isHalf = selectedDuration === "h";
          const isFilled = !isWhole && !isHalf;
          const noteColor = cursor.isChord
            ? "rgba(124,58,237,0.85)"
            : "rgba(37,99,235,0.85)";
          const noteGlow = cursor.isChord
            ? "rgba(124,58,237,0.4)"
            : "rgba(37,99,235,0.4)";

          // Find the zone this cursor is over (for ledger lines + stem positioning)
          const z = measureZones.find(
            (mz) => `${mz.partId}-${mz.measureIndex}` === cursor.zKey,
          );

          return (
            <>
              {/* Ghost note head — filled oval (blue like MuseScore) */}
              <div
                style={{
                  position: "absolute",
                  left: cursor.ghostX - 7,
                  top: cursor.ghostY - 5,
                  width: 13,
                  height: 10,
                  borderRadius: "50%",
                  background: isFilled ? noteColor : "transparent",
                  border: `2px solid ${noteColor}`,
                  boxShadow: `0 0 8px ${noteGlow}`,
                  pointerEvents: "none",
                  zIndex: 18,
                  transform: "rotate(-15deg)",
                }}
              />

              {/* Stem — quarter notes and smaller get a stem */}
              {!isWhole && z && (
                <div
                  style={{
                    position: "absolute",
                    left: cursor.ghostX + 5,
                    top:
                      cursor.ghostY > (z.staveTopLineY ?? z.y + 30) + 20
                        ? cursor.ghostY - 30
                        : cursor.ghostY + 4,
                    width: 1.5,
                    height: 28,
                    background: noteColor,
                    pointerEvents: "none",
                    zIndex: 18,
                  }}
                />
              )}

              {/* Ledger line — only when outside the staff (pos < 0 or > 8) */}
              {z &&
                (() => {
                  const topLineY = z.staveTopLineY ?? z.y + 30;
                  const botLineY = topLineY + (z.staveLineSpacing ?? 10) * 4;
                  const needsLedger =
                    cursor.ghostY < topLineY - 3 ||
                    cursor.ghostY > botLineY + 3;
                  if (!needsLedger) return null;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        left: cursor.ghostX - 10,
                        top: cursor.ghostY - 1,
                        width: 22,
                        height: 2,
                        background: noteColor,
                        opacity: 0.8,
                        pointerEvents: "none",
                        zIndex: 18,
                      }}
                    />
                  );
                })()}

              {/* Pitch label — small tooltip showing note name */}
              <div
                style={{
                  position: "absolute",
                  left: cursor.ghostX + 10,
                  top: cursor.ghostY - 18,
                  background: cursor.isChord ? "#6d28d9" : "#1d4ed8",
                  color: "white",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 4,
                  pointerEvents: "none",
                  zIndex: 19,
                  whiteSpace: "nowrap",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                }}
              >
                {cursor.isChord ? "+" : ""}
                {label}
                {selectedDots ? "." : ""}
              </div>
            </>
          );
        })()}

      {/* Note / rest zones */}
      {noteZones.map((z) => (
        <div
          key={`n-${z.noteId}`}
          draggable={!z.isRest && !z.isChordNote}
          onDragStart={(e) => {
            if (z.isRest || z.isChordNote) return;
            e.stopPropagation();
            setDragState({
              noteId: z.noteId,
              partId: z.partId,
              measureIndex: z.measureIndex,
            });
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragState(null)}
          onClick={(e) => {
            e.stopPropagation();
            // In note mode the outer div handles note placement — don't select
            if (inputMode === "note") return;
            selectNote(z.noteId, z.partId, z.measureIndex);
          }}
          title={
            z.isRest
              ? "Rest — click to select, then press A–G to fill"
              : z.isChordNote
                ? `Chord note — click to select, Del to remove from chord`
                : "Note — click to select, drag to move"
          }
          style={{
            position: "absolute",
            left: z.x,
            top: z.y,
            width: z.width,
            height: z.height,
            cursor: z.isRest ? "pointer" : dragState ? "grabbing" : "grab",
            boxSizing: "border-box",
            zIndex: z.isChordNote ? 12 : 10,
            // MuseScore-style selection: NO big box, just a very subtle underline
            // The notehead itself is already coloured orange/blue by VexFlow's setStyle
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
      {cursorStyle && <div style={cursorStyle} />}

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
        const beats =
          part?.measures[dyn.measureIndex]?.timeSignature?.beats ?? 4;
        const px = noteStart + (dyn.beat / beats) * noteWidth;
        return (
          <div
            key={dyn.id}
            style={{
              position: "absolute",
              left: px - 8,
              top: z.y + z.height - 4,
              fontSize: 13,
              fontStyle: "italic",
              fontFamily: "Times New Roman, serif",
              fontWeight: 700,
              color: "#1e293b",
              pointerEvents: "none",
              zIndex: 12,
              whiteSpace: "nowrap",
              userSelect: "none",
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
          const beats =
            part?.measures[z.measureIndex]?.timeSignature?.beats ?? 4;
          return ns + (beat / beats) * nw;
        };
        const x1 = beatToX(z1, hp.startBeat);
        const x2 = beatToX(z2, hp.endBeat);
        const y = z1.y + z1.height + 8;
        const mid = 5;
        const isC = hp.type === "cresc";
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
              zIndex: 11,
              overflow: "visible",
            }}
          >
            <path d={d} stroke="#1e293b" strokeWidth="1.5" fill="none" />
          </svg>
        );
      })}

      {/* ── Staff text overlays ────────────────────────────────────────── */}
      {(score.staffTexts || []).map((st) => {
        const z = measureZones.find(
          (mz) =>
            mz.partId === st.partId && mz.measureIndex === st.measureIndex,
        );
        if (!z) return null;
        const ns = z.measureIndex === 0 ? z.x + 55 : z.x + 10;
        const nw = z.width - (z.measureIndex === 0 ? 60 : 15);
        const part = score.parts.find((p) => p.id === st.partId);
        const beats =
          part?.measures[st.measureIndex]?.timeSignature?.beats ?? 4;
        const px = ns + (st.beat / beats) * nw;
        return (
          <div
            key={st.id}
            style={{
              position: "absolute",
              left: px,
              top: z.y - 22,
              fontSize: 11,
              fontFamily: "Times New Roman, serif",
              color: "#374151",
              pointerEvents: "none",
              zIndex: 12,
              whiteSpace: "nowrap",
              fontStyle: "italic",
            }}
          >
            {st.text}
          </div>
        );
      })}
    </div>
  );
}