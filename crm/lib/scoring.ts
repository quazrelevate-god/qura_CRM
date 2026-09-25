// Lead scoring — same rules as the tested n8n "Score lead" node (max 100 points).
import { normPhone, validEmail, type Phone } from './phone';

export const HOT_MIN = 70;
export const WARM_MIN = 45;
export const MIN_SECONDS_ON_FORM = 20;

const POINTS: Record<string, Record<string, number>> = {
  funding: { family: 25, self: 25, loan: 15, scholarship: 5 },
  start: { jan_2027: 15, later_2027: 5, exploring: 0 },
  age_band: { '18_21': 15, '22_25': 14, '26_30': 9, '31_35': 4, '36_plus': 0 },
  relocate: { chennai: 10, yes: 8, not_sure: 3 },
  current_status: { completed_12: 10, college: 10, graduate: 10, working: 7, business: 7 },
  english: { very: 5, comfortable: 3 },
  parents: { involved: 5, will_discuss: 3, self: 3 },
  experience: { professional: 3, short_films: 3, reels: 2, none: 1 },
};

const clean = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const pts = (table: string, key: string) => POINTS[table]?.[key] ?? 0;

function whyPoints(text: string): number {
  const t = clean(text);
  const uniqueWords = new Set(t.toLowerCase().split(/[^a-zऀ-෿]+/).filter((w) => w.length > 2)).size;
  if (uniqueWords < 12) return 0;
  if (t.length >= 400) return 10;
  if (t.length >= 250) return 7;
  if (t.length >= 150) return 4;
  return 0;
}

export type ScoreResult = {
  phone: Phone;
  email: string;
  score: number;
  tier: 'Hot' | 'Warm' | 'Nurture';
  breakdown: Record<string, number>;
  knockouts: string[];
  flags: string[];
  isSpam: boolean;
  isTest: boolean;
  canMessage: boolean;
  canSendEvents: boolean;
  metaEvents: string[];
  secondsOnForm: number | null;
};

export function scoreLead(b: Record<string, unknown>, opts: { testEventCode?: string } = {}): ScoreResult {
  const email = clean(b.email).toLowerCase();
  const phone = normPhone(b.phone);
  const name = clean(b.full_name);

  const started = Number(b.form_started_at);
  const submitted = Number(b.form_submitted_at);
  const secondsOnForm = Number.isFinite(started) && Number.isFinite(submitted) && started > 0 ? (submitted - started) / 1000 : null;
  const isSpam = clean(b.website) !== '' || (secondsOnForm !== null && secondsOnForm > 0 && secondsOnForm < MIN_SECONDS_ON_FORM);
  const isTest = clean(b.qura_test) === '1' || /@claude\.local$/.test(email) || /\btest(ing)?\b/i.test(name);

  const flags: string[] = [];
  if (isSpam) flags.push('Spam');
  if (isTest) flags.push('Test');
  if (!phone.valid) flags.push('Invalid number');
  if (email && !validEmail(email)) flags.push('Invalid email');

  const knockouts: string[] = [];
  if (b.age_band === 'under_18') knockouts.push('Age: under 18');
  if (b.current_status === 'school' || b.current_status === 'class_12') knockouts.push('Still in school: next intake');
  if (b.english === 'not_comfortable') knockouts.push('Language');
  if (b.relocate === 'no') knockouts.push('Wants online / cannot relocate');
  if (b.looking_for === 'job') knockouts.push('Job seeker');
  if (b.funding === 'not_workable') knockouts.push('Budget');
  if (b.looking_for === 'short_course') knockouts.push('Short-course seeker');

  const hasPortfolio = /^https?:\/\/\S+\.\S+/.test(clean(b.portfolio_link));
  const breakdown: Record<string, number> = {
    funding: pts('funding', clean(b.funding)),
    start: pts('start', clean(b.start)),
    age: pts('age_band', clean(b.age_band)),
    relocate: pts('relocate', clean(b.relocate)),
    status: pts('current_status', clean(b.current_status)),
    english: pts('english', clean(b.english)),
    parents: pts('parents', clean(b.parents)),
    experience: pts('experience', clean(b.experience)),
    why: whyPoints(clean(b.why)),
    portfolio: hasPortfolio ? 2 : 0,
  };
  const score = Math.min(100, Object.values(breakdown).reduce((a, c) => a + c, 0));

  const hotGate = b.start === 'jan_2027' && ['family', 'self', 'loan'].includes(clean(b.funding));
  let tier: ScoreResult['tier'];
  if (isSpam || knockouts.length) tier = 'Nurture';
  else if (score >= HOT_MIN && hotGate) tier = 'Hot';
  else if (score >= WARM_MIN) tier = 'Warm';
  else tier = 'Nurture';

  // Test submissions only reach Meta while a test event code is set. Nothing about under-18s goes to Meta.
  const canMessage = !isSpam && phone.valid;
  const canSendEvents = canMessage && (!isTest || !!opts.testEventCode) && b.age_band !== 'under_18';
  const metaEvents: string[] = [];
  if (canSendEvents) {
    if (tier === 'Hot' || tier === 'Warm') metaEvents.push('Lead');
    if (tier === 'Hot') metaEvents.push('QualifiedLead');
    if (tier === 'Nurture') metaEvents.push('NurtureLead');
  }

  return { phone, email, score, tier, breakdown, knockouts, flags, isSpam, isTest, canMessage, canSendEvents, metaEvents, secondsOnForm };
}
