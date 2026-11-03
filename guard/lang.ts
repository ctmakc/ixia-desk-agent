import type { Lang } from './types';

// Stopword-vote language detection for the six languages IXIA ships safe
// templates for. Short enquiries are common ("Prijs?"), so ties fall back to
// English. Cyrillic script maps to Ukrainian.
const STOP: Record<Lang, string[]> = {
  en: ['the', 'and', 'is', 'my', 'i', 'you', 'to', 'for', 'with', 'have', 'can', 'what', 'how', 'need', 'help', 'please', 'hello', 'hi', 'do', 'about', 'are', 'your', 'we', 'me', 'of', 'a', 'in', 'on', 'it'],
  nl: ['de', 'het', 'een', 'en', 'ik', 'je', 'jullie', 'mijn', 'is', 'van', 'voor', 'met', 'wat', 'hoe', 'kunnen', 'kan', 'graag', 'hulp', 'goedemiddag', 'goedemorgen', 'hallo', 'niet', 'ook', 'wij', 'zijn', 'heb', 'heeft', 'bij', 'op', 'dat', 'er', 'mij', 'u', 'uw'],
  de: ['der', 'die', 'das', 'und', 'ich', 'sie', 'mein', 'meine', 'ist', 'von', 'für', 'mit', 'was', 'wie', 'können', 'kann', 'bitte', 'hilfe', 'guten', 'hallo', 'nicht', 'auch', 'wir', 'sind', 'habe', 'hat', 'bei', 'auf', 'ein', 'eine', 'mich', 'ihre'],
  fr: ['le', 'la', 'les', 'et', 'je', 'vous', 'mon', 'ma', 'mes', 'est', 'de', 'pour', 'avec', 'que', 'comment', 'pouvez', 'aide', 'bonjour', 'merci', 'pas', 'aussi', 'nous', 'sont', 'ai', 'une', 'un', 'sur', 'dans', 'votre', 'besoin'],
  es: ['el', 'la', 'los', 'y', 'yo', 'usted', 'mi', 'es', 'de', 'para', 'con', 'que', 'cómo', 'como', 'pueden', 'ayuda', 'hola', 'gracias', 'no', 'también', 'nosotros', 'son', 'tengo', 'una', 'un', 'en', 'su', 'necesito'],
  uk: [],
};

export function detectLang(text: string): Lang {
  const t = (text || '').toLowerCase();
  const cyr = (t.match(/[а-яіїєґ]/g) || []).length;
  const lat = (t.match(/[a-zà-ÿ]/g) || []).length;
  if (cyr > lat) return 'uk';
  const words = t.split(/[^a-zà-ÿßäöüéèêàçñ']+/).filter(Boolean);
  const score: Record<string, number> = { en: 0, nl: 0, de: 0, fr: 0, es: 0 };
  for (const w of words) for (const l of ['en', 'nl', 'de', 'fr', 'es'] as const) if (STOP[l].includes(w)) score[l]++;
  if (/[äöüß]/.test(t)) score.de += 1;
  if (/[ñ¿¡]/.test(t)) score.es += 2;
  if (/[çœ]|\b(qu'|j'|l'|d')/.test(t)) score.fr += 1;
  if (/\b(ij|oe|aa)\w*/.test(t) && /\b(ik|het|een|jullie|mijn)\b/.test(t)) score.nl += 1;
  let best: Lang = 'en';
  let max = 0;
  for (const [l, s] of Object.entries(score)) if (s > max) { max = s; best = l as Lang; }
  return best;
}

export function normalizeLang(code: string | undefined, fallback: Lang): Lang {
  const c = (code || '').toLowerCase().slice(0, 2);
  return (['en', 'nl', 'de', 'fr', 'es', 'uk'] as const).includes(c as Lang) ? (c as Lang) : fallback;
}

// Transparency line appended to every AI-written message the enquirer receives.
export const AI_DISCLOSURE: Record<Lang, string> = {
  en: 'This first reply was written by an AI assistant on behalf of {firm}. A member of our team reviews every enquiry.',
  nl: 'Dit eerste antwoord is geschreven door een AI-assistent namens {firm}. Een medewerker van ons team bekijkt elke aanvraag.',
  de: 'Diese erste Antwort wurde von einem KI-Assistenten im Auftrag von {firm} verfasst. Ein Mitglied unseres Teams prüft jede Anfrage.',
  fr: 'Cette première réponse a été rédigée par un assistant IA au nom de {firm}. Un membre de notre équipe examine chaque demande.',
  es: 'Esta primera respuesta la ha redactado un asistente de IA en nombre de {firm}. Un miembro de nuestro equipo revisa cada consulta.',
  uk: 'Цю першу відповідь написав ШІ-асистент від імені {firm}. Кожне звернення переглядає працівник нашої команди.',
};

// Safe acknowledgement: sent instantly when the draft is held. It confirms
// receipt and the SLA, gives no advice, repeats none of the enquirer's details.
export const SAFE_ACK: Record<Lang, string> = {
  en: '{greeting}\n\nThank you for contacting {firm}. We have received your message and a member of our team will reply personally within {sla} minutes during business hours.',
  nl: '{greeting}\n\nDank u voor uw bericht aan {firm}. We hebben uw aanvraag ontvangen en een medewerker neemt binnen {sla} minuten tijdens kantooruren persoonlijk contact met u op.',
  de: '{greeting}\n\nVielen Dank für Ihre Nachricht an {firm}. Wir haben Ihre Anfrage erhalten; ein Mitglied unseres Teams antwortet Ihnen persönlich innerhalb von {sla} Minuten während der Geschäftszeiten.',
  fr: '{greeting}\n\nMerci d’avoir contacté {firm}. Nous avons bien reçu votre message et un membre de notre équipe vous répondra personnellement sous {sla} minutes pendant les heures ouvrables.',
  es: '{greeting}\n\nGracias por contactar con {firm}. Hemos recibido su mensaje y un miembro de nuestro equipo le responderá personalmente en un plazo de {sla} minutos en horario laboral.',
  uk: '{greeting}\n\nДякуємо, що звернулися до {firm}. Ми отримали ваше повідомлення, і працівник нашої команди особисто відповість вам протягом {sla} хвилин у робочий час.',
};

export const GREETING_NAMED: Record<Lang, string> = {
  en: 'Hi {first},', nl: 'Beste {first},', de: 'Hallo {first},', fr: 'Bonjour {first},', es: 'Hola {first}:', uk: 'Вітаємо, {first}!',
};
export const GREETING_ANON: Record<Lang, string> = {
  en: 'Hello,', nl: 'Beste heer/mevrouw,', de: 'Guten Tag,', fr: 'Bonjour,', es: 'Hola:', uk: 'Вітаємо!',
};

export function fill(tpl: string, vars: Record<string, string | number>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
