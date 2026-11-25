(function (global) {
  "use strict";

  const MONTH_NAMES_PT = [
    "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const MONTH_SHORT_PT = [
    "", "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
    "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"
  ];
  const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const PERIOD_LABELS = {
    madrugada: "Madrugada",
    manha: "Manhã",
    tarde: "Tarde",
    noite: "Noite"
  };

  function hourToPeriod(hour) {
    if (hour >= 0 && hour < 6) return "madrugada";
    if (hour >= 6 && hour < 12) return "manha";
    if (hour >= 12 && hour < 18) return "tarde";
    return "noite";
  }

  function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate();
  }

  function longestStreak(daysSet) {
    if (!daysSet.size) return 0;
    const arr = Array.from(daysSet).sort((a, b) => a - b);
    let best = 1;
    let cur = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1] + 1) {
        cur += 1;
        if (cur > best) best = cur;
      } else {
        cur = 1;
      }
    }
    return best;
  }

  function computeDelta(curr, prev) {
    if (prev === null || prev === undefined) return "new";
    const diff = prev - curr;
    if (diff === 0) return "same";
    return diff > 0 ? `+${diff}` : String(diff);
  }

  function pctDiff(curr, prev) {
    if (!prev) return null;
    return Number((((curr - prev) / prev) * 100).toFixed(1));
  }

  function svgCoverDataUrl(title, c1, c2) {
    const ch = String(title || "S").trim().slice(0, 2).toUpperCase();
    const safeTitle = String(title || "").replace(/[<>&"]/g, "").slice(0, 18);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>` +
      `<rect width="320" height="320" fill="url(#g)"/>` +
      `<circle cx="160" cy="144" r="68" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="3"/>` +
      `<circle cx="160" cy="144" r="24" fill="rgba(0,0,0,0.25)"/>` +
      `<text x="160" y="156" text-anchor="middle" fill="#F4F1EA" font-family="Georgia,serif" font-weight="700" font-size="44">${ch}</text>` +
      `<text x="160" y="274" text-anchor="middle" fill="rgba(244,241,234,0.85)" font-family="sans-serif" font-weight="600" font-size="18">${safeTitle}</text>` +
      `</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // Native browser ZIP reader (Store + Deflate via DecompressionStream)
  async function extractJsonTextsFromZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const decoder = new TextDecoder();

    // Find End of Central Directory (0x06054b50)
    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= minSearch; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error("Arquivo .zip inválido (assinatura EOCD não encontrada).");
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let cdOffset = view.getUint32(eocdOffset + 16, true);
    const outFiles = [];

    for (let idx = 0; idx < totalEntries; idx++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
      const compression = view.getUint16(cdOffset + 10, true);
      const compressedSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localHeaderOffset = view.getUint32(cdOffset + 42, true);

      const fileName = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;

      if (!/streaming.*history.*\.json$/i.test(fileName) && !/\.json$/i.test(fileName)) {
        continue;
      }
      if (!/streaming/i.test(fileName)) {
        continue;
      }

      const lNameLen = view.getUint16(localHeaderOffset + 26, true);
      const lExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const compressedBytes = bytes.subarray(dataStart, dataStart + compressedSize);

      let text = "";
      if (compression === 0) {
        text = decoder.decode(compressedBytes);
      } else if (compression === 8) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("Seu navegador não suporta descompressão deflate nativa; extraia os arquivos .json do .zip e envie-os diretamente.");
        }
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressedBytes);
        writer.close();
        const ab = await new Response(ds.readable).arrayBuffer();
        text = decoder.decode(new Uint8Array(ab));
      } else {
        continue;
      }

      outFiles.push({ name: fileName, text });
    }

    return outFiles;
  }

  function normalizeHistoryEntry(raw) {
    if (!raw || typeof raw !== "object") return null;

    // Extended Streaming History format
    if (raw.ts && raw.master_metadata_track_name) {
      const ms = Number(raw.ms_played || 0);
      if (ms < 30000) return null;
      const dt = new Date(raw.ts);
      if (Number.isNaN(dt.getTime())) return null;
      const uri = raw.spotify_track_uri || "";
      const id = uri.startsWith("spotify:track:")
        ? uri.split(":")[2]
        : `${raw.master_metadata_track_name}::${raw.master_metadata_album_artist_name || ""}`;
      return {
        id,
        name: raw.master_metadata_track_name,
        artistName: raw.master_metadata_album_artist_name || "Artista desconhecido",
        albumName: raw.master_metadata_album_album_name || "Álbum",
        ms,
        dt,
        url: uri.startsWith("spotify:track:") ? `https://open.spotify.com/track/${id}` : null,
        image: null
      };
    }

    // Account Data (1 year) format: endTime + msPlayed + trackName + artistName
    if (raw.endTime && raw.trackName) {
      const ms = Number(raw.msPlayed || 0);
      if (ms < 30000) return null;
      const iso = raw.endTime.includes("T")
        ? raw.endTime
        : raw.endTime.replace(" ", "T") + ":00Z";
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) return null;
      const artistName = raw.artistName || "Artista desconhecido";
      return {
        id: `${raw.trackName}::${artistName}`,
        name: raw.trackName,
        artistName,
        albumName: raw.albumName || artistName,
        ms,
        dt,
        url: null,
        image: null
      };
    }

    return null;
  }

  function buildReportsFromNormalizedPlays(allEntries, options = {}) {
    if (!allEntries.length) {
      throw new Error("Nenhuma reprodução válida (>= 30s) foi encontrada nos arquivos enviados.");
    }

    const byMonth = new Map();
    allEntries.forEach((p) => {
      const mk = `${p.dt.getFullYear()}-${String(p.dt.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk).push(p);
    });

    const monthKeys = Array.from(byMonth.keys()).sort();
    const seenArtistsBefore = new Set();
    let prevSummary = null;
    let prevLabel = null;
    let prevTrackRanks = new Map();
    let prevArtistRanks = new Map();

    const reports = new Map();
    const tabs = [];
    const evolution = [];
    let allPlays = 0;
    let allMs = 0;

    monthKeys.forEach((mk, monthIdx) => {
      const plays = byMonth.get(mk);
      const [yearStr, monthStr] = mk.split("-");
      const year = Number(yearStr);
      const monthNum = Number(monthStr);
      const totalDays = daysInMonth(year, monthNum);
      const label = `${MONTH_NAMES_PT[monthNum]} ${year}`;
      const shortLabel = `${MONTH_SHORT_PT[monthNum]} ${year}`;

      let totalMs = 0;
      const hourly = new Array(24).fill(0);
      const periodCounts = { madrugada: 0, manha: 0, tarde: 0, noite: 0 };
      const dailyMap = new Map();
      for (let d = 1; d <= totalDays; d++) {
        dailyMap.set(d, { plays: 0, ms: 0, trackCounts: new Map() });
      }

      const trackAgg = new Map();
      const artistAgg = new Map();
      const albumAgg = new Map();
      const monthArtists = new Set();

      plays.forEach((p) => {
        totalMs += p.ms;
        const h = p.dt.getHours();
        const day = p.dt.getDate();
        hourly[h] += 1;
        periodCounts[hourToPeriod(h)] += 1;

        const dSlot = dailyMap.get(day);
        if (dSlot) {
          dSlot.plays += 1;
          dSlot.ms += p.ms;
          dSlot.trackCounts.set(p.name, (dSlot.trackCounts.get(p.name) || 0) + 1);
        }

        if (!trackAgg.has(p.id)) {
          trackAgg.set(p.id, {
            id: p.id,
            name: p.name,
            artist_names: p.artistName,
            artists: [{ id: p.artistName, name: p.artistName }],
            album: { name: p.albumName, image: p.image || null },
            url: p.url,
            plays: 0,
            totalMs: 0,
            dayCounts: new Map()
          });
        }
        const tr = trackAgg.get(p.id);
        tr.plays += 1;
        tr.totalMs += p.ms;
        const dateKey = `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}`;
        tr.dayCounts.set(dateKey, (tr.dayCounts.get(dateKey) || 0) + 1);

        monthArtists.add(p.artistName);
        if (!artistAgg.has(p.artistName)) {
          artistAgg.set(p.artistName, {
            id: p.artistName,
            name: p.artistName,
            image: p.artistImage || p.image || null,
            plays: 0,
            totalMs: 0,
            tracks: new Set(),
            trackCounts: new Map()
          });
        }
        const ar = artistAgg.get(p.artistName);
        ar.plays += 1;
        ar.totalMs += p.ms;
        ar.tracks.add(p.id);
        ar.trackCounts.set(p.name, (ar.trackCounts.get(p.name) || 0) + 1);

        const alKey = `${p.albumName}::${p.artistName}`;
        if (!albumAgg.has(alKey)) {
          albumAgg.set(alKey, {
            name: p.albumName,
            artist_name: p.artistName,
            image: p.image || null,
            plays: 0,
            totalMs: 0,
            tracks: new Set()
          });
        }
        const al = albumAgg.get(alKey);
        al.plays += 1;
        al.totalMs += p.ms;
        al.tracks.add(p.id);
      });

      allPlays += plays.length;
      allMs += totalMs;
      const totalMinutes = Math.round(totalMs / 60000);
      const totalHours = Number((totalMs / 3600000).toFixed(1));

      const activeDaysSet = new Set();
      let peakDayNum = 1;
      let peakDayPlays = -1;
      dailyMap.forEach((slot, d) => {
        if (slot.plays > 0) activeDaysSet.add(d);
        if (slot.plays > peakDayPlays) {
          peakDayPlays = slot.plays;
          peakDayNum = d;
        }
      });

      const peakDateObj = new Date(year, monthNum - 1, peakDayNum);
      const peakWd = (peakDateObj.getDay() + 6) % 7;
      const peakSlot = dailyMap.get(peakDayNum);
      let peakTopTrack = null;
      let peakTopTrackCount = 0;
      peakSlot.trackCounts.forEach((cnt, tname) => {
        if (cnt > peakTopTrackCount) {
          peakTopTrackCount = cnt;
          peakTopTrack = tname;
        }
      });

      let peakHourIdx = 0;
      for (let h = 1; h < 24; h++) {
        if (hourly[h] > hourly[peakHourIdx]) peakHourIdx = h;
      }

      const periods = {};
      let dominantPeriod = "noite";
      let bestP = -1;
      Object.keys(PERIOD_LABELS).forEach((k) => {
        const cnt = periodCounts[k] || 0;
        if (cnt > bestP) {
          bestP = cnt;
          dominantPeriod = k;
        }
        periods[k] = {
          label: PERIOD_LABELS[k],
          plays: cnt,
          pct: Number(((cnt / plays.length) * 100).toFixed(1))
        };
      });

      const repeatRatio = Number((plays.length / Math.max(trackAgg.size, 1)).toFixed(2));
      const personalityTag = repeatRatio >= 2.2
        ? "Viciado no Repeat"
        : (dominantPeriod === "madrugada" ? "Trilha da Madrugada"
          : dominantPeriod === "noite" ? "Coruja Noturna"
          : dominantPeriod === "manha" ? "Ritmo Matinal" : "Sintonia da Tarde");
      const minNote = options.isEstimatedMinutes ? " (duração estimada por faixa)" : "";
      const personalitySubtitle = `Pico às ${String(peakHourIdx).padStart(2, "0")}h no fuso local, com ${artistAgg.size} artistas em ${plays.length} reproduções reais${minNote}.`;

      const sortedTracks = Array.from(trackAgg.values()).sort((a, b) => b.plays - a.plays || b.totalMs - a.totalMs);
      const currTrackRanks = new Map(sortedTracks.map((t, i) => [t.id, i + 1]));
      const topTracks = sortedTracks.slice(0, 20).map((t, i) => ({
        rank: i + 1,
        prev_rank: prevTrackRanks.get(t.id) ?? null,
        rank_delta: computeDelta(i + 1, prevTrackRanks.get(t.id) ?? null),
        id: t.id,
        name: t.name,
        url: t.url,
        artists: t.artists,
        artist_names: t.artist_names,
        album: t.album,
        plays: t.plays,
        minutes: Math.round(t.totalMs / 60000)
      }));

      const sortedArtists = Array.from(artistAgg.values()).sort((a, b) => b.plays - a.plays || b.totalMs - a.totalMs);
      const currArtistRanks = new Map(sortedArtists.map((a, i) => [a.id, i + 1]));
      const topArtists = sortedArtists.slice(0, 20).map((a, i) => {
        let topTrackName = null;
        let bestTc = 0;
        a.trackCounts.forEach((cnt, nm) => {
          if (cnt > bestTc) { bestTc = cnt; topTrackName = nm; }
        });
        return {
          rank: i + 1,
          prev_rank: prevArtistRanks.get(a.id) ?? null,
          rank_delta: computeDelta(i + 1, prevArtistRanks.get(a.id) ?? null),
          id: a.id,
          name: a.name,
          url: null,
          image: a.image,
          genres: [],
          plays: a.plays,
          minutes: Math.round(a.totalMs / 60000),
          top_track_name: topTrackName
        };
      });

      const topAlbums = Array.from(albumAgg.values())
        .sort((a, b) => b.plays - a.plays || b.totalMs - a.totalMs)
        .slice(0, 6)
        .map((al, i) => ({
          rank: i + 1,
          name: al.name,
          artist_name: al.artist_name,
          image: al.image,
          plays: al.plays,
          minutes: Math.round(al.totalMs / 60000),
          unique_tracks: al.tracks.size
        }));

      const discoveries = [];
      let newArtistsCount = monthArtists.size;
      if (monthIdx > 0) {
        newArtistsCount = 0;
        sortedArtists.forEach((a) => {
          if (!seenArtistsBefore.has(a.name)) {
            newArtistsCount += 1;
            if (discoveries.length < 8) {
              discoveries.push({
                id: a.id,
                name: a.name,
                image: a.image,
                plays: a.plays,
                minutes: Math.round(a.totalMs / 60000),
                url: null
              });
            }
          }
        });
      }

      const dailyCalendar = [];
      for (let d = 1; d <= totalDays; d++) {
        const dtDay = new Date(year, monthNum - 1, d);
        const wd = (dtDay.getDay() + 6) % 7;
        const slot = dailyMap.get(d);
        let topT = null;
        let topTc = 0;
        slot.trackCounts.forEach((cnt, nm) => {
          if (cnt > topTc) { topTc = cnt; topT = nm; }
        });
        dailyCalendar.push({
          date: `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`,
          day: d,
          weekday: wd,
          weekday_label: WEEKDAY_LABELS[wd],
          plays: slot.plays,
          minutes: Math.round(slot.ms / 60000),
          top_track: topT
        });
      }

      const tr1 = sortedTracks[0];
      let maxDayDate = null;
      let maxDayPlays = 0;
      tr1.dayCounts.forEach((cnt, dkey) => {
        if (cnt > maxDayPlays) { maxDayPlays = cnt; maxDayDate = dkey; }
      });

      const deltaVsPrev = prevSummary
        ? {
            prev_month: prevLabel.month,
            prev_label: prevLabel.label,
            plays_diff: plays.length - prevSummary.total_plays,
            plays_pct: pctDiff(plays.length, prevSummary.total_plays),
            minutes_diff: totalMinutes - prevSummary.total_minutes,
            minutes_pct: pctDiff(totalMinutes, prevSummary.total_minutes),
            new_artists_count: newArtistsCount
          }
        : null;

      const summaryObj = {
        total_plays: plays.length,
        total_minutes: totalMinutes,
        total_hours: totalHours,
        unique_tracks: trackAgg.size,
        unique_artists: artistAgg.size,
        unique_albums: albumAgg.size,
        active_days: activeDaysSet.size,
        longest_streak_days: longestStreak(activeDaysSet),
        avg_minutes_per_active_day: activeDaysSet.size ? Number((totalMinutes / activeDaysSet.size).toFixed(1)) : 0,
        peak_day: {
          date: `${yearStr}-${monthStr}-${String(peakDayNum).padStart(2, "0")}`,
          day: peakDayNum,
          weekday_label: WEEKDAY_LABELS[peakWd],
          plays: peakSlot.plays,
          minutes: Math.round(peakSlot.ms / 60000),
          top_track: peakTopTrack
        },
        peak_hour: {
          hour: peakHourIdx,
          label: `${String(peakHourIdx).padStart(2, "0")}h`,
          period: PERIOD_LABELS[hourToPeriod(peakHourIdx)],
          plays: hourly[peakHourIdx]
        },
        periods,
        dominant_period: dominantPeriod,
        repeat_ratio: repeatRatio,
        personality_tag: personalityTag,
        personality_subtitle: personalitySubtitle,
        delta_vs_prev: deltaVsPrev
      };

      const report = {
        id: mk,
        month: mk,
        year,
        month_number: monthNum,
        label,
        short_label: shortLabel,
        edition_tag: `EDIÇÃO ${monthStr}/${year}`,
        hasExactCounts: true,
        isEstimatedMinutes: Boolean(options.isEstimatedMinutes),
        isDemo: Boolean(options.isDemo),
        sourceType: options.sourceType || (options.isDemo ? "demo" : "history_import"),
        profile: options.profile || { display_name: "Histórico Importado", handle: "@spotify", image: null },
        summary: summaryObj,
        top_tracks: topTracks,
        top_artists: topArtists,
        top_albums: topAlbums,
        obsession: {
          id: tr1.id,
          name: tr1.name,
          artist_names: tr1.artist_names,
          album_name: tr1.album.name,
          album_image: tr1.album.image,
          url: tr1.url,
          plays: tr1.plays,
          minutes: Math.round(tr1.totalMs / 60000),
          max_day_date: maxDayDate,
          max_day_plays: maxDayPlays
        },
        new_discoveries: discoveries,
        top_genres: options.genresByMonth ? (options.genresByMonth[mk] || []) : [],
        hourly_distribution: hourly,
        daily_calendar: dailyCalendar,
        rhythm_source_note: `Horários calculados no seu fuso local (${plays.length} reproduções no mês).`
      };

      reports.set(mk, report);
      evolution.push({ month: mk, short_label: shortLabel, label, total_minutes: totalMinutes, total_plays: plays.length });
      tabs.unshift({ id: mk, label, meta: `${plays.length} plays` });

      seenArtistsBefore.update ? null : null;
      monthArtists.forEach((an) => seenArtistsBefore.add(an));
      prevSummary = summaryObj;
      prevLabel = { month: mk, label };
      prevTrackRanks = currTrackRanks;
      prevArtistRanks = currArtistRanks;
    });

    const latestId = monthKeys[monthKeys.length - 1];
    return {
      mode: options.isDemo ? "demo" : "history_import",
      isDemo: Boolean(options.isDemo),
      profile: options.profile || { display_name: "Histórico Importado", handle: "@spotify", image: null },
      defaultId: latestId,
      tabs,
      reports,
      evolution,
      allTime: {
        total_plays: allPlays,
        total_minutes: Math.round(allMs / 60000),
        total_hours: Number((allMs / 3600000).toFixed(1)),
        months_count: monthKeys.length
      }
    };
  }

  async function parseHistoryFiles(fileList) {
    const jsonPayloads = [];

    for (const item of Array.from(fileList || [])) {
      if (item && typeof item.text === "string") {
        jsonPayloads.push(item.text);
        continue;
      }
      if (!item || typeof item.name !== "string") continue;

      if (/\.zip$/i.test(item.name)) {
        const buf = await item.arrayBuffer();
        const extracted = await extractJsonTextsFromZip(buf);
        extracted.forEach((ex) => jsonPayloads.push(ex.text));
      } else if (/\.json$/i.test(item.name)) {
        const text = await item.text();
        jsonPayloads.push(text);
      }
    }

    const allEntries = [];
    for (const text of jsonPayloads) {
      let arr;
      try {
        arr = JSON.parse(text);
      } catch (_) {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        const norm = normalizeHistoryEntry(raw);
        if (norm) allEntries.push(norm);
      }
    }

    return buildReportsFromNormalizedPlays(allEntries, {
      isDemo: false,
      profile: { display_name: "Meu Histórico Spotify", handle: "@meu_spotify", image: null }
    });
  }

  function createDemoDataset() {
    const tracksCatalog = [
      { name: "Veludo Noturno", artist: "Marina Sena", album: "Vício Inerente", c1: "#143D2B", c2: "#0A1B14", ac1: "#2A6B4C", ac2: "#122C20" },
      { name: "Frequência 433", artist: "Urias", album: "HER MIND", c1: "#582419", c2: "#22100B", ac1: "#8C3B2B", ac2: "#3B1912" },
      { name: "Neon na Rodovia", artist: "DUDA BEAT", album: "Tara e Tal", c1: "#3D4C1D", c2: "#19200C", ac1: "#647C30", ac2: "#293313" },
      { name: "Sombra & Sal", artist: "Marisa Monte", album: "Portas", c1: "#1C3F4D", c2: "#0B1B22", ac1: "#2D647A", ac2: "#132D38" },
      { name: "Sinal Aberto", artist: "Tim Bernardes", album: "Mil Coisas Invisíveis", c1: "#614217", c2: "#261909", ac1: "#946524", ac2: "#3E290F" },
      { name: "Chuva de Prata", artist: "Gal Costa", album: "Plural", c1: "#4C2E1B", c2: "#1E120A", ac1: "#7B4A2C", ac2: "#321D11" },
      { name: "Madrugada Elétrica", artist: "Jaloo", album: "MAU", c1: "#1B443B", c2: "#0B1D19", ac1: "#2A6B5C", ac2: "#112E28" },
      { name: "Lua de Vidro", artist: "Liniker", album: "CAJU", c1: "#5C3915", c2: "#231608", ac1: "#8D5821", ac2: "#39230D" }
    ].map((t) => ({
      ...t,
      image: svgCoverDataUrl(t.album, t.c1, t.c2),
      artistImage: svgCoverDataUrl(t.artist, t.ac1, t.ac2)
    }));

    const entries = [];
    const months = [
      { year: 2026, month: 9, counts: [18, 12, 14, 10, 8, 6, 4, 2] },
      { year: 2026, month: 10, counts: [14, 22, 16, 12, 9, 10, 6, 5] },
      { year: 2026, month: 11, counts: [24, 28, 17, 15, 11, 8, 12, 14] }
    ];

    months.forEach((m) => {
      let dayCursor = 1;
      m.counts.forEach((qty, tIdx) => {
        const meta = tracksCatalog[tIdx];
        for (let i = 0; i < qty; i++) {
          const day = ((dayCursor + i * 2) % 27) + 1;
          const hour = (21 + i * 3 + tIdx) % 24;
          const dt = new Date(m.year, m.month - 1, day, hour, (i * 11) % 59, 0);
          entries.push({
            id: `demo_${tIdx}`,
            name: meta.name,
            artistName: meta.artist,
            albumName: meta.album,
            ms: 195000 + (tIdx * 12000),
            dt,
            url: null,
            image: meta.image,
            artistImage: meta.artistImage
          });
        }
        dayCursor += 3;
      });
    });

    const genresDemo = {
      "2026-09": [{ genre: "mpb", label: "MPB", weight: 40, pct: 46 }, { genre: "pop brasileiro", label: "Pop Brasileiro", weight: 28, pct: 32 }, { genre: "indie", label: "Indie", weight: 19, pct: 22 }],
      "2026-10": [{ genre: "pop brasileiro", label: "Pop Brasileiro", weight: 45, pct: 48 }, { genre: "mpb", label: "MPB", weight: 30, pct: 32 }, { genre: "synthpop", label: "Synthpop", weight: 18, pct: 20 }],
      "2026-11": [{ genre: "pop brasileiro", label: "Pop Brasileiro", weight: 52, pct: 44 }, { genre: "mpb", label: "MPB", weight: 38, pct: 32 }, { genre: "alt r&b", label: "Alt R&B", weight: 28, pct: 24 }]
    };

    return buildReportsFromNormalizedPlays(entries, {
      isDemo: true,
      genresByMonth: genresDemo,
      profile: {
        display_name: "Modo Demonstração",
        handle: "@amigo_demo",
        image: svgCoverDataUrl("Demo", "#1ED760", "#0D2D19")
      }
    });
  }

  global.SpotifyHistoryImporter = {
    parseHistoryFiles,
    buildReportsFromNormalizedPlays,
    createDemoDataset,
    svgCoverDataUrl
  };
})(window);
