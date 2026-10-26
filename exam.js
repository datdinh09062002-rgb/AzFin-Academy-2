/**
 * exam.js — Trang làm bài thi
 * Quy trình: tải câu hỏi → chọn đáp án → nộp → máy chấm → hiện điểm + đáp án.
 * Đáp án đúng KHÔNG được gửi xuống trước khi nộp (server giữ bí mật).
 */
(async function () {
  const user = await bootPage('dashboard');
  if (!user) return;

  const levelId = qsParam('id') || '1';
  const LETTERS = ['A', 'B', 'C', 'D'];

  const alertBox = document.getElementById('alert');
  const form = document.getElementById('examForm');
  const metaBox = document.getElementById('examMeta');
  const resultBox = document.getElementById('resultBox');
  const bar = document.getElementById('examBar');
  const countEl = document.getElementById('answeredCount');
  const submitBtn = document.getElementById('submitBtn');
  const crumb = document.getElementById('crumbLevel');

  let exam = null;
  let questions = [];

  /* ---------- 1. Tải bài thi ---------- */
  try {
    const data = await api(`/api/exams/${encodeURIComponent(levelId)}`);
    exam = data.exam;
    questions = data.questions;

    document.title = `${exam.title} — AZFIN Academy`;
    crumb.textContent = `Cấp độ ${String(levelId).padStart(2, '0')}`;
    crumb.setAttribute('href', `level.html?id=${levelId}`);
    document.getElementById('examTitle').textContent = exam.title;
    document.getElementById('examIntro').textContent = exam.intro || '';

    if (!questions.length) throw new ApiError(400, 'Bài thi này chưa có câu hỏi. Vui lòng quay lại sau.');

    renderMeta(data.attempts);
    renderQuestions();
    updateCount();
  } catch (err) {
    form.innerHTML = '';
    bar.classList.add('hidden');
    metaBox.classList.add('hidden');

    // Chưa đạt cấp độ trước → bài thi bị khóa
    if (err.status === 403) {
      const no = String(levelId).padStart(2, '0');
      const prev = Math.max(1, Number(levelId) - 1);
      const prevNo = String(prev).padStart(2, '0');

      document.getElementById('crumbLevel').textContent = `Cấp độ ${no}`;
      document.getElementById('examTitle').textContent = 'Chưa mở khóa';
      form.innerHTML = `
        <div class="empty">
          <h3>Bài thi Cấp độ ${no} đang khóa</h3>
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
    return;
  }

  /* ---------- 2. Thông tin bài thi + các lần làm trước ---------- */
  function renderMeta(attempts) {
    const best = attempts.length ? Math.max(...attempts.map((a) => a.score)) : null;
    metaBox.innerHTML = `
      <div class="exam-meta__facts">
        <div><span>Số câu</span><b>${questions.length}</b></div>
        <div><span>Điểm đạt</span><b>${exam.passScore}</b></div>
        <div><span>Số lần làm</span><b>${attempts.length}</b></div>
        <div><span>Cao nhất</span><b>${best === null ? '—' : best}</b></div>
      </div>
      <p class="small muted" style="margin:0;max-width:36ch">
        Chọn một phương án cho mỗi câu. Đáp án chỉ hiển thị sau khi bạn nộp bài.
      </p>`;
  }

  /* ---------- 3. Danh sách câu hỏi ---------- */
  function renderQuestions() {
    form.innerHTML = questions.map((q, qi) => `
      <div class="question fade-in" data-qid="${q.id}" style="animation-delay:${qi * 40}ms">
        <div class="question__head">
          <span class="question__no">Câu ${String(qi + 1).padStart(2, '0')}</span>
          <p class="question__text" id="qt-${q.id}">${escapeHtml(q.text)}</p>
        </div>
        <div class="options" role="radiogroup" aria-labelledby="qt-${q.id}">
          ${q.options.map((opt, oi) => `
            <label class="option" data-idx="${oi}">
              <input type="radio" name="q${q.id}" value="${oi}">
              <span class="option__letter">${LETTERS[oi]}</span>
              <span>${escapeHtml(opt)}</span>
            </label>`).join('')}
        </div>
      </div>`).join('');

    // Chọn đáp án → tô nổi bật phương án vừa chọn (mạnh hơn cả trạng thái hover)
    form.addEventListener('change', (e) => {
      const input = e.target.closest('.option input[type="radio"]');
      if (input) {
        const group = input.closest('.options');
        group.querySelectorAll('.option').forEach((el) => el.classList.remove('is-selected'));
        input.closest('.option').classList.add('is-selected');
      }
      updateCount();
    });
  }

  function answeredCount() {
    return questions.filter((q) => form.querySelector(`input[name="q${q.id}"]:checked`)).length;
  }

  function updateCount() {
    const n = answeredCount();
    countEl.textContent = `Đã trả lời ${n}/${questions.length} câu`;
  }

  /* ---------- 4. Nộp bài ---------- */
  submitBtn.addEventListener('click', async () => {
    const missing = questions.length - answeredCount();
    if (missing > 0) {
      showAlert(alertBox, `Bạn còn ${missing} câu chưa trả lời. Hãy chọn đủ đáp án trước khi nộp.`, 'error');
      const first = form.querySelector('.question:not(:has(input:checked))');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const answers = {};
    questions.forEach((q) => {
      const checked = form.querySelector(`input[name="q${q.id}"]:checked`);
      answers[q.id] = checked ? Number(checked.value) : -1;
    });

    showAlert(alertBox, '');
    setBusy(submitBtn, true, 'Đang chấm bài…');

    try {
      const res = await api(`/api/exams/${encodeURIComponent(levelId)}/submit`, {
        method: 'POST',
        body: { answers },
      });
      lockAnswers(res.detail);
      showResult(res);
    } catch (err) {
      showAlert(alertBox, err.message, 'error');
      setBusy(submitBtn, false);
    }
  });

  /** Khóa toàn bộ lựa chọn và tô màu đáp án đúng / sai. */
  function lockAnswers(detail) {
    const map = new Map(detail.map((d) => [d.id, d]));

    questions.forEach((q) => {
      const box = form.querySelector(`.question[data-qid="${q.id}"]`);
      const d = map.get(q.id);
      if (!box || !d) return;

      box.querySelectorAll('.option').forEach((label) => {
        const idx = Number(label.dataset.idx);
        const input = label.querySelector('input');
        input.disabled = true;
        label.classList.add('is-locked');
        if (idx === d.correct) label.classList.add('is-correct');
        else if (input.checked) label.classList.add('is-wrong');
      });
    });

    bar.classList.add('hidden');
  }

  /** Hiện khung kết quả ở đầu trang. */
  function showResult(res) {
    const passed = res.passed;
    resultBox.innerHTML = `
      <div class="result fade-in">
        <div class="result__label">Điểm của bạn</div>
        <div class="result__score">${res.score}</div>
        <h2>${passed ? 'Chúc mừng, bạn đã đạt!' : 'Chưa đạt ở lần này'}</h2>
        <p>
          Bạn trả lời đúng <b>${res.correct}/${res.total}</b> câu.
          Điểm đạt của bài thi là ${res.passScore}.
          ${passed ? 'Kết quả đã được lưu vào tiến độ của bạn.' : 'Hãy xem lại đáp án và thử lại — bạn có thể làm lại thoải mái.'}
        </p>
        <div class="result__actions">
          <button class="btn btn--light" type="button" id="reviewBtn">Xem đáp án</button>
          <button class="btn btn--gold" type="button" id="retryBtn">Làm lại</button>
          <a class="btn btn--light" href="level.html?id=${levelId}">Về cấp độ</a>
        </div>
      </div>`;

    showAlert(alertBox, '');
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('reviewBtn').addEventListener('click', () => {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('retryBtn').addEventListener('click', () => location.reload());
  }
})();
