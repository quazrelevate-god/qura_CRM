import { requireAdmin } from '@/lib/auth';
import ImportForm from './ImportForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function ImportPage() {
  await requireAdmin();
  return (
    <>
      <div className="page-head"><h1>Import from Google Sheet</h1></div>
      <ImportForm />
    </>
  );
}
