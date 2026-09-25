// Turns the rows copied from the Google Sheet "QURA Form Submissions" into CRM records:
// merges duplicates, maps free-text notes to a stage, and keeps every note word for word.
// Used by /api/setup (import) and scripts/build_import_sql.ts (SQL file). Record ids are
// deterministic, so running the import again never creates duplicates.
import { createHash } from 'crypto';
import { normPhone, type Phone } from './phone';

export type SheetRow = {
  tab: string; ts: string; form: string; name: string; email: string; phone: string; msg: string; status: string;
  source?: string; about?: string; f1?: string; f2?: string; f3?: string; f4?: string;
  notes?: { label: string; text: string }[]; // any other note columns, in sheet order (Excel upload)
  colour?: string;                            // row colour in the Sheet, e.g. "Light blue"
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>;
};

type Row = SheetRow & { i: number; at: Date; p: Phone; e: string };
type Note = { label: string; text: string; at: Date };
type Classified = { stage: string; reason: string | null; tier: string | null; rule?: string };

export type ImportLead = {
  id: string; lead_code: string; full_name: string; phone: string | null; phone_valid: boolean; email: string | null;
  city: string | null; programme: string | null; tier: string | null; flags: string[]; stage: string; lost_reason: string | null;
  next_follow_up_at: string | null; call_attempts: number; last_contacted_at: string | null; source: string; intent: string;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null;
  first_seen_at: string; last_submission_at: string; submissions_count: number; legacy: Record<string, unknown>; created_at: string;
};
export type ImportSubmission = {
  lead_id: string; submitted_at: string; origin: 'sheet_import'; form_type: string; intent: string; message: string | null;
  answers: Record<string, string>; attribution: Record<string, string>;
};
export type ImportActivity = { lead_id: string; actor_id: null; type: string; summary: string; occurred_at: string };

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const IST = 330 * 60000;
const INTENT_MAP: Record<string, string> = {
  'apply now': 'apply', apply: 'apply', 'one-year-landing': 'apply',
  'download prospectus': 'prospectus', prospectus: 'prospectus',
  'request info': 'info', 'request-info': 'info',
};
const SOURCE_LABEL: Record<string, string> = {
  ig: 'Instagram', fb: 'Facebook', whatsapp: 'WhatsApp', meta: 'Meta Ads', google: 'Google', youtube: 'YouTube',
  'chatgpt.com': 'ChatGPT', standee: 'Standee (offline)', linkedin: 'LinkedIn', email: 'Email', website: 'Website',
};
const MONTH_TABS: Record<string, true> = { January: true, February: true, March: true, April: true, May: true, June: true, July: true, August: true, September: true, October: true, November: true, December: true };
const intentOf = (form: string) => INTENT_MAP[String(form ?? '').trim().toLowerCase()] ?? 'apply';
const NOTE_COLS: [keyof SheetRow, string][] = [['status', 'Status'], ['about', 'About the Client'], ['f1', 'Follow up'], ['f2', 'Follow up 2'], ['f3', 'Follow up 3'], ['f4', 'Follow up 4']];

// Hand-checked exceptions
const OVERRIDES: Record<string, Classified> = {
  '916290980270': { stage: 'Nurture – next intake', reason: null, tier: 'Nurture' }, // Souvik — in Class 12
};
// Interested but stalled — follow up for the January 2027 batch
const QUICK_WINS = new Set(['919043120932', '919677275080', '919500135930', '919826925460', '919894521536', '917777984711', '916362984327', '918247013402', '918219976292']);
export const FOLLOW_UP_AT = new Date(Date.UTC(2026, 8, 25, 11, 0) - IST).toISOString(); // 25 Sep 2026, 11:00 IST

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normName = (s: unknown) => clean(s).toLowerCase().replace(/[^a-zऀ-ॿ ]/g, '');
const sha = (alg: string, v: string) => createHash(alg).update(v).digest('hex');

