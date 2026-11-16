// ВайбМаркет — сервер без зависимостей. Запуск: node server.js → http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

let db = { users: [], items: [], sessions: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
db.chats = db.chats || [];
db.reports = db.reports || [];
db.orders = db.orders || [];
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });
const savePhotos = arr => (Array.isArray(arr) ? arr : []).slice(0, 3).map(d => {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(String(d)); if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 700000 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  const name = crypto.randomBytes(12).toString('hex') + '.jpg';
  fs.writeFileSync(path.join(UP, name), buf); return '/uploads/' + name;
}).filter(Boolean);
const BOT = ['Здравствуйте! Это демо-продавец. Проект ещё доступен, что хотите узнать?', 'Да, могу показать детали и передать исходники после оплаты.', 'Цена обсуждаемая, если берёте сразу.'];
const save = () => { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); };

const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const checkPw = (pw, rec) => { const h = Buffer.from(hashPw(pw, rec.salt).hash, 'hex'), r = Buffer.from(rec.hash, 'hex'); return h.length === r.length && crypto.timingSafeEqual(h, r); };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const pub = u => ({ id: u.id, name: u.name, email: u.email, bio: u.bio || '', contact: u.contact || '', favs: u.favs || [], balance: u.balance || 0, created: u.created });
const EMO = { site: '🌐', app: '📱', saas: '☁️', bot: '🤖', tpl: '🎨', game: '🎮', ext: '🧩', domain: '🏷️' };

const readBody = req => new Promise((ok, no) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 2.5e6) { no(new Error('Слишком большой запрос')); req.destroy(); } });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('Неверный формат данных')); } });
});

const authUser = req => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const s = db.sessions.find(s => s.token === sha(t) && s.exp > Date.now());
  return s ? db.users.find(u => u.id === s.uid) : null;
};

