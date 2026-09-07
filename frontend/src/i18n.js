import { messages } from "./messages.js";

export function resolveLanguage(locale) {
  return /^ja(?:[-_]|$)/i.test(locale ?? "") ? "ja" : "en";
}

let language = resolveLanguage(globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language);
export const getLanguage = () => language;
export function setLanguage(locale) { language = resolveLanguage(locale); }

// Placeholders are substituted after translation, so transcripts, account IDs,
// endpoints and error details are always preserved verbatim.
export function t(source, ...args) {
  const template = language === "ja" ? source : (messages[source] ?? source);
  return template.replace(/\{(\d+)\}/g, (token, index) => index < args.length ? String(args[index]) : token);
}

export function localizeDOM(document) {
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.body, 4 /* SHOW_TEXT */);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (["SCRIPT", "STYLE", "TEXTAREA"].includes(node.parentElement?.tagName)) continue;
    const source = node.textContent.trim();
    if (Object.hasOwn(messages, source)) node.textContent = node.textContent.replace(source, t(source));
  }
  for (const node of document.querySelectorAll("[title], [placeholder], [aria-label]")) {
    for (const name of ["title", "placeholder", "aria-label"]) {
      const source = node.getAttribute(name);
      if (source && Object.hasOwn(messages, source)) node.setAttribute(name, t(source));
    }
  }
}
