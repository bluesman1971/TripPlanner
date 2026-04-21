import { readFileSync } from 'fs';
import path from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.bmp']);
const TEXT_EXTS  = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.eml']);

// ─── Pre-upload readability check ────────────────────────────────────────────

export type FileReadabilityCheck =
  | { ok: true }
  | { ok: false; guidance: string };

/**
 * Validates that a file buffer is readable before it is uploaded to R2.
 * Returns { ok: true } if we can extract text, or { ok: false, guidance } with
 * a user-friendly message explaining what to do instead.
 * Called synchronously in the upload route so failures surface immediately.
 */
export async function checkFileReadable(
  buffer: Buffer,
  ext: string,
): Promise<FileReadabilityCheck> {
  // Images are always accepted — vision extraction handles them
  if (IMAGE_EXTS.has(ext)) return { ok: true };

  if (ext === '.pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    let text: string;
    try {
      const result = await pdfParse(buffer);
      text = result.text ?? '';
    } catch {
      return {
        ok: false,
        guidance:
          'This PDF uses a format we can\'t read — it may contain complex graphics or ' +
          'security settings. The easiest fix: open the booking confirmation in your browser, ' +
          'then File → Save Page As → "Webpage, HTML Only" and upload the .html file instead.',
      };
    }
    if (text.trim().length < 100) {
      return {
        ok: false,
        guidance:
          'This PDF appears to be image-based with no extractable text. ' +
          'Please get the digital version from the booking platform — most show a ' +
          '"View online" or "Download" button that produces a readable PDF. ' +
          'Alternatively, copy the booking details into a .txt file.',
      };
    }
    return { ok: true };
  }

  if (ext === '.docx' || ext === '.doc') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      if (result.value.trim().length < 20) {
        return {
          ok: false,
          guidance:
            'This Word document appears to be empty or image-only. ' +
            'Try saving it as plain text (.txt) or copying the content into a new document.',
        };
      }
    } catch {
      return {
        ok: false,
        guidance:
          'We couldn\'t read this Word document. ' +
          'Try saving it as a .txt or .html file and uploading that instead.',
      };
    }
    return { ok: true };
  }

  if (TEXT_EXTS.has(ext) || ext === '.html' || ext === '.htm') {
    if (buffer.toString('utf-8').trim().length < 20) {
      return { ok: false, guidance: 'This file appears to be empty.' };
    }
    return { ok: true };
  }

  return { ok: true };
}

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
    // pdf-parse v1 exports the function directly as module.exports; require() is correct here
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const buffer = readFileSync(filePath);
    try {
      const result = await pdfParse(buffer);
      return result.text ?? null;
    } catch {
      // pdfjs-dist (bundled with pdf-parse v1) cannot parse all PDF 1.7+ features.
      // Return null so the worker surfaces a user-friendly "scanned/image PDF" message.
      return null;
    }
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
