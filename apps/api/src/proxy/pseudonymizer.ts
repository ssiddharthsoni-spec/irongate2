// ==========================================
// Iron Gate Phase 2 — Pseudonymization Engine
// ==========================================

import type { DetectedEntity, EntityType } from '@iron-gate/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PseudonymMap {
  sessionId: string;
  firmId: string;
  mappings: Map<string, PseudonymEntry>;
  createdAt: Date;
  expiresAt: Date;
}

export interface PseudonymEntry {
  original: string;
  originalHash: string; // SHA-256 of original
  pseudonym: string;
  entityType: EntityType;
}

export interface PseudonymizeResult {
  maskedText: string;
  entitiesReplaced: number;
  map: PseudonymMap;
}

// ---------------------------------------------------------------------------
// Fake-value pools
// ---------------------------------------------------------------------------

const FAKE_PERSONS: string[] = [
  // --- Anglo/American (~150) ---
  'James Mitchell', 'Sarah Thompson', 'Robert Williams', 'Emily Davis',
  'David Johnson', 'Jessica Anderson', 'Michael Carter', 'Laura Bennett',
  'Thomas Brennan', 'Amanda Collins', 'William Parker', 'Rachel Dawson',
  'Christopher Hayes', 'Jennifer Walsh', 'Daniel Foster', 'Nicole Spencer',
  'Andrew Morrison', 'Stephanie Clark', 'Matthew Reynolds', 'Megan Fisher',
  'Brian Sullivan', 'Karen Bradley', 'Patrick Donovan', 'Allison Crawford',
  'Jonathan Reed', 'Rebecca Malone', 'Gregory Turner', 'Catherine Lawson',
  'Steven Harper', 'Natalie Brooks', 'Kevin Garrett', 'Michelle Warren',
  'Jason Fletcher', 'Samantha Douglas', 'Timothy Caldwell', 'Angela Mason',
  'Jeffrey Barton', 'Christina Palmer', 'Mark Shelton', 'Heather Ramsey',
  'Ryan Norwood', 'Kimberly Ashford', 'Justin Crenshaw', 'Amber Whitfield',
  'Brandon Hartley', 'Melissa Sinclair', 'Scott Thornton', 'Ashley Prescott',
  'Nathan Ellsworth', 'Diana Mercer', 'Kyle Langston', 'Vanessa Harding',
  'Derek Callahan', 'Brittany Winslow', 'Trevor Eastman', 'Courtney Blackwell',
  'Shane Pennington', 'Lindsey Fairbanks', 'Chase Drummond', 'Erin Lockhart',
  'Blake Ashworth', 'Hayley Whitmore', 'Grant Sheridan', 'Paige Ellington',
  'Wesley Compton', 'Brooke Stafford', 'Spencer Langley', 'Jenna Carlisle',
  'Garrett Huxley', 'Holly Pemberton', 'Russell Kirkwood', 'Victoria Ashby',
  'Dalton Fairchild', 'Kayla Remington', 'Marshall Bancroft', 'Tiffany Holbrook',
  'Preston Wakefield', 'Cynthia Dunmore', 'Clayton Baxter', 'Sandra Felton',
  'Warren Hensley', 'Gloria Sternberg', 'Douglas Ridgeway', 'Barbara Kensington',
  'Philip Wentworth', 'Margaret Ainsworth', 'Howard Beckford', 'Deborah Stanfield',
  'Lawrence Cromwell', 'Patricia Thornberry', 'Raymond Whitcomb', 'Donna Rutherford',
  'Roger Alderton', 'Carolyn Blanchard', 'Keith Farrington', 'Judith Stanhope',
  'Gerald Birchfield', 'Constance Waverly', 'Dennis Trumbull', 'Louise Ashcroft',
  'Craig Worthington', 'Marilyn Pembroke', 'Curtis Blackstone', 'Frances Elmsford',
  'Darren Halstead', 'Theresa Brookfield', 'Stuart Montrose', 'Cheryl Hargreaves',
  'Brent Kimberley', 'Wendy Chatsworth', 'Clifford Ravenscroft', 'Lillian Delafield',
  'Adrian Stonebridge', 'Martha Kingsley', 'Boyd Fairfield', 'Irene Clarkson',
  'Hugh Dewhurst', 'Grace Pemberton', 'Glenn Ashmore', 'Vivian Standish',
  'Lyle Thornburg', 'Norma Brightwell', 'Roderick Mansfield', 'Joan Whitfield',
  'Cecil Hartington', 'Wanda Stratford', 'Miles Bracewell', 'Loretta Ashdown',
  'Vance Kingsford', 'Dolores Wainwright', 'Reid Halcombe', 'Elaine Ridgemont',
  'Carlton Moorfield', 'Gwen Stansfield', 'Duncan Fairhaven', 'Rosa Briarcliff',
  'Nolan Westbury', 'Edna Castleford', 'Harris Fenwick', 'Vera Landsdowne',
  'Oliver Winfield', 'Lydia Ashburton', 'Edmund Haversham', 'Pearl Chadwick',

  // --- Hispanic/Latin (~80) ---
  'Carlos Garcia', 'Maria Rodriguez', 'Roberto Martinez', 'Isabella Hernandez',
  'Alejandro Lopez', 'Sofia Gonzalez', 'Fernando Castillo', 'Valentina Morales',
  'Diego Ramirez', 'Camila Ortiz', 'Javier Reyes', 'Lucia Vargas',
  'Miguel Herrera', 'Gabriela Mendoza', 'Rafael Torres', 'Natalia Rios',
  'Andres Vega', 'Daniela Rojas', 'Sebastian Guerrero', 'Mariana Delgado',
  'Pablo Aguilar', 'Adriana Navarro', 'Eduardo Salazar', 'Catalina Romero',
  'Enrique Molina', 'Ana Figueroa', 'Oscar Paredes', 'Juliana Cardenas',
  'Ricardo Espinoza', 'Elena Fuentes', 'Mateo Contreras', 'Paula Velasquez',
  'Hector Sandoval', 'Carolina Rivas', 'Rodrigo Acosta', 'Lorena Peralta',
  'Sergio Montalvo', 'Veronica Camacho', 'Ivan Estrada', 'Monica Bustamante',
  'Francisco Quiroz', 'Diana Lozano', 'Guillermo Villarreal', 'Alicia Trujillo',
  'Manuel Sepulveda', 'Teresa Bermudez', 'Alberto Cisneros', 'Silvia Palacios',
  'Arturo Maldonado', 'Beatriz Saavedra', 'Ramon Valenzuela', 'Marisol Coronado',
  'Luis Barrera', 'Claudia Quintero', 'Hugo Zavaleta', 'Pilar Echeverria',
  'Cesar Arellano', 'Ximena Gallardo', 'Jorge Villalobos', 'Fernanda Pantoja',
  'Raul Montoya', 'Renata Caballero', 'Ignacio Zamora', 'Andrea Solis',
  'Ernesto Beltran', 'Marcela Ibarra', 'Gustavo Noriega', 'Patricia Velasco',
  'Marco Cervantes', 'Rosa Escalante', 'Alfredo Madrigal', 'Graciela Plascencia',
  'Salvador Ocampo', 'Carmen Barajas', 'Tomas Villegas', 'Amparo Renteria',
  'Benito Balderas', 'Yolanda Orozco', 'Ruben Salcedo', 'Dolores Medrano',

  // --- East Asian (~60) ---
  'Wei Chen', 'Mei Lin Zhang', 'Jianwei Liu', 'Xiaoli Wang',
  'Hao Yang', 'Yue Huang', 'Zhiwei Wu', 'Xiuying Zhou',
  'Liang Xu', 'Fangfang Li', 'Kenji Tanaka', 'Yuki Watanabe',
  'Takeshi Yamamoto', 'Sakura Ishikawa', 'Daisuke Nakamura', 'Haruka Fujimoto',
  'Kazuhiro Shimizu', 'Akiko Morimoto', 'Ryota Hayashi', 'Emi Ueda',
  'Soo-Jin Kim', 'Min-Ho Park', 'Eun-Ji Lee', 'Sang-Woo Choi',
  'Ji-Yeon Kang', 'Tae-Hyun Jung', 'Hye-Rin Yoon', 'Dong-Wook Shin',
  'Minh Nguyen', 'Thuy Tran', 'Duc Pham', 'Linh Le',
  'Huan Vo', 'Mai Hoang', 'Khanh Bui', 'Ngoc Dang',
  'Cheng Zhao', 'Jing Sun', 'Bowen Ma', 'Yingxia Guo',
  'Haoran Zhu', 'Wenli He', 'Junfeng Gao', 'Lihua Deng',
  'Tao Luo', 'Rui Xie', 'Sheng Han', 'Yanping Feng',
  'Hiroshi Okada', 'Noriko Takahashi', 'Masato Inoue', 'Chihiro Nishida',
  'Yoshio Murakami', 'Tomoko Saito', 'Hyun-Woo Kwon', 'Su-Yeon Hwang',
  'Quang Truong', 'Phuong Lam', 'Thanh Do', 'An Dinh',

  // --- South Asian (~50) ---
  'Rajesh Patel', 'Priya Sharma', 'Vikram Kumar', 'Ananya Desai',
  'Arjun Malhotra', 'Sneha Kapoor', 'Rohan Mehta', 'Kavitha Iyer',
  'Sanjay Gupta', 'Pooja Nair', 'Amit Chowdhury', 'Deepika Reddy',
  'Suresh Banerjee', 'Meena Krishnamurthy', 'Rahul Joshi', 'Anjali Bhat',
  'Vivek Srinivasan', 'Sunita Pillai', 'Karthik Venkatesh', 'Lakshmi Rao',
  'Dinesh Agarwal', 'Ritu Saxena', 'Nikhil Thakur', 'Seema Pandey',
  'Ashok Bhattacharya', 'Nandini Menon', 'Manish Kulkarni', 'Swati Deshpande',
  'Gaurav Tiwari', 'Aditi Shenoy', 'Ramesh Chatterjee', 'Divya Balachandran',
  'Anil Mukherjee', 'Pallavi Hegde', 'Venkat Subramanian', 'Jaya Ramaswamy',
  'Harish Naidu', 'Rekha Mahajan', 'Pranav Kaul', 'Isha Walia',
  'Siddharth Ranganathan', 'Madhuri Joglekar', 'Prakash Sundaram', 'Usha Varma',
  'Ajay Choudhary', 'Tara Ravindran', 'Mohan Seshadri', 'Gita Fernandes',
  'Sunil Ganguly', 'Kalyani Madhavan',

  // --- European (~50) ---
  'Hans Mueller', 'Brigitte Hofmann', 'Wolfgang Richter', 'Ingrid Baumgartner',
  'Klaus Zimmermann', 'Petra Vogt', 'Stefan Braun', 'Ursula Kessler',
  'Jean-Pierre Dubois', 'Colette Moreau', 'Antoine Lefevre', 'Madeleine Girard',
  'Luca Rossi', 'Francesca Conti', 'Alessandro Marchetti', 'Giulia Ferrero',
  'Pavel Novak', 'Katerina Dvorak', 'Miroslav Hajek', 'Zuzana Horakova',
  'Erik Lindqvist', 'Astrid Johansson', 'Bjorn Hedlund', 'Ingrid Bergstrom',
  'Piotr Kowalski', 'Agnieszka Wozniak', 'Tomasz Mazur', 'Katarzyna Krawczyk',
  'Andrei Petrov', 'Natasha Volkova', 'Dmitri Sokolov', 'Irina Kuznetsova',
  'Nikos Papadopoulos', 'Elena Stavridis', 'Christos Angelopoulos', 'Sofia Konstantinou',
  'Finn Sorensen', 'Helle Rasmussen', 'Lars Kristiansen', 'Mette Jacobsen',
  'Joao Ferreira', 'Mariana Almeida', 'Tiago Cardoso', 'Ines Oliveira',
  'Mikael Virtanen', 'Sanna Lahtinen', 'Juha Korhonen', 'Maija Nieminen',
  'Romain Blanchard', 'Camille Durand',

  // --- Middle Eastern (~40) ---
  'Khalid Al-Rashid', 'Fatima Hassan', 'Omar Khoury', 'Layla Mansour',
  'Tariq Al-Farsi', 'Nadia Saleh', 'Youssef Haddad', 'Rania Khalil',
  'Ibrahim Nassiri', 'Samira Bazzi', 'Mustafa Demir', 'Elif Yilmaz',
  'Hassan Jafari', 'Zahra Hosseini', 'Amir Rahimi', 'Parisa Karimi',
  'Kamal Siddiqui', 'Huda Barakat', 'Sami Tannous', 'Maryam Farouk',
  'Rashid Al-Maktoum', 'Leila Sabbagh', 'Faisal Qureshi', 'Dina Nasser',
  'Waleed Bishara', 'Rana Darwish', 'Nabil Shamsi', 'Yasmin Mourad',
  'Adnan Habibi', 'Souad Amari', 'Bilal Othman', 'Noura Karam',
  'Zaid Bakhtiar', 'Salwa Touma', 'Jamal Kassab', 'Ghada Massoud',
  'Idris Hammoud', 'Amira Tadros', 'Saeed Chalabi', 'Lina Antoun',

  // --- African (~40) ---
  'Chukwu Okafor', 'Ngozi Eze', 'Emeka Nwosu', 'Chidinma Okechukwu',
  'Obinna Onyekachi', 'Adaeze Nwachukwu', 'Kwame Mensah', 'Abena Asante',
  'Kofi Boateng', 'Akua Owusu', 'Moussa Diallo', 'Aminata Traore',
  'Ousmane Keita', 'Fatou Cisse', 'Ibrahima Sow', 'Mariama Balde',
  'Tendai Moyo', 'Rutendo Chikosi', 'Tinashe Mukondo', 'Ruvimbo Manyonga',
  'Oluwaseun Adeyemi', 'Folake Ogunbiyi', 'Adebayo Oladipo', 'Yetunde Bakare',
  'Sipho Dlamini', 'Nomvula Khumalo', 'Thabo Molefe', 'Zanele Mthembu',
  'Abdoulaye Toure', 'Aissatou Camara', 'Mamadou Diop', 'Khady Ndiaye',
  'Chinwe Amadi', 'Uchenna Onuoha', 'Eliud Kiplagat', 'Wangari Njoroge',
  'Sekou Fofana', 'Kadiatou Bah', 'Yaw Frimpong', 'Efua Agyemang',

  // --- Mixed/Other (~30) ---
  'Kai Nakamura-Ellis', 'Zara Patel-Johnson', 'Marcus Chen-Williams',
  'Leila Hernandez-Ali', 'Soren Okafor-Berg', 'Maya Gupta-Ross',
  'Rio Tanaka-Morrison', 'Priya Sullivan-Rao', 'Andre Dubois-Mensah',
  'Nadia Kim-Petrov', 'Elias Moreau-Singh', 'Yuki Fernandez-Park',
  'Dario Kapoor-Rossi', 'Hana Mueller-Tran', 'Felix Sharma-Lindqvist',
  'Amara Diallo-Chen', 'Tobias Hassan-Clark', 'Suki Alvarez-Watanabe',
  'Milo Khoury-Thompson', 'Anika Novak-Patel', 'Ren Okonkwo-Hayashi',
  'Lucia Johansson-Reyes', 'Tariq Brennan-Farouk', 'Mei Sullivan-Zhang',
  'Idris Crawford-Asante', 'Yara Petrov-Hernandez', 'Kenji Malone-Shimizu',
  'Asha Thornton-Iyer', 'Leo Kowalski-Nguyen', 'Sofia Caldwell-Rios',
  'Ravi Okafor-Lindqvist', 'Nia Tanaka-Herrera', 'Dante Kim-Ashworth',
  'Zuri Petrov-Nair', 'Mateo Johansson-Diallo', 'Lena Hassan-Watanabe',
];

