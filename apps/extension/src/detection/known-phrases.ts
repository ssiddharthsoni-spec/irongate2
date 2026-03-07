/**
 * Known Non-PII Phrases Blocklist
 *
 * Phrases that match person-name regex patterns (two capitalized words)
 * but are NOT actual person names. Used to suppress false positives
 * before emitting PERSON entities.
 *
 * Ships with ~200 entries. Firms can extend via managed config
 * (key: `customBlocklist` in firm config).
 */

// ── Financial Institutions & Companies ──────────────────────────────────────

const COMPANIES = [
  'Goldman Sachs', 'Morgan Stanley', 'JP Morgan', 'JPMorgan Chase',
  'Bank America', 'Wells Fargo', 'Charles Schwab', 'Raymond James',
  'Merrill Lynch', 'Deutsche Bank', 'Credit Suisse', 'Barclays Capital',
  'Lehman Brothers', 'Bear Stearns', 'Salomon Brothers', 'Piper Sandler',
  'Jefferies Group', 'Lazard Freres', 'Cantor Fitzgerald',
  'Northern Trust', 'State Street', 'Fidelity Investments',
  'Vanguard Group', 'BlackRock Inc', 'Citadel Securities',
  'Bridgewater Associates', 'Two Sigma', 'Millennium Management',
  'Point72', 'Warburg Pincus', 'Silver Lake', 'General Atlantic',
  'Bain Capital', 'Apollo Global', 'KKR Group', 'Carlyle Group',
  'Berkshire Hathaway', 'General Electric', 'General Motors',
  'General Dynamics', 'Lockheed Martin', 'Northrop Grumman',
  'Raytheon Technologies', 'Boeing Company', 'United Technologies',
  'Procter Gamble', 'Johnson Johnson', 'Bristol Myers',
  'Eli Lilly', 'Pfizer Inc', 'Abbott Laboratories',
  'Estee Lauder', 'Ralph Lauren', 'Calvin Klein', 'Tommy Hilfiger',
  'Michael Kors', 'Vera Wang', 'Kate Spade', 'Tory Burch',
  'Under Armour', 'Dick Sporting', 'Home Depot', 'Dollar General',
  'Dollar Tree', 'Family Dollar', 'Five Below',
  'Ernst Young', 'Deloitte Touche', 'Arthur Andersen',
  'McKinsey Company', 'Boston Consulting', 'Oliver Wyman',
  'Simon Schuster', 'Random House', 'Harper Collins',
  'Warner Bros', 'Universal Studios', 'Paramount Pictures',
  'Twenty First', 'Rolls Royce', 'Aston Martin', 'Land Rover',
  'Mercedes Benz',
];

// ── Law Firms ───────────────────────────────────────────────────────────────

const LAW_FIRMS = [
  'Sullivan Cromwell', 'Skadden Arps', 'Davis Polk',
  'Cravath Swaine', 'Wachtell Lipton', 'Simpson Thacher',
  'Cleary Gottlieb', 'Kirkland Ellis', 'Latham Watkins',
  'White Case', 'Milbank Tweed', 'Debevoise Plimpton',
  'Paul Weiss', 'Willkie Farr', 'Fried Frank',
  'Covington Burling', 'Arnold Porter', 'Morrison Foerster',
  'Gibson Dunn', 'Sidley Austin', 'Jones Day',
  'Baker McKenzie', 'Hogan Lovells', 'Allen Overy',
  'Clifford Chance', 'Linklaters LLP', 'Freshfields Bruckhaus',
  'Norton Rose', 'DLA Piper', 'Reed Smith',
  'King Spalding', 'Mayer Brown', 'Winston Strawn',
  'Orrick Herrington', 'Proskauer Rose', 'Akin Gump',
  'Pillsbury Winthrop', 'Shearman Sterling', 'Cadwalader Wickersham',
  'Dechert LLP', 'Goodwin Procter', 'Ropes Gray',
  'Weil Gotshal',
];

// ── Place Names ─────────────────────────────────────────────────────────────

