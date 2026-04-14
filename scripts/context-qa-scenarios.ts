/**
 * IronGate Context-Awareness Test Battery
 *
 * The single source of truth for "when should IronGate step in vs. not."
 * These scenarios define the CORRECT behavior of the detection pipeline
 * across the full spectrum of real knowledge-work queries.
 *
 * CATEGORIES
 *
 * PASS (should NOT flag — these are daily research and work queries):
 *   R — Research on public figures, historical events, journalism
 *   M — Meta-discussion (discussing PII vs. sharing it)
 *   E — Educational / format / security-awareness questions
 *   F — Fictional / creative writing / hypothetical framing
 *   C — Code and technical content (dummy data, regex, APIs)
 *   W — Everyday productivity (weather, recipes, math, science)
 *   L — Legal research on public case law
 *   S — Self-referential (user's own data, resume, bio)
 *
 * CATCH (must flag — real leaks):
 *   P — Classic PII disclosure (SSN, CC, medical, etc.)
 *   K — Credentials (API keys, tokens, passwords)
 *   B — Business confidentiality (M&A, MNPI, strategy)
 *   A — Attorney-client privileged / healthcare PHI
 *   D — Document paste with bulk PII
 *
 * AMBIGUOUS (documented expected behavior for edge cases):
 *   X — Judgment calls where reasonable people could disagree
 *
 * Each scenario is deliberately short (1-2 sentences) and realistic.
 */

export type ContextCategory =
  | 'R' // Research
  | 'M' // Meta-discussion
  | 'E' // Educational
  | 'F' // Fictional / creative
  | 'C' // Code / technical
  | 'W' // Everyday / productivity
  | 'L' // Legal research
  | 'S' // Self-referential
  | 'P' // Classic PII
  | 'K' // Credentials
  | 'B' // Business confidential
  | 'A' // Attorney-client / PHI
  | 'D' // Document paste
  | 'X'; // Ambiguous

export type ExpectedZone = 'green' | 'amber' | 'red';
export type ExpectedAction = 'pass' | 'warn' | 'block' | 'proxy';

export interface ContextScenario {
  id: string;
  category: ContextCategory;
  /** One-line description of the scenario */
  description: string;
  /** The actual prompt a user would type */
  prompt: string;
  /** Expected zone classification */
  expectedZone: ExpectedZone;
  /** Expected action taken (pass | warn | proxy+pseudonymize | block) */
  expectedAction: ExpectedAction;
  /** Values that should NOT be pseudonymized (would break the workflow if replaced) */
  mustNotPseudonymize?: string[];
  /** Values that MUST be pseudonymized (data that would leak if not replaced) */
  mustPseudonymize?: string[];
  /** Why this is the correct behavior — for humans reading the test */
  rationale: string;
  /** Optional tags for filtering */
  tags?: string[];
}

// =============================================================================
// PASS — Research on public figures, historical events, journalism (20)
// =============================================================================

const RESEARCH_SCENARIOS: ContextScenario[] = [
  {
    id: 'R1',
    category: 'R',
    description: 'Asking about a famous tech founder',
    prompt: 'What were the key leadership principles Steve Jobs used at Apple?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Steve Jobs', 'Apple'],
    rationale: 'Public figure + well-known company. Research query about widely-documented public information.',
  },
  {
    id: 'R2',
    category: 'R',
    description: 'Historical political figure',
    prompt: 'Summarize the major foreign policy decisions during the Obama administration.',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Obama'],
    rationale: 'Historical public figure, research query.',
  },
  {
    id: 'R3',
    category: 'R',
    description: 'News article summarization',
    prompt: 'Summarize this article: "Yesterday Warren Buffett announced that Berkshire Hathaway will acquire a stake in..."',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Warren Buffett', 'Berkshire Hathaway'],
    rationale: 'Summarizing publicly-reported news. Names are already public.',
  },
  {
    id: 'R4',
    category: 'R',
    description: 'Author biography',
    prompt: 'What themes did Toni Morrison explore in her novels?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Toni Morrison'],
    rationale: 'Literary research on a widely-studied author.',
  },
  {
    id: 'R5',
    category: 'R',
    description: 'Public company analysis',
    prompt: "Analyze Microsoft's competitive position in cloud computing. How does Satya Nadella's strategy compare to his predecessors?",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Microsoft', 'Satya Nadella'],
    rationale: 'Public company, public CEO, widely-discussed competitive landscape.',
  },
  {
    id: 'R6',
    category: 'R',
    description: 'Scientific researcher bio',
    prompt: "Explain Marie Curie's contributions to the understanding of radioactivity.",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Marie Curie'],
    rationale: 'Historical scientist, educational research query.',
  },
  {
    id: 'R7',
    category: 'R',
    description: 'Journalism research',
    prompt: 'I\'m writing an article about the history of the NYT Pentagon Papers case. What were the key facts?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['NYT', 'Pentagon Papers'],
    rationale: 'Historical journalism / legal case research. Public record.',
  },
  {
    id: 'R8',
    category: 'R',
    description: 'Artist research',
    prompt: 'What period of Pablo Picasso\'s work is most influential in modern cubism?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Pablo Picasso'],
    rationale: 'Art historical research on widely-studied artist.',
  },
  {
    id: 'R9',
    category: 'R',
    description: 'Historical event analysis',
    prompt: 'Describe the economic causes of the 2008 financial crisis and the role of Lehman Brothers.',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Lehman Brothers', '2008'],
    rationale: 'Historical event research. Lehman is a defunct public company.',
  },
  {
    id: 'R10',
    category: 'R',
    description: 'Current events with quoted speech',
    prompt: 'The Fed Chair Jerome Powell said yesterday that inflation remains persistent. What does that signal?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Jerome Powell', 'Fed Chair'],
    rationale: 'Public official making public statement. Market analysis context.',
  },
  {
    id: 'R11',
    category: 'R',
    description: 'Sports commentary',
    prompt: "What's LeBron James' career assist-to-turnover ratio compared to Magic Johnson's?",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['LeBron James', 'Magic Johnson'],
    rationale: 'Sports trivia about public athletes.',
  },
  {
    id: 'R12',
    category: 'R',
    description: 'Academic philosophy research',
    prompt: "Compare Immanuel Kant's categorical imperative with John Stuart Mill's utilitarianism.",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Immanuel Kant', 'John Stuart Mill'],
    rationale: 'Academic philosophy research.',
  },
  {
    id: 'R13',
    category: 'R',
    description: 'Historical military campaign',
    prompt: "What was Dwight Eisenhower's reasoning for the Normandy landing date?",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Dwight Eisenhower', 'Normandy'],
    rationale: 'Military history research.',
  },
  {
    id: 'R14',
    category: 'R',
    description: 'Actor biography',
    prompt: 'What role does Denzel Washington play in his most acclaimed performances?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Denzel Washington'],
    rationale: 'Entertainment industry research on public figure.',
  },
  {
    id: 'R15',
    category: 'R',
    description: 'Economic policy research',
    prompt: "Analyze Janet Yellen's approach to monetary policy during her Fed chairmanship.",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Janet Yellen'],
    rationale: 'Public policy analysis of public official.',
  },
  {
    id: 'R16',
    category: 'R',
    description: 'Public speech analysis',
    prompt: 'Break down the rhetorical structure of Martin Luther King Jr.\'s "I Have a Dream" speech.',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Martin Luther King Jr.'],
    rationale: 'Rhetoric / speech analysis research.',
  },
  {
    id: 'R17',
    category: 'R',
    description: 'Inventor research',
    prompt: "What patents did Thomas Edison hold that are still foundational to today's electrical industry?",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Thomas Edison'],
    rationale: 'Historical innovation research.',
  },
  {
    id: 'R18',
    category: 'R',
    description: 'Research prompt explicitly marked',
    prompt: "I'm doing research about the career of Ruth Bader Ginsburg. What were her landmark cases?",
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Ruth Bader Ginsburg'],
    rationale: 'Explicit research framing + public judicial figure. Case analysis of public record.',
  },
  {
    id: 'R19',
    category: 'R',
    description: 'Public figure health issue (reported in press)',
    prompt: 'What did the press report about Tom Hanks when he was diagnosed with COVID-19 in 2020?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Tom Hanks', 'COVID-19', '2020'],
    rationale: 'Widely-reported public health disclosure by a public figure. Not a privacy concern for us to reference.',
  },
  {
    id: 'R20',
    category: 'R',
    description: 'Global leader research',
    prompt: 'How has Volodymyr Zelensky\'s leadership style evolved during the war?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Volodymyr Zelensky'],
    rationale: 'Global political figure, news-driven research.',
  },
];

