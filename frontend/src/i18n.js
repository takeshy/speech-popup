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

const textSources = new WeakMap();
const attributeSources = new WeakMap();

export function localizeDOM(document) {
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.body, 4 /* SHOW_TEXT */);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (["SCRIPT", "STYLE", "TEXTAREA"].includes(node.parentElement?.tagName)) continue;
    let saved = textSources.get(node);
    if (!saved) {
      const source = node.textContent.trim();
      if (!Object.hasOwn(messages, source)) continue;
      saved = { original: node.textContent, source, last: node.textContent };
      textSources.set(node, saved);
    }
    // Dynamic content is rendered by its owner; never replace user data.
    if (node.textContent !== saved.last) continue;
    node.textContent = saved.original.replace(saved.source, t(saved.source));
    saved.last = node.textContent;
  }
  for (const node of document.querySelectorAll("[title], [placeholder], [aria-label]")) {
    for (const name of ["title", "placeholder", "aria-label"]) {
      let saved = attributeSources.get(node);
      if (!saved) { saved = {}; attributeSources.set(node, saved); }
      const current = node.getAttribute(name);
      if (!saved[name] && current && Object.hasOwn(messages, current)) {
        saved[name] = { source: current, last: current };
      }
      if (saved[name] && current === saved[name].last) {
        saved[name].last = t(saved[name].source);
        node.setAttribute(name, saved[name].last);
      }
    }
  }
}