const PLACES = [
  'New York', 'New Jersey', 'New Hampshire', 'New Mexico',
  'New Orleans', 'New Delhi', 'New Zealand',
  'San Francisco', 'San Diego', 'San Jose', 'San Antonio',
  'San Juan', 'San Salvador', 'Santa Monica', 'Santa Barbara',
  'Santa Cruz', 'Santa Fe', 'Santa Clara',
  'Los Angeles', 'Las Vegas', 'El Paso', 'El Salvador',
  'Des Moines', 'Baton Rouge', 'Grand Rapids',
  'Fort Worth', 'Fort Lauderdale', 'Fort Collins',
  'Little Rock', 'Long Island', 'Long Beach',
  'Palo Alto', 'Monte Carlo', 'Costa Rica', 'Puerto Rico',
  'Hong Kong', 'Sri Lanka', 'Saudi Arabia', 'South Africa',
  'South Korea', 'South Carolina', 'South Dakota',
  'North Carolina', 'North Dakota', 'North Korea',
  'West Virginia', 'Rhode Island', 'District Columbia',
  'Cape Town', 'Buenos Aires', 'Rio Janeiro',
  'Silicon Valley', 'Wall Street', 'Main Street',
  'Palm Beach', 'Virginia Beach', 'Myrtle Beach',
  'Atlantic City', 'Kansas City', 'Salt Lake',
  'Ann Arbor', 'Corpus Christi', 'Colorado Springs',
  'Cedar Rapids', 'Boca Raton', 'Key West',
  'Martha Vineyard', 'Niagara Falls', 'Lake Tahoe',
  'Mount Vernon', 'Pearl Harbor',
  'Tel Aviv', 'Kuala Lumpur', 'Addis Ababa',
  'Sierra Leone', 'Ivory Coast', 'Burkina Faso',
];

// ── Technical Terms ─────────────────────────────────────────────────────────

const TECHNICAL = [
  'Data Science', 'Data Engineering', 'Data Analytics',
  'Machine Learning', 'Deep Learning', 'Natural Language',
  'Computer Science', 'Computer Vision', 'Artificial Intelligence',
  'Product Management', 'Project Management', 'Risk Management',
  'Supply Chain', 'Due Diligence', 'Best Practices',
  'Open Source', 'Pull Request', 'Code Review',
  'User Experience', 'User Interface', 'Front End', 'Back End',
  'Full Stack', 'Cloud Computing', 'Edge Computing',
  'Quality Assurance', 'Quality Control',
  'Human Resources', 'Public Relations', 'Investor Relations',
  'Corporate Finance', 'Private Equity', 'Venture Capital',
  'Capital Markets', 'Fixed Income', 'Real Estate',
  'Intellectual Property', 'Trade Secret', 'Non Disclosure',
  'Board Directors', 'Chief Executive', 'Chief Financial',
  'Chief Technology', 'Chief Operating', 'Vice President',
  'Managing Director', 'Senior Associate', 'Junior Associate',
  'General Counsel', 'Outside Counsel', 'In House',
  'Pro Bono', 'Per Diem', 'Ad Hoc',
  'Year End', 'Quarter End', 'Month End',
  'Top Secret', 'High Priority', 'Low Priority',
  'Time Series', 'Cross Section', 'Monte Carlo',
  'Black Scholes', 'Value Risk', 'Mark Market',
  'Total Return', 'Net Asset', 'Gross Domestic',
  'Federal Reserve', 'Central Bank', 'Interest Rate',
  'Exchange Rate', 'Market Cap', 'Price Earnings',
  'Cash Flow', 'Balance Sheet', 'Income Statement',
  'Working Capital', 'Cost Goods', 'Return Investment',
  'Net Present', 'Internal Rate', 'Break Even',
];

// ── Build the lookup set ────────────────────────────────────────────────────

function buildBlocklistSet(lists: string[][]): Set<string> {
  const set = new Set<string>();
  for (const list of lists) {
    for (const phrase of list) {
      set.add(phrase.toLowerCase());
    }
  }
  return set;
}

/** Static blocklist of known non-PII phrases (case-insensitive lookup) */
export const KNOWN_NON_PII: ReadonlySet<string> = buildBlocklistSet([
  COMPANIES, LAW_FIRMS, PLACES, TECHNICAL,
]);

/** Extend the blocklist at runtime (e.g., from managed config) */
let _customBlocklist: Set<string> = new Set();

export function setCustomBlocklist(phrases: string[]): void {
  _customBlocklist = new Set(phrases.map(p => p.toLowerCase()));
}

/**
 * Check if a phrase is a known non-PII false positive.
 * Returns true if the phrase should NOT be emitted as a PERSON entity.
 */
export function isKnownNonPII(phrase: string): boolean {
  const lower = phrase.toLowerCase().trim();
  return KNOWN_NON_PII.has(lower) || _customBlocklist.has(lower);
}
