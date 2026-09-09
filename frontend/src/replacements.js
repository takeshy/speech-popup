// Spoken text swapped for text that cannot be dictated.
//
// A slash command is the case this exists for: "/daily" cannot be said in
// Japanese - recognition never produces the slash, and reading the letters out
// gives "デイリー". Registering 日記書いて => /daily lets the sentence be spoken
// and the command be pasted.

const SEPARATORS = /\s*(?:=>|⇒|→)\s*/;

/**
 * A replacement is often a whole sentence, which may itself contain line breaks,
 * so a stored rule keeps them escaped: one rule always occupies exactly one line.
 */
function unescapeText(value) {
  return value.replace(/\\([\\n])/g, (_match, escaped) => (escaped === "n" ? "\n" : "\\"));
}

function escapeText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
}

export function parseReplacementRules(text) {
  return String(text ?? "").split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    // A rule without an arrow is a half-written line, not a rule that deletes
    // everything, so it is ignored rather than applied.
    if (!trimmed || trimmed.startsWith("#") || !SEPARATORS.test(trimmed)) return [];
    const [from, ...rest] = trimmed.split(SEPARATORS);
    const spoken = from.trim();
    if (!spoken) return [];
    // The arrow may appear in the replacement itself, so only the first splits.
    return [{ from: unescapeText(spoken), to: unescapeText(rest.join(" => ").trim()) }];
  });
}

/** The stored form of what the settings rows hold. Rules without a phrase are dropped. */
export function serializeReplacementRules(rules) {
  return rules
    .map((rule) => ({ from: String(rule.from ?? "").trim(), to: String(rule.to ?? "").trim() }))
    .filter((rule) => rule.from)
    .map((rule) => `${escapeText(rule.from)} => ${escapeText(rule.to)}`)
    .join("\n");
}

// Scripts commonly written without spaces cannot use word boundaries; scripts
// that do need them, or "day" would fire inside "daylight".
const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;

function rulePattern(from) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (UNSPACED.test(from) || !/^[\p{L}\p{N}_]/u.test(from)) return escaped;
  return `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`;
}

/**
 * Replace every occurrence, longest phrase first so a rule for a longer sentence
 * wins over one for a phrase inside it. Latin text matches case-insensitively,
 * as the recognizer's capitalization is not the user's. All rules are applied in
 * a single pass: run one after another, a rule matches what the previous one
 * just produced ("/daily" turned into "//d" by a rule for "daily").
 */
// The recognizer punctuates what it hears, so a phrase spoken as a sentence
// arrives as "インフォグラフィック。" and would leave "/infographic。" - not the
// command the rule stands for. Punctuation right after the phrase is consumed
// with it, the way a send phrase already is.
// The same set the send phrase and the symbol commands consume.
const PUNCTUATION = "\\s。．.!！?？、,،؛؟۔।॥";

export function applyReplacementRules(text, rules) {
  if (!text || !rules?.length) return text;
  const ordered = [...rules].sort((a, b) => b.from.length - a.from.length);
  const alternatives = ordered.map((rule) => `(${rulePattern(rule.from)})`).join("|");
  const pattern = new RegExp(`(?:${alternatives})([${PUNCTUATION}]*)`, "giu");
  return text.replace(pattern, (...args) => {
    const groups = args.slice(1, 1 + ordered.length);
    const matched = groups.findIndex((value) => value !== undefined);
    if (matched < 0) return args[0];
    const { to } = ordered[matched];
    const offset = args[args.length - 2];
    const rest = args[args.length - 1].slice(offset + args[0].length);
    // Dictation continues after the phrase: keep the words apart, since the
    // separator the recognizer put there has just been consumed.
    const separator = to && rest && !new RegExp(`^[${PUNCTUATION}]`, "u").test(rest) && !/\s$/.test(to) ? " " : "";
    return to + separator;
  });
}