// =============================================================================
// PASS — Meta-discussion (talking ABOUT PII, not sharing it) (15)
// =============================================================================

const META_SCENARIOS: ContextScenario[] = [
  {
    id: 'M1',
    category: 'M',
    description: 'Asking about policy',
    prompt: 'What\'s our firm\'s policy on handling client SSNs when onboarding a new patient?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Asking ABOUT SSN handling — no actual SSN shared. Policy discussion.',
  },
  {
    id: 'M2',
    category: 'M',
    description: 'Security training material',
    prompt: 'Help me draft a training slide explaining what PII is and why we must protect it.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Meta-discussion about PII — not a PII disclosure.',
  },
  {
    id: 'M3',
    category: 'M',
    description: 'Compliance framework question',
    prompt: 'What does HIPAA require when storing patient Social Security Numbers?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'HIPAA/policy question. Discussing requirements, not sharing data.',
  },
  {
    id: 'M4',
    category: 'M',
    description: 'Format explanation',
    prompt: 'What\'s the format of a US Social Security Number? Example: XXX-XX-XXXX',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Format question with placeholder example. No real SSN.',
  },
  {
    id: 'M5',
    category: 'M',
    description: 'Detection engine question',
    prompt: 'How does a DLP system identify credit card numbers in text?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Technical question about DLP systems.',
  },
  {
    id: 'M6',
    category: 'M',
    description: 'Research on privacy law',
    prompt: 'Summarize the key differences between GDPR and CCPA in how they define personal data.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Privacy law research. No actual personal data discussed.',
  },
  {
    id: 'M7',
    category: 'M',
    description: 'Training a new employee',
    prompt: 'Explain to a new associate what kinds of information are considered attorney-client privileged.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Training content about privilege, not privileged info itself.',
  },
  {
    id: 'M8',
    category: 'M',
    description: 'Incident response planning',
    prompt: 'What should our response plan be if a staff member accidentally emails a patient record externally?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Hypothetical policy discussion, not actual incident disclosure.',
  },
  {
    id: 'M9',
    category: 'M',
    description: 'Data retention policy',
    prompt: 'How long should a law firm retain matter files after case closure per ABA guidelines?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Professional responsibility / retention policy question.',
  },
  {
    id: 'M10',
    category: 'M',
    description: 'PII awareness quiz',
    prompt: 'Give me 10 quiz questions to test our staff\'s awareness of what constitutes PII.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Training content generation.',
  },
  {
    id: 'M11',
    category: 'M',
    description: 'Vendor risk assessment',
    prompt: 'What questions should we ask a SaaS vendor about their handling of client credentials?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Vendor due diligence / security assessment.',
  },
  {
    id: 'M12',
    category: 'M',
    description: 'Third-party risk',
    prompt: 'If a contractor needs access to our client database, what safeguards should we put in place?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Hypothetical security architecture discussion.',
  },
  {
    id: 'M13',
    category: 'M',
    description: 'Breach notification',
    prompt: 'What are the state-by-state breach notification thresholds for exposed SSNs?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Legal research on breach notification law.',
  },
  {
    id: 'M14',
    category: 'M',
    description: 'Risk matrix draft',
    prompt: 'Draft a risk matrix for handling patient PHI across our clinics.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Risk management planning, not PHI disclosure.',
  },
  {
    id: 'M15',
    category: 'M',
    description: 'HIPAA training outline',
    prompt: 'Outline a 30-minute HIPAA training module for new clinical staff.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Training curriculum development.',
  },
];

// =============================================================================
// PASS — Educational / format / security-awareness (10)
// =============================================================================

