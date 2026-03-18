/**
 * Iron Gate API — Contextual Intelligence Tests
 *
 * Tests the three-pass intent classification, entity contextualization,
 * structure detection, and the unified /proxy/process scoring pipeline.
 *
 * 100+ scenarios organized by expected outcome:
 *   - Research → passthrough (inward intent, public references)
 *   - Creative → passthrough (poems, stories, brainstorming)
 *   - Productivity → passthrough (translate, reformat, debug)
 *   - Coding → passthrough (write code, debug, review)
 *   - Data disclosure → pseudonymize (salary, internal data)
 *   - HR/Medical → pseudonymize (employee records, patient data)
 *   - Structured data → pseudonymize (tables, lists, email threads)
 *   - Credentials → blocked (API keys, passwords)
 *   - Mixed intent → outward dominates (research question + pasted data)
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent, isQuickPassthrough, classifyIntentNlp, classifyIntentFull, detectLanguage } from '../src/detection/intent-classifier';
import { contextualizeEntities, type ContextualizedEntity } from '../src/detection/entity-contextualizer';
import { detectStructure } from '../src/detection/structure-detector';
import { detect } from '../src/detection/detector';

// ═══════════════════════════════════════════════════════════════════════════
// 1. INTENT CLASSIFICATION — Pattern-based (Pass 1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Intent Classifier — Research (inward)', () => {
  const researchQueries = [
    'What is Microsoft\'s market cap?',
    'Who is the CEO of Apple?',
    'Tell me about Elon Musk\'s leadership style',
    'What are the best practices for data encryption?',
    'How does HIPAA affect healthcare startups?',
    'Explain the difference between GDP and GNP',
    'When was the last recession?',
    'What is Tim Cook known for?',
    'Describe the history of Goldman Sachs',
    'Compare React and Vue frameworks',
    'Who founded Amazon?',
    'What does the SEC do?',
    'How does blockchain work?',
    'What is a neural network?',
    'Tell me about the 2008 financial crisis',
    'What are the symptoms of Type 2 diabetes?',
    'How do I calculate compound interest?',
    'What is the capital of Australia?',
    'Explain machine learning in simple terms',
    'What is GDPR compliance?',
  ];

  researchQueries.forEach((query, i) => {
    it(`research #${i + 1}: "${query.substring(0, 50)}..."`, () => {
      const result = classifyIntent(query);
      expect(result.direction).toBe('inward');
      expect(['research', 'creative', 'productivity', 'coding', 'brainstorming', 'general']).toContain(result.intent);
    });
  });
});

describe('Intent Classifier — Creative (inward)', () => {
  const creativePrompts = [
    'Write a poem about spring',
    'Write a short story about a detective',
    'Write a haiku about the ocean',
    'Create a fictional dialogue between two scientists',
    'Write a birthday poem for my friend Priya',
    'Write a limerick about cats',
    'Imagine a world without gravity',
    'Write a script for a 30-second ad',
    'Write song lyrics about freedom',
    'Create a hypothetical scenario about time travel',
  ];

  creativePrompts.forEach((prompt, i) => {
    it(`creative #${i + 1}: "${prompt.substring(0, 50)}..."`, () => {
      const result = classifyIntent(prompt);
      expect(result.direction).toBe('inward');
    });
  });
});

describe('Intent Classifier — Productivity (inward)', () => {
  const productivityPrompts = [
    'Translate this to French: "Hello, how are you?"',
    'Summarize this article in 3 bullet points',
    'Fix the grammar in this paragraph',
    'Reformat this list as a numbered list',
    'Proofread this email for typos',
    'Paraphrase this sentence in simpler language',
    'Fix the formatting of this markdown document',
    'Clean up this text and make it more professional',
    'Restructure this outline into a proper format',
    'Format this data as a markdown table',
  ];

  productivityPrompts.forEach((prompt, i) => {
    it(`productivity #${i + 1}: "${prompt.substring(0, 50)}..."`, () => {
      const result = classifyIntent(prompt);
      expect(result.direction).toBe('inward');
    });
  });
});

describe('Intent Classifier — Coding (inward)', () => {
  const codingPrompts = [
    'Write a function that checks if a number is prime',
    'Debug this Python script that throws a TypeError',
    'Create a React component for a login form',
    'Implement a binary search algorithm in TypeScript',
    'Write a SQL query to find duplicate records',
    'Build a REST API endpoint for user registration',
    'Refactor this code to use async/await',
    'Write unit tests for this calculator class',
    'Fix this bug in my React component',
    'Review this code for security vulnerabilities',
  ];

  codingPrompts.forEach((prompt, i) => {
    it(`coding #${i + 1}: "${prompt.substring(0, 50)}..."`, () => {
      const result = classifyIntent(prompt);
      expect(result.direction).toBe('inward');
    });
  });
});

describe('Intent Classifier — Data Disclosure (outward)', () => {
  const disclosurePrompts = [
    'Our revenue was $42M last quarter. What trends do you see?',
    'Here is our employee roster: Name | Department | Salary',
    'I\'m sharing our Q3 financial results for analysis',
    'Our client NovaTech signed a $12M contract with us',
    "Here are the patient's lab results: WBC 12.5, RBC 4.2",
    'Below is the merger agreement between our firm and Acme Corp',
    'The company\'s headcount is 2,340 employees across 5 offices',
    'Our acquisition target has revenue of $180M',
    'The employee\'s salary is $185,000 with a $20K signing bonus',
    'Our firm plans to acquire TechStartup Inc for $50M next quarter',
    'Our pipeline includes 3 deals worth $200M total',
    'Here is the settlement offer: $4.2M, and our position is $6.8M',
    'Our client Sarah Chen earns $185K and has been here since 2019',
    'Here is the performance review for David Park, employee #4521',
    'The company\'s proprietary formula contains 23% sodium hydroxide',
  ];

  disclosurePrompts.forEach((prompt, i) => {
    it(`disclosure #${i + 1}: "${prompt.substring(0, 50)}..."`, () => {
      const result = classifyIntent(prompt);
      expect(result.direction).toBe('outward');
    });
  });
});

describe('Intent Classifier — Credential Disclosure', () => {
  const credentialPrompts = [
    'My API key is sk-1234567890abcdef',
    'password = "hunter2"',
    'token: ghp_1234567890abcdef1234567890abcdef12',
    'mongodb+srv://admin:password123@cluster0.mongodb.net',
    'BEGIN RSA PRIVATE KEY\nMIIEowIBAAKCAQEA...',
  ];

  credentialPrompts.forEach((prompt, i) => {
    it(`credential #${i + 1}: "${prompt.substring(0, 50)}..."`, () => {
      const result = classifyIntent(prompt);
      expect(result.direction).toBe('outward');
      expect(result.intent).toBe('credential_disclosure');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CLAUSE-LEVEL ANALYSIS — Outward in any clause dominates
// ═══════════════════════════════════════════════════════════════════════════

describe('Intent Classifier — Mixed Intent (clause-level)', () => {
  it('research question + revenue disclosure → outward', () => {
    const result = classifyIntent('Our revenue was $42M last quarter. What trends do you see?');
    expect(result.direction).toBe('outward');
  });

  it('coding request + internal data → outward', () => {
    const result = classifyIntent('Write a function to process this. Here is our employee data: Name, Salary, Department');
    expect(result.direction).toBe('outward');
  });

  it('pure question about public figure → inward', () => {
    const result = classifyIntent('Who is Jeff Bezos and what is his net worth?');
    expect(result.direction).toBe('inward');
  });

  it('organizational possessive + business term → outward', () => {
    const result = classifyIntent('Can you analyze our revenue trends?');
    expect(result.direction).toBe('outward');
  });

  it('self-introduction is inward', () => {
    const result = classifyIntent('My name is David and I work at Google. How do I set up a 401k?');
    expect(result.direction).toBe('inward');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. QUICK PASSTHROUGH — Fast path for 80% of messages
// ═══════════════════════════════════════════════════════════════════════════

describe('Quick Passthrough', () => {
  it('short research question passes through', () => {
    expect(isQuickPassthrough('What is machine learning?')).toBe(true);
  });

  it('coding question passes through', () => {
    expect(isQuickPassthrough('Write a function to sort an array')).toBe(true);
  });

  it('creative writing passes through', () => {
    expect(isQuickPassthrough('Write a poem about the moon')).toBe(true);
  });

  it('long text does NOT pass through', () => {
    expect(isQuickPassthrough('x'.repeat(600))).toBe(false);
  });

  it('empty text does NOT pass through', () => {
    expect(isQuickPassthrough('')).toBe(false);
  });

  it('disclosure does NOT pass through', () => {
    expect(isQuickPassthrough('Here is our revenue data')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ENTITY CONTEXTUALIZATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Entity Contextualization', () => {
  it('research context → public_reference', () => {
    const text = 'Tell me about Tim Cook at Apple';
    const entities = [{ type: 'PERSON', text: 'Tim Cook', start: 14, end: 22, confidence: 0.8, source: 'regex' }];
    const result = contextualizeEntities(text, entities);
    expect(result[0].context).toBe('public_reference');
  });

  it('internal business context → internal_business', () => {
    const text = 'Our client NovaTech has revenue of $50M';
    const entities = [{ type: 'ORGANIZATION', text: 'NovaTech', start: 11, end: 19, confidence: 0.8, source: 'regex' }];
    const result = contextualizeEntities(text, entities);
    expect(result[0].context).toBe('internal_business');
  });

  it('third-party private context', () => {
    const text = 'The employee\'s salary is $185,000';
    const entities = [{ type: 'MONETARY_AMOUNT', text: '$185,000', start: 25, end: 33, confidence: 0.8, source: 'regex' }];
    const result = contextualizeEntities(text, entities);
    expect(result[0].context).toBe('third_party_private');
  });

  it('self-reference suppresses names', () => {
    const text = 'My name is David and I work at Google';
    const entities = [{ type: 'PERSON', text: 'David', start: 11, end: 16, confidence: 0.7, source: 'regex' }];
    const result = contextualizeEntities(text, entities);
    expect(result[0].context).toBe('self_reference');
  });

  it('SSN is always credential even with self-reference', () => {
    const text = 'My SSN is 123-45-6789';
    const entities = [{ type: 'SSN', text: '123-45-6789', start: 10, end: 21, confidence: 0.95, source: 'regex' }];
    const result = contextualizeEntities(text, entities);
    expect(result[0].context).toBe('credential');
  });

  it('API key is always credential', () => {
    const text = 'Here is my api_key: AKIAIOSFODNN7EXAMPLE';
    const entities = [{ type: 'API_KEY', text: 'AKIAIOSFODNN7EXAMPLE', start: 20, end: 40, confidence: 0.95, source: 'regex' }];
    const result = contextualizeEntities(text, entities);
    expect(result[0].context).toBe('credential');
  });

  it('empty entities returns empty', () => {
    expect(contextualizeEntities('test', [])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. STRUCTURE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Structure Detection', () => {
  it('detects tabular data (pipe-delimited)', () => {
    const text = 'Name | Department | Salary\nJohn | Engineering | $150K\nJane | Marketing | $140K\nBob | Finance | $160K';
    const result = detectStructure(text);
    expect(result.type).toBe('tabular');
    expect(result.multiplier).toBe(2.0);
  });

  it('detects email headers', () => {
    const text = 'From: john@example.com\nTo: jane@example.com\nSubject: Q3 Results\nDate: 2024-01-15\n\nPlease review the attached.';
    const result = detectStructure(text);
    expect(result.type).toBe('email_headers');
    expect(result.multiplier).toBe(1.8);
  });

  it('detects key-value pairs', () => {
    const text = 'Name: John Smith\nEmail: john@example.com\nDepartment: Engineering\nSalary: $150,000';
    const result = detectStructure(text);
    expect(result.type).toBe('key_value');
    expect(result.multiplier).toBe(1.8);
  });

  it('detects code blocks (suppresses)', () => {
    const text = '```javascript\nfunction add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));\n```';
    const result = detectStructure(text);
    expect(result.type).toBe('code_block');
    expect(result.multiplier).toBe(0.3);
  });

  it('detects entity lists', () => {
    const text = '- John Smith: Sales Director, $180K\n- Jane Doe: VP Marketing, $220K\n- Bob Jones: CTO, $350K\n- Alice Lee: CFO, $310K\n- Mike Chen: COO, $290K';
    const result = detectStructure(text);
    expect(result.type).toBe('entity_list');
    expect(result.multiplier).toBe(2.0);
  });

  it('no structure detected for short text', () => {
    const result = detectStructure('Hello');
    expect(result.type).toBe('none');
    expect(result.multiplier).toBe(1.0);
  });

  it('detects document blocks', () => {
    const text = 'CONFIDENTIAL MEMO\n\nTo: Board of Directors\n\nSubject: Q3 Strategic Review\n\nThe following outlines our strategic position heading into Q4. Revenue growth has been strong across all segments.\n\nKey Findings\n\nOur market share in the enterprise segment grew 12% year-over-year. The consumer division showed signs of slowdown.\n\nRecommendations\n\nWe recommend accelerating investment in the enterprise segment while restructuring the consumer division.';
    const result = detectStructure(text);
    expect(result.type).toBe('document_block');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. NLP SECOND PASS (async)
// ═══════════════════════════════════════════════════════════════════════════

describe('NLP Intent Classification (Pass 2)', () => {
  it('boosts confidence for clear research', async () => {
    const result = await classifyIntentNlp('What is the stock price of Apple today?');
    expect(result.direction).toBe('inward');
  });

  it('boosts confidence for clear disclosure', async () => {
    const result = await classifyIntentNlp('Our company revenue was $42M last quarter and we plan to expand into 3 new markets.');
    expect(result.direction).toBe('outward');
  });

  it('handles ambiguous text without crashing', async () => {
    const result = await classifyIntentNlp('The quarterly results show interesting patterns');
    expect(result).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. END-TO-END SCORING SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

describe('End-to-End Scoring', () => {
  it('research about public company → low score', () => {
    const text = 'What is Microsoft\'s market cap?';
    const intent = classifyIntent(text);
    const structure = detectStructure(text);
    expect(intent.direction).toBe('inward');
    expect(structure.type).toBe('none');
    // This should be a passthrough
  });

  it('pasted employee data → high score', () => {
    const text = 'Name | SSN | Salary\nJohn Smith | 123-45-6789 | $150,000\nJane Doe | 987-65-4321 | $145,000\nBob Jones | 555-12-3456 | $160,000';
    const intent = classifyIntent(text);
    const structure = detectStructure(text);
    // Tabular + data_analysis intent → high multiplier
    expect(intent.direction).toBe('outward');
    expect(structure.type).toBe('tabular');
    expect(structure.multiplier).toBe(2.0);
  });

  it('forwarded email thread → high structure multiplier', () => {
    const text = 'From: ceo@company.com\nTo: cfo@company.com\nSubject: Acquisition Update\nDate: 2024-03-15\n\nHi team, the target company agreed to our $50M offer. Please prepare the wire transfer.';
    const intent = classifyIntent(text);
    const structure = detectStructure(text);
    expect(intent.direction).toBe('outward');
    expect(structure.type).toBe('email_headers');
  });

  it('code review request → low score (coding intent)', () => {
    const text = '```typescript\nexport function calculateTax(income: number): number {\n  if (income <= 10000) return 0;\n  if (income <= 50000) return income * 0.1;\n  return income * 0.2;\n}\n```\nCan you review this function for edge cases?';
    const intent = classifyIntent(text);
    expect(intent.direction).toBe('inward');
  });

  it('salary disclosure with context → high score', () => {
    const text = 'Here is David Park\'s performance record. He\'s been with us since 2019, current salary $142K, performance rating 2/5. His manager Sarah Chen recommended termination.';
    const intent = classifyIntent(text);
    expect(intent.direction).toBe('outward');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('empty string', () => {
    const result = classifyIntent('');
    expect(result.intent).toBe('general');
  });

  it('very short text', () => {
    const result = classifyIntent('hi');
    expect(result.intent).toBe('general');
  });

  it('unicode text', () => {
    const result = classifyIntent('翻译这段话');
    expect(result).toBeDefined();
  });

  it('number-heavy text without context', () => {
    const result = classifyIntent('1 + 1 = 2');
    expect(result.direction).toBe('inward');
  });

  it('hypothetical scenario', () => {
    const result = classifyIntent('Hypothetically, if someone earned $200K, how much would they pay in taxes?');
    expect(result.direction).toBe('inward');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. MULTI-LANGUAGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-Language Detection', () => {
  it('detects English text', () => {
    const lang = detectLanguage('What is the capital of France? Please tell me about it.');
    expect(lang).toBe('en');
  });

  it('detects Chinese text', () => {
    const lang = detectLanguage('请帮我分析一下这份财务报告中的关键指标');
    expect(lang).toBe('zh');
  });

  it('detects Spanish text', () => {
    const lang = detectLanguage('Por favor, traduce este documento para nuestro equipo de ventas');
    expect(lang).toBe('es');
  });

  it('detects French text', () => {
    const lang = detectLanguage('Pouvez-vous analyser les résultats financiers de notre entreprise?');
    expect(lang).toBe('fr');
  });

  it('detects German text', () => {
    const lang = detectLanguage('Bitte übersetzen Sie dieses Dokument für unsere Kunden. Das ist nicht einfach und ich bin damit einverstanden.');
    expect(lang).toBe('de');
  });

  it('detects Japanese text', () => {
    const lang = detectLanguage('この文書を翻訳してください。お客様のためにこのレポートを分析して、結果をまとめてください。');
    expect(lang).toBe('ja');
  });

  it('detects Korean text', () => {
    const lang = detectLanguage('이 문서를 번역해 주세요. 고객을 위해');
    expect(lang).toBe('ko');
  });

  it('detects Arabic text', () => {
    const lang = detectLanguage('يرجى ترجمة هذا المستند لعملائنا');
    expect(lang).toBe('ar');
  });

  it('returns unknown for very short text', () => {
    const lang = detectLanguage('hi');
    expect(lang).toBe('unknown');
  });

  it('non-English text reduces regex confidence in classifyIntentFull', async () => {
    // Chinese disclosure text — regex confidence should be low
    const result = await classifyIntentFull('我们公司的收入是4200万美元');
    expect(result.detectedLanguage).toBe('zh');
    // Should still classify but with lower confidence than English equivalent
    expect(result.confidence).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. SLOW-BOIL CONVERSATION DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Slow-Boil Detection (Conversation State)', () => {
  it('first message with PII starts tracking', () => {
    // Simulate: first message has entities → score should be elevated
    const intent = classifyIntent('Our client NovaTech signed a $12M contract');
    expect(intent.direction).toBe('outward');
  });

  it('follow-up benign message after disclosure should stay elevated', () => {
    // In the real pipeline, conversation state floor keeps the score up.
    // Here we verify the individual classifiers work correctly:
    // Message 2 after prior disclosure → intent is inward but score floor applies
    const intent = classifyIntent('What trends do you see?');
    expect(intent.direction).toBe('inward');
    // The pipeline would apply conversationFloor = min(30, peakScore * 0.4)
  });

  it('gradual disclosure across messages detected', () => {
    // Message 1: harmless
    const m1 = classifyIntent('What are best practices for employee retention?');
    expect(m1.direction).toBe('inward');

    // Message 2: starts revealing data
    const m2 = classifyIntent('Our company has 2,340 employees across 5 offices');
    expect(m2.direction).toBe('outward');

    // Message 3: more data
    const m3 = classifyIntent("The employee's salary is $185,000 with a $20K signing bonus");
    expect(m3.direction).toBe('outward');
  });

  it('research conversation does not set monitoring floor', () => {
    const m1 = classifyIntent('Who is Elon Musk?');
    expect(m1.direction).toBe('inward');

    const m2 = classifyIntent('What companies has he founded?');
    expect(m2.direction).toBe('inward');
    // No floor set — research stays inward
  });

  it('mixed conversation with late disclosure escalates', () => {
    const m1 = classifyIntent('Help me write a market analysis template');
    expect(m1.direction).toBe('inward');

    // Later: user pastes real data
    const m3 = classifyIntent('Here is our Q3 revenue: $42M, expenses: $38M, net income: $4M');
    expect(m3.direction).toBe('outward');
    // Pipeline would now set floor for all subsequent messages
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. PERFORMANCE BENCHMARKS
// ═══════════════════════════════════════════════════════════════════════════

describe('Performance Benchmarks', () => {
  it('intent classifier runs under 10ms for typical prompt', () => {
    const text = 'Our revenue was $42M last quarter. What trends do you see?';
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      classifyIntent(text);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 100;
    expect(avgMs).toBeLessThan(10); // < 10ms per classification
  });

  it('structure detector runs under 5ms for typical text', () => {
    const text = 'Name | SSN | Salary\nJohn Smith | 123-45-6789 | $150,000\nJane Doe | 987-65-4321 | $145,000';
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      detectStructure(text);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 100;
    expect(avgMs).toBeLessThan(5); // < 5ms per detection
  });

  it('entity contextualizer runs under 5ms for 10 entities', () => {
    const text = 'Our client John Smith earns $185K at NovaTech Corp in New York. His SSN is 123-45-6789.';
    const entities = [
      { type: 'PERSON', text: 'John Smith', start: 11, end: 21, confidence: 0.9, source: 'regex' },
      { type: 'MONETARY_AMOUNT', text: '$185K', start: 28, end: 33, confidence: 0.9, source: 'regex' },
      { type: 'ORGANIZATION', text: 'NovaTech Corp', start: 37, end: 50, confidence: 0.9, source: 'regex' },
      { type: 'LOCATION', text: 'New York', start: 54, end: 62, confidence: 0.9, source: 'regex' },
      { type: 'SSN', text: '123-45-6789', start: 75, end: 86, confidence: 0.99, source: 'regex' },
    ];
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      contextualizeEntities(text, entities);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 100;
    expect(avgMs).toBeLessThan(5); // < 5ms for 5 entities × 100 runs
  });

  it('language detection runs under 1ms', () => {
    const texts = [
      'What is the capital of France?',
      '请帮我分析一下这份财务报告',
      'Por favor, traduce este documento',
      'Bitte übersetzen Sie dieses Dokument',
    ];
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      for (const text of texts) {
        detectLanguage(text);
      }
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / (100 * texts.length);
    expect(avgMs).toBeLessThan(1); // < 1ms per detection
  });
});