const tries = {}; // защита от подбора пароля: 10 попыток за 10 минут с одного IP
const limited = ip => { const n = Date.now(), t = tries[ip] = (tries[ip] && n - tries[ip].t < 6e5) ? tries[ip] : { c: 0, t: n }; return ++t.c > 10; };

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname, m = req.method;
  const up = p.match(/^\/uploads\/([a-f0-9]+\.jpg)$/);
  if (up) return fs.readFile(path.join(UP, up[1]), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' }); res.end(d); });
  if (!p.startsWith('/api/')) {
    if (p === '/index.html' || !path.extname(p)) {
      return fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
        if (e) { res.writeHead(500); return res.end('index.html не найден рядом с server.js'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
      });
    }
    res.writeHead(404); return res.end('Not found');
  }
  try {
    const u = authUser(req);
    const startSession = user => {
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions = db.sessions.filter(s => s.exp > Date.now());
      db.sessions.push({ token: sha(token), uid: user.id, exp: Date.now() + 30 * 864e5 });
      save(); send(res, 200, { token, user: pub(user) });
    };

    if (m === 'POST' && (p === '/api/register' || p === '/api/login')) {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'Слишком много попыток. Подождите 10 минут' });
      const b = await readBody(req), email = str(b.email, 80).toLowerCase(), pw = String(b.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Введите корректный email' });
      if (p === '/api/register') {
        const name = str(b.name, 30);
        if (!name) return send(res, 400, { error: 'Введите имя' });
        if (pw.length < 6) return send(res, 400, { error: 'Пароль — минимум 6 символов' });
        if (db.users.some(x => x.email === email)) return send(res, 409, { error: 'Этот email уже зарегистрирован' });
        const user = { id: newId(), name, email, pw: hashPw(pw), bio: '', contact: '', favs: [], created: Date.now() };
        db.users.push(user); return startSession(user);
      }
      const user = db.users.find(x => x.email === email);
      if (!user || !checkPw(pw, user.pw)) return send(res, 401, { error: 'Неверный email или пароль' });
      return startSession(user);
    }

    if (m === 'GET' && p === '/api/items') {
      return send(res, 200, { items: db.items.map(i => {
        const s = db.users.find(x => x.id === i.uid);
        return { ...i, u: s ? s.name : 'Аноним', ct: u && s ? s.contact || '' : '', sb: s ? s.bio || '' : '' };
      }).sort((a, b) => b.n - a.n) });
    }

    if (!u) return send(res, 401, { error: 'Нужно войти в аккаунт' });

    if (m === 'GET' && p === '/api/me') return send(res, 200, { user: pub(u) });
    if (m === 'PUT' && p === '/api/me') {
      const b = await readBody(req), name = str(b.name, 30);
      if (!name) return send(res, 400, { error: 'Имя не может быть пустым' });
      Object.assign(u, { name, bio: str(b.bio, 300), contact: str(b.contact, 80) });
      save(); return send(res, 200, { user: pub(u) });
    }
    if (m === 'POST' && p === '/api/logout') {
      const t = sha((req.headers.authorization || '').replace('Bearer ', ''));
      db.sessions = db.sessions.filter(s => s.token !== t); save(); return send(res, 200, {});
    }
    if (m === 'POST' && p === '/api/items') {
      const b = await readBody(req), price = +b.p;
      if (!str(b.t, 70) || !str(b.d, 1000)) return send(res, 400, { error: 'Заполните название и описание' });
      if (!EMO[b.c]) return send(res, 400, { error: 'Выберите раздел' });
      if (!(price > 0 && price < 1e9)) return send(res, 400, { error: 'Укажите цену больше нуля' });
      const item = {
        id: newId(), n: Date.now(), uid: u.id, t: str(b.t, 70), c: b.c, p: price, d: str(b.d, 1000),
        s: (Array.isArray(b.s) ? b.s : []).map(x => str(x, 24)).filter(Boolean).slice(0, 6),
        m: Math.max(0, +b.m || 0), ai: Math.min(100, Math.max(0, +b.ai || 0)), e: EMO[b.c], h: Math.floor(Math.random() * 360), ph: savePhotos(b.ph)
      };
      db.items.push(item); save(); return send(res, 200, { item });
    }
    let r;
    if (m === 'PUT' && (r = p.match(/^\/api\/items\/(\d+)$/))) {
      const i = db.items.find(x => x.id === +r[1]);
      if (!i) return send(res, 404, { error: 'Объявление не найдено' });
      if (i.uid !== u.id) return send(res, 403, { error: 'Это не ваше объявление' });
      const b = await readBody(req);
      if ('sold' in b) { i.sold = !!b.sold; save(); return send(res, 200, { item: i }); }
      const price = +b.p;
      if (!str(b.t, 70) || !str(b.d, 1000)) return send(res, 400, { error: 'Заполните название и описание' });
      if (!EMO[b.c]) return send(res, 400, { error: 'Выберите раздел' });
      if (!(price > 0 && price < 1e9)) return send(res, 400, { error: 'Укажите цену больше нуля' });
      const list = Array.isArray(b.ph) ? b.ph : [], old = i.ph || [];
      const keep = list.filter(x => old.includes(x)).slice(0, 3);
      const fresh = savePhotos(list.filter(x => String(x).startsWith('data:')).slice(0, 3 - keep.length));
      old.filter(x => !keep.includes(x)).forEach(x => fs.unlink(path.join(UP, path.basename(x)), () => {}));
      Object.assign(i, { t: str(b.t, 70), c: b.c, p: price, d: str(b.d, 1000), e: EMO[b.c], m: Math.max(0, +b.m || 0), ai: Math.min(100, Math.max(0, +b.ai || 0)),
        s: (Array.isArray(b.s) ? b.s : []).map(x => str(x, 24)).filter(Boolean).slice(0, 6), ph: [...keep, ...fresh] });
      save(); return send(res, 200, { item: i });
    }
    if (m === 'POST' && p === '/api/report') {
      const id = +(await readBody(req)).itemId;
      if (!db.reports.some(x => x.itemId === id && x.by === u.id)) { db.reports.push({ itemId: id, by: u.id, t: Date.now() }); save(); }
      return send(res, 200, {});
    }
    if (m === 'DELETE' && (r = p.match(/^\/api\/items\/(\d+)$/))) {
      const i = db.items.find(x => x.id === +r[1]);
      if (!i) return send(res, 404, { error: 'Объявление не найдено' });
      if (i.uid !== u.id) return send(res, 403, { error: 'Это не ваше объявление' });
      (i.ph || []).forEach(x => fs.unlink(path.join(UP, path.basename(x)), () => {})); db.items = db.items.filter(x => x !== i); save(); return send(res, 200, {});
    }
    if (m === 'POST' && (r = p.match(/^\/api\/favs\/(\d+)$/))) {
      const id = +r[1]; u.favs = u.favs || [];
      u.favs = u.favs.includes(id) ? u.favs.filter(x => x !== id) : [...u.favs, id];
      save(); return send(res, 200, { favs: u.favs });
    }
    // ----- чаты -----
    const nameOf = id => id === 0 ? 'Демо-продавец' : (db.users.find(x => x.id === id) || { name: 'Удалён' }).name;
    const mineC = c => c.a === u.id || c.b === u.id;
    const otherOf = c => c.a === u.id ? c.b : c.a;
    const unread = c => c.msgs.filter(x => x.f !== u.id).length - ((c.r || {})[u.id] || 0);
    if (m === 'GET' && p === '/api/chats') {
      return send(res, 200, { chats: db.chats.filter(mineC).sort((a, b) => b.upd - a.upd).map(c => ({
        id: c.id, it: c.it, with: nameOf(otherOf(c)), h: c.id % 360, unread: unread(c),
        last: c.msgs.length ? c.msgs[c.msgs.length - 1].text.slice(0, 60) : 'Нет сообщений', upd: c.upd })) });
    }
    if (m === 'POST' && p === '/api/chats') {
      const b = await readBody(req), itemId = +b.itemId, it = db.items.find(x => x.id === itemId);
      let seller, title;
      if (it) { seller = it.uid; title = it.t; }
      else if (itemId > 0 && itemId < 1000) { seller = 0; title = str(b.title, 70) || 'Объявление'; }
      else return send(res, 404, { error: 'Объявление не найдено' });
      if (seller === u.id) return send(res, 400, { error: 'Это ваше объявление' });
      let c = db.chats.find(x => x.itemId === itemId && x.a === u.id);
      if (!c) { c = { id: newId(), itemId, it: title, a: u.id, b: seller, msgs: [], r: {}, upd: Date.now() }; db.chats.push(c); save(); }
      return send(res, 200, { id: c.id });
    }
    if ((r = p.match(/^\/api\/chats\/(\d+)$/)) && m === 'GET') {
      const c = db.chats.find(x => x.id === +r[1] && mineC(x));
      if (!c) return send(res, 404, { error: 'Диалог не найден' });
      const seen = c.msgs.filter(x => x.f !== u.id).length;
      c.r = c.r || {}; if (c.r[u.id] !== seen) { c.r[u.id] = seen; save(); }
      return send(res, 200, { with: nameOf(otherOf(c)), it: c.it, itemId: c.itemId, msgs: c.msgs.map(x => ({ text: x.text, t: x.t, me: x.f === u.id })) });
    }
    if ((r = p.match(/^\/api\/chats\/(\d+)\/messages$/)) && m === 'POST') {
      const c = db.chats.find(x => x.id === +r[1] && mineC(x));
      if (!c) return send(res, 404, { error: 'Диалог не найден' });
      const text = str((await readBody(req)).text, 1000);
      if (!text) return send(res, 400, { error: 'Пустое сообщение' });
      c.msgs.push({ f: u.id, text, t: Date.now() });
      if (otherOf(c) === 0) c.msgs.push({ f: 0, text: BOT[(c.msgs.length >> 1) % BOT.length], t: Date.now() + 1 });
      c.upd = Date.now(); save(); return send(res, 200, {});
    }
    // ----- кошелёк и сделки (демо: реальные деньги не используются) -----
    const money2 = x => Math.round(x * 100) / 100;
    const opub = o => ({ id: o.id, itemId: o.itemId, it: o.it, amount: o.amount, status: o.status, t: o.t, role: o.buyer === u.id ? 'buyer' : 'seller', with: nameOf(o.buyer === u.id ? o.seller : o.buyer) });
    if (m === 'POST' && p === '/api/topup') {
      const a = money2(+(await readBody(req)).amount);
      if (!(a > 0 && a <= 10000)) return send(res, 400, { error: 'Сумма от 1 до 10 000' });
      u.balance = money2((u.balance || 0) + a); save(); return send(res, 200, { balance: u.balance });
    }
    if (m === 'GET' && p === '/api/orders') return send(res, 200, { orders: db.orders.filter(o => o.buyer === u.id || o.seller === u.id).sort((a, b) => b.t - a.t).map(opub) });
    if (m === 'POST' && p === '/api/orders') {
      const b = await readBody(req), itemId = +b.itemId, it = db.items.find(x => x.id === itemId);
      let seller, title, amount;
      if (it) { if (it.sold) return send(res, 409, { error: 'Объявление уже продано' }); seller = it.uid; title = it.t; amount = it.p; }
      else if (itemId > 0 && itemId < 1000) { seller = 0; title = str(b.title, 70) || 'Объявление'; amount = money2(Math.min(1e6, Math.max(1, +b.price || 1))); }
      else return send(res, 404, { error: 'Объявление не найдено' });
      if (seller === u.id) return send(res, 400, { error: 'Нельзя купить своё объявление' });
      if ((u.balance || 0) < amount) return send(res, 402, { error: 'Недостаточно средств на балансе' });
      u.balance = money2(u.balance - amount); if (it) it.sold = true;
      const o = { id: newId(), itemId, it: title, amount, buyer: u.id, seller, status: seller === 0 ? 'shipped' : 'paid', t: Date.now() };
      db.orders.push(o); save(); return send(res, 200, { order: opub(o) });
    }
    if (m === 'POST' && (r = p.match(/^\/api\/orders\/(\d+)\/(ship|confirm|cancel)$/))) {
      const o = db.orders.find(x => x.id === +r[1] && (x.buyer === u.id || x.seller === u.id));
      if (!o) return send(res, 404, { error: 'Сделка не найдена' });
      const isBuyer = o.buyer === u.id, a = r[2];
      if (a === 'ship' && !isBuyer && o.status === 'paid') o.status = 'shipped';
      else if (a === 'confirm' && isBuyer && o.status === 'shipped') { o.status = 'done'; const sl = db.users.find(x => x.id === o.seller); if (sl) sl.balance = money2((sl.balance || 0) + o.amount); }
      else if (a === 'cancel' && isBuyer && o.status === 'paid') { o.status = 'cancelled'; u.balance = money2((u.balance || 0) + o.amount); const it = db.items.find(x => x.id === o.itemId); if (it) it.sold = false; }
      else return send(res, 400, { error: 'Это действие сейчас недоступно' });
      save(); return send(res, 200, { order: opub(o) });
    }
    send(res, 404, { error: 'Не найдено' });
  } catch (e) { send(res, 400, { error: e.message || 'Ошибка запроса' }); }
}).listen(PORT, () => console.log('ВайбМаркет запущен: http://localhost:' + PORT));