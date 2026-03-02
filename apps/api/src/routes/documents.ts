import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { detectFirmAware, scoreFirmAware } from '../detection';
import { Pseudonymizer } from '../proxy/pseudonymizer';
import { extractText } from '../extraction';
import { sha256 as hashText } from '@iron-gate/crypto';
import { appendEvent } from '../services/audit-chain';
import type { AppEnv } from '../types';
import { logger } from '../lib/logger';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'txt', 'csv', 'pptx', 'rtf', 'html', 'md', 'json']);

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
      return c.json({ error: `Unsupported file type ".${extension}". Supported: PDF, DOCX, XLSX, PPTX, TXT, CSV, RTF, HTML, MD, JSON.` }, 400);
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

    // 4. Run detection + hash prompt in parallel (both only need extractedText)
    const firmId = c.get('firmId');
    const [detectedEntities, promptHash] = await Promise.all([
      detectFirmAware(extractedText, { firmId }),
      hashText(extractedText),
    ]);

    // 5. Score + pseudonymize in parallel (both need detectedEntities)
    const sessionId = uuidv4();
    const userId = c.get('userId');
    const pseudonymizer = new Pseudonymizer(sessionId, firmId);
    const [scoreResult, pseudonymResult] = await Promise.all([
      scoreFirmAware(extractedText, detectedEntities, { firmId }),
      Promise.resolve(pseudonymizer.pseudonymize(extractedText, detectedEntities)),
    ]);

    // 6. Fire-and-forget audit chain append — don't block the response
    const auditPromise = Promise.all(
      detectedEntities.map(async (e) => ({
        type: e.type,
        textHash: await hashText(e.text),
        start: e.start,
        end: e.end,
        confidence: e.confidence,
        source: e.source,
        length: e.text.length,
      })),
    ).then((minimizedEntities) =>
      appendEvent({
        firmId,
        userId,
        aiToolId: 'document:scan',
        promptHash,
        promptLength: extractedText.length,
        sensitivityScore: scoreResult.score,
        sensitivityLevel: scoreResult.level,
        entities: minimizedEntities,
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
      }),
    ).catch((auditErr) => {
      logger.warn('Audit chain append failed', {
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    });

    // Don't await — let it run in the background
    void auditPromise;

    // 7. Return results immediately
    return c.json({
      fileName,
      fileType: extension,
      fileSize: file.size,
      textLength: extractedText.length,
      entities: detectedEntities.map((e) => ({
        type: e.type,
        start: e.start,
        end: e.end,
        confidence: e.confidence,
        source: e.source,
        length: e.text.length,
      })),
      entitiesFound: detectedEntities.length,
      score: scoreResult.score,
      level: scoreResult.level,
      breakdown: scoreResult.breakdown,
      explanation: scoreResult.explanation,
      originalText: extractedText,
      redactedText: pseudonymResult.maskedText,
      entitiesRedacted: pseudonymResult.entitiesReplaced,
      eventId: null,
    });
  } catch (error) {
    logger.error('Document scan failed', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Failed to scan document.' }, 500);
  }
});