const EDUCATIONAL_SCENARIOS: ContextScenario[] = [
  {
    id: 'E1',
    category: 'E',
    description: 'Format question with placeholder',
    prompt: 'What does a US passport number look like? Is it always 9 characters?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Format question. No real passport number.',
  },
  {
    id: 'E2',
    category: 'E',
    description: 'Credit card structure',
    prompt: 'Explain the Luhn algorithm and how it validates credit card numbers.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Educational question about validation algorithms.',
  },
  {
    id: 'E3',
    category: 'E',
    description: 'Phone number formats',
    prompt: 'What are the common international phone number formats I should support in my app\'s input form?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Technical formatting question.',
  },
  {
    id: 'E4',
    category: 'E',
    description: 'Routing number explanation',
    prompt: 'How do bank routing numbers work? Are they the same in every country?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Educational question about banking systems.',
  },
  {
    id: 'E5',
    category: 'E',
    description: 'ABA checksum',
    prompt: 'What\'s the ABA routing number checksum algorithm?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Algorithm question.',
  },
  {
    id: 'E6',
    category: 'E',
    description: 'API key format examples',
    prompt: 'What do different LLM provider API key formats look like? (OpenAI, Anthropic, etc.)',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Developer education question. Just format discussion.',
  },
  {
    id: 'E7',
    category: 'E',
    description: 'Date format question',
    prompt: 'What\'s the ISO 8601 date format standard? Show me the common variations.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Technical standards question.',
  },
  {
    id: 'E8',
    category: 'E',
    description: 'VIN structure',
    prompt: 'What do the 17 characters of a VIN encode about a vehicle?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Automotive education question.',
  },
  {
    id: 'E9',
    category: 'E',
    description: 'Medical record numbering',
    prompt: 'How do hospitals typically structure Medical Record Numbers (MRN)?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Educational question about healthcare identifiers.',
  },
  {
    id: 'E10',
    category: 'E',
    description: 'Example-based learning',
    prompt: 'Show me an example of a well-structured HIPAA-compliant patient intake form (use placeholder names).',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicit placeholder framing. No real patient data.',
  },
];

// =============================================================================
// PASS — Fictional / creative / hypothetical (15)
// =============================================================================

const FICTIONAL_SCENARIOS: ContextScenario[] = [
  {
    id: 'F1',
    category: 'F',
    description: 'Novel scene with fictional character',
    prompt: 'Write a novel scene where detective Sarah Johnson confronts the suspect about the fake SSN 123-45-6789.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicit fictional framing. Novel scene with character.',
    tags: ['strong-fiction'],
  },
  {
    id: 'F2',
    category: 'F',
    description: 'Short story',
    prompt: "Write a short story about a teacher named Maria who discovers her student's family secret.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Creative writing prompt with fictional characters.',
  },
  {
    id: 'F3',
    category: 'F',
    description: 'Screenplay dialogue',
    prompt: 'Draft a courtroom scene dialogue between a defense attorney and a hostile witness named Robert Johnson.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Screenwriting task with fictional character.',
  },
  {
    id: 'F4',
    category: 'F',
    description: 'Roleplay scenario',
    prompt: "Let's roleplay: you're a 1920s private investigator named Sam Hayden and I'm a client hiring you. Start the conversation.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicit roleplay with fictional character.',
  },
  {
    id: 'F5',
    category: 'F',
    description: 'Game NPC dialogue',
    prompt: 'Write 5 lines of dialogue for an NPC shopkeeper named Brenna in my fantasy RPG.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Game content generation.',
  },
  {
    id: 'F6',
    category: 'F',
    description: 'Children\'s story',
    prompt: 'Write a children\'s story about a rabbit named Benjamin who learns about sharing.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Creative writing with fictional animal character.',
  },
  {
    id: 'F7',
    category: 'F',
    description: 'Poem with invented characters',
    prompt: 'Write a poem about two old friends, Clara and Diego, reconnecting after 20 years.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Poetry with invented characters.',
  },
  {
    id: 'F8',
    category: 'F',
    description: 'Hypothetical scenario',
    prompt: 'If a hypothetical attorney had a client named John Doe who gave him an SSN of 000-00-0000, what should the attorney do?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicit hypothetical framing with obvious placeholder values.',
  },
  {
    id: 'F9',
    category: 'F',
    description: 'Writing prompt',
    prompt: "I'm a fiction writer. Give me a novel opening where the protagonist discovers a hidden letter from 1942.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicit creative writing request.',
  },
  {
    id: 'F10',
    category: 'F',
    description: 'Screenplay sample',
    prompt: "Help me write a scene for my screenplay where the CEO, a character named Margaret Chen, has to reveal the company's financial trouble.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Screenwriting with fictional character.',
  },
  {
    id: 'F11',
    category: 'F',
    description: 'Make up an example',
    prompt: "Invent a fake medical case study for my pharmacology class: patient age 45, fake name, fake condition, realistic but fictional.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicitly requests fictional / made-up content.',
  },
  {
    id: 'F12',
    category: 'F',
    description: 'Historical fiction',
    prompt: "Write a historical fiction opening set in 1912 where the protagonist is a (fictional) nurse named Evelyn boarding the Titanic.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Historical fiction with clearly fictional character.',
  },
  {
    id: 'F13',
    category: 'F',
    description: 'D&D campaign',
    prompt: "I'm running a D&D campaign. Generate a character sheet for a rogue named Lyra with stats.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Tabletop RPG content.',
  },
  {
    id: 'F14',
    category: 'F',
    description: 'Sci-fi worldbuilding',
    prompt: "For my sci-fi novel, describe a 22nd-century character named Zara Okafor who's a lunar colony engineer.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Creative worldbuilding with fictional character.',
  },
  {
    id: 'F15',
    category: 'F',
    description: 'Thriller scene',
    prompt: "Write a tense thriller scene where an FBI agent interrogates a suspect about a fake $2.5M wire transfer. Fictional names only.",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Creative writing with explicit "fictional names only" framing.',
  },
];

// =============================================================================
// PASS — Code and technical (15)
// =============================================================================

