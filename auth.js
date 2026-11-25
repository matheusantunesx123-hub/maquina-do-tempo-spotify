(function (global) {
  "use strict";

  const SESSION_KEY = "stm_friends_session_v1";
  const PKCE_VERIFIER_KEY = "stm_pkce_verifier_v1";
  const PKCE_STATE_KEY = "stm_pkce_state_v1";
  const PKCE_CLIENT_KEY = "stm_pkce_client_v1";
  const PKCE_REDIRECT_KEY = "stm_pkce_redirect_v1";

  function base64UrlEncode(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) {
      bin += String.fromCharCode(arr[i]);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function generateRandomString(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }

  async function sha256Base64Url(plain) {
    const data = new TextEncoder().encode(plain);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(digest));
  }

  async function buildAuthorizeUrl(clientId, options = {}) {
    const cleanId = String(clientId || "").trim();
    if (!cleanId) {
      throw new Error("Client ID do Spotify não informado.");
    }
    const cfg = global.SpotifyAppConfig;
    const redirectUri = options.redirectUri || cfg.getRedirectUri();
    const scopes = (options.scopes || cfg.scopes).join(" ");

    const codeVerifier = generateRandomString(48);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const state = generateRandomString(24);

    try {
      sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
      sessionStorage.setItem(PKCE_STATE_KEY, state);
      sessionStorage.setItem(PKCE_CLIENT_KEY, cleanId);
      sessionStorage.setItem(PKCE_REDIRECT_KEY, redirectUri);
    } catch (_) {}

    const params = new URLSearchParams({
      response_type: "code",
      client_id: cleanId,
      scope: scopes,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
      state,
      show_dialog: options.forceDialog ? "true" : "false"
    });

    return {
      url: "https://accounts.spotify.com/authorize?" + params.toString(),
      codeVerifier,
      codeChallenge,
      state,
      redirectUri
    };
  }

  async function startLogin(clientId, options = {}) {
    const { url } = await buildAuthorizeUrl(clientId, options);
    window.location.assign(url);
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.accessToken ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (_) {}
    return session;
  }

  function clearPkceTemp() {
    try {
      sessionStorage.removeItem(PKCE_VERIFIER_KEY);
      sessionStorage.removeItem(PKCE_STATE_KEY);
      sessionStorage.removeItem(PKCE_CLIENT_KEY);
      sessionStorage.removeItem(PKCE_REDIRECT_KEY);
    } catch (_) {}
  }

  function cleanUrlParams() {
    const url = new URL(window.location.href);
    ["code", "state", "error", "error_description"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }

  async function handleCallbackIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (err) {
      cleanUrlParams();
      clearPkceTemp();
      return {
        status: "error",
        message: err === "access_denied"
          ? "Autorização cancelada no Spotify."
          : `Spotify retornou erro na autorização: ${err}`
      };
    }

    if (!code) {
      return { status: "idle" };
    }

    const expectedState = sessionStorage.getItem(PKCE_STATE_KEY);
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    const clientId = sessionStorage.getItem(PKCE_CLIENT_KEY) || global.SpotifyAppConfig.resolveClientId();
    const redirectUri = sessionStorage.getItem(PKCE_REDIRECT_KEY) || global.SpotifyAppConfig.getRedirectUri();

    cleanUrlParams();

    if (!verifier || !clientId || (expectedState && state !== expectedState)) {
      clearPkceTemp();
      return {
        status: "error",
        message: "Sessão OAuth PKCE expirada ou inválida. Clique em Entrar com Spotify novamente."
      };
    }

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    clearPkceTemp();

    if (!response.ok) {
      const txt = await response.text();
      return {
        status: "error",
        message: `Falha ao trocar código por token (${response.status}): ${txt.slice(0, 220)}`
      };
    }

    const tokenData = await response.json();
    const session = saveSession({
      clientId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresAt: Date.now() + (Number(tokenData.expires_in || 3600) * 1000)
    });

    return { status: "authenticated", session };
  }

  async function refreshSession(session) {
    if (!session || !session.refreshToken || !session.clientId) return null;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: session.clientId
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) return null;
    const data = await res.json();
    return saveSession({
      clientId: session.clientId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000)
    });
  }

  async function getValidAccessToken() {
    const session = getSession();
    if (!session) return null;
    if (Date.now() < (session.expiresAt || 0) - 90000) {
      return session.accessToken;
    }
    const refreshed = await refreshSession(session);
    if (refreshed && refreshed.accessToken) {
      return refreshed.accessToken;
    }
    return null;
  }

  async function spotifyFetchJson(endpoint, token) {
    const res = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 403) {
      const err = new Error("Usuário sem permissão no app em Development Mode.");
      err.code = "ALLOWLIST_403";
      throw err;
    }
    if (res.status === 401) {
      const err = new Error("Sessão do Spotify expirada.");
      err.code = "UNAUTHORIZED_401";
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Spotify API retornou HTTP ${res.status} em /${endpoint}`);
    }
    return res.json();
  }

  function logout() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    clearPkceTemp();
  }

  global.SpotifyAuth = {
    buildAuthorizeUrl,
    startLogin,
    handleCallbackIfPresent,
    getSession,
    getValidAccessToken,
    spotifyFetchJson,
    logout
  };
})(window);
