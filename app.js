(function () {
  "use strict";

  const state = {
    clientId: "",
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
    renderToken: 0
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
      img.alt = altText || fallbackLabel || "Capa do Spotify";
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
    const redirectUri = window.SpotifyAppConfig.getRedirectUri();
    els.inputRedirectUri.value = redirectUri;
    els.inputClientId.value = state.clientId;

    if (state.clientId) {
      els.clientIdStatus.textContent = "Client ID ativo";
      els.clientIdStatus.className = "mono-badge";
      els.btnSpotifyLogin.disabled = false;
    } else {
      els.clientIdStatus.textContent = "Aguardando Client ID";
      els.clientIdStatus.className = "mono-badge amber";
      els.btnSpotifyLogin.disabled = false;
    }
  }

  function showWelcomeScreen() {
    els.welcomeScreen.hidden = false;
    els.dashboardRoot.hidden = true;
    els.headerProfile.hidden = true;
    els.btnRefreshData.hidden = true;
    els.btnSwitchSource.hidden = true;
    els.btnLogout.hidden = true;
    els.btnJumpStudio.hidden = true;
  }

  function showDashboard(bundle) {
    state.bundle = bundle;
    els.welcomeScreen.hidden = true;
    els.dashboardRoot.hidden = false;
    els.btnSwitchSource.hidden = false;
    els.btnJumpStudio.hidden = false;

    const isApi = bundle.mode === "spotify_api";
    els.btnRefreshData.hidden = !isApi;
    els.btnLogout.hidden = !isApi;
    els.btnExportBackup.hidden = !isApi;

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
        `${vs.monthsSaved || 1} mês(es) salvo(s) neste aparelho · ${vs.recentCachedThisMonth || 0} plays recentes cacheados`;
    } else if (bundle.isDemo) {
      els.sourceModeTag.textContent = "MODO DEMONSTRAÇÃO";
      const at = bundle.allTime;
      els.archiveStats.textContent =
        `${fmtNum(at.total_plays)} reproduções · ${fmtNum(at.total_minutes)} min (${at.total_hours} h) · ${at.months_count} meses fictícios`;
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
      ${spotifyUrl ? `<a class="spotlight-link" href="${escapeHtml(spotifyUrl)}" target="_blank" rel="noopener noreferrer">Ouvir no Spotify</a>` : ""}
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
      ? `${s.active_days} dias ativos no mês`
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
          : ((a1.genres && a1.genres.slice(0, 2).join(" · ")) || "Líder do período no Spotify"))
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
      els.kpi1Label.textContent = "Minutos ouvidos";
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
      els.kpi4Label.textContent = "Dia mais musical";
      els.kpi4Val.textContent = pd.day ? `${String(pd.day).padStart(2, "0")}/${String(report.month_number).padStart(2, "0")} (${pd.weekday_label})` : "—";
      els.kpi4Sub.textContent = pd.plays ? `${fmtNum(pd.plays)} plays · ${fmtNum(pd.minutes)} min` : "—";
    } else {
      els.kpi1Label.textContent = "Gênero nº 1";
      els.kpi1Val.textContent = s.top_genre_label || "Mix";
      els.kpi1Sub.textContent = `${(report.top_genres || []).length} gêneros mapeados`;

      els.kpi2Label.textContent = "Artistas no Top";
      els.kpi2Val.textContent = fmtNum(s.unique_artists);
      els.kpi2Sub.textContent = `${fmtNum(s.unique_albums)} álbuns diferentes no ranking`;

      els.kpi3Label.textContent = "Descobertas";
      els.kpi3Val.textContent = fmtNum(s.discoveries_count ?? (report.new_discoveries || []).length);
      els.kpi3Sub.textContent = report.id === "short_term"
        ? "Fora do seu Top histórico (long_term)"
        : "Artistas no topo do período";

      const ph = s.peak_hour || { label: "—", period: "Noite", plays: 0 };
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
      ? "Ordenado por reproduções reais registradas no seu histórico."
      : "Ranking oficial Spotify ordenado por afinidade/escuta no período (variação compara com 6 meses).";

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
    let statLine = "Faixa nº 1 deste período no Spotify";
    if (obs.max_day_date) {
      statLine = `Recorde: ${fmtNum(obs.max_day_plays)} plays em ${obs.max_day_date.split("-").reverse().join("/")}`;
    } else if (obs.recent_plays > 0) {
      statLine = `Tocou ${obs.recent_plays}x nas suas últimas reproduções`;
    }
    obsInfo.innerHTML = `
      <h4>${escapeHtml(obs.name || "—")}</h4>
      <p>${escapeHtml(obs.artist_names || "—")} · ${escapeHtml(obs.album_name || "")}</p>
      <span class="obsession-stat">${escapeHtml(statLine)}</span>
    `;
    els.obsessionContent.append(obsCover, obsInfo);

    // Genres
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
          Histórico importado offline não traz tags de gênero por artista, mas mostra sua variedade real:
          <strong>${fmtNum(s.unique_albums)} álbuns</strong>, <strong>${fmtNum(s.unique_tracks)} faixas</strong>
          e média de <strong>${(s.repeat_ratio || 1).toFixed(2)}x por música</strong>.
        </p>
      `;
    }

    // Albums
    const albums = (report.top_albums || []).slice(0, 6);
    els.albumsCountBadge.textContent = `${fmtNum(report.summary.unique_albums)} no total`;
    els.topAlbumsGrid.innerHTML = "";
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
        : `${al.unique_tracks} faixa(s) no seu Top 50`;
      meta.innerHTML = `
        <p class="album-title" title="${escapeHtml(al.name)}">${escapeHtml(al.name)}</p>
        <p class="album-artist" title="${escapeHtml(al.artist_name)}">${escapeHtml(al.artist_name)}</p>
        <span class="album-plays">${escapeHtml(metricLine)}</span>
      `;
      card.append(cov, meta);
      els.topAlbumsGrid.appendChild(card);
    });

    // Discoveries
    const discoveries = report.new_discoveries || [];
    els.discoveriesGrid.innerHTML = "";
    if (!discoveries.length) {
      els.discoveriesBadge.textContent = report.hasExactCounts ? "Mês inicial" : "Comparado ao histórico";
      els.discoveriesGrid.innerHTML = `<p class="empty-note span-2">Nenhuma descoberta inédita destacada neste recorte específico.</p>`;
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
    els.rhythmNote.textContent = report.rhythm_source_note || "Horários no fuso local do navegador.";
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
    els.previewStatus.textContent = "Renderizando capas...";
    try {
      await window.SpotifyExporter.renderInstagramCanvas(els.previewCanvas, state.activeReport, getExportOptions());
      if (token === state.renderToken) {
        els.previewStatus.textContent = "Pronto em 1080px";
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

  function selectReport(reportId) {
    if (!state.bundle || !state.bundle.reports.has(reportId)) return;
    state.activeReportId = reportId;
    state.activeReport = state.bundle.reports.get(reportId);
    state.selectedDay = null;
    state.tracksExpanded = false;
    state.artistsExpanded = false;

    renderTimelineBar();
    renderHero(state.activeReport);
    renderRankings(state.activeReport);
    renderCuradoria(state.activeReport);
    renderRhythm(state.activeReport);
    refreshPreview();
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
          "O Spotify exige que o dono do app adicione seu e-mail do Spotify na aba User Management (máximo de 5 amigos por Client ID). Enquanto isso, você pode usar a Opção 2 ao lado (Importar Histórico .json/.zip) sem nenhum limite!"
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
    setStatusBanner("Processando arquivos do Spotify...", "Lendo reproduções e montando todos os meses no seu navegador.", true);
    try {
      const bundle = await window.SpotifyHistoryImporter.parseHistoryFiles(files);
      setStatusBanner("", "");
      showDashboard(bundle);
    } catch (err) {
      setStatusBanner("Não foi possível importar o histórico", err.message);
    }
  }

  function bindEvents() {
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
        saved ? "Agora clique em Entrar com Spotify para conectar." : "Cole um Client ID válido para usar o login oficial.",
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
          "Abra o painel acima, cole o Client ID do app no Spotify Developer Dashboard (com a Redirect URI cadastrada) ou use a Opção 2 / Demonstração."
        );
        return;
      }
      try {
        await window.SpotifyAuth.startLogin(cid);
      } catch (err) {
        setStatusBanner("Erro ao iniciar login OAuth PKCE", err.message);
      }
    });

    els.inputHistoryFiles.addEventListener("change", (e) => {
      handleHistoryUpload(e.target.files);
    });

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
      if (e.dataTransfer && e.dataTransfer.files) {
        handleHistoryUpload(e.dataTransfer.files);
      }
    });

    els.btnTryDemo.addEventListener("click", () => {
      setStatusBanner("", "");
      const demo = window.SpotifyHistoryImporter.createDemoDataset();
      showDashboard(demo);
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
      const token = await window.SpotifyAuth.getValidAccessToken();
      if (token) await loadSpotifySession(token);
      else showWelcomeScreen();
    });

    els.btnSwitchSource.addEventListener("click", () => {
      setStatusBanner("", "");
      showWelcomeScreen();
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

    // Studio
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
    els.btnRefreshData = qs("btn-refresh-data");
    els.btnSwitchSource = qs("btn-switch-source");
    els.btnLogout = qs("btn-logout");
    els.btnJumpStudio = qs("btn-jump-studio");
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
    } else {
      showWelcomeScreen();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
