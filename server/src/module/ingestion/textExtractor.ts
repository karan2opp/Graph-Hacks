import { extractText } from "unpdf";
import { isAIEnabled, ocrImage } from "../../common/ai/index.js";

export interface ExtractedText {
  /** One entry per page. Empty when the file has no readable text (video, scanned PDF). */
  pages: string[];
  /** Why there is no text, when `pages` is empty. */
  note?: string;
}

/** Average characters per page below which a PDF is treated as scanned (image only). */
const MIN_CHARS_PER_PAGE = 40;

export async function extractPages(buffer: Buffer, mimeType: string): Promise<ExtractedText> {
  if (mimeType === "application/pdf") {
    const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: false });
    const chars = text.reduce((n, p) => n + p.trim().length, 0);
    if (chars < MIN_CHARS_PER_PAGE * Math.max(totalPages, 1)) {
      return { pages: [], note: "Scanned PDF with no text layer. Upload the pages as images or paste the text." };
    }
    return { pages: text };
  }

  if (mimeType.startsWith("image/")) {
    if (!isAIEnabled()) return { pages: [], note: "Image stored. Set OPENAI_API_KEY to read its text (OCR)." };
    const text = await ocrImage(buffer, mimeType);
    return text ? { pages: [text] } : { pages: [], note: "No text found in the image." };
  }

  if (mimeType.startsWith("text/")) return { pages: splitTextPages(buffer.toString("utf8")) };

  return { pages: [], note: "Stored as media. No text to read." };
}

/** Pasted text: a form feed (\f) starts a new page, otherwise it is one page. */
export function splitTextPages(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\f")
    .filter((p) => p.trim().length > 0);
}