const FAKE_ORGANIZATIONS: string[] = [
  // --- Financial (~40) ---
  'Meridian Capital Partners', 'Summit Point Advisors', 'Crestline Securities',
  'Pinnacle Wealth Holdings', 'Vanguard Creek Capital', 'Silverton Asset Group',
  'Ironbridge Financial', 'Keystone Private Equity', 'Lakewood Capital Advisors',
  'Northwind Securities', 'Greystone Partners', 'Bluerock Investment Group',
  'Harborview Capital', 'Ashford Wealth Partners', 'Ridgeline Advisors',
  'Copperfield Securities', 'Thornbury Capital', 'Broadmoor Financial Group',
  'Whitecliff Partners', 'Stonewall Asset Management', 'Clearwater Capital Holdings',
  'Briarwood Securities', 'Eaglepoint Advisors', 'Oakmont Capital Partners',
  'Falconbridge Financial', 'Windermere Wealth Group', 'Blackpine Capital',
  'Maplecrest Advisors', 'Granville Securities', 'Lakeshore Capital Partners',
  'Edgewood Financial Group', 'Prestwick Partners', 'Cedarpoint Capital',
  'Heathwood Securities', 'Rosemount Advisors', 'Brackenridge Capital',
  'Alderton Financial Partners', 'Foxdale Securities', 'Kensington Wealth Group',
  'Ravenswood Capital',

  // --- Technology (~35) ---
  'Vanteon Systems', 'Nexacore Technologies', 'Cyberion Digital',
  'Quantumleaf Labs', 'Synthetica AI', 'Heliograph Technologies',
  'Prismwave Systems', 'Aethon Digital Solutions', 'Cortexia Labs',
  'Luminova Technologies', 'Bytecraft Systems', 'Neuralpath Digital',
  'Skyforge Technologies', 'Dataweave Labs', 'Circuitmine Systems',
  'Parallax Digital', 'Stratosync Technologies', 'Gridpoint Labs',
  'Cipherlock Systems', 'Orbitalink Technologies', 'Teravolt Digital',
  'Axionware Labs', 'Pulsenet Systems', 'Chromavista Technologies',
  'Infinitrace Digital', 'Zenithcore Labs', 'Fluxpoint Systems',
  'Nebulastream Technologies', 'Arcturis Digital', 'Synthwave Labs',
  'Volterra Systems', 'Pixelforge Technologies', 'Datanexus Labs',
  'Cloudpeak Systems', 'Algorithmix Digital',

  // --- Legal (~20) ---
  'Stanton Brightmore LLP', 'Fairfield Waverly Associates',
  'Thornton Kessler Law Group', 'Pemberton Drake LLP',
  'Ashcroft Langley Associates', 'Ravenscroft Sinclair LLP',
  'Whitmore Caldwell Law Group', 'Hartley Prescott Associates',
  'Kingsford Baxter LLP', 'Cromwell Delafield Law Group',
  'Stratford Mercer Associates', 'Westbrook Ainsworth LLP',
  'Halstead Fenwick Law Group', 'Briarcliff Montrose Associates',
  'Chatsworth Ellison LLP', 'Fairhaven Drummond Law Group',
  'Ridgemont Pembroke Associates', 'Stanfield Wentworth LLP',
  'Blackwell Hargreaves Law Group', 'Elmsford Birchfield Associates',

  // --- Healthcare (~25) ---
  'Verdant Health Systems', 'Astramedica Therapeutics', 'Clearpath Medical Group',
  'Pinnacle Health Partners', 'Novaheal Biosciences', 'Crestview Medical',
  'Horizoncare Health Systems', 'Bridgewell Therapeutics', 'Silverleaf Medical Group',
  'Northgate Health Partners', 'Evergreen Medical Systems', 'Luminos Therapeutics',
  'Oakbridge Health Group', 'Meridia Biosciences', 'Sunstone Medical Partners',
  'Willowbrook Health Systems', 'Sapphire Therapeutics', 'Cedarwood Medical Group',
  'Brightwater Health Partners', 'Fieldstone Biosciences', 'Ridgecrest Medical',
  'Havenport Health Systems', 'Azurite Therapeutics', 'Maplewood Medical Partners',
  'Ironstone Health Group',

  // --- Manufacturing (~25) ---
  'Titanforge Industries', 'Steelcrest Manufacturing', 'Ironworks Corp',
  'Blackrock Industrial', 'Copperline Manufacturing', 'Granite Ridge Industries',
  'Hammerfield Corp', 'Anvil Point Manufacturing', 'Brassworks Industrial',
  'Foundryhill Corp', 'Steelvale Industries', 'Ironclad Manufacturing',
  'Cobalt Peak Industrial', 'Forgemaster Corp', 'Alloystream Industries',
  'Ridgehammer Manufacturing', 'Tempered Steel Corp', 'Boltworks Industrial',
  'Carbide Valley Manufacturing', 'Stonemill Industries', 'Ironpeak Corp',
  'Alloycraft Manufacturing', 'Hammerstone Industrial', 'Forgecrest Corp',
  'Steelbridge Industries',

  // --- Consulting (~30) ---
  'Stratton Consulting Group', 'Ashworth Advisory Partners', 'Crestview Consulting',
  'Bridgewater Advisory Group', 'Lockwood Strategy Partners', 'Heathfield Consulting',
  'Fairmont Advisory Group', 'Kingsbridge Consulting', 'Aldermore Strategy Partners',
  'Thornfield Advisory', 'Westgate Consulting Group', 'Rosecroft Strategy Partners',
  'Pemberton Advisory Group', 'Brackenfield Consulting', 'Stanmore Strategy Partners',
  'Whitehall Advisory Group', 'Moorfield Consulting', 'Ashdale Strategy Partners',
  'Brookstone Advisory', 'Ridgedale Consulting Group', 'Fairbridge Strategy Partners',
  'Langford Advisory Group', 'Hawthorn Consulting', 'Stonebridge Strategy Partners',
  'Castleford Advisory', 'Windfield Consulting Group', 'Ashgrove Strategy Partners',
  'Briarfield Advisory Group', 'Heathrow Consulting Partners', 'Clearfield Strategy Group',

  // --- Energy (~25) ---
  'Solarwind Energy', 'Deepwell Resources', 'Stormcrest Power',
  'Brightfield Energy Corp', 'Tidemark Resources', 'Windgate Power Systems',
  'Greenrock Energy', 'Peakstream Resources', 'Voltaic Power Corp',
  'Sunridge Energy Partners', 'Ironflow Resources', 'Galeforce Power',
  'Riverbend Energy Corp', 'Coalridge Resources', 'Meridian Power Systems',
  'Hawkwind Energy', 'Crestfall Resources', 'Thunderpeak Power Corp',
  'Silverstream Energy', 'Northgate Resources', 'Tidewater Power Systems',
  'Redstone Energy Corp', 'Windmere Resources', 'Stormhaven Power',
  'Clearwater Energy Partners',
];

