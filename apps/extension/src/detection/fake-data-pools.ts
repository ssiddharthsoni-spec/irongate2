/**
 * Realistic Fake Data Pools
 *
 * Curated pools of realistic-looking fake values for pseudonymization.
 * Used by the hardened pseudonymizer to replace detected PII with
 * believable substitutes that produce natural LLM responses.
 *
 * IMPORTANT: These values must NEVER collide with real data.
 * All names, orgs, and addresses are fictional.
 *
 * Enterprise scale: 100+ names per gender, 80+ orgs, diverse ethnicities.
 */

// ─── Person Names ────────────────────────────────────────────────────────────

export const FAKE_NAMES_F: readonly string[] = [
  // Anglo/European
  'Emily Rogers', 'Anna Peterson', 'Lisa Chang', 'Maria Santos', 'Rachel Kim',
  'Diana Walsh', 'Nicole Foster', 'Amanda Brooks', 'Jennifer Liu', 'Stephanie Barnes',
  'Katherine Hayes', 'Laura Bennett', 'Olivia Porter', 'Samantha Reed', 'Victoria Lane',
  'Caroline Webb', 'Natalie Cross', 'Hannah Blair', 'Megan Shore', 'Alicia Grant',
  'Claire Donovan', 'Ingrid Larsen', 'Fiona Gallagher', 'Chloe Beaumont', 'Vera Nishimura',
  'Abigail Thornton', 'Penelope Drake', 'Evelyn Whitmore', 'Grace Ashford', 'Lydia Blackwell',
  'Charlotte Pemberton', 'Audrey Lockwood', 'Josephine Carver', 'Margaret Ainsley', 'Cordelia Farnsworth',
  'Adelaide Ravencroft', 'Beatrice Holloway', 'Genevieve Caldwell', 'Rosalind Pemberton', 'Harriet Kensington',
  'Winifred Applegate', 'Prudence Latchford', 'Millicent Sedgwick', 'Constance Hargrove', 'Agnes Whitfield',
  // South Asian
  'Priya Sharma', 'Nadia Karim', 'Anika Desai', 'Lakshmi Venkatesh', 'Shalini Kapoor',
  'Deepika Nair', 'Kavita Choudhury', 'Sunita Bajaj', 'Meera Krishnan', 'Pooja Ranganathan',
  'Indira Bhatia', 'Anjali Mehrotra', 'Rekha Subramaniam', 'Savitri Goswami', 'Padma Iyer',
  // East Asian
  'Yuki Tanaka', 'Mei-Lin Wu', 'Haruka Sato', 'Soo-Jin Park', 'Xiao-Wen Li',
  'Akiko Nakamura', 'Hye-Young Choi', 'Ting-Ting Chen', 'Noriko Fujimoto', 'Ji-Eun Kang',
  'Sakura Mori', 'Lan Nguyen', 'Midori Hayashi', 'Bo-Yeon Kim', 'Yun-Hee Song',
  // Latin American
  'Elena Vasquez', 'Carmen Reyes', 'Rosa Bianchi', 'Isabela Ferreira', 'Valentina Rojas',
  'Gabriela Castillo', 'Lucia Espinoza', 'Marisol Delgado', 'Paloma Guerrero', 'Ximena Salazar',
  'Dolores Navarro', 'Catalina Montoya', 'Renata Pereira', 'Florencia Aguirre', 'Adriana Córdova',
  // African
  'Aisha Okonkwo', 'Fatima Al-Rashid', 'Amara Diallo', 'Zainab Bakare', 'Chioma Nwachukwu',
  'Nneka Obi', 'Adaeze Igwe', 'Temitope Adeyemi', 'Folasade Olawale', 'Busayo Akinola',
  // European
  'Sonia Petrov', 'Hanna Lindqvist', 'Renee Dupont', 'Leah Goldstein', 'Kira Novak',
  'Daphne Kowalski', 'Marguerite Beauchamp', 'Isolde Brenner', 'Katarina Horváth', 'Brigitte Vogt',
  'Eleonora Magnusson', 'Simone Lefèvre', 'Tatiana Sokolova', 'Agnieszka Wiśniewska', 'Monika Schröder',
  'Alessandra Colombo', 'Kristina Hedlund', 'Marta Wojciechowska', 'Johanna Eriksen', 'Dagmar Richter',
  // Middle Eastern
  'Yasmin Al-Farsi', 'Layla Habibi', 'Soraya Tehrani', 'Mariam Nasseri', 'Hoda Mansouri',
  'Rania Saleh', 'Noura Al-Qahtani', 'Dina Borghei', 'Samar Khoury', 'Lina Arabi',
  // Additional diversity — Caribbean, Pacific, Nordic
  'Keisha Brathwaite', 'Shanice Alleyne', 'Moana Tuilagi', 'Aroha Tamati', 'Sigrid Halvorsen',
  'Astrid Norberg', 'Freya Lindström', 'Solveig Dahl', 'Anouk De Vries', 'Liesel Müller',
  'Céline Marchand', 'Thérèse Bonnaire', 'Élodie Moreau', 'Colette Vaillancourt', 'Mireille Gaudin',
];

