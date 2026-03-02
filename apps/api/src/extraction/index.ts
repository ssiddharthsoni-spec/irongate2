import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const MAX_TEXT_LENGTH = 500_000;

// Lazy-loaded pdfjs-dist (import is cached after first call)
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}
// Pre-warm: trigger the import immediately so it's cached before the first scan
void getPdfjs().catch(() => {});

/**
 * Extract plain text from a document buffer based on file extension.
 */
export async function extractText(buffer: Buffer, extension: string): Promise<string> {
  let text: string;

  switch (extension) {
    case 'pdf':
      text = await extractFromPdf(buffer);
      break;
    case 'docx':
      text = await extractFromDocx(buffer);
      break;
    case 'xlsx':
      text = extractFromXlsx(buffer);
      break;
    case 'pptx':
      text = await extractFromPptx(buffer);
      break;
    case 'rtf':
      text = extractFromRtf(buffer);
      break;
    case 'html':
      text = extractFromHtml(buffer);
      break;
    case 'md':
    case 'txt':
    case 'csv':
      text = buffer.toString('utf-8');
      break;
    case 'json':
      text = extractFromJson(buffer);
      break;
    default:
      throw new Error(`Unsupported file extension: .${extension}`);
  }

  // Cap text length for extremely large documents
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH);
  }

  return text;
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  try {
    const pdfjsLib = await getPdfjs();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const doc = await loadingTask.promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str ?? '')
        .join(' ');
      if (pageText.trim()) pages.push(pageText);
    }

    await doc.destroy();
    return pages.join('\n\n');
  } catch (err: any) {
    if (err.message?.includes('encrypt') || err.message?.includes('password')) {
      throw new Error('This document appears to be password-protected. Please upload an unprotected version.');
    }
    throw new Error(`Failed to extract text from PDF: ${err.message}`);
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err: any) {
    if (err.message?.includes('encrypt') || err.message?.includes('password')) {
      throw new Error('This document appears to be password-protected. Please upload an unprotected version.');
    }
    throw new Error(`Failed to extract text from DOCX: ${err.message}`);
  }
}

function extractFromXlsx(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      textParts.push(`--- Sheet: ${sheetName} ---`);
      for (const row of rows) {
        if (Array.isArray(row) && row.length > 0) {
          textParts.push(row.map(cell => String(cell ?? '')).join(' | '));
        }
      }
    }

    return textParts.join('\n');
  } catch (err: any) {
    if (err.message?.includes('encrypt') || err.message?.includes('password')) {
      throw new Error('This document appears to be password-protected. Please upload an unprotected version.');
    }
    throw new Error(`Failed to extract text from XLSX: ${err.message}`);
  }
}

async function extractFromPptx(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const textParts: string[] = [];

    // Slides are stored as ppt/slides/slide1.xml, slide2.xml, etc.
    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
        return numA - numB;
      });

    for (const slidePath of slideFiles) {
      const xml = await zip.files[slidePath].async('string');
      // PowerPoint stores text in <a:t> elements
      const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g);
      if (matches) {
        const slideText = matches
          .map(m => m.replace(/<\/?a:t>/g, ''))
          .filter(t => t.length > 0)
          .join(' ');
        if (slideText.trim()) {
          textParts.push(slideText);
        }
      }
    }

    // Also extract from notes slides
    const noteFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f))
      .sort();
    for (const notePath of noteFiles) {
      const xml = await zip.files[notePath].async('string');
      const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g);
      if (matches) {
        const noteText = matches
          .map(m => m.replace(/<\/?a:t>/g, ''))
          .filter(t => t.length > 0)
          .join(' ');
        if (noteText.trim()) {
          textParts.push(noteText);
        }
      }
    }

    return textParts.join('\n');
  } catch (err: any) {
    if (err.message?.includes('encrypt') || err.message?.includes('password')) {
      throw new Error('This document appears to be password-protected. Please upload an unprotected version.');
    }
    throw new Error(`Failed to extract text from PPTX: ${err.message}`);
  }
}

function extractFromRtf(buffer: Buffer): string {
  try {
    const raw = buffer.toString('utf-8');
    return raw
      // Remove RTF header/preamble groups like {\fonttbl...}, {\colortbl...}
      .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|field)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '')
      // Remove Unicode escape sequences (\uN?) and their ANSI fallback char
      .replace(/\\u-?\d+[?]?/g, '')
      // Remove hex character escapes (\'XX)
      .replace(/\\'[0-9a-f]{2}/gi, '')
      // Remove control words (\word followed by optional number and optional space)
      .replace(/\\[a-z]+\d*\s?/g, '')
      // Remove group delimiters
      .replace(/[{}]/g, '')
      // Remove escaped special characters
      .replace(/\\\\/g, '\\')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err: any) {
    throw new Error(`Failed to extract text from RTF: ${err.message}`);
  }
}

function extractFromHtml(buffer: Buffer): string {
  try {
    let html = buffer.toString('utf-8');
    return html
      // Remove script and style blocks entirely
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Replace block elements with newlines for readability
      .replace(/<\/?(?:div|p|br|h[1-6]|li|tr|td|th|blockquote|pre|hr)[^>]*>/gi, '\n')
      // Remove all remaining HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common HTML entities
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Collapse whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  } catch (err: any) {
    throw new Error(`Failed to extract text from HTML: ${err.message}`);
  }
}

function extractFromJson(buffer: Buffer): string {
  try {
    const raw = buffer.toString('utf-8');
    const parsed = JSON.parse(raw);
    return extractStringsFromJson(parsed).join('\n');
  } catch {
    // If not valid JSON, return raw text (could be JSONL or malformed)
    return buffer.toString('utf-8');
  }
}

function extractStringsFromJson(obj: unknown): string[] {
  const strings: string[] = [];
  if (typeof obj === 'string' && obj.length > 0) {
    strings.push(obj);
  } else if (typeof obj === 'number' || typeof obj === 'boolean') {
    strings.push(String(obj));
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      strings.push(...extractStringsFromJson(item));
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      strings.push(...extractStringsFromJson(val));
    }
  }
  return strings;
}
