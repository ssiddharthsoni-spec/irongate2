/**
 * IronGate Contextual Sensitivity Inference Module
 * =================================================
 *
 * Lightweight browser-side classifier that loads model_weights.json
 * and classifies prompts as SAFE / SENSITIVE / CRITICAL.
 *
 * Usage in the extension:
 *   import { SensitivityClassifier } from './inference.js';
 *   const clf = new SensitivityClassifier();
 *   await clf.load(chrome.runtime.getURL('intelligence/model_weights.json'));
 *   const result = clf.classify("Our client Meridian Health is acquiring...");
 *   // result => { label: "CRITICAL", confidence: 0.94, scores: { SAFE: 0.02, SENSITIVE: 0.04, CRITICAL: 0.94 } }
 */

// --- FEATURE EXTRACTION (mirrors train.py exactly) ---

function extractKeywordFeatures(text, keywordDictionaries) {
  const textLower = text.toLowerCase();
  const features = {};

  for (const [name, keywords] of Object.entries(keywordDictionaries)) {
    let totalWeight = 0;
    let matchCount = 0;
    let maxWeight = 0;

    for (const [keyword, weight] of Object.entries(keywords)) {
      if (textLower.includes(keyword.toLowerCase())) {
        totalWeight += weight;
        matchCount += 1;
        maxWeight = Math.max(maxWeight, weight);
      }
    }

    features[`${name}_total_weight`] = totalWeight;
    features[`${name}_match_count`] = matchCount;
    features[`${name}_max_weight`] = maxWeight;
  }

  return features;
}


