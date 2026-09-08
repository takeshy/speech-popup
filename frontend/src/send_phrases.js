// Only Japanese and English have built-in send phrases. Other languages start
// disabled, and existing saved overrides are preserved.
const DEFAULTS = { en: "over", ja: "おしまい" };

export function sendPhraseLanguage(language, detectedLocale = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? "en") {
  const locale = (!language || language.toLowerCase() === "auto" ? detectedLocale : language).replaceAll("_", "-").toLowerCase();
  const primary = locale.split("-")[0];
  if (["zh", "cmn"].includes(primary)) {
    return /(?:^|-)hant(?:-|$)|-(tw|hk|mo)$/.test(locale) ? "zh-Hant" : "zh";
  }
  return ({ jw: "jv", tl: "fil", no: "nb" })[primary] ?? primary;
}

export function defaultSendPhrase(language) {
  return DEFAULTS[sendPhraseLanguage(language)] ?? "";
}

export function initialSendPhrase(speech) {
  const key = sendPhraseLanguage(speech.language);
  if (Object.hasOwn(speech.sendPhraseProfiles ?? {}, key)) return speech.sendPhraseProfiles[key];
  // Old installations had one global value. Preserve edits, including an empty
  // value that disables the command, but replace the old bilingual default.
  if (speech.sendPhrase != null && speech.sendPhrase !== "over, オーバー") return speech.sendPhrase;
  return defaultSendPhrase(key);
}
