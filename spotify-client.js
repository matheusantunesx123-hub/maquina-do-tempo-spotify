(function (global) {
  "use strict";

  const VAULT_STORAGE_KEY = "stm_friends_vault_v1";

  const MONTH_NAMES_PT = [
    "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const MONTH_SHORT_PT = [
    "", "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
    "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"
  ];
  const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function hourToPeriod(hour) {
    if (hour >= 0 && hour < 6) return "madrugada";
    if (hour >= 6 && hour < 12) return "manha";
    if (hour >= 12 && hour < 18) return "tarde";
    return "noite";
  }

  const PERIOD_LABELS = {
    madrugada: "Madrugada",
    manha: "Manhã",
    tarde: "Tarde",
    noite: "Noite"
  };

  function formatGenreLabel(g) {
    return String(g || "")
      .trim()
      .split(/\s+/)
      .map((w, idx) => {
        const lw = w.toLowerCase();
        if (["mpb", "edm", "r&b", "uk"].includes(lw)) return lw.toUpperCase();
        if (idx > 0 && ["de", "da", "do", "e", "and", "of"].includes(lw)) return lw;
        return lw.charAt(0).toUpperCase() + lw.slice(1);
      })
      .join(" ");
  }

  function simplifyArtist(a, rank, prevRank) {
    const imgs = (a && a.images) || [];
    let rankDelta = null;
    if (prevRank !== undefined) {
      if (prevRank === null) rankDelta = "new";
      else if (prevRank === rank) rankDelta = "same";
      else {
        const d = prevRank - rank;
        rankDelta = d > 0 ? `+${d}` : String(d);
      }
    }
    return {
      rank,
      prev_rank: prevRank ?? null,
      rank_delta: rankDelta,
      id: a.id,
      name: a.name || "Artista",
      url: (a.external_urls && a.external_urls.spotify) || null,
      image: imgs[0] ? imgs[0].url : null,
      genres: a.genres || [],
      popularity: a.popularity ?? null
    };
  }

  function simplifyTrack(t, rank, prevRank) {
    const artists = (t.artists || []).map((ar) => ({
      id: ar.id,
      name: ar.name,
      url: (ar.external_urls && ar.external_urls.spotify) || null
    }));
    const imgs = (t.album && t.album.images) || [];
    let rankDelta = null;
    if (prevRank !== undefined) {
      if (prevRank === null) rankDelta = "new";
      else if (prevRank === rank) rankDelta = "same";
      else {
        const d = prevRank - rank;
        rankDelta = d > 0 ? `+${d}` : String(d);
      }
    }
    return {
      rank,
      prev_rank: prevRank ?? null,
      rank_delta: rankDelta,
      id: t.id,
      name: t.name || "Faixa",
      url: (t.external_urls && t.external_urls.spotify) || null,
      artists,
      artist_names: artists.map((a) => a.name).join(", ") || "Artista",
      album: {
        name: (t.album && t.album.name) || "Álbum",
        image: imgs[0] ? imgs[0].url : null
      },
      duration_ms: Number(t.duration_ms || 0)
    };
  }

  function loadVault() {
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveVault(vault) {
    try {
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
    } catch (_) {}
  }

  function mergeRecentPlaysIntoVault(userId, recentItems) {
    if (!userId) return { playsByMonth: {}, snapshots: {} };
    const vault = loadVault();
    const userVault = vault[userId] || { playsByMonth: {}, snapshots: {} };
    const playsByMonth = userVault.playsByMonth || {};

    (recentItems || []).forEach((item) => {
      const tr = item && item.track;
      const playedAt = item && item.played_at;
      if (!tr || !tr.id || !playedAt) return;
      const dt = new Date(playedAt);
      if (Number.isNaN(dt.getTime())) return;
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const list = playsByMonth[monthKey] || [];
      if (!list.some((x) => x.played_at === playedAt && x.id === tr.id)) {
        const imgs = (tr.album && tr.album.images) || [];
        list.push({
          id: tr.id,
          name: tr.name,
          url: (tr.external_urls && tr.external_urls.spotify) || null,
          artist_names: (tr.artists || []).map((a) => a.name).join(", "),
          artists: (tr.artists || []).map((a) => ({ id: a.id, name: a.name })),
          album: {
            name: (tr.album && tr.album.name) || "Álbum",
            image: imgs[0] ? imgs[0].url : null
          },
          duration_ms: Number(tr.duration_ms || 0),
          played_at: playedAt
        });
      }
      // Mantém limite saudável no localStorage (até 1.500 plays por mês)
      if (list.length > 1500) {
        list.splice(0, list.length - 1500);
      }
      playsByMonth[monthKey] = list;
    });

    userVault.playsByMonth = playsByMonth;
    vault[userId] = userVault;
    saveVault(vault);
    return userVault;
  }

  function computeRecentRhythm(recentItems, vaultMonthPlays) {
    const sourcePlays = (vaultMonthPlays && vaultMonthPlays.length)
      ? vaultMonthPlays
      : (recentItems || [])
          .filter((x) => x && x.track && x.played_at)
          .map((x) => ({
            id: x.track.id,
            name: x.track.name,
            duration_ms: Number(x.track.duration_ms || 0),
            played_at: x.played_at
          }));

    const hourly = new Array(24).fill(0);
    const periodCounts = { madrugada: 0, manha: 0, tarde: 0, noite: 0 };
    const trackCounts = new Map();
    let totalMs = 0;

    sourcePlays.forEach((p) => {
      const dt = new Date(p.played_at);
      if (Number.isNaN(dt.getTime())) return;
      const h = dt.getHours();
      hourly[h] += 1;
      periodCounts[hourToPeriod(h)] += 1;
      totalMs += Number(p.duration_ms || 0);
      if (p.id) {
        trackCounts.set(p.id, (trackCounts.get(p.id) || 0) + 1);
      }
    });

    const total = sourcePlays.length;
    let peakHourIdx = 0;
    for (let h = 1; h < 24; h++) {
      if (hourly[h] > hourly[peakHourIdx]) peakHourIdx = h;
    }

    const periods = {};
    let dominantPeriod = "noite";
    let bestPeriodCount = -1;
    Object.keys(PERIOD_LABELS).forEach((k) => {
      const cnt = periodCounts[k] || 0;
      if (cnt > bestPeriodCount) {
        bestPeriodCount = cnt;
        dominantPeriod = k;
      }
      periods[k] = {
        label: PERIOD_LABELS[k],
        plays: cnt,
        pct: total > 0 ? Number(((cnt / total) * 100).toFixed(1)) : 0
      };
    });

    return {
      totalRecentPlays: total,
      totalRecentMinutes: Math.round(totalMs / 60000),
      hourly,
      periods,
      dominantPeriod,
      peakHour: {
        hour: peakHourIdx,
        label: `${String(peakHourIdx).padStart(2, "0")}h`,
        period: PERIOD_LABELS[hourToPeriod(peakHourIdx)],
        plays: hourly[peakHourIdx]
      },
      trackCounts
    };
  }

  function buildApiPeriodReport(opts) {
    const {
      periodKey,
      label,
      shortLabel,
      editionTag,
      rawArtists,
      rawTracks,
      compareArtists,
      compareTracks,
      longArtists,
      rhythm,
      profile,
      now
    } = opts;

    const compArtistMap = new Map();
    (compareArtists || []).forEach((a, i) => { if (a.id) compArtistMap.set(a.id, i + 1); });
    const compTrackMap = new Map();
    (compareTracks || []).forEach((t, i) => { if (t.id) compTrackMap.set(t.id, i + 1); });
    const longArtistSet = new Set((longArtists || []).map((a) => a.id).filter(Boolean));

    const artists = (rawArtists || []).slice(0, 20).map((a, idx) =>
      simplifyArtist(a, idx + 1, compareArtists ? (compArtistMap.get(a.id) ?? null) : undefined)
    );
    const tracks = (rawTracks || []).slice(0, 20).map((t, idx) =>
      simplifyTrack(t, idx + 1, compareTracks ? (compTrackMap.get(t.id) ?? null) : undefined)
    );

    // Top genres ponderados pela posição dos Top 50 artistas
    const genreScores = new Map();
    (rawArtists || []).forEach((a, idx) => {
      const weight = Math.max(1, 50 - idx);
      (a.genres || []).forEach((g) => {
        const key = String(g).trim().toLowerCase();
        if (key) genreScores.set(key, (genreScores.get(key) || 0) + weight);
      });
    });
    const totalGenreScore = Array.from(genreScores.values()).reduce((s, v) => s + v, 0);
    const topGenres = Array.from(genreScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([g, w]) => ({
        genre: g,
        label: formatGenreLabel(g),
        weight: w,
        pct: totalGenreScore ? Number(((w / totalGenreScore) * 100).toFixed(1)) : 0
      }));

    // Top Albums extraídos das Top 50 faixas do período
    const albumMap = new Map();
    (rawTracks || []).forEach((t, idx) => {
      const alName = (t.album && t.album.name) || "Álbum";
      const arName = (t.artists && t.artists[0] && t.artists[0].name) || "Artista";
      const key = `${alName}::${arName}`;
      const weight = Math.max(1, 50 - idx);
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          name: alName,
          artist_name: arName,
          image: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || null,
          score: 0,
          unique_tracks: 0
        });
      }
      const entry = albumMap.get(key);
      entry.score += weight;
      entry.unique_tracks += 1;
    });
    const topAlbums = Array.from(albumMap.values())
      .sort((a, b) => b.unique_tracks - a.unique_tracks || b.score - a.score)
      .slice(0, 6)
      .map((al, i) => ({
        rank: i + 1,
        name: al.name,
        artist_name: al.artist_name,
        image: al.image,
        plays: null,
        minutes: null,
        unique_tracks: al.unique_tracks
      }));

    // Descobertas (artistas no Top short_term que não aparecem no long_term)
    const discoveries = longArtists && periodKey === "short_term"
      ? (rawArtists || [])
          .filter((a) => a.id && !longArtistSet.has(a.id))
          .slice(0, 8)
          .map((a, i) => ({
            id: a.id,
            name: a.name,
            image: (a.images && a.images[0] && a.images[0].url) || null,
            url: (a.external_urls && a.external_urls.spotify) || null,
            plays: null,
            rank: (rawArtists.indexOf(a) + 1) || (i + 1)
          }))
      : [];

    const topGenreLabel = topGenres[0] ? topGenres[0].label : "Mix Eclético";
    const periodLabel = PERIOD_LABELS[rhythm.dominantPeriod] || "Noite";
    let personalityTag = `Sintonia ${topGenreLabel}`;
    if (rhythm.totalRecentPlays > 0) {
      if (rhythm.dominantPeriod === "madrugada") personalityTag = "Trilha da Madrugada";
      else if (rhythm.dominantPeriod === "noite") personalityTag = "Coruja Noturna";
      else if (rhythm.dominantPeriod === "manha") personalityTag = "Ritmo Matinal";
      else personalityTag = "Sintonia da Tarde";
    }

    const personalitySubtitle = periodKey === "short_term"
      ? `Cápsula das últimas ~4 semanas no Spotify de ${profile.display_name}. Gênero em alta: ${topGenreLabel}; ${discoveries.length} descoberta(s) fora do seu Top histórico.`
      : `Retrato oficial do Spotify de ${profile.display_name} (${label.toLowerCase()}), liderado por ${artists[0] ? artists[0].name : "seus favoritos"} e ${topGenreLabel}.`;

    const tr1 = tracks[0] || {};
    const recentPlaysOfTop1 = tr1.id ? (rhythm.trackCounts.get(tr1.id) || 0) : 0;

    return {
      id: periodKey,
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      year: now.getFullYear(),
      month_number: now.getMonth() + 1,
      label,
      short_label: shortLabel,
      edition_tag: editionTag,
      hasExactCounts: false,
      sourceType: "spotify_api",
      profile,
      summary: {
        total_plays: null,
        total_minutes: null,
        total_hours: null,
        recent_plays_count: rhythm.totalRecentPlays,
        unique_tracks: (rawTracks || []).length,
        unique_artists: (rawArtists || []).length,
        unique_albums: albumMap.size,
        active_days: null,
        longest_streak_days: null,
        peak_day: null,
        peak_hour: rhythm.peakHour,
        periods: rhythm.periods,
        dominant_period: rhythm.dominantPeriod,
        top_genre_label: topGenreLabel,
        discoveries_count: discoveries.length,
        repeat_ratio: null,
        personality_tag: personalityTag,
        personality_subtitle: personalitySubtitle,
        delta_vs_prev: null
      },
      top_tracks: tracks,
      top_artists: artists,
      top_albums: topAlbums,
      obsession: {
        id: tr1.id,
        name: tr1.name || "—",
        artist_names: tr1.artist_names || "—",
        album_name: (tr1.album && tr1.album.name) || "",
        album_image: (tr1.album && tr1.album.image) || null,
        url: tr1.url || null,
        plays: null,
        recent_plays: recentPlaysOfTop1,
        max_day_date: null,
        max_day_plays: null
      },
      new_discoveries: discoveries,
      top_genres: topGenres,
      hourly_distribution: rhythm.hourly,
      daily_calendar: [],
      rhythm_source_note: rhythm.totalRecentPlays > 0
        ? `Baseado nas suas ${rhythm.totalRecentPlays} reproduções recentes no seu fuso horário local (${periodLabel} dominante).`
        : "Sem reproduções recentes retornadas pela API neste momento."
    };
  }

  async function fetchAndBuildBundle(token) {
    const api = global.SpotifyAuth.spotifyFetchJson;
    const me = await api("me", token);

    const [
      artShort, artMed, artLong,
      trkShort, trkMed, trkLong,
      recentRes
    ] = await Promise.all([
      api("me/top/artists?limit=50&time_range=short_term", token).catch(() => ({ items: [] })),
      api("me/top/artists?limit=50&time_range=medium_term", token).catch(() => ({ items: [] })),
      api("me/top/artists?limit=50&time_range=long_term", token).catch(() => ({ items: [] })),
      api("me/top/tracks?limit=50&time_range=short_term", token).catch(() => ({ items: [] })),
      api("me/top/tracks?limit=50&time_range=medium_term", token).catch(() => ({ items: [] })),
      api("me/top/tracks?limit=50&time_range=long_term", token).catch(() => ({ items: [] })),
      api("me/player/recently-played?limit=50", token).catch(() => ({ items: [] }))
    ]);

    const now = new Date();
    const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const curMonthName = `${MONTH_NAMES_PT[now.getMonth() + 1]} ${now.getFullYear()}`;
    const curShortName = `${MONTH_SHORT_PT[now.getMonth() + 1]} ${now.getFullYear()}`;

    const profile = {
      id: me.id,
      display_name: me.display_name || me.id || "Amigo Spotify",
      image: (me.images && me.images[0] && me.images[0].url) || null,
      url: (me.external_urls && me.external_urls.spotify) || null,
      handle: "@" + String(me.display_name || me.id || "spotify")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 18)
    };

    const userVault = mergeRecentPlaysIntoVault(me.id, recentRes.items || []);
    const vaultMonthPlays = userVault.playsByMonth ? userVault.playsByMonth[curMonthKey] : [];
    const rhythm = computeRecentRhythm(recentRes.items || [], vaultMonthPlays);

    const shortReport = buildApiPeriodReport({
      periodKey: "short_term",
      label: `Último Mês · ${curMonthName}`,
      shortLabel: curShortName,
      editionTag: `CÁPSULA ${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`,
      rawArtists: artShort.items || [],
      rawTracks: trkShort.items || [],
      compareArtists: artMed.items || [],
      compareTracks: trkMed.items || [],
      longArtists: artLong.items || [],
      rhythm,
      profile,
      now
    });

    const mediumReport = buildApiPeriodReport({
      periodKey: "medium_term",
      label: "Últimos 6 Meses",
      shortLabel: "6 MESES",
      editionTag: "SEMESTRE · SPOTIFY",
      rawArtists: artMed.items || [],
      rawTracks: trkMed.items || [],
      compareArtists: artLong.items || [],
      compareTracks: trkLong.items || [],
      longArtists: artLong.items || [],
      rhythm,
      profile,
      now
    });

    const longReport = buildApiPeriodReport({
      periodKey: "long_term",
      label: "Todos os Tempos",
      shortLabel: "HISTÓRICO",
      editionTag: "ACERVO COMPLETO",
      rawArtists: artLong.items || [],
      rawTracks: trkLong.items || [],
      compareArtists: null,
      compareTracks: null,
      longArtists: null,
      rhythm,
      profile,
      now
    });

    // Salva snapshot mensal no cofre local do aparelho
    const vault = loadVault();
    const uv = vault[me.id] || { playsByMonth: {}, snapshots: {} };
    uv.snapshots = uv.snapshots || {};
    uv.snapshots[curMonthKey] = {
      ...shortReport,
      id: `snap_${curMonthKey}`,
      snapshot_saved_at: now.toISOString(),
      label: `${curMonthName} (Salvo)`
    };
    vault[me.id] = uv;
    saveVault(vault);

    const reports = new Map();
    reports.set("short_term", shortReport);
    reports.set("medium_term", mediumReport);
    reports.set("long_term", longReport);

    const periodTabs = [
      { id: "short_term", label: "Último Mês (~4 sem)", meta: `${shortReport.top_artists.length} artistas` },
      { id: "medium_term", label: "Últimos 6 Meses", meta: `${mediumReport.top_artists.length} artistas` },
      { id: "long_term", label: "Todos os Tempos", meta: `${longReport.top_artists.length} artistas` }
    ];

    // Adiciona snapshots de meses ANTERIORES salvos no aparelho
    Object.keys(uv.snapshots)
      .filter((k) => k !== curMonthKey)
      .sort()
      .reverse()
      .forEach((mk) => {
        const snap = uv.snapshots[mk];
        reports.set(snap.id, snap);
        periodTabs.push({
          id: snap.id,
          label: snap.label,
          meta: "Snapshot salvo"
        });
      });

    return {
      mode: "spotify_api",
      profile,
      defaultId: "short_term",
      tabs: periodTabs,
      reports,
      allTime: null,
      vaultStats: {
        monthsSaved: Object.keys(uv.snapshots).length,
        recentCachedThisMonth: (vaultMonthPlays || []).length
      }
    };
  }

  function exportVaultJson(userId) {
    const vault = loadVault();
    return JSON.stringify(
      {
        version: 1,
        exported_at: new Date().toISOString(),
        user_id: userId,
        data: vault[userId] || {}
      },
      null,
      2
    );
  }

  function importVaultJson(userId, rawText) {
    const parsed = JSON.parse(rawText);
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || typeof data !== "object") {
      throw new Error("Arquivo de backup inválido.");
    }
    const vault = loadVault();
    const uid = userId || parsed.user_id || "imported";
    vault[uid] = data;
    saveVault(vault);
    return uid;
  }

  global.SpotifyFriendsClient = {
    fetchAndBuildBundle,
    exportVaultJson,
    importVaultJson,
    WEEKDAY_LABELS
  };
})(window);
