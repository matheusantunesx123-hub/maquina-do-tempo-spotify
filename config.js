(function (global) {
  "use strict";

  const STORAGE_KEY = "stm_friends_client_id_v1";

  const config = {
    // Cole aqui o Client ID do seu App no Spotify Developer Dashboard para já deixar pré-configurado para todos os amigos.
    defaultClientId: "",
    scopes: [
      "user-read-private",
      "user-top-read",
      "user-read-recently-played"
    ],
    STORAGE_KEY,

    getRedirectUri() {
      const origin = window.location.origin;
      let path = window.location.pathname || "/";
      if (path.endsWith("/index.html")) {
        path = path.slice(0, -("index.html".length));
      }
      return origin + path;
    },

    resolveClientId() {
      try {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = (params.get("client_id") || "").trim();
        if (fromUrl && /^[a-zA-Z0-9]{16,64}$/.test(fromUrl)) {
          localStorage.setItem(STORAGE_KEY, fromUrl);
          params.delete("client_id");
          const cleanSearch = params.toString();
          const cleanUrl =
            window.location.pathname +
            (cleanSearch ? "?" + cleanSearch : "") +
            (window.location.hash || "");
          window.history.replaceState({}, "", cleanUrl);
          return fromUrl;
        }
      } catch (_) {}

      if (this.defaultClientId && this.defaultClientId.trim()) {
        return this.defaultClientId.trim();
      }

      try {
        return (localStorage.getItem(STORAGE_KEY) || "").trim();
      } catch (_) {
        return "";
      }
    },

    saveCustomClientId(clientId) {
      const cleaned = String(clientId || "").trim();
      try {
        if (cleaned) {
          localStorage.setItem(STORAGE_KEY, cleaned);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (_) {}
      return cleaned;
    }
  };

  global.SpotifyAppConfig = config;
})(window);
