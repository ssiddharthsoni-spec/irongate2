import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const MAX_TEXT_LENGTH = 500_000;

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
    const data = await pdfParse(buffer);
    return data.text;
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
