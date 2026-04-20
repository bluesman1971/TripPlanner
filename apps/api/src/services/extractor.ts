import { readFileSync } from 'fs';
import path from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.bmp']);
const TEXT_EXTS  = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.eml']);

export function isImageFile(filename: string): boolean {
  return IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

/**
 * Extracts plain text from a booking confirmation file.
 * Returns null for image files (caller should use Claude vision instead).
 */
export async function extractText(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_EXTS.has(ext)) return null;

  // ── PDF ──────────────────────────────────────────────────────────────────
  if (ext === '.pdf') {
    // pdf-parse v2 ships its own types; use require to avoid ESM/CJS mismatch
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const pdfMod = require('pdf-parse') as any;
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
      typeof pdfMod === 'function' ? pdfMod : (pdfMod.default ?? pdfMod);
    const buffer = readFileSync(filePath);
    const result = await pdfParse(buffer);
    return result.text ?? null;
  }

  // ── DOCX / DOC ───────────────────────────────────────────────────────────
  if (ext === '.docx' || ext === '.doc') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || null;
  }

  // ── HTML ─────────────────────────────────────────────────────────────────
  if (ext === '.html' || ext === '.htm') {
    const { parse } = await import('node-html-parser');
    const html = readFileSync(filePath, 'utf-8');
    const root = parse(html);
    root.querySelectorAll('script, style, nav, footer, header, noscript').forEach(el => el.remove());
    const text = root.text.replace(/\n{3,}/g, '\n\n').trim();
    return text || null;
  }

  // ── Plain text / Markdown / CSV / etc. ───────────────────────────────────
  if (TEXT_EXTS.has(ext) || ext === '') {
    return readFileSync(filePath, 'utf-8');
  }

  // Unknown extension — try as plain text
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
