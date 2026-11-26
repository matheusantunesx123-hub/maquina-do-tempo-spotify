(function (global) {
  "use strict";

  const STORAGE_KEY = "stm_access_code_v1";
  const FRIEND_NAME_KEY = "stm_friend_name_v1";
  const DEFAULT_WORKER_URL = "https://spotify-amigos-auth.bot-gastos-telegram.workers.dev";

  const AccessControl = {
    getWorkerUrl() {
      if (global.SpotifyAppConfig && global.SpotifyAppConfig.authWorkerUrl) {
        return global.SpotifyAppConfig.authWorkerUrl.replace(/\/+$/, "");
      }
      return DEFAULT_WORKER_URL;
    },

    getStoredCode() {
      try {
        return (localStorage.getItem(STORAGE_KEY) || "").trim().toUpperCase();
      } catch (_) {
        return "";
      }
    },

    getStoredFriendName() {
      try {
        return (localStorage.getItem(FRIEND_NAME_KEY) || "").trim();
      } catch (_) {
        return "";
      }
    },

    saveSession(code, friendName) {
      try {
        if (code) localStorage.setItem(STORAGE_KEY, code.trim().toUpperCase());
        if (friendName) localStorage.setItem(FRIEND_NAME_KEY, friendName.trim());
      } catch (_) {}
    },

    clearSession() {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(FRIEND_NAME_KEY);
      } catch (_) {}
    },

    resolveUrlCode() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = (params.get("key") || params.get("code") || params.get("senha") || "").trim().toUpperCase();
        if (code) {
          // Limpa da URL para ficar visualmente limpo sem recarregar
          params.delete("key");
          params.delete("code");
          params.delete("senha");
          const cleanSearch = params.toString();
          const cleanUrl =
            window.location.pathname +
            (cleanSearch ? "?" + cleanSearch : "") +
            (window.location.hash || "");
          window.history.replaceState({}, "", cleanUrl);
          return code;
        }
      } catch (_) {}
      return "";
    },

    async verifyCode(rawCode, usernameQueried) {
      const code = String(rawCode || "").trim().toUpperCase();
      if (!code) {
        return { valid: false, reason: "EMPTY", message: "Digite sua chave de acesso." };
      }

      const url = `${this.getWorkerUrl()}/api/verify`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, username: usernameQueried || null })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.valid) {
          this.saveSession(code, data.friend_name);
          return {
            valid: true,
            code: data.code,
            friendName: data.friend_name,
            useCount: data.use_count
          };
        }
        return {
          valid: false,
          reason: data.reason || "INVALID",
          message: data.message || "Chave inválida ou bloqueada."
        };
      } catch (err) {
        // Se a API estiver fora do ar temporariamente, não trava quem já tem a chave válida salva
        const stored = this.getStoredCode();
        if (stored && stored === code) {
          return {
            valid: true,
            code,
            friendName: this.getStoredFriendName() || "Amigo",
            offlineFallback: true
          };
        }
        return {
          valid: false,
          reason: "NETWORK_ERROR",
          message: "Não foi possível conectar ao servidor de validação. Verifique sua conexão."
        };
      }
    },

    async logQuery(username) {
      const code = this.getStoredCode();
      if (!code || !username) return;
      try {
        await fetch(`${this.getWorkerUrl()}/api/log-query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, username })
        });
      } catch (_) {}
    },

    // ==========================================
    // Funções Administrativas (Painel do Matheus)
    // ==========================================
    async adminList(masterKey) {
      const res = await fetch(`${this.getWorkerUrl()}/api/admin/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${masterKey.trim()}`
        },
        body: JSON.stringify({})
      });
      return await res.json();
    },

    async adminCreate(masterKey, friendName, customCode, maxUses) {
      const res = await fetch(`${this.getWorkerUrl()}/api/admin/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${masterKey.trim()}`
        },
        body: JSON.stringify({
          friend_name: friendName,
          code: customCode || null,
          max_uses: maxUses || null
        })
      });
      return await res.json();
    },

    async adminToggle(masterKey, id, status) {
      const res = await fetch(`${this.getWorkerUrl()}/api/admin/toggle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${masterKey.trim()}`
        },
        body: JSON.stringify({ id, status })
      });
      return await res.json();
    },

    async adminDelete(masterKey, id) {
      const res = await fetch(`${this.getWorkerUrl()}/api/admin/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${masterKey.trim()}`
        },
        body: JSON.stringify({ id })
      });
      return await res.json();
    }
  };

  global.SpotifyAccessControl = AccessControl;
})(window);
