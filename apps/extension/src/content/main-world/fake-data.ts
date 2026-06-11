/**
 * Realistic Fake Data Generation
 *
 * Instead of [PERSON-1] tokens which make LLMs respond robotically,
 * we generate realistic-looking fake data. The LLM treats it as real
 * content, responds naturally, and we swap the fakes back in the response.
 *
 * Pools: 250 female names, 250 male names, 200 organizations.
 * Procedural fallback: when pools exhausted, generate from separate
 * first/last name pools for unlimited unique combinations.
 */

// ── CSPRNG helpers (must be self-contained for MAIN world IIFE) ──────────

function _secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / (0xFFFFFFFF + 1);
}

function _randBetween(min: number, max: number): number {
  return min + _secureRandom() * (max - min);
}

// ── Name Pools (250 female, 250 male — culturally diverse) ───────────────

export const FAKE_NAMES_F = [
  // Western European
  'Emily Rogers', 'Anna Peterson', 'Lisa Chang', 'Maria Santos', 'Rachel Kim',
  'Diana Walsh', 'Nicole Foster', 'Amanda Brooks', 'Jennifer Liu', 'Stephanie Barnes',
  'Katherine Hayes', 'Laura Bennett', 'Olivia Porter', 'Samantha Reed', 'Victoria Lane',
  'Claire Donovan', 'Hannah Morris', 'Julia Crawford', 'Megan Stewart', 'Chelsea Wright',
  'Natalie Grant', 'Heather Ross', 'Allison Beck', 'Rebecca Palmer', 'Patricia Burns',
  'Monica Steele', 'Caroline Marsh', 'Danielle Frost', 'Michelle Torres', 'Angela Gray',
  'Christina Hale', 'Sandra Kelley', 'Kimberly Cross', 'Teresa Blake', 'Janet Powers',
  'Valerie Stone', 'Sharon Watts', 'Catherine Drake', 'Deborah Crane', 'Cynthia Noble',
  'Margaret Hyde', 'Diane Sutton', 'Cheryl Barton', 'Marie Lawson', 'Joyce Dalton',
  'Ruth Benson', 'Virginia Holt', 'Frances Garrett', 'Gloria Perry', 'Donna Chambers',
  // South Asian
  'Priya Sharma', 'Meera Patel', 'Ananya Gupta', 'Divya Iyer', 'Kavita Nair',
  'Roshni Desai', 'Sunita Joshi', 'Pooja Mehta', 'Deepa Rao', 'Neha Kulkarni',
  'Anjali Bhat', 'Shalini Verma', 'Lakshmi Reddy', 'Nandini Menon', 'Rekha Pillai',
  'Pallavi Singh', 'Archana Das', 'Shweta Kapoor', 'Bhavna Tiwari', 'Isha Mishra',
  'Sakshi Banerjee', 'Ritika Choudhury', 'Aditi Saxena', 'Shreya Pandey', 'Tanvi Agarwal',
  // East Asian
  'Yuki Tanaka', 'Mei-Lin Wu', 'Yuna Park', 'Haruka Suzuki', 'Xia Chen',
  'Jia Li', 'Sakura Ito', 'Minji Lee', 'Ayumi Nakamura', 'Seo-Yeon Choi',
  'Riko Yamamoto', 'Hua Zhang', 'Ling Wang', 'Nanami Sato', 'Hyun-Ae Kim',
  'Chiyo Watanabe', 'Xue Yang', 'Fumiko Takahashi', 'Ji-Eun Yoon', 'Ai Mori',
  'Wen Liu', 'Akiko Kobayashi', 'Da-Eun Jung', 'Misaki Yoshida', 'Suyin Lam',
  // Middle Eastern / North African
  'Fatima Al-Rashid', 'Layla Ibrahim', 'Nour Hassan', 'Yasmin Khalil', 'Amira Mansour',
  'Dina El-Sayed', 'Hana Qureshi', 'Rania Farouk', 'Samira Nazari', 'Zara Hosseini',
  'Maryam Jafari', 'Leila Azizi', 'Amal Badawi', 'Safiya Osman', 'Dalal Khoury',
  'Noura Saleh', 'Basma Taha', 'Ghada Mahmoud', 'Iman Karimi', 'Jamila Youssef',
  'Khadija Hamid', 'Lina Sabbagh', 'Nabila Chaker', 'Rana Bishara', 'Sana Fadel',
  // Sub-Saharan African
  'Aisha Okonkwo', 'Amina Diallo', 'Chioma Eze', 'Fatou Mbaye', 'Grace Mwangi',
  'Ifunanya Nwosu', 'Joy Adeyemi', 'Kemi Ogunleye', 'Nneka Igwe', 'Obiageli Okoli',
  'Patience Mensah', 'Seraphina Kamau', 'Thandiwe Ndlovu', 'Wanjiku Njeru', 'Yaa Asante',
  'Zainab Traore', 'Adaeze Ikechukwu', 'Binta Camara', 'Chiamaka Obi', 'Esther Owusu',
  'Folake Adeola', 'Halima Bello', 'Ifeoma Chukwu', 'Justina Appiah', 'Kehinde Bakare',
  // Latin American
  'Carmen Reyes', 'Valentina Herrera', 'Isabella Morales', 'Lucia Ortiz', 'Gabriela Campos',
  'Mariana Rivera', 'Camila Vega', 'Adriana Nunez', 'Paola Aguilar', 'Renata Soto',
  'Fernanda Castillo', 'Andrea Fuentes', 'Daniela Pena', 'Silvia Navarro', 'Rosa Bianchi',
  'Catalina Rojas', 'Natalia Cruz', 'Alejandra Mendez', 'Sofia Vargas', 'Lorena Salazar',
  'Paula Guerrero', 'Beatriz Medina', 'Claudia Espinoza', 'Diana Figueroa', 'Elisa Paredes',
  // Eastern European
  'Kira Novak', 'Sonia Petrov', 'Hanna Lindqvist', 'Daphne Kowalski', 'Vera Nishimura',
  'Katarina Horvat', 'Olga Sokolova', 'Tatiana Zhukova', 'Ivana Markovic', 'Petra Svoboda',
  'Zuzana Kral', 'Monika Szabo', 'Agnieszka Nowak', 'Barbora Vlcek', 'Dragana Jovanovic',
  'Elena Antonova', 'Galina Popova', 'Ludmila Dvorak', 'Milena Rajic', 'Nina Volkov',
  'Renata Balog', 'Sonja Ristic', 'Tamara Filipovic', 'Veronika Sedlak', 'Zlata Petrovic',
  // Nordic / Scandinavian
  'Ingrid Larsen', 'Fiona Gallagher', 'Renee Dupont', 'Leah Goldstein', 'Chloe Beaumont',
  'Astrid Eriksson', 'Birgit Andersen', 'Elin Bergstrom', 'Freya Nilsson', 'Greta Holm',
  'Helga Kristiansen', 'Ida Magnusson', 'Kristin Dahl', 'Liv Haugen', 'Maja Olsen',
  'Nora Pedersen', 'Sigrid Lundberg', 'Thea Jakobsen', 'Ulrika Strom', 'Ylva Forsberg',
  // Additional Western
  'Abigail Spencer', 'Bethany Moore', 'Celia Douglas', 'Dorothy Hudson', 'Eva Thornton',
  'Felicity Chambers', 'Georgia Prescott', 'Holly Sinclair', 'Iris Wellington', 'Jade Harrington',
  'Karen Whitfield', 'Lydia Ashworth', 'Naomi Blackwood', 'Penelope York', 'Quinn Ellsworth',
  'Rosalind Harper', 'Sylvia Montague', 'Tessa Fairbanks', 'Ursula Wainwright', 'Winifred Cromwell',
  'Alexandra Pemberton', 'Bridget Kingsley', 'Cordelia Thatcher', 'Evelyn Cartwright', 'Flora Aldridge',
  'Helena Whitaker', 'Imogen Hartley', 'Josephine Bradshaw', 'Lucille Sherwood', 'Madeline Hawthorne',
  'Nadia Karim', 'Ophelia Linden', 'Philippa Townsend', 'Rowena Blackwell', 'Serena Lockwood',
  'Tabitha Underwood', 'Vivienne Ashford', 'Wren Calloway', 'Yvette Beauregard', 'Zelda Worthington',
];