const CODE_SCENARIOS: ContextScenario[] = [
  {
    id: 'C1',
    category: 'C',
    description: 'Dummy data in code',
    prompt: 'Debug this test case: `const testUser = { name: "John Doe", ssn: "000-00-0000" };`',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Code context with obvious dummy values.',
  },
  {
    id: 'C2',
    category: 'C',
    description: 'Regex for validation',
    prompt: 'Write a regex that validates US phone numbers in the format (XXX) XXX-XXXX.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Format validation regex with placeholder.',
  },
  {
    id: 'C3',
    category: 'C',
    description: 'API documentation example',
    prompt: 'Show me how to call the OpenAI API using the Python SDK. Include the header `Authorization: Bearer sk-test-placeholder`.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Code example with placeholder API key.',
  },
  {
    id: 'C4',
    category: 'C',
    description: 'Database schema',
    prompt: 'Design a SQL schema for a users table with columns for email, phone, and encrypted credit_card_last4.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Schema design discussion.',
  },
  {
    id: 'C5',
    category: 'C',
    description: 'Test fixture',
    prompt: 'Generate a JSON test fixture for 5 fake patient records for my unit tests. Use obviously fake data.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Explicit request for fake test data.',
  },
  {
    id: 'C6',
    category: 'C',
    description: 'Regex for SSN validation',
    prompt: 'Write a JavaScript regex that matches US SSN format. Use `^\\d{3}-\\d{2}-\\d{4}$`.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Regex pattern, not actual SSN.',
  },
  {
    id: 'C7',
    category: 'C',
    description: 'Sample env var',
    prompt: 'What should my .env.example file look like for a Node.js app using OpenAI? Use placeholder values.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Config template with placeholders.',
  },
  {
    id: 'C8',
    category: 'C',
    description: 'Programming error debugging',
    prompt: 'Why is this JavaScript throwing undefined? `console.log(user.creditCardNumber);`',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Code debugging, no actual sensitive value.',
  },
  {
    id: 'C9',
    category: 'C',
    description: 'Type definition',
    prompt: 'Write a TypeScript interface for `Patient { id: string; medicalRecordNumber: string; name: string; }`.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Type definition, not actual data.',
  },
  {
    id: 'C10',
    category: 'C',
    description: 'Curl command example',
    prompt: 'Show me a curl example for POST /login. Include `-H "Authorization: Bearer YOUR_TOKEN_HERE"`.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Documentation example with placeholder.',
  },
  {
    id: 'C11',
    category: 'C',
    description: 'Encryption code question',
    prompt: 'Write Python code using the `cryptography` library to AES-256-GCM encrypt a string.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Crypto library usage, not actual encrypted data.',
  },
  {
    id: 'C12',
    category: 'C',
    description: 'Dockerfile',
    prompt: 'Write a Dockerfile for a Python 3.12 Flask app. Include `ENV OPENAI_API_KEY=`.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Config file with empty env var declaration.',
  },
  {
    id: 'C13',
    category: 'C',
    description: 'Unit test with mocks',
    prompt: 'Write a Vitest unit test for a function that validates credit card numbers. Use test values like `4242 4242 4242 4242`.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: '4242... is Stripe\'s documented test card number — not a real card.',
  },
  {
    id: 'C14',
    category: 'C',
    description: 'Algorithm question',
    prompt: 'Implement the Luhn algorithm in Python. Test with the number 79927398713.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Algorithm test number, classic textbook example.',
  },
  {
    id: 'C15',
    category: 'C',
    description: 'Security vulnerability research',
    prompt: 'What\'s the OWASP top 10 risk category for exposed AWS credentials in code?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Security research question.',
  },
];

// =============================================================================
// PASS — Everyday productivity (10)
// =============================================================================

const EVERYDAY_SCENARIOS: ContextScenario[] = [
  {
    id: 'W1',
    category: 'W',
    description: 'Weather',
    prompt: "What's the weather going to be like in Tokyo next week?",
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Weather lookup.',
  },
  {
    id: 'W2',
    category: 'W',
    description: 'Recipe',
    prompt: 'Give me a recipe for chicken piccata for 4 people.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Recipe request.',
  },
  {
    id: 'W3',
    category: 'W',
    description: 'Math',
    prompt: 'If I save $500/month at 7% annual return, how much will I have after 20 years?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Math question. Dollar amounts are hypothetical.',
  },
  {
    id: 'W4',
    category: 'W',
    description: 'Travel planning',
    prompt: 'Plan a 5-day itinerary for Lisbon with emphasis on food.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Travel planning.',
  },
  {
    id: 'W5',
    category: 'W',
    description: 'Fitness advice',
    prompt: 'Design a beginner strength training program for 3 days per week.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Fitness advice.',
  },
  {
    id: 'W6',
    category: 'W',
    description: 'Science homework',
    prompt: 'Explain how mitochondrial DNA is inherited and why it\'s useful for tracing ancestry.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Science education.',
  },
  {
    id: 'W7',
    category: 'W',
    description: 'Book recommendation',
    prompt: 'Recommend 5 recent non-fiction books about artificial intelligence.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Book recommendation.',
  },
  {
    id: 'W8',
    category: 'W',
    description: 'Language translation',
    prompt: 'How do you say "thank you very much" in Japanese in a formal business context?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Translation query.',
  },
  {
    id: 'W9',
    category: 'W',
    description: 'Grammar help',
    prompt: 'Is it "less" or "fewer" in this sentence: "There are fewer people here today"?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Grammar question.',
  },
  {
    id: 'W10',
    category: 'W',
    description: 'Creative prompt',
    prompt: 'Give me 10 creative ways to stay motivated when working from home.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Productivity / lifestyle advice.',
  },
];

// =============================================================================
// PASS — Legal research on public case law (8)
// =============================================================================

const LEGAL_RESEARCH_SCENARIOS: ContextScenario[] = [
  {
    id: 'L1',
    category: 'L',
    description: 'Landmark case',
    prompt: 'What was the holding in Brown v. Board of Education?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Brown v. Board of Education'],
    rationale: 'Public landmark case — legal research.',
  },
  {
    id: 'L2',
    category: 'L',
    description: 'Recent Supreme Court case',
    prompt: 'Summarize the ruling in Dobbs v. Jackson Women\'s Health Organization.',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Dobbs v. Jackson'],
    rationale: 'Public SCOTUS case, legal research.',
  },
  {
    id: 'L3',
    category: 'L',
    description: 'Criminal procedure',
    prompt: 'What does the ruling in Miranda v. Arizona require of law enforcement?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Miranda v. Arizona'],
    rationale: 'Public criminal procedure case.',
  },
  {
    id: 'L4',
    category: 'L',
    description: 'Corporate law',
    prompt: 'Explain the Revlon duties established in Revlon v. MacAndrews & Forbes Holdings.',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Revlon', 'MacAndrews & Forbes'],
    rationale: 'Public corporate law case.',
  },
  {
    id: 'L5',
    category: 'L',
    description: 'Contract law basics',
    prompt: 'What\'s the difference between a voidable and void contract? Use a hypothetical example.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Legal concept explanation.',
  },
  {
    id: 'L6',
    category: 'L',
    description: 'First Amendment',
    prompt: 'What\'s the legal test for whether speech is protected under the First Amendment?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Constitutional law research.',
  },
  {
    id: 'L7',
    category: 'L',
    description: 'Statute research',
    prompt: 'What does Section 230 of the Communications Decency Act protect?',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Statute research.',
  },
  {
    id: 'L8',
    category: 'L',
    description: 'Legal ethics',
    prompt: 'What does the ABA Model Rule 1.6 say about confidentiality?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['ABA'],
    rationale: 'Professional responsibility research.',
  },
];

// =============================================================================
// PASS — Self-referential (user is the data) (8)
// =============================================================================

