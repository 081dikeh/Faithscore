// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer
//
// Each beat has EVENTS. Each event has duration in quarter-units (1-4).
// Offset = sum of previous event durations within the beat.
//
// PREFIX (before syllable) from offset:
//   offset=0 → ""     offset=1 → ","     offset=2 → "."     offset=3 → ".,,"
//
// SUFFIX (after syllable) from duration+offset:
//   if note fills to end of beat (offset+dur=4) → ""
//   duration=4 → ""   duration=3 → ".,"   duration=2 → "."   duration=1 → ","
//   EXCEPT: last event in beat never needs suffix (nothing comes after)
//
// REST events → BLANK (no character rendered, just space)
// SUSTAIN events → "–"
//
// BEAT SEPARATOR: ":" before beat 2+; "/" at slashSet positions

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  useSolfaStore,
  slashPositions,
  migrateMeasure,
  resolveKeyAt,
  resolveKeyBefore,
  bridgeSyllable,
} from "../../store/solfaStore";
import {
  getNoteLyric,
  inlineVersesForPart,
  belowScoreVerses,
  resolveVerses,
} from "../../utils/lyricVerses";

const FONT = '"Times New Roman", Georgia, serif';
const NOTE_SZ = 14;
const OCT_SZ = 8;
const SYM_SZ = 10;
const LYR_SZ = 14;
const ROW_H = 22; // note row height (baseline of note text)
const LYRIC_H = 20; // lyric row height
const VOICE_G = 14; // gap between voice blocks — large enough to prevent overlap
const NOTE_HIT_H = NOTE_SZ + 4; // note click target — only above baseline, not below
const SYS_GAP = 46;
const BRAK_W = 10;
const LABEL_W = 26;
// Base left/right insets, BEFORE the brace/label block on the left. Trimmed
// from 36/20 after feedback that the printed page had too much unused
// margin on the sides — this is on top of the page's own physical margin
// (SF_MARGIN_SIDE in exportSolfa.js), so tightening it here directly grows
// how many measures fit per line at the SAME note size (NOTE_SZ etc. are
// unaffected), rather than shrinking anything to fit.
const PAGE_L = 22;
const PAGE_R = 12;
const HDR_H = 44;
const VOICE_H = ROW_H + LYRIC_H + VOICE_G;

const QW = 9; // px per quarter-unit (note body width)
const SYM_W = 5; // px per prefix/suffix character
const SEP_W = 10; // px for ":" or "/"
const PAD = 8; // bar padding

const C = {
  ink: "#111827",
  hold: "#6b7280",
  sel: "#1d4ed8",
  selBg: "rgba(29,78,216,0.10)",
  barline: "#1f2937",
  bracket: "#1f2937",
  label: "#1e3a8a",
  lyric: "#374151",
  lyricRul: "#b0b8c8",
  voiceSep: "#e5e7eb",
  sep: "#4b5563",
  slash: "#9ca3af",
  sym: "#374151",
  mBgAlt: "#f8f9fa",
  slur: "#374151",
  slurHover: "#dc2626",
  slurStart: "#2563eb",
  tie: "#374151",
  tieHover: "#dc2626",
  tieStart: "#0d9488",
};

// Prefix string for event starting at quarter-unit `offset` within its beat
function getPrefix(offset) {
  if (offset === 0) return "";
  if (offset === 1) return "";
  if (offset === 2) return "";
  if (offset === 3) return "";
  return "";
}

// Suffix string for event of `duration` starting at `offset`
// `isLast` = true if this is the last event in the beat
function getSuffix(offset, duration, isLast) {
  const end = offset + duration;
  // If fills to beat end, or is the last event, no suffix
  if (end >= 4 || isLast) return "";
  if (duration === 3) return ".,";
  if (duration === 2) return ".";
  if (duration === 1) return ",";
  return "";
}

// Triplet-aware wrapper: a triplet member (3 equal parts of one beat,
// tagged via ev.tuplet) is separated from its siblings with the same
// comma used for a normal quarter-beat subdivision — not a special
// character. The "3" bracket above the group is what marks it as a
// triplet, not the separator itself.
function getEventSuffix(ev, offset, duration, isLast) {
  if (ev?.tuplet) {
    const end = offset + duration;
    return end >= 4 - 0.01 || isLast ? "" : ",";
  }
  return getSuffix(offset, duration, isLast);
}

function measureWidth(measure, slashSet) {
  if (!measure?.beats?.length) return PAD * 2 + QW * 4 * 4 + SEP_W * 3;
  const nb = measure.beats.length;
  let w = PAD * 2;
  for (let bi = 0; bi < nb; bi++) {
    const beat = measure.beats[bi];
    const events = beat?.events || [];
    let beatW = 0;
    let offset = 0;
    events.forEach((ev, ei) => {
      const isRest = ev.type === "rest";
      const isLast = ei === events.length - 1;
      const pre = isRest ? "" : getPrefix(offset);
      const suf = isRest ? "" : getEventSuffix(ev, offset, ev.duration, isLast);
      beatW += pre.length * SYM_W + ev.duration * QW + suf.length * SYM_W;
      offset += ev.duration;
    });
    if (beatW === 0) beatW = QW * 4;
    w += beatW;
    if (bi < nb - 1) w += SEP_W;
  }
  return w;
}

// ── Lyric-aware bar widths ────────────────────────────────────────────────
// A bar used to be sized purely from its notes, so a long word under a short
// note just spilled over its neighbours. Each note's cell is now at least as
// wide as its lyric, and a bar grows to fit (the system then wraps sooner).
const LYRIC_GAP = 6; // min breathing room between neighbouring lyric words
let _lyricCtx;
const _lyricWCache = new Map();
function lyricTextWidth(text) {
  const t = String(text || "");
  if (!t) return 0;
  const hit = _lyricWCache.get(t);
  if (hit != null) return hit;
  let w;
  try {
    if (!_lyricCtx && typeof document !== "undefined") {
      _lyricCtx = document.createElement("canvas").getContext("2d");
      _lyricCtx.font = `${LYR_SZ}px ${FONT}`;
    }
    w = _lyricCtx ? _lyricCtx.measureText(t).width : t.length * LYR_SZ * 0.5;
  } catch (_) {
    w = t.length * LYR_SZ * 0.5;
  }
  if (_lyricWCache.size > 2000) _lyricWCache.clear();
  _lyricWCache.set(t, w);
  return w;
}

// Natural (unscaled) cell widths of one beat's events. `lyricNeed(ev)` is how
// wide that event's lyric wants its cell to be (0 if none / not shown); any
// shortfall is added to the note body so the glyph stays centred under it.
function beatCells(beat, lyricNeed) {
  const events = beat?.events || [];
  let offset = 0;
  return events.map((ev, ei) => {
    const isRest = ev.type === "rest";
    const isLast = ei === events.length - 1;
    const pre = isRest ? "" : getPrefix(offset);
    const suf = isRest ? "" : getEventSuffix(ev, offset, ev.duration, isLast);
    const preN = pre.length * SYM_W;
    const sufN = suf.length * SYM_W;
    let bodyN = ev.duration * QW;
    const need = lyricNeed ? lyricNeed(ev) : 0;
    const nat = preN + bodyN + sufN;
    if (need > nat) bodyN += need - nat;
    offset += ev.duration;
    return { preN, bodyN, sufN, dur: ev.duration };
  });
}
const cellsWidth = (cells) => cells.reduce((a, c) => a + c.preN + c.bodyN + c.sufN, 0);

