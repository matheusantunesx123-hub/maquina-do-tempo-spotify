(function (global) {
  "use strict";

  const LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";

  function monthEpochRange(monthKey) {
    const [yStr, mStr] = String(monthKey).split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!y || !m) return null;
    const start = new Date(y, m - 1, 1, 0, 0, 0);
    const end = new Date(y, m, 0, 23, 59, 59);
    return {
      minTs: Math.floor(start.getTime() / 1000),
      maxTs: Math.floor(end.getTime() / 1000)
    };
  }

  function cleanUsername(raw) {
    return String(raw || "").trim().replace(/^@+/, "");
  }

  // ==========================================================
  // 1. LISTENBRAINZ (100% Aberto, Zero API Key, CORS *)
  // ==========================================================
  function mapListenToNormalized(listen) {
    if (!listen || !listen.track_metadata) return null;
    const meta = listen.track_metadata;
    const info = meta.additional_info || {};
    const name = meta.track_name;
    const artistName = meta.artist_name || "Artista";
    if (!name) return null;

    const tsSec = Number(listen.listened_at || 0);
    if (!tsSec) return null;
    const dt = new Date(tsSec * 1000);
    const ms = Number(info.duration_ms || 205000);
    const url = info.origin_url || null;
    const mbidCaa = meta.mbid_mapping && meta.mbid_mapping.caa_release_mbid;
    const image = mbidCaa ? `https://coverartarchive.org/release/${mbidCaa}/front-500` : null;

    return {
      id: info.spotify_id || listen.recording_msid || `${name}::${artistName}`,
      name,
      artistName,
      albumName: meta.release_name || artistName,
      ms: ms > 0 ? ms : 205000,
      dt,
      url,
      image,
      hasEstimatedDuration: !info.duration_ms
    };
  }

  async function fetchListenBrainzUser(rawUsername, targetMonthOpt) {
    const username = cleanUsername(rawUsername);
    if (!username) {
      throw new Error("Digite seu nome de usuário do ListenBrainz.");
    }

    const baseUrl = `https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/listens`;
    let listens = [];

    if (targetMonthOpt) {
      const range = monthEpochRange(targetMonthOpt);
      if (!range) throw new Error("Mês inválido. Use o formato AAAA-MM.");
      let cursorMax = range.maxTs;
      for (let page = 0; page < 3; page++) {
        const res = await fetch(`${baseUrl}?count=1000&min_ts=${range.minTs}&max_ts=${cursorMax}`);
        if (res.status === 404) {
          throw new Error(`Usuário "${username}" não encontrado no ListenBrainz.`);
        }
        if (!res.ok) {
          throw new Error(`ListenBrainz retornou HTTP ${res.status}.`);
        }
        const json = await res.json();
        const batch = (json && json.payload && json.payload.listens) || [];
        if (!batch.length) break;
        listens = listens.concat(batch);
        const oldest = batch[batch.length - 1].listened_at;
        if (!oldest || oldest <= range.minTs || batch.length < 1000) break;
        cursorMax = oldest - 1;
      }
    } else {
      let cursorMax = null;
      for (let page = 0; page < 2; page++) {
        const q = cursorMax ? `?count=1000&max_ts=${cursorMax}` : "?count=1000";
        const res = await fetch(`${baseUrl}${q}`);
        if (res.status === 404) {
          throw new Error(`Usuário "${username}" não encontrado no ListenBrainz.`);
        }
        if (!res.ok) {
          throw new Error(`ListenBrainz retornou HTTP ${res.status}.`);
        }
        const json = await res.json();
        const batch = (json && json.payload && json.payload.listens) || [];
        if (!batch.length) break;
        listens = listens.concat(batch);
        const oldest = batch[batch.length - 1].listened_at;
        if (!oldest || batch.length < 1000) break;
        cursorMax = oldest - 1;
      }
    }

    const normalized = listens.map(mapListenToNormalized).filter(Boolean);
    if (!normalized.length) {
      throw new Error(
        targetMonthOpt
          ? `Nenhuma música registrada em ${targetMonthOpt} para "${username}".`
          : `Usuário "${username}" ainda não tem reproduções no ListenBrainz. Vincule seu Spotify em listenbrainz.org/settings/music-services/details/.`
      );
    }

    const estimatedOnly = normalized.every((n) => n.hasEstimatedDuration);
    const bundle = global.SpotifyHistoryImporter.buildReportsFromNormalizedPlays(normalized, {
      isDemo: false,
      sourceType: "listenbrainz",
      isEstimatedMinutes: estimatedOnly,
      profile: {
        id: username,
        display_name: username,
        handle: `@${username.toLowerCase()}`,
        image: null
      }
    });

    bundle.mode = "listenbrainz";
    bundle.canPickAnyMonth = true;
    bundle.providerUsername = username;
    return bundle;
  }

  // ==========================================================
  // 2. LAST.FM (Usuários ilimitados com 1 API Key grátis)
  // ==========================================================
  async function lfmGet(params) {
    const qs = new URLSearchParams({ ...params, format: "json" }).toString();
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.error)) {
      const code = data && data.error;
      if (code === 6) throw new Error(`Usuário "${params.user || ""}" não encontrado no Last.fm.`);
      if (code === 10 || code === 26) throw new Error("API Key do Last.fm inválida ou suspensa.");
      if (code === 17) throw new Error("Este perfil do Last.fm está marcado como privado.");
      throw new Error((data && data.message) || `Erro HTTP ${res.status} na API do Last.fm.`);
    }
    return data;
  }

  function extractLastfmImage(images) {
    if (!Array.isArray(images)) return null;
    for (let i = images.length - 1; i >= 0; i--) {
      const url = images[i] && images[i]["#text"];
      if (url && !url.includes(LASTFM_PLACEHOLDER_HASH)) return url;
    }
    return null;
  }

  async function fetchLastfmUser(rawUsername, apiKey, targetMonthOpt) {
    const username = cleanUsername(rawUsername);
    const key = String(apiKey || "").trim();
    if (!username) throw new Error("Digite seu nome de usuário do Last.fm.");
    if (!key) {
      throw new Error("Configure uma API Key gratuita do Last.fm (last.fm/api/account/create) para consultar usuários ilimitados.");
    }

    const infoData = await lfmGet({ method: "user.getinfo", user: username, api_key: key });
    const userObj = (infoData && infoData.user) || {};
    const displayName = userObj.realname || userObj.name || username;
    const profileImg = extractLastfmImage(userObj.image);

    const profile = {
      id: username,
      display_name: displayName,
      handle: `@${username.toLowerCase()}`,
      image: profileImg
    };

    let fromTs;
    let toTs;
    if (targetMonthOpt) {
      const range = monthEpochRange(targetMonthOpt);
      if (!range) throw new Error("Mês inválido. Use AAAA-MM.");
      fromTs = range.minTs;
      toTs = range.maxTs;
    } else {
      const now = new Date();
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
      fromTs = Math.floor(prevStart.getTime() / 1000);
      toTs = Math.floor(now.getTime() / 1000);
    }

    let rawTracks = [];
    for (let page = 1; page <= 5; page++) {
      const recentData = await lfmGet({
        method: "user.getrecenttracks",
        user: username,
        api_key: key,
        limit: 200,
        from: fromTs,
        to: toTs,
        page
      });
      const block = recentData && recentData.recenttracks;
      const list = Array.isArray(block && block.track)
        ? block.track
        : ((block && block.track) ? [block.track] : []);
      if (!list.length) break;
      rawTracks = rawTracks.concat(list);
      const totalPages = Number(block["@attr"] && block["@attr"].totalPages || 1);
      if (page >= totalPages || list.length < 180) break;
    }

    const normalized = rawTracks
      .filter((t) => !(t["@attr"] && t["@attr"].nowplaying === "true") && t.date && t.date.uts)
      .map((t) => {
        const artistName = (t.artist && (t.artist["#text"] || t.artist.name)) || "Artista";
        const albumName = (t.album && t.album["#text"]) || artistName;
        const img = extractLastfmImage(t.image);
        return {
          id: `${t.name}::${artistName}`,
          name: t.name || "Faixa",
          artistName,
          albumName,
          ms: 205000,
          dt: new Date(Number(t.date.uts) * 1000),
          url: t.url || null,
          image: img
        };
      });

    if (normalized.length > 0) {
      const bundle = global.SpotifyHistoryImporter.buildReportsFromNormalizedPlays(normalized, {
        isDemo: false,
        sourceType: "lastfm",
        isEstimatedMinutes: true,
        profile
      });
      bundle.mode = "lastfm";
      bundle.canPickAnyMonth = true;
      bundle.providerUsername = username;
      bundle.providerApiKey = key;
      return bundle;
    }

    // Fallback: se janela exata não teve scrobbles recentes, lê o ranking oficial 1month do Last.fm
    if (!targetMonthOpt) {
      const [topArtRes, topTrkRes] = await Promise.all([
        lfmGet({ method: "user.gettopartists", user: username, api_key: key, period: "1month", limit: 20 }),
        lfmGet({ method: "user.gettoptracks", user: username, api_key: key, period: "1month", limit: 20 })
      ]);
      const arts = ((topArtRes.topartists && topArtRes.topartists.artist) || []).map((a, i) => ({
        rank: i + 1,
        id: a.name,
        name: a.name,
        url: a.url,
        image: extractLastfmImage(a.image),
        genres: [],
        plays: Number(a.playcount || 0),
        minutes: Math.round((Number(a.playcount || 0) * 205) / 60)
      }));
      const trks = ((topTrkRes.toptracks && topTrkRes.toptracks.track) || []).map((t, i) => ({
        rank: i + 1,
        id: `${t.name}::${t.artist && t.artist.name}`,
        name: t.name,
        url: t.url,
        artists: [{ id: t.artist && t.artist.name, name: (t.artist && t.artist.name) || "Artista" }],
        artist_names: (t.artist && t.artist.name) || "Artista",
        album: { name: "Último Mês", image: extractLastfmImage(t.image) },
        plays: Number(t.playcount || 0),
        minutes: Math.round((Number(t.playcount || 0) * 205) / 60)
      }));

      if (!arts.length && !trks.length) {
        throw new Error(`O usuário "${username}" no Last.fm ainda não possui músicas registradas.`);
      }

      const now = new Date();
      const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const totalPlays = trks.reduce((s, x) => s + x.plays, 0) || arts.reduce((s, x) => s + x.plays, 0);
      const totalMinutes = Math.round((totalPlays * 205) / 60);
      const report = {
        id: "1month",
        month: mk,
        year: now.getFullYear(),
        month_number: now.getMonth() + 1,
        label: "Últimos 30 dias · Last.fm",
        short_label: "30 DIAS",
        edition_tag: "LAST.FM · 1 MÊS",
        hasExactCounts: true,
        isEstimatedMinutes: true,
        isDemo: false,
        sourceType: "lastfm",
        profile,
        summary: {
          total_plays: totalPlays,
          total_minutes: totalMinutes,
          total_hours: Number((totalMinutes / 60).toFixed(1)),
          unique_tracks: trks.length,
          unique_artists: arts.length,
          unique_albums: trks.length,
          active_days: 30,
          longest_streak_days: null,
          avg_minutes_per_active_day: Number((totalMinutes / 30).toFixed(1)),
          peak_day: null,
          peak_hour: { hour: 21, label: "21h", period: "Noite", plays: 0 },
          periods: {
            madrugada: { label: "Madrugada", plays: 0, pct: 0 },
            manha: { label: "Manhã", plays: 0, pct: 0 },
            tarde: { label: "Tarde", plays: 0, pct: 0 },
            noite: { label: "Noite", plays: 0, pct: 0 }
          },
          dominant_period: "noite",
          repeat_ratio: 1,
          personality_tag: "Ranking Last.fm",
          personality_subtitle: `Top 20 dos últimos 30 dias de ${displayName} no Last.fm.`,
          delta_vs_prev: null
        },
        top_tracks: trks,
        top_artists: arts,
        top_albums: [],
        obsession: {
          id: trks[0] && trks[0].id,
          name: (trks[0] && trks[0].name) || "—",
          artist_names: (trks[0] && trks[0].artist_names) || "—",
          album_name: "Last.fm",
          album_image: trks[0] && trks[0].album && trks[0].album.image,
          plays: (trks[0] && trks[0].plays) || 0,
          minutes: (trks[0] && trks[0].minutes) || 0
        },
        new_discoveries: [],
        top_genres: [],
        hourly_distribution: new Array(24).fill(0),
        daily_calendar: [],
        rhythm_source_note: "Sem scrobbles recentes detalhados na janela; exibindo parada oficial de 30 dias."
      };

      const reports = new Map([["1month", report]]);
      return {
        mode: "lastfm",
        canPickAnyMonth: true,
        providerUsername: username,
        providerApiKey: key,
        profile,
        defaultId: "1month",
        tabs: [{ id: "1month", label: "Últimos 30 dias", meta: `${totalPlays} scrobbles` }],
        reports,
        evolution: [],
        allTime: { total_plays: totalPlays, total_minutes: totalMinutes, total_hours: report.summary.total_hours, months_count: 1 }
      };
    }

    throw new Error(`Nenhum scrobble encontrado em ${targetMonthOpt} para "${username}".`);
  }

  global.OpenMusicProviders = {
    fetchListenBrainzUser,
    fetchLastfmUser
  };
})(window);