const SELF_REFERENTIAL_SCENARIOS: ContextScenario[] = [
  {
    id: 'S1',
    category: 'S',
    description: 'Resume improvement',
    prompt: 'Improve my resume bullet: "Managed a $2M portfolio at Blackstone from 2019 to 2022."',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Self-referential career data. User IS the data.',
  },
  {
    id: 'S2',
    category: 'S',
    description: 'Cover letter help',
    prompt: 'Help me write a cover letter for a senior engineer role at Google. My name is Alex and I have 8 years of experience.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'User\'s own career details for their own application.',
  },
  {
    id: 'S3',
    category: 'S',
    description: 'LinkedIn bio',
    prompt: 'Write a LinkedIn summary for me: senior product manager, 10 years in B2B SaaS, based in Austin.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Self-bio writing.',
  },
  {
    id: 'S4',
    category: 'S',
    description: 'Self-intro',
    prompt: 'Draft a 30-second self-introduction for a networking event. I\'m Sarah, a product designer.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'User\'s own introduction.',
  },
  {
    id: 'S5',
    category: 'S',
    description: 'Personal blog post',
    prompt: 'Help me write a blog post about my decision to leave big tech. I worked at Meta for 7 years as an engineer.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Personal narrative content.',
  },
  {
    id: 'S6',
    category: 'S',
    description: 'Personal email',
    prompt: 'Draft an email to my manager requesting a week off next month. His name is John.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Internal personal correspondence — low sensitivity.',
  },
  {
    id: 'S7',
    category: 'S',
    description: 'Birthday card',
    prompt: 'Write a birthday message for my brother David who just turned 40.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Personal message for family member.',
  },
  {
    id: 'S8',
    category: 'S',
    description: 'Self-coaching',
    prompt: 'I\'m stressed about a promotion interview tomorrow. Give me strategies to prepare.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Personal coaching request.',
  },
];

// =============================================================================
// CATCH — Classic PII disclosure (20)
// =============================================================================

const CLASSIC_PII_SCENARIOS: ContextScenario[] = [
  {
    id: 'P1',
    category: 'P',
    description: 'SSN + client name',
    prompt: 'Help me file paperwork for my client Jessica Marquez, SSN 423-55-8901.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Jessica Marquez', '423-55-8901'],
    rationale: 'Real client + SSN. Classic PII disclosure.',
  },
  {
    id: 'P2',
    category: 'P',
    description: 'Credit card number',
    prompt: 'Authorize charge to card 4532-1488-0343-6467, exp 12/26, cvv 387.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['4532-1488-0343-6467', '387'],
    rationale: 'Full credit card including CVV.',
  },
  {
    id: 'P3',
    category: 'P',
    description: 'Medical record disclosure',
    prompt: 'Patient MRN 2024-88341, Dr. Lisa Chen diagnosed hypertension, started on lisinopril 10mg.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['2024-88341', 'Dr. Lisa Chen'],
    rationale: 'MRN + diagnosis + prescription = HIPAA PHI.',
  },
  {
    id: 'P4',
    category: 'P',
    description: 'Passport + DOB',
    prompt: 'Update visa status for Michael Brown, passport C28481957, DOB 03/12/1985.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Michael Brown', 'C28481957', '03/12/1985'],
    rationale: 'Identity document + DOB combo.',
  },
  {
    id: 'P5',
    category: 'P',
    description: 'Driver\'s license',
    prompt: 'Add employee: James Okonkwo, DL# CA-N2048573, hired 2024.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['James Okonkwo', 'CA-N2048573'],
    rationale: 'Employee ID-level PII.',
  },
  {
    id: 'P6',
    category: 'P',
    description: 'Bank account + routing',
    prompt: 'Wire $12,500 from account 184729501 routing 072000326 to Harold Weston for invoice #4429.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['184729501', '072000326', 'Harold Weston'],
    rationale: 'Bank account + routing + recipient name.',
  },
  {
    id: 'P7',
    category: 'P',
    description: 'HR termination memo',
    prompt: 'Draft termination letter for Kelly Zhang, employee ID EMP-45782, salary $215k, citing performance.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Kelly Zhang', 'EMP-45782', '$215k'],
    rationale: 'HR termination + salary = highly sensitive.',
  },
  {
    id: 'P8',
    category: 'P',
    description: 'Disability filing with SSN',
    prompt: 'My SSN is 123-45-6789 and my name is Sarah Johnson. Help me file for disability benefits.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['123-45-6789', 'Sarah Johnson'],
    rationale: 'SSN + name disclosure regardless of whose.',
  },
  {
    id: 'P9',
    category: 'P',
    description: 'Insurance claim',
    prompt: 'File claim for VIN 1HGBH41JXMN109186, policyholder Roberto Diaz, policy INS-4729182.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['1HGBH41JXMN109186', 'Roberto Diaz', 'INS-4729182'],
    rationale: 'Insurance claim with VIN + name + policy number.',
  },
  {
    id: 'P10',
    category: 'P',
    description: 'Tax return prep',
    prompt: 'Help me prepare 2024 Form 1040 for Tom Fischer, SSN 488-22-9031, W-2 wages $148,000.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Tom Fischer', '488-22-9031'],
    rationale: 'Tax return with SSN + income.',
  },
  {
    id: 'P11',
    category: 'P',
    description: 'Personal phone + home address',
    prompt: "Can you call Alex Park at 415-555-0198 and confirm they're at 2871 Pine Street, San Francisco?",
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Alex Park', '415-555-0198', '2871 Pine Street'],
    rationale: 'Phone + home address + real name.',
  },
  {
    id: 'P12',
    category: 'P',
    description: 'Home address + DOB',
    prompt: 'Verify identity for Marcus Lee, DOB 09/14/1990, home at 4421 Elm Avenue, Boston MA.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Marcus Lee', '09/14/1990', '4421 Elm Avenue'],
    rationale: 'Identity verification data — PII cluster.',
  },
  {
    id: 'P13',
    category: 'P',
    description: 'Loan application',
    prompt: 'Review loan app for Evelyn Carter, SSN 291-80-4512, household income $127,500, requesting $450k mortgage.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Evelyn Carter', '291-80-4512'],
    rationale: 'Full loan application PII.',
  },
  {
    id: 'P14',
    category: 'P',
    description: 'Medical referral',
    prompt: 'Draft a referral for patient Sarah Chen, MRN 2024-55892, DOB 03/15/1978, diagnosed with Stage IIB breast cancer. Send to Dr. James Whitfield at Memorial Sloan Kettering.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Sarah Chen', '2024-55892', '03/15/1978', 'James Whitfield'],
    rationale: 'HIPAA PHI — name + MRN + DOB + diagnosis + physician.',
  },
  {
    id: 'P15',
    category: 'P',
    description: 'Email + DOB + phone (legal)',
    prompt: 'Contact bao.wang@real-firm.com or (202) 555-0026. DOB 04/08/1961. Legal matter pending.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['bao.wang@real-firm.com', '(202) 555-0026', '04/08/1961'],
    rationale: 'Email + phone + DOB + legal context.',
  },
  {
    id: 'P16',
    category: 'P',
    description: 'Adoption paperwork',
    prompt: 'Adoption filing: birth mother Janice Rodriguez, SSN 445-22-7810, birth father unknown.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Janice Rodriguez', '445-22-7810'],
    rationale: 'Highly sensitive family-court PII.',
  },
  {
    id: 'P17',
    category: 'P',
    description: 'Healthcare payment',
    prompt: 'Bill Aetna member ID W871-2982341-04 for patient Walter Reese, CPT code 99213.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['W871-2982341-04', 'Walter Reese'],
    rationale: 'Health insurance + patient identity.',
  },
  {
    id: 'P18',
    category: 'P',
    description: 'Child protective services',
    prompt: 'CPS case 2024-CPS-4782, minor child Ava Thompson age 8, allegation of neglect by parent Karen Thompson.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Ava Thompson', 'Karen Thompson', '2024-CPS-4782'],
    rationale: 'Minor + CPS + identities — extremely sensitive.',
  },
  {
    id: 'P19',
    category: 'P',
    description: 'Immigration file',
    prompt: 'I-485 application for Priya Krishnan, A-number A087-429-178, country of birth India, DOB 07/23/1994.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Priya Krishnan', 'A087-429-178', '07/23/1994'],
    rationale: 'Full immigration file with identifying numbers.',
  },
  {
    id: 'P20',
    category: 'P',
    description: 'Workers comp',
    prompt: 'Workers comp claim for Derek Vargas, SSN 557-19-2038, injury Feb 2024, expected return date unknown.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Derek Vargas', '557-19-2038'],
    rationale: 'Employment + medical + SSN.',
  },
];