export const FAKE_NAMES_M: readonly string[] = [
  // Anglo/European
  'James Mitchell', 'David Kumar', 'Robert Chen', 'William Taylor', 'Thomas Garcia',
  'Andrew Watson', 'Daniel Price', 'Christopher Lee', 'Michael Brown', 'Steven Park',
  'Jonathan Reed', 'Matthew Cole', 'Benjamin Hart', 'Patrick Quinn', 'Marcus Webb',
  'Nathan Cross', 'Gregory Stone', 'Philip Marsh', 'Kenneth Blair', 'Douglas Grant',
  'Reginald Ashworth', 'Theodore Pemberton', 'Rupert Kensington', 'Edmund Blackwell', 'Aldous Thornton',
  'Sebastian Lockwood', 'Percival Drake', 'Montgomery Caldwell', 'Archibald Whitmore', 'Cedric Holloway',
  'Nigel Ravencroft', 'Bartholomew Sedgwick', 'Cornelius Hargrove', 'Desmond Applegate', 'Alastair Farnsworth',
  'Winston Ainsley', 'Lionel Carver', 'Reginald Latchford', 'Tobias Whitfield', 'Geoffrey Pennington',
  // South Asian
  'Raj Patel', 'Arjun Reddy', 'Vikram Choudhury', 'Suresh Nair', 'Anand Krishnamurthy',
  'Deepak Venkatesh', 'Sanjay Iyer', 'Rahul Kapoor', 'Aditya Bajaj', 'Manish Goswami',
  'Nikhil Bhatia', 'Pranav Mehrotra', 'Rohan Subramaniam', 'Karthik Ranganathan', 'Vinay Deshmukh',
  // East Asian
  'Wei Zhang', 'Koji Watanabe', 'Kenji Yamamoto', 'Hiroshi Sato', 'Tae-Hyun Kim',
  'Jun-Ho Park', 'Daisuke Nakamura', 'Liang Chen', 'Masaru Fujimoto', 'Sung-Min Lee',
  'Takeshi Mori', 'Minh Tran', 'Kazuki Hayashi', 'Chang-Woo Yoon', 'Akira Kobayashi',
  // Latin American
  'Rafael Moreno', 'Carlos Mendez', 'Marco Rossi', 'Gabriel Ferreira', 'Alejandro Castillo',
  'Diego Espinoza', 'Fernando Delgado', 'Mateo Guerrero', 'Santiago Navarro', 'Rodrigo Salazar',
  'Emilio Montoya', 'Andrés Pereira', 'Sebastián Aguirre', 'Joaquín Córdova', 'Nicolás Rojas',
  // African
  'Ibrahim Hassan', 'Chukwuemeka Okafor', 'Oluwaseun Adeyemi', 'Babajide Bakare', 'Emeka Nwachukwu',
  'Tunde Olawale', 'Adebayo Akinola', 'Kwame Asante', 'Obinna Igwe', 'Chidi Obi',
  // European
  'Oscar Lindgren', 'Henrik Andersen', 'Tomasz Kowalski', 'Nikolai Petrov', 'Dmitri Volkov',
  'Hassan Karimi', 'Sven Johansson', 'Felix Bauer', 'Lukas Schneider', 'Emile Fontaine',
  'Liam O\'Brien', 'Viktor Sokolov', 'Jan Wiśniewski', 'Franz Schröder', 'Stefan Hedlund',
  'Matteo Colombo', 'Erik Magnusson', 'Piotr Wojciechowski', 'Lars Eriksen', 'Hans Richter',
  // Middle Eastern
  'Omar Al-Farsi', 'Khalil Habibi', 'Reza Tehrani', 'Youssef Nasseri', 'Tariq Mansouri',
  'Saeed Saleh', 'Faisal Al-Qahtani', 'Dariush Borghei', 'Karim Khoury', 'Ahmad Arabi',
  // Additional diversity — Caribbean, Pacific, Nordic, Additional European
  'Darnell Prescott', 'Tyrone Beckford', 'Tavua Finau', 'Rangi Henare', 'Bjørn Halvorsen',
  'Gunnar Norberg', 'Axel Lindström', 'Torbjørn Dahl', 'Willem De Vries', 'Klaus Müller',
  'Jean-Pierre Marchand', 'Étienne Bonnaire', 'Cyprien Moreau', 'Auguste Vaillancourt', 'Lucien Gaudin',
  'Benedict Ashworth', 'Quinton Fairchild', 'Thaddeus Merriweather', 'Leander Cresswell', 'Barnaby Stockton',
];

