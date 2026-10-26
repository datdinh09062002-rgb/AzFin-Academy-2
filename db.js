/**
 * =============================================================================
 *  db.js — CẤU TRÚC CSDL & DỮ LIỆU MẪU
 * -----------------------------------------------------------------------------
 *  File này chỉ chứa câu lệnh khởi tạo CSDL (idempotent) và dữ liệu seed.
 *  Worker tự chạy khi khởi động, KHÔNG cần chạy lệnh SQL thủ công.
 *
 *  Cách thêm/sửa nội dung:
 *   • Sửa tiêu đề 5 cấp độ  → mảng LEVELS
 *   • Thêm bài học mẫu      → SEED_LESSONS (chỉ được ghi 1 lần duy nhất)
 *   • Thêm câu hỏi mẫu     → SEED_EXAMS   (chỉ được ghi 1 lần duy nhất)
 *   • Sau lần chạy đầu, mọi chỉnh sửa nội dung nên làm trên trang ADMIN.
 * =============================================================================
 */

/** Các bảng của hệ thống. Dùng IF NOT EXISTS nên an toàn khi chạy lại. */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     email         TEXT    NOT NULL UNIQUE,
     name          TEXT    NOT NULL DEFAULT '',
     password_hash TEXT    NOT NULL,
     role          TEXT    NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
     created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
     last_login_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,   -- SHA-256 của cookie, không lưu token gốc
     user_id    INTEGER NOT NULL,
     created_at TEXT    NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT    NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS levels (
     id      INTEGER PRIMARY KEY,
     title   TEXT NOT NULL,
     tagline TEXT NOT NULL DEFAULT '',
     sort    INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS lessons (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     level_id     INTEGER NOT NULL,
     title        TEXT    NOT NULL,
     summary      TEXT    NOT NULL DEFAULT '',
     object_key   TEXT,                                 -- khoá file trên R2
     file_name    TEXT,
     content_type TEXT,
     file_size    INTEGER,
     created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS exams (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     level_id   INTEGER NOT NULL UNIQUE,                -- 1 cấp độ = 1 bài thi chung
     title      TEXT    NOT NULL,
     intro      TEXT    NOT NULL DEFAULT '',
     pass_score INTEGER NOT NULL DEFAULT 70,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS questions (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     exam_id INTEGER NOT NULL,
     sort    INTEGER NOT NULL DEFAULT 0,
     text    TEXT    NOT NULL,
     o1      TEXT    NOT NULL,
     o2      TEXT    NOT NULL,
     o3      TEXT    NOT NULL,
     o4      TEXT    NOT NULL,
     correct INTEGER NOT NULL                            -- 1..4
   )`,
  `CREATE TABLE IF NOT EXISTS attempts (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    INTEGER NOT NULL,
     exam_id    INTEGER NOT NULL,
     score      INTEGER NOT NULL,                        -- điểm 0..100
     total      INTEGER NOT NULL,                        -- số câu
     correct    INTEGER NOT NULL,
     passed     INTEGER NOT NULL DEFAULT 0,
     answers    TEXT    NOT NULL DEFAULT '{}',           -- JSON kết quả từng câu
     created_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT
   )`,
];

/** 5 cấp độ học tập (yêu cầu của dự án). INSERT OR IGNORE để giữ chỉnh sửa của Admin. */
export const LEVELS = [
  {
    id: 1,
    title: 'Kiến thức chứng khoán cho người mới',
    tagline: 'Nền tảng: thị trường, lệnh giao dịch và tư duy đúng trước khi bỏ tiền vào.',
  },
  {
    id: 2,
    title: 'Kiến thức tích sản',
    tagline: 'Xây danh mục để thời gian và lãi kép làm việc thay cho bạn.',
  },
  {
    id: 3,
    title: 'Kiến thức tích sản nâng cao',
    tagline: 'Đọc báo cáo tài chính, đánh giá chất lượng doanh nghiệp và kỷ luật vốn.',
  },
  {
    id: 4,
    title: 'Kiến thức đọc vị cổ phiếu',
    tagline: 'Giải mã câu chuyện sau con số: lợi thế cạnh tranh, ban lãnh đạo, bẫy kế toán.',
  },
  {
    id: 5,
    title: 'Kiến thức định giá cổ phiếu',
    tagline: 'Ước tính giá trị thật bằng bội số, dòng tiền chiết khấu và biên an toàn.',
  },
];

/** Bài học mẫu (chưa kèm tệp). Admin tải tài liệu lên để gắn thêm file đính kèm. */
export const SEED_LESSONS = [
  { level_id: 1, title: 'Chứng khoán là gì và tiền của bạn đi đâu?', summary: 'Hiểu cấu trúc thị trường, vai trò công ty chứng khoán và nơi dòng tiền thực sự chảy tới.' },
  { level_id: 1, title: 'Mở tài khoản & đọc bảng giá đúng cách', summary: 'Các bước mở tài khoản, cách đọc mã, giá, khối lượng và danh sách chờ.' },
  { level_id: 1, title: '10 quy tắc cho người mới bắt đầu', summary: 'Quản trị vốn, cắt lỗ và kỳ vọng lợi nhuận thực tế.' },

  { level_id: 2, title: 'Tư duy tích sản thay vì đầu cơ', summary: 'Phân biệt hai cách tiếp cận và xây khung ra quyết định dài hạn.' },
  { level_id: 2, title: 'Lãi kép và sức mạnh của thời gian', summary: 'Lãi kép tích luỹ thế nào, vì sao bắt đầu sớm quan trọng hơn chọn đúng cổ phiếu.' },
  { level_id: 2, title: 'DCA: mua đều đặn, bỏ cảm xúc', summary: 'Xây lịch đầu tư định kỳ và thoát khỏi vòng mua đỉnh – bán đáy.' },

  { level_id: 3, title: 'Đọc báo cáo tài chính trong 60 phút', summary: 'Bảng cân đối, kết quả kinh doanh, lưu chuyển tiền tệ — đọc theo thứ tự nào.' },
  { level_id: 3, title: 'ROE, ROIC và chất lượng lợi nhuận', summary: 'Phân tách lợi nhuận đến từ vận hành hay từ đòn bẩy tài chính.' },
  { level_id: 3, title: 'Quản trị danh mục & kiểm soát rủi ro', summary: 'Phân bổ vốn, tái cân bằng danh mục và giới hạn tổn thất cho phép.' },

  { level_id: 4, title: 'Lợi thế cạnh tranh (moat) của doanh nghiệp', summary: 'Nhận diện rào chắn thực sự bảo vệ biên lợi nhuận trước đối thủ.' },
  { level_id: 4, title: 'Ban lãnh đạo có đáng tin không?', summary: 'Theo dõi lịch sử cam kết, cấu trúc sở hữu và cách doanh nghiệp sử dụng tiền.' },
  { level_id: 4, title: 'Những bẫy kế toán thường gặp', summary: 'Dấu hiệu lợi nhuận ảo, giao dịch liên kết và dòng tiền bất thường.' },

  { level_id: 5, title: 'Định giá bằng bội số P/E, P/B, PEG', summary: 'Chọn bội số đúng ngành, đúng chu kỳ và hiểu điều kiện đi kèm.' },
  { level_id: 5, title: 'DCF cho người không giỏi toán', summary: 'Ba biến số quan trọng nhất và cách kiểm chứng kết quả định giá.' },
  { level_id: 5, title: 'Biên an toàn và kịch bản giá', summary: 'Ước tính thận trọng, kịch bản xấu và vị thế mua đủ hấp dẫn.' },
];

/**
 * Bài thi mẫu cho từng cấp độ — mỗi cấp 5 câu trắc nghiệm 4 phương án.
 * `correct` là đáp án đúng (1..4), đếm từ phương án A.
 */
export const SEED_EXAMS = [
  {
    level_id: 1,
    title: 'Bài thi: Kiến thức cơ bản về chứng khoán',
    intro: '5 câu hỏi nền tảng giúp bạn kiểm tra lại phần đã học trước khi sang cấp độ 2.',
    pass_score: 70,
    questions: [
      {
        text: 'Một cổ phiếu đại diện cho điều gì?',
        options: [
          'Một khoản vay bạn cho doanh nghiệp vay',
          'Quyền sở hữu một phần trong doanh nghiệp',
          'Quyền sở hữu toàn bộ doanh nghiệp',
          'Một khoản tiền gửi có kỳ hạn',
        ],
        correct: 2,
      },
      {
        text: 'Phiên giao dịch trên HOSE diễn ra trong khoảng thời gian nào?',
        options: [
          '8:00 – 15:00, không nghỉ trưa',
          '9:00 – 11:30 và 13:00 – 15:00',
          '9:00 – 11:00 và 13:30 – 16:00',
          'Chỉ giao dịch buổi sáng',
        ],
        correct: 2,
      },
      {
        text: 'Biện pháp nào giúp giảm rủi ro hiệu quả nhất cho người mới?',
        options: [
          'Đặt toàn bộ tiền vào một cổ phiếu đang tăng',
          'Đa dạng hóa danh mục theo ngành và nhóm tài sản',
          'Mua thêm khi đang lỗ để giảm giá vốn',
          'Dùng đòn bẩy để mua nhiều hơn',
        ],
        correct: 2,
      },
      {
        text: 'Nhà đầu tư nắm giữ cổ phiếu dài hạn thường kiếm tiền từ những nguồn nào?',
        options: [
          'Chỉ từ chênh lệch giá',
          'Chỉ từ cổ tức',
          'Từ cổ tức và chênh lệch giá',
          'Từ lãi tiền gửi',
        ],
        correct: 3,
      },
      {
        text: 'Khi giá cổ phiếu giảm mạnh, việc đầu tiên nên làm là gì?',
        options: [
          'Bán hết ngay để cắt lỗ',
          'Kiểm tra lại luận điểm đầu tư và chất lượng doanh nghiệp',
          'Mua thêm ngay không cần phân tích',
          'Ngừng theo dõi thị trường',
        ],
        correct: 2,
      },
    ],
  },
  {
    level_id: 2,
    title: 'Bài thi: Tư duy đầu tư tích sản',
    intro: 'Kiểm tra mức độ thấm tư duy tích sản, lãi kép và kỷ luật đầu tư định kỳ.',
    pass_score: 70,
    questions: [
      {
        text: 'Điểm khác biệt cốt lõi giữa đầu tư tích sản và đầu cơ là gì?',
        options: [
          'Tích sản giao dịch trong ngày, đầu cơ giữ vài tháng',
          'Tích sản dựa trên giá trị doanh nghiệp và nắm giữ dài hạn',
          'Tích sản chỉ dành cho người đã có nhiều tiền',
          'Đầu cơ luôn cho lợi nhuận cao hơn',
        ],
        correct: 2,
      },
      {
        text: 'Quy tắc 72 dùng để làm gì?',
        options: [
          'Ước tính số năm để tài sản nhân đôi',
          'Tính thuế cổ tức phải nộp',
          'Xác định phí giao dịch tối đa',
          'Dự báo mức lạm phát năm sau',
        ],
        correct: 1,
      },
      {
        text: 'Yếu tố nào tạo ra sức mạnh lớn nhất của lãi kép?',
        options: [
          'Số lần giao dịch mỗi ngày',
          'Thời gian nắm giữ',
          'Theo dõi bảng giá liên tục',
          'Dự báo đúng đỉnh và đáy',
        ],
        correct: 2,
      },
      {
        text: 'Đầu tư DCA (theo định kỳ) được hiểu đúng là:',
        options: [
          'Mua tất tay một lần khi thị trường chạm đáy',
          'Đầu tư đều đặn một khoản tiền cố định theo lịch',
          'Bán hết danh mục khi lãi 10%',
          'Chỉ mua cổ phiếu có giá dưới 10.000 đồng',
        ],
        correct: 2,
      },
      {
        text: 'Doanh nghiệp nào phù hợp nhất với chiến lược tích sản?',
        options: [
          'Lợi nhuận tăng vọt một quý rồi chững lại',
          'Dòng tiền kinh doanh ổn định, mô hình dễ hiểu',
          'Chỉ dựa vào một hợp đồng lớn duy nhất',
          'Nợ rất lớn để mở rộng nhanh',
        ],
        correct: 2,
      },
    ],
  },
  {
    level_id: 3,
    title: 'Bài thi: Tích sản nâng cao',
    intro: 'Phân tích báo cáo tài chính, các chỉ số sinh lời và kiểm soát rủi ro danh mục.',
    pass_score: 70,
    questions: [
      {
        text: 'Chỉ số ROE đo lường điều gì?',
        options: [
          'Khả năng sinh lời trên vốn chủ sở hữu',
          'Khả năng thanh toán nợ ngắn hạn',
          'Tốc độ tăng trưởng doanh thu',
          'Quy mô tổng tài sản của doanh nghiệp',
        ],
        correct: 1,
      },
      {
        text: 'Theo phương pháp DuPont, ROE được tính từ hệ số nào sau đây?',
        options: [
          'Hệ số thanh toán ngắn hạn',
          'Biên lợi nhuận × Vòng quay tài sản × Đòn bẩy tài chính',
          'Tỷ lệ chi trả cổ tức × Số cổ phiếu lưu hành',
          'Vốn lưu động × Chu kỳ thu tiền',
        ],
        correct: 2,
      },
      {
        text: 'Nếu ROE cao nhưng phần lớn nhờ đòn bẩy tài chính, nhà đầu tư nên:',
        options: [
          'Mua ngay vì ROE càng cao càng tốt',
          'Cẩn trọng hơn vì lợi nhuận dễ biến động khi lãi suất đổi chiều',
          'Bỏ qua doanh nghiệp này hoàn toàn',
          'Chỉ nhìn vào giá cổ phiếu',
        ],
        correct: 2,
      },
      {
        text: 'Tỷ lệ chi trả cổ tức (payout ratio) cao bất thường có thể báo hiệu:',
        options: [
          'Doanh nghiệp hết dư địa tái đầu tư sinh lời',
          'Doanh nghiệp chắc chắn tăng trưởng nhanh',
          'Cổ phiếu chắc chắn tăng giá',
          'Không có ý nghĩa gì',
        ],
        correct: 1,
      },
      {
        text: 'Dấu hiệu nào thường thấy ở chất lượng lợi nhuận tốt?',
        options: [
          'Lợi nhuận tăng nhưng dòng tiền kinh doanh âm kéo dài',
          'Lợi nhuận tăng song song với dòng tiền kinh doanh dương',
          'Tài sản hữu hình tăng nhanh trong khi doanh thu đi ngang',
          'Chi phí tài chính liên tục về mức 0',
        ],
        correct: 2,
      },
    ],
  },
  {
    level_id: 4,
    title: 'Bài thi: Đọc vị cổ phiếu',
    intro: 'Đọc vị doanh nghiệp qua lợi thế cạnh tranh, đội ngũ lãnh đạo và những bẫy kế toán.',
    pass_score: 70,
    questions: [
      {
        text: 'Khi đọc một báo cáo phân tích, phần nào nên đọc trước tiên?',
        options: [
          'Khuyến nghị mua/bán ở cuối bản báo cáo',
          'Bối cảnh ngành và lợi thế cạnh tranh của doanh nghiệp',
          'Mục tiêu giá ba tháng tới',
          'Danh sách cổ đông lớn',
        ],
        correct: 2,
      },
      {
        text: 'Công ty con báo lãi lớn nhưng công ty mẹ lỗ nhẹ — nguyên nhân thường gặp là gì?',
        options: [
          'Chi phí nội bộ và giao dịch liên kết làm lệch kết quả',
          'Sai sót đánh máy trong báo cáo',
          'Doanh nghiệp không có tài sản',
          'Thị trường ngừng giao dịch',
        ],
        correct: 1,
      },
      {
        text: 'Ban lãnh đạo liên tục bán cổ phiếu trong khi phát đi thông điệp lạc quan, bạn xử lý ra sao?',
        options: [
          'Tin tưởng vì họ am hiểu công ty nhất',
          'Xem xét kỹ: hành động quan trọng hơn lời nói, đặc biệt là phần sở hữu còn lại',
          'Bán toàn bộ cổ phiếu ngay lập tức',
          'Bỏ qua vì mọi công ty đều bán cổ phiếu',
        ],
        correct: 2,
      },
      {
        text: 'Lợi thế cạnh tranh (moat) thể hiện rõ nhất qua điều gì?',
        options: [
          'Quy mô ngân sách quảng cáo',
          'Khả năng duy trì biên lợi nhuận và thị phần trước đối thủ',
          'Số lượng nhân viên',
          'Giá cổ phiếu tăng liên tục',
        ],
        correct: 2,
      },
      {
        text: 'Dự báo lợi nhuận của các công ty chứng khoán nên được xem như:',
        options: [
          'Chắc chắn đúng vì có chuyên gia thực hiện',
          'Là giả định kèm luận điểm, cần tự kiểm chứng',
          'Không cần đọc',
          'Là quy định bắt buộc của sở giao dịch',
        ],
        correct: 2,
      },
    ],
  },
  {
    level_id: 5,
    title: 'Bài thi: Định giá cổ phiếu',
    intro: 'Chốt lại bằng kỹ năng ước tính giá trị: bội số, DCF và biên an toàn.',
    pass_score: 70,
    questions: [
      {
        text: 'Tỷ lệ PEG = 1 thường được diễn giải là:',
        options: [
          'Cổ phiếu bị định giá cao gấp đôi',
          'P/E khớp với tốc độ tăng trưởng lợi nhuận — định giá ở mức hợp lý',
          'Doanh nghiệp không có tăng trưởng',
          'Không có ý nghĩa gì',
        ],
        correct: 2,
      },
      {
        text: 'Phương pháp DCF định giá cổ phiếu dựa trên cơ sở nào?',
        options: [
          'Giá của các cổ phiếu cùng ngành',
          'Hiện giá của dòng tiền tương lai doanh nghiệp tạo ra',
          'Giá trị sổ sách tại thời điểm niêm yết',
          'Số lượng cổ phiếu đang lưu hành',
        ],
        correct: 2,
      },
      {
        text: 'Khi lãi suất thị trường tăng, điều gì thường xảy ra với cổ phiếu tăng trưởng?',
        options: [
          'Giá có xu hướng giảm vì tỷ lệ chiết khấu tăng lên',
          'Giá luôn tăng',
          'Không có tác động nào',
          'Chỉ ảnh hưởng tới trái phiếu',
        ],
        correct: 1,
      },
      {
        text: 'Giá trị nội tại (intrinsic value) là gì?',
        options: [
          'Giá đang giao dịch trên sàn',
          'Giá trị thực dựa trên năng lực sinh lời của doanh nghiệp',
          'Giá trị thanh lý tài sản',
          'Giá cao nhất trong 52 tuần',
        ],
        correct: 2,
      },
      {
        text: 'Biên an toàn (margin of safety) dùng để làm gì?',
        options: [
          'Tăng tốc độ giao dịch',
          'Bù đắp cho sai sót trong ước tính và các tình huống xấu',
          'Giảm thuế cổ tức',
          'Tăng phí môi giới',
        ],
        correct: 2,
      },
    ],
  },
];

/*
 * LƯU Ý: cột `correct` trong bảng questions lưu ĐÁP ÁN 1..4 (A=1, B=2, C=3, D=4).
 * API chỉ trả về đáp án này khi người dùng đã NỘP BÀI.
 */
