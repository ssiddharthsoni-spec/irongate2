export interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'gliner' | 'regex' | 'presidio' | 'keyword';
}

export interface DetectionResult {
  entities: DetectedEntity[];
  processingTimeMs: number;
  modelUsed: 'gliner' | 'regex';
}

export interface ModelStatus {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  modelSize: number;
  backend: 'webgpu' | 'wasm' | 'none';
}

export const DEFAULT_ENTITY_TYPES = [
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'DATE',
  'PHONE_NUMBER',
  'EMAIL',
  'CREDIT_CARD',
  'SSN',
  'MONETARY_AMOUNT',
  'ACCOUNT_NUMBER',
  'IP_ADDRESS',
  'MEDICAL_RECORD',
  'PASSPORT_NUMBER',
  'DRIVERS_LICENSE',
] as const;
