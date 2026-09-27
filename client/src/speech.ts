// Text preparation for read-aloud (kept free of React so it can be tested directly).

/**
 * Break a paragraph into short pieces. Browsers (Chrome especially) cut
 * long utterances off after ~15 seconds, so each piece stays well below that.
 */
export function chunkText(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').replace(/_/g, '').trim();
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
    if (s) out.push(s);
  }
  return out;
}

