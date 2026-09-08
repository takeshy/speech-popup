import { sendPhraseLanguage } from "./send_phrases.js";

export function defaultSpeechCommands(language) {
  switch (sendPhraseLanguage(language)) {
    case "ja": return { question: "クエスチョン, クエスチョンマーク", newline: "エンター", exclamation: "びっくり" };
    case "en": return { question: "question, question mark", newline: "enter", exclamation: "exclamation" };
    default: return { question: "", newline: "", exclamation: "" };
  }
}

export function speechCommandsFor(speech) {
  const key = sendPhraseLanguage(speech.language);
  const defaults = defaultSpeechCommands(key);
  return {
    question: speech.questionPhrases?.[key] ?? defaults.question,
    newline: speech.newlinePhrases?.[key] ?? defaults.newline,
    exclamation: speech.exclamationPhrases?.[key] ?? defaults.exclamation
  };
}

export const splitCommandPhrases = (phrases) => phrases.split(/[,、\n]/).map(value => value.trim()).filter(Boolean);

export function trailingCommand(text, phrases) {
  const names = splitCommandPhrases(phrases).sort((a, b) => b.length - a.length).map(phrase => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const unspaced = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u.test(phrase);
    return (!unspaced && /^[\p{L}\p{N}_]/u.test(phrase) ? "(?<![\\p{L}\\p{N}\\p{M}_])" : "") + escaped;
  });
  return names.length ? new RegExp(`(?:${names.join("|")})[\\s。．.!！?？、,،؛؟।॥]*$`, "iu").exec(text) : null;
}
