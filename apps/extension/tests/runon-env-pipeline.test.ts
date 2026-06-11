import { describe, expect, it } from 'vitest';
import { parseStructured } from '../src/detection/structural-parser';
import { classifyKeyName } from '../src/detection/key-name-sensitivity';

// Reproduces exactly what main-world.ts buildSubmitEntities does on the
// user's run-on .env paste, so we can see entity layout deterministically.
describe('run-on .env pipeline (debug)', () => {
  it('shows what the parser does on the user\'s exact input', () => {
    const input =
      'Help me debug my .env file:\n' +
      'DATABASE_URL=postgres://testuser:fakepwd@db-8280.example.com:5432/testdbREDIS_URL=redis://testuser:fakepwd@db-1613.example.com:5432/testdb_ACCESS_KEY_ID=key-WT7toZRxgb3FSwez\n' +
      'AWS_SECRET_ACCESS_KEY=key-gcFdpcI5Vl08ApQLDGEAuFYzX8hAHvmMe8LH\n' +
      'STRIPE_SECRET=sk_live_R8GJyMfVho4bLE4hBi45lx';

    const { records, freeText } = parseStructured(input);

    // Print so we can inspect.
    // eslint-disable-next-line no-console
    console.log('PARSED RECORDS:');
    for (const r of records) {
      const klass = classifyKeyName(r.key);
      // eslint-disable-next-line no-console
      console.log(`  key=${r.key} keySpan=[${r.keySpan[0]},${r.keySpan[1]}) valueSpan=[${r.valueSpan[0]},${r.valueSpan[1]}) sensitive=${klass.sensitive} type=${klass.type}`);
      // eslint-disable-next-line no-console
      console.log(`    value="${r.value}"`);
    }
    // eslint-disable-next-line no-console
    console.log('FREE TEXT:');
    for (const f of freeText) {
      // eslint-disable-next-line no-console
      console.log(`  span=[${f.span[0]},${f.span[1]}) text=${JSON.stringify(f.text)}`);
    }

    // No actual assertion — this test exists to print the parse layout.
    expect(records.length).toBeGreaterThan(0);
  });
});