export const FAKE_NAMES_M = [
  // Western European
  'James Mitchell', 'David Kumar', 'Robert Chen', 'William Taylor', 'Thomas Garcia',
  'Andrew Watson', 'Daniel Price', 'Christopher Lee', 'Michael Brown', 'Steven Park',
  'Jonathan Reed', 'Matthew Cole', 'Benjamin Hart', 'Patrick Quinn', 'Marcus Webb',
  'Gregory Hayes', 'Timothy Grant', 'Jason Moore', 'Eric Sullivan', 'Ryan Cooper',
  'Kevin Nash', 'Brian Maxwell', 'Scott Henderson', 'Jeffrey Lambert', 'Gary Thornton',
  'Philip Barrett', 'Dennis Flynn', 'Russell Clayton', 'Keith Whitman', 'Frank Sinclair',
  'Howard Burke', 'Norman Payne', 'Gerald Cross', 'Lawrence Barton', 'Ralph Tucker',
  'Raymond Mercer', 'Albert Gibbs', 'Eugene Sharp', 'Leonard Moss', 'Stanley Frost',
  'Harold Hyde', 'Wayne Osborne', 'Donald Crane', 'Roger Prescott', 'Carl Fenton',
  'Henry Caldwell', 'Arthur Blackwood', 'Vincent Drake', 'Bruce Ashton', 'Roy Chambers',
  // South Asian
  'Raj Patel', 'Arjun Reddy', 'Vikram Sharma', 'Sanjay Gupta', 'Amit Desai',
  'Rohan Iyer', 'Suresh Nair', 'Karthik Rao', 'Vivek Mehta', 'Arun Joshi',
  'Nitin Kulkarni', 'Pranav Bhat', 'Manish Verma', 'Gaurav Singh', 'Rahul Kapoor',
  'Ajay Tiwari', 'Venkat Menon', 'Ashok Pillai', 'Deepak Das', 'Harish Banerjee',
  'Prasad Choudhury', 'Ramesh Saxena', 'Sachin Pandey', 'Tarun Agarwal', 'Umesh Mishra',
  // East Asian
  'Kenji Yamamoto', 'Wei Zhang', 'Koji Watanabe', 'Takeshi Sato', 'Hiroshi Nakamura',
  'Jae-Won Kim', 'Ryu Tanaka', 'Ming Chen', 'Tao Wang', 'Seung-Ho Lee',
  'Akira Suzuki', 'Dong-Hyun Park', 'Fen Liu', 'Isamu Ito', 'Jun Yang',
  'Kazuki Mori', 'Li Wei', 'Naoki Yoshida', 'Qiang Zhao', 'Ren Takahashi',
  'Shota Kobayashi', 'Tatsuya Hasegawa', 'Hao Xu', 'Yong-Min Choi', 'Bo Lin',
  // Middle Eastern / North African
  'Hassan Karimi', 'Omar Mansour', 'Tariq Ibrahim', 'Khalid Al-Farsi', 'Youssef Nazari',
  'Ahmed Hosseini', 'Faisal Qureshi', 'Jamal Farouk', 'Mustafa Taha', 'Nabil Khalil',
  'Rashid Jafari', 'Samir Azizi', 'Walid Badawi', 'Ziad Osman', 'Bilal Khoury',
  'Hamza Saleh', 'Idris Mahmoud', 'Karim El-Sayed', 'Mazen Sabbagh', 'Rami Bishara',
  'Amir Fadel', 'Bassam Hamid', 'Daoud Chaker', 'Ehsan Hashemi', 'Fuad Youssef',
  // Sub-Saharan African
  'Ibrahim Hassan', 'Kwame Mensah', 'Chidi Eze', 'Moussa Diallo', 'James Mwangi',
  'Emeka Okafor', 'Kofi Asante', 'Obinna Nwosu', 'Sekou Traore', 'Tunde Adeyemi',
  'Uche Igwe', 'Victor Ogunleye', 'Wole Bakare', 'Yemi Adeola', 'Zuberi Kamau',
  'Aboubacar Camara', 'Babatunde Obi', 'Chibuzo Chukwu', 'Dayo Owusu', 'Ekene Ikechukwu',
  'Femi Bello', 'Godwin Appiah', 'Ifeanyi Okoli', 'Jude Njeru', 'Kunle Ndlovu',
  // Latin American
  'Carlos Mendez', 'Marco Rossi', 'Rafael Moreno', 'Diego Herrera', 'Luis Ortiz',
  'Alejandro Campos', 'Fernando Rivera', 'Gabriel Vega', 'Hugo Nunez', 'Ivan Aguilar',
  'Javier Soto', 'Leonardo Castillo', 'Manuel Fuentes', 'Nicolas Pena', 'Oscar Navarro',
  'Pablo Rojas', 'Ricardo Cruz', 'Sebastian Vargas', 'Tomas Salazar', 'Victor Guerrero',
  'Adrian Medina', 'Bruno Espinoza', 'Cesar Figueroa', 'Eduardo Paredes', 'Francisco Bravo',
  // Eastern European
  'Tomasz Kowalski', 'Dmitri Volkov', 'Nikolai Petrov', 'Felix Bauer', 'Lukas Schneider',
  'Anton Horvat', 'Boris Sokolov', 'Dragomir Markovic', 'Emil Svoboda', 'Filip Szabo',
  'Goran Jovanovic', 'Ivan Popov', 'Jakub Nowak', 'Karel Vlcek', 'Luka Rajic',
  'Marek Dvorak', 'Oleg Zhukov', 'Pavel Antonov', 'Stefan Ristic', 'Vaclav Sedlak',
  'Aleksei Kozlov', 'Branislav Filipovic', 'Dusan Petrovic', 'Grigory Morozov', 'Jan Kral',
  // Nordic / Scandinavian
  'Oscar Lindgren', 'Henrik Andersen', 'Sven Johansson', 'Lars Bergstrom', 'Erik Nilsson',
  'Bjorn Holm', 'Magnus Kristiansen', 'Nils Haugen', 'Olaf Dahl', 'Per Jakobsen',
  'Gunnar Magnusson', 'Ivar Pedersen', 'Knut Strom', 'Rune Forsberg', 'Torbjorn Lundberg',
  // Additional Western
  "Liam O'Brien", 'Emile Fontaine', 'Alastair Pemberton', 'Benedict Kingsley', 'Clifford Thatcher',
  'Desmond Cartwright', 'Edmund Aldridge', 'Frederick Whitaker', 'Geoffrey Hartley', 'Humphrey Bradshaw',
  'Irving Sherwood', 'Julian Hawthorne', 'Kenneth Linden', 'Lionel Townsend', 'Montgomery Blackwell',
  'Nathaniel Lockwood', 'Oliver Underwood', 'Preston Ashford', 'Quentin Calloway', 'Reginald Beauregard',
  'Sheldon Worthington', 'Theodore Wainwright', 'Ulysses Cromwell', 'Vernon Fairbanks', 'Wesley Montague',
  'Xavier Thornberry', 'Yannick Beauchamp', 'Zachary Whitfield', 'Alistair Prescott', 'Barnaby Ellsworth',
  'Conrad Spencer', 'Dashiell Harper', 'Everett York', 'Fletcher Sinclair', 'Gideon Ashworth',
  'Harrison Wellington', 'Inigo Harrington', 'Jarvis Weston', 'Kendrick Pembroke', 'Lorenzo Castellano',
  'Maxwell Alderton', 'Nigel Brackston', 'Orson Whitmore', 'Pierce Langford', 'Randolph Chadwick',
];

