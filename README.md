# AZFIN Academy — Hệ thống học đầu tư 5 cấp độ

Trang web học tập đầu tư: **frontend HTML / CSS / JavaScript thuần** (sửa trực tiếp bằng Sublime Text)
+ **backend Cloudflare Worker** với **CSDL D1** và **kho tài liệu R2**.

---

## 1. Cấu trúc thư mục

```
dautu-academy/
├── public/                   ← GIAO DIỆN (phần bạn chỉnh sửa nhiều nhất)
│   ├── index.html            trang giới thiệu
│   ├── login.html            đăng nhập / đăng ký
│   ├── dashboard.html        tổng quan 5 cấp độ + lịch sử thi
│   ├── level.html?id=1       nội dung 1 cấp độ (bài học + khối bài thi)
│   ├── exam.html?id=1        làm bài thi
│   ├── admin.html            khu vực quản trị (admin)
│   ├── css/style.css         toàn bộ giao diện — có chú thích theo mục
│   └── js/
│       ├── config.js         ★ đổi tên thương hiệu / khẩu hiệu tại đây
│       ├── api.js            gọi API + tiện ích (escape, định dạng ngày, cỡ file…)
│       ├── layout.js         header / footer / bảo vệ trang
│       ├── home.js  login.js  dashboard.js  level.js  exam.js  admin.js
│
├── worker/
│   ├── index.js              API backend (đăng nhập, admin, bài thi, tài liệu)
│   └── db.js                 ★ cấu trúc bảng + 5 cấp độ + dữ liệu mẫu
│
├── deploy.json               manifest khi deploy lên Freebuff Sites
├── wrangler.jsonc            cấu hình chạy local (binding DB / FILES / ASSETS)
└── .tools/                   Node portable (chỉ dùng để chạy wrangler local)
```

## 2. Chạy trên máy

Cách đơn giản nhất: mở thư mục `public/` bằng trình duyệt là thấy giao diện —
nhưng **đăng nhập và dữ liệu cần backend** nên hãy chạy đủ bộ:

```bash
cd dautu-academy
npm install          # cài wrangler (1 lần)
npm run dev          # chạy local tại http://localhost:8787
```

> Máy bạn chưa có Node? Đã có bản portable trong `.tools/node-v24.22.1-win-x64/`:
> ```bash
> export PATH="$PWD/.tools/node-v24.22.1-win-x64:$PATH"
> npm run dev
> ```

Mọi thay đổi HTML/CSS/JS chỉ cần **lưu file → F5 trình duyệt** là thấy ngay.

## 3. Tài khoản

| Vai trò | Email | Mật khẩu |
|---|---|---|
| **Admin** | `admin@azfin.vn` | `Admin@1234!` |
| Học viên | tự đăng ký trên trang `login.html` | do bạn đặt |

Đổi tài khoản admin: đặt biến môi trường `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(trong wrangler.jsonc `vars` khi chạy local, hoặc mục Secrets của Sites) **trước lần chạy đầu tiên**,
vì tài khoản admin chỉ được tạo khi CSDL chưa có.

## 4. Thao tác trên trang quản trị (`admin.html`)

- **Tab Người dùng**: danh sách email, họ tên, vai trò, ngày tham gia, lần đăng nhập cuối,
  số bài đã thi và số cấp độ đã đạt.
- **Tab Tài liệu**: chọn cấp độ → nhập tiêu đề/mô tả → chọn file (≤ 25MB) → *Tải lên*.
  File lưu ở R2, bài học hiện ngay trong trang cấp độ, học viên bấm *Tải tài liệu* để tải về.
- **Tab Bài thi**: chọn cấp độ → sửa tên bài / mô tả / điểm đạt → thêm câu hỏi
  (nội dung + 4 phương án + chọn đáp án đúng) → lưu. Mỗi cấp độ có **một** bài thi chung.

> Dữ liệu mẫu (5 cấp độ, 15 bài học, 5 bài thi × 5 câu) chỉ được ghi **một lần** khi khởi động.
> Sau đó mọi thay đổi trên trang admin là chính gốc.

## 5. Đưa lên mạng (Freebuff Sites)

**Trạng thái: đã xuất bản bản Preview.**

| Thông tin | Giá trị |
|---|---|
| Site ID | `91337cb1-ee6f-4ab8-b0f2-bb0c93faa370` |
| URL Preview | https://site-73844cfb9bc54dcf84009b1679f4fb2a.freebuff.page |
| Binding | `DB` (D1) · `FILES` (R2) |
| Manifest | `deploy.json` |

Quy trình redeploy sau khi chỉnh sửa giao diện:
1. Sửa file trong `public/` (lưu là xong, không cần build).
2. Gọi lại lệnh deploy với Site ID và manifestPath ở trên (requestId mới).
3. Môi trường Preview đang bật xuất bản nên bản mới tự hiển thị.

> Lưu ý: `deploy.json` phải liệt kê **cả hai** module (`index.js` và `db.js`) vì
> `worker/index.js` có import `./db.js`. Thiếu module sẽ bị Cloudflare từ chối (lỗi 10021).

## 6. Bảo mật đã có sẵn

- Mật khẩu băm bằng **PBKDF2-SHA256 (100.000 vòng)** + muối riêng từng người.
- Phiên đăng nhập là **cookie HttpOnly**, chỉ lưu SHA-256 của token trong CSDL.
- Mọi thao tác ghi (POST/PUT/DELETE) đều kiểm tra **Origin** → chống CSRF.
- Bài thi **không gửi đáp án đúng** xuống trình duyệt trước khi học viên nộp.
- Chỉ admin mới gọi được các endpoint `/api/admin/*`; học viên chỉ thấy dữ liệu của mình.
