/**
 * dashboard.js — Bảng điều khiển học viên
 * • Hiển thị 3 chỉ số tổng (cấp độ đã đạt, số bài đã làm, điểm cao nhất)
 * • Thẻ của 5 cấp độ + trạng thái bài thi
 * • Lịch sử làm bài
 */
(async function () {
  const user = await bootPage('dashboard');
  if (!user) return; // chưa đăng nhập → đã được chuyển hướng

  const grid = document.getElementById('levelGrid');
  const stats = document.getElementById('stats');
  const history = document.getElementById('history');
  const alertBox = document.getElementById('alert');

  document.getElementById('greeting').textContent = `Chào, ${user.name || user.email}`;

  try {
    const [levelsRes, attemptsRes] = await Promise.all([
      api('/api/levels'),
      api('/api/attempts'),
    ]);
    renderStats(levelsRes.levels);
    renderLevels(levelsRes.levels);
    renderHistory(attemptsRes.attempts);
  } catch (err) {
    grid.innerHTML = '';
    showAlert(alertBox, err.message, 'error');
  }

  /* ---------- 3 chỉ số tổng ---------- */
  function renderStats(levels) {
    const passed = levels.filter((l) => l.exam && l.exam.passed).length;
    const attempts = levels.reduce((n, l) => n + (l.exam ? l.exam.attemptCount : 0), 0);
    const best = levels.reduce((m, l) => Math.max(m, (l.exam && l.exam.bestScore) || 0), 0);

    stats.innerHTML = `
      <div class="stat-box"><b>${passed} / ${levels.length}</b><span>Cấp độ đã đạt</span></div>
      <div class="stat-box"><b>${attempts}</b><span>Bài thi đã làm</span></div>
      <div class="stat-box"><b>${best ? best + ' điểm' : '—'}</b><span>Điểm cao nhất</span></div>`;
  }

  /* ---------- Thẻ cấp độ ---------- */  function renderLevels(levels) {
    grid.innerHTML = levels.map((lv, i) => {
      const exam = lv.exam;
      const locked = !!lv.locked;                 // chưa đạt cấp trước → bị khóa
      const prevNo = String(Math.max(1, lv.id - 1)).padStart(2, '0');
      const done = exam && exam.passed;
      const attempted = exam && exam.attemptCount > 0;
      const progress = locked ? 0 : done ? 100 : attempted ? 50 : 0;

      let badge = '<span class="badge badge--plain">Chưa thi</span>';
      if (locked) badge = `<span class="badge badge--red">Khóa · đạt Cấp ${prevNo} để mở</span>`;
      else if (done) badge = `<span class="badge badge--green">Đã đạt · ${exam.bestScore} điểm</span>`;
      else if (attempted) badge = `<span class="badge">Điểm cao nhất ${exam.bestScore}</span>`;

      const meta = exam
        ? `${lv.lessonCount} bài học · ${exam.questionCount} câu hỏi`
        : `${lv.lessonCount} bài học`;

      let examLine = exam ? `Điểm đạt ${exam.passScore}` : 'Chưa mở bài thi';
      if (locked) examLine = `Cần đạt Cấp ${prevNo} trước`;

      const action = locked
        ? '<span class="btn btn--ghost btn--sm is-locked">Đang khóa</span>'
        : `<a class="btn btn--ghost btn--sm" href="level.html?id=${lv.id}">Vào cấp độ</a>`;

      return `
        <article class="level-card fade-in${locked ? ' is-locked' : ''}" style="animation-delay:${i * 60}ms">
          <div class="level-card__top">
            <span class="level-card__num">${String(lv.id).padStart(2, '0')}</span>
            ${badge}
          </div>
          <h3>${escapeHtml(lv.title)}</h3>
          <p class="level-card__desc">${escapeHtml(lv.tagline)}</p>
          <div class="progress"><i style="width:${progress}%"></i></div>
          <div class="level-card__meta">
            <span>${meta} · ${examLine}</span>
            ${action}
          </div>
        </article>
      `;
    }).join('');
  }

  /* ---------- Lịch sử làm bài ---------- */
  function renderHistory(attempts) {
    if (!attempts.length) {
      history.innerHTML = `
        <div class="empty">
          <h3>Bạn chưa làm bài thi nào</h3>
          <p>Hãy bắt đầu từ Cấp độ 1 để kiểm tra kiến thức của bạn.</p>
          <a class="btn btn--dark btn--sm" href="level.html?id=1">Đến Cấp độ 1</a>
        </div>`;
      return;
    }

    history.innerHTML = attempts.map((a) => `
      <div class="history-item">
        <div>
          <strong>${escapeHtml(a.level_title)}</strong>
          <div class="muted small">${escapeHtml(a.exam_title)} · ${fmtDate(a.created_at)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:14px">
          <span class="${a.passed ? 'badge badge--green' : 'badge badge--red'}">
            ${a.passed ? 'Đạt' : 'Chưa đạt'}
          </span>
          <span class="small">${a.score} / 100</span>
          <a class="btn btn--ghost btn--sm" href="exam.html?id=${a.level_id}">Làm lại</a>
        </div>
      </div>`).join('');
  }
})();