const FEMALE_FIRST = new Set([
  // Common Western female first names
  'sarah','jennifer','lisa','maria','anna','rachel','diana','nicole','amanda','jessica',
  'emily','laura','stephanie','katherine','olivia','samantha','victoria','helen','jane','margaret',
  'susan','karen','nancy','betty','sandra','ashley','dorothy','kimberly','elizabeth','donna',
  'claire','hannah','julia','megan','chelsea','natalie','heather','allison','rebecca','patricia',
  'monica','caroline','danielle','michelle','angela','christina','teresa','janet','valerie','sharon',
  'catherine','deborah','cynthia','diane','cheryl','marie','joyce','ruth','virginia','frances',
  'gloria','abigail','bethany','celia','eva','felicity','georgia','holly','iris','jade',
  'lydia','naomi','penelope','quinn','rosalind','sylvia','tessa','ursula','winifred','vivienne',
  'alexandra','bridget','cordelia','evelyn','flora','helena','imogen','josephine','lucille','madeline',
  'ophelia','philippa','rowena','serena','tabitha','wren','yvette','zelda',
  // South Asian
  'priya','meera','ananya','divya','kavita','roshni','sunita','pooja','deepa','neha',
  'anjali','shalini','lakshmi','nandini','rekha','pallavi','archana','shweta','bhavna','isha',
  'sakshi','ritika','aditi','shreya','tanvi',
  // East Asian
  'yuki','mei-lin','yuna','haruka','xia','jia','sakura','minji','ayumi','seo-yeon',
  'riko','hua','ling','nanami','hyun-ae','chiyo','xue','fumiko','ji-eun','ai',
  'wen','akiko','da-eun','misaki','suyin',
  // Middle Eastern / African
  'fatima','layla','nour','yasmin','amira','dina','hana','rania','samira','zara',
  'maryam','leila','amal','safiya','dalal','noura','basma','ghada','iman','jamila',
  'khadija','lina','nabila','rana','sana',
  'aisha','amina','chioma','fatou','grace','ifunanya','joy','kemi','nneka','obiageli',
  'patience','seraphina','thandiwe','wanjiku','yaa','zainab',
  // Latin American
  'carmen','valentina','isabella','lucia','gabriela','mariana','camila','adriana','paola','renata',
  'fernanda','andrea','daniela','silvia','rosa','catalina','natalia','alejandra','sofia','lorena',
  // Eastern European / Nordic
  'kira','sonia','hanna','daphne','vera','katarina','olga','tatiana','ivana','petra',
  'zuzana','monika','agnieszka','barbora','dragana','elena','galina','ludmila','milena','nina',
  'ingrid','fiona','renee','leah','chloe','astrid','birgit','elin','freya','greta',
  'helga','ida','kristin','liv','maja','nora','sigrid','thea','ulrika','ylva',
  'nadia',
]);

