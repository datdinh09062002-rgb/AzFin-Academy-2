/**
 * =============================================================================
 *  worker/index.js — BACKEND HỌC VIỆN ĐẦU TƯ
 * -----------------------------------------------------------------------------
 *  Chạy trên Cloudflare Worker. Dữ liệu lưu ở D1 (CSDL) và R2 (tài liệu).
 *  Không dùng thư viện ngoài — chỉ Web API chuẩn của Workers.
 *
 *  CẤU TRÚC FILE:
 *    1. Cấu hình
 *    2. Tiện ích (JSON, cookie, validate)
 *    3. Mật khẩu & phiên đăng nhập (PBKDF2 + cookie HttpOnly)
 *    4. Khởi tạo CSDL (tự chạy lần đầu mỗi worker)
 *    5. Phân quyền
 *    6. Handler cho từng endpoint
 *    7. Router & điểm vào fetch()
 *
 *  TẤT CẢ endpoint đều bắt đầu bằng /api/  — phần còn lại trả về file tĩnh.
 * =============================================================================
 */

import { SCHEMA, LEVELS, SEED_LESSONS, SEED_EXAMS } from './db.js';

/* =============================================================================
 * 1. CẤU HÌNH
 * ========================================================================== */
const CFG = {
  sessionCookie: 'az_session',   // tên cookie phiên (HttpOnly, SameSite=Lax)
  sessionDays: 30,               // thời hạn phiên đăng nhập
  pbkdf2Iterations: 100000,      // số vòng băm mật khẩu (tăng = an toàn hơn, chậm hơn)
  maxUploadBytes: 25 * 1024 * 1024, // giới hạn file tài liệu: 25MB
  // Chỉ cho phép tải lên các loại tài liệu học tập phổ biến
  allowedExtensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'zip', 'png', 'jpg', 'jpeg'],
  // Tài khoản Admin duy nhất — có thể ghi đè bằng biến môi trường ADMIN_EMAIL / ADMIN_PASSWORD
  admin: {
    email: 'admin@azfin.vn',
    password: 'Admin@1234!',
    name: 'Quản trị viên',
  },
};

const TEXT_ENCODER = new TextEncoder();

/* =============================================================================
 * 2. TIỆN ÍCH
 * ========================================================================== */

/** Trả về phản hồi JSON. */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Phản hồi lỗi dạng JSON: { ok:false, error:"..." }. */
function fail(status, message) {
  return json({ ok: false, error: message }, status);
}

/** Đọc body JSON của request (an toàn khi body rỗng hoặc sai định dạng). */
async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Lấy giá trị cookie theo tên. */
function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Tạo chuỗi Set-Cookie cho phiên. Thêm `Secure` khi chạy trên HTTPS. */
function sessionCookie(token, maxAge, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${CFG.sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Cookie xóa phiên (dùng khi đăng xuất). */
function clearCookie(url) {
  return sessionCookie('', 0, url);
}

/**
 * Chống CSRF: mọi thao tác ghi (POST/PUT/DELETE) chỉ được thực hiện
 * từ đúng origin của trang web này.
 */
function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // curl / công cụ không gửi Origin
  return origin === url.origin;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Lấy phần mở rộng của tên file (không dấu chấm), viết thường. */
function extensionOf(fileName) {
  const i = String(fileName || '').lastIndexOf('.');
  return i > 0 ? String(fileName).slice(i + 1).toLowerCase() : '';
}

/** Đổi tên file sang dạng an toàn để tạo khoá trên R2 (giữ tiếng Việt). */
function safeFileName(fileName) {
  return String(fileName).replace(/[\\/:*?"<>|\s]+/g, '-').slice(-80);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** So sánh chuỗi bí mật không lộ thời gian (timing-safe). */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* =============================================================================
 * 3. MẬT KHẨU & PHIÊN ĐĂNG NHẬP
 * ========================================================================== */

/** Băm mật khẩu bằng PBKDF2-SHA256. Kết quả: pbkdf2$số-vòng$muối$băm. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', TEXT_ENCODER.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: CFG.pbkdf2Iterations, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${CFG.pbkdf2Iterations}$${toHex(salt)}$${toHex(bits)}`;
}

/** Kiểm tra mật khẩu người dùng nhập vào với chuỗi băm đã lưu. */
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const key = await crypto.subtle.importKey('raw', TEXT_ENCODER.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(parts[2]), iterations, hash: 'SHA-256' },
      key,
      parts[3].length * 4
    );
    return safeEqual(toHex(bits), parts[3]);
  } catch {
    return false;
  }
}

/** SHA-256 dạng hex — dùng để lưu token phiên (không lưu token gốc). */
async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(text)));
}