const FAKE_LOCATIONS: string[] = [
  '742 Evergreen Terrace, Springfield, IL 62704',
  '1234 Maple Drive, Suite 300, Portland, OR 97201',
  '567 Oakmont Boulevard, Austin, TX 78701',
  '890 Pinecrest Street, Denver, CO 80202',
  '2345 Elmwood Avenue, Boston, MA 02108',
  '678 Cedarbrook Lane, Seattle, WA 98101',
  '1011 Birchfield Road, Nashville, TN 37201',
  '1213 Walnut Grove Court, Miami, FL 33101',
  '1415 Sprucewood Way, Chicago, IL 60601',
  '1617 Aspen Ridge Circle, San Francisco, CA 94102',
  '1819 Willowmere Path, Phoenix, AZ 85001',
  '2021 Chestnut Hill Drive, Philadelphia, PA 19101',
  '2223 Poplar Creek Street, Atlanta, GA 30301',
  '2425 Magnolia Bend Blvd, Dallas, TX 75201',
  '2627 Cypress Point Lane, Minneapolis, MN 55401',
  '3100 Silverbell Way, Sacramento, CA 95814',
  '4250 Thornberry Drive, Raleigh, NC 27601',
  '1578 Ridgecrest Avenue, Salt Lake City, UT 84101',
  '2890 Hawthorne Circle, Columbus, OH 43215',
  '3315 Briarwood Court, Charlotte, NC 28202',
  '4720 Stonebridge Road, Indianapolis, IN 46204',
  '5180 Ferndale Lane, San Diego, CA 92101',
  '6340 Meadowlark Drive, Jacksonville, FL 32202',
  '7125 Cobblestone Way, San Antonio, TX 78205',
  '8450 Foxglove Street, Fort Worth, TX 76102',
  '1935 Heatherfield Avenue, Baltimore, MD 21201',
  '2760 Laurelwood Drive, Milwaukee, WI 53202',
  '3480 Rosemount Circle, Albuquerque, NM 87102',
  '4195 Stonehaven Court, Tucson, AZ 85701',
  '5620 Briarcrest Road, Fresno, CA 93721',
  '6755 Maplewood Lane, Mesa, AZ 85201',
  '7340 Willowspring Drive, Kansas City, MO 64106',
  '8100 Cedarfield Way, Omaha, NE 68102',
  '1245 Brookstone Avenue, Colorado Springs, CO 80903',
  '2560 Ashgrove Court, Virginia Beach, VA 23451',
  '3875 Pinemeadow Road, Long Beach, CA 90802',
  '4490 Oakridge Circle, Oakland, CA 94612',
  '5715 Elderberry Lane, Tulsa, OK 74103',
  '6230 Sycamore Bend Drive, Tampa, FL 33602',
  '7845 Fieldstone Way, New Orleans, LA 70112',
  '1380 Birchgrove Avenue, Cleveland, OH 44114',
  '2695 Summerfield Court, Honolulu, HI 96813',
  '3910 Windermere Road, Lexington, KY 40507',
  '4525 Hazelwood Lane, Anchorage, AK 99501',
  '5840 Ivywood Drive, Pittsburgh, PA 15222',
  '6155 Briargate Circle, St. Louis, MO 63101',
  '7470 Sherwood Way, Cincinnati, OH 45202',
  '8285 Crestview Avenue, Greensboro, NC 27401',
  '1600 Mulberry Court, Lincoln, NE 68508',
  '2915 Foxwood Road, Plano, TX 75024',
  '3630 Pondview Lane, Henderson, NV 89012',
  '4345 Timberline Drive, St. Paul, MN 55101',
  '5060 Amberly Circle, Newark, NJ 07102',
  '5775 Creekstone Way, Buffalo, NY 14202',
  '6490 Hearthstone Avenue, Chandler, AZ 85225',
  '7205 Bayberry Court, Madison, WI 53703',
  '7920 Winding Brook Road, Lubbock, TX 79401',
  '8635 Shadowmere Lane, Chesapeake, VA 23320',
  '9350 Cloverdale Drive, Norfolk, VA 23510',
  '1065 Sunstone Way, Laredo, TX 78040',
  '1780 Ridgeview Avenue, Durham, NC 27701',
  '2495 Ashmeadow Court, Chula Vista, CA 91910',
  '3210 Larkfield Road, Irvine, CA 92618',
  '3925 Honeysuckle Lane, Rochester, NY 14604',
  '4640 Meadowbrook Drive, Gilbert, AZ 85234',
  '5355 Briarfield Circle, Glendale, AZ 85301',
  '6070 Willowcreek Way, North Las Vegas, NV 89032',
  '6785 Fernwood Avenue, Winston-Salem, NC 27101',
  '7500 Stratford Court, Richmond, VA 23219',
  '8215 Pinebluff Road, Boise, ID 83702',
  '8930 Ashbury Lane, Des Moines, IA 50309',
  '9645 Goldenrod Drive, Spokane, WA 99201',
  '1160 Tanglewood Way, Tacoma, WA 98402',
  '1875 Hartfield Avenue, San Bernardino, CA 92401',
  '2590 Silveroak Court, Modesto, CA 95354',
  '3305 Edgewood Road, Fontana, CA 92335',
  '4020 Clearspring Lane, Moreno Valley, CA 92553',
  '4735 Briarvale Drive, Fayetteville, NC 28301',
  '5450 Summerstone Circle, Huntington Beach, CA 92648',
  '6165 Wildflower Way, Glendale, CA 91201',
  '6880 Applewood Avenue, Salt Lake City, UT 84111',
  '7595 Deerfield Court, Yonkers, NY 10701',
  '8310 Stonecrest Road, Aurora, IL 60505',
  '9025 Ravenwood Lane, Akron, OH 44308',
  '9740 Brookhaven Drive, Knoxville, TN 37902',
  '1455 Woodcrest Way, Mobile, AL 36602',
  '2170 Rosewood Avenue, Shreveport, LA 71101',
  '2885 Shadowbrook Court, Augusta, GA 30901',
  '3600 Havenfield Road, Grand Rapids, MI 49503',
  '4315 Sunmeadow Lane, Montgomery, AL 36104',
  '5030 Coppervale Drive, Little Rock, AR 72201',
  '5745 Ashfield Circle, Amarillo, TX 79101',
  '6460 Fernbrook Way, Tallahassee, FL 32301',
  '7175 Bellwood Avenue, Huntsville, AL 35801',
  '7890 Stonehill Court, Grand Prairie, TX 75050',
  '8605 Pinecove Road, Overland Park, KS 66204',
  '9320 Elmridge Lane, Brownsville, TX 78520',
  '1035 Heathfield Drive, Tempe, AZ 85281',
  '1750 Meadowstone Way, Peoria, AZ 85345',
  '2465 Brookhaven Circle, Savannah, GA 31401',
];