export function uuidFrom(key: string): string {
  const h = sha('sha1', `qura-sheet-import:${key}`);
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// Accepts the Sheet's own format ("12 May 2026, 23:19", IST), ISO timestamps ("2026-04-29T11:24:13.654Z")
// and day-first dates ("12/05/2026 23:19:05", IST). Returns null when it can't read the value.
export function parseTs(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()];
    if (mon !== undefined) return new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5]) - IST);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - IST);
  return null;
}
function mustParseTs(s: string): Date {
  const d = parseTs(s);
  if (!d) throw new Error('Bad timestamp ' + s);
  return d;
}
const istNoonOn = (day: number, monthIdx: number, year = 2026) => new Date(Date.UTC(year, monthIdx, day, 12, 0) - IST);

// Date a sales note from the "d/m" the team wrote in it. Never later than the import itself
// (a typo like "29/9" written on the 19th, or "after 4.30 / 11/8", must not land in the future).
function noteDate(text: string, row: Row, now: Date): Date | null {
  const d = noteDateRaw(text, row);
  return d && d.getTime() <= now.getTime() ? d : null;
}
function noteDateRaw(text: string, row: Row): Date | null {
  let m = text.match(/(?<![\d.:])(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return istNoonOn(+m[1], +m[2] - 1);
  m = text.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s*(May|Jun|Jul|Aug|Sep)/i);
  if (m) return istNoonOn(+m[1], MONTHS[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()]);
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) return istNoonOn(+m[1], row.at.getUTCMonth());
  return null;
}