// ── Organization Pool (200 organizations) ───────────────────────────────

export const FAKE_ORGS = [
  // Technology
  'Northwind Technologies', 'Contoso Holdings', 'Adatum Corp', 'Fabrikam Industries',
  'Proseware Solutions', 'Meridian Dynamics', 'Summit Analytics', 'Vertex Research',
  'Pinnacle Systems', 'Horizon Labs', 'Cascade Innovations', 'Blueridge Analytics',
  'Thornfield Systems', 'Briarwood Labs', 'Redwood Dynamics', 'Sterling Micro',
  'Obsidian Software', 'Quartz Computing', 'Cobalt Digital', 'Nexus Platforms',
  'Aether Networks', 'Cipher Logic', 'Prism Data', 'Forge Analytics', 'Beacon AI',
  'Helix Robotics', 'Lattice Cloud', 'Polaris Dev', 'Zenith Automation', 'Ember Tech',
  'Ironclad Solutions', 'Vantage Systems', 'Keystone Digital', 'Quantum Edge', 'Nebula Soft',
  // Financial Services
  'Woodgrove Financial', 'Alpine Securities', 'Coastal Ventures', 'Granite Point Capital',
  'Stonebridge Advisors', 'Copperfield Holdings', 'Windmere Capital', 'Lakeshore Financial',
  'Evergreen Consulting', 'Sable Creek Partners', 'Ashford Wealth', 'Birchwood Investments',
  'Cedar Grove Capital', 'Dunmore Asset Management', 'Foxglove Partners', 'Glendale Funds',
  'Hartwell Securities', 'Juniper Financial', 'Kingfisher Advisors', 'Larkspur Capital',
  'Montclair Investments', 'Nightingale Fund', 'Oakridge Wealth', 'Pemberton Group',
  'Ridgemont Capital', 'Silverstone Partners', 'Thorndale Advisors', 'Whitehall Finance',
  'Yarmouth Securities', 'Zenmore Investments', 'Crestview Capital', 'Edgewood Advisors',
  // Legal / Professional Services
  'Whitmore Industries', 'Stratton McKenzie', 'Harland & Wolff Inc', 'Prescott & Associates',
  'Blackstone Murray LLP', 'Caldwell & Drake', 'Donovan Harper Group', 'Fairchild & Burke',
  'Grayson Sterling Partners', 'Holloway & Crane', 'Jennings Pierce LLP', 'Kensington Abbott',
  'Langford & Ellis', 'Mercer Whitfield Group', 'Northcott & Payne', 'Pembroke Stanley',
  'Radcliffe & Thorne', 'Sutherland Avery', 'Thornberry & Cross', 'Wainwright Dixon',
  // Healthcare / Pharma
  'Horizon Health Systems', 'Meridian Pharma', 'Compass BioSciences', 'Sterling Medical',
  'Vanguard Health Partners', 'Pinnacle Care Group', 'Summit Clinical', 'Cedarwood Health',
  'Brightpath Therapeutics', 'Clearview Medical', 'Dayspring Diagnostics', 'Elmhurst Health',
  'Falcon BioPharma', 'Greenleaf Wellness', 'Haven Medical Group', 'Ironbridge Health',
  // Energy / Industrial
  'Crestline Energy', 'Ironwood Partners', 'Titanium Resources', 'Basalt Mining Corp',
  'Falcon Ridge Energy', 'Greystone Industrial', 'Hawthorne Manufacturing', 'Indigo Power',
  'Jasper Materials', 'Kingsley Resources', 'Limestone Corp', 'Maple Leaf Industrial',
  'Nordic Energy Holdings', 'Onyx Minerals', 'Platinum Industries', 'Quartzite Resources',
  // Media / Creative
  'Lucerne Media', 'Tailspin Partners', 'Starlight Studios', 'Crescent Media Group',
  'Daybreak Communications', 'Echo Valley Media', 'Firefly Productions', 'Golden Gate Studios',
  'Harvest Moon Media', 'Ivory Tower Press', 'Jade River Publishing', 'Kaleidoscope Creative',
  // Real Estate / Construction
  'Amberly Properties', 'Bridgewater Realty', 'Cornerstone Developers', 'Dunbar Construction',
  'Eastgate Properties', 'Fieldstone Realty', 'Glenwood Estates', 'Hillcrest Development',
  'Ivy League Properties', 'Jasmine Gardens Realty', 'Kingsway Development', 'Landmark Estates',
  // Consumer / Retail
  'Maple & Oak Trading', 'Northstar Retail Group', 'Oakwood Consumer', 'Pacific Coast Brands',
  'Quartermaster Supply', 'Rosewater & Co', 'Seaside Merchants', 'Timberline Trading',
  // Education / Research
  'Aspen Research Institute', 'Brookhaven Academy', 'Clearwater Institute', 'Deerfield Research',
  'Edgewater Foundation', 'Ferndale Institute', 'Glacier Point Research', 'Highpoint Academy',
  // Insurance
  'Irongate Insurance', 'Juniper Life', 'Keystone Underwriters', 'Liberty Shield Group',
  'Magellan Insurance', 'Newport Mutual', 'Olympus Life', 'Providence Insurance',
  // Additional misc
  'Quantum Leap Ventures', 'Ravenscroft Holdings', 'Sapphire Bay Corp', 'Trident Group',
  'Umbrella Enterprises', 'Valiant Corp', 'Westerly Holdings', 'Xenon Industries',
  'Yellowstone Holdings', 'Zephyr Global', 'Aurora Enterprises', 'Beacon Hill Corp',
  'Crimson Peak Holdings', 'Diamond Point Group', 'Emerald Coast Inc', 'Frost River Corp',
];

