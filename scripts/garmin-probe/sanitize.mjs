// Turns a Garmin response into its *shape*: keys, types, array lengths and the few values that
// matter for design (dates, enums, plan/race names, numbers). Everything that could identify the
// person (names, e-mail, ids, places, tokens, free text) is replaced by a placeholder.

const ISO = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const TOKEN_LIKE = /^[A-Za-z0-9_\-+/=.]{24,}$/;
const ENUM = /^[A-Z][A-Z0-9_]{1,40}$/;
const EMAIL = /[^\s@]+@[^\s@]+/;

const SECRET_KEY = /token|secret|password|passwd|cookie|authorization|apikey|e?mail|displayName|fullName|userName|firstName|lastName|nickname|profileImage|imageUrl|image|avatar|serial|ownerName|phone|address|birth|gender|location|city|place|venue|country|polyline|geo/i;
const GEO_KEY = /^(lat|lon|lng|latitude|longitude)$|(Latitude|Longitude)$/i;
const ID_KEY = /(^|_)(id|uuid|guid|pk)$|Id$|ID$|Uuid$|UUID$|Guid$|[Pp][Kk]$|Ids$/;
// Body measurements are health data about the person, not about the training.
const BODY_KEY = /weight|height|bmi|bodyFat|bodyWater|muscle|boneMass|visceral|difference/i;
// A large integer under a key that is not a known quantity is most likely an identifier.
const QUANTITY_KEY = /(Secs?|Seconds|Meters|Millis|Ms|Duration|Distance|Timestamp|Time|Calories|Kilocalories|Steps)$/i;
export function redactNumber(key, n) {
  if (GEO_KEY.test(key)) return '<redacted:geo>';
  if (ID_KEY.test(key)) return '<id:number>';
  if (BODY_KEY.test(key)) return '<redacted:body>';
  if (Number.isInteger(n) && Math.abs(n) >= 100000 && Math.abs(n) < 1e10 && !QUANTITY_KEY.test(key)) return '<redacted:id-like>';
  return n;
}
// Text worth keeping: training and race names are the point of the probe.
const KEEP_TEXT_KEY = /^(workoutName|eventName|planName|trainingPlanName)$/;
const KEEP_ENUMISH_KEY = /(Key|Type|Status|Phrase|Level|State|Feedback|Zone|Intensity|Sport|Mode|Unit)s?$/;

const MAX_DEPTH = 9;
const SAMPLE = 3;
const MAX_KEYS = 60;

export function scrubString(s) {
  return String(s).replace(/[^\s@]+@[^\s@]+/g, '<email>').replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '<token-like>').slice(0, 160);
}

function shapeString(value, key) {
  if (SECRET_KEY.test(key)) return `<redacted:${value.length}>`;
  if (ID_KEY.test(key)) return `<id:string>`;
  if (EMAIL.test(value)) return '<redacted:email>';
  if (ISO.test(value)) return value;
  if (TOKEN_LIKE.test(value)) return '<redacted:token-like>';
  if (KEEP_TEXT_KEY.test(key)) return value.slice(0, 80);
  if (ENUM.test(value) && value.length <= 40) return value;
  if (KEEP_ENUMISH_KEY.test(key) && value.length <= 40 && !/\s{2,}/.test(value)) return value;
  return `<string:${value.length}>`;
}

export function shape(value, key = '', depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '<too deep>';
  switch (typeof value) {
    case 'boolean': return value;
    case 'number': return redactNumber(key, value);
    case 'string': return shapeString(value, key);
    case 'object': break;
    default: return `<${typeof value}>`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return [];
    return { __array: value.length, items: value.slice(0, SAMPLE).map(item => shape(item, key, depth + 1)) };
  }
  const entries = Object.entries(value);
  const out = {};
  for (const [k, v] of entries.slice(0, MAX_KEYS)) out[k] = SECRET_KEY.test(k) && typeof v !== 'object' ? '<redacted>' : shape(v, k, depth + 1);
  if (entries.length > MAX_KEYS) out.__more_keys = entries.length - MAX_KEYS;
  return out;
}

/** Re-applies the number rules to a file written by an older version of the probe. */
export function scrubShape(value, key = '') {
  if (typeof value === 'number') return redactNumber(key, value);
  if (Array.isArray(value)) return value.map(item => scrubShape(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubShape(v, k)]));
  return value;
}

/** Strings (>= 4 chars) that must never appear in the output: what the user typed and every token value. */
export function collectSecrets(...sources) {
  const found = new Set();
  const walk = v => {
    if (typeof v === 'string') { if (v.length >= 4) found.add(v); }
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  sources.forEach(walk);
  return [...found];
}

export function findLeaks(serialized, secrets) {
  return secrets.filter(secret => serialized.includes(secret));
}
