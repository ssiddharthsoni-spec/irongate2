/**
 * Text Extraction Tests
 *
 * Tests extractText() for all 10 supported file types.
 */

import { describe, it, expect } from 'vitest';
import { extractText } from '../src/extraction';
import JSZip from 'jszip';

// ─── Plain text types ────────────────────────────────────────────────────────

describe('extractText - TXT', () => {
  it('should extract text from a plain text buffer', async () => {
    const buffer = Buffer.from('Hello World\nLine two');
    const result = await extractText(buffer, 'txt');
    expect(result).toBe('Hello World\nLine two');
  });

  it('should handle empty text', async () => {
    const buffer = Buffer.from('   ');
    const result = await extractText(buffer, 'txt');
    expect(result).toBe('   ');
  });
});

describe('extractText - CSV', () => {
  it('should extract CSV as plain text', async () => {
    const csv = 'Name,Email,SSN\nJohn Smith,john@example.com,123-45-6789';
    const buffer = Buffer.from(csv);
    const result = await extractText(buffer, 'csv');
    expect(result).toContain('John Smith');
    expect(result).toContain('123-45-6789');
  });
});

describe('extractText - Markdown', () => {
  it('should extract markdown as plain text', async () => {
    const md = '# Title\n\nSome **bold** text and a [link](https://example.com)\n\n- Item 1\n- Item 2';
    const buffer = Buffer.from(md);
    const result = await extractText(buffer, 'md');
    expect(result).toContain('Title');
    expect(result).toContain('bold');
    expect(result).toContain('Item 1');
  });

  it('should preserve full markdown content', async () => {
    const md = '## Confidential Report\n\nClient: John Smith\nSSN: 123-45-6789';
    const buffer = Buffer.from(md);
    const result = await extractText(buffer, 'md');
    expect(result).toContain('Confidential Report');
    expect(result).toContain('John Smith');
    expect(result).toContain('123-45-6789');
  });
});

// ─── RTF ─────────────────────────────────────────────────────────────────────

describe('extractText - RTF', () => {
  it('should strip RTF control words and extract text', async () => {
    const rtf = '{\\rtf1\\ansi Hello World}';
    const buffer = Buffer.from(rtf);
    const result = await extractText(buffer, 'rtf');
    expect(result).toContain('Hello World');
  });

  it('should handle RTF with font tables and formatting', async () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;}\\f0\\fs24 Confidential Document\\par Client: John Smith}';
    const buffer = Buffer.from(rtf);
    const result = await extractText(buffer, 'rtf');
    expect(result).toContain('Confidential Document');
    expect(result).toContain('John Smith');
  });

  it('should handle simple RTF with paragraph markers', async () => {
    const rtf = '{\\rtf1 First paragraph\\par Second paragraph}';
    const buffer = Buffer.from(rtf);
    const result = await extractText(buffer, 'rtf');
    expect(result).toContain('First paragraph');
    expect(result).toContain('Second paragraph');
  });
});

// ─── HTML ────────────────────────────────────────────────────────────────────

describe('extractText - HTML', () => {
  it('should extract text and strip tags', async () => {
    const html = '<html><body><h1>Title</h1><p>Hello World</p></body></html>';
    const buffer = Buffer.from(html);
    const result = await extractText(buffer, 'html');
    expect(result).toContain('Title');
    expect(result).toContain('Hello World');
    expect(result).not.toContain('<h1>');
    expect(result).not.toContain('<p>');
  });

  it('should remove script and style blocks', async () => {
    const html = '<html><head><style>body { color: red; }</style></head><body><p>Safe text</p><script>alert("evil")</script></body></html>';
    const buffer = Buffer.from(html);
    const result = await extractText(buffer, 'html');
    expect(result).toContain('Safe text');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('evil');
    expect(result).not.toContain('color: red');
  });

  it('should decode HTML entities', async () => {
    const html = '<p>AT&amp;T &quot;quoted&quot; &lt;brackets&gt;</p>';
    const buffer = Buffer.from(html);
    const result = await extractText(buffer, 'html');
    expect(result).toContain('AT&T');
    expect(result).toContain('"quoted"');
    expect(result).toContain('<brackets>');
  });

  it('should remove HTML comments', async () => {
    const html = '<p>Visible</p><!-- This is a secret comment --><p>Also visible</p>';
    const buffer = Buffer.from(html);
    const result = await extractText(buffer, 'html');
    expect(result).toContain('Visible');
    expect(result).toContain('Also visible');
    expect(result).not.toContain('secret comment');
  });
});