// =============================================================================
// CATCH — Credentials (10)
// =============================================================================

const CREDENTIAL_SCENARIOS: ContextScenario[] = [
  {
    id: 'K1',
    category: 'K',
    description: 'OpenAI API key (real format, in debug text)',
    prompt: 'Debug this API request: curl -H "Authorization: Bearer sk-proj-abc123XYZ789defGHI456jklMNO" https://api.openai.com/v1/chat/completions',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['sk-proj-abc123XYZ789defGHI456jklMNO'],
    rationale: 'Real-format OpenAI API key in a request debug context.',
  },
  {
    id: 'K2',
    category: 'K',
    description: 'AWS access key',
    prompt: 'Why is this failing? Access key AKIAIOSFODNN7EXAMPLE and secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY are in the env.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    rationale: 'AWS credentials in plaintext. (Real-format; note: this IS AWS\'s documented example key but the pattern is a P0 detection anyway.)',
  },
  {
    id: 'K3',
    category: 'K',
    description: 'GitHub personal access token',
    prompt: 'My build fails with: export GITHUB_TOKEN=ghp_x9fVz2NpA7LmKjHj8nQoRwP3FsZ1wXcYtEb3',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['ghp_x9fVz2NpA7LmKjHj8nQoRwP3FsZ1wXcYtEb3'],
    rationale: 'GitHub PAT in plaintext.',
  },
  {
    id: 'K4',
    category: 'K',
    description: 'Database connection string with password',
    prompt: 'Why is this connection timing out? postgres://admin:MyS3cretP@ss!@db.prod.internal:5432/mydb',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['MyS3cretP@ss!', 'postgres://admin:MyS3cretP@ss!@db.prod.internal:5432/mydb'],
    rationale: 'DB connection string with real password.',
  },
  {
    id: 'K5',
    category: 'K',
    description: 'Anthropic API key',
    prompt: 'The Python lib says auth failed with sk-ant-api03-Z5x8vK0nLJh7F9rQpT2aE4dW1mMnX6yBcVhGjR9eP1qS2tU3vW5xY6z7',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['sk-ant-api03-Z5x8vK0nLJh7F9rQpT2aE4dW1mMnX6yBcVhGjR9eP1qS2tU3vW5xY6z7'],
    rationale: 'Anthropic API key format.',
  },
  {
    id: 'K6',
    category: 'K',
    description: 'Generic credential header',
    prompt: 'I\'m getting 401 on this request: Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM=',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['YWRtaW46cGFzc3dvcmQxMjM='],
    rationale: 'Base64 basic auth (admin:password123 decoded).',
  },
  {
    id: 'K7',
    category: 'K',
    description: 'JWT token paste',
    prompt: 'Why is this JWT being rejected? eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'],
    rationale: 'JWT with payload — could contain PII if decoded.',
  },
  {
    id: 'K8',
    category: 'K',
    description: 'Private key',
    prompt: 'Parse this: -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAvDn...',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['-----BEGIN RSA PRIVATE KEY-----'],
    rationale: 'Private key header.',
  },
  {
    id: 'K9',
    category: 'K',
    description: 'Stripe live key',
    prompt: 'Help debug this Stripe request with sk_live_51HxYzABc7qRsTuVwXyZ1234567890abcdef...',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['sk_live_51HxYzABc7qRsTuVwXyZ1234567890abcdef'],
    rationale: 'Stripe live secret key.',
  },
  {
    id: 'K10',
    category: 'K',
    description: 'Slack webhook',
    prompt: 'Why is this Slack integration failing? https://hooks.slack.com/services/T12345/B67890/abcdefGHIJKL123456',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['T12345/B67890/abcdefGHIJKL123456'],
    rationale: 'Slack webhook secret URL.',
  },
];

// =============================================================================
// CATCH — Business confidential (15)
// =============================================================================

