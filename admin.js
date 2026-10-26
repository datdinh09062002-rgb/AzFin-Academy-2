/**
 * admin.js — Khu vực quản trị (chỉ dành cho tài khoản admin)
 * 3 tab: Người dùng · Tài liệu học tập · Bài thi
 */
(async function () {
  const user = await bootPage('admin', { admin: true });
  if (!user) return; // không phải admin → đã được chuyển hướng

  const LETTERS = ['A', 'B', 'C', 'D'];
  const alertBox = document.getElementById('alert');

  const panels = {
    users: document.getElementById('panel-users'),
    docs: document.getElementById('panel-docs'),
    exam: document.getElementById('panel-exam'),
    account: document.getElementById('panel-account'),
  };
  const loaded = { users: false, docs: false, exam: false, account: false };

  let levels = [];        // [{ id, title }]
  let currentLevel = 1;   // cấp độ đang mở ở tab Bài thi

  /* ================= TIỆN ÍCH ================= */
  function activate(name) {
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('is-active', t.dataset.panel === name)
    );
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== name));

    if (!loaded[name]) {
      loaded[name] = true;
      if (name === 'users') loadUsers();
      if (name === 'docs') loadDocs();
      if (name === 'exam') loadExam(currentLevel);
    }
  }

  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => activate(tab.dataset.panel))
  );

  /** Điền danh sách cấp độ vào các ô select. */
  function fillLevelSelects() {
    const options = levels.map((l) => `<option value="${l.id}">Cấp độ ${String(l.id).padStart(2, '0')} — ${escapeHtml(l.title)}</option>`).join('');
    document.getElementById('upLevel').innerHTML = options;
    document.getElementById('examLevel').innerHTML = options;
  }

  /* ================= 1. NGƯỜI DÙNG ================= */
  async function loadUsers() {
    const body = document.getElementById('usersBody');
    try {
      const res = await api('/api/admin/users');
      const list = res.users || [];
      const admins = list.filter((u) => u.role === 'admin').length;
      document.getElementById('usersSummary').textContent =
        `Tổng ${list.length} tài khoản · ${admins} quản trị viên · ${list.length - admins} học viên`;

      if (!list.length) {
        body.innerHTML = '<tr><td colspan="8" class="muted">Chưa có người dùng nào.</td></tr>';
        return;
      }

      body.innerHTML = list.map((u) => `
        <tr>
          <td>${escapeHtml(u.name || '—')}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${u.role === 'admin'
              ? '<span class="badge">Admin</span>'
              : '<span class="badge badge--plain">Học viên</span>'}</td>
          <td>${fmtDate(u.created_at)}</td>
          <td>${u.last_login_at ? fmtDate(u.last_login_at) : '<span class="muted">Chưa từng đăng nhập</span>'}</td>
          <td>${u.attempts}</td>
          <td>${u.levels_passed} / ${levels.length}</td>
          <td>${roleActionCell(u)}</td>
        </tr>`).join('');
    } catch (err) {
      body.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  /**
   * Ô "Thao tác" của một dòng người dùng:
   *   • Tài khoản hiện tại → ghi chú "Bạn" (không tự hạ cấp).
   *   • Học viên → nút "Cấp quyền".
   *   • Admin khác → nút "Thu hồi quyền".
   */
  function roleActionCell(u) {
    if (u.id === user.id) return '<span class="muted">Bạn</span>';
    if (u.role === 'admin') {
      return `<button class="btn btn--ghost btn--sm" type="button" data-role-user="${u.id}" data-role-next="user">Thu hồi quyền</button>`;
    }
    return `<button class="btn btn--dark btn--sm" type="button" data-role-user="${u.id}" data-role-next="admin">Cấp quyền</button>`;
  }

  // Cấp / thu hồi quyền admin (bắt sự kiện bấm, không cần gắn lặp)
  document.getElementById('usersBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-role-user]');
    if (!btn) return;
    const next = btn.dataset.roleNext;
    const msg = next === 'admin'
      ? 'Cấp quyền quản trị viên cho tài khoản này?\n\nNgười này sẽ có toàn quyền: xem người dùng, tải tài liệu, soạn bài thi.'
      : 'Thu hồi quyền quản trị viên của tài khoản này?\n\nNgười này sẽ quay lại vai trò học viên.';
    if (!confirm(msg)) return;

    try {
      await api(`/api/admin/users/${btn.dataset.roleUser}/role`, {
        method: 'PATCH',
        body: { role: next },
      });
      showAlert(alertBox, next === 'admin' ? 'Đã cấp quyền quản trị.' : 'Đã thu hồi quyền quản trị.', 'ok');
      loadUsers();
    } catch (err) {
      showAlert(alertBox, err.message, 'error');
    }
  });

  /* ================= 2. TÀI LIỆU ================= */
  async function loadDocs() {
    const body = document.getElementById('docsBody');
    try {
      const res = await api('/api/admin/lessons');
      const list = res.lessons || [];
      document.getElementById('docsSummary').textContent = `Tổng ${list.length} tài liệu đã tải lên`;

      if (!list.length) {
        body.innerHTML = '<tr><td colspan="5" class="muted">Chưa có tài liệu nào. Hãy tải tài liệu đầu tiên ở phía trên.</td></tr>';
        return;
      }

      body.innerHTML = list.map((ls) => `
        <tr>
          <td><span class="badge badge--plain">Cấp ${String(ls.level_id).padStart(2, '0')}</span></td>
          <td><strong>${escapeHtml(ls.title)}</strong><div class="muted small">${escapeHtml(ls.summary || '')}</div></td>
          <td>${ls.file_name ? `${escapeHtml(ls.file_name)}<div class="muted small">${fmtSize(ls.file_size)}</div>` : '<span class="muted">Không có tệp</span>'}</td>
          <td>${fmtDate(ls.created_at)}</td>
          <td style="text-align:right"><button class="btn btn--ghost btn--sm" type="button" data-del-lesson="${ls.id}">Xoá</button></td>
        </tr>`).join('');
    } catch (err) {
      body.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // Tải tài liệu lên (multipart/form-data)
  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const box = document.getElementById('docsAlert');
    const fileInput = document.getElementById('upFile');
    const btn = form.querySelector('button[type="submit"]');

    if (!fileInput.files.length) { showAlert(box, 'Vui lòng chọn file tài liệu.'); return; }

    showAlert(box, '');
    setBusy(btn, true, 'Đang tải lên…');
    try {
      await api('/api/admin/lessons', { method: 'POST', formData: new FormData(form) });
      form.reset();
      showAlert(box, 'Đã tải tài liệu lên thành công.', 'ok');
      loadDocs();
    } catch (err) {
      showAlert(box, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  // Xoá tài liệu (bắt sự kiện bấm, không cần gắn lặp)
  document.getElementById('docsBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-lesson]');
    if (!btn) return;
    if (!confirm('Xoá tài liệu này? Tệp tải lên cũng sẽ bị xoá vĩnh viễn.')) return;
    try {
      await api(`/api/admin/lessons/${btn.dataset.delLesson}`, { method: 'DELETE' });
      loadDocs();
    } catch (err) {
      showAlert(document.getElementById('docsAlert'), err.message);
    }
  });

  /* ================= 3. BÀI THI ================= */

  /**
   * Bật/tắt trạng thái "đang tải" của tab Bài thi.
   * Khi bật: hiện dòng chờ + VÔ HIỆU HOÁ toàn bộ form, để admin không gõ
   * vào ô trống rồi bị dữ liệu tải về ghi đè mất.
   */
  function setExamLoading(busy) {
    const stat = document.getElementById('examStat');
    const summary = document.getElementById('questionsSummary');
    const list = document.getElementById('questionsList');

    if (busy) {
      stat.textContent = 'Đang tải bài thi…';
      summary.textContent = 'Đang tải danh sách câu hỏi…';
      list.innerHTML = '<div class="empty"><h3>Đang tải bài thi</h3><p>Vui lòng chờ trong giây lát…</p></div>';
    }

    // Vô hiệu hoá / mở lại 2 form trong lúc chờ dữ liệu
    ['examMetaForm', 'questionForm'].forEach((id) => {
      const form = document.getElementById(id);
      if (!form) return;
      form.querySelectorAll('input, textarea, select, button').forEach((el) => { el.disabled = busy; });
    });
  }

  async function loadExam(levelId) {
    currentLevel = Number(levelId) || 1;
    const examAlert = document.getElementById('examAlert');
    const qAlert = document.getElementById('questionAlert');

    setExamLoading(true);
    try {
      const res = await api(`/api/admin/exams/${currentLevel}`);
      showAlert(examAlert, '');
      showAlert(qAlert, '');

      const exam = res.exam;
      const questions = res.questions || [];

      // Điền thông tin bài thi (chưa có thì form trống để tạo mới)
      document.getElementById('exTitle').value = exam ? exam.title : `Bài thi Cấp độ ${String(currentLevel).padStart(2, '0')}`;
      document.getElementById('exIntro').value = exam ? exam.intro : '';
      document.getElementById('exPass').value = exam ? exam.pass_score : 70;
      document.getElementById('examStat').textContent = exam
        ? `${questions.length} câu hỏi · điểm đạt ${exam.pass_score}`
        : 'Chưa có bài thi cho cấp độ này — nhập thông tin và bấm Lưu.';

      renderQuestions(questions, exam);
      setExamLoading(false);
    } catch (err) {
      setExamLoading(false);
      showAlert(examAlert, err.message);
    }
  }

  function renderQuestions(questions, exam) {
    const list = document.getElementById('questionsList');
    const summary = document.getElementById('questionsSummary');
    summary.textContent = exam ? `${questions.length} câu hỏi trong bài thi` : 'Hãy lưu thông tin bài thi trước.';

    if (!exam) {
      list.innerHTML = '<div class="empty"><h3>Chưa có bài thi</h3><p>Điền thông tin bài thi phía trên rồi bấm “Lưu bài thi”.</p></div>';
      return;
    }
    if (!questions.length) {
      list.innerHTML = '<div class="empty"><h3>Chưa có câu hỏi</h3><p>Dùng biểu mẫu phía trên để thêm câu hỏi đầu tiên.</p></div>';
      return;
    }

    list.innerHTML = questions.map((q, i) => `
      <div class="question-admin">
        <div class="question-admin__head">
          <div>
            <span class="badge badge--plain">Câu ${String(i + 1).padStart(2, '0')}</span>
            <p>${escapeHtml(q.text)}</p>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-del-question="${q.id}">Xoá</button>
        </div>
        <ul class="answer-list">
          ${[q.o1, q.o2, q.o3, q.o4].map((opt, oi) => `
            <li class="${q.correct === oi + 1 ? 'is-correct' : ''}">
              <span class="k">${LETTERS[oi]}</span> ${escapeHtml(opt)}
            </li>`).join('')}
        </ul>
      </div>`).join('');
  }

  // Đổi cấp độ
  document.getElementById('examLevel').addEventListener('change', (e) => loadExam(e.target.value));

  // Lưu thông tin bài thi (tạo mới hoặc cập nhật)
  document.getElementById('examMetaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('examAlert');
    const btn = e.target.querySelector('button[type="submit"]');
    showAlert(box, '');
    setBusy(btn, true, 'Đang lưu…');
    try {
      await api(`/api/admin/exams/${currentLevel}`, {
        method: 'PUT',
        body: {
          title: document.getElementById('exTitle').value.trim(),
          intro: document.getElementById('exIntro').value.trim(),
          pass_score: Number(document.getElementById('exPass').value),
        },
      });
      showAlert(box, 'Đã lưu thông tin bài thi.', 'ok');
      loadExam(currentLevel);
    } catch (err) {
      showAlert(box, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  // Thêm câu hỏi
  document.getElementById('questionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('questionAlert');
    const btn = e.target.querySelector('button[type="submit"]');
    const correct = Number(document.querySelector('input[name="correct"]:checked').value);

    showAlert(box, '');
    setBusy(btn, true, 'Đang thêm…');
    try {
      await api(`/api/admin/exams/${currentLevel}/questions`, {
        method: 'POST',
        body: {
          text: document.getElementById('qText').value.trim(),
          options: ['q1', 'q2', 'q3', 'q4'].map((id) => document.getElementById(id).value.trim()),
          correct,
        },
      });
      e.target.reset();
      document.querySelector('input[name="correct"][value="1"]').checked = true;
      syncCorrectChips();
      showAlert(box, 'Đã thêm câu hỏi.', 'ok');
      loadExam(currentLevel);
    } catch (err) {
      showAlert(box, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  // Tô sáng chip "đáp án đúng"
  document.getElementById('correctRow').addEventListener('change', syncCorrectChips);
  function syncCorrectChips() {
    document.querySelectorAll('#correctRow .radio-chip').forEach((chip) => {
      chip.classList.toggle('is-active', chip.querySelector('input').checked);
    });
  }

  // Xoá câu hỏi
  document.getElementById('questionsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-question]');
    if (!btn) return;
    if (!confirm('Xoá câu hỏi này khỏi bài thi?')) return;
    try {
      await api(`/api/admin/questions/${btn.dataset.delQuestion}`, { method: 'DELETE' });
      loadExam(currentLevel);
    } catch (err) {
      showAlert(document.getElementById('questionAlert'), err.message);
    }
  });

  /* ================= 4. TÀI KHOẢN (đổi mật khẩu) ================= */
  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('pwAlert');
    const btn = e.target.querySelector('button[type="submit"]');
    const next = document.getElementById('pwNext').value;
    const confirm = document.getElementById('pwConfirm').value;

    if (next !== confirm) {
      showAlert(box, 'Mật khẩu nhập lại không khớp.');
      document.getElementById('pwConfirm').focus();
      return;
    }

    showAlert(box, '');
    setBusy(btn, true, 'Đang cập nhật…');
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: {
          current: document.getElementById('pwCurrent').value,
          next,
        },
      });
      e.target.reset();
      showAlert(box, 'Đã đổi mật khẩu thành công. Hãy dùng mật khẩu mới ở lần đăng nhập sau.', 'ok');
    } catch (err) {
      showAlert(box, err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  /* ================= KHỞI TẠO ================= */
  try {
    const res = await api('/api/levels');
    levels = res.levels || [];
    fillLevelSelects();
    activate('users'); // mở sẵn tab đầu tiên
  } catch (err) {
    showAlert(alertBox, err.message, 'error');
  }
})();