function InlineLyricEditor({ x, y, w, value, onCommit, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 30);
  }, []);
  return (
    <foreignObject x={x} y={y} width={Math.max(w + 4, 70)} height={18}>
      <input
        ref={ref}
        defaultValue={value}
        placeholder="lyric…"
        style={{
          width: "100%",
          height: "100%",
          border: "1.5px solid #2563eb",
          borderRadius: 3,
          fontSize: 10,
          fontFamily: FONT,
          padding: "0 3px",
          boxSizing: "border-box",
          background: "#eff6ff",
          color: "#111",
          outline: "none",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            onCommit(e.target.value);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => onCommit(e.target.value)}
      />
    </foreignObject>
  );
}

const SolfaRenderer = forwardRef(function SolfaRenderer(
  { onSelectEvent, onBeat, lyricsMode = false },
  ref,
) {
  // The playback cursor is driven by direct DOM mutation, NOT React state.
  // A ref-based SVG <g> is written to imperatively on every onBeat tick
  // (~60/sec) via cursorGroupRef/cursorLineRefs below — this never triggers
  // a React re-render, so it can't be affected by how expensive the rest of
  // the component tree is to reconcile. This is the standard technique for
  // smooth, high-frequency UI (playheads, etc.) in React.
  const cursorGroupRef = useRef(null);
  const cursorGlowRef = useRef(null);
  const cursorLineRef = useRef(null);
  // Which system (identified by its top-bound y) the view was last
  // auto-scrolled to during playback — lets us scroll once per new line
  // reached, instead of fighting the user's scroll every animation frame.
  const lastScrollTopRef = useRef(null);
  // Always-fresh snapshot of what the onBeat callback needs, refreshed every
  // render so the (long-lived, only-subscribed-once) callback below never
  // reads stale/closed-over data.
  const layoutMetaRef = useRef({ parts: [], numM: 1, topNum: 4 });

  const wrapRef = useRef(null);
  const svgNodeRef = useRef(null);
  const [svgW, setSvgW] = useState(900);
  // True while a temporary export-width render is in flight (see
  // exportAtWidth below) — the ResizeObserver below must not stomp on the
  // export width mid-capture if the container happens to resize at that
  // exact moment (rare, but exporting is already async across a couple of
  // animation frames, so it's worth guarding).
  const exportingRef = useRef(false);
  const [lyricEdit, setLyricEdit] = useState(null);
  const [hoveredSlurId, setHoveredSlurId] = useState(null);
  const [hoveredTieId, setHoveredTieId] = useState(null);
  const [tieFeedback, setTieFeedback] = useState(null);
  // Which lyric slot the mouse is currently over — used to preview the
  // (otherwise hidden) underline so first-time users can discover that
  // the space under a note is clickable, without cluttering the score.
  const [hoveredLyricId, setHoveredLyricId] = useState(null);

  // Expose SVG element to parent for PDF export
  useImperativeHandle(
    ref,
    () => ({
      getSvgElement: () => svgNodeRef.current,

      // Renders this SAME component (same layout code, same note-size
      // constants — see NOTE_SZ/SYM_SZ/OCT_SZ/LYR_SZ up top) at a FIXED
      // target pixel width instead of whatever width the on-screen
      // container happens to be, then hands back a detached clone of the
      // resulting <svg>.
      //
      // Why this exists: print/export used to just grab getSvgElement()
      // directly — the LIVE on-screen SVG, laid out for however wide the
      // user's browser window happened to be. Measure width and note size
      // (NOTE_SZ etc.) are fixed pixel values; only how many measures fit
      // per line adapts to the container width. So a wide monitor packs
      // many measures per line at a normal on-screen size, and export then
      // scales that WHOLE wide image down to fit a fixed page width —
      // shrinking already-fixed-size noteheads/syllables along with it.
      // The wider the editing window, the smaller the print output came
      // out, with no floor.
      //
      // Rendering at a width that matches the actual printed page's usable
      // width (in px, at the same 96px/inch the export math already
      // assumes) means the export image needs ZERO further downscaling —
      // NOTE_SZ=14 on screen prints as an actual ~14px-tall glyph, not
      // whatever it happened to shrink to. Fewer measures naturally fit
      // per line at that narrower target width, which is the explicit
      // trade-off requested: readable notes over bars-per-line.
      exportAtWidth: (px) =>
        new Promise((resolve) => {
          const original = svgW;
          exportingRef.current = true;
          setSvgW(px);
          // Two animation frames: one lets React commit the svgW state
          // update and re-render the SVG at the new width; the second lets
          // the browser actually complete layout/paint before we read the
          // DOM. Reading synchronously after setSvgW would still see the
          // OLD width — state updates aren't applied to the DOM until React
          // flushes and the browser paints.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const svg = svgNodeRef.current;
              const clone = svg ? svg.cloneNode(true) : null;
              exportingRef.current = false;
              setSvgW(original);
              resolve(clone);
            });
          });
        }),
    }),
    [svgW],
  );

  const score = useSolfaStore((s) => s.score);
  const selectedPartId = useSolfaStore((s) => s.selectedPartId);
  const selectedMeasureIdx = useSolfaStore((s) => s.selectedMeasureIdx);
  const selectedBeatIdx = useSolfaStore((s) => s.selectedBeatIdx);
  const selectedEventIdx = useSolfaStore((s) => s.selectedEventIdx);
  const selectEvent = useSolfaStore((s) => s.selectEvent);
  const setLyric = useSolfaStore((s) => s.setLyric);
  const setActiveLyricVerse = useSolfaStore((s) => s.setActiveLyricVerse);
  const inputMode = useSolfaStore((s) => s.inputMode);
  const slurStart = useSolfaStore((s) => s.slurStart);
  const setSlurStart = useSolfaStore((s) => s.setSlurStart);
  const clearSlurStart = useSolfaStore((s) => s.clearSlurStart);
  const addSlur = useSolfaStore((s) => s.addSlur);
  const removeSlur = useSolfaStore((s) => s.removeSlur);
  const tieStart = useSolfaStore((s) => s.tieStart);
  const setTieStart = useSolfaStore((s) => s.setTieStart);
  const clearTieStart = useSolfaStore((s) => s.clearTieStart);
  const addTie = useSolfaStore((s) => s.addTie);
  const removeTie = useSolfaStore((s) => s.removeTie);
  const removeMark = useSolfaStore((s) => s.removeMark);
  const removeNavigationMarker = useSolfaStore((s) => s.removeNavigationMarker);

  // Map of "partId:measureIdx:beatIdx:eventIdx" → {cx, bottomY} for slur drawing
  const eventPosMap = useRef({});
  // Map of "partId:measureIdx:beatIdx" → {x, rowY} for mark (tempo/dynamics/text) placement
  const beatPosMap = useRef({});
  // Map of measureIdx → {top, bottom} (the system/line it belongs to) for the playback cursor
  const systemBoundsMap = useRef({});

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => {
      if (exportingRef.current) return; // don't clobber the temporary export-width render
      setSvgW(e[0].contentRect.width || 900);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const { elems, totalH } = useMemo(() => {
    const parts = score.parts || [];
    const numM = Math.max(...parts.map((p) => p.measures.length), 1);
    const topNum = score.timeSignature?.beats || 4;
    const botNum = score.timeSignature?.beatType || 4;
    layoutMetaRef.current = { parts, numM, topNum };

    const lyricLayout = score.lyricLayout || "inline";
    const lyricDuplication = score.lyricDuplication || "per-voice-copy";
    const instrumentalSet = new Set(score.instrumentalMeasures || []);

    // Note-level modulations — keyed by exact (measure, beat, event)
    // position for O(1) lookup while walking notes below. Real sol-fa
    // modulation pivots on whatever note the composer picked, not a bar
    // line, so this can't be resolved per-measure like time signature can.
    const keyChangeAt = new Map();
    for (const kc of score.keyChanges || []) {
      keyChangeAt.set(`${kc.measureIdx}-${kc.beatIdx}-${kc.eventIdx || 0}`, kc);
    }

    // "between-alto-tenor" lead = the Alto part (falls back to the middle part)
    const altoIdx = parts.findIndex((p) =>
      (p.label || "").toUpperCase().startsWith("A"),
    );
    const betweenLeadIdx =
      altoIdx >= 0 ? altoIdx : Math.floor((parts.length - 1) / 2);

    // The score's Lyric Layout decides which voices carry lyrics when a verse
    // is left on "auto" voices (this is the rule verse 1 always followed).
    function layoutShowsLyricFor(pIdx) {
      if (lyricLayout === "instrumental" || lyricLayout === "below-score-only")
        return false;
      if (lyricLayout === "per-voice") return true;
      if (lyricLayout === "between-alto-tenor") return pIdx === betweenLeadIdx;
      // 'inline' / 'verse1-inline-rest-below'
      return lyricDuplication === "per-voice-copy" ? true : pIdx === 0;
    }

    // The inline verse lines drawn UNDER each voice (verse 1, 2, 3 … in number
    // order). Each verse is either "auto" (the layout rule above) or pinned to
    // an explicit list of voices — that is what makes any permutation possible.
    const partVerseList = parts.map((part, pIdx) =>
      lyricLayout === "instrumental"
        ? []
        : inlineVersesForPart(score, part, () => layoutShowsLyricFor(pIdx)),
    );
    const nLyricLines = partVerseList.map((l) => Math.max(1, l.length));
    // Top of each voice row within a system (a voice with N verse lines is
    // N lyric rows tall; one line is exactly the old fixed height).
    const partOff = [];
    {
      let acc = 0;
      parts.forEach((_, i) => {
        partOff.push(acc);
        acc += ROW_H + LYRIC_H * nLyricLines[i] + VOICE_G;
      });
    }
    const systemContentH = parts.length
      ? partOff[parts.length - 1] +
        ROW_H +
        LYRIC_H * nLyricLines[parts.length - 1] +
        VOICE_G
      : 0;
    // Verse numbers ("1." "2.") are printed at the start of each line as soon
    // as the score has more than one inline verse.
    const showVerseTags =
      resolveVerses(score).filter((v) => v.placement === "inline").length > 1;
    function showLyricForPart(pIdx) {
      return partVerseList[pIdx].length > 0;
    }

    // Width a lyric wants for an event in part pIdx, bar col (0 when the
    // event has no lyric, isn't a note, or lyrics aren't shown for that part).
    const lyricNeedFor = (pIdx, col) => (ev) => {
      if (ev.type !== "note" || instrumentalSet.has(col)) return 0;
      let w = 0;
      for (const v of partVerseList[pIdx]) {
        const t = getNoteLyric(ev, v.number);
        if (t) w = Math.max(w, lyricTextWidth(t) + LYRIC_GAP);
      }
      return w;
    };

    // Per-bar layout shared by ALL parts, so voices stay vertically aligned:
    //  - a beat is as wide as the widest any part needs it (notes + lyrics)
    //  - where every part has the same rhythm in the beat, each note cell is
    //    the widest of that cell across parts (exact vertical alignment)
    const colLayout = Array.from({ length: numM }, (_, col) => {
      const refM = migrateMeasure(parts[0]?.measures[col]);
      const nb = refM?.beats?.length || 0;
      if (!nb) {
        return { beatW: [], cells: [], raw: PAD * 2 + QW * 4 * 4 + SEP_W * 3 };
      }
      const partMeasures = parts.map((p) => migrateMeasure(p.measures[col]));
      const beatW = [];
      const cells = [];
      for (let bi = 0; bi < nb; bi++) {
        const per = partMeasures.map((m, pIdx) =>
          beatCells(m?.beats?.[bi], lyricNeedFor(pIdx, col)),
        );
        const sig = (cs) => cs.map((c) => c.dur).join(",");
        const aligned = per.length > 0 && per.every((cs) => sig(cs) === sig(per[0]));
        if (aligned && per[0].length) {
          const shared = per[0].map((_, ei) => ({
            dur: per[0][ei].dur,
            preN: Math.max(...per.map((cs) => cs[ei].preN)),
            bodyN: Math.max(...per.map((cs) => cs[ei].bodyN)),
            sufN: Math.max(...per.map((cs) => cs[ei].sufN)),
          }));
          cells.push(shared);
          beatW.push(cellsWidth(shared));
        } else {
          cells.push(null);
          beatW.push(Math.max(QW * 4, ...per.map(cellsWidth)));
        }
      }
      const raw = PAD * 2 + beatW.reduce((a, b) => a + b, 0) + SEP_W * (nb - 1);
      return { beatW, cells, raw };
    });
    const rawMWs = colLayout.map((c) => c.raw);

    const leftEdge = PAGE_L + BRAK_W + LABEL_W;
    const available = svgW - leftEdge - PAGE_R;

    const lines = (() => {
      const ls = [];
      let start = 0;
      while (start < numM) {
        let used = 0,
          count = 0;
        for (let i = start; i < numM; i++) {
          if (count > 0 && used + rawMWs[i] > available) break;
          used += rawMWs[i];
          count++;
        }
        if (count === 0) count = 1;
        ls.push(Array.from({ length: count }, (_, i) => start + i));
        start += count;
      }
      return ls;
    })();

    const blockVerses =
      lyricLayout === "instrumental" ? [] : belowScoreVerses(score);
    const showVerseBlocks = blockVerses.length > 0;
    const verses = blockVerses;
    const VERSE_LINE_H = 15;
    const VERSE_HEAD_H = 18;
    const verseAvailW = svgW - PAGE_L * 2 - PAGE_R;
    const verseCharW = 6.3;
    const maxChars = Math.max(20, Math.floor(verseAvailW / verseCharW));
    function wrapVerseLine(line) {
      if (line.length <= maxChars) return [line];
      const words = line.split(" ");
      const out = [];
      let cur = "";
      words.forEach((w) => {
        if ((cur ? cur + " " + w : w).length > maxChars) {
          if (cur) out.push(cur);
          cur = w;
        } else cur = cur ? cur + " " + w : w;
      });
      if (cur) out.push(cur);
      return out;
    }
    const versePrepared = showVerseBlocks
      ? verses.map((v) => ({
          ...v,
          lines: (v.text || "")
            .split("\n")
            .flatMap((l) => (l.trim() === "" ? [""] : wrapVerseLine(l))),
        }))
      : [];
    const versesExtraH = showVerseBlocks
      ? versePrepared.reduce(
          (sum, v) => sum + VERSE_HEAD_H + v.lines.length * VERSE_LINE_H + 10,
          20,
        )
      : 0;

    const systemH = systemContentH + SYS_GAP;
    const totalH = HDR_H + lines.length * systemH + 40 + versesExtraH;
    const elems = [];
    let sysY = HDR_H + 20;
    eventPosMap.current = {};
    beatPosMap.current = {};
    systemBoundsMap.current = {};

    elems.push(
      <g key="hdr">
        <text
          x={PAGE_L}
          y={HDR_H - 8}
          fontFamily={FONT}
          fontSize={13}
          fontStyle="italic"
          fill="#374151"
        >
          Doh is {score.key || "C"}
        </text>
        <text
          x={PAGE_L + 88}
          y={HDR_H - 8}
          fontFamily={FONT}
          fontSize={17}
          fontWeight={700}
          fill="#374151"
        >
          {topNum}/{botNum}
        </text>
      </g>,
    );

    lines.forEach((lineCols, lineIdx) => {
      const numCols = lineCols.length;
      const totalRaw = lineCols.reduce((s, c) => s + rawMWs[c], 0);
      const isLast = lineIdx === lines.length - 1;
      const sc2 =
        !isLast && totalRaw < available && totalRaw > 0
          ? available / totalRaw
          : 1;

      const colXs = [];
      let cxPos = leftEdge;
      lineCols.forEach((c) => {
        colXs.push(cxPos);
        cxPos += rawMWs[c] * sc2;
      });
      const systemRight = cxPos;

      const lineTop = sysY - NOTE_SZ - 4;
      const lineBottom =
        sysY + partOff[parts.length - 1] + LYRIC_H * nLyricLines[parts.length - 1] + 4;

      elems.push(
        <g key={`brk-${lineIdx}`}>
          <line
            x1={PAGE_L + 2}
            y1={lineTop}
            x2={PAGE_L + 2}
            y2={lineBottom}
            stroke={C.bracket}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <line
            x1={PAGE_L + 2}
            y1={lineTop}
            x2={PAGE_L + BRAK_W + 2}
            y2={lineTop}
            stroke={C.bracket}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <line
            x1={PAGE_L + 2}
            y1={lineBottom}
            x2={PAGE_L + BRAK_W + 2}
            y2={lineBottom}
            stroke={C.bracket}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </g>,
      );
      elems.push(
        <line
          key={`obar-${lineIdx}`}
          x1={leftEdge}
          y1={lineTop}
          x2={leftEdge}
          y2={lineBottom}
          stroke={C.barline}
          strokeWidth={1.5}
        />,
      );
      elems.push(
        <text
          key={`mnum-${lineIdx}`}
          data-sysmark="1"
          data-sysy={lineTop}
          x={leftEdge + 2}
          y={lineTop - 2}
          fontFamily={FONT}
          fontSize={9}
          fill="#9ca3af"
        >
          {lineCols[0] + 1}
        </text>,
      );

      lineCols.forEach((col) => {
        systemBoundsMap.current[col] = { top: lineTop, bottom: lineBottom };
      });

      elems.push(
        <line
          key={`vsep-top-${lineIdx}`}
          x1={leftEdge}
          y1={lineTop}
          x2={systemRight}
          y2={lineTop}
          stroke={C.barline}
          strokeWidth={1.5}
        />,
      );

      parts.forEach((part, pIdx) => {
        const rowY = sysY + partOff[pIdx];

        elems.push(
          <text
            key={`lbl-${lineIdx}-${pIdx}`}
            x={PAGE_L + BRAK_W + 2}
            y={rowY}
            fontFamily={FONT}
            fontSize={12}
            fontWeight={700}
            fill={C.label}
          >
            {part.label}
          </text>,
        );

        if (showVerseTags) {
          partVerseList[pIdx].forEach((v, k) => {
            elems.push(
              <text
                key={`vtag-${lineIdx}-${pIdx}-${v.number}`}
                x={leftEdge - 3}
                y={rowY + 4 + k * LYRIC_H + LYRIC_H * 0.7}
                textAnchor="end"
                fontFamily={FONT}
                fontSize={LYR_SZ}
                fontWeight={700}
                fill={C.label}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {v.tag}
              </text>,
            );
          });
        }

        lineCols.forEach((col, ci) => {
          const measure = migrateMeasure(part.measures[col]);
          const mTs = measure.timeSignature || { beats: topNum, beatType: botNum };
          const colSlashSet = slashPositions(mTs.beats, mTs.beatType);
          const scaledMW = rawMWs[col] * sc2;
          const lay = colLayout[col];
          const needFn = lyricNeedFor(pIdx, col);

          // Mid-score meter change marker — drawn once, above the top part
          // only, exactly at the bar where the time signature changes
          // (bar 1's signature is covered by the page header, so col 0
          // never needs this). Key changes are handled separately, below,
          // at the exact NOTE where the modulation lands — not the bar.
          if (pIdx === 0 && col > 0) {
            const prevM = migrateMeasure(parts[0]?.measures[col - 1]);
            const prevTs = prevM.timeSignature || { beats: topNum, beatType: botNum };
            const tsChanged =
              prevTs.beats !== mTs.beats || prevTs.beatType !== mTs.beatType;
            if (tsChanged) {
              // Nudge right when this bar also starts a new line, so we
              // don't sit on top of the small bar-number label there.
              const xOff = ci === 0 ? 16 : 3;
              elems.push(
                <text
                  key={`tschange-${lineIdx}-${col}`}
                  x={colXs[ci] + xOff}
                  y={lineTop - 2}
                  fontFamily={FONT}
                  fontSize={11}
                  fontWeight={700}
                  fill={C.label}
                >
                  {mTs.beats}/{mTs.beatType}
                </text>,
              );
            }
          }

          // Alternating measure background — covers note row + lyric row
          if (col % 2 !== 0) {
            elems.push(
              <rect
                key={`bg-${lineIdx}-${pIdx}-${ci}`}
                x={colXs[ci]}
                y={rowY - NOTE_SZ - 2}
                width={scaledMW}
                height={NOTE_SZ + 2 + 4 + LYRIC_H * nLyricLines[pIdx] + 2}
                fill={C.mBgAlt}
              />,
            );
          }

          let x = colXs[ci] + PAD * sc2;

          measure.beats.forEach((beat, bi) => {
            const events = beat?.events || [];

            // This beat's cells and its scale. The beat's width is shared by
            // every part (so a long lyric in ANY voice widens the beat for
            // all of them); each part spreads its own notes across it.
            const scaledBeatW = (lay.beatW[bi] ?? QW * 4) * sc2;
            const beatCellList = lay.cells[bi] || beatCells(beat, needFn);
            const ownBeatW = cellsWidth(beatCellList) || QW * 4;
            const sc3 = scaledBeatW / ownBeatW; // per-beat scale (name kept for the drawing code below)

            // Beat separator
            if (bi > 0) {
              const isSlash = colSlashSet.has(bi - 1);
              const sw = SEP_W * sc2;
              elems.push(
                <text
                  key={`sep-${lineIdx}-${pIdx}-${col}-${bi}`}
                  x={x + sw / 2}
                  y={rowY}
                  textAnchor="middle"
                  fontFamily={FONT}
                  fontSize={NOTE_SZ}
                  fill={isSlash ? C.slash : C.sep}
                  opacity={isSlash ? 0.55 : 1}
                  style={{ pointerEvents: "none" }}
                >
                  {isSlash ? "/" : ":"}
                </text>,
              );
              x += sw;
            }

            beatPosMap.current[`${part.id}:${col}:${bi}`] = { x, rowY };

            let offset = 0;
            let tripletBracketStartX = null; // tracks span of a triplet group for its "3" bracket
            events.forEach((ev, ei) => {
              const isNote = ev.type === "note";
              const isHold = ev.type === "sustain";
              const isRest = ev.type === "rest";
              const isLastEv = ei === events.length - 1;
              const isSel =
                part.id === selectedPartId &&
                col === selectedMeasureIdx &&
                bi === selectedBeatIdx &&
                ei === selectedEventIdx;

              const pre = isRest ? "" : getPrefix(offset);
              const suf = isRest
                ? ""
                : getEventSuffix(ev, offset, ev.duration, isLastEv);
              const cell = beatCellList[ei];
              const preW = cell.preN * sc3;
              const bodyW = cell.bodyN * sc3;
              const sufW = cell.sufN * sc3;
              const totalW = preW + bodyW + sufW;

              const noteX = x + preW;
              const noteCX = noteX + bodyW / 2;

              // Triplet "3" bracket — spans from the first to the last
              // member of the group, drawn once the group is complete.
              // Matches standard engraving: a shallow curved bracket with
              // the number centered above it.
              if (ev.tuplet) {
                if (ev.tripletIndex === 0) {
                  tripletBracketStartX = noteCX;
                }
                if (
                  ev.tripletIndex === (ev.tripletOf || 3) - 1 &&
                  tripletBracketStartX !== null
                ) {
                  const bx1 = tripletBracketStartX;
                  const bx2 = noteCX;
                  const by = rowY - NOTE_SZ - 6;
                  const midX = (bx1 + bx2) / 2;
                  elems.push(
                    <path
                      key={`tripbracket-${ev.id}`}
                      d={`M ${bx1} ${by} Q ${midX} ${by - 6} ${bx2} ${by}`}
                      fill="none"
                      stroke={C.label}
                      strokeWidth={0.8}
                      style={{ pointerEvents: "none" }}
                    />,
                  );
                  elems.push(
                    <text
                      key={`tripnum-${ev.id}`}
                      x={midX}
                      y={by - 8}
                      textAnchor="middle"
                      fontFamily={FONT}
                      fontSize={10}
                      fontWeight={700}
                      fill={C.label}
                      style={{ pointerEvents: "none" }}
                    >
                      3
                    </text>,
                  );
                  tripletBracketStartX = null;
                }
              }

              // Record note center position for slur drawing
              const posKey = `${part.id}:${col}:${bi}:${ei}`;
              const noteBottomY = rowY + 6; // just below the note baseline, above lyrics
              if (isNote) {
                eventPosMap.current[posKey] = {
                  cx: noteCX,
                  bottomY: noteBottomY,
                };
              }

              // Selection bg (note zone only — above baseline)
              if (isSel) {
                elems.push(
                  <rect
                    key={`sel-${ev.id}`}
                    x={x}
                    y={rowY - NOTE_SZ - 2}
                    width={Math.max(totalW, 8 * sc3)}
                    height={NOTE_HIT_H}
                    fill={C.selBg}
                    rx={2}
                  />,
                );
              }

              // Slur start highlight
              const isSlurStart =
                inputMode === "slur" &&
                slurStart &&
                slurStart.partId === part.id &&
                slurStart.measureIdx === col &&
                slurStart.beatIdx === bi &&
                slurStart.eventIdx === ei;
              if (isSlurStart) {
                elems.push(
                  <rect
                    key={`slurhl-${ev.id}`}
                    x={x}
                    y={rowY - NOTE_SZ - 2}
                    width={Math.max(totalW, 8 * sc3)}
                    height={NOTE_HIT_H}
                    fill="rgba(37,99,235,0.18)"
                    rx={2}
                    style={{ pointerEvents: "none" }}
                  />,
                );
              }

              // Tie start highlight
              const isTieStart =
                inputMode === "tie" &&
                tieStart &&
                tieStart.partId === part.id &&
                tieStart.measureIdx === col &&
                tieStart.beatIdx === bi &&
                tieStart.eventIdx === ei;
              if (isTieStart) {
                elems.push(
                  <rect
                    key={`tiehl-${ev.id}`}
                    x={x}
                    y={rowY - NOTE_SZ - 2}
                    width={Math.max(totalW, 8 * sc3)}
                    height={NOTE_HIT_H}
                    fill="rgba(13,148,136,0.18)"
                    rx={2}
                    style={{ pointerEvents: "none" }}
                  />,
                );
              }

              // Note click target — covers ONLY above the note baseline, never into lyric zone
              elems.push(
                <rect
                  key={`hit-${ev.id}`}
                  x={x}
                  y={rowY - NOTE_SZ - 2}
                  width={Math.max(totalW, 8 * sc3)}
                  height={NOTE_HIT_H}
                  fill="transparent"
                  style={{
                    cursor:
                      (inputMode === "slur" || inputMode === "tie") && isNote ? "crosshair" : "pointer",
                  }}
                  onClick={() => {
                    if (inputMode === "slur" && isNote) {
                      if (!slurStart) {
                        // First click — set slur start
                        setSlurStart({
                          partId: part.id,
                          measureIdx: col,
                          beatIdx: bi,
                          eventIdx: ei,
                        });
                      } else if (
                        slurStart.partId === part.id &&
                        (col > slurStart.measureIdx ||
                          (col === slurStart.measureIdx &&
                            bi > slurStart.beatIdx) ||
                          (col === slurStart.measureIdx &&
                            bi === slurStart.beatIdx &&
                            ei > slurStart.eventIdx))
                      ) {
                        // Second click — create slur (must be after start)
                        addSlur(
                          slurStart.partId,
                          slurStart.measureIdx,
                          slurStart.beatIdx,
                          slurStart.eventIdx,
                          col,
                          bi,
                          ei,
                        );
                        clearSlurStart();
                      } else {
                        // Clicked before start or same note — reset start
                        setSlurStart({
                          partId: part.id,
                          measureIdx: col,
                          beatIdx: bi,
                          eventIdx: ei,
                        });
                      }
                      return;
                    }
                    if (inputMode === "tie" && isNote) {
                      if (!tieStart) {
                        // First click — set tie start
                        setTieStart({
                          partId: part.id,
                          measureIdx: col,
                          beatIdx: bi,
                          eventIdx: ei,
                        });
                      } else if (
                        tieStart.partId === part.id &&
                        (col > tieStart.measureIdx ||
                          (col === tieStart.measureIdx &&
                            bi > tieStart.beatIdx) ||
                          (col === tieStart.measureIdx &&
                            bi === tieStart.beatIdx &&
                            ei > tieStart.eventIdx))
                      ) {
                        // Second click — create tie IF same pitch as start
                        // (addTie itself enforces this and refuses
                        // otherwise); either way the start resets so the
                        // user can immediately try again.
                        const ok = addTie(
                          tieStart.partId,
                          tieStart.measureIdx,
                          tieStart.beatIdx,
                          tieStart.eventIdx,
                          col,
                          bi,
                          ei,
                        );
                        if (!ok) {
                          setTieFeedback("Ties can only connect two notes of the SAME pitch.");
                          setTimeout(() => setTieFeedback(null), 2200);
                        }
                        clearTieStart();
                      } else {
                        // Clicked before start or same note — reset start
                        setTieStart({
                          partId: part.id,
                          measureIdx: col,
                          beatIdx: bi,
                          eventIdx: ei,
                        });
                      }
                      return;
                    }
                    selectEvent(part.id, col, bi, ei);
                    onSelectEvent?.(part.id, col, bi, ei);
                    setLyricEdit(null);
                  }}
                />,
              );

              // Prefix characters
              pre.split("").forEach((ch, chi) => {
                elems.push(
                  <text
                    key={`pre-${ev.id}-${chi}`}
                    x={x + chi * SYM_W * sc3 + (SYM_W * sc3) / 2}
                    y={ch === "." ? rowY - 4 : rowY}
                    textAnchor="middle"
                    fontFamily={FONT}
                    fontSize={SYM_SZ}
                    fill={isSel ? C.sel : C.sym}
                    fontWeight={600}
                    style={{ pointerEvents: "none" }}
                  >
                    {ch}
                  </text>,
                );
              });

              // Note / sustain (rest = nothing)
              if (isNote) {
                elems.push(
                  <text
                    key={`n-${ev.id}`}
                    x={noteCX}
                    y={rowY}
                    textAnchor="middle"
                    fontFamily={FONT}
                    fontSize={NOTE_SZ}
                    fontWeight={isSel ? 700 : 400}
                    fill={isSel ? C.sel : C.ink}
                    style={{ pointerEvents: "none" }}
                  >
                    {ev.syllable || "?"}
                  </text>,
                );
                if (ev.octave !== 0) {
                  elems.push(
                    <text
                      key={`oct-${ev.id}`}
                      x={noteX + bodyW}
                      y={ev.octave > 0 ? rowY - NOTE_SZ + 2 : rowY + 3}
                      textAnchor="start"
                      fontFamily={FONT}
                      fontSize={OCT_SZ}
                      fontWeight={700}
                      fill={isSel ? C.sel : C.ink}
                      dominantBaseline={ev.octave > 0 ? "auto" : "hanging"}
                      style={{ pointerEvents: "none" }}
                    >
                      {Math.abs(ev.octave)}
                    </text>,
                  );
                }

                // Modulation — anchored to THIS exact note, not the bar.
                // The pivot syllable (small superscript before the main
                // syllable) shows what this same pitch was called in the
                // OLD key, e.g. a note read as "r" here in G shows a tiny
                // "s" above it because that pitch was "s" back in D —
                // proving the tonal bridge, same convention as the
                // reference scores. Computed per-voice since each part
                // sings a different pitch at the same moment.
                const kc = keyChangeAt.get(`${col}-${bi}-${ei}`);
                if (kc) {
                  const oldKeyHere = resolveKeyBefore(score, col, bi, ei);
                  const pivot = bridgeSyllable(ev.syllable, ev.octave || 0, kc.key, oldKeyHere);
                  if (pivot) {
                    elems.push(
                      <text
                        key={`pivot-${ev.id}`}
                        x={noteCX - NOTE_SZ * 0.42}
                        y={rowY - NOTE_SZ * 0.62}
                        textAnchor="middle"
                        fontFamily={FONT}
                        fontSize={Math.max(6, NOTE_SZ * 0.42)}
                        fontWeight={900}
                        fill={isSel ? C.sel : C.label}
                        style={{ pointerEvents: "none" }}
                      >
                        {pivot}
                      </text>,
                    );
                  }
                  // "Key X" label — shown once (top part only) directly
                  // above the pivot syllable, stacked tight against it.
                  if (pIdx === 0) {
                    elems.push(
                      <text
                        key={`keychange-${ev.id}`}
                        x={noteCX}
                        y={rowY - NOTE_SZ * 0.62 - 9}
                        textAnchor="middle"
                        fontFamily={FONT}
                        fontSize={10}
                        fontWeight={700}
                        fill={C.label}
                      >
                        Key {kc.key}
                      </text>,
                    );
                  }
                }
              } else if (isHold) {
                elems.push(
                  <text
                    key={`h-${ev.id}`}
                    x={noteCX}
                    y={rowY}
                    textAnchor="middle"
                    fontFamily={FONT}
                    fontSize={NOTE_SZ}
                    fill={isSel ? C.sel : C.hold}
                    style={{ pointerEvents: "none" }}
                  >
                    –
                  </text>,
                );
              }
              // REST = blank, nothing rendered

              // Suffix characters
              if (suf) {
                const sufStartX = noteX + bodyW;
                suf.split("").forEach((ch, chi) => {
                  elems.push(
                    <text
                      key={`suf-${ev.id}-${chi}`}
                      x={sufStartX + chi * SYM_W * sc3 + (SYM_W * sc3) / 2}
                      y={ch === "." ? rowY - 4 : rowY}
                      textAnchor="middle"
                      fontFamily={FONT}
                      fontSize={SYM_SZ}
                      fill={isSel ? C.sel : C.sym}
                      fontWeight={600}
                      style={{ pointerEvents: "none" }}
                    >
                      {ch}
                    </text>,
                  );
                });
              }

              // Lyric zone — one row per verse shown under this voice, each
              // sitting below the note baseline (verse 1 first, then 2, 3 …).
              const lyricSlotW = Math.max(totalW, 8 * sc3);

              if (isNote && !instrumentalSet.has(col)) {
                partVerseList[pIdx].forEach((verse, vk) => {
                  const lyricZoneY = rowY + 4 + vk * LYRIC_H;
                  const lyricZoneH = LYRIC_H;
                  const lyricTextY = lyricZoneY + LYRIC_H * 0.7;
                  const text = getNoteLyric(ev, verse.number);
                  const hoverKey = `${ev.id}:${verse.number}`;
                  // Underline ruler — hidden by default. Drawn when "lyrics
                  // mode" is on (solid, for batch entry) or while hovering
                  // that slot (faint/dashed — a hint that it is clickable).
                  const isLyricHovered = hoveredLyricId === hoverKey;
                  if (lyricsMode || isLyricHovered) {
                    elems.push(
                      <line
                        key={`lu-${ev.id}-${verse.number}`}
                        x1={x}
                        y1={lyricZoneY + lyricZoneH - 2}
                        x2={x + lyricSlotW}
                        y2={lyricZoneY + lyricZoneH - 2}
                        stroke={C.lyricRul}
                        strokeWidth={0.6}
                        strokeDasharray={lyricsMode ? undefined : "2,2"}
                        style={{
                          pointerEvents: "none",
                          opacity: lyricsMode ? 1 : 0.55,
                        }}
                      />,
                    );
                  }
                  elems.push(
                    <text
                      key={`ly-${ev.id}-${verse.number}`}
                      x={x + lyricSlotW / 2}
                      y={lyricTextY}
                      textAnchor="middle"
                      fontFamily={FONT}
                      fontSize={LYR_SZ}
                      fill={C.lyric}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {text}
                    </text>,
                  );
                  elems.push(
                    <rect
                      key={`lhit-${ev.id}-${verse.number}`}
                      x={x}
                      y={lyricZoneY}
                      width={lyricSlotW}
                      height={lyricZoneH}
                      fill="transparent"
                      style={{ cursor: "text" }}
                      onMouseEnter={() => setHoveredLyricId(hoverKey)}
                      onMouseLeave={() =>
                        setHoveredLyricId((cur) => (cur === hoverKey ? null : cur))
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveLyricVerse(verse.number);
                        setLyricEdit({
                          partId: part.id,
                          measureIdx: col,
                          beatIdx: bi,
                          eventIdx: ei,
                          verse: verse.number,
                          x,
                          y: lyricZoneY + 1,
                          w: lyricSlotW,
                          current: text,
                        });
                      }}
                    />,
                  );
                });
              }

              x += totalW;
              offset += ev.duration;
            });
            if (events.length === 0) x += scaledBeatW;
          });
        });

        // Voice separator — sits below lyric zone, above next voice's note area
        if (pIdx < parts.length - 1) {
          // rowY + 4 (lyricZoneY) + LYRIC_H + 3 = bottom of lyric + small gap
          const sepY = rowY + 4 + LYRIC_H * nLyricLines[pIdx] + 3;
          elems.push(
            <line
              key={`vsep-${lineIdx}-${pIdx}`}
              x1={leftEdge}
              y1={sepY}
              x2={systemRight}
              y2={sepY}
              stroke={C.voiceSep}
              strokeWidth={0.6}
            />,
          );
        }
      });

      elems.push(
        <line
          key={`vsep-bottom-${lineIdx}`}
          x1={leftEdge}
          y1={lineBottom}
          x2={systemRight}
          y2={lineBottom}
          stroke={C.barline}
          strokeWidth={1.5}
        />,
      );

      lineCols.forEach((col, ci) => {
        const bx = colXs[ci] + rawMWs[col] * sc2;
        const last = ci === numCols - 1;
        elems.push(
          <line
            key={`bline-${lineIdx}-${ci}`}
            x1={bx}
            y1={lineTop}
            x2={bx}
            y2={lineBottom}
            stroke={C.barline}
            strokeWidth={last ? 2.5 : 1.5}
          />,
        );
        if (last)
          elems.push(
            <line
              key={`bline2-${lineIdx}`}
              x1={bx + 4}
              y1={lineTop}
              x2={bx + 4}
              y2={lineBottom}
              stroke={C.barline}
              strokeWidth={1}
            />,
          );
      });

      // ── Navigation markers for this system ──────────────────────────────────
      (score.navigationMarkers || []).forEach((mk) => {
        const ci = lineCols.indexOf(mk.atMeasure);
        if (ci === -1) return;
        const mx = colXs[ci] + 4;
        const isVerseTag = mk.type === "verse-label";

        // Segno / Coda are drawn as vector symbols above the system, not as
        // text: U+1D10B / U+1D10C aren't in the score's serif font, so as
        // <text> they render as nothing at all.
        if (mk.type === "segno" || mk.type === "coda") {
          const gy = lineTop - 22; // top of a ~18px-tall symbol box
          elems.push(
            <g
              key={`navmk-${mk.id}`}
              transform={`translate(${mx + 2}, ${gy})`}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                removeNavigationMarker(mk.id);
              }}
            >
              <title>{mk.type === "segno" ? "Segno" : "Coda"} (click to remove)</title>
              <rect x={-2} y={-2} width={20} height={22} fill="transparent" />
              {mk.type === "segno" ? (
                <g fill="none" stroke="#1d4ed8" strokeLinecap="round">
                  <path
                    d="M 11,2.5 C 11,-0.5 4,-0.5 4,4 C 4,8.5 11,9.5 11,14 C 11,18.5 3.5,18.5 3.5,15.5"
                    strokeWidth={1.7}
                  />
                  <line x1={13} y1={1} x2={2} y2={17} strokeWidth={1.3} />
                  <circle cx={1.8} cy={5.5} r={1.1} fill="#1d4ed8" stroke="none" />
                  <circle cx={13.2} cy={12.5} r={1.1} fill="#1d4ed8" stroke="none" />
                </g>
              ) : (
                <g fill="none" stroke="#1d4ed8" strokeWidth={1.5} strokeLinecap="round">
                  <circle cx={8} cy={9} r={5.2} />
                  <line x1={8} y1={0} x2={8} y2={18} />
                  <line x1={-1} y1={9} x2={17} y2={9} />
                </g>
              )}
            </g>,
          );
          return;
        }

        elems.push(
          <text
            key={`navmk-${mk.id}`}
            x={mx}
            y={isVerseTag ? lineTop - 3 : lineBottom + 13}
            fontFamily={FONT}
            fontSize={10.5}
            fontWeight={700}
            fontStyle={isVerseTag ? "normal" : "italic"}
            fill={isVerseTag ? "#b45309" : "#1d4ed8"}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              removeNavigationMarker(mk.id);
            }}
          >
            {mk.label}
          </text>,
        );
      });

      sysY += systemH;
    });

    // NOTE: the playback cursor is intentionally NOT computed here — it's
    // computed outside this useMemo (using the beatPosMap/systemBoundsMap refs
    // populated above) so that a moving playhead never forces this expensive
    // score layout to be rebuilt on every animation frame.

    // ── Verse paragraph blocks (printed below the full score) ──────────────────
    if (showVerseBlocks && versePrepared.length) {
      let vy = sysY + 14;
      versePrepared.forEach((v) => {
        elems.push(
          <text
            key={`vhead-${v.number}`}
            x={PAGE_L}
            y={vy}
            fontFamily={FONT}
            fontSize={12}
            fontWeight={700}
            fill="#1e2433"
          >
            {v.label || `Verse ${v.number}`}
          </text>,
        );
        vy += VERSE_HEAD_H;
        v.lines.forEach((ln, li) => {
          elems.push(
            <text
              key={`vline-${v.number}-${li}`}
              x={PAGE_L + 10}
              y={vy}
              fontFamily={FONT}
              fontSize={11}
              fill="#374151"
            >
              {ln}
            </text>,
          );
          vy += VERSE_LINE_H;
        });
        vy += 10;
      });
    }

    // ── Render slurs ──────────────────────────────────────────────────────────
    // Slurs are cubic bezier curves drawn below the lyric zone
    const slurs = score.slurs || [];
    slurs.forEach((sl) => {
      const startKey = `${sl.partId}:${sl.startMeasure}:${sl.startBeat}:${sl.startEvent}`;
      const endKey = `${sl.partId}:${sl.endMeasure}:${sl.endBeat}:${sl.endEvent}`;
      const startPos = eventPosMap.current[startKey];
      const endPos = eventPosMap.current[endKey];
      if (!startPos || !endPos) return;

      const x1 = startPos.cx;
      const x2 = endPos.cx;
      const y = Math.max(startPos.bottomY, endPos.bottomY);
      const w = x2 - x1;
      const bow = Math.min(Math.max(w * 0.12, 4), 10); // subtle bow, capped at 10px

      // Cubic bezier: starts and ends at note centers, bows gently downward
      const d = `M ${x1} ${y} C ${x1 + w * 0.25} ${y + bow}, ${x2 - w * 0.25} ${y + bow}, ${x2} ${y}`;
      const isHovered = hoveredSlurId === sl.id;

      elems.push(
        <g key={`slur-${sl.id}`}>
          {/* Wider invisible hit area for hover/click */}
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={8}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHoveredSlurId(sl.id)}
            onMouseLeave={() => setHoveredSlurId(null)}
            onClick={(e) => {
              e.stopPropagation();
              removeSlur(sl.id);
            }}
          />
          {/* Visible slur curve */}
          <path
            d={d}
            fill="none"
            stroke={isHovered ? C.slurHover : C.slur}
            strokeWidth={isHovered ? 1.2 : 0.9}
            strokeLinecap="round"
            opacity={isHovered ? 1 : 0.65}
            style={{ pointerEvents: "none" }}
          />
        </g>,
      );
    });

    // ── Render ties ──────────────────────────────────────────────────────────
    // Same drawing mechanism as slurs, but ties join two notes of the
    // identical pitch (enforced back in addTie), so they're kept visually
    // tighter/flatter than a slur's phrase-spanning curve — that's the
    // conventional way to tell them apart at a glance.
    const ties = score.ties || [];
    ties.forEach((tie) => {
      const startKey = `${tie.partId}:${tie.startMeasure}:${tie.startBeat}:${tie.startEvent}`;
      const endKey = `${tie.partId}:${tie.endMeasure}:${tie.endBeat}:${tie.endEvent}`;
      const startPos = eventPosMap.current[startKey];
      const endPos = eventPosMap.current[endKey];
      if (!startPos || !endPos) return;

      const x1 = startPos.cx;
      const x2 = endPos.cx;
      const y = Math.max(startPos.bottomY, endPos.bottomY);
      const w = x2 - x1;
      const bow = Math.min(Math.max(w * 0.08, 2.5), 6); // flatter/tighter than a slur

      const d = `M ${x1} ${y} C ${x1 + w * 0.25} ${y + bow}, ${x2 - w * 0.25} ${y + bow}, ${x2} ${y}`;
      const isHovered = hoveredTieId === tie.id;

      elems.push(
        <g key={`tie-${tie.id}`}>
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={8}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHoveredTieId(tie.id)}
            onMouseLeave={() => setHoveredTieId(null)}
            onClick={(e) => {
              e.stopPropagation();
              removeTie(tie.id);
            }}
          />
          <path
            d={d}
            fill="none"
            stroke={isHovered ? C.tieHover : C.tie}
            strokeWidth={isHovered ? 1.4 : 1.1}
            strokeLinecap="round"
            opacity={isHovered ? 1 : 0.75}
            style={{ pointerEvents: "none" }}
          />
        </g>,
      );
    });

    // Tie validation feedback — brief banner when a same-pitch attempt fails
    if (tieFeedback) {
      elems.push(
        <text
          key="tie-feedback"
          x={PAGE_L}
          y={HDR_H - 6}
          fontFamily={FONT}
          fontSize={11}
          fontWeight={600}
          fill="#dc2626"
        >
          {tieFeedback}
        </text>,
      );
    }

    // ── Render marks (tempo text / dynamics / expression) ──────────────────────
    const marks = score.marks || [];
    marks.forEach((mk) => {
      const pos =
        beatPosMap.current[`${mk.partId}:${mk.measureIdx}:${mk.beatIdx}`];
      if (!pos) return;
      const isDynamic = mk.kind === "dynamic";
      elems.push(
        <text
          key={`mark-${mk.id}`}
          x={pos.x}
          y={pos.rowY - NOTE_SZ - 6}
          fontFamily={FONT}
          fontSize={10.5}
          fontWeight={700}
          fontStyle={isDynamic ? "normal" : "italic"}
          fill={isDynamic ? "#111827" : "#7c3aed"}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            removeMark(mk.id);
          }}
        >
          {mk.value}
        </text>,
      );
    });

    return { elems, totalH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    score,
    selectedPartId,
    selectedMeasureIdx,
    selectedBeatIdx,
    selectedEventIdx,
    inputMode,
    slurStart,
    tieStart,
    hoveredSlurId,
    hoveredTieId,
    tieFeedback,
    hoveredLyricId,
    svgW,
    lyricsMode,
  ]);

  // ── Playback cursor — red vertical line tracking beat position ─────────────
  // Subscribes ONCE (deps=[onBeat], and onBeat is a stable reference) and
  // then, on every tick, mutates the existing <g>/<line> DOM nodes directly
  // via refs — it never calls setState and never goes through React's
  // render/reconcile cycle. That's what makes this immune to however
  // expensive (or not) the rest of the tree is.
  //
  // playbackBeat is a global quarter-note counter from song start (same
  // units used by the staff ScoreRenderer). We walk the lead part's beats to
  // find which measure/beat it falls in, then interpolate within that beat
  // using the exact on-screen positions captured in beatPosMap during the
  // last static layout pass (kept fresh in layoutMetaRef).
  useEffect(() => {
    if (!onBeat) return;

    const update = (playbackBeat) => {
      const g = cursorGroupRef.current;
      if (!g) return;
      if (playbackBeat === null || playbackBeat === undefined) {
        g.style.display = "none";
        lastScrollTopRef.current = null;
        return;
      }
      const { parts, numM, topNum } = layoutMetaRef.current;
      if (!parts.length) {
        g.style.display = "none";
        return;
      }

      const leadPart = parts[0];
      let cum = 0,
        targetCol = null,
        targetBi = 0,
        fracInBeat = 0;
      for (let col = 0; col < numM; col++) {
        const m = migrateMeasure(leadPart.measures[col]);
        // Match the audio scheduler's cumulative-beat source exactly (time
        // signature, not the rendered beats array) so the cursor never
        // drifts out of sync with the actual audio position measure-by-measure.
        const nBeats = m?.timeSignature?.beats || topNum;
        if (playbackBeat < cum + nBeats || col === numM - 1) {
          const within = playbackBeat - cum;
          const actualLen = m?.beats?.length || nBeats;
          targetCol = col;
          targetBi = Math.min(
            Math.max(actualLen, 1) - 1,
            Math.max(0, Math.floor(within)),
          );
          fracInBeat = Math.min(1, Math.max(0, within - Math.floor(within)));
          break;
        }
        cum += nBeats;
      }

      if (targetCol === null) {
        g.style.display = "none";
        return;
      }
      const pos = beatPosMap.current[`${leadPart.id}:${targetCol}:${targetBi}`];
      if (!pos) {
        g.style.display = "none";
        return;
      }

      const m = migrateMeasure(leadPart.measures[targetCol]);
      const actualLen = m?.beats?.length || topNum;
      let nextKey = null;
      if (targetBi + 1 < actualLen)
        nextKey = `${leadPart.id}:${targetCol}:${targetBi + 1}`;
      else if (targetCol + 1 < numM)
        nextKey = `${leadPart.id}:${targetCol + 1}:0`;
      const nextPos = nextKey ? beatPosMap.current[nextKey] : null;
      const beatW =
        nextPos && nextPos.rowY === pos.rowY
          ? Math.max(4, nextPos.x - pos.x)
          : QW * 4;
      const cx = pos.x + fracInBeat * beatW;
      const bounds = systemBoundsMap.current[targetCol] || {
        top: pos.rowY - 30,
        bottom: pos.rowY + 30,
      };

      g.style.display = "";
      g.setAttribute("transform", `translate(${cx},0)`);
      if (cursorGlowRef.current) {
        cursorGlowRef.current.setAttribute("y1", bounds.top);
        cursorGlowRef.current.setAttribute("y2", bounds.bottom);
      }
      if (cursorLineRef.current) {
        cursorLineRef.current.setAttribute("y1", bounds.top);
        cursorLineRef.current.setAttribute("y2", bounds.bottom);
      }

      // Follow playback — like MuseScore, the page scrolls to keep the
      // cursor in view once it moves to a new system line, rather than
      // fighting the user's scroll on every single animation frame.
      if (bounds.top !== lastScrollTopRef.current) {
        lastScrollTopRef.current = bounds.top;
        cursorLineRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      }
    };

    update(null);
    return onBeat(update);
  }, [onBeat]);

  const lyricEditElem = lyricEdit ? (
    <InlineLyricEditor
      key="lyric-ed"
      x={lyricEdit.x}
      y={lyricEdit.y}
      w={lyricEdit.w}
      value={lyricEdit.current}
      onCommit={(val) => {
        setLyric(
          lyricEdit.partId,
          lyricEdit.measureIdx,
          lyricEdit.beatIdx,
          lyricEdit.eventIdx,
          val.trim(),
          lyricEdit.verse || 1,
        );
        setLyricEdit(null);
      }}
      onCancel={() => setLyricEdit(null)}
    />
  ) : null;

  return (
    <div ref={wrapRef} style={{ width: "100%", overflowX: "auto" }}>
      <svg
        ref={svgNodeRef}
        width={svgW}
        height={totalH}
        viewBox={`0 0 ${svgW} ${totalH}`}
        style={{ display: "block", fontFamily: FONT, userSelect: "none" }}
      >
        {elems}
        <g
          ref={cursorGroupRef}
          style={{ display: "none", pointerEvents: "none" }}
        >
          <line
            ref={cursorGlowRef}
            x1={0}
            y1={0}
            x2={0}
            y2={0}
            stroke="#ef4444"
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.16}
          />
          <line
            ref={cursorLineRef}
            x1={0}
            y1={0}
            x2={0}
            y2={0}
            stroke="#ef4444"
            strokeWidth={2.2}
            strokeLinecap="round"
            opacity={0.9}
          />
        </g>
        {lyricEditElem}
      </svg>
    </div>
  );
});

export default SolfaRenderer;