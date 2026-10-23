// src/utils/lyricVerses.js
//
// ONE verse/lyric model shared by the Staff app and the Solfa app.
//
// ── Data model ───────────────────────────────────────────────────────────────
// On every note / solfa event:
//     lyric   : string            → the text for VERSE 1 (unchanged, so every
//                                   score saved before verses existed still opens)
//     lyrics  : { [n]: string }   → text for verses 2, 3, … (only present when used)
//
// On the score:
//     verses: [{
//       number    : 1, 2, 3 …
//       tag       : "1."           the number printed at the start of each line
//       label     : "Verse 2"      the heading used for a below-score block
//       placement : 'inline'       lyrics sit UNDER THE NOTES, syllable by syllable
//                 | 'below'        a block of ordinary text printed under the score
//       voices    : 'auto'         follow the score's normal rule (see below)
//                 | [partId, …]    show this verse under exactly these voices
//       text      : "…"            the block text (placement 'below' only)
//     }]
//
// Verse 1 never has to be listed: it is implied as an inline, 'auto' verse.
// An entry for number 1 only exists once the user changes one of its settings.
//
// 'auto' voices means:
//   Staff app  → under every voice that actually has text for that verse
//   Solfa app  → whatever the score's Lyric Layout says (inline / per-voice /
//                between Alto & Tenor …) — the same rule verse 1 always used
// ─────────────────────────────────────────────────────────────────────────────

/** Text of verse `v` on a note / event ('' when none). */
export function getNoteLyric(n, v = 1) {
  if (!n) return "";
  if (v === 1) return n.lyric || "";
  return (n.lyrics && n.lyrics[v]) || "";
}

/** A copy of the note / event with verse `v` set to `text` ('' clears it). */
export function withNoteLyric(n, v, text) {
  const t = text == null ? "" : String(text);
  if (v === 1) return { ...n, lyric: t === "" ? null : t };
  const lyrics = { ...(n.lyrics || {}) };
  if (t === "") delete lyrics[v];
  else lyrics[v] = t;
  const next = { ...n };
  if (Object.keys(lyrics).length) next.lyrics = lyrics;
  else delete next.lyrics;
  return next;
}

/** True if any of `notes` carries text for verse `v`. */
export function anyNoteHasVerse(notes, v) {
  for (const n of notes) if (getNoteLyric(n, v)) return true;
  return false;
}

/** Every verse number that has text on at least one of `notes`. */
export function verseNumbersInNotes(notes) {
  const found = new Set();
  for (const n of notes) {
    if (n?.lyric) found.add(1);
    if (n?.lyrics) {
      for (const k of Object.keys(n.lyrics)) if (n.lyrics[k]) found.add(Number(k));
    }
  }
  return found;
}

const _scanCache = new WeakMap();
/** Every verse number (>1) that has words on some note/event of the score. */
export function verseNumbersInScore(score) {
  if (!score || typeof score !== "object") return [];
  const hit = _scanCache.get(score);
  if (hit) return hit;
  const found = new Set();
  const visit = (n) => {
    if (n && n.lyrics) {
      for (const k of Object.keys(n.lyrics)) if (n.lyrics[k]) found.add(Number(k));
    }
  };
  for (const part of score.parts || []) {
    for (const m of part.measures || []) {
      if (m.notes) m.notes.forEach(visit); // Staff
      if (m.beats) m.beats.forEach((b) => (b.events || []).forEach(visit)); // Solfa
    }
  }
  const out = [...found].sort((a, b) => a - b);
  _scanCache.set(score, out);
  return out;
}

/**
 * Verse settings that survive a Staff <-> Solfa conversion: voices become
 * 'auto' (the two apps number their voices differently).
 */
export function portableVerses(score) {
  const raw = Array.isArray(score?.verses) ? score.verses : [];
  return raw.map((v) => ({ ...v, voices: "auto" }));
}

/**
 * The full, normalised verse list: verse 1 filled in, every entry given
 * defaults, sorted by number. Old Solfa scores stored extra verses as plain
 * text blocks without a `placement`; those stay "below" blocks.
 */
export function resolveVerses(score) {
  const raw = Array.isArray(score?.verses) ? score.verses : [];
  const byNum = new Map();
  for (const v of raw) {
    if (!v || !Number.isFinite(Number(v.number))) continue;
    const number = Number(v.number);
    const legacyBlock = !v.placement && typeof v.text === "string" && v.text.trim() !== "";
    byNum.set(number, {
      number,
      tag: v.tag || `${number}.`,
      label: v.label || `Verse ${number}`,
      placement: v.placement || (legacyBlock ? "below" : "inline"),
      voices: Array.isArray(v.voices) ? v.voices : "auto",
      text: v.text || "",
    });
  }
  // Verses that have words on notes but no settings entry (an imported or
  // converted score, say) still need to exist, or their words would be hidden.
  for (const num of verseNumbersInScore(score)) {
    if (num > 1 && !byNum.has(num)) {
      byNum.set(num, {
        number: num,
        tag: `${num}.`,
        label: `Verse ${num}`,
        placement: "inline",
        voices: "auto",
        text: "",
      });
    }
  }
  if (!byNum.has(1)) {
    byNum.set(1, {
      number: 1,
      tag: "1.",
      label: "Verse 1",
      placement: "inline",
      voices: "auto",
      text: "",
    });
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

/** Next free verse number (never reuses a number, so notes keep their text). */
export function nextVerseNumber(score) {
  const nums = resolveVerses(score).map((v) => v.number);
  return Math.max(1, ...nums) + 1;
}

/**
 * The inline verse lines to draw UNDER one voice, in number order.
 * `autoRule(verse)` answers "does the automatic rule put this verse here?".
 */
export function inlineVersesForPart(score, part, autoRule) {
  return resolveVerses(score).filter(
    (v) =>
      v.placement === "inline" &&
      (v.voices === "auto" ? !!autoRule(v) : v.voices.includes(part.id)),
  );
}

/** Verses that print as a text block under the score (and have text). */
export function belowScoreVerses(score) {
  return resolveVerses(score).filter(
    (v) => v.placement === "below" && v.text && v.text.trim() !== "",
  );
}

/**
 * Split typed lyrics into one token per NOTE.
 *   "Glo-ry to God"   → ["Glo-", "ry", "to", "God"]
 *   "Hal-le-lu-jah"   → ["Hal-", "le-", "lu-", "jah"]
 *   "_"               → a note that gets no syllable (a held / melisma note)
 * Words are separated by spaces or line breaks; hyphens split syllables.
 */
export function splitLyricText(text) {
  const out = [];
  for (const word of String(text || "").split(/\s+/)) {
    if (!word) continue;
    if (word === "_") {
      out.push("");
      continue;
    }
    // split after every hyphen but keep the hyphen on the left piece
    const pieces = word.match(/[^-]+-?|-/g) || [word];
    for (const p of pieces) out.push(p);
  }
  return out;
}

/**
 * Wrap `text` (with explicit line breaks kept) into lines no wider than
 * `maxW`, where `measure(str)` returns a string's pixel width.
 */
export function wrapLyricBlock(text, maxW, measure) {
  const lines = [];
  for (const para of String(text || "").split("\n")) {
    if (para.trim() === "") {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const w of para.split(/\s+/)) {
      const tryLine = cur ? `${cur} ${w}` : w;
      if (cur && measure(tryLine) > maxW) {
        lines.push(cur);
        cur = w;
      } else cur = tryLine;
    }
    if (cur) lines.push(cur);
  }
  return lines;
}