export const STAGES = [
  'New',
  'Contacted',
  'Not reachable',
  'Call scheduled',
  'Qualified on call',
  'Application link sent',
  'Fee paid',
  'Entrance exam done',
  'Interview scheduled',
  'Interview done',
  'Offer made',
  'Enrolled',
  'Nurture – next intake',
  'Lost',
] as const;
export type Stage = (typeof STAGES)[number];

export const CLOSED_STAGES: Stage[] = ['Enrolled', 'Lost'];
export const WON_STAGES: Stage[] = ['Fee paid', 'Entrance exam done', 'Interview scheduled', 'Interview done', 'Offer made', 'Enrolled'];

export const LOST_REASONS = [
  'Not reachable (3+ tries)',
  'Invalid number',
  'Language',
  'Cannot relocate / wants online',
  'Budget',
  'Age / eligibility',
  'Job seeker',
  'Joining next intake',
  'Chose another option',
  'Not interested',
  'Duplicate',
  'Test / spam',
] as const;

export const TIERS = ['Hot', 'Warm', 'Nurture'] as const;
export type Tier = (typeof TIERS)[number];

export const CALL_OUTCOMES = [
  { value: 'connected', label: 'Connected' },
  { value: 'rnr', label: 'No answer (RNR)' },
  { value: 'busy', label: 'Busy' },
  { value: 'not_reachable', label: 'Switched off / not reachable' },
  { value: 'callback', label: 'Asked to call back' },
  { value: 'wrong_number', label: 'Wrong number' },
] as const;

/** Meta event sent automatically when a lead reaches these stages. */
export const STAGE_META_EVENTS: Partial<Record<Stage, { event: string; value?: number; stamp: 'fee_paid_at' | 'interview_at' | 'enrolled_at' }>> = {
  'Fee paid': { event: 'SubmitApplication', value: 1500, stamp: 'fee_paid_at' },
  'Interview scheduled': { event: 'Schedule', stamp: 'interview_at' },
  Enrolled: { event: 'Purchase', value: 550000, stamp: 'enrolled_at' },
};

export const WA_TEMPLATES = [
  { name: 'qura_hot_v1', label: 'Hot — application link', vars: ['first_name', 'application_link'] },
  { name: 'qura_warm_v1', label: "Warm — we'll call you", vars: ['first_name'] },
  { name: 'qura_nurture_v1', label: 'Nurture — future intakes', vars: ['first_name'] },
] as const;

export const PROGRAMME_NAME = 'QURA One-Year Filmmaking Programme';

/** Human labels for the website form answers. */
export const ANSWER_LABELS: Record<string, { label: string; options: Record<string, string> }> = {
  age_band: {
    label: 'Age',
    options: { under_18: 'Under 18', '18_21': '18–21', '22_25': '22–25', '26_30': '26–30', '31_35': '31–35', '36_plus': '36+' },
  },
  current_status: {
    label: 'Right now',
    options: {
      school: 'In school (Class 11 or below)', class_12: 'In Class 12', completed_12: 'Finished Class 12',
      college: 'In college', graduate: 'Graduated', working: 'Working', business: 'Runs a business',
    },
  },
  looking_for: {
    label: 'Looking for',
    options: { fulltime: 'Full-time 1-year programme', short_course: 'Short course / workshop', job: 'Job or internship' },
  },
  english: {
    label: 'English',
    options: { very: 'Very comfortable', comfortable: 'Comfortable', not_comfortable: 'Not comfortable' },
  },
  relocate: {
    label: 'Chennai from Jan 2027',
    options: { chennai: 'Already in/near Chennai', yes: 'Can relocate', not_sure: 'Not sure', no: 'No — needs online/near home' },
  },
  start_pref: {
    label: 'Start',
    options: { jan_2027: 'January 2027', later_2027: 'Later 2027', exploring: 'Just exploring' },
  },
  funding: {
    label: 'Funding',
    options: { family: 'Family', self: 'Self', loan: 'Education loan', scholarship: 'Needs scholarship', not_workable: '₹5.5L not workable' },
  },
  parents: {
    label: 'Family involved',
    options: { involved: 'Involved', will_discuss: 'Will discuss', self: 'Deciding alone' },
  },
  focus: {
    label: 'Craft',
    options: {
      direction: 'Direction', cinematography: 'Cinematography', editing: 'Editing',
      screenwriting: 'Screenwriting', sound: 'Sound', not_sure: 'Not sure yet',
    },
  },
  experience: {
    label: 'Made so far',
    options: { none: 'Nothing yet', reels: 'Reels / YouTube', short_films: 'Short films', professional: 'Professional sets' },
  },
};

export function answerLabel(field: string, value: string | null | undefined): string {
  if (!value) return '—';
  return ANSWER_LABELS[field]?.options[value] ?? value;
}
