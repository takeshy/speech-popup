import { t } from "./i18n.js";
// Speech-to-text core, ported from gemihub-desktop's src/llm/speechTranscription.ts.
// Everything here is pure or takes its HTTP transport as an argument, so the
// whole module is testable under plain node (see ../../tests/speech.test.js).

export const ENDPOINT_TYPES = [
  "openai",
  "whisper-cpp",
  "custom",
  "azure-mai-transcribe",
  "gemini-transcribe",
  "vertex-transcribe"
];

// 5 minutes of 16 kHz mono 16-bit PCM, the cap every provider path shares.
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 300;
const WAV_HEADER_BYTES = 44;

export function isGoogleEndpoint(endpointType) {
  return endpointType === "gemini-transcribe" || endpointType === "vertex-transcribe";
}

// Defaults for services without a saved profile. Credentials belong only to
// their own service and must never carry over to a different API.
export function endpointPreset(endpointType) {
  switch (endpointType) {
    case "gemini-transcribe":
      return {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-3.5-transcribe",
        language: "auto"
      };
    case "vertex-transcribe":
      return {
        baseUrl: "https://aiplatform.googleapis.com/v1beta1",
        model: "gemini-3.5-transcribe-preview",
        language: "auto"
      };
    case "whisper-cpp":
      return { baseUrl: "http://127.0.0.1:8080", model: "", language: "auto" };
    case "azure-mai-transcribe":
      return { baseUrl: "", model: "MAI-Transcribe-2", language: "auto" };
    case "custom":
      return { baseUrl: "", model: "", language: "auto" };
    default:
      return { baseUrl: "https://api.openai.com/v1", model: "whisper-1", language: "auto" };
  }
}

export function transcriptionURL(baseUrl, endpointType = "openai", vertexProjectId = "") {
  if (endpointType === "vertex-transcribe") {
    const project = vertexProjectId.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(project)) {
      throw new Error(t("Vertex AI の Google Cloud プロジェクト ID を設定してください。"));
    }
    return `https://aiplatform.googleapis.com/v1beta1/projects/${project}/locations/global/publishers/google/models/gemini-3.5-transcribe-preview:generateContent`;
  }
  if (endpointType === "gemini-transcribe") {
    return "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent";
  }
  const url = new URL(baseUrl.trim());
  if (
    !["http:", "https:"].includes(url.protocol) || url.username ||
    url.password || url.search || url.hash
  ) {
    throw new Error(t("Base URL には認証情報・クエリ・フラグメントを含まない HTTP(S) URL を指定してください。"));
  }
  if (endpointType === "azure-mai-transcribe") {
    url.pathname = url.pathname.replace(/\/+$/, "") + "/speechtotext/transcriptions:transcribe";
    url.searchParams.set("api-version", "2025-10-15");
    return url.toString();
  }
  url.pathname = url.pathname.replace(/\/+$/, "") +
    (endpointType === "whisper-cpp" ? "/inference" : "/audio/transcriptions");
  return url.toString();
}

