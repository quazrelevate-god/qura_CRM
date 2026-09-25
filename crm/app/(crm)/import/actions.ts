'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { parseSheetXlsx } from '@/lib/sheetXlsx';
import { runSheetImport, type ImportSummary } from '@/lib/importEngine';

export type ImportState =
  | null
  | { error: string }
  | ({ mode: 'check' | 'import'; fileName: string; tabs: { name: string; rows: number; skipped: number; copies: number }[]; readWarnings: string[] } & ImportSummary);

export async function importSheet(_prev: ImportState, fd: FormData): Promise<ImportState> {
  await requireAdmin();
  const mode = fd.get('mode') === 'import' ? 'import' : 'check';
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Choose the Excel file first (Google Sheet → File → Download → Microsoft Excel).' };
  if (!/\.xlsx$/i.test(file.name)) return { error: 'That isn’t an .xlsx file. In the Google Sheet use File → Download → Microsoft Excel (.xlsx).' };
  try {
    const parsed = await parseSheetXlsx(Buffer.from(await file.arrayBuffer()));
    if (!parsed.rows.length) return { error: 'No lead rows found in that file. ' + parsed.warnings.join(' ') };
    const summary = await runSheetImport(adminClient(), parsed.rows, { dryRun: mode !== 'import' });
    if (mode === 'import') { revalidatePath('/leads'); revalidatePath('/dashboard'); }
    return { mode, fileName: file.name, tabs: parsed.tabs, readWarnings: parsed.warnings, ...summary };
  } catch (e) {
    return { error: 'Import stopped: ' + (e as Error).message + ' Nothing after this point was saved; running it again is safe.' };
  }
}