/** Tạo phiên đăng nhập mới cho user. */
async function createSession(env, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  )
    .bind(await sha256Hex(token), userId, `+${CFG.sessionDays} days`)
    .run();
  return { token, maxAge: CFG.sessionDays * 24 * 3600 };
}

/** Trả về user đang đăng nhập, hoặc null nếu chưa đăng nhập / phiên hết hạn. */
async function currentUser(request, env) {
  const token = getCookie(request, CFG.sessionCookie);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
  )
    .bind(await sha256Hex(token))
    .first();
  return row || null;
}

/* =============================================================================
 * 4. KHỞI TẠO CSDL
 * ========================================================================== */

/** Chạy một câu lệnh SQL đơn giản. */
function run(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).run();
}
/** Lấy 1 dòng. */
function one(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).first();
}
/** Lấy nhiều dòng — .all() của D1 trả về { results: [...] }, ta trả thẳng mảng. */
function all(env, sql, params = []) {
  return env.DB.prepare(sql)
    .bind(...params)
    .all()
    .then((res) => res.results || []);
}

let readyPromise = null;

/**
 * Khởi tạo bảng + dữ liệu mẫu. Chỉ chạy 1 lần cho mỗi worker (isolate),
 * idempotent nên chạy lại bao nhiêu lần cũng không sao.
 */
function ensureReady(env) {
  if (!readyPromise) {
    readyPromise = init(env).catch((e) => {
      readyPromise = null; // lần sau thử lại
      throw e;
    });
  }
  return readyPromise;
}

/** Khoá đánh dấu CSDL đã hoàn tất khởi tạo (lưu trong bảng meta). */
const BOOT_KEY = 'boot_v1';

