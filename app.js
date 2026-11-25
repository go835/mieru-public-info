const seed = [
  { id: 'official-1', source: 'official', category: 'delay', location: '都営バス・都心エリア', message: '道路混雑の影響で、一部路線に遅れが発生しています。最新の車両位置と運行情報をご確認ください。', createdAt: Date.now() - 7 * 60000, confirmations: 0, lastConfirmedAt: Date.now() - 7 * 60000 },
  { id: 'user-1', source: 'user', category: 'delay', location: '都営バス・新宿駅西口付近', message: 'バスの到着が通常より遅れています。停留所の案内では道路混雑のためとのことです。', createdAt: Date.now() - 4 * 60000, confirmations: 12, lastConfirmedAt: Date.now() - 2 * 60000 },
  { id: 'user-2', source: 'user', category: 'incident', location: '都営バス・大手町周辺', message: '車道の混雑でバスがゆっくり進んでいます。お急ぎの場合は時間に余裕をもってください。', createdAt: Date.now() - 24 * 60000, confirmations: 5, lastConfirmedAt: Date.now() - 11 * 60000 },
  { id: 'official-2', source: 'official', category: 'weather', location: '東京都防災情報', message: '大雨に関する注意報が発表されています。道路冠水などに注意し、最新の気象・運行情報をご確認ください。', createdAt: Date.now() - 43 * 60000, confirmations: 0, lastConfirmedAt: Date.now() - 43 * 60000 }
];

const labels = { suspension: '🚌 運休・運行見合わせ', delay: '🕐 遅延', resume: '🔄 運行再開', incident: '⚠️ 事故・トラブル', disaster: '🌪️ 災害', evacuation: '🚨 避難・誘導', weather: '🌪️ 防災・気象情報', other: 'ℹ️ その他' };
const storageKey = 'mieru-public-posts-v1';
let posts = JSON.parse(localStorage.getItem(storageKey) || 'null') || seed;
let filter = 'all';
const favoritesKey = 'mieru-public-favorites-v1';
let favorites = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
const hiddenAfterMs = 2 * 60 * 60 * 1000;
const feed = document.querySelector('#feed');
const empty = document.querySelector('#empty-state');
const dialog = document.querySelector('#post-dialog');
let vehicleMap;
let vehicleLayer;
let hasFittedVehicleMap = false;

