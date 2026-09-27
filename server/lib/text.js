// Turns a plain-text book into titled sections for the reader.

const ROMAN = '[IVXLCDM]+';

const STRATEGIES = {
  // CHAPTER I / Chapter 12 / CHAPTER I. Down the Rabbit-Hole  (VOLUME lines too)
  chapter: (line) =>
    /^\s*(CHAPTER|Chapter|VOLUME|Volume|BOOK|PART)\s+([IVXLC]+|\d+)\b\.?.*$/.test(line),
  // I. A DISCUSSION SOMEWHAT IN THE AIR
  'roman-title': (line) => /^[IVXL]{1,7}\.\s+\S/.test(line),
  // A bare numeral on its own line; the next non-empty line is the title.
  'roman-line': (line) => new RegExp(`^${ROMAN}$`).test(line.trim()),
  // Book I
  book: (line) => /^\s*Book\s+[IVXLC]+\s*$/.test(line),
  // Actus Primus. Scoena Prima.
  act: (line) => /^Actus\s+\w+/.test(line),
  // [BOOK I.  INSCRIPTIONS]
  'bracket-book': (line) => /^\[BOOK\s+[IVXLC]+\.?/.test(line),
  // THE LITTLE RED HEN   (short upper-case line, at most one space of indent)
  caps: (line) =>
    /^ ?[A-Z][A-Z0-9 ,.'’!?;:&-]{2,70}$/.test(line) && (line.match(/[A-Z]/g) || []).length >= 3,
};

const MIN_SECTION_CHARS = 400;
const MAX_SECTION_CHARS = 45000;

function tidyTitle(title) {
  const t = title
    .replace(/^\[|\]$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .replace(/^(CHAPTER|VOLUME|BOOK|PART)\b/, (w) => w.charAt(0) + w.slice(1).toLowerCase())
    .trim();
  // "Book I. INSCRIPTIONS" -> "Book I. Inscriptions"
  const labelled = t.match(/^((?:Chapter|Volume|Book|Part)\s+[IVXLC\d]+\.?\s+)([A-Z][A-Z ,'’-]+)$/);
  if (labelled) return labelled[1] + tidyTitle(labelled[2]);
  // "THE LITTLE RED HEN" -> "The Little Red Hen"; leave roman numerals alone.
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t)) {
    return t
      .toLowerCase()
      .split(' ')
      .map((w, i, words) => {
        if (/^[ivxlc]+\.?$/.test(w) && !['ill', 'civil'].includes(w)) return w.toUpperCase();
        const afterStop = i === 0 || /[.:]$/.test(words[i - 1]);
        if (!afterStop && ['a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'at', 'for', 'or', 'by'].includes(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }
  return t;
}

/**
 * Split a book into sections.
 * @param {string} raw full text (a leading "[Title by Author Year]" line is dropped)
 * @param {keyof STRATEGIES} strategy
 * @returns {{title: string, body: string}[]}
 */
export function splitSections(raw, strategy) {
  const isHeading = STRATEGIES[strategy];
  if (!isHeading) throw new Error(`Unknown split strategy: ${strategy}`);

  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    // Stray scanner line-numbers ("00081429") in some older e-texts.
    .filter((l) => !/^\s*\d{8}$/.test(l));
  if (/^\[.*\]\s*$/.test(lines[0] || '')) lines.shift();

  const sections = [];
  let current = { title: 'Opening', lines: [] };
  const push = () => {
    const body = current.lines.join('\n').replace(/^\n+|\s+$/g, '');
    sections.push({ title: current.title, body });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    const prevBlank = i === 0 || lines[i - 1].trim() === '';
    const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === '';
    if (line && prevBlank && nextBlank && isHeading(line)) {
      push();
      let title = line.trim();
      if (strategy === 'chapter' && /^\s{4,}/.test(line)) {
        // Centred headings sometimes carry their title on the next line.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length && /^\s{4,}\S/.test(lines[j]) && lines[j].trim().length < 60) {
          title = `${title}. ${lines[j].trim()}`;
          i = j;
        }
      }
      if (strategy === 'roman-line') {
        // Pull in the title that follows the numeral.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length && lines[j].trim().length < 80) {
          title = `${title}. ${lines[j].trim()}`;
          i = j;
        }
      }
      current = { title: tidyTitle(title), lines: [] };
    } else {
      current.lines.push(lines[i]);
    }
  }
  push();

  // Merge sections too small to stand alone (e.g. "VOLUME I" followed directly
  // by "CHAPTER I", or a cast list) into the section that follows.
  const merged = [];
  let carry = null;
  for (const s of sections) {
    if (carry) {
      if (carry.title !== 'Opening') {
        s.title = s.title === 'Opening' ? carry.title : `${carry.title} · ${s.title}`;
      }
      s.body = carry.body ? `${carry.body}\n\n${s.body}` : s.body;
      carry = null;
    }
    if (s.body.length < MIN_SECTION_CHARS) {
      carry = s;
      continue;
    }
    merged.push(s);
  }
  if (carry) {
    if (merged.length && carry.body.length) {
      merged[merged.length - 1].body += `\n\n${carry.title}\n\n${carry.body}`;
    } else if (!merged.length) merged.push(carry);
  }
  return merged.filter((s) => s.body.trim().length > 0).flatMap(chunkLarge);
}

// Very long sections (e.g. an unmarked act of a play) are split at paragraph
// breaks so each page of the reader stays light.
function chunkLarge(section) {
  if (section.body.length <= MAX_SECTION_CHARS) return [section];
  const paras = section.body.split(/\n\s*\n/).filter((p) => p.trim());
  const parts = [];
  let buf = [];
  let size = 0;
  for (const p of paras) {
    if (size + p.length > MAX_SECTION_CHARS * 0.6 && size > 0) {
      parts.push(buf.join('\n\n'));
      buf = [];
      size = 0;
    }
    buf.push(p);
    size += p.length + 2;
  }
  if (buf.length) parts.push(buf.join('\n\n'));
  if (parts.length === 1) return [section];
  return parts.map((body, i) => ({ title: `${section.title} (${i + 1} of ${parts.length})`, body }));
}

export function wordCount(text) {
  const m = text.match(/[A-Za-z0-9’']+/g);
  return m ? m.length : 0;
}

/**
 * Strip the Project Gutenberg licence header/footer from a downloaded text.
 */
export function stripGutenbergBoilerplate(text) {
  let t = text.replace(/\r\n?/g, '\n');
  const start = t.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start !== -1) t = t.slice(t.indexOf('\n', start) + 1);
  const end = t.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end !== -1) t = t.slice(0, end);
  return t.trim();
}

/**
 * Pick the strategy that finds a sensible number of sections for an unknown text.
 */
export function guessStrategy(text) {
  const candidates = ['chapter', 'roman-title', 'book', 'act', 'roman-line', 'caps'];
  let best = { strategy: 'chapter', score: -Infinity };
  for (const strategy of candidates) {
    const n = splitSections(text, strategy).length;
    // Prefer 5-150 sections; beyond that headings are probably noise.
    const score = n >= 3 && n <= 150 ? 1000 - Math.abs(40 - n) : -n;
    if (score > best.score) best = { strategy, score };
  }
  return best.strategy;
}
