// Editable command suggestions, not reserved words. Keep the original Japanese
// command and use short completion/send commands for other recognition languages.
const DEFAULTS = {
  af: "klaar", am: "ጨርሻለሁ", ar: "إرسال", as: "পঠিয়াওক", az: "göndər",
  ba: "ебәр", be: "гатова", bg: "готово", bn: "পাঠান", bo: "བཏང་",
  br: "echu", bs: "gotovo", ca: "acabat", ceb: "ipadala", cs: "hotovo",
  cy: "gorffen", da: "færdig", de: "fertig", el: "έτοιμο", en: "over",
  es: "terminado", et: "valmis", eu: "amaituta", fa: "ارسال", fi: "valmis",
  fil: "ipadala", fo: "liðugt", fr: "terminé", gl: "rematado", gu: "મોકલો",
  ha: "aika", haw: "hoʻouna", he: "שלח", hi: "भेजो", hr: "gotovo",
  ht: "voye", hu: "kész", hy: "ուղարկել", id: "kirim", is: "búið",
  it: "finito", ja: "over, オーバー", jv: "kirim", ka: "გაგზავნა", kea: "manda",
  kk: "жібер", km: "ផ្ញើ", kn: "ಕಳುಹಿಸಿ", ko: "전송", ky: "жөнөт",
  la: "finis", lb: "fäerdeg", ln: "tinda", lo: "ສົ່ງ", lt: "baigta",
  lv: "gatavs", mg: "alefaso", mi: "tukuna", mk: "готово", ml: "അയയ്ക്കുക",
  mn: "илгээх", mr: "पाठवा", ms: "hantar", mt: "lest", my: "ပို့ပါ",
  nb: "ferdig", ne: "पठाउनुहोस्", nl: "klaar", nn: "ferdig", oc: "acabat",
  or: "ପଠାନ୍ତୁ", pa: "ਭੇਜੋ", pl: "gotowe", ps: "ولېږه", pt: "terminado",
  ro: "terminat", ru: "готово", rup: "gata", sa: "प्रेषय", sd: "موڪليو",
  si: "යවන්න", sk: "hotovo", sl: "končano", sn: "tumira", so: "dir",
  sq: "përfundoi", sr: "готово", su: "kirim", sv: "klart", sw: "tuma",
  ta: "அனுப்பு", te: "పంపు", tg: "фирист", th: "ส่งข้อความ", tk: "iber",
  tr: "tamam", tt: "җибәр", uk: "готово", ur: "بھیجو", uz: "yubor",
  vi: "gửi", yi: "שיקן", yo: "firanṣẹ", yue: "發送", zh: "发送",
  "zh-Hant": "發送"
};

export function sendPhraseLanguage(language, detectedLocale = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? "en") {
  const locale = (!language || language.toLowerCase() === "auto" ? detectedLocale : language).replaceAll("_", "-").toLowerCase();
  const primary = locale.split("-")[0];
  if (["zh", "cmn"].includes(primary)) {
    return /(?:^|-)hant(?:-|$)|-(tw|hk|mo)$/.test(locale) ? "zh-Hant" : "zh";
  }
  return ({ jw: "jv", tl: "fil", no: "nb" })[primary] ?? primary;
}

export function defaultSendPhrase(language) {
  return DEFAULTS[sendPhraseLanguage(language)] ?? "over";
}

export function initialSendPhrase(speech) {
  const key = sendPhraseLanguage(speech.language);
  if (Object.hasOwn(speech.sendPhraseProfiles ?? {}, key)) return speech.sendPhraseProfiles[key];
  // Old installations had one global value. Preserve edits, including an empty
  // value that disables the command, but replace the old bilingual default.
  if (speech.sendPhrase != null && speech.sendPhrase !== "over, オーバー") return speech.sendPhrase;
  return defaultSendPhrase(key);
}