function extractStructuralFeatures(text) {
  const features = {};

  features.char_count = text.length;
  features.word_count = text.split(/\s+/).filter(Boolean).length;
  features.sentence_count = Math.max(1, text.split(/[.!?]+/).filter(Boolean).length);

  const codeIndicators = [
    /function\s+\w+\s*\(/, /const\s+\w+\s*=/, /import\s+/,
    /class\s+\w+/, /def\s+\w+/, /=>\s*\{/, /require\(/,
    /\bif\s*\(/, /return\s+/, /\.then\(/, /async\s+/,
  ];
  features.has_code = codeIndicators.some(p => p.test(text)) ? 1 : 0;

  const moneyPattern = /\$[\d,]+(?:\.\d+)?(?:\s*(?:M|B|K|million|billion|thousand))?/g;
  features.money_count = (text.match(moneyPattern) || []).length;
  features.percentage_count = (text.match(/\d+(?:\.\d+)?%/g) || []).length;
  features.proper_noun_count = (text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || []).length;
  features.is_question = text.trim().endsWith('?') ? 1 : 0;
  features.has_imperative = /^(Draft|Prepare|Write|Create|Help|Summarize|Review|Analyze|Explain|Compare|List)/
    .test(text.trim()) ? 1 : 0;
  features.has_specific_numbers = /\b\d{3,}\b/.test(text) ? 1 : 0;
  features.has_dates = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/
    .test(text) ? 1 : 0;
  features.has_names = /(?:Mr\.|Mrs\.|Ms\.|Dr\.|Partner|Client)\s+[A-Z][a-z]+/.test(text) ? 1 : 0;

  const confMarkers = [
    "confidential", "privileged", "do not distribute", "internal only",
    "under nda", "not yet", "hasn't been", "haven't", "before the",
    "undisclosed", "not public", "embargo",
  ];
  const tl = text.toLowerCase();
  features.confidentiality_markers = confMarkers.filter(m => tl.includes(m)).length;

  const urgency = ["today", "tomorrow", "this week", "next week", "immediately", "urgent", "asap"];
  features.urgency_markers = urgency.filter(u => tl.includes(u)).length;

  const piiPatterns = {
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    email: /\b[\w.-]+@[\w.-]+\.\w+\b/,
    phone: /\b(?:\+1\s?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    credit_card: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
    ip_address: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    api_key: /\b(?:sk-|ghp_|gho_|xoxb-|AKIA)[A-Za-z0-9]+/,
    db_uri: /(?:postgres|mysql|mongodb|redis):\/\//,
  };
  const piiTypesFound = Object.values(piiPatterns).filter(p => p.test(text)).length;
  features.pii_type_count = piiTypesFound;
  features.pii_cooccurrence = piiTypesFound >= 2 ? 1 : 0;

  return features;
}


function extractAllFeatures(text, keywordDictionaries) {
  return {
    ...extractKeywordFeatures(text, keywordDictionaries),
    ...extractStructuralFeatures(text),
  };
}


// --- SOFTMAX ---

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map(z => Math.exp(z - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}


// --- CLASSIFIER ---

class SensitivityClassifier {
  constructor() {
    this.weights = null;
    this.ready = false;
  }

  async load(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load model weights: ${resp.status}`);
    this.weights = await resp.json();
    this.ready = true;
    console.log(
      `[IronGate] Sensitivity model loaded - v${this.weights.metadata.version}, ` +
      `${this.weights.metadata.feature_count} features, ` +
      `CV accuracy: ${(this.weights.metadata.cv_accuracy * 100).toFixed(1)}%`
    );
  }

  loadFromObject(weightsObj) {
    this.weights = weightsObj;
    this.ready = true;
  }

  classify(text) {
    if (!this.ready) throw new Error('Model not loaded. Call load() first.');

    const w = this.weights;
    const featureDict = extractAllFeatures(text, w.keyword_dictionaries);
    const featureVector = w.feature_names.map(name => featureDict[name] || 0);
    const scaled = featureVector.map((val, i) =>
      (val - w.scaler.mean[i]) / w.scaler.scale[i]
    );

    const classes = w.metadata.classes;
    const logits = classes.map(cls => {
      const coefs = w.coefficients[cls];
      let logit = w.intercepts[cls];
      for (let i = 0; i < scaled.length; i++) {
        logit += coefs[i] * scaled[i];
      }
      return logit;
    });

    const probs = softmax(logits);

    let maxIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[maxIdx]) maxIdx = i;
    }

    const scores = {};
    classes.forEach((cls, i) => { scores[cls] = Math.round(probs[i] * 1000) / 1000; });

    return {
      label: classes[maxIdx],
      confidence: Math.round(probs[maxIdx] * 1000) / 1000,
      scores,
      features: featureDict,
    };
  }

  classifyBatch(texts) {
    return texts.map(t => this.classify(t));
  }

  explain(text) {
    const result = this.classify(text);
    const reasons = [];

    const tl = text.toLowerCase();
    for (const [dictName, keywords] of Object.entries(this.weights.keyword_dictionaries)) {
      const matches = [];
      for (const [keyword, weight] of Object.entries(keywords)) {
        if (tl.includes(keyword.toLowerCase()) && weight >= 6) {
          matches.push({ keyword, weight });
        }
      }
      if (matches.length > 0) {
        matches.sort((a, b) => b.weight - a.weight);
        const top = matches.slice(0, 3).map(m => `"${m.keyword}" (weight ${m.weight})`);
        reasons.push(`${dictName} keywords: ${top.join(', ')}`);
      }
    }

    const f = result.features;
    if (f.money_count > 0) reasons.push(`Contains ${f.money_count} financial figure(s)`);
    if (f.percentage_count > 0) reasons.push(`Contains ${f.percentage_count} percentage(s)`);
    if (f.proper_noun_count > 0) reasons.push(`Contains ${f.proper_noun_count} named entity/entities`);
    if (f.confidentiality_markers > 0) reasons.push(`${f.confidentiality_markers} confidentiality marker(s) detected`);
    if (f.pii_type_count > 0) reasons.push(`${f.pii_type_count} PII pattern type(s) found`);
    if (f.has_code) reasons.push('Contains code snippets');
    if (f.has_specific_numbers) reasons.push('Contains specific numeric identifiers');

    return {
      label: result.label,
      confidence: result.confidence,
      scores: result.scores,
      topReasons: reasons.slice(0, 8),
    };
  }
}


// --- EXPORTS ---

export { SensitivityClassifier, extractAllFeatures, extractKeywordFeatures, extractStructuralFeatures };

if (typeof globalThis !== 'undefined') {
  globalThis.__IronGateSensitivity = { SensitivityClassifier, extractAllFeatures };
}