export const FEMALE_FIRST_NAMES: ReadonlySet<string> = new Set([
  'sarah', 'jennifer', 'lisa', 'maria', 'anna', 'rachel', 'diana', 'nicole', 'amanda', 'jessica',
  'emily', 'laura', 'stephanie', 'katherine', 'olivia', 'samantha', 'victoria', 'helen', 'jane', 'margaret',
  'susan', 'karen', 'nancy', 'betty', 'sandra', 'ashley', 'dorothy', 'kimberly', 'elizabeth', 'donna',
  'caroline', 'natalie', 'hannah', 'megan', 'alicia', 'sophia', 'isabella', 'mia', 'charlotte', 'amelia',
  'claire', 'priya', 'elena', 'nadia', 'ingrid', 'fiona', 'renee', 'leah', 'yuki', 'mei-lin',
  'aisha', 'carmen', 'sonia', 'hanna', 'rosa', 'fatima', 'kira', 'chloe', 'daphne', 'vera',
  'abigail', 'penelope', 'evelyn', 'grace', 'lydia', 'audrey', 'josephine', 'cordelia', 'adelaide', 'beatrice',
  'genevieve', 'rosalind', 'harriet', 'winifred', 'prudence', 'millicent', 'constance', 'agnes', 'gabriela',
  'anika', 'lakshmi', 'shalini', 'deepika', 'kavita', 'sunita', 'meera', 'pooja', 'indira', 'anjali',
  'haruka', 'soo-jin', 'akiko', 'hye-young', 'sakura', 'lan', 'midori', 'isabela', 'valentina', 'lucia',
  'marisol', 'paloma', 'ximena', 'catalina', 'florencia', 'adriana', 'amara', 'zainab', 'chioma', 'nneka',
  'yasmin', 'layla', 'soraya', 'mariam', 'rania', 'noura', 'dina', 'samar', 'lina', 'hoda',
  'marguerite', 'isolde', 'katarina', 'brigitte', 'eleonora', 'simone', 'tatiana', 'agnieszka', 'monika',
  'alessandra', 'kristina', 'marta', 'johanna', 'dagmar', 'dolores', 'renata', 'temitope', 'folasade', 'busayo',
  'keisha', 'shanice', 'moana', 'aroha', 'sigrid', 'astrid', 'freya', 'solveig', 'anouk', 'liesel',
  'céline', 'thérèse', 'élodie', 'colette', 'mireille',
]);

// ─── Organizations ───────────────────────────────────────────────────────────

