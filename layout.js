/**
 * layout.js — HEADER / FOOTER DÙNG CHUNG + BẢO VỆ TRANG
 * ------------------------------------------------
 * Mỗi trang HTML có 2 thẻ chờ nội dung:
 *      <div data-header></div>              → header tự render vào đây
 *      <div data-footer></div>              → footer tự render vào đây
 *
 * Cách dùng trong trang con:
 *      const user = await bootPage('dashboard');                 // bắt buộc đăng nhập
 *      const user = await bootPage('admin', { admin: true });    // bắt buộc quyền admin
 *      bootPublic();                                             // trang công khai (index, login)
 */

/** Logo chữ dùng chung. */
function brandMarkup(homeHref) {
  return `
    <a class="brand" href="${homeHref}">
      <span class="brand-mark">◆</span>
      <span class="brand-name">${SITE.name}</span>
      <span class="brand-suffix">${SITE.suffix}</span>
    </a>`;
}

function renderHeader(active, user) {
  const host = document.querySelector('[data-header]');
  if (!host) return;


  const links = [];
  if (user) {
    links.push(`<a class="nav-link ${active === 'dashboard' ? 'is-active' : ''}" href="dashboard.html">Chương trình</a>`);
    if (user.role === 'admin') {
      links.push(`<a class="nav-link ${active === 'admin' ? 'is-active' : ''}" href="admin.html">Quản trị</a>`);
    }
    links.push(`<span class="nav-user">Xin chào, ${escapeHtml(user.name || user.email)}</span>`);
    links.push(`<button class="btn btn--ghost btn--sm" id="logoutBtn" type="button">Đăng xuất</button>`);
  } else {
    links.push(`<a class="nav-link" href="index.html#chuong-trinh">Chương trình</a>`);
    links.push(`<a class="nav-link ${active === 'login' ? 'is-active' : ''}" href="login.html">Đăng nhập</a>`);
  }

  host.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        ${brandMarkup(user ? 'dashboard.html' : 'index.html')}
        <nav class="nav">${links.join('')}</nav>
      </div>
    </header>`;

  // Thay thẻ giữ chỗ bằng <header> thật để position:sticky hoạt động
  host.replaceWith(makeNode(host.innerHTML));

  const btn = document.querySelector('#logoutBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      await Auth.logout();
      location.href = 'index.html';
    });
  }
}

function renderFooter() {
  const host = document.querySelector('[data-footer]');
  if (!host) return;
  host.innerHTML = `
    <footer class="site-footer">
      <div class="container footer-inner">
        <div>
          ${brandMarkup('index.html')}
          <p class="footer-note" style="margin-top:14px">${SITE.tagline}</p>
        </div>
        <p class="footer-note">© ${SITE.year} ${SITE.name} ${SITE.suffix}.<br>${SITE.disclaimer}</p>
      </div>
    </footer>`;
  host.replaceWith(makeNode(host.innerHTML));
}

/** Tạo node DOM từ chuỗi HTML (chỉ lấy phần tử con đầu tiên). */
function makeNode(html) {
  const tpl = document.createElement('div');
  tpl.innerHTML = html.trim();
  return tpl.firstElementChild;
}

/** Trang công khai: render header/footer, không chặn truy cập. */
function bootPublic(active = '', user = null) {
  renderHeader(active, user);
  renderFooter();
}

/**
 * Trang cần đăng nhập.
 * @returns {object|null} user hoặc null (đã chuyển hướng)
 */
async function bootPage(active = '', opts = {}) {
  const user = await Auth.me();
  renderHeader(active, user);
  renderFooter();

  if (!user) {
    if (opts.silent !== true) goLogin();
    return null;
  }
  if (opts.admin && user.role !== 'admin') {
    location.replace('dashboard.html');
    return null;
  }
  return user;
}