// ─── JSON ────────────────────────────────────────────────────────────────────

describe('extractText - JSON', () => {
  it('should extract all string values from JSON object', async () => {
    const json = JSON.stringify({ name: 'John Smith', ssn: '123-45-6789', company: 'Acme Corp' });
    const buffer = Buffer.from(json);
    const result = await extractText(buffer, 'json');
    expect(result).toContain('John Smith');
    expect(result).toContain('123-45-6789');
    expect(result).toContain('Acme Corp');
  });

  it('should extract from nested JSON', async () => {
    const json = JSON.stringify({
      client: { name: 'Jane Doe', contact: { email: 'jane@example.com' } },
      matter: 'Contract Review',
    });
    const buffer = Buffer.from(json);
    const result = await extractText(buffer, 'json');
    expect(result).toContain('Jane Doe');
    expect(result).toContain('jane@example.com');
    expect(result).toContain('Contract Review');
  });

  it('should extract from JSON arrays', async () => {
    const json = JSON.stringify(['First', 'Second', 'Third']);
    const buffer = Buffer.from(json);
    const result = await extractText(buffer, 'json');
    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result).toContain('Third');
  });

  it('should include numbers and booleans', async () => {
    const json = JSON.stringify({ count: 42, active: true });
    const buffer = Buffer.from(json);
    const result = await extractText(buffer, 'json');
    expect(result).toContain('42');
    expect(result).toContain('true');
  });

  it('should handle invalid JSON gracefully', async () => {
    const buffer = Buffer.from('{ invalid json content }');
    const result = await extractText(buffer, 'json');
    expect(result).toBe('{ invalid json content }');
  });
});

// ─── PPTX ────────────────────────────────────────────────────────────────────

describe('extractText - PPTX', () => {
  it('should extract text from a minimal PPTX', async () => {
    // Create a minimal valid PPTX (which is a ZIP of XML files)
    const zip = new JSZip();

    // Minimal slide XML with text in <a:t> elements
    const slideXml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Confidential Report</a:t></a:r></a:p>
          <a:p><a:r><a:t>Client: John Smith</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

    zip.file('ppt/slides/slide1.xml', slideXml);

    const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await extractText(pptxBuffer, 'pptx');
    expect(result).toContain('Confidential Report');
    expect(result).toContain('John Smith');
  });

  it('should extract text from multiple slides in order', async () => {
    const zip = new JSZip();

    const slide1 = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

    const slide2 = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

    zip.file('ppt/slides/slide1.xml', slide1);
    zip.file('ppt/slides/slide2.xml', slide2);

    const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await extractText(pptxBuffer, 'pptx');
    expect(result).toContain('Slide One');
    expect(result).toContain('Slide Two');
    // Slide 1 should come before Slide 2
    expect(result.indexOf('Slide One')).toBeLessThan(result.indexOf('Slide Two'));
  });

  it('should extract text from speaker notes', async () => {
    const zip = new JSZip();

    const slide1 = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide content</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

    const notes1 = `<?xml version="1.0"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker notes with SSN 123-45-6789</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;

    zip.file('ppt/slides/slide1.xml', slide1);
    zip.file('ppt/notesSlides/notesSlide1.xml', notes1);

    const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await extractText(pptxBuffer, 'pptx');
    expect(result).toContain('Slide content');
    expect(result).toContain('Speaker notes with SSN 123-45-6789');
  });

  it('should handle empty PPTX gracefully', async () => {
    const zip = new JSZip();
    const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await extractText(pptxBuffer, 'pptx');
    expect(result).toBe('');
  });
});

// ─── Unsupported extension ───────────────────────────────────────────────────

describe('extractText - unsupported', () => {
  it('should throw for unsupported extension', async () => {
    const buffer = Buffer.from('binary content');
    await expect(extractText(buffer, 'exe')).rejects.toThrow('Unsupported file extension: .exe');
  });

  it('should throw for unknown extension', async () => {
    const buffer = Buffer.from('');
    await expect(extractText(buffer, 'xyz')).rejects.toThrow('Unsupported file extension');
  });
});

// ─── Text length cap ─────────────────────────────────────────────────────────

describe('extractText - max length', () => {
  it('should cap text at 500,000 characters', async () => {
    const longText = 'A'.repeat(600_000);
    const buffer = Buffer.from(longText);
    const result = await extractText(buffer, 'txt');
    expect(result.length).toBe(500_000);
  });
});