// speechDraft appends the transcript to whatever is already in the box and
// reports whether the user spoke a send phrase ("over"), which copies & closes.
export function speechDraft(base, transcript, final, sendPhrase = "over, オーバー", _afterSilence = false, normalized = false) {
  const phrases = sendPhrase.split(/[,、\n]/).map((phrase) => phrase.trim())
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const pattern = phrases.map((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-based scripts need a Unicode boundary (e.g. terminé must not
    // match the end of indéterminé). Scripts commonly written without spaces
    // still allow a command immediately after the dictated text.
    const unspaced = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u.test(phrase);
    return (!unspaced && /^[\p{L}\p{N}_]/u.test(phrase) ? "(?<![\\p{L}\\p{N}\\p{M}_])" : "") + escaped;
  }).join("|");
  const command = pattern ? new RegExp(`(?:${pattern})[\\s。．.!！?？、,،؛؟।॥]*$`, "iu") : null;
  const send = final && !!command && command.test(transcript);
  let spoken = send && command ? transcript.replace(command, "").trimEnd() : transcript;
  if (final && !normalized) spoken = convertSpokenSymbol(spoken, !send);
  return {
    text: base + (base && spoken && !/\s$/.test(base) && !/^[\s,.?!、。？！]/.test(spoken) ? " " : "") + spoken,
    send
  };
}

// Only the explicit question command is converted, after recognition is final.
// Preserve punctuation produced by the recognizer, including trailing 。 and 、.
export function convertSpokenSymbol(text, commands = true) {
  if (!commands) return text;
  const match = /(?:クエスチョン(?:マーク)?|(?<![\p{L}\p{N}_])question(?:\s+mark)?)[\s。．.!！?？、,]*$/iu.exec(text);
  return match ? text.slice(0, match.index).replace(/[。．. 	　]+$/, "") + "?" : text;
}

// 16 kHz mono PCM WAV also works with servers that cannot decode WebM/Opus.
export function encodeSpeechWav(samples) {
  const bytes = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return new Blob([bytes], { type: "audio/wav" });
}

// recordingToWav decodes one MediaRecorder clip and re-renders it as 16 kHz
// mono, the one format every supported STT service accepts.
export async function recordingToWav(blob) {
  const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
  if (!decoded.length || decoded.duration > MAX_SECONDS + 1) {
    throw new Error(t("録音は5分以内にしてください。"));
  }
  const renderer = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = renderer.createBufferSource();
  source.buffer = decoded;
  source.connect(renderer.destination);
  source.start();
  const mono = await renderer.startRendering();
  return encodeSpeechWav(mono.getChannelData(0));
}

// Join PCM payloads, not complete WAV files with separate container headers.
export async function combineSpeechWavs(wavs) {
  const buffers = await Promise.all(wavs.map((wav) => wav.arrayBuffer()));
  const size = buffers.reduce((total, buffer) => total + buffer.byteLength - WAV_HEADER_BYTES, 0);
  if (!buffers.length || size <= 0) throw new Error(t("録音が空です。"));
  if (size > SAMPLE_RATE * 2 * (MAX_SECONDS + 1)) {
    throw new Error(t("保持分を含めた録音は5分以内にしてください。"));
  }
  const result = new Uint8Array(WAV_HEADER_BYTES + size);
  result.set(new Uint8Array(buffers[0], 0, WAV_HEADER_BYTES));
  let offset = WAV_HEADER_BYTES;
  for (const buffer of buffers) {
    const pcm = new Uint8Array(buffer, WAV_HEADER_BYTES);
    result.set(pcm, offset);
    offset += pcm.length;
  }
  const header = new DataView(result.buffer);
  header.setUint32(4, result.byteLength - 8, true);
  header.setUint32(40, size, true);
  return new Blob([result], { type: "audio/wav" });
}

export async function recordingsToWav(clips, signal) {
  const wavs = [];
  for (const clip of clips) {
    signal.throwIfAborted();
    wavs.push(await recordingToWav(clip));
  }
  signal.throwIfAborted();
  return combineSpeechWavs(wavs);
}

// validateSpeechSettings rejects a configuration before the microphone is
// opened, and returns the endpoint URL the request will use.
export function validateSpeechSettings(settings) {
  const url = transcriptionURL(settings.baseUrl, settings.endpointType, settings.vertexProjectId ?? "");
  if (settings.endpointType === "azure-mai-transcribe" && !settings.apiKey.trim()) {
    throw new Error(t("Azure MAI Transcribe の API Key を設定してください。"));
  }
  if (settings.endpointType === "azure-mai-transcribe") {
    const language = settings.language.trim();
    if (language && language.toLowerCase() !== "auto" && !/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(language)) {
      throw new Error(t("言語は auto か BCP-47 (ja / en-US など) で指定してください。"));
    }
  }
  if (isGoogleEndpoint(settings.endpointType)) {
    if (settings.endpointType === "gemini-transcribe" && !settings.apiKey.trim()) {
      throw new Error(t("Gemini API の API Key を設定してください。"));
    }
    const language = settings.language.trim();
    if (language && language.toLowerCase() !== "auto" && !/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(language)) {
      throw new Error(t("言語は auto か BCP-47 (ja / en-US など) で指定してください。"));
    }
  } else if (settings.endpointType !== "whisper-cpp" && !settings.model.trim()) {
    throw new Error(t("STT の Model を設定してください。"));
  }
  return url;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function geminiTranscript(result) {
  const invalid = () => new Error(t("STT の応答を解釈できません。"));
  if (!result || typeof result !== "object" || Array.isArray(result) || "error" in result) throw invalid();
  if (result.promptFeedback && typeof result.promptFeedback === "object" && "blockReason" in result.promptFeedback) {
    throw new Error(t("音声がモデルにブロックされました。"));
  }
  if (!Array.isArray(result.candidates) || !result.candidates.length) throw invalid();
  const candidate = result.candidates[0];
  if (!candidate || typeof candidate !== "object") throw invalid();
  // Never insert a partial transcript (including a partial send command).
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(t("認識結果が途中で打ち切られました。もう一度お試しください。"));
  }
  const parts = candidate.content?.parts;
  if (parts === undefined && candidate.finishReason === "STOP") return "";
  if (!Array.isArray(parts)) throw invalid();
  return parts.map((part) => {
    if (!part || typeof part !== "object") throw invalid();
    if (part.thought === true) return "";
    if (typeof part.text !== "string") throw invalid();
    return part.text;
  }).join("").trim();
}

// transcribeSpeech POSTs the recording through transport (the Go HTTP proxy,
// so no CORS preflight ever carries the API key) and returns the transcript.
export async function transcribeSpeech(audio, settings, transport, signal) {
  signal.throwIfAborted();
  const url = validateSpeechSettings(settings);
  const google = isGoogleEndpoint(settings.endpointType);
  const azure = settings.endpointType === "azure-mai-transcribe";
  const native = settings.endpointType === "whisper-cpp";
  if (!audio.size) throw new Error(t("録音が空です。"));
  let headers;
  let bodyBase64;
  if (google) {
    if (audio.size <= WAV_HEADER_BYTES) throw new Error(t("録音が空です。"));
    if (audio.size > WAV_HEADER_BYTES + (MAX_SECONDS + 1) * SAMPLE_RATE * 2) {
      throw new Error(t("録音は5分以内にしてください。"));
    }
    const language = settings.language.trim();
    const languageCodes = !language || language.toLowerCase() === "auto"
      ? []
      : [language === "ja" ? "ja-JP" : language === "en" ? "en-US" : language];
    const body = JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          inlineData: {
            mimeType: "audio/wav",
            data: bytesToBase64(new Uint8Array(await audio.arrayBuffer()))
          }
        }]
      }],
      generationConfig: { audioTranscriptionConfig: { languageCodes } }
    });
    headers = { "Content-Type": "application/json" };
    if (settings.endpointType === "gemini-transcribe") {
      headers["x-goog-api-key"] = settings.apiKey.trim();
    }
    bodyBase64 = bytesToBase64(new TextEncoder().encode(body));
  } else {
    const form = new FormData();
    form.append(azure ? "audio" : "file", audio, "recording.wav");
    if (!native && !azure) form.append("model", settings.model.trim());
    if (native) form.append("response_format", "json");
    const language = settings.language.trim();
    if (azure) {
      const definition = { enhancedMode: { enabled: true, model: settings.model.trim() } };
      if (language && language.toLowerCase() !== "auto") definition.locales = [language];
      form.append("definition", JSON.stringify(definition));
    } else if (native) {
      form.append("language", language && language.toLowerCase() !== "auto" ? language : "auto");
    } else if (language && language.toLowerCase() !== "auto") {
      form.append("language", language);
    }
    // Request() does the multipart serialization, boundary included.
    const request = new Request(url, { method: "POST", body: form });
    bodyBase64 = bytesToBase64(new Uint8Array(await request.arrayBuffer()));
    headers = { "Content-Type": request.headers.get("content-type") };
    if (azure) headers["Ocp-Apim-Subscription-Key"] = settings.apiKey.trim();
    else if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }
  signal.throwIfAborted();
  const response = await transport({ url, method: "POST", headers, bodyBase64 });
  signal.throwIfAborted();
  // Never echo server error bodies, which may contain credentials or the
  // recorded text itself.
  if (response.status < 200 || response.status >= 300) {
    if (azure && response.status === 400) {
      // Azure uses a top-level code/message for unavailable enhanced mode.
      // Match the known response but never expose arbitrary response content.
      let error;
      try { error = JSON.parse(response.body); } catch { /* use the generic error */ }
      error = error?.error ?? error;
      if (error?.code === "InvalidRequest" &&
          error.message === "Enhanced mode with model is currently not supported yet.") {
        throw new Error(`STT HTTP 400: ${t("このAzureエンドポイントでは MAI Transcribe が利用できません。対応リージョンのリソースを作成し、そのエンドポイントと API Key を設定してください。")}`);
      }
    }
    const reason = response.status === 401 || response.status === 403
      ? t("API Key とサーバーの認証設定を確認してください。")
      : t("Base URL・Model・サーバーの対応形式を確認してください。");
    throw new Error(`STT HTTP ${response.status}: ${reason}`);
  }
  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new Error(t("STT の応答が JSON ではありません。"));
  }
  if (google) return geminiTranscript(result);
  if (azure) {
    if (!result || typeof result !== "object" || "error" in result ||
        !Array.isArray(result.combinedPhrases) ||
        result.combinedPhrases.some((phrase) => !phrase || typeof phrase.text !== "string")) {
      throw new Error(t("STT の応答を解釈できません。"));
    }
    return result.combinedPhrases.map((phrase) => phrase.text.trim()).filter(Boolean).join(" ");
  }
  if (!result || typeof result !== "object" || typeof result.text !== "string") {
    throw new Error(t("STT の応答に text フィールドがありません。"));
  }
  const text = result.text.trim();
  return /^\[BLANK_AUDIO\]$/i.test(text) ? "" : text;
}