const BUSINESS_CONFIDENTIAL_SCENARIOS: ContextScenario[] = [
  {
    id: 'B1',
    category: 'B',
    description: 'M&A with named target',
    prompt: 'Confidential: we are acquiring Meridian Health for $2.8B. Draft the LOI framework.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Meridian Health'],
    rationale: 'MNPI — specific M&A target + price. Insider trading risk.',
  },
  {
    id: 'B2',
    category: 'B',
    description: 'Pre-announcement earnings',
    prompt: 'We\'re announcing Q4 earnings Monday. Revenue was $47M vs street estimate $42M. Draft the CEO talking points.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    rationale: 'Pre-release earnings = Reg FD / MNPI.',
  },
  {
    id: 'B3',
    category: 'B',
    description: 'Layoff announcement draft',
    prompt: 'Draft the email to staff announcing we\'re laying off 340 employees across the Austin and Seattle offices next Friday.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    rationale: 'Pre-announcement layoffs — material corporate info.',
  },
  {
    id: 'B4',
    category: 'B',
    description: 'Executive departure',
    prompt: 'CEO Angela Martinez is resigning next week. Draft the internal announcement and board notice.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Angela Martinez'],
    rationale: 'C-suite departure before public disclosure.',
  },
  {
    id: 'B5',
    category: 'B',
    description: 'Trade secret',
    prompt: 'Our proprietary matching algorithm uses a weight of 0.73 on recency and 0.41 on semantic similarity. Compare to published baselines.',
    expectedZone: 'amber',
    expectedAction: 'warn',
    rationale: 'Trade secret with specific parameters.',
  },
  {
    id: 'B6',
    category: 'B',
    description: 'Competitive intel with named competitor',
    prompt: 'Confidential competitive analysis: Nightfall AI\'s pricing starts at $15/user/month, feature gap vs us is... Draft our response strategy.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Nightfall AI'],
    rationale: 'Named competitor + specific internal strategy.',
  },
  {
    id: 'B7',
    category: 'B',
    description: 'Board meeting memo',
    prompt: 'Board memo: we are seeking $40M Series B at $320M post-money. Target closing by Dec 15.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    rationale: 'Non-public fundraising terms.',
  },
  {
    id: 'B8',
    category: 'B',
    description: 'Acquisition settlement',
    prompt: 'Privileged: the Acme Corp lawsuit settlement will be $12.4M. Our reserves only cover $8M — draft the impairment memo.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Acme Corp'],
    rationale: 'Privileged litigation settlement + financial impact.',
  },
  {
    id: 'B9',
    category: 'B',
    description: 'Customer contract breach',
    prompt: 'Draft a notice to Blackstone Capital informing them we\'re in breach of the SLA and will credit them $2M.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Blackstone Capital'],
    rationale: 'Specific customer + financial liability.',
  },
  {
    id: 'B10',
    category: 'B',
    description: 'Regulatory filing draft',
    prompt: 'Draft the 8-K filing announcing our CFO resignation and Q2 restatement.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    rationale: 'Material event SEC filing, pre-filing.',
  },
  {
    id: 'B11',
    category: 'B',
    description: 'Generic M&A without named party',
    prompt: 'Confidential: we are evaluating an acquisition of a competitor for roughly $2B. Draft board talking points.',
    expectedZone: 'amber',
    expectedAction: 'warn',
    rationale: 'Confidential strategy but no named target — amber not red. (Current behavior per live-qa fixes.)',
  },
  {
    id: 'B12',
    category: 'B',
    description: 'News-style M&A (public record)',
    prompt: 'Write a news summary: "According to reports, Microsoft and Activision completed their merger. Goldman Sachs advised on the $68.7B transaction."',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustNotPseudonymize: ['Microsoft', 'Activision', 'Goldman Sachs'],
    rationale: 'Already-public M&A news. But high density of deal signals — IronGate currently scores this red. Reasonable because a news-format prompt can be a cover for real MNPI.',
    tags: ['edge-case'],
  },
  {
    id: 'B13',
    category: 'B',
    description: 'HR investigation',
    prompt: 'Investigation summary for exec Victor Nakamura — allegations of harassment from 3 employees. Draft the termination memo.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Victor Nakamura'],
    rationale: 'HR investigation with named exec.',
  },
  {
    id: 'B14',
    category: 'B',
    description: 'Supplier negotiation',
    prompt: 'Confidential: Apple is demanding we cut pricing by 30% or they\'ll shift volume to Samsung. Response options?',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Apple', 'Samsung'],
    rationale: 'Confidential supplier negotiation with major customer names.',
  },
  {
    id: 'B15',
    category: 'B',
    description: 'Strategic divestiture',
    prompt: 'Project Lighthouse: we\'re selling the EU insurance unit to BNP Paribas for €1.8B. Announcement March 14.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['BNP Paribas', 'Project Lighthouse'],
    rationale: 'Named divestiture counter-party + price + date.',
  },
];

// =============================================================================
// CATCH — Attorney-client privileged / Healthcare PHI (10)
// =============================================================================

const PRIVILEGED_SCENARIOS: ContextScenario[] = [
  {
    id: 'A1',
    category: 'A',
    description: 'Attorney-client privileged',
    prompt: 'PRIVILEGED ATTORNEY-CLIENT: My client, Jeffrey Morton, admits he received the inside information from the CFO. How do I advise him?',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Jeffrey Morton'],
    rationale: 'Explicitly privileged communication with client admission.',
  },
  {
    id: 'A2',
    category: 'A',
    description: 'Case strategy memo',
    prompt: 'Draft a memo on our case strategy for Carter v. StatePharm: we\'ll argue the adjuster knew about the coverage gap.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Carter v. StatePharm'],
    rationale: 'Active case strategy — work product privilege.',
  },
  {
    id: 'A3',
    category: 'A',
    description: 'Client SSN in legal context',
    prompt: 'Draft a settlement demand for my client Robert Johnson (SSN 423-55-8901) seeking $4.2M in damages vs. Acme Corp.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Robert Johnson', '423-55-8901', 'Acme Corp'],
    rationale: 'Client SSN + named counterparty in litigation.',
  },
  {
    id: 'A4',
    category: 'A',
    description: 'Patient psych eval',
    prompt: 'Patient Emily Redding, age 34, presenting with PTSD from childhood trauma. Suggest treatment plan.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Emily Redding'],
    rationale: 'HIPAA PHI — named patient + mental health diagnosis.',
  },
  {
    id: 'A5',
    category: 'A',
    description: 'Pediatric patient',
    prompt: 'Patient is Marcus Webb (age 7), diagnosed with acute lymphoblastic leukemia. Draft the family counseling plan.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Marcus Webb'],
    rationale: 'Pediatric PHI — highly protected.',
  },
  {
    id: 'A6',
    category: 'A',
    description: 'Divorce case',
    prompt: 'Divorce filing: petitioner Lisa Monroe, respondent David Monroe. Grounds irreconcilable differences, custody dispute over 2 minor children.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Lisa Monroe', 'David Monroe'],
    rationale: 'Family court matter with named parties + minors.',
  },
  {
    id: 'A7',
    category: 'A',
    description: 'Criminal defense',
    prompt: 'My criminal defense client Anthony Russo is facing federal wire fraud charges. His story is he didn\'t know the deal was fraudulent. How do I challenge the intent element?',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Anthony Russo'],
    rationale: 'Criminal defense strategy + named defendant.',
  },
  {
    id: 'A8',
    category: 'A',
    description: 'Patient medication reconciliation',
    prompt: 'Patient Nora Abel, DOB 1967-04-23, currently on metformin 1000mg BID, lisinopril 20mg daily, atorvastatin 40mg. Add GLP-1?',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Nora Abel', '1967-04-23'],
    rationale: 'PHI — patient + DOB + full medication list.',
  },
  {
    id: 'A9',
    category: 'A',
    description: 'Employment discrimination case',
    prompt: 'Plaintiff Terrance Glover vs. Zenith Financial: alleging racial discrimination in promotions. Case strategy?',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Terrance Glover', 'Zenith Financial'],
    rationale: 'Active discrimination case with named parties.',
  },
  {
    id: 'A10',
    category: 'A',
    description: 'Bankruptcy filing',
    prompt: 'Ch 11 filing for Harrison Industries, debts of $45M, largest creditor Wells Fargo at $18M. Draft the first-day motions.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['Harrison Industries'],
    rationale: 'Active bankruptcy with named debtor + creditor.',
  },
];