const FAKE_DEAL_CODENAMES: string[] = [
  'Project Falcon', 'Project Orion', 'Project Nexus', 'Project Horizon',
  'Project Zenith', 'Project Apex', 'Project Titan', 'Project Nova',
  'Project Eclipse', 'Project Vanguard', 'Project Aurora', 'Project Summit',
  'Project Atlas', 'Project Pinnacle', 'Project Compass', 'Project Sequoia',
  'Project Polaris', 'Project Everest', 'Project Avalon', 'Project Tempest',
  'Project Solstice', 'Project Meridian', 'Project Nebula', 'Project Cascade',
  'Project Olympus', 'Project Tundra', 'Project Raptor', 'Project Equinox',
  'Project Vulcan', 'Project Talon', 'Project Denali', 'Project Artemis',
  'Project Condor', 'Project Magellan', 'Project Redwood', 'Project Thunderbolt',
  'Project Glacier', 'Project Phoenix', 'Project Triton', 'Project Pegasus',
  'Project Kodiak', 'Project Sapphire', 'Project Ironwood', 'Project Monsoon',
  'Project Osprey', 'Project Caspian', 'Project Ember', 'Project Zephyr',
  'Project Stormfront', 'Project Obsidian',
];

const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// SHA-256 helper (uses crypto.subtle, available in Bun)
// ---------------------------------------------------------------------------

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Synchronous SHA-256 using Node crypto (works in Bun too)
function sha256Sync(input: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// Deterministic seeded random helpers
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic index from a string hash so the same original value
 * always picks the same fake from a given pool within the same session.
 */
function pickFromPool<T>(pool: T[], hash: string): T {
  // Use the first 8 hex chars of the hash as a 32-bit seed
  const seed = parseInt(hash.slice(0, 8), 16);
  return pool[seed % pool.length];
}

/**
 * Generate a deterministic "random" number in [0, 1) from a hash string,
 * using a different slice than pickFromPool to avoid correlation.
 */
function deterministicRandom(hash: string): number {
  const seed = parseInt(hash.slice(8, 16), 16);
  return seed / 0xffffffff;
}

// ---------------------------------------------------------------------------
// Fake value generators (all deterministic on hash)
// ---------------------------------------------------------------------------

function generateFakePerson(hash: string): string {
  return pickFromPool(FAKE_PERSONS, hash);
}

function generateFakeOrganization(hash: string): string {
  return pickFromPool(FAKE_ORGANIZATIONS, hash);
}

function generateFakeEmail(hash: string): string {
  const person = generateFakePerson(hash);
  const [first, last] = person.replace(/'/g, '').toLowerCase().split(' ');
  const domains = ['example.com', 'example.org', 'test.example.net', 'mail.example.com'];
  const domain = pickFromPool(domains, hash.slice(4));
  return `${first}.${last}@${domain}`;
}

function generateFakePhone(hash: string): string {
  const areaDigits = (parseInt(hash.slice(0, 3), 16) % 800) + 200; // 200-999
  const mid = (parseInt(hash.slice(3, 6), 16) % 900) + 100;       // 100-999
  const last = (parseInt(hash.slice(6, 10), 16) % 9000) + 1000;   // 1000-9999
  return `(${areaDigits}) ${mid}-${last}`;
}

function generateFakeSSN(hash: string): string {
  const a = (parseInt(hash.slice(0, 3), 16) % 899) + 100;  // 100-998
  const b = (parseInt(hash.slice(3, 5), 16) % 90) + 10;    // 10-99
  const c = (parseInt(hash.slice(5, 9), 16) % 9000) + 1000; // 1000-9999
  return `${a}-${b}-${c}`;
}

function generateFakeCreditCard(hash: string): string {
  // Generate a 16-digit number that looks like a Visa card
  let card = '4';
  for (let i = 1; i < 16; i++) {
    card += (parseInt(hash.slice(i % hash.length, (i % hash.length) + 2), 16) % 10).toString();
  }
  // Format with dashes
  return `${card.slice(0, 4)}-${card.slice(4, 8)}-${card.slice(8, 12)}-${card.slice(12, 16)}`;
}

function generateFakeMonetaryAmount(original: string, hash: string): string {
  // Extract numeric value from original, jitter by +/-20%
  const numericMatch = original.replace(/[^0-9.]/g, '');
  const value = parseFloat(numericMatch);

  if (isNaN(value) || value === 0) {
    return '$1,234.56';
  }

  const rnd = deterministicRandom(hash);
  // jitter: scale between 0.8 and 1.2
  const jitter = 0.8 + rnd * 0.4;
  const newValue = value * jitter;

  // Detect if original had a currency symbol/prefix
  const currencyMatch = original.match(/^[^\d]*/)
  const prefix = currencyMatch ? currencyMatch[0].trim() : '$';

  // Format with commas and 2 decimal places
  const formatted = newValue
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return prefix ? `${prefix}${formatted}` : `$${formatted}`;
}

function generateFakeLocation(hash: string): string {
  return pickFromPool(FAKE_LOCATIONS, hash);
}

function generateFakeMatterNumber(hash: string): string {
  const prefix = (parseInt(hash.slice(0, 4), 16) % 9000) + 1000;
  const suffix = (parseInt(hash.slice(4, 8), 16) % 900) + 100;
  return `M-${prefix}-${suffix}`;
}

function generateFakeClientMatterPair(hash: string): string {
  const client = generateFakeOrganization(hash);
  const matterNum = generateFakeMatterNumber(hash.slice(8));
  return `${client} / ${matterNum}`;
}

function generateFakeDealCodename(hash: string): string {
  return pickFromPool(FAKE_DEAL_CODENAMES, hash);
}

function generateFakeAccountNumber(hash: string): string {
  let acct = '';
  for (let i = 0; i < 10; i++) {
    acct += (parseInt(hash.slice(i, i + 2), 16) % 10).toString();
  }
  return acct;
}

function generateFakeIPAddress(hash: string): string {
  // RFC 5737 documentation range: 192.0.2.0/24
  const lastOctet = (parseInt(hash.slice(0, 4), 16) % 254) + 1; // 1-254
  return `192.0.2.${lastOctet}`;
}

// ---------------------------------------------------------------------------
// Entity classification: identifying vs computational
// ---------------------------------------------------------------------------

/**
 * Entity types that ALWAYS reveal identity — always pseudonymized regardless of context.
 */
const ALWAYS_IDENTIFYING_TYPES: Set<string> = new Set([
  'PERSON', 'ORGANIZATION', 'EMAIL', 'PHONE_NUMBER', 'SSN',
  'CREDIT_CARD', 'ACCOUNT_NUMBER', 'PASSPORT_NUMBER',
  'DRIVERS_LICENSE', 'IP_ADDRESS', 'LOCATION', 'MEDICAL_RECORD',
]);

// ---------------------------------------------------------------------------
// Holistic Context Intelligence
// ---------------------------------------------------------------------------
// Instead of keyword-matching near each entity, we analyze the WHOLE document
// like a human would:
//
//   1. What kind of document is this? (legal memo, casual question, etc.)
//   2. Are there real people identified? (names + SSNs = real case)
//   3. Are numbers tied to those people? (her salary, his account balance)
//   4. Does the user need computation on those numbers?
//
// The COMBINATION determines the strategy:
//   - Generic math, no people → keep numbers real, any route
//   - Real people's numbers, no math needed → pseudonymize, cloud route
//   - Real people's numbers, math needed → keep real, PRIVATE LLM route
// ---------------------------------------------------------------------------

export interface ExecutiveFlag {
  category: string;
  label: string;
  action: 'private_llm' | 'pseudonymize';
  reason: string;
  hits: number;
}

export interface ContextAnalysis {
  /** Is this a confidential document overall? */
  isConfidentialDocument: boolean;
  /** Are there identified real people in the prompt? */
  hasIdentifiedPersons: boolean;
  /** Does the user want the LLM to do math/computation? */
  needsComputation: boolean;
  /** Strategy for handling values */
  valueStrategy: 'pseudonymize' | 'keep_real' | 'private_llm';
  /** Human-readable reasoning */
  reasoning: string;
  /** Detected industry vertical (null if no strong signal) */
  detectedIndustry: string | null;
  /** Executive Lens flags — semantic IP risks detected by CEO/GC lens */
  executiveFlags: ExecutiveFlag[];
  /** Role that reviewed (e.g., "CEO + VP R&D") */
  executiveRole: string | null;
  /** Highest-priority executive action */
  executiveAction: 'private_llm' | 'pseudonymize' | null;
}

// ---------------------------------------------------------------------------
// EXECUTIVE LENS — "Would the CEO + General Counsel approve sharing this?"
// ---------------------------------------------------------------------------
// For each industry, we define what content the CEO and GC would NEVER allow
// to leave the building. This goes beyond PII — it covers trade secrets,
// strategies, formulas, and competitive intelligence.
// ---------------------------------------------------------------------------
interface ExecutiveLensRule {
  category: string;
  label: string;
  patterns: RegExp[];
  action: 'private_llm' | 'pseudonymize';
  reason: string;
}

interface ExecutiveLensEntry {
  role: string;
  neverShare: ExecutiveLensRule[];
  okToShare: string[];
}

const EXECUTIVE_LENS: Record<string, ExecutiveLensEntry> = {
  manufacturing: {
    role: 'CEO + VP R&D',
    neverShare: [
      { category: 'PROPRIETARY_FORMULA', label: 'Proprietary Formula / Recipe',
        patterns: [/\d+(\.\d+)?%\s*(?:sodium|potassium|sulfate|betaine|acid|hydroxide|surfactant|glycol|silicone|preservative|oxide|chloride|limonene|phenoxyethanol|isothiazolinone|laureth|cocamido)/gi,
                   /\bpH\s*(?:of\s*)?\d+(\.\d+)?/gi,
                   /\bheat(?:ed)?\s+to\s+\d+\s*°?[CF]?\b/gi,
                   /\bformul(?:a|ation)\b/gi,
                   /\bproprietary\s+(?:blend|formula|process|recipe|formulation)\b/gi,
                   /\bq\.?\s*s\.?\s*to\s*100\s*%/gi,
                   /\bviscosity\s*(?:\(|target|of)?\s*\d/gi],
        action: 'private_llm', reason: 'Trade secret — formulation IP cannot be sent externally' },
      { category: 'MANUFACTURING_PROCESS', label: 'Manufacturing Process Parameters',
        patterns: [/\b(?:reactor|batch|mixing|curing|distill|extrusion|ferment)\s+(?:temp|temperature|time|speed|size|pressure)/gi,
                   /\b\d+\s*(?:RPM|rpm|psi|bar|cP|mPa)\b/g,
                   /\b\d+\s*°[CF]\b/g,
                   /\byield[:\s]+\d+(\.\d+)?%/gi,
                   /\bbatch\s+(?:size|cycle|process)\b/gi],
        action: 'private_llm', reason: 'Proprietary manufacturing process — competitive advantage' },
      { category: 'SUPPLIER_TERMS', label: 'Supplier Pricing / Terms',
        patterns: [/\bsupplier[:\s]+[A-Z]/gi,
                   /\$\d+(\.\d+)?\/(?:kg|lb|ton|liter|gallon|unit)\b/gi,
                   /\bcost\s+per\s+(?:unit|kg|lb|ton|liter|gallon|batch)\b/gi,
                   /\braw\s+material\s+cost/gi],
        action: 'pseudonymize', reason: 'Supplier relationships are competitively sensitive' },
    ],
    okToShare: ['general chemistry', 'safety data sheets', 'published regulations'],
  },
  legal: {
    role: 'General Counsel',
    neverShare: [
      { category: 'LEGAL_STRATEGY', label: 'Litigation / Negotiation Strategy',
        patterns: [/\b(?:our|we|firm'?s?)\s+(?:strategy|position|argument|approach|theory)\b/gi,
                   /\bwe\s+(?:plan|intend|will|should)\s+to\s+(?:argue|file|settle|motion|depose)\b/gi,
                   /\bsettlement\s+(?:demand|offer|position|range|authority)\b/gi,
                   /\bprepared\s+to\s+(?:offer|settle|accept)\b/gi],
        action: 'private_llm', reason: 'Legal strategy is work product — privileged, cannot be pseudonymized' },
      { category: 'CLIENT_MATTER', label: 'Client-Matter Data',
        patterns: [/\battorney[- ]client\s+privilege\b/gi,
                   /\bprivileged\s+and\s+confidential\b/gi,
                   /\bwork\s+product\b/gi],
        action: 'private_llm', reason: 'Attorney-client privilege — entire communication must stay on-prem' },
    ],
    okToShare: ['case law citations', 'statutes', 'general legal principles'],
  },
  healthcare: {
    role: 'Chief Medical Officer + Privacy Officer',
    neverShare: [
      { category: 'PATIENT_DATA', label: 'Protected Health Information',
        patterns: [/\bpatient\b.*\b(?:diagnos|condition|medication|treatment|procedure)\b/gi,
                   /\bprotected\s+health\b/gi,
                   /\bHIPAA\b/g],
        action: 'pseudonymize', reason: 'HIPAA: PHI must be de-identified before external transmission' },
      { category: 'CLINICAL_IP', label: 'Unpublished Clinical / Drug Data',
        patterns: [/\bproprietary\s+(?:drug|compound|therapy|formulation|protocol)\b/gi,
                   /\bclinical\s+trial\s+(?:data|results|phase)\b/gi,
                   /\bunpublished\s+(?:data|findings|results|study)\b/gi],
        action: 'private_llm', reason: 'Pre-publication clinical IP — premature disclosure could void patent rights' },
    ],
    okToShare: ['published clinical guidelines', 'FDA-approved drug info', 'general medical knowledge'],
  },
  finance: {
    role: 'Chief Compliance Officer',
    neverShare: [
      { category: 'MNPI', label: 'Material Non-Public Information',
        patterns: [/\b(?:non-public|unreleased|pre-announcement|insider)\b/gi,
                   /\bacquisition\s+target\b/gi,
                   /\bproject\s+[A-Z][a-z]+\b/g,
                   /\bunder\s+NDA\b/gi,
                   /\bcap\s+table\b/gi,
                   /\bwire\s+(?:instructions|transfer)\b/gi],
        action: 'private_llm', reason: 'MNPI — deal structure itself is material, pseudonymizing alone insufficient' },
      { category: 'CLIENT_PORTFOLIO', label: 'Client Portfolio / Positions',
        patterns: [/\b\d[\d,]*\s+shares?\s+@\s*\$/gi,
                   /\bface\s+value\b/gi,
                   /\bcurrent\s+positions?\b/gi,
                   /\btarget\s+allocation\b/gi],
        action: 'private_llm', reason: 'Portfolio positions reveal trading strategy — pattern itself is identifiable' },
    ],
    okToShare: ['published market data', 'SEC filings', 'general financial concepts'],
  },
  technology: {
    role: 'CTO + CISO',
    neverShare: [
      { category: 'CREDENTIALS', label: 'API Keys / Secrets / Credentials',
        patterns: [/\b(?:sk_|api_key_|svc_key_|secret_|token_|key_)[A-Za-z0-9_]{8,}/g,
                   /\bpassword\s*[:=]\s*['"][^'"]+['"]/gi,
                   /['"][A-Za-z0-9+/]{32,}['"]/g],
        action: 'pseudonymize', reason: 'Credentials — immediate security risk if exposed' },
      { category: 'INTERNAL_INFRA', label: 'Internal Infrastructure',
        patterns: [/\b\w+\.(?:internal|corp|local)\b/g,
                   /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
                   /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g],
        action: 'pseudonymize', reason: 'Internal network topology — security risk' },
    ],
    okToShare: ['open-source patterns', 'general algorithms', 'public documentation'],
  },
  consulting: {
    role: 'Managing Partner + Chief Risk Officer',
    neverShare: [
      { category: 'CLIENT_STRATEGY', label: 'Client Strategic Recommendations',
        patterns: [/\b(?:recommend|advise|propose)\b.*\b(?:divest|acquire|merge|restructur|expand|exit|cost\s+reduction)\b/gi,
                   /\bstrategic\s+(?:assessment|recommendation|option|direction|review)\b/gi,
                   /\bboard\s+(?:talking\s+points|presentation|meeting|materials)\b/gi,
                   /\bactivist\s+(?:investor|pressure|response|engagement)\b/gi],
        action: 'private_llm', reason: 'Client strategy IS the deliverable — reveals advice even without names' },
      { category: 'COMPETITIVE_INTEL', label: 'Competitive Intelligence',
        patterns: [/\bmarket\s+share\s+(?:declined|grew|gained|lost|dropped|increased)\b/gi,
                   /\bcompetitor\b.*\b(?:revenue|margin|pricing|strategy|share)\b/gi,
                   /\b(?:private|estimated)\s*,?\s*~?\s*\$[\d.]+\s*(?:billion|million|B|M)\s+revenue\b/gi],
        action: 'private_llm', reason: 'Competitive intelligence IS the IP — data patterns identify client even without names' },
    ],
    okToShare: ['published frameworks', 'general business concepts', 'public company filings'],
  },
  insurance: {
    role: 'Chief Actuary + Chief Risk Officer',
    neverShare: [
      { category: 'CLAIMS_RESERVES', label: 'Claims Reserves / IBNR Data',
        patterns: [/\bclaims?\s+reserve/gi,
                   /\bIBNR\b/g,
                   /\bloss\s+reserve/gi,
                   /\bloss\s+development\b/gi,
                   /\badverse\s+development\b/gi],
        action: 'private_llm', reason: 'Reserve data is market-sensitive — reveals loss exposure and financial position' },
      { category: 'CAT_MODEL', label: 'Catastrophe Model Results',
        patterns: [/\bcat(?:astrophe)?\s+model/gi,
                   /\bPML\b/g,
                   /\bprobable\s+maximum\s+loss/gi,
                   /\baggregate\s+exceedance/gi],
        action: 'private_llm', reason: 'Cat model results reveal concentration risk and reinsurance needs' },
      { category: 'REINSURANCE', label: 'Reinsurance Treaty Terms',
        patterns: [/\breinsurance\s+(?:treaty|program)/gi,
                   /\bretrocession/gi,
                   /\bquota\s+share/gi,
                   /\bexcess\s+of\s+loss/gi],
        action: 'pseudonymize', reason: 'Reinsurance terms reveal risk appetite and pricing leverage' },
    ],
    okToShare: ['published loss ratios', 'state filings', 'general actuarial concepts'],
  },
  real_estate: {
    role: 'Managing Partner + General Counsel',
    neverShare: [
      { category: 'DEAL_TERMS', label: 'Off-Market Deal Terms',
        patterns: [/\boff[\s-]?market/gi,
                   /\bpocket\s+listing/gi,
                   /\basking\s+price/gi,
                   /\bcap\s+rate\b.*?\b\d/gi],
        action: 'pseudonymize', reason: 'Off-market deal terms reveal negotiating position and valuation' },
      { category: 'TENANT_DATA', label: 'Rent Roll / Tenant Financial Data',
        patterns: [/\brent\s+roll\b/gi,
                   /\btenant\s+(?:roster|list|data)/gi,
                   /\blease\s+(?:expiration|abstract)/gi],
        action: 'pseudonymize', reason: 'Tenant data reveals property value and risk profile' },
    ],
    okToShare: ['published comps', 'public zoning records', 'general market data'],
  },
  energy: {
    role: 'CEO + VP Exploration',
    neverShare: [
      { category: 'RESERVE_DATA', label: 'Reserve Estimates / Exploration Data',
        patterns: [/\b(?:proved|probable|possible)\s+reserves?\b/gi,
                   /\bseismic\s+(?:data|survey|interpretation)/gi,
                   /\bwell\s+log/gi,
                   /\bdecline\s+curve/gi],
        action: 'private_llm', reason: 'Reserve data is material non-public information and a trade secret' },
      { category: 'PPA_TERMS', label: 'Power Purchase Agreement Terms',
        patterns: [/\bPPA\b.*?\$[\d,.]+/gi,
                   /\bpower\s+purchase\s+agreement/gi,
                   /\bofftake\s+(?:agreement|contract)/gi],
        action: 'pseudonymize', reason: 'PPA terms reveal pricing and competitive position' },
    ],
    okToShare: ['published SEC reserve filings', 'public regulatory orders', 'general energy market data'],
  },
  education: {
    role: 'General Counsel + Provost',
    neverShare: [
      { category: 'STUDENT_RECORDS', label: 'FERPA-Protected Student Records',
        patterns: [/\bFERPA\b/g,
                   /\bstudent\s+(?:record|transcript|file)/gi,
                   /\bdisciplinar/gi,
                   /\bexpulsion/gi],
        action: 'pseudonymize', reason: 'FERPA: student records cannot be disclosed without consent' },
      { category: 'TITLE_IX', label: 'Title IX Matters',
        patterns: [/\bTitle\s+IX\b/g,
                   /\bsexual\s+(?:misconduct|harassment|assault)/gi,
                   /\bTitle\s+IX\s+(?:investigation|complaint|hearing)/gi],
        action: 'private_llm', reason: 'Title IX matters are legally protected — investigation details cannot be externalized' },
      { category: 'RESEARCH_IP', label: 'Unpublished Research / Patent-Pending',
        patterns: [/\bunpublished\s+(?:research|data|findings)/gi,
                   /\bpatent[\s-]?pending/gi,
                   /\bpre[\s-]?publication/gi],
        action: 'private_llm', reason: 'Pre-publication research IP — disclosure could void patent rights' },
    ],
    okToShare: ['published research', 'course catalogs', 'general academic concepts'],
  },
  government: {
    role: 'CISO + Classification Authority',
    neverShare: [
      { category: 'CLASSIFIED', label: 'Classified / SCI Information',
        patterns: [/\bclassified\b/gi,
                   /\btop\s+secret\b/gi,
                   /\bSCI\b/g,
                   /\bspecial\s+access\s+program/gi,
                   /\bneed[\s-]to[\s-]know\b/gi],
        action: 'private_llm', reason: 'Classified information — cannot leave secure environment under any circumstances' },
      { category: 'EXPORT_CONTROL', label: 'ITAR / EAR Export-Controlled Data',
        patterns: [/\bITAR\b/g,
                   /\bexport\s+control/gi,
                   /\bmunitions\s+list/gi,
                   /\bECCN\s*\d/g,
                   /\bdeemed\s+export/gi],
        action: 'private_llm', reason: 'Export-controlled data — criminal penalties for unauthorized disclosure' },
      { category: 'PROCUREMENT', label: 'Procurement Sensitive / Source Selection',
        patterns: [/\bsource\s+selection/gi,
                   /\bprocurement\s+sensitive/gi,
                   /\bbid\s+(?:evaluation|protest)/gi,
                   /\bsole\s+source\s+justification/gi],
        action: 'pseudonymize', reason: 'Procurement data reveals acquisition strategy and vendor evaluations' },
    ],
    okToShare: ['public regulations', 'published standards', 'unclassified training materials'],
  },
};

/**
 * Analyze the full document context to decide how to handle values.
 * Thinks like a human: "Who are these numbers about? What's the situation?"
 */
export function analyzeContext(text: string, entities: DetectedEntity[]): ContextAnalysis {
  // ===================================================================
  // STEP 0: Detect industry context
  // ===================================================================
  const industrySignals: Record<string, RegExp[]> = {
    legal:         [/\battorney\b/i, /\blitigation\b/i, /\bcounsel\b/i, /\bdeposition\b/i, /\bplaintiff\b/i, /\bdefendant\b/i, /\bstatute\b/i, /\bfiduciary\b/i, /\bcease.and.desist\b/i, /\btrade secret/i, /\bsettlement\b/i, /\bprejudgment/i],
    healthcare:    [/\bpatient\b/i, /\bdiagnos/i, /\bmedication\b/i, /\bdosage\b/i, /\bMRN\b/i, /\bclinical\b/i, /\bHIPAA\b/i, /\bdischarge\b/i, /\bprescri/i, /\bsurgery\b/i, /\binsulin\b/i, /\beGFR\b/i],
    finance:       [/\bportfolio\b/i, /\bEBITDA\b/i, /\bDCF\b/i, /\bacquisition\b/i, /\bvaluation\b/i, /\bIPO\b/i, /\bequities\b/i, /\bfixed income\b/i, /\bWACC\b/i, /\bterminal value\b/i, /\bcap table\b/i],
    technology:    [/\bAPI\b/, /\bendpoint\b/i, /\bserver\b/i, /\bmiddleware\b/i, /\bauthenticat/i, /\btoken\b/i, /\bdebug/i, /\bsource code\b/i],
    consulting:    [/\bengagement\b/i, /\bmarket share\b/i, /\bTAM\b/i, /\bSWOT\b/i, /\bFive Forces\b/i, /\bboard meeting\b/i, /\bactivist\b/i, /\bprojection\b/i],
    manufacturing: [/\bformul(?:a|ation)\b/i, /\bsurfactant\b/i, /\bbatch\b/i, /\breactor\b/i, /\byield\b/i, /\bviscosity\b/i, /\bpH\b/, /\bsodium\b/i, /\bpreservative\b/i, /\braw\s+material/i, /\bsupplier\b/i, /\bchemical\b/i, /\bmanufactur/i, /\bproduction\s+line/i],
    insurance:     [/\bactuarial\b/i, /\bunderwriting\b/i, /\bclaims?\s+reserve/i, /\bloss\s+ratio/i, /\bcombined\s+ratio/i, /\bIBNR\b/, /\breinsurance\b/i, /\bpolicyholder\b/i, /\bcatastrophe\s+model/i, /\bsolvency\b/i, /\bpremium\b/i, /\bclaimant\b/i],
    real_estate:   [/\bcap\s+rate\b/i, /\bNOI\b/, /\brent\s+roll\b/i, /\boccupancy\b/i, /\bvacancy\b/i, /\btenant\b/i, /\blease\b/i, /\b1031\s+exchange/i, /\bzoning\b/i, /\bentitlement\b/i, /\bappraisal\b/i, /\bAPN\b/],
    energy:        [/\breserves?\b/i, /\bBOE\b/, /\bseismic\b/i, /\bwell\s+log/i, /\bdrilling\b/i, /\bPPA\b/, /\bFERC\b/, /\bNERC\b/, /\bpipeline\b/i, /\bupstream\b/i, /\bmidstream\b/i, /\bLCOE\b/],
    education:     [/\bFERPA\b/, /\bstudent\s+record/i, /\btranscript\b/i, /\bGPA\b/, /\bTitle\s+IX\b/, /\baccreditation\b/i, /\bIRB\b/, /\btenure\b/i, /\bNCAA\b/, /\bfinancial\s+aid\b/i, /\benrollment\b/i],
    government:    [/\bclassified\b/i, /\btop\s+secret\b/i, /\bFOUO\b/, /\bCUI\b/, /\bITAR\b/, /\bexport\s+control/i, /\bCFIUS\b/, /\bOFAC\b/, /\bsanction/i, /\bprocurement\b/i, /\bclearance\b/i, /\bFedRAMP\b/],
  };
  let detectedIndustry: string | null = null;
  let bestIndustryScore = 0;
  for (const [industry, patterns] of Object.entries(industrySignals)) {
    const hits = patterns.filter(p => p.test(text)).length;
    if (hits > bestIndustryScore) {
      bestIndustryScore = hits;
      detectedIndustry = industry;
    }
  }

  // ===================================================================
  // STEP 0.5: EXECUTIVE LENS — "Would the CEO + GC approve sharing this?"
  // ===================================================================
  const executiveFlags: ExecutiveFlag[] = [];
  let executiveAction: ContextAnalysis['executiveAction'] = null;
  let executiveRole: string | null = null;
  const lens = detectedIndustry ? EXECUTIVE_LENS[detectedIndustry] : undefined;

  if (lens) {
    executiveRole = lens.role;
    for (const rule of lens.neverShare) {
      const hits = rule.patterns.filter(p => {
        p.lastIndex = 0;
        return p.test(text);
      }).length;
      if (hits >= 2) {
        executiveFlags.push({
          category: rule.category,
          label: rule.label,
          action: rule.action,
          reason: rule.reason,
          hits,
        });
        if (rule.action === 'private_llm') {
          executiveAction = 'private_llm';
        } else if (rule.action === 'pseudonymize' && executiveAction !== 'private_llm') {
          executiveAction = 'pseudonymize';
        }
      }
    }
  }
  const hasExecutiveFlags = executiveFlags.length > 0;

  // ===================================================================
  // STEP 1: Are there identified real people?
  // ===================================================================
  const hasPersons = entities.some(e => e.type === 'PERSON');
  const hasSSN = entities.some(e => e.type === 'SSN');
  const hasEmail = entities.some(e => e.type === 'EMAIL');
  const hasIdentifiedPersons = hasPersons || hasSSN || hasEmail;

  // ===================================================================
  // STEP 2: Is this a confidential document?
  // ===================================================================
  const confidentialSignals = [
    /privileged/i, /confidential/i, /attorney[- ]client/i,
    /work product/i, /do not distribute/i, /under seal/i,
    /\bNDA\b/, /memorandum/i, /settlement/i,
  ];
  const financialSignals = [
    /revenue/i, /ebitda/i, /valuation/i, /cap table/i,
    /acquisition/i, /earnings report/i, /balance sheet/i,
  ];
  const hasConfidentialMarkers = confidentialSignals.some(p => p.test(text));
  const hasFinancialContext = financialSignals.some(p => p.test(text));
  const healthcareSignals = [
    /\bHIPAA\b/i, /protected health/i, /\bPHI\b/, /discharge summary/i,
    /medical record/i, /\bMRN\b/,
  ];
  const hasHealthcareContext = healthcareSignals.some(p => p.test(text));
  const isConfidentialDocument = hasConfidentialMarkers || hasFinancialContext ||
    (detectedIndustry === 'healthcare' && hasIdentifiedPersons) ||
    hasHealthcareContext || hasExecutiveFlags;

  // ===================================================================
  // STEP 3: Does the user need computation?
  // ===================================================================
  const computationSignals = [
    /\bcalculate\b/i, /\bcompute\b/i, /\btotal\b/i,
    /\bmultip/i, /\bdivide\b/i, /\bpercentage\b/i,
    /\d+\s*[x×]\s*(of|the|medical|total)/i,
    /\d+(\.\d+)?%/,
    /how much/i, /what is.*\$/i, /add.*interest/i,
    /\byield\s+improv/i, /\bArrhenius\b/i, /\bROI\b/i, /\bbreak[\s-]even\b/i,
    /\bannual\s+savings\b/i,
  ];
  const needsComputation = computationSignals.some(p => p.test(text));

  // ===================================================================
  // STEP 4: Decide strategy — EXECUTIVE LENS OVERRIDES basic PII logic
  // ===================================================================
  let valueStrategy: ContextAnalysis['valueStrategy'];
  let reasoning: string;

  if (hasExecutiveFlags && executiveAction === 'private_llm') {
    valueStrategy = 'private_llm';
    const topFlag = executiveFlags.find(f => f.action === 'private_llm')!;
    reasoning = `${executiveRole}: ${topFlag.reason}`;
  } else if (hasExecutiveFlags && executiveAction === 'pseudonymize') {
    valueStrategy = 'pseudonymize';
    reasoning = `${executiveRole}: ${executiveFlags[0].reason}`;
  } else if (hasIdentifiedPersons && needsComputation) {
    valueStrategy = 'private_llm';
    const industryReasons: Record<string, string> = {
      healthcare: 'Patient data + dosage calculation needed — routing to HIPAA-compliant private LLM',
      legal: 'Privileged legal data + computation — routing to private LLM',
      finance: 'Sensitive financial data + computation — routing to private LLM',
      consulting: 'Confidential engagement data + computation — routing to private LLM',
      technology: 'Sensitive system data + computation — routing to private LLM',
      manufacturing: 'Proprietary process data + optimization math — routing to private LLM',
    };
    reasoning = (detectedIndustry && industryReasons[detectedIndustry])
      || 'Numbers tied to identified persons + computation — routing to private LLM';
  } else if (hasIdentifiedPersons || isConfidentialDocument) {
    valueStrategy = 'pseudonymize';
    const industryReasons: Record<string, string> = {
      healthcare: 'Patient health information detected — pseudonymizing to protect PHI',
      legal: 'Attorney-client privileged content — pseudonymizing identifiers',
      finance: 'Confidential financial data — pseudonymizing deal-sensitive values',
      consulting: 'Confidential engagement data — pseudonymizing client identifiers',
      technology: 'Sensitive system identifiers — pseudonymizing infrastructure data',
      manufacturing: 'Identified persons in manufacturing context — pseudonymizing identifiers',
    };
    reasoning = (detectedIndustry && industryReasons[detectedIndustry])
      || `Numbers linked to ${hasIdentifiedPersons ? 'identified persons' : 'confidential document'} — pseudonymizing values`;
  } else {
    valueStrategy = 'keep_real';
    reasoning = 'No identified persons, confidential markers, or executive flags — safe to send';
  }

  return {
    isConfidentialDocument,
    hasIdentifiedPersons,
    needsComputation,
    valueStrategy,
    reasoning,
    detectedIndustry,
    executiveFlags,
    executiveRole,
    executiveAction,
  };
}

/**
 * Determine if a specific entity should be pseudonymized, given the holistic context.
 */
export function shouldPseudonymize(
  entityType: string,
  contextAnalysis: ContextAnalysis,
): boolean {
  // Identity entities are ALWAYS pseudonymized
  if (ALWAYS_IDENTIFYING_TYPES.has(entityType)) return true;

  // For value entities (amounts, dates, matter numbers):
  // the holistic context analysis decides
  if (contextAnalysis.valueStrategy === 'pseudonymize') return true;
  if (contextAnalysis.valueStrategy === 'keep_real') return false;
  if (contextAnalysis.valueStrategy === 'private_llm') return false; // sent to private LLM with real data

  return true; // unknown → safe default
}

// ---------------------------------------------------------------------------
// Main generator dispatcher
// ---------------------------------------------------------------------------

function generatePseudonym(entityType: EntityType, original: string, hash: string): string {
  switch (entityType) {
    case 'PERSON':
      return generateFakePerson(hash);
    case 'ORGANIZATION':
      return generateFakeOrganization(hash);
    case 'EMAIL':
      return generateFakeEmail(hash);
    case 'PHONE_NUMBER':
      return generateFakePhone(hash);
    case 'SSN':
      return generateFakeSSN(hash);
    case 'CREDIT_CARD':
      return generateFakeCreditCard(hash);
    case 'MONETARY_AMOUNT':
      return generateFakeMonetaryAmount(original, hash);
    case 'LOCATION':
      return generateFakeLocation(hash);
    case 'MATTER_NUMBER':
      return generateFakeMatterNumber(hash);
    case 'CLIENT_MATTER_PAIR':
      return generateFakeClientMatterPair(hash);
    case 'DEAL_CODENAME':
      return generateFakeDealCodename(hash);
    case 'ACCOUNT_NUMBER':
      return generateFakeAccountNumber(hash);
    case 'IP_ADDRESS':
      return generateFakeIPAddress(hash);
    default:
      return `[REDACTED_${entityType}]`;
  }
}

// ---------------------------------------------------------------------------
// Pseudonymizer Class
// ---------------------------------------------------------------------------

export class Pseudonymizer {
  private sessionId: string;
  private firmId: string;
  private mappings: Map<string, PseudonymEntry>;
  private reverseMappings: Map<string, string>; // pseudonym -> original
  private createdAt: Date;
  private expiresAt: Date;

  constructor(sessionId: string, firmId: string) {
    this.sessionId = sessionId;
    this.firmId = firmId;
    this.mappings = new Map();
    this.reverseMappings = new Map();
    this.createdAt = new Date();
    this.expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Replace all detected entities in `text` with deterministic pseudonyms.
   * The same original entity value will always map to the same pseudonym
   * within this session.
   */
  pseudonymize(text: string, entities: DetectedEntity[]): PseudonymizeResult {
    if (this.isExpired()) {
      throw new Error(`Pseudonym session ${this.sessionId} has expired`);
    }

    // Holistic context analysis — run once for the whole document.
    // Thinks like a human: who are these numbers about? What's the situation?
    const context = analyzeContext(text, entities);

    // Sort entities by start position descending so we can replace from the
    // end of the string without invalidating earlier offsets.
    const sorted = [...entities].sort((a, b) => b.start - a.start);

    let maskedText = text;
    let entitiesReplaced = 0;

    for (const entity of sorted) {
      if (!shouldPseudonymize(entity.type, context)) {
        continue;
      }

      const entry = this.getOrCreateEntry(entity.text, entity.type);
      maskedText =
        maskedText.slice(0, entity.start) +
        entry.pseudonym +
        maskedText.slice(entity.end);
      entitiesReplaced++;
    }

    return {
      maskedText,
      entitiesReplaced,
      map: this.getMap(),
    };
  }

  /**
   * Reverse all pseudonyms found in `text` back to their original values.
   * Used to de-pseudonymize LLM responses before returning them to the user.
   */
  depseudonymize(text: string): string {
    if (this.isExpired()) {
      throw new Error(`Pseudonym session ${this.sessionId} has expired`);
    }

    let result = text;

    // Sort reverse mappings by pseudonym length descending to avoid
    // partial replacements (e.g., replace "James Mitchell" before "James").
    const sortedEntries = [...this.reverseMappings.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    );

    for (const [pseudonym, original] of sortedEntries) {
      // Use a global replace in case the LLM repeated the pseudonym
      result = result.split(pseudonym).join(original);
    }

    return result;
  }

  /**
   * Return a snapshot of the current pseudonym map for persistence.
   * De-duplicates entries (since we store under both text and hash keys).
   */
  getMap(): PseudonymMap {
    const deduplicated = new Map<string, PseudonymEntry>();
    const seenHashes = new Set<string>();

    for (const [key, entry] of this.mappings) {
      if (seenHashes.has(entry.originalHash)) continue;
      seenHashes.add(entry.originalHash);
      // Use hash-based key for persistence (original text is not stored in DB)
      deduplicated.set(`hash::${entry.originalHash}`, entry);
    }

    return {
      sessionId: this.sessionId,
      firmId: this.firmId,
      mappings: deduplicated,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }

  /**
   * Load an existing pseudonym map (e.g., from the database) to restore
   * session continuity. Supports maps where original text is empty
   * (privacy by design — originals are never persisted to DB).
   *
   * For depseudonymization to work on loaded maps, the reverse mappings
   * use pseudonym → original. When original is empty (loaded from DB),
   * depseudonymization won't work until the same entity is seen again
   * in a new pseudonymize() call, which upgrades the entry with the
   * original text.
   */
  loadMap(map: PseudonymMap): void {
    this.sessionId = map.sessionId;
    this.firmId = map.firmId;
    this.createdAt = map.createdAt;
    this.expiresAt = map.expiresAt;
    this.mappings = new Map(map.mappings);

    // Rebuild reverse mappings for entries that have original text
    this.reverseMappings.clear();
    for (const [, entry] of this.mappings) {
      if (entry.original) {
        this.reverseMappings.set(entry.pseudonym, entry.original);
      }
    }
  }

  /**
   * Check whether this session has exceeded its time-to-live.
   */
  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Look up or create a pseudonym entry for a given original value.
   * Uses both a text-based key (for same-session lookups) and a hash-based key
   * (for cross-session lookups after loading from DB where originals aren't stored).
   */
  private getOrCreateEntry(original: string, entityType: EntityType): PseudonymEntry {
    const textKey = `${entityType}::${original}`;

    // Check text-based key first (same session)
    const existing = this.mappings.get(textKey);
    if (existing) {
      return existing;
    }

    // Salt with firmId to prevent cross-firm rainbow table attacks
    const hash = sha256Sync(`${this.firmId}:${original}`);
    const hashKey = `hash::${hash}`;

    // Check hash-based key (loaded from DB)
    const fromDb = this.mappings.get(hashKey);
    if (fromDb) {
      // Upgrade: set the original text now that we have it and add text-based key
      fromDb.original = original;
      this.mappings.set(textKey, fromDb);
      this.reverseMappings.set(fromDb.pseudonym, original);
      return fromDb;
    }

    const pseudonym = generatePseudonym(entityType, original, hash);

    const entry: PseudonymEntry = {
      original,
      originalHash: hash,
      pseudonym,
      entityType,
    };

    // Store under both keys for future lookups
    this.mappings.set(textKey, entry);
    this.mappings.set(hashKey, entry);
    this.reverseMappings.set(pseudonym, original);

    return entry;
  }
}
