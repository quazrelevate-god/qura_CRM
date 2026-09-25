// WhatsApp message templates, kept as one small JSON file in the CRM's private Supabase Storage
// bucket "crm-config" (created on first save). Server-only: it uses the service key.
import { adminClient } from './supabase/admin';
import type { WaTemplate } from './waVars';

const BUCKET = 'crm-config';
const FILE = 'whatsapp_templates.json';

const isTemplate = (t: unknown): t is WaTemplate =>
  !!t && typeof t === 'object' &&
  typeof (t as WaTemplate).id === 'string' && typeof (t as WaTemplate).name === 'string' && typeof (t as WaTemplate).body === 'string';

export async function listWaTemplates(): Promise<{ templates: WaTemplate[]; error: string | null }> {
  const { data, error } = await adminClient().storage.from(BUCKET).download(FILE);
  if (error || !data) {
    // Nothing saved yet (no bucket or no file) is the normal starting point, not an error.
    const msg = error ? `${error.name ?? ''} ${error.message ?? ''}` : '';
    const missing = !error || /not.?found|does not exist|404/i.test(msg);
    return { templates: [], error: missing ? null : error!.message };
  }
  try {
    const parsed = JSON.parse(await data.text());
    const templates = (Array.isArray(parsed) ? parsed.filter(isTemplate) : [])
      .sort((a, b) => a.name.localeCompare(b.name));
    return { templates, error: null };
  } catch {
    return { templates: [], error: 'The saved templates file could not be read.' };
  }
}

export async function saveWaTemplates(list: WaTemplate[]): Promise<string | null> {
  const storage = adminClient().storage;
  const upload = () =>
    storage.from(BUCKET).upload(FILE, new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), {
      upsert: true, contentType: 'application/json', cacheControl: '0',
    });
  let { error } = await upload();
  if (error) {
    // First save: make the private bucket, then try again.
    const { error: bucketError } = await storage.createBucket(BUCKET, { public: false });
    if (bucketError && !/already exists|duplicate/i.test(bucketError.message)) return bucketError.message;
    ({ error } = await upload());
  }
  return error ? error.message : null;
}
