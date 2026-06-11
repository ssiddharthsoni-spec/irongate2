// ============================================================================
// Dictionary Detector — data-driven entity detection.
//
// Detects entities by matching against curated dictionaries. Adding a new
// brand is a one-line entry, not a regex patch. This is the structural fix
// for "Salesforce not detected" — the dictionary is policy, not mechanism.
//
// Pure function. No Chrome APIs. No side effects.
// ============================================================================

import type { Detection } from '../../contracts/entities';
import type { Detector } from './interface';

/** A dictionary entry: a known string that maps to an entity type. */
export interface DictionaryEntry {
  /** The text to match (case-sensitive by default) */
  text: string;
  /** Entity type to assign on match */
  type: string;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Case-sensitive matching (default: true for proper nouns) */
  caseSensitive?: boolean;
}

/** Built-in brand dictionary. Extends with firm lexicon at runtime. */
const BRAND_DICTIONARY: DictionaryEntry[] = [
  // Top SaaS / Tech
  ...['Salesforce', 'Stripe', 'Shopify', 'Notion', 'Figma', 'Datadog',
    'Twilio', 'Snowflake', 'Palantir', 'Databricks', 'Confluent',
    'Cloudflare', 'Okta', 'Zendesk', 'Atlassian', 'Workday',
    'ServiceNow', 'Splunk', 'MongoDB', 'Supabase',
    'Vercel', 'Netlify', 'Fastly', 'Akamai', 'Zscaler',
    'CrowdStrike', 'SentinelOne', 'Fortinet',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // FAANG / Big Tech
  ...['Google', 'Apple', 'Amazon', 'Microsoft', 'Meta', 'Netflix',
    'Tesla', 'Nvidia', 'Intel', 'AMD', 'Qualcomm', 'Broadcom',
    'Oracle', 'SAP', 'Adobe', 'Autodesk', 'Intuit',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // Finance
  ...['Blackstone', 'Citadel', 'Bloomberg', 'Fidelity', 'Schwab',
    'Vanguard', 'Visa', 'Mastercard', 'PayPal', 'Square', 'Robinhood',
    'Coinbase', 'Binance', 'Revolut', 'Plaid', 'Marqeta',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // Enterprise / Industrial
  ...['Siemens', 'Honeywell', 'Caterpillar', 'Deere', 'Boeing',
    'Airbus', 'Raytheon', 'Lockheed', 'Northrop',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // Consulting
  ...['Deloitte', 'Accenture', 'McKinsey', 'Gartner', 'Forrester',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // Pharma
  ...['Pfizer', 'Moderna', 'Merck', 'Novartis', 'Roche',
    'AstraZeneca', 'Amgen', 'Gilead', 'Regeneron', 'Illumina',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // Consumer
  ...['Nike', 'Adidas', 'Starbucks', 'Walmart', 'Costco', 'Target',
    'Disney', 'Spotify', 'Uber', 'Airbnb', 'DoorDash', 'Instacart',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
  // Test / Fictional
  ...['Fabrikam', 'Contoso', 'Proseware', 'Northwind', 'Adatum',
  ].map(t => ({ text: t, type: 'ORGANIZATION', confidence: 0.55 })),
];

/**
 * Create a dictionary detector from a list of entries.
 *
 * @param id - Detector ID (e.g., 'dict-brands', 'dict-firm-lexicon')
 * @param name - Human-readable name
 * @param entries - Dictionary entries to match against
 */
export function createDictionaryDetector(
  id: string,
  name: string,
  entries: DictionaryEntry[],
): Detector {
  // Pre-compute entity types for the registry
  const entityTypes = [...new Set(entries.map(e => e.type))];

  return {
    id,
    name,
    source: 'dictionary',
    entityTypes,

    detect(text: string): Detection[] {
      const detections: Detection[] = [];

      for (const entry of entries) {
        const searchText = entry.caseSensitive === false ? text.toLowerCase() : text;
        const matchText = entry.caseSensitive === false ? entry.text.toLowerCase() : entry.text;

        // Word-boundary search using regex
        const escaped = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = entry.caseSensitive === false ? 'gi' : 'g';
        const re = new RegExp(`\\b${escaped}\\b`, flags);

        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          detections.push({
            type: entry.type,
            text: m[0],
            start: m.index,
            end: m.index + m[0].length,
            confidence: entry.confidence,
            source: 'dictionary',
          });
        }
      }

      return detections;
    },
  };
}

/** The built-in brand dictionary detector. */
export const brandDictionaryDetector = createDictionaryDetector(
  'dict-brands',
  'Brand Dictionary',
  BRAND_DICTIONARY,
);
