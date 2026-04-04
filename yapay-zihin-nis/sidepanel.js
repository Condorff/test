'use strict';

/* ================================================================
   Yapay Zihin Nis — Side Panel Logic
   YouTube Data API v3 entegrasyonu ile faceless / AI kanal analizi
   ================================================================ */

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const SK_API  = 'yz_api_key';
const SK_FILT = 'yz_filters';

/* ── Uygulama durumu ── */
const state = {
  apiKey:        '',
  channelAgeDays: 30,
  isScanning:    false,
  results:       [],
};

/* ================================================================
   YouTube API Sinifi
   ================================================================ */
class YouTubeAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async _req(endpoint, params) {
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString());
    const json = await res.json();

    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  /**
   * Video ara — 100 kota birimi / cagri
   * publishedAfter: ISO 8601 string
   * order: 'date' | 'viewCount' | 'rating'
   */
  async searchVideos(query, publishedAfter, { maxResults = 50, order = 'viewCount' } = {}) {
    return this._req('search', {
      part: 'snippet',
      type: 'video',
      q: query,
      publishedAfter,
      maxResults,
      order,
    });
  }

  /**
   * Kanal detaylari — 1 kota birimi / 50 kanal
   */
  async getChannels(ids) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const data = await this._req('channels', {
        part: 'snippet,statistics',
        id: batch.join(','),
        maxResults: 50,
      });
      out.push(...(data.items || []));
    }
    return out;
  }

  /**
   * Kanal yuklemeler oynatma listesi — 1 kota birimi / cagri
   * Kanal ID'si "UC..." -> Oynatma listesi ID'si "UU..."
   */
  async getUploads(channelId, maxResults = 25) {
    const playlistId = 'UU' + channelId.slice(2);
    return this._req('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults,
    });
  }

  /**
   * Video istatistikleri — 1 kota birimi / 50 video
   */
  async getVideoStats(ids) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const data = await this._req('videos', {
        part: 'snippet,statistics',
        id: batch.join(','),
        maxResults: 50,
      });
      out.push(...(data.items || []));
    }
    return out;
  }
}

/* ================================================================
   Yardimci Fonksiyonlar
   ================================================================ */

/** Sayiyi kisalt: 1200 -> 1.2K, 1500000 -> 1.5M */
function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(Math.floor(n));
}

/** ISO tarihten gecen gun sayisi */
function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** Simdi'den X gun oncesinin ISO string'i */
function isoAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** HTML kacis */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ================================================================
   UI Yardimcilari
   ================================================================ */