// ── Ticker / Project / Month Pools ──────────────────────────────────────

const FAKE_TICKERS = [
  'NWND', 'CTSO', 'ADTM', 'FBRK', 'PRWL', 'WDGV', 'TLSP', 'LCNE', 'ALPS', 'MRDX',
  'CSVT', 'SMTA', 'VTXR', 'PNCL', 'HRZL', 'BLRG', 'THFN', 'BRWD', 'RDWD', 'STRL',
  'OBSD', 'QRTZ', 'CBLT', 'NXPL', 'ATHR', 'CPHR', 'PRSM', 'FRGN', 'BCAI', 'HLXR',
  'LTCL', 'PLRS', 'ZNTH', 'EMBR', 'IRCD', 'VNTG', 'KYST', 'QEDG', 'NBLS',
];

const FAKE_PROJECTS = [
  'Project Aurora', 'Project Meridian', 'Project Catalyst', 'Project Zenith',
  'Project Atlas', 'Project Nexus', 'Project Titan', 'Project Vanguard',
  'Project Ember', 'Project Falcon', 'Project Osprey', 'Project Horizon',
  'Project Pinnacle', 'Project Summit', 'Project Eclipse', 'Project Citadel',
  'Project Voyager', 'Project Sentinel', 'Project Keystone', 'Project Compass',
  'Project Beacon', 'Project Ironclad', 'Project Lighthouse', 'Project Trident',
  'Project Evergreen', 'Project Nighthawk', 'Project Sapphire', 'Project Crimson',
  'Project Sterling', 'Project Quantum',
];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Procedural Fallback: First/Last Name Pools ──────────────────────────
// When the 250-name pools are exhausted, combine from these separate pools
// to generate unlimited unique names without collisions.

const PROC_FIRST_F = [
  'Adeline', 'Beatrice', 'Celeste', 'Delilah', 'Eloise', 'Francesca', 'Genevieve',
  'Harriet', 'Isadora', 'Juniper', 'Katrine', 'Lorraine', 'Magnolia', 'Nicolette',
  'Ottilia', 'Persephone', 'Rosemary', 'Seraphina', 'Temperance', 'Valencia',
  'Wisteria', 'Xiomara', 'Yasmine', 'Zinnia', 'Ariadne', 'Blanche', 'Colette',
  'Dorothea', 'Estelle', 'Floriana', 'Griselda', 'Hildegard', 'Iolanthe', 'Jessamine',
  'Kassandra', 'Lavinia', 'Marigold', 'Nerissa', 'Octavia', 'Primrose',
];

const PROC_FIRST_M = [
  'Alistair', 'Bartholomew', 'Cornelius', 'Dashiell', 'Ebenezer', 'Ferdinand',
  'Gulliver', 'Horatio', 'Ignatius', 'Jaroslav', 'Kimball', 'Llewellyn',
  'Meriwether', 'Nicodemus', 'Octavian', 'Percival', 'Quentin', 'Remington',
  'Sylvester', 'Thaddeus', 'Ulysses', 'Valentino', 'Wolfgang', 'Xenophon',
  'Yardley', 'Zachariah', 'Ambrose', 'Broderick', 'Caspian', 'Donovan',
  'Ellsworth', 'Fitzwilliam', 'Grantham', 'Hargrove', 'Isidore', 'Jameson',
  'Kirkland', 'Lachlan', 'Morrison', 'Neville',
];

