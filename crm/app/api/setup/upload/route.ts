// Key-protected upload of the Google Sheet (.xlsx) for the one-time full import.
// Only works with ?key=<SETUP_KEY>; returns 404 otherwise. Same import as the admin Import page.
import { NextResponse, type NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { parseSheetXlsx } from '@/lib/sheetXlsx';
import { runSheetImport } from '@/lib/importEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const allowed = (req: NextRequest) => !!process.env.SETUP_KEY && req.nextUrl.searchParams.get('key') === process.env.SETUP_KEY;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string) =>
  new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>QURA CRM · Sheet upload</title><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px">${body}</body>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET(req: NextRequest) {
  if (!allowed(req)) return new NextResponse('Not found', { status: 404 });
  const key = esc(req.nextUrl.searchParams.get('key')!);
  return page(`<h1>Upload the Google Sheet</h1>
<form method="post" enctype="multipart/form-data" action="?key=${key}">
<p><input id="file" type="file" name="file" accept=".xlsx" required></p>
<p><button name="mode" value="check">Check file</button> <button name="mode" value="import">Import</button></p>
</form>`);
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return new NextResponse('Not found', { status: 404 });
  const fd = await req.formData();
  const mode = fd.get('mode') === 'import' ? 'import' : 'check';
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) return page('<p id="result">error: no file</p>');
  try {
    const parsed = await parseSheetXlsx(Buffer.from(await file.arrayBuffer()));
    const summary = await runSheetImport(adminClient(), parsed.rows, { dryRun: mode !== 'import' });
    const out = { mode, file: file.name, tabs: parsed.tabs, readWarnings: parsed.warnings, ...summary, testRows: summary.testRows.length };
    return page(`<h1>${mode === 'import' ? 'Imported' : 'Check (nothing saved)'}</h1><pre id="result">${esc(JSON.stringify(out, null, 1))}</pre>`);
  } catch (e) {
    return page(`<p id="result">error: ${esc((e as Error).message)}</p>`);
  }
}
