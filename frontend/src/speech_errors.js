import { t } from "./i18n.js";

export function speechErrorMessage(caught) {
  // WebView media errors may be DOMExceptions or objects from another realm.
  // Inspect the name instead of relying on instanceof Error.
  switch (caught?.name) {
    case "NotAllowedError":
      return t("マイクの使用が許可されていません。");
    case "NotFoundError":
      return t("マイクが見つかりません。マイクを接続し、OSの入力設定で有効になっているか確認してください。");
    case "OverconstrainedError":
      return t("マイクが見つからないか、使用できません。マイクの接続とOSの入力設定を確認してください。");
    case "NotReadableError":
      return t("マイクを使用できません。他のアプリで使用中でないか、OSの入力設定を確認してください。");
    case "AbortError":
      return t("中断されました。");
    default:
      return caught?.message || caught?.name || String(caught);
  }
}