export const FAKE_ORGS: readonly string[] = [
  // Technology
  'Northwind Technologies', 'Contoso Holdings', 'Adatum Corp', 'Fabrikam Industries',
  'Proseware Solutions', 'Cascade Innovations', 'Pinnacle Systems', 'Horizon Labs',
  'Vertex Research', 'Thornfield Systems', 'Briarwood Labs', 'Copperfield Holdings',
  'Whitmore Industries', 'Sable Creek Partners', 'Ashford Global', 'Clearwater Ventures',
  // Financial
  'Woodgrove Financial', 'Alpine Securities', 'Meridian Dynamics', 'Crestline Capital',
  'Silverleaf Consulting', 'Ridgepoint Partners', 'Oakmont Group', 'Granite Point Capital',
  'Stonebridge Advisors', 'Windmere Capital', 'Lakeshore Financial', 'Ironwood Partners',
  'Blueridge Analytics', 'Blackstone Ridge', 'Hartwell & Associates', 'Sterling Grove Capital',
  'Harborview Trust', 'Birchwood Investments', 'Elkridge Wealth Management', 'Foxhall Advisors',
  // Legal
  'Stratton McKenzie', 'Pemberton Hale LLP', 'Ainsley Crawford Partners', 'Lockwood Whitfield PC',
  'Sedgwick Thornton LLP', 'Caldwell Ravencroft PC', 'Farnsworth Holloway LLP', 'Pennington Drake PC',
  'Hargrove Applegate LLP', 'Kensington Blackwell PC',
  // Media & Communications
  'Tailspin Partners', 'Lucerne Media', 'Beacon Strategies', 'Redwood Dynamics',
  'Evergreen Consulting', 'Summit Analytics', 'Coastal Ventures', 'Harland & Wolff Inc',
  'Maplewood Broadcasting', 'Cedarpoint Communications', 'Hawthorne Media Group', 'Riverton Press',
  // Healthcare & Biotech
  'Willowbrook Pharmaceuticals', 'Ferndale Biotech', 'Crestwood Medical', 'Ashgrove Therapeutics',
  'Birchfield Labs', 'Sprucehaven Genomics', 'Maplecrest Diagnostics', 'Cedarvale Health Systems',
  // Energy & Manufacturing
  'Pinecrest Energy', 'Oakdale Manufacturing', 'Elmridge Industrial', 'Hazelwood Power',
  'Stonecrest Mining', 'Bramblewood Steel', 'Alder Creek Petroleum', 'Thistlewood Engineering',
  // Real Estate & Construction
  'Fieldstone Properties', 'Meadowbrook Realty', 'Hilltop Development', 'Ravenswood Construction',
  'Brookside Estates', 'Cliffside Properties', 'Glendale Construction', 'Ridgewood Realty',
  // Consulting & Professional Services
  'Havenport Consulting', 'Westmoor Advisory', 'Bayside Partners', 'Northcrest Consulting',
  'Eastbridge Advisory', 'Southgate Partners', 'Glenfield Consulting', 'Crossroads Strategy Group',
  // Insurance & Risk
  'Windcrest Insurance', 'Harborstone Risk', 'Oakleaf Underwriters', 'Thorngate Re',
  'Mapleguard Insurance', 'Ironbark Surety', 'Cedarholm Risk Partners', 'Ashvale Assurance',
  // Aerospace & Defense
  'Starpoint Aerospace', 'Skyward Defense Systems', 'Ironwing Avionics', 'Thundercrest Corp',
  'Vaultline Defense', 'Strikepath Systems', 'Oriongate Aerospace', 'Peregrine Dynamics',
  // Logistics & Supply Chain
  'Bridgewater Logistics', 'Ironrail Freight', 'Harborline Shipping', 'Crestwave Supply Co',
  'Thornpath Distribution', 'Oakford Transport', 'Willowgate Logistics', 'Cedartrack Fulfillment',
  // Cybersecurity & SaaS
  'Vaultmind Security', 'Sentrypath Systems', 'Cipherleaf Technologies', 'Ironshield Cyber',
  'Keystrike Solutions', 'Dataweave Analytics', 'Cloudthorn Computing', 'Nexaforge AI',
];

// ─── Stock Tickers ───────────────────────────────────────────────────────────

export const FAKE_TICKERS: readonly string[] = [
  'NWND', 'CTSO', 'ADTM', 'FBRK', 'PRWL', 'WDGV', 'TLSP', 'LCNE', 'ALPS', 'MRDX',
  'CSVT', 'SMTA', 'VTXR', 'PNCL', 'HRZL', 'CSCI', 'IWDP', 'GRPT', 'BLRG', 'STBG',
  'CPFL', 'WTMR', 'HRLW', 'STRM', 'RWDD', 'LKFN', 'EVGN', 'WNDC', 'BRWD', 'THNF',
  'WNCR', 'HRBS', 'OKLF', 'THGT', 'SPRN', 'SKWD', 'IWNK', 'TCRS', 'VLDF', 'STRP',
  'BRWL', 'IRRF', 'HRBL', 'CRSW', 'VLTM', 'SNTP', 'CPHL', 'IRSH', 'NXFG', 'DTWV',
];

// ─── Project Names ───────────────────────────────────────────────────────────

