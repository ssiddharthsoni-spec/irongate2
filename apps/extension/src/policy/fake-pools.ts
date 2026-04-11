/**
 * Fake name pools used by the deterministic firm pseudonymizer.
 *
 * IMPORTANT: These are PUBLIC pools — they're shipped in the extension and
 * visible in source. The privacy guarantee comes from the per-firm KEY
 * mixing, not from the pool being secret. Two firms with different keys
 * pick different names from the same pool.
 *
 * Pool selection criteria:
 *   - Names are common enough to look natural in conversation
 *   - Surnames span multiple ethnic origins (no monoculture)
 *   - First names are gender-balanced
 *   - Org names are plausible-sounding fictional companies
 *   - Domains use TLDs that don't collide with real company domains
 */

export const FAKE_FIRST_NAMES = [
  'Alex', 'Anna', 'Aaron', 'Amara', 'Andre', 'Ananya',
  'Brian', 'Beth', 'Bao', 'Beatriz', 'Brandon', 'Bianca',
  'Carlos', 'Claire', 'Chen', 'Chloe', 'Caleb', 'Camila',
  'David', 'Diana', 'Dmitri', 'Daniela', 'Damon', 'Deepa',
  'Emma', 'Eric', 'Elena', 'Ethan', 'Esther', 'Eli',
  'Fatima', 'Felix', 'Fernanda', 'Frank', 'Faith', 'Finn',
  'Grace', 'Gabriel', 'Gemma', 'George', 'Greta', 'Gavin',
  'Hannah', 'Hugo', 'Hana', 'Henry', 'Hailey', 'Hassan',
  'Iris', 'Ivan', 'Inez', 'Isaac', 'Isla', 'Imran',
  'James', 'Julia', 'Jin', 'Jacob', 'Jasmine', 'Javier',
  'Kate', 'Kai', 'Karim', 'Kira', 'Kevin', 'Khalil',
  'Lily', 'Liam', 'Luna', 'Logan', 'Layla', 'Luis',
  'Maya', 'Marcus', 'Mei', 'Mia', 'Marco', 'Mira',
  'Nina', 'Noah', 'Naomi', 'Nasir', 'Nora', 'Nikhil',
  'Olivia', 'Omar', 'Oscar', 'Olga', 'Owen', 'Ofelia',
  'Paul', 'Priya', 'Pablo', 'Paige', 'Patrick', 'Petra',
  'Quinn', 'Qiana', 'Rachel', 'Raj', 'Rosa', 'Rohan',
  'Sara', 'Sam', 'Sienna', 'Sebastian', 'Saanvi', 'Simon',
  'Tara', 'Tom', 'Talia', 'Tariq', 'Thalia', 'Tobias',
  'Uma', 'Victor', 'Vera', 'Vince', 'Wendy', 'William',
  'Xander', 'Yuki', 'Yusuf', 'Zara', 'Zoe', 'Zane',
];

export const FAKE_LAST_NAMES = [
  'Alvarez', 'Anderson', 'Ahmed', 'Ali', 'Adams', 'Aoki',
  'Bailey', 'Barros', 'Bennett', 'Brooks', 'Bashir', 'Becker',
  'Carter', 'Chen', 'Cohen', 'Cruz', 'Carmichael', 'Chowdhury',
  'Davis', 'Delgado', 'Diallo', 'Dixon', 'Dasgupta', 'DeLuca',
  'Edwards', 'Egan', 'Elliott', 'Ellis', 'Espinoza', 'Eckhart',
  'Fernandez', 'Foster', 'Farouk', 'Friedman', 'Fitzgerald', 'Fukuda',
  'Garcia', 'Gomez', 'Greene', 'Goldberg', 'Gupta', 'Goncalves',
  'Hernandez', 'Hayes', 'Holt', 'Hassan', 'Hopkins', 'Huang',
  'Ito', 'Iqbal', 'Jacobs', 'Jansen', 'Johnson', 'Joshi',
  'Kim', 'Khan', 'Klein', 'Kowalski', 'Kennedy', 'Krishnan',
  'Larsen', 'Liu', 'Lopez', 'Lee', 'Lawson', 'Larochelle',
  'Martinez', 'Mendez', 'Morales', 'Mitchell', 'Monroe', 'Mwangi',
  'Nakamura', 'Nguyen', 'Novak', 'Nasir', 'Nash', 'Nakashima',
  'Okafor', 'Olsen', 'Owens', 'Ortega', 'O\'Brien', 'Oduya',
  'Park', 'Pereira', 'Patel', 'Powell', 'Pacheco', 'Petrov',
  'Quinn', 'Quereshi', 'Reyes', 'Reed', 'Robinson', 'Romero',
  'Sato', 'Singh', 'Smith', 'Stewart', 'Soto', 'Sandberg',
  'Tanaka', 'Torres', 'Thompson', 'Tomas', 'Tang', 'Terranova',
  'Underwood', 'Uchida', 'Vasquez', 'Vargas', 'Vance', 'Vo',
  'Walker', 'Wang', 'Wright', 'White', 'Williams', 'Wexler',
  'Xu', 'Yamamoto', 'Yates', 'Yoon', 'Zaman', 'Zhang',
];

export const FAKE_ORG_NAMES = [
  'Adatum Corp',
  'Contoso Holdings',
  'Northwind Group',
  'Tailspin Industries',
  'Wingtip Partners',
  'Lucerne Capital',
  'Fabrikam Solutions',
  'Litware Systems',
  'Proseware Labs',
  'Coho Vineyard',
  'Blue Yonder Logistics',
  'Trey Research',
  'Wide World Importers',
  'Margie\'s Travel',
  'Humongous Insurance',
  'Consolidated Messenger',
  'Graphic Design Institute',
  'School of Fine Art',
  'Relecloud Communications',
  'Volcano Coffee',
  'Munson\'s Pickles',
  'Best For You Organics',
  'Lamna Healthcare',
  'World Wide Engineering',
  'First Up Consultants',
  'VanArsdel Press',
  'School of Mines',
  'Treviso Music',
  'Alpine Ski House',
  'Bellows College',
];

export const FAKE_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'sample.io',
  'test.co',
  'demo.dev',
  'placeholder.app',
  'fake.site',
  'mock.tech',
  'stub.cloud',
];
