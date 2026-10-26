/**
 * level.js — Trang chi tiết một cấp độ
 * Nội dung: danh sách bài học (kèm nút tải tài liệu) + khối bài thi.
 */
(async function () {
  const user = await bootPage('dashboard');
  if (!user) return;

  const levelId = qsParam('id') || '1';
  const alertBox = document.getElementById('alert');
  const lessonsBox = document.getElementById('lessons');
  const examBox = document.getElementById('examBox');

  try {
    const data = await api(`/api/levels/${encodeURIComponent(levelId)}`);
    const lv = data.level;
    const no = String(lv.id).padStart(2, '0');

    document.title = `Cấp độ ${no} · ${lv.title} — AZFIN Academy`;
    document.getElementById('crumb').textContent = `Cấp độ ${no}`;
    document.getElementById('levelEyebrow').textContent = `Cấp độ ${no} / 05`;
    document.getElementById('levelTitle').textContent = lv.title;
    document.getElementById('levelTagline').textContent = lv.tagline;

    renderLessons(data.lessons);
    renderExam(data.exam, no);
  } catch (err) {
    lessonsBox.innerHTML = '';
    examBox.innerHTML = '';

    // Cấp độ bị khóa: chưa đạt bài thi của cấp độ trước
    if (err.status === 403) {
      const levelNo = String(levelId).padStart(2, '0');
      const prev = Math.max(1, Number(levelId) - 1);
      const prevNo = String(prev).padStart(2, '0');

      document.title = `Cấp độ ${no0(levelId)} bị khóa — AZFIN Academy`;
      document.getElementById('crumb').textContent = `Cấp độ ${no0(levelId)}`;
      document.getElementById('levelEyebrow').textContent = `Cấp độ ${no0(levelId)} / 05`;
      document.getElementById('levelTitle').textContent = 'Chưa mở khóa';
      document.getElementById('levelTagline').textContent = err.message;

      lessonsBox.innerHTML = `
        <div class="empty">
          <h3>Cấp độ ${levelNo} đang khóa</h3>
          <p>${escapeHtml(err.message)}</p>
          <div class="form-actions" style="justify-content:center">
            <a class="btn btn--dark btn--sm" href="dashboard.html">Về chương trình</a>
            <a class="btn btn--ghost btn--sm" href="level.html?id=${prev}">Học Cấp độ ${prevNo}</a>
            <a class="btn btn--ghost btn--sm" href="exam.html?id=${prev}">Làm bài Cấp độ ${prevNo}</a>
          </div>
        </div>`;
      return;
    }

    showAlert(alertBox, err.message, 'error');
  }

  /** Định dạng số cấp độ 2 chữ số (1 → '01'). */
  function no0(id) { return String(id).padStart(2, '0'); }

  /* ---------- Danh sách bài học ---------- */
  function renderLessons(lessons) {
    if (!lessons.length) {
      lessonsBox.innerHTML = `
        <div class="empty">
          <h3>Chưa có tài liệu nào</h3>
          <p>Giảng viên đang cập nhật nội dung cho cấp độ này.</p>
        </div>`;
      return;
    }

    lessonsBox.innerHTML = lessons.map((ls, i) => {
      // Chỉ có file đính kèm thì mới hiện nút tải
      const fileBtn = ls.file_name
        ? `<a class="btn btn--ghost btn--sm" href="/api/files/${ls.id}">
             Tải tài liệu · ${fmtSize(ls.file_size)}
           </a>`
        : '';

      return `
        <div class="lesson">
          <span class="lesson__idx">${String(i + 1).padStart(2, '0')}</span>
          <div>
            <h3>${escapeHtml(ls.title)}</h3>
            <p>${escapeHtml(ls.summary)}</p>
          </div>
          <div class="lesson__file">${fileBtn}</div>
        </div>`;
    }).join('');
  }

  /* ---------- Khối bài thi ---------- */
  function renderExam(exam, no) {
    if (!exam) {
      examBox.innerHTML = `
        <div class="empty" style="margin-top:46px">
          <h3>Cấp độ này chưa có bài thi</h3>
          <p>Giảng viên chưa mở bài kiểm tra cho cấp độ này. Bạn vẫn có thể học tài liệu ở trên.</p>
          <a class="btn btn--ghost btn--sm" href="dashboard.html">Về chương trình</a>
        </div>`;
      return;
    }

    const hasQuestions = exam.questionCount > 0;
    const best = exam.bestScore !== null && exam.bestScore !== undefined ? `${exam.bestScore} điểm` : '—';

    examBox.innerHTML = `
      <div class="exam-cta">
        <div>
          <span class="eyebrow">Bài thi cấp độ ${no}</span>
          <h3>${escapeHtml(exam.title)}</h3>
          <p>${escapeHtml(exam.intro)}</p>
          <div class="exam-cta__facts">
            <div><span>Số câu</span><b>${exam.questionCount}</b></div>
            <div><span>Điểm đạt</span><b>${exam.passScore}</b></div>
            <div><span>Cao nhất của bạn</span><b>${best}</b></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;min-width:210px">
          ${
            hasQuestions
              ? `<a class="btn btn--gold btn--block" href="exam.html?id=${levelId}">
                   ${exam.attemptCount ? 'Làm bài lại' : 'Bắt đầu bài thi'}
                 </a>`
              : `<button class="btn btn--gold btn--block" disabled>Chưa có câu hỏi</button>`
          }
          ${exam.passed ? '<span class="badge badge--green" style="align-self:center">Bạn đã đạt cấp độ này</span>' : ''}
        </div>
      </div>`;
  }
})();
