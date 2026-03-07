/**
 * OCR Worker — IG-011
 *
 * Bundles Tesseract.js WASM for in-browser OCR.
 * When a user uploads an image to an AI tool, the image is OCR'd in a Web Worker,
 * then the extracted text is passed through the entity detection pipeline.
 * If sensitive entities are found, a coaching modal is shown.
 *
 * Supported image formats: PNG, JPG, WEBP, BMP, TIFF
 * Target latency: <2s for a typical screenshot on commodity hardware.
 */

import type { DetectedEntity } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OCRResult {
  text: string;
  confidence: number;
  words: OCRWord[];
  processingTimeMs: number;
  imageWidth: number;
  imageHeight: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OCRDetectionResult {
  ocrResult: OCRResult;
  entities: DetectedEntity[];
  sensitivityScore: number;
  sensitivityLevel: string;
}

interface OCRWorkerMessage {
  type: 'ocr_image' | 'get_status';
  requestId: string;
  imageData?: string;   // base64-encoded image
  imageType?: string;    // MIME type
  language?: string;     // Tesseract language code (default: 'eng')
}

interface OCRWorkerResponse {
  requestId: string;
  type: 'ocr_result' | 'status' | 'error';
  result?: OCRResult;
  status?: OCRStatus;
  error?: string;
}

export interface OCRStatus {
  ready: boolean;
  loading: boolean;
  error: string | null;
  engineVersion: string;
}

// ─── Worker State ────────────────────────────────────────────────────────────

let _worker: TesseractWorker | null = null;
let _status: OCRStatus = {
  ready: false,
  loading: false,
  error: null,
  engineVersion: '',
};

// Minimal Tesseract.js worker interface
interface TesseractWorker {
  recognize(image: string | Blob | ImageData): Promise<{
    data: {
      text: string;
      confidence: number;
      words: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;
  terminate(): Promise<void>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the OCR engine. Call once at startup.
 * Lazily loads Tesseract.js WASM.
 */
export async function initOCR(): Promise<void> {
  if (_status.ready || _status.loading) return;
  _status.loading = true;

  try {
    // Dynamic import of Tesseract.js (optional dependency — installed separately)
    // @ts-ignore — tesseract.js may not be installed; initOCR gracefully handles this
    const Tesseract = await import(/* webpackIgnore: true */ 'tesseract.js');
    _worker = await Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('tesseract/tesseract-core-simd.wasm.js'),
      langPath: chrome.runtime.getURL('tesseract/lang-data'),
    }) as unknown as TesseractWorker;

    _status = {
      ready: true,
      loading: false,
      error: null,
      engineVersion: 'tesseract.js-5.x',
    };
    console.log('[Iron Gate OCR] Engine initialized');
  } catch (error) {
    _status = {
      ready: false,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
      engineVersion: '',
    };
    console.warn('[Iron Gate OCR] Failed to initialize:', _status.error);
  }
}

/**
 * Run OCR on a base64-encoded image.
 */
export async function recognizeImage(
  imageBase64: string,
  imageType: string = 'image/png',
): Promise<OCRResult> {
  if (!_worker || !_status.ready) {
    await initOCR();
  }
  if (!_worker) {
    throw new Error('OCR engine not available');
  }

  const startTime = performance.now();

  // Convert base64 to blob for Tesseract
  const binaryStr = atob(imageBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: imageType });

  // Get image dimensions
  let imageWidth = 0;
  let imageHeight = 0;
  try {
    const bitmap = await createImageBitmap(blob);
    imageWidth = bitmap.width;
    imageHeight = bitmap.height;
    bitmap.close();
  } catch {}

  const result = await _worker.recognize(blob);
  const processingTimeMs = performance.now() - startTime;

  return {
    text: result.data.text.trim(),
    confidence: result.data.confidence / 100, // Normalize to 0-1
    words: result.data.words.map((w) => ({
      text: w.text,
      confidence: w.confidence / 100,
      bbox: w.bbox,
    })),
    processingTimeMs,
    imageWidth,
    imageHeight,
  };
}

/**
 * Run OCR + entity detection pipeline on an image.
 * Returns both OCR text and detected entities.
 */
export async function scanImage(
  imageBase64: string,
  imageType: string = 'image/png',
): Promise<OCRDetectionResult> {
  const ocrResult = await recognizeImage(imageBase64, imageType);

  // Skip detection if OCR confidence is very low or no text
  if (ocrResult.text.length < 10 || ocrResult.confidence < 0.3) {
    return {
      ocrResult,
      entities: [],
      sensitivityScore: 0,
      sensitivityLevel: 'low',
    };
  }

  // Import detection and scoring lazily to avoid circular deps
  const { detectWithRegex } = await import('./fallback-regex');
  const { computeScore, scoreToLevel } = await import('./scorer');

  const entities = detectWithRegex(ocrResult.text);
  const scoreResult = computeScore(ocrResult.text, entities);

  return {
    ocrResult,
    entities,
    sensitivityScore: scoreResult.score,
    sensitivityLevel: scoreResult.level,
  };
}

/**
 * Get OCR engine status.
 */
export function getOCRStatus(): OCRStatus {
  return { ..._status };
}

/**
 * Shut down the OCR engine and release resources.
 */
export async function terminateOCR(): Promise<void> {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
    _status = { ready: false, loading: false, error: null, engineVersion: '' };
  }
}
