// Text preparation for read-aloud (kept free of React so it can be tested directly).

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bMrs\.(?=\s)/g, 'Missus'],
  [/\bMr\.(?=\s)/g, 'Mister'],
  [/\bMessrs\.(?=\s)/g, 'Messieurs'],
  [/\bDr\.(?=\s)/g, 'Doctor'],
  [/\bSt\.(?=\s+[A-Z])/g, 'Saint'],
  [/\bCapt\.(?=\s)/g, 'Captain'],
  [/\bCol\.(?=\s)/g, 'Colonel'],
  [/\bGen\.(?=\s)/g, 'General'],
  [/\bRev\.(?=\s)/g, 'Reverend'],
  [/\bProf\.(?=\s)/g, 'Professor'],
  [/\bJr\.(?=\s)/g, 'Junior'],
  [/\bNo\.(?=\s*\d)/g, 'Number'],
  [/\bviz\.(?=\s)/g, 'namely'],
  [/\be\.g\.(?=\s)/g, 'for example'],
  [/\bi\.e\.(?=\s)/g, 'that is'],
  [/&c\./g, 'et cetera.'],
];

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(s: string): number | null {
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!]!;
    const next = ROMAN[s[i + 1] ?? ''] ?? 0;
    total += v < next ? -v : v;
  }
  return total > 0 && total < 400 ? total : null;
}

/**
 * Rewrite text the way a person would read it aloud: expand abbreviations,
 * say chapter numbers as numbers, and drop typesetting marks.
 */
export function prepareForSpeech(text: string, { heading = false } = {}): string {
  let t = text
    .replace(/\s+/g, ' ')
    .replace(/_/g, '')
    .replace(/\s*--\s*/g, ', ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\[(\d+|[*†‡])\]/g, '') // footnote markers
    .trim();
  for (const [re, word] of ABBREVIATIONS) t = t.replace(re, word);
  // "Chapter IV" / "Book XII" / "Act II" -> numbers
  t = t.replace(/\b(Chapter|Book|Part|Volume|Act|Scene|Stave|Canto)\s+([IVXLC]+)\b\.?/gi, (m, word: string, num: string) => {
    const n = romanToInt(num.toUpperCase());
    return n ? `${word} ${n}.` : m;
  });
  if (heading) {
    // A heading that starts with a bare numeral: "XII. The Last Parley" -> "Chapter 12. The Last Parley"
    t = t.replace(/^([IVXLC]+)\.?(\s+|$)/, (m, num: string) => {
      const n = romanToInt(num);
      return n ? `Chapter ${n}. ` : m;
    });
    // Folio headings: "Actus Primus. Scoena Prima" -> "Act 1. Scene 1"
    const ORD: Record<string, number> = { primus: 1, prima: 1, secundus: 2, secunda: 2, tertius: 3, tertia: 3, quartus: 4, quarta: 4, quintus: 5, quinta: 5 };
    t = t.replace(/\bActus\s+(\w+)/gi, (m, w: string) => (ORD[w.toLowerCase()] ? `Act ${ORD[w.toLowerCase()]}` : m));
    t = t.replace(/\bSc(?:o?ena|ene)\s+(\w+)/gi, (m, w: string) => (ORD[w.toLowerCase()] ? `Scene ${ORD[w.toLowerCase()]}` : m));
    if (!/[.!?]$/.test(t)) t += '.';
  }
  return t.trim();
}

/**
 * Break a paragraph into short pieces. Browsers (Chrome especially) cut
 * long utterances off after ~15 seconds, so each piece stays well below that.
 */
export function chunkText(text: string, max = 220, opts: { heading?: boolean } = {}): string[] {
  const clean = prepareForSpeech(text, opts);
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;:]+[.!?;:]+["'’”)\]]*\s*|[^.!?;:]+$/g) ?? [clean];
  const out: string[] = [];
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(', ', max);
      if (cut < max / 3) cut = s.lastIndexOf(' ', max);
      if (cut < max / 3) cut = max;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s);
  }
  return out;
}

/** Pause (ms) a narrator would leave after a piece of text. */
export function pauseAfter(piece: string, { endOfBlock = false, heading = false } = {}): number {
  if (heading) return 900;
  if (endOfBlock) return 450;
  if (/[.!?]["'’”)\]]*$/.test(piece)) return 180;
  if (/[;:]$/.test(piece)) return 120;
  return 60;
}
