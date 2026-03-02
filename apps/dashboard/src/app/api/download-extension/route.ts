import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const EXTENSION_FILENAME = 'iron-gate-extension-v0.2.2.zip';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'public', EXTENSION_FILENAME);
    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${EXTENSION_FILENAME}"`,
        'Content-Length': fileBuffer.byteLength.toString(),
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
