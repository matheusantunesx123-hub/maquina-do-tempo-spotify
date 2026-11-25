(function (global) {
  "use strict";

  const CACHE_KEY = "stm_cover_cache_v1";
  const MAX_PERSISTED_ITEMS = 400;
  const LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";

  const memCache = loadPersistedCache();
  let cbSeq = 0;

  function loadPersistedCache() {
    const map = new Map();
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return map;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        Object.entries(obj).forEach(([k, v]) => {
          if (typeof v === "string" || v === null) map.set(k, v);
        });
      }
    } catch (_) {}
    return map;
  }

  function savePersistedCache() {
    try {
      const entries = Array.from(memCache.entries());
      const trimmed = entries.length > MAX_PERSISTED_ITEMS
        ? entries.slice(entries.length - MAX_PERSISTED_ITEMS)
        : entries;
      const out = {};
      trimmed.forEach(([k, v]) => {
        if (v) out[k] = v;
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (url.includes(LASTFM_PLACEHOLDER_HASH)) return false;
    return true;
  }

  function jsonpFetch(url, timeoutMs = 4500) {
    return new Promise((resolve) => {
      const cbName = `__dzCb_${Date.now()}_${++cbSeq}`;
      const sep = url.includes("?") ? "&" : "?";
      const fullUrl = `${url}${sep}output=jsonp&callback=${cbName}`;
      const script = document.createElement("script");
      let settled = false;

      function cleanup() {
        try {
          delete global[cbName];
        } catch (_) {
          global[cbName] = undefined;
        }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, timeoutMs);

      global[cbName] = (payload) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(payload);
        }
      };

      script.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }
      };

      script.src = fullUrl;
      document.head.appendChild(script);
    });
  }

  async function searchArtistImage(artistName) {
    const clean = String(artistName || "").trim();
    if (!clean) return null;
    const key = `a:${clean.toLowerCase()}`;
    if (memCache.has(key)) return memCache.get(key);

    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(clean)}&limit=1`;
    const res = await jsonpFetch(url);
    const first = res && Array.isArray(res.data) ? res.data[0] : null;
    const img = first ? (first.picture_big || first.picture_medium || first.picture || null) : null;
    memCache.set(key, img);
    return img;
  }

  async function searchTrackCover(trackName, artistName) {
    const tClean = String(trackName || "").trim();
    const aClean = String(artistName || "").trim();
    if (!tClean) return null;
    const key = `t:${aClean.toLowerCase()}::${tClean.toLowerCase()}`;
    if (memCache.has(key)) return memCache.get(key);

    const q = aClean ? `${aClean} ${tClean}` : tClean;
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=1`;
    const res = await jsonpFetch(url);
    const first = res && Array.isArray(res.data) ? res.data[0] : null;
    const img = first && first.album ? (first.album.cover_big || first.album.cover_medium || first.album.cover || null) : null;
    memCache.set(key, img);
    return img;
  }

  async function runQueue(tasks, concurrency = 3) {
    let idx = 0;
    let changed = false;

    async function worker() {
      while (idx < tasks.length) {
        const current = tasks[idx++];
        try {
          const updated = await current();
          if (updated) changed = true;
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 110));
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return changed;
  }

  async function enrichReportCovers(report, onUpdated) {
    if (!report || report.isDemo) return false;
    if (report._coversEnriched) return false;
    report._coversEnriched = true;

    const tasks = [];
    const albumImgByKey = new Map();

    // 1) Top 8 Artists + Top 4 Discoveries
    (report.top_artists || []).slice(0, 8).forEach((art) => {
      if (!isValidImageUrl(art.image)) {
        art.image = null;
        tasks.push(async () => {
          const img = await searchArtistImage(art.name);
          if (img) {
            art.image = img;
            return true;
          }
          return false;
        });
      }
    });

    (report.new_discoveries || []).slice(0, 4).forEach((disc) => {
      if (!isValidImageUrl(disc.image)) {
        disc.image = null;
        tasks.push(async () => {
          const matched = (report.top_artists || []).find((a) => a.name === disc.name && isValidImageUrl(a.image));
          const img = matched ? matched.image : await searchArtistImage(disc.name);
          if (img) {
            disc.image = img;
            return true;
          }
          return false;
        });
      }
    });

    // 2) Top 8 Tracks
    (report.top_tracks || []).slice(0, 8).forEach((tr) => {
      const existing = tr.album && tr.album.image;
      if (!isValidImageUrl(existing)) {
        if (tr.album) tr.album.image = null;
        tasks.push(async () => {
          const primaryArtist = (tr.artists && tr.artists[0] && tr.artists[0].name) || tr.artist_names || "";
          const img = await searchTrackCover(tr.name, primaryArtist);
          if (img) {
            if (!tr.album) tr.album = { name: "Álbum", image: img };
            else tr.album.image = img;
            albumImgByKey.set(`${(tr.album.name || "").toLowerCase()}::${primaryArtist.toLowerCase()}`, img);
            return true;
          }
          return false;
        });
      } else if (tr.album && tr.album.name) {
        const primaryArtist = (tr.artists && tr.artists[0] && tr.artists[0].name) || tr.artist_names || "";
        albumImgByKey.set(`${tr.album.name.toLowerCase()}::${primaryArtist.toLowerCase()}`, existing);
      }
    });

    // 3) Top 6 Albums
    (report.top_albums || []).slice(0, 6).forEach((al) => {
      if (!isValidImageUrl(al.image)) {
        al.image = null;
        tasks.push(async () => {
          const k = `${(al.name || "").toLowerCase()}::${(al.artist_name || "").toLowerCase()}`;
          let img = albumImgByKey.get(k);
          if (!img) {
            img = await searchTrackCover(al.name, al.artist_name);
          }
          if (img) {
            al.image = img;
            return true;
          }
          return false;
        });
      }
    });

    if (!tasks.length) return false;
    const changed = await runQueue(tasks, 3);

    // Sync obsession image from top_tracks[0]
    if (report.obsession && !isValidImageUrl(report.obsession.album_image)) {
      const t1 = report.top_tracks && report.top_tracks[0];
      if (t1 && t1.album && isValidImageUrl(t1.album.image)) {
        report.obsession.album_image = t1.album.image;
      }
    }

    if (changed) {
      savePersistedCache();
      if (typeof onUpdated === "function") onUpdated(report);
    }
    return changed;
  }

  global.CoverEnricher = {
    isValidImageUrl,
    searchArtistImage,
    searchTrackCover,
    enrichReportCovers
  };
})(window);
