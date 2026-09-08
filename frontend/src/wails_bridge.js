// Compatibility adapter between the frontend and Wails v3's module-based
// runtime. Keeping the small surface here avoids coupling the UI to generated
// numeric binding IDs.
import { Call, Events } from "/wails/runtime.js";

const call = (method, ...args) => Call.ByName(`main.App.${method}`, ...args);

globalThis.window.go = {
  main: {
    App: {
      CopyToClipboard: (text) => call("CopyToClipboard", text),
      GetAppInfo: () => call("GetAppInfo"),
      SetUILanguage: (language) => call("SetUILanguage", language),
      HidePopup: () => call("HidePopup"),
      IsVisible: () => call("IsVisible"),
      LoadConfig: () => call("LoadConfig"),
      LoadHistory: () => call("LoadHistory"),
      NotifyReady: () => call("NotifyReady"),
      ReadClipboard: () => call("ReadClipboard"),
      SaveConfig: (view) => call("SaveConfig", view),
      SaveHistory: (data) => call("SaveHistory", data),
      SetOverlayOpen: (open) => call("SetOverlayOpen", open),
      ResizePopup: (height) => call("ResizePopup", height),
      ShowPopup: () => call("ShowPopup"),
      SpeechHTTPRequest: (request) => call("SpeechHTTPRequest", request),
      TogglePopup: () => call("TogglePopup"),
      VertexSpeechHTTPRequest: (request) => call("VertexSpeechHTTPRequest", request),
      SelectVertexOAuthClient: () => call("SelectVertexOAuthClient"),
      ConnectVertexOAuth: (clientId, clientSecret, projectId) => call("ConnectVertexOAuth", clientId, clientSecret, projectId),
      GetVertexOAuthStatus: () => call("GetVertexOAuthStatus"),
      DisconnectVertexOAuth: () => call("DisconnectVertexOAuth")
    }
  }
};

globalThis.window.runtime = {
  EventsOn: (name, callback) => Events.On(name, (event) => callback(event.data))
};