function setProgress(pct, text) {
  document.getElementById('progressBar').style.width = `${Math.min(100, pct)}%`;
  document.getElementById('progressText').textContent = text;
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden');    }

function setApiStatus(msg, type /* 'ok'|'err' */) {
  const el = document.getElementById('apiStatus');
  el.textContent = msg;
  el.className = `api-status ${type}`;
}

function showError(msg) {
  document.getElementById('errorText').textContent = msg;
  show('errorSection');
}

/* ================================================================
   Sonuclari Render Et
   ================================================================ */

function renderResults(results) {
  const tbody = document.getElementById('resultsBody');

  if (!results.length) {
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="empty-state">
          <div class="empty-icon">&#128269;</div>
          <div class="empty-title">Kanal Bulunamadi</div>
          <div class="empty-hint">
            Filtre ayarlarinizi genisletin ya da farkli<br>
            arama kelimeleri deneyin.
          </div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = results.map((ch, i) => {
    const tv = ch.topVideo;
    const ratio = tv ? parseFloat(tv.ratio) : 0;
    const ratioClass = ratio >= 3 ? 'ratio-hot' : ratio >= 1 ? 'ratio-good' : 'ratio-low';
    const outlierBadge = ch.hasOutlier
      ? `<span class="badge badge-outlier">&#9889; OUTLIER</span>`
      : `<span class="badge badge-normal">Normal</span>`;

    const videoCell = tv
      ? `<span class="vid-title" title="${esc(tv.title)}">${esc(tv.title)}</span>
         <a href="${tv.url}" target="_blank" class="vid-link">&#9654; ${fmt(tv.views)} izlenme</a>`
      : `<span style="color:var(--text3)">—</span>`;

    return `
      <tr class="${ch.hasOutlier ? 'row-outlier' : ''}">
        <td class="cell-rank">${i + 1}</td>
        <td class="cell-channel">
          <span class="ch-name" title="${esc(ch.name)}">${esc(ch.name)}</span>
          <a href="${ch.channelUrl}" target="_blank" class="ch-link">&#8599; Kanala Git</a>
        </td>
        <td><span class="age-pill">${ch.ageDays}g</span></td>
        <td><span class="sub-val">${fmt(ch.subscribers)}</span></td>
        <td class="cell-video">${videoCell}</td>
        <td class="ratio-val ${ratioClass}">${ratio.toFixed(1)}x</td>
        <td>${outlierBadge}</td>
      </tr>`;
  }).join('');
}

function updateStats(results) {
  const outlierCount = results.filter(r => r.hasOutlier).length;
  const avgGrowth = results.length
    ? Math.floor(results.reduce((s, r) => s + r.growthScore, 0) / results.length)
    : 0;

  document.getElementById('statTotal').textContent   = results.length;
  document.getElementById('statOutlier').textContent = outlierCount;
  document.getElementById('statGrowth').textContent  = fmt(avgGrowth);
}

/* ================================================================
   CSV Disa Aktarma
   ================================================================ */

function exportCSV(results) {
  const headers = [
    'Sira', 'Kanal Adi', 'Kanal URL', 'Yas (Gun)', 'Abone',
    'En Iyi Video Basligi', 'Video URL', 'Izlenme', 'Izl/Abo Orani', 'Outlier', 'Buyume Skoru'
  ];

  const rows = results.map((ch, i) => {
    const tv = ch.topVideo;
    return [
      i + 1,
      `"${ch.name.replace(/"/g, '""')}"`,
      ch.channelUrl,
      ch.ageDays,
      ch.subscribers,
      tv ? `"${tv.title.replace(/"/g, '""')}"` : '',
      tv ? tv.url : '',
      tv ? tv.views : '',
      tv ? tv.ratio : '',
      ch.hasOutlier ? 'Evet' : 'Hayir',
      ch.growthScore,
    ].join(',');
  });

  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `yapay-zihin-nis-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ================================================================
   Ana Tarama Fonksiyonu
   ================================================================ */

async function performScan() {
  if (state.isScanning) return;
  state.isScanning = true;

  /* ── Girdi okuma ── */
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showError('Lutfen once YouTube API Key giriniz ve kaydediniz.');
    state.isScanning = false;
    return;
  }

  const minSubs       = parseInt(document.getElementById('minSubs').value)    || 1000;
  const maxSubs       = parseInt(document.getElementById('maxSubs').value)     || 50000;
  const outlierPct    = parseFloat(document.getElementById('outlierPct').value) || 300;
  const outlierMult   = outlierPct / 100;
  const maxChannels   = parseInt(document.getElementById('maxChannels').value) || 60;
  const channelAgeDays = state.channelAgeDays;

  const keywords = document.getElementById('keywords').value
    .split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 0);

  if (!keywords.length) {
    showError('Lutfen en az bir arama kelimesi giriniz.');
    state.isScanning = false;
    return;
  }

  /* ── UI hazirla ── */
  const scanBtn = document.getElementById('scanBtn');
  scanBtn.disabled = true;
  scanBtn.classList.add('scanning');
  document.getElementById('scanBtnText').textContent = 'Taranıyor...';

  hide('errorSection');
  hide('resultsSection');
  hide('statsSection');
  show('progressSection');
  setProgress(0, 'Baslatiliyor...');

  const yt = new YouTubeAPI(apiKey);
  const channelMap = new Map(); // id -> kanal verisi
  const publishedAfter = isoAgo(channelAgeDays);

  try {
    /* ────────────────────────────────────────────────────
       ADIM 1: Her anahtar kelime icin video ara
       Kota: 100 birim x kelime sayisi
    ──────────────────────────────────────────────────── */
    for (let ki = 0; ki < keywords.length; ki++) {
      const kw  = keywords[ki];
      const pct = Math.floor((ki / keywords.length) * 28);
      setProgress(pct, `Arama: "${kw}" (${ki + 1}/${keywords.length})`);

      let searchData;
      try {
        // viewCount sirasinda ara — en cok izlenen yeni videolar
        searchData = await yt.searchVideos(kw, publishedAfter, { maxResults: 50, order: 'viewCount' });
      } catch (err) {
        console.warn(`Arama hatasi (${kw}):`, err.message);
        continue;
      }

      /* Henuz haritada olmayan kanal ID'lerini topla */
      const newIds = [...new Set(
        (searchData.items || []).map(it => it.snippet.channelId)
      )].filter(id => !channelMap.has(id));

      if (!newIds.length) continue;
      if (channelMap.size >= maxChannels * 3) break; // yeterli aday

      /* ────────────────────────────────────────────────────
         ADIM 2: Kanal bilgilerini getir ve filtrele
         Kota: 1 birim / 50 kanal
      ──────────────────────────────────────────────────── */
      let channels;
      try {
        channels = await yt.getChannels(newIds);
      } catch (err) {
        console.warn('Kanal detay hatasi:', err.message);
        continue;
      }

      for (const ch of channels) {
        if (!ch.statistics) continue;
        if (ch.statistics.hiddenSubscriberCount) continue; // gizli abone

        const subs       = parseInt(ch.statistics.subscriberCount || '0');
        const totalViews = parseInt(ch.statistics.viewCount        || '0');
        const ageDays    = daysSince(ch.snippet.publishedAt);

        /* Filtreler */
        if (ageDays    > channelAgeDays) continue; // kanal yasi
        if (subs       < minSubs)        continue; // min abone
        if (subs       > maxSubs)        continue; // max abone

        channelMap.set(ch.id, {
          id:          ch.id,
          name:        ch.snippet.title,
          subscribers: subs,
          totalViews,
          ageDays,
          growthScore: ageDays > 0 ? Math.floor(totalViews / ageDays) : 0,
          channelUrl:  `https://www.youtube.com/channel/${ch.id}`,
          hasOutlier:  false,
          topVideo:    null,
        });
      }
    }

    setProgress(30, `${channelMap.size} kanal bulundu — video analizi basliyor...`);

    /* Hic kanal yoksa erken cik */
    if (!channelMap.size) {
      state.results = [];
      renderResults([]);
      updateStats([]);
      show('statsSection');
      show('resultsSection');
      return;
    }

    /* ────────────────────────────────────────────────────
       ADIM 3: Her kanal icin video analizi
       Kota: 1 + 1 birim / kanal (playlistItems + videos.list)
    ──────────────────────────────────────────────────── */
    const channelList  = Array.from(channelMap.values()).slice(0, maxChannels);
    const totalCh      = channelList.length;

    for (let ci = 0; ci < totalCh; ci++) {
      const ch  = channelList[ci];
      const pct = 30 + Math.floor((ci / totalCh) * 65);
      setProgress(pct, `Video analizi: ${ch.name} (${ci + 1}/${totalCh})`);

      try {
        /* Yuklemeler oynatma listesini getir */
        const plData = await yt.getUploads(ch.id, 25);
        const vidIds = (plData.items || [])
          .map(it => it.contentDetails?.videoId)
          .filter(Boolean);

        if (!vidIds.length) continue;

        /* Video istatistiklerini getir */
        const videos = await yt.getVideoStats(vidIds);
        let   maxViews = -1;

        for (const v of videos) {
          const views    = parseInt(v.statistics?.viewCount || '0');
          const isOutlier = ch.subscribers > 0 && views > ch.subscribers * outlierMult;
          const ratio     = ch.subscribers > 0
            ? (views / ch.subscribers).toFixed(2)
            : views.toFixed(2);

          if (isOutlier) ch.hasOutlier = true;

          if (views > maxViews) {
            maxViews      = views;
            ch.topVideo   = {
              id:       v.id,
              title:    v.snippet?.title || 'Baslıksız',
              views,
              isOutlier,
              ratio,
              url:      `https://www.youtube.com/watch?v=${v.id}`,
            };
          }
        }
      } catch (err) {
        /* Oynatma listesi kısıtlı veya kanal kapalıysa atla */
        console.warn(`Video alınamadı [${ch.name}]:`, err.message);
      }
    }

    setProgress(100, 'Tarama tamamlandi!');

    /* ── Siralama: Outlier kanallar once, sonra buyume skoru ── */
    const results = channelList
      .filter(ch => ch.topVideo !== null)
      .sort((a, b) => {
        if (a.hasOutlier !== b.hasOutlier) return a.hasOutlier ? -1 : 1;
        return b.growthScore - a.growthScore;
      });

    state.results = results;
    renderResults(results);
    updateStats(results);
    show('statsSection');
    show('resultsSection');

  } catch (err) {
    /* Kritik hata (genellikle gecersiz API key ya da kota doldu) */
    let msg = err.message;
    if (msg.includes('quotaExceeded'))  msg = 'API kotasi doldu. Yarin tekrar deneyin.';
    if (msg.includes('keyInvalid'))     msg = 'Gecersiz API Key. Lutfen kontrol edin.';
    if (msg.includes('forbidden'))      msg = 'API Key bu isleme izin vermiyor. YouTube Data API v3 etkinlestirilmis mi?';
    showError(msg);
    console.error('[YZ Nis] Tarama hatasi:', err);

  } finally {
    state.isScanning = false;
    scanBtn.disabled = false;
    scanBtn.classList.remove('scanning');
    document.getElementById('scanBtnText').textContent = 'Nis Taramasi Baslat';
    setTimeout(() => hide('progressSection'), 1800);
  }
}