const PROC_LAST = [
  'Abernathy', 'Blackburn', 'Carmichael', 'Drummond', 'Ellington', 'Farnsworth',
  'Galbraith', 'Hathaway', 'Irvington', 'Jennings', 'Kimberley', 'Livingston',
  'MacAllister', 'Nightingale', 'Oxborough', 'Pennington', 'Queensbury', 'Ravenswood',
  'Stanhope', 'Thistlewood', 'Underhill', 'Vandermeer', 'Winterbourne', 'Yardsworth',
  'Zollinger', 'Ashcroft', 'Brightwell', 'Chadwick', 'Dalrymple', 'Edgecombe',
  'Fitzpatrick', 'Greenwood', 'Hollister', 'Ironside', 'Kensington', 'Lockhart',
  'Merriweather', 'Northfield', 'Pemberton', 'Radcliffe', 'Southwell', 'Thornbury',
  'Warrington', 'Ashworth', 'Brackstone', 'Chatsworth', 'Devereux', 'Entwhistle',
  'Featherstone', 'Gilchrist',
];

// ── Fake Email Domains ──────────────────────────────────────────────────

const FAKE_EMAIL_DOMAINS = [
  'northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io',
  'meridian.com', 'woodgrove.com', 'alpinesec.io', 'summitco.net', 'horizonlabs.org',
  'cascadeinc.com', 'thornfield.net', 'briarwood.org', 'redwoodcorp.io', 'pinnaclesys.com',
];

// ── State & Pool Management ─────────────────────────────────────────────

const _usedFakes: Record<string, number> = {};
// Track names generated via procedural fallback to avoid dupes
const _procGenerated: Record<string, Set<string>> = {};

function _pickUnused(pool: string[], type: string): string {
  if (!_usedFakes[type]) _usedFakes[type] = 0;
  const idx = _usedFakes[type] % pool.length;
  _usedFakes[type]++;
  return pool[idx];
}

/**
 * Procedural name generation: combines first + last name pools
 * for unlimited unique names when the main pools are exhausted.
 */
function _generateProceduralName(female: boolean): string {
  const firstPool = female ? PROC_FIRST_F : PROC_FIRST_M;
  const key = female ? 'PROC_F' : 'PROC_M';
  if (!_procGenerated[key]) _procGenerated[key] = new Set();

  // Try random combinations until we find a unique one
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = firstPool[Math.floor(_secureRandom() * firstPool.length)];
    const last = PROC_LAST[Math.floor(_secureRandom() * PROC_LAST.length)];
    const name = first + ' ' + last;
    if (!_procGenerated[key].has(name)) {
      _procGenerated[key].add(name);
      return name;
    }
  }

  // Absolute fallback: append a suffix
  const first = firstPool[Math.floor(_secureRandom() * firstPool.length)];
  const last = PROC_LAST[Math.floor(_secureRandom() * PROC_LAST.length)];
  const suffix = Math.floor(_secureRandom() * 900 + 100);
  return first + ' ' + last + '-' + suffix;
}

function _isFemaleFirst(name: string): boolean {
  const first = name.split(/\s+/)[0].toLowerCase();
  return FEMALE_FIRST.has(first);
}

// ── Main Generation Function ────────────────────────────────────────────

