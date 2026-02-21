import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/client';
import { events } from '../db/schema';
import { detect, score as scoreText } from '../detection';
import { Pseudonymizer } from '../proxy/pseudonymizer';
import { extractText } from '../extraction';
import type { AppEnv } from '../types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const documentRoutes = new Hono<AppEnv>();

// POST /v1/documents/scan
documentRoutes.post('/scan', async (c) => {
  try {
    // 1. Parse multipart body
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      return c.json({ error: 'No file provided. Upload a file with field name "file".' }, 400);
    }

    // 2. Validate file type and size
    const fileName = file.name || 'unknown';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return c.json({ error: `Unsupported file type ".${extension}". Supported: PDF, DOCX, XLSX.` }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum: 10 MB.` }, 400);
    }

    // 3. Extract text from document
    const buffer = Buffer.from(await file.arrayBuffer());
    let extractedText: string;
    try {
      extractedText = await extractText(buffer, extension);
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to extract text from document.' }, 400);
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return c.json({ error: 'Could not extract any text from this document. It may be a scanned/image-based PDF.' }, 400);
    }

    // 4. Run detection pipeline
    const detectedEntities = detect(extractedText);

    // 5. Score sensitivity
    const scoreResult = scoreText(extractedText, detectedEntities);

    // 6. Pseudonymize (redact)
    const sessionId = uuidv4();
    const firmId = c.get('firmId');
    const userId = c.get('userId');
    const pseudonymizer = new Pseudonymizer(sessionId, firmId);
    const pseudonymResult = pseudonymizer.pseudonymize(extractedText, detectedEntities);

    // 7. Log to events table
    const promptHash = await sha256(extractedText);

    const [inserted] = await db.insert(events).values({
      firmId,
      userId,
      aiToolId: 'document:scan',
      promptHash,
      promptLength: extractedText.length,
      sensitivityScore: scoreResult.score,
      sensitivityLevel: scoreResult.level,
      entities: detectedEntities.map(e => ({
        type: e.type,
        text: e.text,
        start: e.start,
        end: e.end,
        confidence: e.confidence,
        source: e.source,
      })),
      action: 'pass',
      captureMethod: 'upload',
      sessionId,
      metadata: {
        fileName,
        fileType: extension,
        fileSize: file.size,
        textLength: extractedText.length,
        entitiesFound: detectedEntities.length,
      },
    }).returning({ id: events.id });

    // 8. Return results
    return c.json({
      fileName,
      fileType: extension,
      fileSize: file.size,
      textLength: extractedText.length,
      entities: detectedEntities,
      entitiesFound: detectedEntities.length,
      score: scoreResult.score,
      level: scoreResult.level,
      breakdown: scoreResult.breakdown,
      explanation: scoreResult.explanation,
      redactedText: pseudonymResult.maskedText,
      entitiesRedacted: pseudonymResult.entitiesReplaced,
      eventId: inserted.id,
    });
  } catch (error) {
    console.error('[Documents] Scan error:', error);
    return c.json({ error: 'Failed to scan document.' }, 500);
  }
});