function relativeTime(date) { const min = Math.max(0, Math.floor((Date.now() - date) / 60000)); return min < 1 ? 'たった今' : min < 60 ? `${min}分前` : `${Math.floor(min / 60)}時間前`; }
function freshness(date) { const min = (Date.now() - date) / 60000; return min <= 5 ? ['green', '5分以内に確認'] : min <= 30 ? ['warn', '30分以内に確認'] : ['old', '1時間以上前']; }
function escapeHtml(text) { const el = document.createElement('div'); el.textContent = text; return el.innerHTML; }
function save() { localStorage.setItem(storageKey, JSON.stringify(posts)); }
function isHidden(post) { return Date.now() - post.lastConfirmedAt > hiddenAfterMs; }
function saveFavorites() { localStorage.setItem(favoritesKey, JSON.stringify(favorites)); }
function count(post, key) { return post[key] || 0; }
function confidence(post) { return Math.max(8, Math.min(99, 48 + count(post, 'confirmations') * 3 - count(post, 'notConfirmed') * 9)); }
function decodeProto(bytes) {
  let offset = 0; const fields = {};
  const readVarint = () => { let value = 0, shift = 0, byte; do { byte = bytes[offset++]; value += (byte & 127) * (2 ** shift); shift += 7; } while (byte & 128 && offset < bytes.length); return value; };
  while (offset < bytes.length) {
    const tag = readVarint(), field = tag >> 3, wire = tag & 7;
    if (!field) break;
    let value;
    if (wire === 0) value = readVarint();
    else if (wire === 2) { const length = readVarint(); value = bytes.slice(offset, offset + length); offset += length; }
    else if (wire === 5) { value = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true); offset += 4; }
    else if (wire === 1) { offset += 8; continue; }
    else break;
    (fields[field] ||= []).push({ wire, value });
  }
  return fields;
}
function getField(message, number) { return message[number]?.[0]?.value; }
function asText(value) { return value instanceof Uint8Array ? new TextDecoder().decode(value) : ''; }
function parseToeiBus(buffer) {
  const feed = decodeProto(new Uint8Array(buffer));
  return (feed[2] || []).map(({ value: entity }) => {
    const fields = decodeProto(entity), vehicle = getField(fields, 4); // ToeiBus GTFS-RT feed uses field 4 for vehicle position
    if (!(vehicle instanceof Uint8Array)) return null;
    const position = decodeProto(vehicle), trip = decodeProto(getField(position, 1) || new Uint8Array()), coords = decodeProto(getField(position, 2) || new Uint8Array()), descriptor = decodeProto(getField(position, 8) || new Uint8Array());
    const latitude = getField(coords, 1), longitude = getField(coords, 2);
    return { id: asText(getField(descriptor, 1)) || asText(getField(fields, 1)) || '車両', route: asText(getField(trip, 5)) || '路線情報なし', trip: asText(getField(trip, 1)), latitude, longitude, timestamp: getField(position, 5) };
  }).filter(vehicle => Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude) && vehicle.latitude > 35 && vehicle.latitude < 36 && vehicle.longitude > 139 && vehicle.longitude < 140.5);
}
function renderVehicleMap(vehicles) {
  const status = document.querySelector('#vehicle-status');
  if (!vehicles.length) { status.textContent = '車両位置データを読み込めませんでした'; return; }
  if (!window.L) { status.textContent = '地図ライブラリを読み込めませんでした'; return; }
  if (!vehicleMap) {
    vehicleMap = L.map('bus-map', { scrollWheelZoom: false }).setView([35.68, 139.77], 11);
    if (location.protocol !== 'file:') {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(vehicleMap);
    } else {
      const localNotice = L.control({ position: 'bottomleft' });
      localNotice.onAdd = () => { const element = L.DomUtil.create('div', 'map-local-note'); element.textContent = 'ローカル確認中：実地図は http://localhost:8788 で表示されます'; return element; };
      localNotice.addTo(vehicleMap);
    }
    vehicleLayer = L.layerGroup().addTo(vehicleMap);
  }
  vehicleLayer.clearLayers();
  const bounds = [];
  vehicles.forEach(vehicle => {
    const marker = L.circleMarker([vehicle.latitude, vehicle.longitude], { radius: 5, color: '#0f5e91', weight: 2, fillColor: '#ffffff', fillOpacity: 1 });
    marker.bindTooltip(`${escapeHtml(vehicle.route)} · ${escapeHtml(vehicle.id)}`);
    marker.on('click', () => showVehicleDetail(vehicle));
    marker.addTo(vehicleLayer); bounds.push([vehicle.latitude, vehicle.longitude]);
  });
  if (!hasFittedVehicleMap && bounds.length) { vehicleMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 }); hasFittedVehicleMap = true; }
  const newest = Math.max(...vehicles.map(v => v.timestamp || 0));
  status.textContent = `${vehicles.length}台を表示 · 更新 ${newest ? new Date(newest * 1000).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '時刻なし'}${location.protocol === 'file:' ? ' · ローカル確認中' : ''}`;
}
function showVehicleDetail(vehicle) { document.querySelector('#bus-detail').innerHTML = `<span class="bus-icon" aria-hidden="true">🚌</span><p class="eyebrow">VEHICLE DETAIL</p><h3>${escapeHtml(vehicle.route)} <small>車両 ${escapeHtml(vehicle.id)}</small></h3><dl><div><dt>最終更新</dt><dd>${vehicle.timestamp ? new Date(vehicle.timestamp * 1000).toLocaleString('ja-JP') : '不明'}</dd></div><div><dt>運行便</dt><dd>${escapeHtml(vehicle.trip || '—')}</dd></div></dl><p class="detail-note">位置情報はデータ提供元の更新内容に従います。</p>`; }
async function loadVehicles() {
  try { const response = await fetch(`ToeiBus?refresh=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error('load failed'); renderVehicleMap(parseToeiBus(await response.arrayBuffer())); }
  catch { document.querySelector('#vehicle-status').textContent = '位置データを読み込めませんでした。公開環境で再度お試しください。'; }
}
function render() {
  const hiddenCount = posts.filter(isHidden).length;
  const shown = posts.filter(p => !isHidden(p) && (filter === 'all' || p.source === filter)).sort((a,b) => b.lastConfirmedAt - a.lastConfirmedAt);
  document.querySelector('#feed-count').textContent = `${shown.length}件の情報`;
  const hiddenNotice = document.querySelector('#hidden-notice');
  hiddenNotice.hidden = hiddenCount === 0;
  hiddenNotice.textContent = hiddenCount ? `${hiddenCount}件の古い情報を一覧から隠しています。JSONデータには残ります。` : '';
  feed.innerHTML = shown.map(post => {
    const [state, freshText] = freshness(post.lastConfirmedAt);
    const official = post.source === 'official';
    const trust = confidence(post);
    return `<article class="card ${post.source}"><div class="card-top"><span class="category">${labels[post.category] || labels.other}</span><span class="source"><i class="dot"></i>${official ? '公式情報' : '市民からの情報'}</span></div><h3>${escapeHtml(post.location)}</h3><p class="message">${escapeHtml(post.message)}</p><div class="meta"><div class="freshness"><i class="fresh-dot ${state}"></i><span>${freshText} <span aria-label="投稿時刻">· 投稿 ${relativeTime(post.createdAt)}</span></span></div></div>${official ? '<p class="disclaimer">発信元：公的機関・交通事業者の公開情報（デモ表示）</p>' : `<div class="confidence"><strong>現在の信頼度</strong><div class="confidence-bar"><i style="width:${trust}%"></i></div><span>${trust}%</span></div><div class="reactions"><button class="reaction ${post.confirmedByMe ? 'active' : ''}" data-reaction="confirm" data-id="${post.id}" type="button">現地で確認した ${count(post,'confirmations')}</button><button class="reaction negative ${post.notConfirmedByMe ? 'active' : ''}" data-reaction="not-confirm" data-id="${post.id}" type="button">確認していない ${count(post,'notConfirmed')}</button><button class="reaction ${post.helpfulByMe ? 'active' : ''}" data-reaction="helpful" data-id="${post.id}" type="button">役に立った ${count(post,'helpful')}</button></div><p class="disclaimer">最終確認：${relativeTime(post.lastConfirmedAt)} · 公式発表ではありません</p>`}</article>`;
  }).join('');
  empty.hidden = shown.length !== 0;
  renderFavorites();
  notifyFavoriteDelays();
}

function renderFavorites() {
  const list = document.querySelector('#favorites-list');
  list.innerHTML = favorites.length ? favorites.map((favorite, index) => `<li>${escapeHtml(favorite)}<button data-remove-favorite="${index}" type="button" aria-label="${escapeHtml(favorite)} を削除">×</button></li>`).join('') : '<li class="no-favorites">まだ登録されていません。</li>';
  const button = document.querySelector('#notification-button');
  const enabled = 'Notification' in window && Notification.permission === 'granted';
  button.textContent = enabled ? '✓ 遅延通知が有効です' : '遅延通知を有効にする';
  button.classList.toggle('enabled', enabled);
}
function notifyFavoriteDelays() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !favorites.length) return;
  const seenKey = 'mieru-public-notified-posts';
  const seen = new Set(JSON.parse(sessionStorage.getItem(seenKey) || '[]'));
  posts.filter(post => post.category === 'delay' && favorites.some(favorite => `${post.location} ${post.message}`.toLowerCase().includes(favorite.toLowerCase()))).forEach(post => {
    if (seen.has(post.id)) return;
    new Notification('みえる公共情報：遅延のお知らせ', { body: `${post.location} — ${post.message.slice(0, 80)}` });
    seen.add(post.id);
  });
  sessionStorage.setItem(seenKey, JSON.stringify([...seen].slice(-100)));
}

document.querySelectorAll('[data-open-post]').forEach(b => b.addEventListener('click', () => dialog.showModal()));
document.querySelectorAll('[data-close-post]').forEach(b => b.addEventListener('click', () => dialog.close()));
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === button)); render(); }));
document.querySelector('#favorite-form').addEventListener('submit', event => {
  event.preventDefault(); const input = document.querySelector('#favorite-input'); const value = input.value.trim();
  if (!value || favorites.some(favorite => favorite.toLowerCase() === value.toLowerCase())) return;
  favorites.push(value); saveFavorites(); input.value = ''; renderFavorites(); notifyFavoriteDelays(); toast(`${value} をお気に入りに登録しました。`);
});
document.querySelector('#favorites-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-favorite]'); if (!button) return;
  favorites.splice(Number(button.dataset.removeFavorite), 1); saveFavorites(); renderFavorites();
});
document.querySelector('#notification-button').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('このブラウザは通知に対応していません。'); return; }
  const permission = await Notification.requestPermission(); renderFavorites();
  if (permission === 'granted') { toast('遅延通知を有効にしました。アプリを開いている間にお知らせします。'); notifyFavoriteDelays(); }
  else toast('通知は許可されませんでした。ブラウザの設定から変更できます。');
});
feed.addEventListener('click', async event => {
  const button = event.target.closest('[data-reaction]'); if (!button) return;
  const post = posts.find(p => p.id === button.dataset.id); if (!post) return;
  const kind = button.dataset.reaction;
  if (kind === 'confirm' && !post.confirmedByMe) { if (post.notConfirmedByMe) { post.notConfirmed--; post.notConfirmedByMe = false; } post.confirmations = count(post, 'confirmations') + 1; post.confirmedByMe = true; post.lastConfirmedAt = Date.now(); toast('現地での確認を記録しました。'); }
  if (kind === 'not-confirm' && !post.notConfirmedByMe) { if (post.confirmedByMe) { post.confirmations--; post.confirmedByMe = false; } post.notConfirmed = count(post, 'notConfirmed') + 1; post.notConfirmedByMe = true; post.lastConfirmedAt = Date.now(); toast('「確認していない」という観測を記録しました。'); }
  if (kind === 'helpful' && !post.helpfulByMe) { post.helpful = count(post, 'helpful') + 1; post.helpfulByMe = true; toast('役に立ったという評価を記録しました。'); }
  save(); render();
});
const text = document.querySelector('#message');
text.addEventListener('input', () => document.querySelector('#char-count').textContent = text.value.length);
document.querySelector('#post-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const payload = { location: form.location.value.trim(), category: form.category.value, message: form.message.value.trim() };
  posts.unshift({ id: `user-${Date.now()}`, source: 'user', ...payload, createdAt: Date.now(), confirmations: 1, notConfirmed: 0, helpful: 0, lastConfirmedAt: Date.now(), confirmedByMe: true }); save(); render(); toast('情報をこの端末に保存しました。');
  form.reset(); document.querySelector('#char-count').textContent = '0'; dialog.close(); filter = 'all'; document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
});
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 3500); }
document.querySelector('#export-data').addEventListener('click', () => { const data = posts.map(({ id, source, category, location, createdAt, confirmations, notConfirmed, helpful, lastConfirmedAt }) => ({ id, source, event: labels[category], location, reported_at: new Date(createdAt).toISOString(), confirmed_count: confirmations || 0, unconfirmed_count: notConfirmed || 0, useful_count: helpful || 0, last_confirmed_at: new Date(lastConfirmedAt).toISOString(), hidden_from_live_feed: isHidden({ lastConfirmedAt }), confidence: source === 'official' ? 1 : confidence({ confirmations, notConfirmed }) / 100 })); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = Object.assign(document.createElement('a'), { href: url, download: 'civic-live-data.json' }); link.click(); URL.revokeObjectURL(url); toast('構造化データ（JSON）を出力しました。'); });
render();
loadVehicles();
setInterval(loadVehicles, 60000);