async function init(env) {
  /*
   * TỐI ƯU TỐC ĐỘ: mỗi câu lệnh D1 là một vòng gọi mạng. Trước đây khởi tạo
   * chạy tuần tự ~30 câu lệnh (≈ 2–3 giây ở D1 từ xa) → mỗi trang chậm theo.
   * Nay: đường thường gặp chỉ 2 câu; đường khởi tạo gộp vào các lần `batch`
   * (mỗi batch = 1 vòng gọi duy nhất).
   */
  // 4.1 Đã khởi tạo trước đó chưa? (1 câu truy vấn duy nhất)
  let booted = null;
  try {
    booted = await one(env, 'SELECT value FROM meta WHERE key = ?', [BOOT_KEY]);
  } catch {
    booted = null; // bảng meta chưa tồn tại → phải dựng CSDL từ đầu
  }

  if (booted) {
    await run(env, "DELETE FROM sessions WHERE expires_at < datetime('now')");
    return;
  }

  // 4.2 Tạo toàn bộ bảng trong 1 lần gọi batch
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));

  // 4.3 5 cấp độ học tập (1 batch)
  await env.DB.batch(
    LEVELS.map((lv) =>
      env.DB.prepare('INSERT OR IGNORE INTO levels (id, title, tagline, sort) VALUES (?, ?, ?, ?)')
        .bind(lv.id, lv.title, lv.tagline, lv.id)
    )
  );

  // 4.4 Dữ liệu mẫu (bài học + bài thi) — chỉ ghi đúng 1 lần
  const done = await one(env, "SELECT value FROM meta WHERE key = 'demo_v1'");
  if (!done) {
    // Bài học + bài thi không phụ thuộc nhau → gộp chung 1 batch
    await env.DB.batch([
      ...SEED_LESSONS.map((lesson) =>
        env.DB.prepare('INSERT INTO lessons (level_id, title, summary) VALUES (?, ?, ?)')
          .bind(lesson.level_id, lesson.title, lesson.summary)
      ),
      ...SEED_EXAMS.map((exam) =>
        env.DB.prepare('INSERT OR IGNORE INTO exams (level_id, title, intro, pass_score) VALUES (?, ?, ?, ?)')
          .bind(exam.level_id, exam.title, exam.intro, exam.pass_score)
      ),
    ]);

    // Lấy id bài thi của 5 cấp độ trong 1 câu, rồi gộp toàn bộ câu hỏi vào 1 batch
    const examRows = await all(env, 'SELECT id, level_id FROM exams');
    const examIdByLevel = new Map(examRows.map((row) => [row.level_id, row.id]));
    const questionStmts = [];
    for (const exam of SEED_EXAMS) {
      const examId = examIdByLevel.get(exam.level_id);
      if (!examId) continue;
      exam.questions.forEach((q, i) => {
        questionStmts.push(
          env.DB.prepare(
            `INSERT INTO questions (exam_id, sort, text, o1, o2, o3, o4, correct)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(examId, i + 1, q.text, q.options[0], q.options[1], q.options[2], q.options[3], q.correct)
        );
      });
    }
    if (questionStmts.length) await env.DB.batch(questionStmts);
    await run(env, "INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_v1', '1')");
  }

  // 4.5 Tài khoản Admin (duy nhất)
  const adminEmail = (env.ADMIN_EMAIL || CFG.admin.email).trim().toLowerCase();
  const exists = await one(env, 'SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!exists) {
    const hash = await hashPassword(env.ADMIN_PASSWORD || CFG.admin.password);
    await run(env, "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')", [
      adminEmail, CFG.admin.name, hash,
    ]);
  }

  // 4.6 Đánh dấu hoàn tất khởi tạo + dọn phiên hết hạn (1 batch)
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").bind(BOOT_KEY),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')'),
  ]);
}

/* =============================================================================
 * 5. PHÂN QUYỀN
 * ========================================================================== */

/** Yêu cầu đã đăng nhập. Trả về Response lỗi nếu không, ngược lại null. */
function requireAuth(ctx) {
  if (!ctx.user) return fail(401, 'Vui lòng đăng nhập để tiếp tục.');
  return null;
}

/** Yêu cầu quyền Admin. */
function requireAdmin(ctx) {
  if (!ctx.user) return fail(401, 'Vui lòng đăng nhập để tiếp tục.');
  if (ctx.user.role !== 'admin') return fail(403, 'Bạn không có quyền truy cập khu vực quản trị.');
  return null;
}

/**
 * KHÓA MỞ TỪNG CẤP ĐỘ (học tuần tự):
 *   • Cấp độ 01 luôn mở.
 *   • Muốn xem bài học / làm bài thi của Cấp độ N (N ≥ 2) thì phải ĐÃ ĐẠT
 *     bài thi Cấp độ N−1 (điểm ≥ điểm đạt, lưu trong bảng attempts).
 *   • Cấp độ chưa có bài thi thì không chặn (tránh kẹt cứng).
 *   • Tài khoản quản trị được mở toàn bộ để kiểm tra nội dung.
 * Trả về null nếu được phép, ngược lại Response lỗi 403.
 */
async function unlockGuard(ctx, levelId) {
  if (!(levelId >= 2) || ctx.user.role === 'admin') return null;

  const prevId = levelId - 1;
  const passed = await one(
    ctx.env,
    `SELECT COUNT(*) AS n
       FROM attempts a JOIN exams e ON e.id = a.exam_id
      WHERE e.level_id = ? AND a.user_id = ? AND a.passed = 1`,
    [prevId, ctx.user.id]
  );
  if (passed && passed.n > 0) return null;

  const prev = await one(ctx.env, 'SELECT title FROM levels WHERE id = ?', [prevId]);
  const prevName = `Cấp độ ${String(prevId).padStart(2, '0')}${prev ? ` — ${prev.title}` : ''}`;
  return fail(403, `Bạn cần đạt bài thi ${prevName} để mở khóa Cấp độ ${String(levelId).padStart(2, '0')}.`);
}

/* =============================================================================
 * 6. HANDLER
 * ========================================================================== */

/* ---------- 6.1. Tài khoản & phiên ---------- */

async function hRegister(ctx) {
  const { request, env, url } = ctx;
  const data = await readJson(request);
  const email = String(data.email || '').trim().toLowerCase();
  const name = String(data.name || '').trim().slice(0, 60);
  const password = String(data.password || '');

  if (!isEmail(email)) return fail(400, 'Email không hợp lệ.');
  if (name.length < 2) return fail(400, 'Vui lòng nhập họ và tên.');
  if (password.length < 8) return fail(400, 'Mật khẩu cần ít nhất 8 ký tự.');

  const dup = await one(env, 'SELECT id FROM users WHERE email = ?', [email]);
  if (dup) return fail(409, 'Email này đã được đăng ký. Hãy đăng nhập.');

  const hash = await hashPassword(password);
  const res = await run(env, 'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)', [
    email, name, hash, 'user',
  ]);
  await run(env, "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [res.meta.last_row_id]);

  const session = await createSession(env, res.meta.last_row_id);
  return json(
    { ok: true, user: { id: res.meta.last_row_id, email, name, role: 'user' } },
    201,
    { 'Set-Cookie': sessionCookie(session.token, session.maxAge, url) }
  );
}

async function hLogin(ctx) {
  const { request, env, url } = ctx;
  const data = await readJson(request);
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');

  const user = await one(env, 'SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return fail(401, 'Email hoặc mật khẩu không đúng.');
  }

  await run(env, "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);
  const session = await createSession(env, user.id);

  return json(
    { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    200,
    { 'Set-Cookie': sessionCookie(session.token, session.maxAge, url) }
  );
}

async function hLogout(ctx) {
  const token = getCookie(ctx.request, CFG.sessionCookie);
  if (token) await run(ctx.env, 'DELETE FROM sessions WHERE token_hash = ?', [await sha256Hex(token)]);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(ctx.url) });
}

async function hMe(ctx) {
  return requireAuth(ctx) || json({ user: ctx.user });
}

/** Đổi mật khẩu của chính người đang đăng nhập. */
async function hChangePassword(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const data = await readJson(ctx.request);
  const current = String(data.current || '');
  const next = String(data.next || '');

  if (next.length < 8) return fail(400, 'Mật khẩu mới cần ít nhất 8 ký tự.');
  const user = await one(ctx.env, 'SELECT password_hash FROM users WHERE id = ?', [ctx.user.id]);
  if (!(await verifyPassword(current, user.password_hash))) return fail(400, 'Mật khẩu hiện tại không đúng.');

  await run(ctx.env, 'UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), ctx.user.id]);
  return json({ ok: true });
}

/* ---------- 6.2. Chương trình học ---------- */

/** Danh sách 5 cấp độ + tiến độ của người đang đăng nhập. */
async function hLevels(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const rows = await all(
    ctx.env,
    `SELECT l.id, l.title, l.tagline,
            (SELECT COUNT(*) FROM lessons ls WHERE ls.level_id = l.id) AS lesson_count,
            e.id AS exam_id, e.title AS exam_title, e.pass_score,
            (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
            (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.user_id = ?) AS attempt_count,
            (SELECT MAX(a.score) FROM attempts a WHERE a.exam_id = e.id AND a.user_id = ?) AS best_score,
            (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.user_id = ? AND a.passed = 1) AS passed
       FROM levels l
       LEFT JOIN exams e ON e.level_id = l.id
      ORDER BY l.sort, l.id`,
    [ctx.user.id, ctx.user.id, ctx.user.id]
  );
    // Khóa mở từng cấp: cấp N (N ≥ 2) bị khóa khi cấp N−1 chưa đạt.
    // rows đã sắp xếp tăng dần nên chỉ cần nhớ kết quả của mức ngay trước đó.
    let prevPassed = true; // Cấp độ 01 luôn mở
    const levels = rows.map((r) => {
      const examPassed = r.exam_id ? r.passed > 0 : true; // chưa có bài thi → coi như đã qua
      const locked = r.id > 1 && ctx.user.role !== 'admin' && !prevPassed;
      prevPassed = examPassed;

      return {
        id: r.id,
        title: r.title,
        tagline: r.tagline,
        lessonCount: r.lesson_count,
        locked,
        exam: r.exam_id
          ? {
              id: r.exam_id,
              title: r.exam_title,
              passScore: r.pass_score,
              questionCount: r.question_count,
              attemptCount: r.attempt_count,
              bestScore: r.best_score,
              passed: r.passed > 0,
            }
          : null,
      };
    });

    return json({ levels });
}

/** Chi tiết một cấp độ: bài học + bài thi + kết quả tốt nhất. */
async function hLevel(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const levelId = Number(ctx.m[1]);
  const level = await one(ctx.env, 'SELECT * FROM levels WHERE id = ?', [levelId]);
  if (!level) return fail(404, 'Không tìm thấy cấp độ.');

  const lock = await unlockGuard(ctx, levelId);
  if (lock) return lock;

  const lessons = await all(
    ctx.env,
    `SELECT id, title, summary, file_name, file_size, content_type, created_at
       FROM lessons WHERE level_id = ? ORDER BY id`,
    [levelId]
  );
  const exam = await one(ctx.env, 'SELECT * FROM exams WHERE level_id = ?', [levelId]);
  let examInfo = null;
  if (exam) {
    const stats = await one(
      ctx.env,
      `SELECT COUNT(*) AS question_count,
              (SELECT COUNT(*) FROM attempts WHERE exam_id = ? AND user_id = ?) AS attempt_count,
              (SELECT MAX(score) FROM attempts WHERE exam_id = ? AND user_id = ?) AS best_score,
              (SELECT COUNT(*) FROM attempts WHERE exam_id = ? AND user_id = ? AND passed = 1) AS passed
         FROM questions WHERE exam_id = ?`,
      [exam.id, ctx.user.id, exam.id, ctx.user.id, exam.id, ctx.user.id, exam.id]
    );
    examInfo = {
      id: exam.id,
      title: exam.title,
      intro: exam.intro,
      passScore: exam.pass_score,
      questionCount: Number(stats.question_count),
      attemptCount: Number(stats.attempt_count),
      bestScore: stats.best_score,
      passed: Number(stats.passed) > 0,
    };
  }

  return json({ level, lessons, exam: examInfo });
}

/** Bài thi đang mở: GIỮ BÍ MẬT đáp án (chỉ trả về khi đã nộp). */
async function hExam(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const levelId = Number(ctx.m[1]);

  const lock = await unlockGuard(ctx, levelId);
  if (lock) return lock;
  const exam = await one(ctx.env, 'SELECT * FROM exams WHERE level_id = ?', [levelId]);
  if (!exam) return fail(404, 'Cấp độ này chưa có bài thi. Vui lòng quay lại sau.');

  const questions = await all(
    ctx.env,
    'SELECT id, text, o1, o2, o3, o4 FROM questions WHERE exam_id = ? ORDER BY sort, id',
    [exam.id]
  );
  const attempts = await all(
    ctx.env,
    'SELECT id, score, total, correct, passed, created_at FROM attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10',
    [exam.id, ctx.user.id]
  );

  return json({
    exam: { id: exam.id, levelId, title: exam.title, intro: exam.intro, passScore: exam.pass_score },
    questions: questions.map((q) => ({ id: q.id, text: q.text, options: [q.o1, q.o2, q.o3, q.o4] })),
    attempts,
  });
}

/** Nộp bài: chấm điểm phía MÁY CHỦ rồi lưu lịch sử. */
async function hSubmit(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const levelId = Number(ctx.m[1]);

  const lock = await unlockGuard(ctx, levelId);
  if (lock) return lock;
  const exam = await one(ctx.env, 'SELECT * FROM exams WHERE level_id = ?', [levelId]);
  if (!exam) return fail(404, 'Bài thi không tồn tại.');

  const questions = await all(
    ctx.env,
    'SELECT id, correct FROM questions WHERE exam_id = ? ORDER BY sort, id',
    [exam.id]
  );
  if (questions.length === 0) return fail(400, 'Bài thi chưa có câu hỏi.');

  const data = await readJson(ctx.request);
  const answers = data.answers && typeof data.answers === 'object' ? data.answers : {};

  let correctCount = 0;
  const detail = questions.map((q) => {
    // Đáp án của người dùng: chỉ chấp nhận 0..3 (A..D), không có thì là -1
    const raw = answers[q.id];
    const parsed = raw === undefined || raw === null || String(raw).trim() === '' ? NaN : Number(raw);
    const chosen = Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : -1;
    const isRight = chosen === q.correct - 1; // DB lưu đáp án 1..4
    if (isRight) correctCount++;
    return { id: q.id, chosen, correct: q.correct - 1 };
  });

  const total = questions.length;
  const score = Math.round((correctCount / total) * 100);
  const passed = score >= exam.pass_score ? 1 : 0;

  await run(
    ctx.env,
    `INSERT INTO attempts (user_id, exam_id, score, total, correct, passed, answers)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ctx.user.id, exam.id, score, total, correctCount, passed, JSON.stringify(detail)]
  );

  return json({ ok: true, score, total, correct: correctCount, passed: passed === 1, passScore: exam.pass_score, detail });
}

/** Lịch sử làm bài của người dùng. */
async function hAttempts(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const rows = await all(
    ctx.env,
    `SELECT a.id, a.score, a.total, a.correct, a.passed, a.created_at,
            l.id AS level_id, l.title AS level_title, e.title AS exam_title
       FROM attempts a
       JOIN exams e ON e.id = a.exam_id
       JOIN levels l ON l.id = e.level_id
      WHERE a.user_id = ?
      ORDER BY a.id DESC
      LIMIT 20`,
    [ctx.user.id]
  );
  return json({ attempts: rows });
}

/** Tải tài liệu về (chỉ người đã đăng nhập). */
async function hFile(ctx) {
  const guard = requireAuth(ctx);
  if (guard) return guard;
  const lesson = await one(ctx.env, 'SELECT * FROM lessons WHERE id = ?', [Number(ctx.m[1])]);
  if (!lesson) return fail(404, 'Không tìm thấy tài liệu.');
  if (!lesson.object_key) return fail(404, 'Tài liệu này chưa có tệp đính kèm.');

  const lock = await unlockGuard(ctx, lesson.level_id);
  if (lock) return lock;

  const object = await ctx.env.FILES.get(lesson.object_key);
  if (!object) return fail(410, 'Tệp đã bị xoá hoặc không còn trên hệ thống.');

  const asciiName = (lesson.file_name || 'tai-lieu').replace(/[^\x20-\x7E]/g, '_');
  return new Response(object.body, {
    headers: {
      'Content-Type': lesson.content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(lesson.file_name || 'tai-lieu')}`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}

/* ---------- 6.3. Khu vực ADMIN ---------- */

/** Danh sách người dùng + tiến độ học tập của từng người. */
async function hAdminUsers(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const rows = await all(
    ctx.env,
    `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts,
            (SELECT COUNT(DISTINCT e.level_id)
               FROM attempts a JOIN exams e ON e.id = a.exam_id
              WHERE a.user_id = u.id AND a.passed = 1) AS levels_passed
       FROM users u
      ORDER BY u.created_at DESC`
  );
  return json({ users: rows });
}

/**
 * Cấp hoặc thu hồi quyền quản trị (admin) của một tài khoản.
 * Quy tắc an toàn:
 *   • Không thể tự hạ cấp chính mình (tránh kẹt không còn admin nào).
 *   • Luôn giữ lại ít nhất một tài khoản admin.
 *   • Chỉ admin mới gọi được (requireAdmin).
 */
async function hAdminSetRole(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;

  const userId = Number(ctx.m[1]);
  const data = await readJson(ctx.request);
  const role = data.role === 'admin' ? 'admin' : 'user';

  const target = await one(ctx.env, 'SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
  if (!target) return fail(404, 'Không tìm thấy người dùng này.');
  if (target.role === role) return json({ ok: true, role, user: target }); // đã đúng vai trò

  if (ctx.user.id === userId && role !== 'admin') {
    return fail(400, 'Bạn không thể tự thu hồi quyền quản trị của chính mình.');
  }
  if (target.role === 'admin' && role === 'user') {
    const admins = await one(ctx.env, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    if (admins && admins.n <= 1) return fail(400, 'Hệ thống phải luôn có ít nhất một tài khoản quản trị.');
  }

  await run(ctx.env, 'UPDATE users SET role = ? WHERE id = ?', [role, userId]);
  return json({ ok: true, role, user: { ...target, role } });
}

/** Toàn bộ tài liệu (kèm tên cấp độ) cho trang quản trị. */
async function hAdminLessons(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const rows = await all(
    ctx.env,
    `SELECT ls.*, l.title AS level_title
       FROM lessons ls JOIN levels l ON l.id = ls.level_id
      ORDER BY ls.level_id, ls.id`
  );
  return json({ lessons: rows });
}

/** Tải tài liệu học tập lên R2 (multipart/form-data). */
async function hAdminUpload(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;

  let form;
  try {
    form = await ctx.request.formData();
  } catch {
    return fail(400, 'Dữ liệu gửi lên không đúng định dạng multipart/form-data.');
  }

  const levelId = Number(form.get('level_id'));
  const title = String(form.get('title') || '').trim().slice(0, 160);
  const summary = String(form.get('summary') || '').trim().slice(0, 500);
  const file = form.get('file');

  if (!Number.isInteger(levelId) || levelId < 1) return fail(400, 'Vui lòng chọn cấp độ.');
  if (!title) return fail(400, 'Vui lòng nhập tiêu đề bài học.');
  if (!file || typeof file === 'string') return fail(400, 'Vui lòng chọn file tài liệu.');

  const ext = extensionOf(file.name);
  if (!CFG.allowedExtensions.includes(ext)) {
    return fail(400, `Chưa hỗ trợ định dạng .${ext || '?'}. Chỉ nhận: ${CFG.allowedExtensions.join(', ')}.`);
  }
  if (file.size > CFG.maxUploadBytes) return fail(413, 'File vượt giới hạn 25MB.');

  const level = await one(ctx.env, 'SELECT id FROM levels WHERE id = ?', [levelId]);
  if (!level) return fail(400, 'Cấp độ không tồn tại.');

  const objectKey = `docs/lv${levelId}/${Date.now()}-${safeFileName(file.name)}`;
  await ctx.env.FILES.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const res = await run(
    ctx.env,
    `INSERT INTO lessons (level_id, title, summary, object_key, file_name, content_type, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [levelId, title, summary, objectKey, file.name, file.type || 'application/octet-stream', file.size]
  );

  return json({ ok: true, id: res.meta.last_row_id }, 201);
}

/** Xoá bài học + file đính kèm. */
async function hAdminDeleteLesson(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const lesson = await one(ctx.env, 'SELECT * FROM lessons WHERE id = ?', [Number(ctx.m[1])]);
  if (!lesson) return fail(404, 'Không tìm thấy bài học.');
  if (lesson.object_key) await ctx.env.FILES.delete(lesson.object_key);
  await run(ctx.env, 'DELETE FROM lessons WHERE id = ?', [lesson.id]);
  return json({ ok: true });
}

/** Xem bài thi của một cấp độ (kèm đáp án — chỉ Admin). */
async function hAdminExam(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const levelId = Number(ctx.m[1]);
  const level = await one(ctx.env, 'SELECT * FROM levels WHERE id = ?', [levelId]);
  if (!level) return fail(404, 'Cấp độ không tồn tại.');

  const exam = await one(ctx.env, 'SELECT * FROM exams WHERE level_id = ?', [levelId]);
  const questions = exam
    ? await all(ctx.env, 'SELECT * FROM questions WHERE exam_id = ? ORDER BY sort, id', [exam.id])
    : [];
  return json({ level, exam, questions });
}

/** Tạo hoặc cập nhật thông tin bài thi của cấp độ. */
async function hAdminExamUpdate(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const levelId = Number(ctx.m[1]);
  const level = await one(ctx.env, 'SELECT id FROM levels WHERE id = ?', [levelId]);
  if (!level) return fail(404, 'Cấp độ không tồn tại.');

  const data = await readJson(ctx.request);
  const title = String(data.title || '').trim().slice(0, 160);
  const intro = String(data.intro || '').trim().slice(0, 600);
  const passScore = Math.min(100, Math.max(0, Number(data.pass_score) || 0));
  if (!title) return fail(400, 'Vui lòng nhập tên bài thi.');

  const exam = await one(ctx.env, 'SELECT * FROM exams WHERE level_id = ?', [levelId]);
  if (exam) {
    await run(ctx.env, "UPDATE exams SET title = ?, intro = ?, pass_score = ?, updated_at = datetime('now') WHERE id = ?", [
      title, intro, passScore, exam.id,
    ]);
  } else {
    await run(ctx.env, 'INSERT INTO exams (level_id, title, intro, pass_score) VALUES (?, ?, ?, ?)', [
      levelId, title, intro, passScore,
    ]);
  }
  return json({ ok: true });
}

/** Thêm một câu hỏi vào bài thi của cấp độ. */
async function hAdminAddQuestion(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const levelId = Number(ctx.m[1]);
  const exam = await one(ctx.env, 'SELECT * FROM exams WHERE level_id = ?', [levelId]);
  if (!exam) return fail(404, 'Hãy lưu thông tin bài thi trước khi thêm câu hỏi.');

  const data = await readJson(ctx.request);
  const text = String(data.text || '').trim().slice(0, 1000);
  const options = Array.isArray(data.options) ? data.options.map((o) => String(o || '').trim().slice(0, 300)) : [];
  const correct = Number(data.correct);

  if (!text) return fail(400, 'Vui lòng nhập nội dung câu hỏi.');
  if (options.length < 4 || options.some((o) => !o)) return fail(400, 'Cần đủ 4 phương án trả lời.');
  if (!(correct >= 1 && correct <= 4)) return fail(400, 'Vui lòng chọn đáp án đúng.');

  const last = await one(ctx.env, 'SELECT COALESCE(MAX(sort), 0) AS last_sort FROM questions WHERE exam_id = ?', [exam.id]);
  const res = await run(
    ctx.env,
    `INSERT INTO questions (exam_id, sort, text, o1, o2, o3, o4, correct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [exam.id, last.last_sort + 1, text, options[0], options[1], options[2], options[3], correct]
  );
  return json({ ok: true, id: res.meta.last_row_id }, 201);
}

/** Xoá một câu hỏi. */
async function hAdminDeleteQuestion(ctx) {
  const guard = requireAdmin(ctx);
  if (guard) return guard;
  const id = Number(ctx.m[1]);
  const q = await one(ctx.env, 'SELECT id FROM questions WHERE id = ?', [id]);
  if (!q) return fail(404, 'Không tìm thấy câu hỏi.');
  await run(ctx.env, 'DELETE FROM questions WHERE id = ?', [id]);
  return json({ ok: true });
}

/* =============================================================================
 * 7. ROUTER & ĐIỂM VÀO
 * ========================================================================== */

/** Bảng định tuyến: [METHOD, regex, handler]. Nhóm captured (?...) truyền qua ctx.m. */
const ROUTES = [
  ['POST', /^\/api\/auth\/register$/, hRegister],
  ['POST', /^\/api\/auth\/login$/, hLogin],
  ['POST', /^\/api\/auth\/logout$/, hLogout],
  ['GET', /^\/api\/auth\/me$/, hMe],
  ['POST', /^\/api\/auth\/password$/, hChangePassword],

  ['GET', /^\/api\/levels$/, hLevels],
  ['GET', /^\/api\/levels\/(\d+)$/, hLevel],
  ['GET', /^\/api\/exams\/(\d+)$/, hExam],
  ['POST', /^\/api\/exams\/(\d+)\/submit$/, hSubmit],
  ['GET', /^\/api\/attempts$/, hAttempts],
  ['GET', /^\/api\/files\/(\d+)$/, hFile],

  ['GET', /^\/api\/admin\/users$/, hAdminUsers],
  ['PATCH', /^\/api\/admin\/users\/(\d+)\/role$/, hAdminSetRole],
  ['GET', /^\/api\/admin\/lessons$/, hAdminLessons],
  ['POST', /^\/api\/admin\/lessons$/, hAdminUpload],
  ['DELETE', /^\/api\/admin\/lessons\/(\d+)$/, hAdminDeleteLesson],
  ['GET', /^\/api\/admin\/exams\/(\d+)$/, hAdminExam],
  ['PUT', /^\/api\/admin\/exams\/(\d+)$/, hAdminExamUpdate],
  ['POST', /^\/api\/admin\/exams\/(\d+)\/questions$/, hAdminAddQuestion],
  ['DELETE', /^\/api\/admin\/questions\/(\d+)$/, hAdminDeleteQuestion],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Mọi request không phải /api/ → trả file tĩnh (HTML/CSS/JS) từ /public
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // Chống CSRF: chặn thao tác ghi từ domain khác
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !sameOrigin(request, url)) {
      return fail(403, 'Origin không hợp lệ.');
    }

    try {
      await ensureReady(env);

      const user = await currentUser(request, env);
      const ctx = { request, env, url, user, method: request.method, path: url.pathname, m: null };

      for (const [method, pattern, handler] of ROUTES) {
        if (method !== request.method) continue;
        const match = url.pathname.match(pattern);
        if (!match) continue;
        ctx.m = match;
        return await handler(ctx);
      }
      return fail(404, 'Không tìm thấy endpoint.');
    } catch (error) {
      console.error('API error:', error);
      return fail(500, 'Lỗi máy chủ. Vui lòng thử lại sau.');
    }
  },
};
