/**
 * Realistic Fake Data Pools
 *
 * Curated pools of realistic-looking fake values for pseudonymization.
 * Used by the hardened pseudonymizer to replace detected PII with
 * believable substitutes that produce natural LLM responses.
 *
 * IMPORTANT: These values must NEVER collide with real data.
 * All names, orgs, and addresses are fictional.
 */

// ─── Person Names ────────────────────────────────────────────────────────────

export const FAKE_NAMES_F: readonly string[] = [
  'Emily Rogers', 'Anna Peterson', 'Lisa Chang', 'Maria Santos', 'Rachel Kim',
  'Diana Walsh', 'Nicole Foster', 'Amanda Brooks', 'Jennifer Liu', 'Stephanie Barnes',
  'Katherine Hayes', 'Laura Bennett', 'Olivia Porter', 'Samantha Reed', 'Victoria Lane',
  'Caroline Webb', 'Natalie Cross', 'Hannah Blair', 'Megan Shore', 'Alicia Grant',
];

export const FAKE_NAMES_M: readonly string[] = [
  'James Mitchell', 'David Kumar', 'Robert Chen', 'William Taylor', 'Thomas Garcia',
  'Andrew Watson', 'Daniel Price', 'Christopher Lee', 'Michael Brown', 'Steven Park',
  'Jonathan Reed', 'Matthew Cole', 'Benjamin Hart', 'Patrick Quinn', 'Marcus Webb',
  'Nathan Cross', 'Gregory Stone', 'Philip Marsh', 'Kenneth Blair', 'Douglas Grant',
];

export const FEMALE_FIRST_NAMES: ReadonlySet<string> = new Set([
  'sarah', 'jennifer', 'lisa', 'maria', 'anna', 'rachel', 'diana', 'nicole', 'amanda', 'jessica',
  'emily', 'laura', 'stephanie', 'katherine', 'olivia', 'samantha', 'victoria', 'helen', 'jane', 'margaret',
  'susan', 'karen', 'nancy', 'betty', 'sandra', 'ashley', 'dorothy', 'kimberly', 'elizabeth', 'donna',
  'caroline', 'natalie', 'hannah', 'megan', 'alicia', 'sophia', 'isabella', 'mia', 'charlotte', 'amelia',
]);

// ─── Organizations ───────────────────────────────────────────────────────────

export const FAKE_ORGS: readonly string[] = [
  'Northwind Technologies', 'Contoso Holdings', 'Adatum Corp', 'Fabrikam Industries',
  'Proseware Solutions', 'Woodgrove Financial', 'Tailspin Partners', 'Lucerne Media',
  'Alpine Securities', 'Meridian Dynamics', 'Coastal Ventures', 'Summit Analytics',
  'Vertex Research', 'Pinnacle Systems', 'Horizon Labs', 'Beacon Strategies',
  'Crestline Capital', 'Silverleaf Consulting', 'Ridgepoint Partners', 'Oakmont Group',
];

// ─── Stock Tickers ───────────────────────────────────────────────────────────

export const FAKE_TICKERS: readonly string[] = [
  'NWND', 'CTSO', 'ADTM', 'FBRK', 'PRWL', 'WDGV', 'TLSP', 'LCNE', 'ALPS', 'MRDX',
  'CSVT', 'SMTA', 'VTXR', 'PNCL', 'HRZL',
];

// ─── Project Names ───────────────────────────────────────────────────────────

export const FAKE_PROJECTS: readonly string[] = [
  'Project Aurora', 'Project Meridian', 'Project Catalyst', 'Project Zenith',
  'Project Atlas', 'Project Nexus', 'Project Titan', 'Project Vanguard',
  'Project Ember', 'Project Falcon', 'Project Horizon', 'Project Summit',
];

// ─── Email Domains ───────────────────────────────────────────────────────────

export const FAKE_EMAIL_DOMAINS: readonly string[] = [
  'northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io',
  'woodgrove.com', 'tailspin.net', 'lucerne.org', 'alpine.io', 'meridian.com',
];

// ─── Addresses ───────────────────────────────────────────────────────────────

export const FAKE_ADDRESSES: readonly string[] = [
  '742 Evergreen Terrace, Springfield, IL 62704',
  '1234 Maple Drive, Suite 300, Portland, OR 97201',
  '567 Oak Boulevard, Austin, TX 78701',
  '890 Pine Street, Denver, CO 80202',
  '2345 Elm Avenue, Boston, MA 02108',
  '678 Cedar Lane, Seattle, WA 98101',
  '1011 Birch Road, Nashville, TN 37201',
  '1213 Walnut Court, Miami, FL 33101',
  '1415 Spruce Way, Chicago, IL 60601',
  '1617 Aspen Circle, San Francisco, CA 94102',
];

export const MONTHS: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