export const FAKE_PROJECTS: readonly string[] = [
  'Project Aurora', 'Project Meridian', 'Project Catalyst', 'Project Zenith',
  'Project Atlas', 'Project Nexus', 'Project Titan', 'Project Vanguard',
  'Project Ember', 'Project Falcon', 'Project Horizon', 'Project Summit',
  'Project Keystone', 'Project Compass', 'Project Lighthouse', 'Project Sentinel',
  'Project Trident', 'Project Phoenix', 'Project Aegis', 'Project Bastion',
  'Project Citadel', 'Project Rampart', 'Project Overture', 'Project Corsair',
  'Project Sterling', 'Project Ironclad', 'Project Solstice', 'Project Tempest',
  'Project Pinnacle', 'Project Cobalt', 'Project Mercury', 'Project Granite',
  'Project Avalon', 'Project Obsidian', 'Project Sovereign', 'Project Eclipse',
];

// ─── Email Domains ───────────────────────────────────────────────────────────

export const FAKE_EMAIL_DOMAINS: readonly string[] = [
  'northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io',
  'woodgrove.com', 'tailspin.net', 'lucerne.org', 'alpine.io', 'meridian.com',
  'cascade.io', 'pinnacle.com', 'crestline.net', 'silverleaf.org', 'ridgepoint.com',
  'oakmont.io', 'stonebridge.com', 'ironwood.net', 'blueridge.org', 'windmere.com',
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
  '2019 Chestnut Place, Philadelphia, PA 19103',
  '2221 Sycamore Lane, Atlanta, GA 30301',
  '2423 Magnolia Drive, Dallas, TX 75201',
  '2625 Willow Street, Minneapolis, MN 55401',
  '2827 Hawthorn Way, Charlotte, NC 28201',
  '3029 Juniper Court, Phoenix, AZ 85001',
  '3231 Cypress Road, San Diego, CA 92101',
  '3433 Laurel Avenue, Tampa, FL 33601',
  '3635 Beechwood Drive, Columbus, OH 43201',
  '3837 Hickory Lane, Indianapolis, IN 46201',
  '4039 Redwood Avenue, Portland, OR 97209',
  '4241 Dogwood Circle, Raleigh, NC 27601',
  '4443 Mulberry Street, Louisville, KY 40201',
  '4645 Poplar Drive, Salt Lake City, UT 84101',
  '4847 Hemlock Way, Jacksonville, FL 32201',
  '5049 Alder Lane, Milwaukee, WI 53201',
  '5251 Basswood Court, Tucson, AZ 85701',
  '5453 Ironwood Trail, Sacramento, CA 95814',
  '5655 Boxwood Place, Richmond, VA 23219',
  '5857 Yew Street, Boise, ID 83701',
  '6059 Cottonwood Drive, Omaha, NE 68101',
  '6261 Sequoia Avenue, Albuquerque, NM 87101',
  '6463 Palmetto Way, Charleston, SC 29401',
  '6665 Buckeye Lane, Cleveland, OH 44101',
  '6867 Tamarack Road, Hartford, CT 06101',
  '7069 Linden Court, Des Moines, IA 50301',
  '7271 Hackberry Drive, Little Rock, AR 72201',
  '7473 Catalpa Street, Kansas City, MO 64101',
];

// ─── Locations ───────────────────────────────────────────────────────────────

export const FAKE_LOCATIONS: readonly string[] = [
  'Ridgemont Heights', 'Clearwater Bay', 'Thornfield Valley', 'Ashwood Park',
  'Briarcliff Manor', 'Oakridge Center', 'Willowbrook Commons', 'Cedar Falls',
  'Maplewood Plaza', 'Stonehaven Square', 'Hawthorne District', 'Ferndale Village',
  'Birchwood Crossing', 'Pinecrest Point', 'Meadowview Terrace', 'Elmridge Station',
  'Willowmere Gardens', 'Copperfield Green', 'Ironstone Park', 'Silverlake Promenade',
  'Hazelbrook Drive', 'Juniper Ridge', 'Ashton Commons', 'Larkspur Landing',
  'Foxglove Heights', 'Heatherfield Lane', 'Bramblewood Court', 'Tanglewood Crossing',
  'Rowan Creek Plaza', 'Sycamore Bluffs', 'Aldermere Walk', 'Hollyhock Circle',
  'Winterbourne Close', 'Summerfield Place', 'Rosemount Terrace', 'Ivydale Row',
];

export const MONTHS: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