// Reads the free-text sales notes (all of a person's notes joined) and picks a stage.
// Order matters: real progress first, then "next intake", then the reasons a lead is lost, then activity.
export function classify(notesText: string): Classified {
  const t = notesText.toLowerCase().replace(/[’`]/g, "'");
  const R = (stage: string, reason: string | null, tier: string | null, rule: string): Classified => ({ stage, reason, tier, rule });
  const nextIntake = /next (year|batch|intake|academic year)|nexy year|join (in )?20(27|28)|after (completion|his|her) (of )?(his |her )?(degree|12th|graduation|course)|for next year/.test(t);

  // 1. real progress
  if (/(paid|payed) (the )?appl(ication)?\.? ?fees?|appl(ication)? fees? (is )?paid|fee paid|paid (the )?(application|entrance) fee/.test(t))
    return nextIntake ? R('Nurture – next intake', null, 'Hot', 'fee paid, next intake') : R('Fee paid', null, 'Hot', 'fee paid');
  if (/interview (is )?(scheduled|fixed|booked|on)|scheduled (for )?(an |the )?interview|interview done|attended (the )?interview/.test(t))
    return R('Interview scheduled', null, 'Hot', 'interview');
  if (/(done|did|filled|completed|attended|written|wrote|given)( in| the| his| her)* entrance|entrance (exam )?(done|completed|filled|attended)|has filled in the entrance exam/.test(t) && !/ftii|srfti|nid |nift|other (school|college|institute)/.test(t))
    return nextIntake ? R('Nurture – next intake', null, 'Hot', 'entrance exam, next intake') : R('Entrance exam done', null, 'Hot', 'entrance exam');

  // 2. wants a later batch
  if (nextIntake) return R('Nurture – next intake', null, 'Nurture', 'next intake');

  // 3. reasons a lead is lost
  if (/got (an? )?(ug |pg |mba |college )?admission|admission (for|in) (pg|ug|mba)|joined (in )?(a |an |the )?[a-z ]{0,25}(course|college|institute|academy|school)\b|already (doing|studying|joined)/.test(t))
    return R('Lost', 'Chose another option', 'Nurture', 'chose another option');
  if (/\bfor (a )?job\b|looking for (a )?job|job seeker|wants? (a )?job|searching (for )?(a )?job/.test(t)) return R('Lost', 'Job seeker', 'Nurture', 'job seeker');
  if (/\bafford|affort|budget|fees? (is |are )?(too )?hig|difficult to arrange (the )?fee|expensive|costly/.test(t)) return R('Lost', 'Budget', 'Nurture', 'budget');
  if (/\b(lang(uage)?|lan|land|lnag)\b\s*[-:]?\s*(issues?|problem|hindi|telugu|kannada|kanada|malayalam|bengali|bangla|marathi|gujarati|odia|oriya|punjabi|urdu|assamese|barrier)|^lan$|\| lan\b|speaks? only|only (hindi|telugu|kannada|malayalam|bengali|marathi|gujarati|odia)|(hindi|telugu|kannada|malayalam|bengali|marathi|gujarati|odia) speaking|need (a )?(hindi|telugu|kannada|malayalam|bengali|marathi) ?(person|speaker|speaking)?|doesn'?t (speak|know) english|no english/.test(t))
    return R('Lost', 'Language', 'Nurture', 'language');
  if (/(can'?t|cna'?t|cant) (shift|relocate|move|come)|cannot (shift|relocate|move)|not (interested |willing |able )?to (shift|relocate)|online (course|class)|only for online|wants? online|looking for online/.test(t))
    return R('Lost', 'Cannot relocate / wants online', 'Nurture', 'cannot relocate');
  if (/not el[ie]gible|under ?18|minor\b|\b([5-9]|1[01])(th)? (std|standard|grade)|\bstd ([5-9]|1[01])\b|11 standard/.test(t)) return R('Lost', 'Age / eligibility', 'Nurture', 'eligibility');
  if (/(studying|currently|pursuing|doing|in) (in |the )?12th|12th (std|standard|grade)?\.?\s*(student|studying)|currently in (class )?12|class 12 student|\b12th student/.test(t)) return R('Nurture – next intake', null, 'Nurture', '12th grade → next intake');
  if (/junk|fake|spam|prank|abusive/.test(t)) return R('Lost', 'Test / spam', 'Nurture', 'junk');
  if (/wrong (number|no|num)|invalid (number|no|num)|doesn'?t exists?|does ?n[io]o?t exist|(number|num|no)\.? (does )?not exist|number not (valid|exist|rece)|number missing|out o[ft] service|not in service|\berror\b|incorrect (number|no)/.test(t))
    return R('Lost', 'Invalid number', 'Nurture', 'invalid number');
  if (/not (interested|intrested|intersted|interseted)|no interest|nt interested|not keen|not possible|no inten[dt]|(for|in|wants?|looking for) acting|acting (course|class)|modell?ing|for investor|\bfor help\b/.test(t))
    return R('Lost', 'Not interested', 'Nurture', 'not interested');
  if (/short[- ]term (course|workshop|program)|short course|certificate course|weekend course|part[- ]time course|looking (for )?courses? in/.test(t)) return R('Lost', 'Chose another option', 'Nurture', 'short course');

  // 4. still open
  if (/hot lead/.test(t)) return R('Contacted', null, 'Hot', 'marked hot lead');
  if (/appl(ication)?\.? ?(form |link )?(is )?sent|\baf sent|sent (the )?appl(ication)?|application link sent/.test(t)) return R('Application link sent', null, 'Warm', 'application sent');
  if (/interested|call ?back|will discuss|discuss with|need(s)? (some )?time|details sent|given details|will check|check with|to follow|follow ?up|campus (tour|visit)|visit (the )?(academy|campus)|sent (details|pros)|pros(pectus)? sent|ask(ed)? to send|call later|call (me )?tomorrow|confirm by/.test(t))
    return R('Contacted', null, 'Warm', 'interested / call back');
  if (/rnr|not reachable|not reachble|unreachable|busy|did not pick|didn'?t pick|din'?t pick|\bdnp\b|no incoming|not incoming|voice ?(msg|message)|out of (network|coverage)|\bdnd\b|sw\w*c\w* ?off|disconnected|no response|not respond|ringing|not answer|not connect|call not|not available|\bnr\b/.test(t))
    return R('Not reachable', null, null, 'not reachable');
  if (/didn'?t apply|not applied|not sure|random call|just enquir/.test(t)) return R('Contacted', null, null, 'not applied / not sure');
  const meaningful = t.replace(/double entry|duplicate|@ ?ruban|@ ?admin|ruban to attend|\bruban\b|\|/g, '').trim();
  return meaningful ? R('Contacted', null, null, 'other note') : R('New', null, null, 'no notes');
}

export function buildSheetImport(input: SheetRow[], nowIso = new Date().toISOString()) {
  const rows: Row[] = input.map((r, i) => ({ ...r, i, at: mustParseTs(r.ts), p: normPhone(r.phone), e: clean(r.email).toLowerCase() }));

  // 1. group rows into people: same phone, same email, or same name within 10 minutes
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const keys: string[] = [];
    if (r.p.valid) keys.push('p:' + r.p.stored);
    else if (r.p.local.length >= 10) keys.push('raw:' + r.p.local);
    if (r.e) keys.push('e:' + r.e);
    for (const k of keys) { if (byKey.has(k)) union(r.i, byKey.get(k)!); else byKey.set(k, r.i); }
  }
  // same name within 10 minutes (compare only rows close in time)
  const byTime = rows.map((r) => ({ i: r.i, t: r.at.getTime(), n: normName(r.name) })).sort((x, y) => x.t - y.t || x.i - y.i);
  for (let x = 0; x < byTime.length; x++) {
    for (let y = x + 1; y < byTime.length && byTime[y].t - byTime[x].t <= 10 * 60000; y++) {
      if (byTime[x].n && byTime[x].n === byTime[y].n) union(byTime[x].i, byTime[y].i);
    }
  }
  const groups = new Map<number, Row[]>();
  for (const r of rows) { const g = find(r.i); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r); }

  const fmtIst = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  const leads: ImportLead[] = [];
  const submissions: ImportSubmission[] = [];
  const activities: ImportActivity[] = [];

  const people = [...groups.values()].map((rs) => rs.sort((a, b) => a.at.getTime() - b.at.getTime()))
    .sort((a, b) => a[0].at.getTime() - b[0].at.getTime());

  for (const rs of people) {
    const phone = rs.find((r) => r.p.valid)?.p ?? rs[0].p;
    const emails = [...new Set(rs.map((r) => r.e).filter(Boolean))];
    const phones = [...new Set(rs.map((r) => r.p.stored).filter(Boolean))];
    const name = rs.map((r) => clean(r.name).replace(/\.{2,}$/, '')).sort((a, b) => b.length - a.length)[0];

    const notes: Note[] = [];
    const rowNotes = (r: Row) => [
      ...NOTE_COLS.map(([k, label]) => ({ label, text: clean(r[k]) })),
      ...(r.notes ?? []).map((n) => ({ label: clean(n.label), text: clean(n.text) })),
    ];
    for (const r of rs) for (const { label, text } of rowNotes(r)) {
      if (!text) continue;
      let at = noteDate(text, r, new Date(nowIso)) ?? new Date(r.at.getTime() + 60000);
      if (at < r.at) at = new Date(r.at.getTime() + 60000);
      notes.push({ label, text, at });
    }
    const notesText = notes.map((n) => n.text).join(' | ');
    const key = phone.valid ? phone.stored : '';
    let c = OVERRIDES[key] ?? classify(notesText);
    // a lone row the team marked "Duplicate" is a copy of someone entered under other details
    if (c.rule === 'no notes' && rs.length === 1 && notes.some((n) => /^(duplicate|double entry)$/i.test(n.text)))
      c = { stage: 'Lost', reason: 'Duplicate', tier: null, rule: 'duplicate' };

    const cityRaw = rs.map((r) => (r.msg.match(/City: ([^·|]+)/) || [])[1]).find((x) => x && clean(x) !== 'Other');
    const programme = rs.map((r) => (r.msg.match(/Programme: ([^|]+)/) || [])[1]).find(Boolean);
    const srcTab = rs.map((r) => r.source).find(Boolean);
    let source = srcTab ? SOURCE_LABEL[srcTab] ?? srcTab : '';
    const utm = rs.map((r) => r.utm).find((u) => u && Object.keys(u).length) ?? {}; // first touch
    if (!source) {
      if (/\(facebook\)|facebook,/i.test(notesText)) source = 'Facebook';
      else if (/insta/i.test(notesText)) source = 'Instagram';
      else source = 'Website (Sheet import)';
    }
    const owner = /ruban/i.test(notesText) ? 'Ruban' : null;
    const callNotes = notes.filter((n) => !/^(double entry|@ ?ruban|@admin|ruban)$/i.test(n.text));
    const closed = c.stage === 'Lost' || c.stage === 'Enrolled';
    const followUp = QUICK_WINS.has(key) && !closed ? FOLLOW_UP_AT : null;
    const idKey = phone.valid ? phone.stored : (emails[0] || rs[0].name);
    const id = uuidFrom(idKey);
    const first = rs[0];
    const last = rs[rs.length - 1];
    const tabs = [...new Set(rs.map((r) => r.tab))].map((t) => (/^[A-Z][a-z]+$/.test(t) && t in MONTH_TABS ? `${t} 2026` : t)).join(' + ');
    const colours = [...new Set(rs.map((r) => clean(r.colour)).filter(Boolean))];
    const hotColour = colours.some((x) => /hot lead/i.test(x)) && !closed;

    leads.push({
      id,
      lead_code: 'Q' + sha('sha256', idKey).slice(0, 8).toUpperCase(),
      full_name: name,
      phone: phone.stored || null,
      phone_valid: phone.valid,
      email: emails[0] ?? null,
      city: cityRaw ? clean(cityRaw) : null,
      programme: programme ? clean(programme) : null,
      tier: hotColour ? 'Hot' : c.tier,
      flags: phone.valid ? [] : ['Invalid number'],
      stage: c.stage,
      lost_reason: c.reason,
      next_follow_up_at: followUp,
      call_attempts: callNotes.length,
      last_contacted_at: callNotes.length ? new Date(Math.max(...callNotes.map((n) => n.at.getTime()))).toISOString() : null,
      source,
      intent: intentOf(first.form),
      utm_source: utm.source ?? null, utm_medium: utm.medium ?? null, utm_campaign: utm.campaign ?? null,
      utm_content: utm.content ?? null, utm_term: utm.term ?? null,
      first_seen_at: first.at.toISOString(),
      last_submission_at: last.at.toISOString(),
      submissions_count: rs.length,
      legacy: {
        'Imported from': `Google Sheet · QURA Form Submissions (${tabs} tab)`,
        'Sheet rows merged': rs.length,
        ...(owner ? { 'Handled by (Sheet)': owner } : {}),
        ...(emails.length > 1 ? { 'Other emails': emails.slice(1) } : {}),
        ...(phones.length > 1 ? { 'Other phones': phones.filter((x) => x !== phone.stored) } : {}),
        ...(notes.length ? { 'Sheet notes': notes.map((n) => `${n.label}: ${n.text}`) } : {}),
        ...(colours.length ? { 'Sheet colour': colours.join(' + ') } : {}),
      },
      created_at: first.at.toISOString(),
    });

    for (const r of rs) {
      submissions.push({
        lead_id: id, submitted_at: r.at.toISOString(), origin: 'sheet_import', form_type: r.form, intent: intentOf(r.form),
        message: clean(r.msg) || null, answers: { name: clean(r.name), email: r.e, phone: clean(r.phone) },
        attribution: r.utm ? Object.fromEntries(Object.entries(r.utm).map(([k, v]) => [`utm_${k}`, v])) : r.source ? { source: r.source } : {},
      });
    }

    const push = (type: string, at: Date | string, summary: string) =>
      activities.push({ lead_id: id, actor_id: null, type, summary, occurred_at: at instanceof Date ? at.toISOString() : at });
    push('created', first.at, `Imported from the Google Sheet — first form ${fmtIst(first.at)}${rs.length > 1 ? ` · ${rs.length} form entries merged` : ''}`);
    for (const r of rs) {
      const msg = clean(r.msg);
      push('submission', r.at, `Form submitted (${r.form})${msg ? `\n${msg.length > 300 ? msg.slice(0, 300) + '…' : msg}` : ''}`);
    }
    for (const n of notes) push('import_note', n.at, `Sheet note (${n.label}): ${n.text}`);
    const tier = hotColour ? 'Hot' : c.tier;
    push('system', nowIso, `Stage set to ${c.stage}${c.reason ? ` (${c.reason})` : ''} from the Sheet notes during import${tier ? ` · tier ${tier}` : ''}${colours.length ? ` · row colour: ${colours.join(' + ')}` : ''}`);
    if (followUp) push('system', nowIso, 'Flagged for a January 2027 follow-up (was interested but stalled)');
  }

  return { leads, submissions, activities };
}
