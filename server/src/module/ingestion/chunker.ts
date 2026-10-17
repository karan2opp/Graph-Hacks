export interface ChunkDraft {
  seq: number; // order in the whole document, from 1
  page: number; // from 1
  para: number; // position on the page, from 1
  paraLabel: string | null; // the document's own paragraph number ("7" for "7. That the plaintiff..."), if any
  text: string;
}

const MAX_CHARS = 1500; // longer blocks are split
const TARGET_CHARS = 900; // size of the pieces a long block is split into
const MIN_CHARS = 200; // shorter blocks are merged into the next one

const PARA_NUMBER = /^\s*(?:para(?:graph)?\s*)?\(?(\d{1,3}|[ivxlc]{1,6})[.)]\s+/i;

/** Packs pieces (lines or sentences) into strings of about TARGET_CHARS. */
function pack(pieces: string[], joiner: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + joiner.length > TARGET_CHARS) {
      out.push(cur);
      cur = piece;
    } else {
      cur = cur ? cur + joiner + piece : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * PDF text has no blank lines between paragraphs, so a numbered line ("2. That the...") also
 * starts a new block. Otherwise a whole page becomes one chunk and every claim on it is cited
 * as its first paragraph.
 */
function splitNumbered(block: string): string[] {
  const out: string[] = [];
  for (const line of block.split("\n")) {
    if (!out.length || PARA_NUMBER.test(line)) out.push(line);
    else out[out.length - 1] += `\n${line}`;
  }
  return out;
}

function splitLong(block: string): string[] {
  if (block.length <= MAX_CHARS) return [block];
  const lines = block.split("\n").filter((l) => l.trim());
  const pieces = lines.flatMap((line) =>
    line.length <= MAX_CHARS ? [line] : pack(line.split(/(?<=[.?!])\s+/), " "),
  );
  return pack(pieces, "\n");
}

/**
 * Splits page texts into paragraph-sized chunks that keep their page and paragraph
 * position, so every claim found later can be cited as "page 4, para 7".
 */
export function chunkPages(pages: string[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let seq = 0;

  pages.forEach((pageText, pageIdx) => {
    const blocks = pageText
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n/)
      .map((b) => b.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .flatMap(splitNumbered)
      .flatMap(splitLong);

    // Merge short unnumbered blocks (headings, signatures) into the block that follows.
    // A numbered paragraph always stays its own chunk, so "para 1" and "para 3" cite separately.
    const merged: string[] = [];
    let carry = "";
    for (const block of blocks) {
      // A heading directly above "1. That..." (single line break) still makes the block numbered.
      const numbered = block.split("\n").some((line) => PARA_NUMBER.test(line));
      const text = carry ? `${carry}\n${block}` : block;
      if (!numbered && text.length < MIN_CHARS) carry = text;
      else {
        merged.push(text);
        carry = "";
      }
    }
    // A short trailing block (signature, date) belongs with the last chunk.
    if (carry) {
      if (merged.length) merged[merged.length - 1] += `\n${carry}`;
      else merged.push(carry);
    }

    merged.forEach((text, i) => {
      // Look for the document's own paragraph number on any line of the chunk.
      const labelLine = text.split("\n").find((l) => PARA_NUMBER.test(l));
      chunks.push({
        seq: ++seq,
        page: pageIdx + 1,
        para: i + 1,
        paraLabel: labelLine ? labelLine.match(PARA_NUMBER)![1]! : null,
        text,
      });
    });
  });

  return chunks;
}
