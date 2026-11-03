// Deterministic detectors. They run before and after the models and cannot be
// talked out of a verdict by the enquiry text, which is why they exist next to
// the model-based checks.

// JavaScript's \b and \w are ASCII-only even with the u flag, so Cyrillic and
// accented words would never match. ure() rewrites them to Unicode-aware forms.
const W = '[\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
function ure(re: RegExp): RegExp {
  return new RegExp(re.source.replace(/\\b/g, B).replace(/\\w/g, W), re.flags.includes('u') ? re.flags : re.flags + 'u');
}

// Special categories of personal data (GDPR Art. 9) plus data a firm should
// never echo back in an automated email: health, criminal matters, migration
// status, minors, religion, sexual orientation, ethnicity, union membership.
const SPECIAL: { cat: string; re: RegExp }[] = [
  { cat: 'health', re: ure(/\b(diagnos\w*|cancer|kanker|krebs|depress\w*|burn-?out|pregnan\w*|zwanger\w*|schwanger\w*|enceinte|embarazad\w*|hiv|chemo\w*|psychiat\w*|therap\w*|medicat\w*|medicij\w*|disabilit\w*|handicap\w*|ziek\w*|krank\w*|malad\w*|enferm\w*|sick leave|ziekteverlof|arbeitsunfähig\w*|arrêt maladie|baja médica|хвор\w*|діагноз\w*|вагітн\w*)/i) },
  { cat: 'criminal', re: ure(/\b(arrest\w*|criminal record|conviction|convicted|police custody|detained|detention|aangehouden|strafblad|veroordeel\w*|verhaftet|vorstraf\w*|festgenommen|garde à vue|casier judiciaire|arrêté|detenid\w*|antecedentes penales|затриман\w*|судимість|ув'?язнен\w*)/i) },
  { cat: 'migration_status', re: ure(/\b(undocumented|illegal(ly)? (staying|resident)|overstay\w*|deport\w*|asylum|asiel\w*|uitzetting|ongedocumenteerd|abschiebung|asyl\w*|duldung|sans[- ]papiers|expulsion|demande d'asile|sin papeles|deportaci\w*|asilo|депортац\w*|притулок|біженц\w*)/i) },
  { cat: 'minor', re: ure(/(\b(son|daughter|child|kid|zoon|dochter|kind|sohn|tochter|fils|fille|enfant|hijo|hija)\b|\b(син|дочк|доньк)\S*)[^.!?\n]{0,25}?\d{1,2}|\b(minderjarig\w*|minderjährig\w*|mineur\w*|menor de edad|underage|minor child|неповнолітн\S*)/i) },
  { cat: 'safety_risk', re: ure(/\b(hits? me|beat(s|ing)? me|domestic (violence|abuse)|abus(e|ive|ed)|threaten\w*|violen\w*|geweld\w*|mishandel\w*|bedreig\w*|gewalt\w*|schlägt mich|bedroh\w*|violence\w*|me frappe|menace\w*|maltrato\w*|me pega|amenaz\w*|насильств\w*|б'?є мене|погрож\w*|suicid\w*|kill myself|end my life|can'?t go on|zelfmoord|selbstmord|me suicider|suicidarme|самогубств\w*)/i) },
  { cat: 'religion_orientation_ethnicity', re: ure(/\b(muslim|islam\w*|jewish|joods|jüdisch|juif|judío|christian|gay|lesbian|homosex\w*|transgender|bisexual|ethnic\w*|etnisch\w*|race|ras\b)/i) },
  { cat: 'trade_union', re: ure(/\b(trade union|union member|vakbond\w*|gewerkschaft\w*|syndicat\w*|sindicato\w*|профспіл\w*)/i) },
];

export function specialCategories(text: string): string[] {
  const found: string[] = [];
  for (const s of SPECIAL) if (s.re.test(text || '')) found.push(s.cat);
  return found;
}

// Prompt-injection markers in the inbound text. Enquiries come from the public
// internet through an embeddable form, so any instruction aimed at the model is
// treated as hostile input and the draft is held.
const INJECTION = ure(/(ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)|disregard (your|the) (rules|instructions)|you are now|system prompt|act as (an?|the) |reveal (your|the) (prompt|instructions)|negeer (alle )?(vorige|eerdere) instructies|ignoriere (alle )?(vorherigen|bisherigen) anweisungen|ignore[sz]? (les|toutes les) instructions|ignora (las|todas las) instrucciones|ігноруй (попередні|всі) інструкції|<\/?(system|assistant)>|\[\/?INST\])/i);

export function promptInjection(text: string): boolean {
  return INJECTION.test(text || '');
}

// Outcome promises in the drafted reply (deterministic net under the verifier).
const GUARANTEE = ure(/(\bguarantee\w*|\b100 ?%|you will (definitely |certainly )?win|we (always|never) lose|certain(ly)? (to )?succeed|garande(ren|ert)|zeker winnen|gewinnen sie sicher|garantier\w*|nous garantissons|vous allez gagner|garantiza\w*|ganará seguro|гарант\w*|точно виграєте)/i);

export function promisesOutcome(reply: string): boolean {
  return GUARANTEE.test(reply || '');
}

// Money amounts and percentages in the reply. Every one of them must appear in
// the knowledge-base snippets the model retrieved; otherwise the model invented
// a fee, a rate or a deadline-type number.
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  const re = /(€|eur|euro|\$|usd|£|cad|гривень|грн)\s?\d[\d.,]*|\d[\d.,]*\s?(€|eur|euro|euros|\$|usd|£|%|percent|procent|prozent|pour ?cent|por ?ciento|грн|гривень)/gi;
  for (const m of (text || '').matchAll(re)) {
    const digits = m[0].replace(/[^\d]/g, '').replace(/^0+/, '');
    if (digits) out.add(digits);
  }
  return [...out];
}

export function ungroundedNumbers(reply: string, groundText: string): string[] {
  const allowed = new Set(numbersInLoose(groundText));
  return numbersIn(reply).filter((n) => !allowed.has(n));
}

function numbersInLoose(text: string): string[] {
  return [...(text || '').matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[^\d]/g, '').replace(/^0+/, '')).filter(Boolean);
}

// Contact data in the reply that the firm did not publish (e-mails, phone
// numbers, URLs). Catches hallucinated phone numbers and links to third parties.
export function foreignContacts(reply: string, allowedText: string): string[] {
  const allowed = (allowedText || '').toLowerCase();
  // Phone numbers in the allowed text, digits only, one per entry.
  const allowedDigits = [...allowed.matchAll(/\+?\d[\d\s().-]{7,}\d/g)].map((m) => m[0].replace(/\D/g, ''));
  const found: string[] = [];
  for (const m of (reply || '').matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) if (!allowed.includes(m[0].toLowerCase())) found.push(m[0]);
  for (const m of (reply || '').matchAll(/https?:\/\/[^\s)]+/g)) {
    const u = m[0].replace(/[.,;]+$/, '').toLowerCase();
    if (!allowed.includes(u)) found.push(m[0]);
  }
  for (const m of (reply || '').matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 8 && !allowedDigits.includes(digits)) found.push(m[0].trim());
  }
  return found;
}

// Urgency markers: hearings, deadlines, detention. Raises priority; it does not
// by itself hold the reply.
const URGENT = ure(/\b(urgent\w*|asap|today|tomorrow|tonight|deadline|hearing|court date|emergency|spoed\w*|vandaag|morgen|zitting|dringend|heute|frist|anhörung|urgence|aujourd'hui|demain|audience|urgente|hoy|mañana|audiencia|терміново|сьогодні|завтра|суд)\b/i);

export function urgent(text: string): boolean {
  return URGENT.test(text || '');
}
