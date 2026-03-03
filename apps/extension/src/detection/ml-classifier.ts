/**
 * ML Classifier wrapper.
 * Lazy-loads the SensitivityClassifier from intelligence/inference.js
 * and gates it behind Pro+ tier.
 */

import { isPro } from '../shared/tier-gate';

interface ClassificationResult {
  label: 'SAFE' | 'SENSITIVE' | 'CRITICAL';
  confidence: number;
  scores: { SAFE: number; SENSITIVE: number; CRITICAL: number };
}

interface SensitivityClassifierInstance {
  load(url: string): Promise<void>;
  classify(text: string): ClassificationResult;
}

let classifier: SensitivityClassifierInstance | null = null;
let loading = false;

async function getClassifier(): Promise<SensitivityClassifierInstance | null> {
  if (classifier) return classifier;
  if (loading) return null;

  loading = true;
  try {
    // Dynamic import of the inference module (JS, no type declarations)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — untyped JS module
    const mod = await import('../../intelligence/inference.js');
    const instance = new mod.SensitivityClassifier() as SensitivityClassifierInstance;
    const weightsUrl = chrome.runtime.getURL('intelligence/model_weights.json');
    await instance.load(weightsUrl);
    classifier = instance;
    return classifier;
  } catch (err) {
    console.warn('[Iron Gate] ML classifier load failed:', err);
    return null;
  } finally {
    loading = false;
  }
}

/**
 * Classify text using the ML model, but only for Pro+ users.
 * Returns null for Basic tier users.
 */
export async function classifyIfPro(text: string): Promise<ClassificationResult | null> {
  const hasPro = await isPro();
  if (!hasPro) return null;

  const clf = await getClassifier();
  if (!clf) return null;

  try {
    return clf.classify(text);
  } catch {
    return null;
  }
}

/**
 * Classify text for ghost detection — runs the classifier even for Basic users
 * but only to generate "what Pro would have caught" hints.
 * Returns null if classifier is not loaded.
 */
export async function classifyForGhost(text: string): Promise<ClassificationResult | null> {
  const clf = await getClassifier();
  if (!clf) return null;

  try {
    return clf.classify(text);
  } catch {
    return null;
  }
}
