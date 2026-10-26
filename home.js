/**
 * home.js — Trang giới thiệu
 * Chỉ cần: render header/footer và đổi đích của các nút theo trạng thái đăng nhập.
 */
(async function () {
  const user = await Auth.me();
  bootPublic('home', user);

  // Người đã đăng nhập bấm vào chương trình là vào thẳng bảng điều khiển
  const target = user ? 'dashboard.html' : 'login.html';
  document.querySelectorAll('.level-row').forEach((row) => row.setAttribute('href', target));

  if (user) {
    const hero = document.getElementById('heroPrimary');
    if (hero) { hero.textContent = 'Vào học tập'; hero.setAttribute('href', 'dashboard.html'); }

    const cta = document.getElementById('ctaPrimary');
    if (cta) { cta.textContent = 'Vào học tập'; cta.setAttribute('href', 'dashboard.html'); }
  }
})();