export function generateFake(type: string, original: string): string {
  // Type guard: entity.text can be non-string if detection produced a
  // malformed entity (e.g., Gemini's nested JSON extraction returning an
  // object instead of a string). Without this guard, calling .match() or
  // .replace() on a non-string crashes with "TypeError: b.match is not a
  // function" in the minified bundle (reported on Gemini April 2026).
  if (typeof original !== 'string') {
    const fallback = String(original ?? '');
    if (fallback.length === 0) return '[REDACTED]';
    original = fallback;
  }
  switch (type) {
    case 'PERSON': {
      const female = _isFemaleFirst(original);
      const pool = female ? FAKE_NAMES_F : FAKE_NAMES_M;
      const genderKey = type + (female ? '_F' : '_M');
      const poolExhausted = (_usedFakes[genderKey] || 0) >= pool.length;

      if (poolExhausted) {
        // Procedural fallback: generate from first/last pools
        return _generateProceduralName(female);
      }

      const origFirst = original.split(/\s+/)[0].toLowerCase();
      let candidate = _pickUnused(pool, genderKey);
      let attempts = 0;
      while (candidate.split(/\s+/)[0].toLowerCase() === origFirst && attempts < pool.length) {
        candidate = _pickUnused(pool, genderKey);
        attempts++;
      }
      return candidate;
    }

    case 'ORGANIZATION': {
      const poolExhausted = (_usedFakes[type] || 0) >= FAKE_ORGS.length;
      if (poolExhausted) {
        // Procedural org: combine adjective + noun
        const adjectives = ['Sapphire', 'Titanium', 'Obsidian', 'Crimson', 'Emerald',
          'Sterling', 'Granite', 'Onyx', 'Ivory', 'Cobalt', 'Jasper', 'Azure',
          'Amber', 'Platinum', 'Slate', 'Cedar', 'Iron', 'Bronze', 'Silver', 'Coral'];
        const nouns = ['Capital', 'Holdings', 'Partners', 'Ventures', 'Group',
          'Industries', 'Solutions', 'Dynamics', 'Analytics', 'Systems',
          'Technologies', 'Corp', 'Enterprises', 'Financial', 'Labs'];
        const adj = adjectives[Math.floor(_secureRandom() * adjectives.length)];
        const noun = nouns[Math.floor(_secureRandom() * nouns.length)];
        return adj + ' ' + noun;
      }
      return _pickUnused(FAKE_ORGS, type);
    }

    case 'TICKER': {
      const m = original.match(/^([A-Z]+\s*:\s*)/);
      if (m) return m[1] + _pickUnused(FAKE_TICKERS, type);
      return _pickUnused(FAKE_TICKERS, type);
    }

    case 'PROJECT_NAME':
      return _pickUnused(FAKE_PROJECTS, type);

    case 'MONETARY_AMOUNT': {
      const cleaned = original.replace(/[,$\s]/g, '');
      const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(million|billion|M|B|k|K|dollars?|USD|EUR|GBP)?/i);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const suffix = numMatch[2] || '';
        const shifted = num * _randBetween(0.85, 1.35);
        const origDigitCount = numMatch[1].replace('.', '').length;
        let formatted: string;
        const hasDecimal = numMatch[1].includes('.');
        const decPlaces = hasDecimal ? (numMatch[1].split('.')[1]?.length || 1) : 0;
        formatted = hasDecimal ? shifted.toFixed(decPlaces) : Math.round(shifted).toString();
        while (formatted.replace('.', '').length < origDigitCount) {
          formatted = hasDecimal ? (shifted * 1.1).toFixed(decPlaces) : Math.round(shifted * 1.1).toString();
          break;
        }
        const prefix = original.startsWith('$') ? '$' : '';
        return prefix + formatted + suffix;
      }
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString())
                     .replace(/[a-zA-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + Math.floor(_randBetween(-3, 3))));
    }

    case 'PERCENTAGE': {
      const numMatch = original.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const offset = _randBetween(3, 8) * (_secureRandom() > 0.5 ? 1 : -1);
        const shifted = Math.max(0.1, Math.min(99.9, num + offset));
        const hasDecimal = numMatch[1].includes('.');
        return (hasDecimal ? shifted.toFixed(1) : Math.round(shifted).toString()) + '%';
      }
      return Math.floor(_randBetween(10, 90)) + '%';
    }

    case 'DATE_OF_BIRTH':
    case 'DATE': {
      const dateMatch = original.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(.*)$/i);
      if (dateMatch) {
        const monthIdx = MONTHS.findIndex(m => m.toLowerCase() === dateMatch[1].toLowerCase());
        if (monthIdx >= 0) {
          const newMonthIdx = (monthIdx + Math.floor(_randBetween(1, 4))) % 12;
          const newDay = Math.max(1, Math.min(28, parseInt(dateMatch[2]) + Math.floor(_randBetween(-10, 10))));
          const suffix = newDay === 1 || newDay === 21 || newDay === 31 ? 'st' : newDay === 2 || newDay === 22 ? 'nd' : newDay === 3 || newDay === 23 ? 'rd' : 'th';
          return MONTHS[newMonthIdx] + ' ' + newDay + suffix + (dateMatch[3] || '');
        }
      }
      const numDate = original.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
      if (numDate) {
        const m = Math.max(1, Math.min(12, parseInt(numDate[1]) + Math.floor(_randBetween(-2, 3))));
        const d = Math.max(1, Math.min(28, parseInt(numDate[3]) + Math.floor(_randBetween(-5, 5))));
        const mStr = numDate[1].length === 2 ? m.toString().padStart(2, '0') : m.toString();
        const dStr = numDate[3].length === 2 ? d.toString().padStart(2, '0') : d.toString();
        return mStr + numDate[2] + dStr + numDate[2] + numDate[4];
      }
      const isoDate = original.match(/^(\d{4})([\/\-])(\d{1,2})\2(\d{1,2})$/);
      if (isoDate) {
        const y = parseInt(isoDate[1]) + Math.floor(_randBetween(-2, 2));
        const m = Math.max(1, Math.min(12, parseInt(isoDate[3]) + Math.floor(_randBetween(-2, 3))));
        const d = Math.max(1, Math.min(28, parseInt(isoDate[4]) + Math.floor(_randBetween(-5, 5))));
        return y + isoDate[2] + m.toString().padStart(2, '0') + isoDate[2] + d.toString().padStart(2, '0');
      }
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'FISCAL_PERIOD': {
      const qMatch = original.match(/^([QH])(\d)/);
      if (qMatch) {
        const shifted = ((parseInt(qMatch[2]) + Math.floor(_randBetween(1, 3)) - 1) % 4) + 1;
        return qMatch[1] + shifted + original.substring(2);
      }
      const fyMatch = original.match(/^(FY\s*'?)(\d{2,4})$/i);
      if (fyMatch) {
        const year = parseInt(fyMatch[2]);
        const shifted = year + Math.floor(_randBetween(-2, 2));
        return fyMatch[1] + shifted;
      }
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'EMAIL': {
      const fakeName = _pickUnused(FAKE_NAMES_F.concat(FAKE_NAMES_M), 'EMAIL_NAME');
      const parts = fakeName.toLowerCase().split(/[\s-]+/);
      const domain = FAKE_EMAIL_DOMAINS[Math.floor(_secureRandom() * FAKE_EMAIL_DOMAINS.length)];
      return parts[0] + '.' + (parts[1] || 'user') + '@' + domain;
    }

    case 'SSN': {
      const a = Math.floor(_randBetween(100, 899));
      const b = Math.floor(_randBetween(10, 99));
      const c = Math.floor(_randBetween(1000, 9999));
      if (original.includes('-')) return a + '-' + b + '-' + c;
      if (original.includes('.')) return a + '.' + b + '.' + c;
      if (original.includes(' ')) return a + ' ' + b + ' ' + c;
      return '' + a + b + c;
    }

    case 'PHONE_NUMBER': {
      const a = Math.floor(_randBetween(200, 899));
      const b = Math.floor(_randBetween(200, 899));
      const c = Math.floor(_randBetween(1000, 9999));
      if (original.includes('(')) return '(' + a + ') ' + b + '-' + c;
      if (original.includes('-')) return a + '-' + b + '-' + c;
      return a + ' ' + b + ' ' + c;
    }

    case 'CREDIT_CARD': {
      const groups = [
        Math.floor(_randBetween(4000, 4999)),
        Math.floor(_randBetween(1000, 9999)),
        Math.floor(_randBetween(1000, 9999)),
        Math.floor(_randBetween(1000, 9999)),
      ];
      if (original.includes('-')) return groups.join('-');
      if (original.includes(' ')) return groups.join(' ');
      return groups.join('');
    }

    case 'HEADCOUNT': {
      const hcMatch = original.match(/^(\d+)\s*(.*)/);
      if (hcMatch) {
        const num = parseInt(hcMatch[1]);
        const shifted = Math.round(num * _randBetween(0.7, 1.35));
        return shifted + (hcMatch[2] ? ' ' + hcMatch[2] : '');
      }
      return original;
    }

    case 'LEGAL_REFERENCE': {
      const lrMatch = original.match(/^(\w+)\s+(\d+)(.*)/);
      if (lrMatch) {
        const shifted = parseInt(lrMatch[2]) + Math.floor(_randBetween(2, 8));
        return lrMatch[1] + ' ' + shifted + (lrMatch[3] || '');
      }
      return original;
    }

    case 'IP_ADDRESS': {
      const octets = Array.from({ length: 4 }, () => Math.floor(_randBetween(1, 254)));
      return octets.join('.');
    }

    case 'EMPLOYEE_ID':
    case 'RECORD_ID': {
      const idMatch = original.match(/^([A-Z#-]+)(\d+)$/);
      if (idMatch) {
        const len = idMatch[2].length;
        const newNum = Math.floor(_randBetween(10 ** (len - 1), 10 ** len - 1));
        return idMatch[1] + newNum;
      }
      return original;
    }

    case 'MEDICAL_RECORD': {
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'INSURANCE_ID':
    case 'AUTHORIZATION': {
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'API_KEY':
    case 'AWS_CREDENTIAL':
    case 'GCP_CREDENTIAL':
    case 'AUTH_TOKEN': {
      const prefixMatch = original.match(/^([a-zA-Z_\-]{2,10}[-_])/);
      const prefix = prefixMatch ? prefixMatch[1] : 'key-';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const fakeLen = Math.max(16, original.length - prefix.length);
      let fake = prefix;
      for (let i = 0; i < fakeLen; i++) fake += chars[Math.floor(_secureRandom() * chars.length)];
      return fake;
    }

    case 'DATABASE_URI': {
      const scheme = original.match(/^([a-z+]+:\/\/)/)?.[1] || 'db://';
      return scheme + 'testuser:fakepwd@db-' + Math.floor(_secureRandom() * 9000 + 1000) + '.example.com:5432/testdb';
    }

    case 'PRIVATE_KEY': {
      const headerMatch = original.match(/^(-----BEGIN [A-Z ]+-----)/);
      const footerMatch = original.match(/(-----END [A-Z ]+-----)$/);
      if (headerMatch || footerMatch) {
        const header = headerMatch?.[1] || '-----BEGIN PRIVATE KEY-----';
        const footer = footerMatch?.[1] || '-----END PRIVATE KEY-----';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let fakeBody = '';
        for (let i = 0; i < 64; i++) fakeBody += chars[Math.floor(_secureRandom() * chars.length)];
        return header + '\n' + fakeBody + '\n' + footer;
      }
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let fake = '';
      for (let i = 0; i < original.length; i++) fake += chars[Math.floor(_secureRandom() * chars.length)];
      return fake;
    }

    case 'ADDRESS':
      return Math.floor(_randBetween(100, 9999)) + ' ' +
        ['Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Birch', 'Walnut', 'Spruce'][Math.floor(_secureRandom() * 8)] + ' ' +
        ['Street', 'Avenue', 'Drive', 'Lane', 'Court', 'Boulevard'][Math.floor(_secureRandom() * 6)];

    case 'BANK_ACCOUNT':
    case 'ROUTING_NUMBER':
    case 'ACCOUNT_NUMBER':
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());

    case 'EIN': {
      // EIN format: XX-XXXXXXX
      const p1 = Math.floor(_randBetween(10, 99));
      const p2 = Math.floor(_randBetween(1000000, 9999999));
      return p1 + '-' + p2;
    }

    default: {
      let result = original;
      if (/\d/.test(result)) {
        result = result.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
      }
      if (result === original && /[a-zA-Z]/.test(result)) {
        result = result.replace(/[a-zA-Z]/g, c => {
          const base = c >= 'a' ? 97 : 65;
          return String.fromCharCode(base + Math.floor(_secureRandom() * 26));
        });
      }
      return result;
    }
  }
}
