import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import https from 'https';
import { URL } from 'url';

// ─── SSRF protection ──────────────────────────────────────────────────────────
// Only requests to this exact hostname are allowed for server-side image fetches.
const ALLOWED_MAP_HOST = 'maps.googleapis.com';

export interface DocxOptions {
  destination: string;
  mapsApiKey?: string;
}

// ─── Google Maps static image (SSRF: hostname locked to ALLOWED_MAP_HOST) ─────

export async function fetchMapImage(
  addresses: string[],
  destination: string,
  apiKey: string,
): Promise<Buffer | null> {
  if (!addresses.length || !apiKey) return null;

  const markerParams = addresses
    .slice(0, 5)
    .map((addr, i) => {
      const location = encodeURIComponent(`${addr}, ${destination}`);
      return `markers=color:0x1B4F72|label:${i + 1}|${location}`;
    })
    .join('&');

  const rawUrl =
    `https://${ALLOWED_MAP_HOST}/maps/api/staticmap` +
    `?size=800x350&maptype=roadmap&style=feature:poi|visibility:off` +
    `&${markerParams}&key=${apiKey}`;

  // Belt-and-suspenders: validate the constructed URL never leaves the allowed host
  const parsed = new URL(rawUrl);
  if (parsed.hostname !== ALLOWED_MAP_HOST) return null;

  return new Promise((resolve) => {
    const req = https.get(rawUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// ─── Inline markdown parser ───────────────────────────────────────────────────

function parseInlineRuns(text: string): TextRun[] {
  // Split on **...** markers, alternating between normal and bold
  return text
    .split(/\*\*(.*?)\*\*/)
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter(({ text: t }) => t !== '')
    .map(({ text: t, bold }) => new TextRun({ text: t, bold }));
}

// ─── Block types ──────────────────────────────────────────────────────────────

interface ParsedBlock {
  type: 'h1' | 'h2' | 'h3' | 'hr' | 'bullet' | 'para';
  text: string;
  dayAddresses: string[];
}

// ─── Markdown → block list ────────────────────────────────────────────────────

export function parseMarkdownBlocks(markdown: string): ParsedBlock[] {
  const lines = markdown.split('\n');
  const blocks: ParsedBlock[] = [];

  let lastH2Index = -1;
  const currentDayAddresses: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2).trim(), dayAddresses: [] });

    } else if (line.startsWith('## ')) {
      // Attach accumulated addresses to previous day section
      if (lastH2Index >= 0) {
        blocks[lastH2Index].dayAddresses = [...currentDayAddresses];
      }
      currentDayAddresses.length = 0;
      lastH2Index = blocks.length;
      blocks.push({ type: 'h2', text: line.slice(3).trim(), dayAddresses: [] });

    } else if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim(), dayAddresses: [] });

    } else if (line === '---') {
      blocks.push({ type: 'hr', text: '', dayAddresses: [] });

    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({ type: 'bullet', text: line.slice(2).trim(), dayAddresses: [] });

    } else {
      // Extract meeting point addresses so the day map can include them
      const meetingMatch = line.match(/^\*\*Meeting point:\*\*\s+(.+)$/);
      if (meetingMatch) {
        currentDayAddresses.push(meetingMatch[1].trim());
      }
      blocks.push({ type: 'para', text: line, dayAddresses: [] });
    }
  }

  // Attach remaining addresses to the last day section
  if (lastH2Index >= 0) {
    blocks[lastH2Index].dayAddresses = [...currentDayAddresses];
  }

  return blocks;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateDocx(markdown: string, options: DocxOptions): Promise<Buffer> {
  const blocks = parseMarkdownBlocks(markdown);

  // Fetch map images for all day sections that have meeting addresses (in parallel)
  const mapImages = new Map<number, Buffer | null>();
  if (options.mapsApiKey) {
    await Promise.all(
      blocks
        .map((block, i) => ({ block, i }))
        .filter(({ block }) => block.type === 'h2' && block.dayAddresses.length > 0)
        .map(async ({ block, i }) => {
          const img = await fetchMapImage(block.dayAddresses, options.destination, options.mapsApiKey!);
          mapImages.set(i, img);
        }),
    );
  }

  // Build docx paragraphs
  const children: Paragraph[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    switch (block.type) {
      case 'h1':
        children.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.TITLE,
          }),
        );
        break;

      case 'h2':
        children.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.HEADING_2,
          }),
        );
        // Insert day map image after the day heading, if available
        if (mapImages.has(i) && mapImages.get(i)) {
          const imgBuf = mapImages.get(i)!;
          children.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [
                new ImageRun({
                  data: imgBuf,
                  transformation: { width: 600, height: 263 }, // 800×350 scaled to 75%
                  type: 'png',
                }),
              ],
            }),
          );
        }
        break;

      case 'h3':
        children.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.HEADING_3,
          }),
        );
        break;

      case 'hr':
        children.push(
          new Paragraph({
            text: '',
            spacing: { before: 120, after: 120 },
          }),
        );
        break;

      case 'bullet':
        children.push(
          new Paragraph({
            children: parseInlineRuns(block.text),
            bullet: { level: 0 },
          }),
        );
        break;

      case 'para':
        children.push(
          new Paragraph({
            children: parseInlineRuns(block.text),
          }),
        );
        break;
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}
