import { marked } from 'marked';
import puppeteer from 'puppeteer';

const PAGE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    padding: 48px 56px;
    max-width: 800px;
    margin: 0 auto;
  }
  h1 { font-size: 22pt; font-weight: bold; margin-bottom: 8px; margin-top: 0; color: #1a1a1a; }
  h2 { font-size: 15pt; font-weight: bold; margin-top: 28px; margin-bottom: 6px; color: #2c2c2c; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; }
  h3 { font-size: 12pt; font-weight: bold; margin-top: 18px; margin-bottom: 4px; color: #2c2c2c; }
  h4 { font-size: 11pt; font-weight: bold; margin-top: 12px; margin-bottom: 2px; }
  p  { margin-top: 8px; }
  ul, ol { margin-top: 8px; padding-left: 22px; }
  li { margin-top: 3px; }
  strong { font-weight: bold; }
  em     { font-style: italic; }
  hr { border: none; border-top: 1px solid #d0d0d0; margin: 20px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 10pt; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: bold; }
  blockquote { border-left: 3px solid #aaa; padding-left: 12px; margin: 12px 0; color: #555; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 10pt; }
`;

/**
 * Converts itinerary markdown to a PDF Buffer using puppeteer.
 * Renders markdown → styled HTML → PDF via headless Chromium.
 */
export async function generatePdf(markdown: string, title: string): Promise<Buffer> {
  const htmlBody = await marked.parse(markdown, { async: true });

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_STYLES}</style>
</head>
<body>
${htmlBody}
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
