/**
 * api.js — LỚP GỌI API + TIỆN ÍCH DÙNG CHUNG
 * ------------------------------------------------
 * • Tự quản lý phiên đăng nhập (cookie HttpOnly do server cấp).
 * • Mọi lỗi server đều được gói lại thành ApiError với thông báo tiếng Việt.
 */

/** Lỗi API: có cả mã trạng thái lẫn thông báo. status 0 = không kết nối được. */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Gọi một endpoint API.
 * @param {string} path   VD: '/api/auth/login'
 * @param {object} opts   { method, body (object JSON), formData (FormData) }
 */
async function api(path, opts = {}) {
  const { method = 'GET', body = null, formData = null } = opts;
  const init = { method, credentials: 'same-origin', headers: {} };

  if (formData) {
    init.body = formData; // trình duyệt tự gắn header multipart
  } else if (body !== null && body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng rồi thử lại.');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || 'Có lỗi xảy ra. Vui lòng thử lại.');
  }
  return data;
}

/* ---------------------------------------------------------------------------
 * Auth — trạng thái phiên đăng nhập được cache trong bộ nhớ trang
 * ------------------------------------------------------------------------ */
const Auth = {
  _user: undefined,

  /** Lấy thông tin người dùng hiện tại; trả về null nếu chưa đăng nhập. */
  async me(force = false) {
    if (this._user !== undefined && !force) return this._user;
    try {
      const data = await api('/api/auth/me');
      this._user = data.user;
    } catch {
      this._user = null;
    }
    return this._user;
  },

  async login(email, password) {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    this._user = data.user;
    return data.user;
  },

  async register(name, email, password) {
    const data = await api('/api/auth/register', { method: 'POST', body: { name, email, password } });
    this._user = data.user;
    return data.user;
  },

  async logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { this._user = undefined; }
  },
};

/* ---------------------------------------------------------------------------
 * Tiện ích DOM & định dạng
 * ------------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Đọc tham số trên URL, VD: level.html?id=2 → qsParam('id') === '2' */
function qsParam(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Chèn text vào HTML an toàn (tránh lỗi hiển thị & XSS). */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Định dạng ngày tháng ngắn. */
function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Định dạng dung lượng file. */
function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/** Hiển thị thông báo trong một phần tử .alert. type: 'error' | 'ok' | 'info' */
function showAlert(el, message, type = 'error') {
  if (!el) return;
  el.className = `alert alert--${type}`;
  el.textContent = message || '';
}

/** Bật/tắt nút khi đang gửi request (chống bấm nhiều lần). */
function setBusy(btn, busy, busyLabel = 'Đang xử lý…') {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${busyLabel}`;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

/**
 * Chuyển hướng về trang đăng nhập kèm URL quay lại sau khi đăng nhập.
 * Lưu ý: server đổi /level.html?id=3 thành /level?id=3, nên `next` có thể
 * không còn đuôi .html — trang đăng nhập phải chấp nhận cả hai dạng.
 */
function goLogin() {
  const path = location.pathname.replace(/^\/+/, '');
  const isHome = !path || /^index(\.html)?$/i.test(path);
  const next = isHome ? '' : encodeURIComponent(path + location.search);
  location.href = next ? `login.html?next=${next}` : 'login.html';
}
