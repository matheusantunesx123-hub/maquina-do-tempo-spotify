(function () {
  "use strict";

  const LAST_OPEN_SESSION_KEY = "stm_friends_last_open_v1";
  const SYNC_POLL_INTERVAL_SEC = 25;
  const SYNC_POLL_MAX_CYCLES = 12;

  const state = {
    clientId: "",
    lastfmApiKey: "",
    openProvider: "listenbrainz",
    bundle: null,
    activeReportId: null,
    activeReport: null,
    tracksExpanded: false,
    artistsExpanded: false,
    selectedDay: null,
    exportFormat: "story",
    carouselRatio: "feed",
    exportMode: "poster",
    exportTheme: "prensa",
    carouselSlideIdx: 0,
    handle: "@meu_spotify",
    showMetrics: true,
    renderToken: 0,
    syncPollTimer: null,
    syncPollRemaining: 0,
    syncPollCycles: 0,
    syncPollTarget: null,
    shareFeedbackTimer: null
  };

  const els = {};

  function qs(id) {
    return document.getElementById(id);
  }

  function fmtNum(v) {
    return Number(v || 0).toLocaleString("pt-BR");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initialsOf(name) {
    return (name || "S")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] || "")
      .join("")
      .toUpperCase() || "S";
  }

  function createCoverImage(url, altText, fallbackLabel) {
    const wrap = document.createElement("div");
    if (url) {
      const img = document.createElement("img");
      img.crossOrigin = "anonymous";
      img.loading = "eager";
      img.decoding = "async";
      img.alt = altText || fallbackLabel || "Capa";
      img.src = url;
      img.addEventListener("error", () => {
        wrap.innerHTML = "";
        const fb = document.createElement("div");
        fb.className = "cover-fallback";
        fb.textContent = initialsOf(fallbackLabel);
        wrap.appendChild(fb);
      });
      wrap.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className = "cover-fallback";
      fb.textContent = initialsOf(fallbackLabel);
      wrap.appendChild(fb);
    }
    return wrap;
  }

  function setStatusBanner(title, detail, isInfo) {
    if (!title && !detail) {
      els.statusBanner.innerHTML = "";
      return;
    }
    els.statusBanner.innerHTML = `
      <div class="status-alert${isInfo ? " is-info" : ""}">
        ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      </div>
    `;
  }

  function refreshConfigUI() {
    state.clientId = window.SpotifyAppConfig.resolveClientId();
    state.lastfmApiKey = window.SpotifyAppConfig.resolveLastfmApiKey();
    els.inputRedirectUri.value = window.SpotifyAppConfig.getRedirectUri();
    els.inputClientId.value = state.clientId;
    els.inputLastfmKey.value = state.lastfmApiKey;

    if (state.clientId) {
      els.clientIdStatus.textContent = "Client ID ativo";
      els.clientIdStatus.className = "mono-badge";
    } else {
      els.clientIdStatus.textContent = "Aguardando Client ID";
      els.clientIdStatus.className = "mono-badge amber";
    }

    syncProviderFormUI();
  }

  function parseUserInput(raw, fallbackProvider) {
    const trimmed = String(raw || "").trim();
    const baseProvider = fallbackProvider === "lastfm" ? "lastfm" : "listenbrainz";
    const lbMatch = trimmed.match(/listenbrainz\.org\/user\/([^/?#]+)/i);
    if (lbMatch && lbMatch[1]) {
      let u = lbMatch[1];
      try { u = decodeURIComponent(u); } catch (_) {}
      return {
        username: u.trim().replace(/^@+/, "").replace(/\/+$/, ""),
        provider: "listenbrainz",
        detectedFromUrl: true
      };
    }
    const lfmMatch = trimmed.match(/last(?:\.fm|fm\.com)(?:\/[a-z]{2})?\/user\/([^/?#]+)/i);
    if (lfmMatch && lfmMatch[1]) {
      let u = lfmMatch[1];
      try { u = decodeURIComponent(u); } catch (_) {}
      return {
        username: u.trim().replace(/^@+/, "").replace(/\/+$/, ""),
        provider: "lastfm",
        detectedFromUrl: true
      };
    }
    return {
      username: trimmed.replace(/^@+/, "").replace(/\/+$/, ""),
      provider: baseProvider,
      detectedFromUrl: false
    };
  }

  function saveLastOpenSession(provider, username) {
    try {
      localStorage.setItem(LAST_OPEN_SESSION_KEY, JSON.stringify({ provider, username }));
    } catch (_) {}
  }

  function loadLastOpenSession() {
    try {
      const raw = localStorage.getItem(LAST_OPEN_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.username) {
        return {
          provider: parsed.provider === "lastfm" ? "lastfm" : "listenbrainz",
          username: String(parsed.username).trim()
        };
      }
    } catch (_) {}
    return null;
  }

  function clearLastOpenSession() {
    try {
      localStorage.removeItem(LAST_OPEN_SESSION_KEY);
    } catch (_) {}
  }

  function clearUrlQueryParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      ["u", "user", "p", "provider", "m", "month"].forEach((k) => params.delete(k));
      const cleanSearch = params.toString();
      const nextUrl =
        window.location.pathname +
        (cleanSearch ? "?" + cleanSearch : "") +
        (window.location.hash || "");
      window.history.replaceState({}, "", nextUrl);
    } catch (_) {}
  }

  function triggerInputShake(el) {
    if (!el) return;
    el.classList.remove("input-shake");
    void el.offsetWidth;
    el.classList.add("input-shake");
    setTimeout(() => el.classList.remove("input-shake"), 420);
  }

  function stopSyncPolling() {
    if (state.syncPollTimer) {
      clearInterval(state.syncPollTimer);
      state.syncPollTimer = null;
    }
    state.syncPollRemaining = 0;
    state.syncPollCycles = 0;
    state.syncPollTarget = null;
    if (els.syncWaitBox) els.syncWaitBox.hidden = true;
  }

  function startSyncPolling(provider, username, monthOpt, cycleCount) {
    stopSyncPolling();
    const cycle = Math.max(1, Number(cycleCount) || 1);
    if (cycle > SYNC_POLL_MAX_CYCLES) {
      els.syncWaitBox.hidden = false;
      els.syncWaitTimer.textContent =
        "A sincronização inicial ainda não apareceu. Clique em \"Verificar agora\" quando o Spotify concluir no ListenBrainz.";
      return;
    }

    state.syncPollTarget = { provider, username, monthOpt };
    state.syncPollCycles = cycle;
    state.syncPollRemaining = SYNC_POLL_INTERVAL_SEC;
    els.syncWaitBox.hidden = false;
    els.syncWaitTimer.textContent = `Nova verificação automática em ${state.syncPollRemaining}s (tentativa ${cycle}/${SYNC_POLL_MAX_CYCLES})…`;

    state.syncPollTimer = setInterval(async () => {
      state.syncPollRemaining -= 1;
      if (state.syncPollRemaining > 0) {
        els.syncWaitTimer.textContent = `Nova verificação automática em ${state.syncPollRemaining}s (tentativa ${cycle}/${SYNC_POLL_MAX_CYCLES})…`;
        return;
      }

      clearInterval(state.syncPollTimer);
      state.syncPollTimer = null;
      els.syncWaitTimer.textContent = "Verificando novamente no ListenBrainz…";

      const target = state.syncPollTarget;
      await loadOpenProvider(target.provider, target.username, target.monthOpt, {
        fromPoll: true,
        nextCycle: cycle + 1
      });
    }, 1000);
  }

  function syncProviderFormUI() {
    const isLastfm = state.openProvider === "lastfm";
    
    // Eventos de Chave de Acesso
    if (els.btnValidateKey) {
      els.btnValidateKey.addEventListener("click", () => handleKeyValidation());
    }
    if (els.inputAccessKey) {
      els.inputAccessKey.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleKeyValidation();
        }
      });
    }
    if (els.btnChangeAccessKey) {
      els.btnChangeAccessKey.addEventListener("click", () => {
        window.SpotifyAccessControl.clearSession();
        renderAccessState();
        if (els.inputAccessKey) {
          els.inputAccessKey.value = "";
          els.inputAccessKey.focus();
        }
      });
    }

    // Eventos do Modal Admin
    if (els.btnOpenAdmin) {
      els.btnOpenAdmin.addEventListener("click", openAdminModal);
    }
    if (els.btnCloseAdmin) {
      els.btnCloseAdmin.addEventListener("click", closeAdminModal);
    }
    if (els.btnAdminLogin) {
      els.btnAdminLogin.addEventListener("click", handleAdminLogin);
    }
    if (els.adminMasterInput) {
      els.adminMasterInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAdminLogin();
        }
      });
    }
    if (els.btnRefreshAdmin) {
      els.btnRefreshAdmin.addEventListener("click", refreshAdminData);
    }
    if (els.adminCreateForm) {
      els.adminCreateForm.addEventListener("submit", handleAdminCreateKey);
    }

    els.providerTabs.querySelectorAll("[data-provider]").forEach((btn) => {
      const active = btn.dataset.provider === state.openProvider;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    els.btnToggleLastfmKey.hidden = !isLastfm;
    if (!isLastfm) {
      els.lastfmKeyDrawer.hidden = true;
      els.inputOpenUsername.placeholder = "Ex.: seunome ou listenbrainz.org/user/seunome";
      els.providerHint.innerHTML =
        `Dica: depois de conectar no <a href="https://listenbrainz.org/settings/music-services/details/" target="_blank" rel="noopener noreferrer">ListenBrainz</a>, seu histórico mensal fica salvo para voltar sempre que quiser.`;
    } else {
      els.inputOpenUsername.placeholder = "Ex.: seunome ou last.fm/user/seunome";
      if (!state.lastfmApiKey) {
        els.lastfmKeyDrawer.hidden = false;
      }
      els.providerHint.innerHTML =
        `Conecte seu Spotify no Last.fm em <a href="https://www.last.fm/settings/applications" target="_blank" rel="noopener noreferrer">last.fm/settings/applications</a> (100% gratuito e ilimitado).`;
    }
  }

  function showWelcomeScreen() {
    els.welcomeScreen.hidden = false;
    els.dashboardRoot.hidden = true;
    els.headerProfile.hidden = true;
    els.btnCopyShareLink.hidden = true;
    els.btnRefreshData.hidden = true;
    els.btnSwitchSource.hidden = true;
    els.btnLogout.hidden = true;
    els.btnJumpStudio.hidden = true;
  }

  function showDashboard(bundle) {
    stopSyncPolling();
    state.bundle = bundle;
    els.welcomeScreen.hidden = true;
    els.dashboardRoot.hidden = false;
    els.btnSwitchSource.hidden = false;
    els.btnJumpStudio.hidden = false;

    const isApi = bundle.mode === "spotify_api";
    const isOpen = bundle.mode === "listenbrainz" || bundle.mode === "lastfm";
    els.btnCopyShareLink.hidden = !isOpen;
    els.btnRefreshData.hidden = !(isApi || isOpen);
    els.btnLogout.hidden = !isApi;
    els.btnExportBackup.hidden = !isApi;
    els.monthTravelWrap.hidden = !bundle.canPickAnyMonth;

    const prof = bundle.profile || { display_name: "Amigo", handle: "@meu_spotify" };
    els.headerProfile.hidden = false;
    els.headerName.textContent = prof.display_name || "Amigo";
    els.headerAvatar.innerHTML = "";
    if (prof.image) {
      const av = createCoverImage(prof.image, prof.display_name, prof.display_name);
      while (av.firstChild) els.headerAvatar.appendChild(av.firstChild);
    } else {
      els.headerAvatar.textContent = initialsOf(prof.display_name);
    }

    if (prof.handle) {
      state.handle = prof.handle;
      els.inputHandle.value = prof.handle;
    }

    selectReport(bundle.defaultId);
  }

  function renderTimelineBar() {
    const bundle = state.bundle;
    if (!bundle) return;

    if (bundle.mode === "spotify_api") {
      els.sourceModeTag.textContent = "SPOTIFY API · AO VIVO";
      const vs = bundle.vaultStats || {};
      els.archiveStats.textContent =
        `${vs.monthsSaved || 1} mês(es) salvo(s) neste aparelho · ${vs.recentCachedThisMonth || 0} plays recentes`;
    } else if (bundle.mode === "listenbrainz") {
      els.sourceModeTag.textContent = "LISTENBRAINZ · ILIMITADO";
      const at = bundle.allTime;
      els.archiveStats.textContent =
        `@${bundle.providerUsername} · ${fmtNum(at.total_plays)} reproduções · ${at.months_count} mês(es)`;
    } else if (bundle.mode === "lastfm") {
      els.sourceModeTag.textContent = "LAST.FM · ILIMITADO";
      const at = bundle.allTime;
      els.archiveStats.textContent =
        `@${bundle.providerUsername} · ${fmtNum(at.total_plays)} scrobbles · ${at.months_count} mês(es)`;
    } else if (bundle.isDemo) {
      els.sourceModeTag.textContent = "MODO DEMONSTRAÇÃO";
      const at = bundle.allTime;
      els.archiveStats.textContent =
        `${fmtNum(at.total_plays)} reproduções · ${fmtNum(at.total_minutes)} min (${at.total_hours} h) · ${at.months_count} meses`;
    } else {
      els.sourceModeTag.textContent = "HISTÓRICO IMPORTADO";
      const at = bundle.allTime;
      els.archiveStats.textContent =
        `${fmtNum(at.total_plays)} reproduções reais · ${fmtNum(at.total_minutes)} min (${at.total_hours} h) · ${at.months_count} meses`;
    }

    els.monthPills.innerHTML = "";
    bundle.tabs.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `month-pill${t.id === state.activeReportId ? " is-active" : ""}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", t.id === state.activeReportId ? "true" : "false");
      btn.dataset.reportId = t.id;

      const lbl = document.createElement("span");
      lbl.className = "month-pill-label";
      lbl.textContent = t.label;

      const meta = document.createElement("span");
      meta.className = "month-pill-meta";
      meta.textContent = t.meta;

      btn.append(lbl, meta);
      btn.addEventListener("click", () => selectReport(t.id));
      els.monthPills.appendChild(btn);
    });

    const idx = bundle.tabs.findIndex((t) => t.id === state.activeReportId);
    els.btnPrevMonth.disabled = idx < 0 || idx >= bundle.tabs.length - 1;
    els.btnNextMonth.disabled = idx <= 0;
  }

  function renderSpotlightCard(cardEl, kicker, title, meta, imgUrl, spotifyUrl) {
    const mediaBox = cardEl.querySelector(".spotlight-media");
    const bodyBox = cardEl.querySelector(".spotlight-body");
    mediaBox.innerHTML = "";
    const wrapped = createCoverImage(imgUrl, title, title);
    while (wrapped.firstChild) mediaBox.appendChild(wrapped.firstChild);

    bodyBox.innerHTML = `
      <span class="spotlight-kicker">${escapeHtml(kicker)}</span>
      <h2 class="spotlight-name" title="${escapeHtml(title)}">${escapeHtml(title)}</h2>
      <p class="spotlight-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</p>
      ${spotifyUrl ? `<a class="spotlight-link" href="${escapeHtml(spotifyUrl)}" target="_blank" rel="noopener noreferrer">Ouvir</a>` : ""}
    `;
  }

  function formatDeltaBadge(rankDelta) {
    if (!rankDelta || rankDelta === "same") return { text: "•", cls: "same" };
    if (rankDelta === "new") return { text: "NOVO", cls: "new" };
    if (String(rankDelta).startsWith("+")) return { text: `▲ ${rankDelta.slice(1)}`, cls: "up" };
    return { text: `▼ ${String(rankDelta).replace("-", "")}`, cls: "down" };
  }

  function renderHero(report) {
    const s = report.summary;
    els.editionBadge.textContent = report.edition_tag || "CÁPSULA SONORA";
    els.personalityPill.textContent = s.personality_tag;
    els.coverageNote.textContent = report.hasExactCounts
      ? `${s.active_days || 0} dias ativos no mês`
      : `${s.unique_artists} artistas · ${s.unique_tracks} faixas analisadas`;
    els.monthTitle.textContent = report.label;
    els.personalitySubtitle.textContent = s.personality_subtitle;

    const a1 = (report.top_artists || [])[0];
    const t1 = (report.top_tracks || [])[0];

    renderSpotlightCard(
      els.spotlightArtist,
      "ARTISTA Nº 1",
      a1 ? a1.name : "—",
      a1
        ? (report.hasExactCounts
          ? `${fmtNum(a1.plays)} reproduções · ${fmtNum(a1.minutes)} min`
          : ((a1.genres && a1.genres.slice(0, 2).join(" · ")) || "Líder do período"))
        : "Sem registros",
      a1 && a1.image,
      a1 && a1.url
    );

    renderSpotlightCard(
      els.spotlightTrack,
      "MÚSICA Nº 1",
      t1 ? t1.name : "—",
      t1
        ? (report.hasExactCounts
          ? `${t1.artist_names} · ${fmtNum(t1.plays)} plays`
          : t1.artist_names)
        : "Sem registros",
      t1 && t1.album && t1.album.image,
      t1 && t1.url
    );

    if (report.hasExactCounts) {
      els.kpi1Label.textContent = report.isEstimatedMinutes ? "Minutos (est.)" : "Minutos ouvidos";
      els.kpi1Val.textContent = fmtNum(s.total_minutes);
      const d = s.delta_vs_prev;
      if (d && d.minutes_pct !== null) {
        const sign = d.minutes_pct >= 0 ? "+" : "";
        const cls = d.minutes_pct >= 0 ? "delta-pos" : "delta-neg";
        els.kpi1Sub.innerHTML = `${s.total_hours} h · <span class="${cls}">${sign}${d.minutes_pct}% vs. ${escapeHtml(d.prev_label)}</span>`;
      } else {
        els.kpi1Sub.textContent = `${s.total_hours} horas no mês`;
      }

      els.kpi2Label.textContent = "Reproduções reais";
      els.kpi2Val.textContent = fmtNum(s.total_plays);
      els.kpi2Sub.textContent = `Média de ${s.avg_minutes_per_active_day} min/dia ativo`;

      els.kpi3Label.textContent = "Artistas únicos";
      els.kpi3Val.textContent = fmtNum(s.unique_artists);
      els.kpi3Sub.textContent = d
        ? `${fmtNum(d.new_artists_count)} inéditos neste mês`
        : `${fmtNum(s.unique_tracks)} faixas · ${fmtNum(s.unique_albums)} álbuns`;

      const pd = s.peak_day || {};
      els.kpi4Label.textContent = pd.day ? "Dia mais musical" : "Hora de pico";
      els.kpi4Val.textContent = pd.day
        ? `${String(pd.day).padStart(2, "0")}/${String(report.month_number).padStart(2, "0")} (${pd.weekday_label})`
        : (s.peak_hour ? s.peak_hour.label : "—");
      els.kpi4Sub.textContent = pd.day
        ? `${fmtNum(pd.plays)} plays · ${fmtNum(pd.minutes)} min`
        : (s.peak_hour ? s.peak_hour.period : "—");
    } else {
      els.kpi1Label.textContent = "Gênero nº 1";
      els.kpi1Val.textContent = s.top_genre_label || "Mix";
      els.kpi1Sub.textContent = `${(report.top_genres || []).length} gêneros mapeados`;

      els.kpi2Label.textContent = "Artistas no Top";
      els.kpi2Val.textContent = fmtNum(s.unique_artists);
      els.kpi2Sub.textContent = `${fmtNum(s.unique_albums)} álbuns diferentes`;

      els.kpi3Label.textContent = "Descobertas";
      els.kpi3Val.textContent = fmtNum(s.discoveries_count ?? (report.new_discoveries || []).length);
      els.kpi3Sub.textContent = report.id === "short_term"
        ? "Fora do seu Top histórico"
        : "Artistas no topo do período";

      const ph = s.peak_hour || { label: "—", period: "Noite" };
      els.kpi4Label.textContent = "Hora de pico";
      els.kpi4Val.textContent = ph.label;
      els.kpi4Sub.textContent = s.recent_plays_count
        ? `${ph.period} (${s.recent_plays_count} plays recentes)`
        : "Baseado no histórico recente";
    }
  }

  function renderRankList(container, items, kind, hasExactCounts) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = `<li class="empty-note">Sem itens disponíveis neste período.</li>`;
      return;
    }
    const maxVal = Math.max(1, ...items.map((x) => (hasExactCounts ? x.plays || 1 : 21 - (x.rank || 1))));

    items.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = `rank-row${idx === 0 ? " is-top1" : ""}`;

      const posDiv = document.createElement("div");
      posDiv.className = "rank-pos";
      const numSpan = document.createElement("span");
      numSpan.className = "rank-num";
      numSpan.textContent = `${item.rank || idx + 1}`;
      posDiv.appendChild(numSpan);

      if (item.rank_delta !== null && item.rank_delta !== undefined) {
        const d = formatDeltaBadge(item.rank_delta);
        const dSpan = document.createElement("span");
        dSpan.className = `rank-delta ${d.cls}`;
        dSpan.textContent = d.text;
        posDiv.appendChild(dSpan);
      }

      const imgUrl = kind === "track" ? item.album && item.album.image : item.image;
      const coverBox = document.createElement("div");
      coverBox.className = "rank-cover";
      const coverInner = createCoverImage(imgUrl, item.name, item.name);
      while (coverInner.firstChild) coverBox.appendChild(coverInner.firstChild);

      const info = document.createElement("div");
      info.className = "rank-info";

      const titleEl = document.createElement(item.url ? "a" : "span");
      titleEl.className = "rank-title";
      titleEl.textContent = item.name;
      titleEl.title = item.name;
      if (item.url) {
        titleEl.href = item.url;
        titleEl.target = "_blank";
        titleEl.rel = "noopener noreferrer";
      }

      const subEl = document.createElement("span");
      subEl.className = "rank-sub";
      subEl.textContent = kind === "track"
        ? item.artist_names || ""
        : ((item.genres && item.genres.length) ? item.genres.slice(0, 2).join(" · ") : (item.top_track_name ? `Hit: ${item.top_track_name}` : "Artista"));

      const barTrack = document.createElement("div");
      barTrack.className = "rank-bar-track";
      const barFill = document.createElement("div");
      barFill.className = "rank-bar-fill";
      const val = hasExactCounts ? item.plays || 0 : 21 - (item.rank || idx + 1);
      barFill.style.width = `${Math.max(10, Math.round((val / maxVal) * 100))}%`;
      barTrack.appendChild(barFill);

      info.append(titleEl, subEl, barTrack);

      const metrics = document.createElement("div");
      metrics.className = "rank-metrics";
      if (hasExactCounts) {
        metrics.innerHTML = `<strong>${fmtNum(item.plays)}x</strong><span>${fmtNum(item.minutes)} min</span>`;
      } else {
        metrics.innerHTML = `<strong>#${item.rank || idx + 1}</strong><span>Spotify</span>`;
      }

      li.append(posDiv, coverBox, info, metrics);
      container.appendChild(li);
    });
  }

  function renderRankings(report) {
    els.rankingsNote.textContent = report.hasExactCounts
      ? "Ordenado por reproduções reais registradas no período."
      : "Ranking ordenado por escuta no período.";

    const tLimit = state.tracksExpanded ? 20 : 5;
    const aLimit = state.artistsExpanded ? 20 : 5;
    els.btnToggleTracks.textContent = state.tracksExpanded ? "Recolher Top 5" : "Mostrar Top 20";
    els.btnToggleArtists.textContent = state.artistsExpanded ? "Recolher Top 5" : "Mostrar Top 20";
    els.btnToggleTracks.setAttribute("aria-expanded", String(state.tracksExpanded));
    els.btnToggleArtists.setAttribute("aria-expanded", String(state.artistsExpanded));

    renderRankList(els.topTracksList, (report.top_tracks || []).slice(0, tLimit), "track", report.hasExactCounts);
    renderRankList(els.topArtistsList, (report.top_artists || []).slice(0, aLimit), "artist", report.hasExactCounts);
  }

  function renderCuradoria(report) {
    const obs = report.obsession || {};
    els.obsessionBadge.textContent = obs.plays
      ? `${obs.plays} plays`
      : (obs.recent_plays ? `${obs.recent_plays}x recente` : "#1 do período");
    els.obsessionContent.innerHTML = "";
    const obsCover = document.createElement("div");
    obsCover.className = "obsession-cover";
    const ci = createCoverImage(obs.album_image, obs.name, obs.name);
    while (ci.firstChild) obsCover.appendChild(ci.firstChild);

    const obsInfo = document.createElement("div");
    obsInfo.className = "obsession-info";
    let statLine = "Faixa nº 1 deste período";
    if (obs.max_day_date) {
      statLine = `Recorde: ${fmtNum(obs.max_day_plays)} plays em ${obs.max_day_date.split("-").reverse().join("/")}`;
    } else if (obs.recent_plays > 0) {
      statLine = `Tocou ${obs.recent_plays}x nas últimas reproduções`;
    }
    obsInfo.innerHTML = `
      <h4>${escapeHtml(obs.name || "—")}</h4>
      <p>${escapeHtml(obs.artist_names || "—")} · ${escapeHtml(obs.album_name || "")}</p>
      <span class="obsession-stat">${escapeHtml(statLine)}</span>
    `;
    els.obsessionContent.append(obsCover, obsInfo);

    els.repeatBadge.textContent = report.summary.repeat_ratio
      ? `Repeat ${report.summary.repeat_ratio.toFixed(2)}x`
      : (report.summary.top_genre_label || "Perfil");
    const genres = report.top_genres || [];
    els.genresBody.innerHTML = "";
    if (genres.length > 0) {
      const maxPct = Math.max(1, ...genres.map((g) => g.pct));
      genres.slice(0, 6).forEach((g) => {
        const row = document.createElement("div");
        row.className = "genre-row";
        row.innerHTML = `
          <span class="genre-name" title="${escapeHtml(g.label)}">${escapeHtml(g.label)}</span>
          <div class="genre-track"><div class="genre-fill" style="width:${Math.max(10, Math.round((g.pct / maxPct) * 100))}%"></div></div>
          <span class="genre-pct">${g.pct}%</span>
        `;
        els.genresBody.appendChild(row);
      });
    } else {
      const s = report.summary;
      els.genresBody.innerHTML = `
        <p class="empty-note">
          Variedade real do mês: <strong>${fmtNum(s.unique_albums)} álbuns</strong>,
          <strong>${fmtNum(s.unique_tracks)} faixas</strong> e média de
          <strong>${(s.repeat_ratio || 1).toFixed(2)}x por música</strong>.
        </p>
      `;
    }

    const albums = (report.top_albums || []).slice(0, 6);
    els.albumsCountBadge.textContent = `${fmtNum(report.summary.unique_albums)} no total`;
    els.topAlbumsGrid.innerHTML = "";
    if (!albums.length) {
      els.topAlbumsGrid.innerHTML = `<p class="empty-note span-2">Sem álbuns destacados neste recorte.</p>`;
    } else {
      albums.forEach((al) => {
        const card = document.createElement("div");
        card.className = "album-card";
        const cov = document.createElement("div");
        cov.className = "album-cover";
        const ac = createCoverImage(al.image, al.name, al.name);
        while (ac.firstChild) cov.appendChild(ac.firstChild);
        const meta = document.createElement("div");
        meta.className = "album-meta";
        const metricLine = al.plays
          ? `${fmtNum(al.plays)} plays · ${fmtNum(al.minutes)} min`
          : `${al.unique_tracks} faixa(s) no Top 50`;
        meta.innerHTML = `
          <p class="album-title" title="${escapeHtml(al.name)}">${escapeHtml(al.name)}</p>
          <p class="album-artist" title="${escapeHtml(al.artist_name)}">${escapeHtml(al.artist_name)}</p>
          <span class="album-plays">${escapeHtml(metricLine)}</span>
        `;
        card.append(cov, meta);
        els.topAlbumsGrid.appendChild(card);
      });
    }

    const discoveries = report.new_discoveries || [];
    els.discoveriesGrid.innerHTML = "";
    if (!discoveries.length) {
      els.discoveriesBadge.textContent = report.hasExactCounts ? "Mês inicial" : "Comparado ao histórico";
      els.discoveriesGrid.innerHTML = `<p class="empty-note span-2">Nenhuma descoberta inédita destacada neste recorte.</p>`;
    } else {
      els.discoveriesBadge.textContent = `${discoveries.length} destaque(s)`;
      discoveries.forEach((d) => {
        const card = document.createElement(d.url ? "a" : "div");
        card.className = "discovery-card";
        if (d.url) {
          card.href = d.url;
          card.target = "_blank";
          card.rel = "noopener noreferrer";
        }
        const av = document.createElement("div");
        av.className = "discovery-avatar";
        const ai = createCoverImage(d.image, d.name, d.name);
        while (ai.firstChild) av.appendChild(ai.firstChild);
        const info = document.createElement("div");
        info.className = "discovery-info";
        const sub = d.plays ? `${fmtNum(d.plays)} plays · ${fmtNum(d.minutes)} min` : `Top #${d.rank} no mês`;
        info.innerHTML = `
          <span class="discovery-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
          <span class="discovery-plays">${escapeHtml(sub)}</span>
        `;
        card.append(av, info);
        els.discoveriesGrid.appendChild(card);
      });
    }
  }

  function renderRhythm(report) {
    els.rhythmNote.textContent = report.rhythm_source_note || "Horários no fuso local.";
    const hourly = report.hourly_distribution || new Array(24).fill(0);
    const maxH = Math.max(1, ...hourly);
    const peakHour = report.summary.peak_hour || { hour: 0, label: "00h", plays: 0 };
    els.peakHourBadge.textContent = `Pico ${peakHour.label} (${peakHour.plays} plays)`;

    const svgW = 640;
    const svgH = 210;
    const padL = 12;
    const padR = 12;
    const slotW = (svgW - padL - padR) / 24;
    const barW = slotW - 5;
    const plotTop = 18;
    const plotH = 152;

    const barsSvg = hourly
      .map((val, h) => {
        const bh = Math.max(4, Math.round((val / maxH) * plotH));
        const x = (padL + h * slotW + 2.5).toFixed(1);
        const y = plotTop + plotH - bh;
        const fill = h === peakHour.hour ? "#E89B3C" : "#1ED760";
        const lbl = h % 3 === 0 || h === peakHour.hour
          ? `<text x="${(Number(x) + barW / 2).toFixed(1)}" y="${svgH - 12}" text-anchor="middle" fill="${h === peakHour.hour ? "#E89B3C" : "#A6ADA8"}" font-family="JetBrains Mono, monospace" font-size="11">${String(h).padStart(2, "0")}h</text>`
          : "";
        return `<g><title>${String(h).padStart(2, "0")}h: ${val} reproduções</title><rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${bh}" rx="3" fill="${fill}" opacity="${val === 0 ? 0.22 : 0.92}"></rect>${lbl}</g>`;
      })
      .join("");

    els.hourlyChartWrap.innerHTML = `<svg viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Gráfico de reproduções por hora">${barsSvg}</svg>`;

    els.periodsRow.innerHTML = "";
    ["madrugada", "manha", "tarde", "noite"].forEach((pk) => {
      const p = report.summary.periods[pk];
      const div = document.createElement("div");
      div.className = `period-chip${pk === report.summary.dominant_period ? " is-dominant" : ""}`;
      div.innerHTML = `<strong>${escapeHtml(p.label)}</strong><span>${p.pct}%</span>`;
      els.periodsRow.appendChild(div);
    });

    const cal = report.daily_calendar || [];
    if (cal.length > 0) {
      els.calendarCard.hidden = false;
      els.hourlyCard.classList.remove("span-2");
      els.streakBadge.textContent = `Sequência ${report.summary.longest_streak_days || 0}d`;
      const maxDayPlays = Math.max(1, ...cal.map((c) => c.plays));
      els.calendarGrid.innerHTML = "";
      const leadingEmpty = cal[0].weekday || 0;
      for (let i = 0; i < leadingEmpty; i++) {
        const empty = document.createElement("div");
        empty.className = "cal-empty";
        els.calendarGrid.appendChild(empty);
      }

      const defaultDay = state.selectedDay || (report.summary.peak_day && report.summary.peak_day.day) || cal[0].day;
      cal.forEach((dayObj) => {
        const ratio = dayObj.plays / maxDayPlays;
        let lvl = 0;
        if (dayObj.plays > 0) {
          if (ratio >= 0.78) lvl = 4;
          else if (ratio >= 0.52) lvl = 3;
          else if (ratio >= 0.26) lvl = 2;
          else lvl = 1;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `cal-day lvl-${lvl}${dayObj.day === defaultDay ? " is-selected" : ""}`;
        btn.innerHTML = `<span class="cal-day-num">${dayObj.day}</span><span class="cal-day-plays">${dayObj.plays || "·"}</span>`;
        btn.addEventListener("click", () => {
          state.selectedDay = dayObj.day;
          els.calendarGrid.querySelectorAll(".cal-day").forEach((b) => b.classList.remove("is-selected"));
          btn.classList.add("is-selected");
          updateCalendarInspector(dayObj, report.month_number);
        });
        els.calendarGrid.appendChild(btn);
        if (dayObj.day === defaultDay) updateCalendarInspector(dayObj, report.month_number);
      });
    } else {
      els.calendarCard.hidden = true;
      els.hourlyCard.classList.add("span-2");
    }

    const evo = (state.bundle && state.bundle.evolution) || [];
    if (evo.length > 1) {
      els.evolutionCard.hidden = false;
      const maxMin = Math.max(1, ...evo.map((m) => m.total_minutes || 1));
      const svgW2 = 920;
      const svgH2 = 210;
      const slotW2 = svgW2 / evo.length;
      const barW2 = Math.min(110, slotW2 * 0.56);
      const items = evo
        .map((m, idx) => {
          const cx = idx * slotW2 + slotW2 / 2;
          const bh = Math.max(14, Math.round((m.total_minutes / maxMin) * 128));
          const by = 30 + 128 - bh;
          const isCur = m.month === state.activeReportId;
          return `
            <g class="evo-bar" data-month="${m.month}" style="cursor:pointer">
              <rect x="${(cx - barW2 / 2).toFixed(1)}" y="${by}" width="${barW2.toFixed(1)}" height="${bh}" rx="8" fill="${isCur ? "#1ED760" : "#2D4235"}"></rect>
              <text x="${cx.toFixed(1)}" y="${by - 8}" text-anchor="middle" fill="${isCur ? "#1ED760" : "#F4F1EA"}" font-family="JetBrains Mono, monospace" font-size="12" font-weight="600">${fmtNum(m.total_minutes)}m</text>
              <text x="${cx.toFixed(1)}" y="${svgH2 - 22}" text-anchor="middle" fill="${isCur ? "#F4F1EA" : "#A6ADA8"}" font-family="Plus Jakarta Sans, sans-serif" font-size="13" font-weight="${isCur ? "700" : "500"}">${escapeHtml(m.short_label)}</text>
              <text x="${cx.toFixed(1)}" y="${svgH2 - 6}" text-anchor="middle" fill="#A6ADA8" font-family="JetBrains Mono, monospace" font-size="10">${fmtNum(m.total_plays)} plays</text>
            </g>
          `;
        })
        .join("");
      els.evolutionChartWrap.innerHTML = `<svg viewBox="0 0 ${svgW2} ${svgH2}" role="img" aria-label="Evolução de minutos por mês">${items}</svg>`;
      els.evolutionChartWrap.querySelectorAll(".evo-bar").forEach((g) => {
        g.addEventListener("click", () => selectReport(g.dataset.month));
      });
    } else {
      els.evolutionCard.hidden = true;
    }
  }

  function updateCalendarInspector(dayObj, monthNum) {
    if (!dayObj || dayObj.plays === 0) {
      els.calendarInspector.textContent = `${String(dayObj.day).padStart(2, "0")}/${String(monthNum).padStart(2, "0")} (${dayObj.weekday_label}): sem reproduções registradas.`;
      return;
    }
    els.calendarInspector.innerHTML =
      `<strong>${String(dayObj.day).padStart(2, "0")}/${String(monthNum).padStart(2, "0")} (${escapeHtml(dayObj.weekday_label)})</strong> · ` +
      `${fmtNum(dayObj.plays)} plays (${fmtNum(dayObj.minutes)} min) · Mais tocada: <strong>${escapeHtml(dayObj.top_track || "—")}</strong>`;
  }

  function getExportOptions() {
    const isCarousel = state.exportFormat === "carousel";
    const slide = window.SpotifyExporter.CAROUSEL_SLIDES[state.carouselSlideIdx] || window.SpotifyExporter.CAROUSEL_SLIDES[0];
    return {
      format: isCarousel ? state.carouselRatio : state.exportFormat,
      mode: isCarousel ? slide.key : state.exportMode,
      theme: state.exportTheme,
      handle: state.handle,
      showMetrics: state.showMetrics,
      badgeRightText: isCarousel ? slide.title : null
    };
  }

  function syncExportControlsUI() {
    const isCarousel = state.exportFormat === "carousel";
    els.groupCarouselRatio.hidden = !isCarousel;
    els.groupCardMode.hidden = isCarousel;
    els.carouselStrip.hidden = !isCarousel;
    els.btnDownloadSlide.hidden = !isCarousel;
    els.groupShowMetrics.hidden = !(state.activeReport && state.activeReport.hasExactCounts);

    const effFormat = isCarousel ? state.carouselRatio : state.exportFormat;
    const dims = effFormat === "feed" ? "1080 × 1350 px · Feed 4:5" : "1080 × 1920 px · Story 9:16";
    els.previewMeta.textContent = isCarousel ? `${dims} · Slide ${state.carouselSlideIdx + 1}/5` : dims;
    els.btnDownloadMain.textContent = isCarousel
      ? "Baixar Carrossel Completo (.zip)"
      : `Baixar PNG (${effFormat === "feed" ? "1080×1350" : "1080×1920"})`;
  }

  async function refreshPreview() {
    if (!state.activeReport || !window.SpotifyExporter) return;
    syncExportControlsUI();

    const token = ++state.renderToken;
    els.previewStatus.textContent = state.activeReport._enriching ? "Buscando capas HD..." : "Renderizando capas...";
    try {
      await window.SpotifyExporter.renderInstagramCanvas(els.previewCanvas, state.activeReport, getExportOptions());
      if (token === state.renderToken) {
        els.previewStatus.textContent = state.activeReport._enriching ? "Buscando capas HD..." : "Pronto em 1080px";
      }
    } catch (err) {
      console.error(err);
      if (token === state.renderToken) {
        els.previewStatus.textContent = "Erro ao renderizar";
      }
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleDownloadMain() {
    if (!state.activeReport) return;
    els.btnDownloadMain.disabled = true;
    els.exportFeedback.textContent = "";

    try {
      const report = state.activeReport;
      if (state.exportFormat === "carousel") {
        const slides = window.SpotifyExporter.CAROUSEL_SLIDES;
        const offscreen = document.createElement("canvas");
        const entries = [];
        for (let i = 0; i < slides.length; i++) {
          els.exportFeedback.textContent = `Gerando slide ${i + 1} de ${slides.length}...`;
          const slide = slides[i];
          await window.SpotifyExporter.renderInstagramCanvas(offscreen, report, {
            format: state.carouselRatio,
            mode: slide.key,
            theme: state.exportTheme,
            handle: state.handle,
            showMetrics: state.showMetrics,
            badgeRightText: slide.title
          });
          const blob = await window.SpotifyExporter.canvasToBlob(offscreen);
          entries.push({
            name: `spotify-${report.id}-${slide.label}-${state.carouselRatio}.png`,
            data: blob
          });
        }
        const zipBlob = await window.SpotifyExporter.buildZipBlob(entries);
        triggerDownload(zipBlob, `spotify-carrossel-${report.id}-${state.carouselRatio}.zip`);
        els.exportFeedback.textContent = "Carrossel (.zip com 5 PNGs em 1080px) baixado com sucesso.";
      } else {
        const opts = getExportOptions();
        await window.SpotifyExporter.renderInstagramCanvas(els.previewCanvas, report, opts);
        const blob = await window.SpotifyExporter.canvasToBlob(els.previewCanvas);
        triggerDownload(blob, `spotify-${report.id}-${opts.mode}-${opts.format}.png`);
        els.exportFeedback.textContent = `Imagem ${opts.format === "feed" ? "1080×1350" : "1080×1920"} baixada em PNG.`;
      }
    } catch (err) {
      els.exportFeedback.textContent = `Erro ao exportar: ${err.message}`;
    } finally {
      els.btnDownloadMain.disabled = false;
    }
  }

  async function handleDownloadCurrentSlide() {
    if (!state.activeReport) return;
    try {
      const opts = getExportOptions();
      await window.SpotifyExporter.renderInstagramCanvas(els.previewCanvas, state.activeReport, opts);
      const blob = await window.SpotifyExporter.canvasToBlob(els.previewCanvas);
      const slide = window.SpotifyExporter.CAROUSEL_SLIDES[state.carouselSlideIdx];
      triggerDownload(blob, `spotify-${state.activeReport.id}-${slide.label}-${opts.format}.png`);
      els.exportFeedback.textContent = `Slide ${state.carouselSlideIdx + 1} baixado em PNG.`;
    } catch (err) {
      els.exportFeedback.textContent = `Erro ao baixar slide: ${err.message}`;
    }
  }

  async function handleShareImage() {
    if (!state.activeReport) return;
    try {
      const opts = getExportOptions();
      await window.SpotifyExporter.renderInstagramCanvas(els.previewCanvas, state.activeReport, opts);
      const blob = await window.SpotifyExporter.canvasToBlob(els.previewCanvas);
      const file = new File([blob], `spotify-${state.activeReport.id}-${opts.mode}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Minha Máquina do Tempo · ${state.activeReport.label}`,
          text: `Minha retrospectiva do Spotify (${state.activeReport.label})`
        });
        els.exportFeedback.textContent = "Compartilhamento iniciado.";
      } else {
        triggerDownload(blob, `spotify-${state.activeReport.id}-${opts.mode}-${opts.format}.png`);
        els.exportFeedback.textContent = "Share API de arquivos indisponível neste navegador — baixamos o PNG para você postar.";
      }
    } catch (err) {
      if (err && err.name !== "AbortError") {
        els.exportFeedback.textContent = `Falha ao compartilhar: ${err.message}`;
      }
    }
  }

  function renderActiveReportAll() {
    if (!state.activeReport) return Promise.resolve();
    renderTimelineBar();
    renderHero(state.activeReport);
    renderRankings(state.activeReport);
    renderCuradoria(state.activeReport);
    renderRhythm(state.activeReport);
    return refreshPreview();
  }

  function selectReport(reportId) {
    if (!state.bundle || !state.bundle.reports.has(reportId)) return;
    state.activeReportId = reportId;
    const reportRef = state.bundle.reports.get(reportId);
    state.activeReport = reportRef;
    state.selectedDay = null;
    state.tracksExpanded = false;
    state.artistsExpanded = false;

    const needsEnrich = !reportRef.isDemo && !reportRef._coversEnriched && Boolean(window.CoverEnricher);
    if (needsEnrich) {
      reportRef._enriching = true;
    }

    renderActiveReportAll();

    if (needsEnrich) {
      els.previewStatus.textContent = "Buscando capas HD...";
      window.CoverEnricher.enrichReportCovers(reportRef)
        .catch(() => false)
        .then(async () => {
          reportRef._enriching = false;
          if (state.activeReportId === reportId) {
            await renderActiveReportAll();
          }
        });
    }
  }

  async function loadOpenProvider(provider, rawInput, monthOpt, opts) {
    const options = opts || {};
    const parsed = parseUserInput(rawInput, provider || state.openProvider);
    const detectedProvider = parsed.provider;
    const cleanUser = parsed.username;

    if (parsed.detectedFromUrl || (provider && provider !== state.openProvider)) {
      state.openProvider = detectedProvider;
      syncProviderFormUI();
    }

    if (!cleanUser) {
      if (!options.isAutoLogin) {
        triggerInputShake(els.inputOpenUsername);
        els.inputOpenUsername.focus();
        setStatusBanner(
          "Digite seu @usuario",
          "Informe seu nome de usuário do ListenBrainz (ou cole o link do seu perfil) para entrar."
        );
      }
      return false;
    }

    // Validação de chave de acesso individual
    let storedCode = window.SpotifyAccessControl.getStoredCode();
    if (!storedCode) {
      if (els.inputAccessKey && els.inputAccessKey.value.trim()) {
        const ok = await handleKeyValidation();
        if (!ok) return false;
      } else {
        if (els.accessKeyBox) {
          els.accessKeyBox.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        triggerInputShake(els.inputAccessKey);
        if (els.inputAccessKey) els.inputAccessKey.focus();
        setStatusBanner(
          "Chave de Acesso Necessária",
          "Por favor, digite sua Chave de Acesso individual enviada pelo Matheus para desbloquear."
        );
        return false;
      }
    }
    // Registra consulta em segundo plano no Worker D1
    window.SpotifyAccessControl.logQuery(cleanUser);

    els.inputOpenUsername.value = cleanUser;

    if (detectedProvider === "lastfm") {
      const apiKey = window.SpotifyAppConfig.resolveLastfmApiKey();
      if (!apiKey) {
        els.lastfmKeyDrawer.hidden = false;
        els.inputLastfmKey.focus();
        setStatusBanner(
          "Falta configurar a API Key do Last.fm",
          "Crie uma chave gratuita em last.fm/api/account/create e cole no campo abaixo — ela libera acesso ilimitado para qualquer usuário!"
        );
        return false;
      }
      if (!options.fromPoll) {
        setStatusBanner(`Consultando @${cleanUser} no Last.fm...`, "Buscando scrobbles e organizando sua Máquina do Tempo mensal.", true);
      }
      try {
        const bundle = await window.OpenMusicProviders.fetchLastfmUser(cleanUser, apiKey, monthOpt || null);
        stopSyncPolling();
        saveLastOpenSession("lastfm", cleanUser);
        setStatusBanner("", "");
        mergeIntoCurrentBundleOrShow(bundle);
        return true;
      } catch (err) {
        if (options.isAutoLogin) {
          clearLastOpenSession();
          showWelcomeScreen();
          setStatusBanner("Entre novamente com seu @usuario", err.message);
        } else {
          setStatusBanner("Não foi possível carregar Last.fm", err.message);
        }
        return false;
      }
    }

    if (!options.fromPoll) {
      setStatusBanner(`Consultando @${cleanUser} no ListenBrainz...`, "Carregando reproduções e calculando seu resumo mensal.", true);
    }
    try {
      const bundle = await window.OpenMusicProviders.fetchListenBrainzUser(cleanUser, monthOpt || null);
      stopSyncPolling();
      saveLastOpenSession("listenbrainz", cleanUser);
      setStatusBanner("", "");
      mergeIntoCurrentBundleOrShow(bundle);
      return true;
    } catch (err) {
      if (err && err.code === "NO_LISTENS_YET") {
        if (options.isAutoLogin) showWelcomeScreen();
        setStatusBanner("", "");
        startSyncPolling("listenbrainz", cleanUser, monthOpt || null, options.nextCycle || 1);
        return false;
      }
      if (err && err.code === "USER_NOT_FOUND") {
        if (options.isAutoLogin) {
          clearLastOpenSession();
          showWelcomeScreen();
        }
        triggerInputShake(els.inputOpenUsername);
        setStatusBanner(
          `Não encontramos @${cleanUser} no ListenBrainz`,
          "Confira se o nome está correto ou clique em \"1. Conectar Spotify grátis →\" acima para criar e vincular sua conta."
        );
        return false;
      }
      if (options.isAutoLogin) {
        showWelcomeScreen();
        setStatusBanner("Toque para tentar novamente", err.message);
      } else {
        setStatusBanner("Não foi possível carregar ListenBrainz", err.message);
      }
      return false;
    }
  }

  function mergeIntoCurrentBundleOrShow(newBundle) {
    if (
      state.bundle &&
      state.bundle.mode === newBundle.mode &&
      state.bundle.providerUsername === newBundle.providerUsername
    ) {
      newBundle.reports.forEach((rep, id) => {
        state.bundle.reports.set(id, rep);
        if (!state.bundle.tabs.some((t) => t.id === id)) {
          state.bundle.tabs.push({ id, label: rep.label, meta: `${rep.summary.total_plays || 0} plays` });
        }
      });
      state.bundle.tabs.sort((a, b) => b.id.localeCompare(a.id));
      state.bundle.evolution = Array.from(state.bundle.reports.values())
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((r) => ({
          month: r.id,
          short_label: r.short_label,
          label: r.label,
          total_minutes: r.summary.total_minutes || 0,
          total_plays: r.summary.total_plays || 0
        }));
      selectReport(newBundle.defaultId);
    } else {
      showDashboard(newBundle);
    }
  }

  async function loadSpotifySession(token) {
    setStatusBanner("Carregando sua conta Spotify...", "Buscando Top Músicas, Top Artistas, gêneros e reproduções recentes.", true);
    try {
      const bundle = await window.SpotifyFriendsClient.fetchAndBuildBundle(token);
      setStatusBanner("", "");
      showDashboard(bundle);
    } catch (err) {
      if (err.code === "ALLOWLIST_403") {
        window.SpotifyAuth.logout();
        showWelcomeScreen();
        setStatusBanner(
          "Conta fora da lista de acesso (Development Mode — Erro 403)",
          "O Spotify limita o login OAuth direto a 5 e-mails cadastrados no Developer Dashboard. Use a Opção 1 (ListenBrainz / Last.fm) ou a Opção 2 (Importar Histórico .json/.zip) — ambas são 100% ilimitadas!"
        );
      } else if (err.code === "UNAUTHORIZED_401") {
        window.SpotifyAuth.logout();
        showWelcomeScreen();
        setStatusBanner("Sessão expirada", "Faça login novamente com sua conta Spotify.");
      } else {
        setStatusBanner("Erro ao carregar Spotify API", err.message);
      }
    }
  }

  async function handleHistoryUpload(files) {
    if (!files || !files.length) return;
    setStatusBanner("Processando histórico do Spotify...", "Lendo reproduções, montando meses e buscando capas em HD.", true);
    try {
      const bundle = await window.SpotifyHistoryImporter.parseHistoryFiles(files);
      setStatusBanner("", "");
      showDashboard(bundle);
    } catch (err) {
      setStatusBanner("Não foi possível importar o histórico", err.message);
    }
  }

  
  // ==========================================
  // CONTROLE DE ACESSO (CHAVES DE AMIGOS E ADMIN)
  // ==========================================
  let adminSessionMasterKey = "";

  function renderAccessState() {
    const code = window.SpotifyAccessControl.getStoredCode();
    const friendName = window.SpotifyAccessControl.getStoredFriendName();

    if (code) {
      if (els.accessBadgeRow) {
        els.accessBadgeRow.hidden = false;
        els.accessFriendName.textContent = friendName || "Amigo";
        els.accessCodeBadge.textContent = code;
      }
      if (els.accessKeyBox) els.accessKeyBox.hidden = true;
    } else {
      if (els.accessBadgeRow) els.accessBadgeRow.hidden = true;
      if (els.accessKeyBox) els.accessKeyBox.hidden = false;
    }
  }

  async function handleKeyValidation(codeToTest) {
    const inputVal = (codeToTest || (els.inputAccessKey ? els.inputAccessKey.value : "")).trim().toUpperCase();
    if (!inputVal) {
      if (els.accessStatusMsg) {
        els.accessStatusMsg.className = "access-status-msg error";
        els.accessStatusMsg.textContent = "Digite sua Chave de Acesso para continuar.";
        els.accessStatusMsg.hidden = false;
      }
      return false;
    }

    if (els.btnValidateKey) {
      els.btnValidateKey.disabled = true;
      els.btnValidateKey.textContent = "Verificando...";
    }

    const res = await window.SpotifyAccessControl.verifyCode(inputVal);

    if (els.btnValidateKey) {
      els.btnValidateKey.disabled = false;
      els.btnValidateKey.textContent = "Liberar Acesso";
    }

    if (res.valid) {
      if (els.accessStatusMsg) {
        els.accessStatusMsg.className = "access-status-msg success";
        els.accessStatusMsg.textContent = "Acesso liberado! Bem-vindo(a), " + (res.friendName || "Amigo") + "!";
        els.accessStatusMsg.hidden = false;
      }
      renderAccessState();
      return true;
    } else {
      if (els.accessStatusMsg) {
        els.accessStatusMsg.className = "access-status-msg error";
        els.accessStatusMsg.textContent = res.message || "Chave inválida ou pausada.";
        els.accessStatusMsg.hidden = false;
      }
      return false;
    }
  }

  // --- Funções do Modal Admin (Painel do Matheus) ---
  function openAdminModal() {
    if (!els.adminModal) return;
    els.adminModal.hidden = false;
    if (adminSessionMasterKey) {
      showAdminDashboard();
    } else {
      els.adminLoginView.hidden = false;
      els.adminDashboardView.hidden = true;
      if (els.adminMasterInput) els.adminMasterInput.focus();
    }
  }

  function closeAdminModal() {
    if (els.adminModal) els.adminModal.hidden = true;
  }

  async function handleAdminLogin() {
    const key = (els.adminMasterInput ? els.adminMasterInput.value : "").trim();
    if (!key) return;

    els.btnAdminLogin.disabled = true;
    els.btnAdminLogin.textContent = "Entrando...";
    els.adminLoginError.hidden = true;

    try {
      const data = await window.SpotifyAccessControl.adminList(key);
      if (data.ok) {
        adminSessionMasterKey = key;
        showAdminDashboard(data);
      } else {
        els.adminLoginError.textContent = data.message || "Senha mestra incorreta.";
        els.adminLoginError.hidden = false;
      }
    } catch (e) {
      els.adminLoginError.textContent = "Erro ao conectar com Cloudflare D1.";
      els.adminLoginError.hidden = false;
    } finally {
      els.btnAdminLogin.disabled = false;
      els.btnAdminLogin.textContent = "Entrar no Painel";
    }
  }

  async function refreshAdminData() {
    if (!adminSessionMasterKey) return;
    if (els.btnRefreshAdmin) els.btnRefreshAdmin.textContent = "Atualizando...";
    try {
      const data = await window.SpotifyAccessControl.adminList(adminSessionMasterKey);
      if (data.ok) renderAdminData(data);
    } catch (_) {}
    finally {
      if (els.btnRefreshAdmin) els.btnRefreshAdmin.textContent = "Atualizar ⟳";
    }
  }

  function showAdminDashboard(initialData) {
    els.adminLoginView.hidden = true;
    els.adminDashboardView.hidden = false;
    if (initialData) {
      renderAdminData(initialData);
    } else {
      refreshAdminData();
    }
  }

  function renderAdminData(data) {
    const stats = data.stats || {};
    if (els.adminStatKeys) els.adminStatKeys.textContent = stats.totalKeys || 0;
    if (els.adminStatActive) els.adminStatActive.textContent = stats.activeKeys || 0;
    if (els.adminStatBlocked) els.adminStatBlocked.textContent = stats.blockedKeys || 0;
    if (els.adminStatUses) els.adminStatUses.textContent = stats.totalUses || 0;

    // Render keys table
    if (els.adminKeysTbody) {
      const keys = data.keys || [];
      if (!keys.length) {
        els.adminKeysTbody.innerHTML = '<tr><td colspan="6" class="text-muted">Nenhuma chave cadastrada ainda. Crie uma acima!</td></tr>';
      } else {
        const siteUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, "");
        els.adminKeysTbody.innerHTML = keys.map(k => {
          const isBlocked = k.status === "blocked";
          const statusBadge = isBlocked
            ? '<span class="badge-status badge-blocked">Bloqueado</span>'
            : '<span class="badge-status badge-active">Ativo</span>';
          const toggleAction = isBlocked ? "active" : "blocked";
          const toggleLabel = isBlocked ? "Desbloquear" : "Bloquear";
          const inviteUrl = siteUrl + "?key=" + encodeURIComponent(k.code);
          return `
            <tr>
              <td><strong>${escapeHtml(k.friend_name)}</strong></td>
              <td><code>${escapeHtml(k.code)}</code></td>
              <td>${statusBadge}</td>
              <td>${k.use_count || 0}${k.max_uses ? " / " + k.max_uses : ""}</td>
              <td><small>${k.last_used_at ? k.last_used_at.slice(0, 16) : "Nunca"}</small></td>
              <td class="admin-actions-cell">
                <button type="button" class="btn-table-action btn-copy-invite" data-url="${inviteUrl}" title="Copiar link de convite direto">Copiar Convite</button>
                <button type="button" class="btn-table-action btn-toggle-key" data-id="${k.id}" data-next="${toggleAction}">${toggleLabel}</button>
                <button type="button" class="btn-table-action danger btn-delete-key" data-id="${k.id}">Excluir</button>
              </td>
            </tr>
          `;
        }).join("");

        // Bind table action buttons
        els.adminKeysTbody.querySelectorAll(".btn-copy-invite").forEach(btn => {
          btn.addEventListener("click", async () => {
            await navigator.clipboard.writeText(btn.dataset.url);
            const orig = btn.textContent;
            btn.textContent = "Copiado!";
            setTimeout(() => { btn.textContent = orig; }, 1800);
          });
        });

        els.adminKeysTbody.querySelectorAll(".btn-toggle-key").forEach(btn => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            await window.SpotifyAccessControl.adminToggle(adminSessionMasterKey, btn.dataset.id, btn.dataset.next);
            await refreshAdminData();
          });
        });

        els.adminKeysTbody.querySelectorAll(".btn-delete-key").forEach(btn => {
          btn.addEventListener("click", async () => {
            if (!confirm("Tem certeza que deseja excluir esta chave?")) return;
            btn.disabled = true;
            await window.SpotifyAccessControl.adminDelete(adminSessionMasterKey, btn.dataset.id);
            await refreshAdminData();
          });
        });
      }
    }

    // Render logs table
    if (els.adminLogsTbody) {
      const logs = data.recent_logs || [];
      if (!logs.length) {
        els.adminLogsTbody.innerHTML = '<tr><td colspan="5" class="text-muted">Nenhum acesso registrado ainda.</td></tr>';
      } else {
        els.adminLogsTbody.innerHTML = logs.map(l => {
          const loc = [l.ip_city, l.ip_country].filter(Boolean).join(", ") || "Nuvem Edge";
          return `
            <tr>
              <td><small>${l.created_at ? l.created_at.slice(0, 16) : "—"}</small></td>
              <td>${escapeHtml(l.friend_name || "Amigo")}</td>
              <td><code>${escapeHtml(l.code)}</code></td>
              <td>${l.username_queried ? "<strong>@" + escapeHtml(l.username_queried) + "</strong>" : '<span class="text-muted">Acesso inicial</span>'}</td>
              <td><small>${escapeHtml(loc)}</small></td>
            </tr>
          `;
        }).join("");
      }
    }
  }

  async function handleAdminCreateKey(e) {
    e.preventDefault();
    const name = els.adminFriendName.value.trim();
    const code = els.adminFriendCode.value.trim();
    const maxUses = parseInt(els.adminFriendMax.value, 10) || null;

    if (!name) return;

    const btn = qs("btn-create-key");
    if (btn) btn.disabled = true;

    try {
      const res = await window.SpotifyAccessControl.adminCreate(adminSessionMasterKey, name, code, maxUses);
      if (res.ok) {
        els.adminFriendName.value = "";
        els.adminFriendCode.value = "";
        els.adminFriendMax.value = "";
        els.adminCreateMsg.className = "admin-status-msg success";
        els.adminCreateMsg.textContent = "Chave " + res.created.code + " criada para " + res.created.friend_name + "!";
        els.adminCreateMsg.hidden = false;
        await refreshAdminData();
      } else {
        els.adminCreateMsg.className = "admin-status-msg error";
        els.adminCreateMsg.textContent = res.message || "Erro ao criar chave.";
        els.adminCreateMsg.hidden = false;
      }
    } catch (_) {
      els.adminCreateMsg.className = "admin-status-msg error";
      els.adminCreateMsg.textContent = "Falha ao conectar com Cloudflare D1.";
      els.adminCreateMsg.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindEvents() {
    
    // Eventos de Chave de Acesso
    if (els.btnValidateKey) {
      els.btnValidateKey.addEventListener("click", () => handleKeyValidation());
    }
    if (els.inputAccessKey) {
      els.inputAccessKey.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleKeyValidation();
        }
      });
    }
    if (els.btnChangeAccessKey) {
      els.btnChangeAccessKey.addEventListener("click", () => {
        window.SpotifyAccessControl.clearSession();
        renderAccessState();
        if (els.inputAccessKey) {
          els.inputAccessKey.value = "";
          els.inputAccessKey.focus();
        }
      });
    }

    // Eventos do Modal Admin
    if (els.btnOpenAdmin) {
      els.btnOpenAdmin.addEventListener("click", openAdminModal);
    }
    if (els.btnCloseAdmin) {
      els.btnCloseAdmin.addEventListener("click", closeAdminModal);
    }
    if (els.btnAdminLogin) {
      els.btnAdminLogin.addEventListener("click", handleAdminLogin);
    }
    if (els.adminMasterInput) {
      els.adminMasterInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAdminLogin();
        }
      });
    }
    if (els.btnRefreshAdmin) {
      els.btnRefreshAdmin.addEventListener("click", refreshAdminData);
    }
    if (els.adminCreateForm) {
      els.adminCreateForm.addEventListener("submit", handleAdminCreateKey);
    }

    els.providerTabs.querySelectorAll("[data-provider]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.openProvider = btn.dataset.provider;
        syncProviderFormUI();
      });
    });

    els.btnToggleLastfmKey.addEventListener("click", () => {
      els.lastfmKeyDrawer.hidden = !els.lastfmKeyDrawer.hidden;
    });

    els.btnSaveLastfmKey.addEventListener("click", () => {
      const saved = window.SpotifyAppConfig.saveCustomLastfmApiKey(els.inputLastfmKey.value);
      refreshConfigUI();
      setStatusBanner(
        saved ? "Last.fm API Key salva!" : "API Key removida",
        saved ? "Agora digite qualquer @usuario do Last.fm e clique em Gerar Máquina do Tempo." : "Cole uma chave válida do Last.fm.",
        Boolean(saved)
      );
    });

    els.openProviderForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      stopSyncPolling();
      const monthVal = els.monthOptWrap && !els.monthOptWrap.hidden ? els.inputOpenMonth.value : null;
      await loadOpenProvider(state.openProvider, els.inputOpenUsername.value, monthVal);
    });

    els.btnToggleMonthOpt.addEventListener("click", () => {
      const willOpen = els.monthOptWrap.hidden;
      els.monthOptWrap.hidden = !willOpen;
      els.btnToggleMonthOpt.setAttribute("aria-expanded", String(willOpen));
      if (!willOpen) {
        els.inputOpenMonth.value = "";
      } else {
        els.inputOpenMonth.focus();
      }
    });

    els.btnSyncRetry.addEventListener("click", async () => {
      const target = state.syncPollTarget || {
        provider: state.openProvider,
        username: els.inputOpenUsername.value,
        monthOpt: els.monthOptWrap && !els.monthOptWrap.hidden ? els.inputOpenMonth.value : null
      };
      await loadOpenProvider(target.provider, target.username, target.monthOpt, { fromPoll: true });
    });

    els.btnSyncCancel.addEventListener("click", () => {
      stopSyncPolling();
      setStatusBanner(
        "Espera cancelada",
        "Assim que suas músicas aparecerem no ListenBrainz, clique em \"Ver minha Máquina do Tempo\".",
        true
      );
    });

    els.btnTravelMonth.addEventListener("click", async () => {
      if (!state.bundle || !els.inputTravelMonth.value) return;
      await loadOpenProvider(state.bundle.mode, state.bundle.providerUsername, els.inputTravelMonth.value);
    });

    els.btnToggleConfig.addEventListener("click", () => {
      const open = els.configDrawer.hidden;
      els.configDrawer.hidden = !open;
      els.btnToggleConfig.setAttribute("aria-expanded", String(open));
    });

    els.btnSaveClientId.addEventListener("click", () => {
      const saved = window.SpotifyAppConfig.saveCustomClientId(els.inputClientId.value);
      refreshConfigUI();
      setStatusBanner(
        saved ? "Client ID salvo neste navegador" : "Client ID removido",
        saved ? "Agora clique em Entrar com Spotify para conectar." : "Cole um Client ID válido.",
        Boolean(saved)
      );
    });

    els.btnCopyRedirect.addEventListener("click", async () => {
      const uri = els.inputRedirectUri.value;
      try {
        await navigator.clipboard.writeText(uri);
        setStatusBanner("Redirect URI copiada!", uri, true);
      } catch (_) {
        els.inputRedirectUri.select();
        setStatusBanner("Copie a Redirect URI selecionada:", uri, true);
      }
    });

    els.btnSpotifyLogin.addEventListener("click", async () => {
      const cid = window.SpotifyAppConfig.resolveClientId();
      if (!cid) {
        els.configDrawer.hidden = false;
        els.btnToggleConfig.setAttribute("aria-expanded", "true");
        els.inputClientId.focus();
        setStatusBanner(
          "Falta configurar o Client ID do Spotify",
          "Para uso ilimitado com qualquer pessoa, recomendamos usar ListenBrainz, Last.fm ou Importar Histórico acima."
        );
        return;
      }
      try {
        await window.SpotifyAuth.startLogin(cid);
      } catch (err) {
        setStatusBanner("Erro ao iniciar login OAuth PKCE", err.message);
      }
    });

    els.inputHistoryFiles.addEventListener("change", (e) => handleHistoryUpload(e.target.files));

    ["dragenter", "dragover"].forEach((ev) => {
      els.dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        els.dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      els.dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        els.dropzone.classList.remove("is-dragover");
      });
    });
    els.dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files) handleHistoryUpload(e.dataTransfer.files);
    });

    els.btnTryDemo.addEventListener("click", () => {
      stopSyncPolling();
      setStatusBanner("", "");
      showDashboard(window.SpotifyHistoryImporter.createDemoDataset());
    });

    els.btnRestoreBackup.addEventListener("click", () => els.inputBackupFile.click());
    els.inputBackupFile.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const txt = await file.text();
        window.SpotifyFriendsClient.importVaultJson(null, txt);
        setStatusBanner("Backup restaurado neste navegador!", "Seus snapshots mensais salvos foram importados.", true);
      } catch (err) {
        setStatusBanner("Erro ao restaurar backup", err.message);
      }
    });

    els.btnExportBackup.addEventListener("click", () => {
      if (!state.bundle || !state.bundle.profile) return;
      const json = window.SpotifyFriendsClient.exportVaultJson(state.bundle.profile.id);
      triggerDownload(new Blob([json], { type: "application/json" }), `spotify-backup-${state.bundle.profile.id}.json`);
    });

    els.btnRefreshData.addEventListener("click", async () => {
      if (!state.bundle) return;
      if (state.bundle.mode === "spotify_api") {
        const token = await window.SpotifyAuth.getValidAccessToken();
        if (token) await loadSpotifySession(token);
        else showWelcomeScreen();
      } else if (state.bundle.mode === "listenbrainz" || state.bundle.mode === "lastfm") {
        await loadOpenProvider(state.bundle.mode, state.bundle.providerUsername, null);
      }
    });

    els.btnCopyShareLink.addEventListener("click", async () => {
      if (!state.bundle || !state.bundle.providerUsername) return;
      const baseUrl = window.location.origin + window.location.pathname;
      const qp = new URLSearchParams({ u: state.bundle.providerUsername });
      if (state.bundle.mode === "lastfm") qp.set("p", "lastfm");
      const shareUrl = `${baseUrl}?${qp.toString()}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        els.btnCopyShareLink.textContent = "Link copiado!";
        clearTimeout(state.shareFeedbackTimer);
        state.shareFeedbackTimer = setTimeout(() => {
          els.btnCopyShareLink.textContent = "Copiar link";
        }, 2500);
      } catch (_) {
        setStatusBanner("Copie o link direto do seu painel:", shareUrl, true);
      }
    });

    els.btnSwitchSource.addEventListener("click", () => {
      stopSyncPolling();
      clearLastOpenSession();
      clearUrlQueryParams();
      state.bundle = null;
      setStatusBanner("", "");
      showWelcomeScreen();
      els.inputOpenUsername.focus();
    });

    els.btnLogout.addEventListener("click", () => {
      window.SpotifyAuth.logout();
      state.bundle = null;
      setStatusBanner("Sessão encerrada", "Você saiu da sua conta Spotify neste navegador.", true);
      showWelcomeScreen();
    });

    els.btnPrevMonth.addEventListener("click", () => {
      if (!state.bundle) return;
      const idx = state.bundle.tabs.findIndex((t) => t.id === state.activeReportId);
      if (idx >= 0 && idx < state.bundle.tabs.length - 1) selectReport(state.bundle.tabs[idx + 1].id);
    });
    els.btnNextMonth.addEventListener("click", () => {
      if (!state.bundle) return;
      const idx = state.bundle.tabs.findIndex((t) => t.id === state.activeReportId);
      if (idx > 0) selectReport(state.bundle.tabs[idx - 1].id);
    });

    els.btnToggleTracks.addEventListener("click", () => {
      state.tracksExpanded = !state.tracksExpanded;
      if (state.activeReport) renderRankings(state.activeReport);
    });
    els.btnToggleArtists.addEventListener("click", () => {
      state.artistsExpanded = !state.artistsExpanded;
      if (state.activeReport) renderRankings(state.activeReport);
    });

    els.ctrlFormat.querySelectorAll("[data-format]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.exportFormat = btn.dataset.format;
        els.ctrlFormat.querySelectorAll("[data-format]").forEach((b) => b.classList.toggle("is-active", b === btn));
        refreshPreview();
      });
    });
    els.ctrlCarouselRatio.querySelectorAll("[data-ratio]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.carouselRatio = btn.dataset.ratio;
        els.ctrlCarouselRatio.querySelectorAll("[data-ratio]").forEach((b) => b.classList.toggle("is-active", b === btn));
        refreshPreview();
      });
    });
    els.ctrlMode.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.exportMode = btn.dataset.mode;
        els.ctrlMode.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("is-active", b === btn));
        refreshPreview();
      });
    });
    els.ctrlTheme.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.exportTheme = btn.dataset.theme;
        els.ctrlTheme.querySelectorAll("[data-theme]").forEach((b) => b.classList.toggle("is-active", b === btn));
        refreshPreview();
      });
    });
    els.carouselStrip.querySelectorAll("[data-slide]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.carouselSlideIdx = Number(btn.dataset.slide) || 0;
        els.carouselStrip.querySelectorAll("[data-slide]").forEach((b) => b.classList.toggle("is-active", b === btn));
        refreshPreview();
      });
    });

    let handleTimer = null;
    els.inputHandle.addEventListener("input", () => {
      state.handle = els.inputHandle.value;
      clearTimeout(handleTimer);
      handleTimer = setTimeout(refreshPreview, 220);
    });
    els.chkShowMetrics.addEventListener("change", () => {
      state.showMetrics = els.chkShowMetrics.checked;
      refreshPreview();
    });

    els.btnDownloadMain.addEventListener("click", handleDownloadMain);
    els.btnDownloadSlide.addEventListener("click", handleDownloadCurrentSlide);
    els.btnShareImage.addEventListener("click", handleShareImage);
  }

  function cacheElements() {
    els.statusBanner = qs("status-banner");
    els.welcomeScreen = qs("welcome-screen");
    els.dashboardRoot = qs("dashboard-root");
    els.headerProfile = qs("header-profile");
    els.headerAvatar = qs("header-avatar");
    els.headerName = qs("header-name");
    els.btnCopyShareLink = qs("btn-copy-share-link");
    els.btnRefreshData = qs("btn-refresh-data");
    els.btnSwitchSource = qs("btn-switch-source");
    els.btnLogout = qs("btn-logout");
    els.btnJumpStudio = qs("btn-jump-studio");
    els.providerTabs = qs("provider-tabs");
    els.openProviderForm = qs("open-provider-form");
    els.inputOpenUsername = qs("input-open-username");
    // Elementos de controle de acesso de amigos
    els.accessBadgeRow = qs("access-badge-row");
    els.accessFriendName = qs("access-friend-name");
    els.accessCodeBadge = qs("access-code-badge");
    els.btnChangeAccessKey = qs("btn-change-access-key");
    els.accessKeyBox = qs("access-key-box");
    els.inputAccessKey = qs("input-access-key");
    els.btnValidateKey = qs("btn-validate-key");
    els.accessStatusMsg = qs("access-status-msg");
    els.stepConnectBox = qs("step-connect-box");
    // Elementos do Modal Admin
    els.btnOpenAdmin = qs("btn-open-admin");
    els.adminModal = qs("admin-modal");
    els.btnCloseAdmin = qs("btn-close-admin");
    els.adminLoginView = qs("admin-login-view");
    els.adminDashboardView = qs("admin-dashboard-view");
    els.adminMasterInput = qs("admin-master-input");
    els.btnAdminLogin = qs("btn-admin-login");
    els.adminLoginError = qs("admin-login-error");
    els.adminStatKeys = qs("admin-stat-keys");
    els.adminStatActive = qs("admin-stat-active");
    els.adminStatBlocked = qs("admin-stat-blocked");
    els.adminStatUses = qs("admin-stat-uses");
    els.adminCreateForm = qs("admin-create-form");
    els.adminFriendName = qs("admin-friend-name");
    els.adminFriendCode = qs("admin-friend-code");
    els.adminFriendMax = qs("admin-friend-max");
    els.adminCreateMsg = qs("admin-create-msg");
    els.btnRefreshAdmin = qs("btn-refresh-admin");
    els.adminKeysTbody = qs("admin-keys-tbody");
    els.adminLogsTbody = qs("admin-logs-tbody");
    els.btnToggleMonthOpt = qs("btn-toggle-month-opt");
    els.monthOptWrap = qs("month-opt-wrap");
    els.inputOpenMonth = qs("input-open-month");
    els.btnOpenConnect = qs("btn-open-connect");
    els.btnToggleLastfmKey = qs("btn-toggle-lastfm-key");
    els.lastfmKeyDrawer = qs("lastfm-key-drawer");
    els.inputLastfmKey = qs("input-lastfm-key");
    els.btnSaveLastfmKey = qs("btn-save-lastfm-key");
    els.syncWaitBox = qs("sync-wait-box");
    els.syncWaitTimer = qs("sync-wait-timer");
    els.btnSyncRetry = qs("btn-sync-retry");
    els.btnSyncCancel = qs("btn-sync-cancel");
    els.providerHint = qs("provider-hint");
    els.clientIdStatus = qs("client-id-status");
    els.btnSpotifyLogin = qs("btn-spotify-login");
    els.btnToggleConfig = qs("btn-toggle-config");
    els.configDrawer = qs("config-drawer");
    els.inputClientId = qs("input-client-id");
    els.btnSaveClientId = qs("btn-save-client-id");
    els.inputRedirectUri = qs("input-redirect-uri");
    els.btnCopyRedirect = qs("btn-copy-redirect");
    els.dropzone = qs("dropzone");
    els.inputHistoryFiles = qs("input-history-files");
    els.btnTryDemo = qs("btn-try-demo");
    els.btnRestoreBackup = qs("btn-restore-backup");
    els.inputBackupFile = qs("input-backup-file");
    els.sourceModeTag = qs("source-mode-tag");
    els.archiveStats = qs("archive-stats");
    els.monthTravelWrap = qs("month-travel-wrap");
    els.inputTravelMonth = qs("input-travel-month");
    els.btnTravelMonth = qs("btn-travel-month");
    els.btnPrevMonth = qs("btn-prev-month");
    els.btnNextMonth = qs("btn-next-month");
    els.btnExportBackup = qs("btn-export-backup");
    els.monthPills = qs("month-pills");
    els.editionBadge = qs("edition-badge");
    els.personalityPill = qs("personality-pill");
    els.coverageNote = qs("coverage-note");
    els.monthTitle = qs("month-title");
    els.personalitySubtitle = qs("personality-subtitle");
    els.spotlightArtist = qs("spotlight-artist");
    els.spotlightTrack = qs("spotlight-track");
    els.kpi1Label = qs("kpi-1-label");
    els.kpi1Val = qs("kpi-1-val");
    els.kpi1Sub = qs("kpi-1-sub");
    els.kpi2Label = qs("kpi-2-label");
    els.kpi2Val = qs("kpi-2-val");
    els.kpi2Sub = qs("kpi-2-sub");
    els.kpi3Label = qs("kpi-3-label");
    els.kpi3Val = qs("kpi-3-val");
    els.kpi3Sub = qs("kpi-3-sub");
    els.kpi4Label = qs("kpi-4-label");
    els.kpi4Val = qs("kpi-4-val");
    els.kpi4Sub = qs("kpi-4-sub");
    els.rankingsNote = qs("rankings-note");
    els.topTracksList = qs("top-tracks-list");
    els.topArtistsList = qs("top-artists-list");
    els.btnToggleTracks = qs("btn-toggle-tracks");
    els.btnToggleArtists = qs("btn-toggle-artists");
    els.obsessionBadge = qs("obsession-badge");
    els.obsessionContent = qs("obsession-content");
    els.repeatBadge = qs("repeat-badge");
    els.genresBody = qs("genres-body");
    els.albumsCountBadge = qs("albums-count-badge");
    els.topAlbumsGrid = qs("top-albums-grid");
    els.discoveriesBadge = qs("discoveries-badge");
    els.discoveriesGrid = qs("discoveries-grid");
    els.rhythmNote = qs("rhythm-note");
    els.hourlyCard = qs("hourly-card");
    els.peakHourBadge = qs("peak-hour-badge");
    els.hourlyChartWrap = qs("hourly-chart-wrap");
    els.periodsRow = qs("periods-row");
    els.calendarCard = qs("calendar-card");
    els.streakBadge = qs("streak-badge");
    els.calendarGrid = qs("calendar-grid");
    els.calendarInspector = qs("calendar-inspector");
    els.evolutionCard = qs("evolution-card");
    els.evolutionChartWrap = qs("evolution-chart-wrap");
    els.ctrlFormat = qs("ctrl-format");
    els.groupCarouselRatio = qs("group-carousel-ratio");
    els.ctrlCarouselRatio = qs("ctrl-carousel-ratio");
    els.groupCardMode = qs("group-card-mode");
    els.ctrlMode = qs("ctrl-mode");
    els.ctrlTheme = qs("ctrl-theme");
    els.inputHandle = qs("input-handle");
    els.groupShowMetrics = qs("group-show-metrics");
    els.chkShowMetrics = qs("chk-show-metrics");
    els.btnDownloadMain = qs("btn-download-main");
    els.btnDownloadSlide = qs("btn-download-slide");
    els.btnShareImage = qs("btn-share-image");
    els.exportFeedback = qs("export-feedback");
    els.previewMeta = qs("preview-meta");
    els.previewStatus = qs("preview-status");
    els.carouselStrip = qs("carousel-strip");
    els.previewCanvas = qs("export-preview-canvas");
  }

  async function init() {
    cacheElements();
    refreshConfigUI();
    bindEvents();

    // Verifica se veio chave na URL (?key=CODIGO ou ?code=CODIGO)
    const urlCode = window.SpotifyAccessControl.resolveUrlCode();
    if (urlCode) {
      await handleKeyValidation(urlCode);
    } else {
      renderAccessState();
    }

    const params = new URLSearchParams(window.location.search);
    const urlUser = (params.get("u") || params.get("user") || "").trim();
    const urlProvider = (params.get("p") || params.get("provider") || "").trim().toLowerCase();
    const urlMonth = (params.get("m") || params.get("month") || "").trim() || null;

    if (urlUser) {
      const parsed = parseUserInput(urlUser, urlProvider === "lastfm" ? "lastfm" : "listenbrainz");
      state.openProvider = parsed.provider;
      syncProviderFormUI();
      els.inputOpenUsername.value = parsed.username;
      if (urlMonth) {
        els.monthOptWrap.hidden = false;
        els.btnToggleMonthOpt.setAttribute("aria-expanded", "true");
        els.inputOpenMonth.value = urlMonth;
      }
      await loadOpenProvider(parsed.provider, parsed.username, urlMonth, { isUrlLink: true });
      return;
    }

    const cb = await window.SpotifyAuth.handleCallbackIfPresent();
    if (cb.status === "error") {
      showWelcomeScreen();
      setStatusBanner("Autorização não concluída", cb.message);
      return;
    }

    const token = cb.status === "authenticated"
      ? cb.session.accessToken
      : await window.SpotifyAuth.getValidAccessToken();

    if (token) {
      await loadSpotifySession(token);
      return;
    }

    const saved = loadLastOpenSession();
    if (saved && saved.username) {
      state.openProvider = saved.provider;
      syncProviderFormUI();
      els.inputOpenUsername.value = saved.username;
      await loadOpenProvider(saved.provider, saved.username, null, { isAutoLogin: true });
      return;
    }

    showWelcomeScreen();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