// =============================================================================
// AMBIGUOUS — Documented judgment calls (10)
// =============================================================================

const AMBIGUOUS_SCENARIOS: ContextScenario[] = [
  {
    id: 'X1',
    category: 'X',
    description: 'User\'s own name only',
    prompt: 'My name is Alex Rivera and I\'m writing a cover letter for a marketing role.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Self-referential use of own name for personal task. Low sensitivity.',
    tags: ['judgment-call'],
  },
  {
    id: 'X2',
    category: 'X',
    description: 'Common name alone',
    prompt: 'Draft a thank-you email to John for helping me yesterday.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Common first name without any context. Very low sensitivity.',
    tags: ['judgment-call'],
  },
  {
    id: 'X3',
    category: 'X',
    description: 'Last 4 digits of SSN',
    prompt: 'Verify the account ending in SSN last 4 ****-**-3851 for Patricia.',
    expectedZone: 'amber',
    expectedAction: 'warn',
    rationale: 'Partial SSN. Not a full leak but combined with name becomes identifying.',
    tags: ['judgment-call', 'partial-pii'],
  },
  {
    id: 'X4',
    category: 'X',
    description: 'User\'s own SSN for own use',
    prompt: 'My SSN is 312-45-7890. Help me check my credit report.',
    expectedZone: 'red',
    expectedAction: 'proxy',
    mustPseudonymize: ['312-45-7890'],
    rationale: 'SSN regardless of whose — always should be pseudonymized. User is still sending their SSN to OpenAI.',
    tags: ['judgment-call'],
  },
  {
    id: 'X5',
    category: 'X',
    description: 'Public person + business context',
    prompt: 'Elon Musk is pushing Tesla to sell 3M cars next year. What are the risks?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Elon Musk', 'Tesla'],
    rationale: 'Public CEO + public company + public strategic commentary.',
    tags: ['public-figure'],
  },
  {
    id: 'X6',
    category: 'X',
    description: 'Vendor name only',
    prompt: 'Compare Slack and Microsoft Teams for enterprise collaboration.',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Slack', 'Microsoft Teams'],
    rationale: 'Well-known product comparison, no sensitive context.',
    tags: ['public-product'],
  },
  {
    id: 'X7',
    category: 'X',
    description: 'Common name + business hint',
    prompt: 'Summarize what John Smith told me in Monday\'s meeting about Q4.',
    expectedZone: 'amber',
    expectedAction: 'warn',
    mustPseudonymize: ['John Smith'],
    rationale: '"John Smith" could be an internal colleague whose meeting notes are sensitive. Amber warn is right — protect identity, let user proceed.',
    tags: ['judgment-call'],
  },
  {
    id: 'X8',
    category: 'X',
    description: 'Client name in follow-up turn',
    prompt: 'What did I say last about the Gonzales matter?',
    expectedZone: 'amber',
    expectedAction: 'warn',
    mustPseudonymize: ['Gonzales'],
    rationale: 'Follow-up references matter name — session registry should kick in if prior turn classified it.',
    tags: ['conversation-state'],
  },
  {
    id: 'X9',
    category: 'X',
    description: 'Recurring fictional scene',
    prompt: 'Continue the story we started yesterday about detective Sarah Johnson. She is now interrogating a suspect.',
    expectedZone: 'green',
    expectedAction: 'pass',
    rationale: 'Creative writing continuation — "the story" frames it as fiction.',
    tags: ['conversation-state'],
  },
  {
    id: 'X10',
    category: 'X',
    description: 'Celebrity medical news',
    prompt: 'What did the media report about Prince\'s death in 2016 and the role of fentanyl?',
    expectedZone: 'green',
    expectedAction: 'pass',
    mustNotPseudonymize: ['Prince', 'fentanyl'],
    rationale: 'Widely-reported public health matter. Historical journalism research.',
    tags: ['public-figure', 'health'],
  },
];

// =============================================================================
// Compile all scenarios
// =============================================================================

export const CONTEXT_QA_SCENARIOS: ContextScenario[] = [
  ...RESEARCH_SCENARIOS,
  ...META_SCENARIOS,
  ...EDUCATIONAL_SCENARIOS,
  ...FICTIONAL_SCENARIOS,
  ...CODE_SCENARIOS,
  ...EVERYDAY_SCENARIOS,
  ...LEGAL_RESEARCH_SCENARIOS,
  ...SELF_REFERENTIAL_SCENARIOS,
  ...CLASSIC_PII_SCENARIOS,
  ...CREDENTIAL_SCENARIOS,
  ...BUSINESS_CONFIDENTIAL_SCENARIOS,
  ...PRIVILEGED_SCENARIOS,
  ...AMBIGUOUS_SCENARIOS,
];

// Helper queries
export function scenariosByCategory(cat: ContextCategory): ContextScenario[] {
  return CONTEXT_QA_SCENARIOS.filter((s) => s.category === cat);
}

export function passScenarios(): ContextScenario[] {
  return CONTEXT_QA_SCENARIOS.filter((s) => s.expectedZone === 'green');
}

export function catchScenarios(): ContextScenario[] {
  return CONTEXT_QA_SCENARIOS.filter((s) => s.expectedZone === 'red');
}

// Sanity check: count scenarios
if (import.meta.url === `file://${process.argv[1]}`) {
  const byCategory: Record<string, number> = {};
  for (const s of CONTEXT_QA_SCENARIOS) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  }
  console.log('Total scenarios:', CONTEXT_QA_SCENARIOS.length);
  console.log('By category:', byCategory);
  console.log('Should PASS (green):', passScenarios().length);
  console.log('Should CATCH (red):', catchScenarios().length);
  console.log('Amber/warn:', CONTEXT_QA_SCENARIOS.filter((s) => s.expectedZone === 'amber').length);
}