/* ================================================================
   Chrome Storage
   ================================================================ */

async function saveApiKey(key) {
  await chrome.storage.local.set({ [SK_API]: key });
}

async function loadApiKey() {
  const d = await chrome.storage.local.get(SK_API);
  return d[SK_API] || '';
}

async function saveFilters(obj) {
  await chrome.storage.local.set({ [SK_FILT]: obj });
}

async function loadFilters() {
  const d = await chrome.storage.local.get(SK_FILT);
  return d[SK_FILT] || null;
}

/* ================================================================
   Baslangic
   ================================================================ */

async function init() {
  /* ── Kayitli API Key'i yukle ── */
  const savedKey = await loadApiKey();
  if (savedKey) {
    document.getElementById('apiKey').value = savedKey;
    setApiStatus('API Key yuklendi ✓', 'ok');
  }

  /* ── Kayitli filtreleri yukle ── */
  const saved = await loadFilters();
  if (saved) {
    if (saved.channelAgeDays) {
      state.channelAgeDays = saved.channelAgeDays;
      document.querySelectorAll('.btn-toggle[data-age]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.age) === state.channelAgeDays);
      });
    }
    if (saved.minSubs)        document.getElementById('minSubs').value        = saved.minSubs;
    if (saved.maxSubs)        document.getElementById('maxSubs').value        = saved.maxSubs;
    if (saved.outlierPct)     document.getElementById('outlierPct').value     = saved.outlierPct;
    if (saved.maxChannels)    document.getElementById('maxChannels').value    = saved.maxChannels;
    if (saved.keywords)       document.getElementById('keywords').value       = saved.keywords;
  }

  /* ── API Key kaydet ── */
  document.getElementById('saveApiKey').addEventListener('click', async () => {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) { setApiStatus('API Key bos olamaz!', 'err'); return; }
    await saveApiKey(key);
    setApiStatus('API Key kaydedildi ✓', 'ok');
  });

  /* ── Kanal yasi sec ── */
  document.querySelectorAll('.btn-toggle[data-age]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-toggle[data-age]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.channelAgeDays = parseInt(btn.dataset.age);
    });
  });

  /* ── Tarama baslat ── */
  document.getElementById('scanBtn').addEventListener('click', async () => {
    /* Filtreleri kaydet */
    await saveFilters({
      channelAgeDays: state.channelAgeDays,
      minSubs:        document.getElementById('minSubs').value,
      maxSubs:        document.getElementById('maxSubs').value,
      outlierPct:     document.getElementById('outlierPct').value,
      maxChannels:    document.getElementById('maxChannels').value,
      keywords:       document.getElementById('keywords').value,
    });
    await performScan();
  });

  /* ── CSV aktar ── */
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (state.results.length) exportCSV(state.results);
  });
}

document.addEventListener('DOMContentLoaded', init);
