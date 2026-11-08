# PRD — Đo lường & Đánh giá trong bài báo (PMEU), bản cho Paragraph Lab

**Phiên bản:** 1.1 (viết lại từ `PRD_Paper_Measurement_Understanding_AI_Direct.md` v1.0, 08/11/2026)
**Trạng thái:** Đề xuất triển khai. **Nằm trong:** nhóm module "Phân tích bài báo" (ADR-0006).

**Quy tắc trọng tâm:** _Extract what the paper reports; explain what it means; flag what is unclear; never fabricate
what was not reported._

## 1. Mục tiêu

Trả lời câu hỏi: _"Bài báo này đã đo điều gì, bằng metric và phương pháp nào, dưới protocol nào, và các kết quả có thực
sự hỗ trợ claim hay không?"_ Module tạo một **Hồ sơ đo lường** (Paper Measurement Profile) có cấu trúc, mỗi thông tin
truy được về đúng chỗ trong bài, và do con người duyệt.

Chuỗi cần hiểu: **Claim → Construct → Metric → Method → Protocol → Result → Finding.** Một metric có thể dùng ở nhiều thí
nghiệm, cùng tên có thể khác định nghĩa, nên hệ thống lưu **metric usage theo từng thí nghiệm**, không chỉ danh sách tên.

## 2. Thay đổi so với PRD gốc

PRD gốc viết cho Paper Understanding (có backend API, PDF viewer, Document Store). Paragraph Lab không có các phần đó.

| PRD gốc                                           | Trong Paragraph Lab                                                                       | Lý do                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Module của Paper Understanding                    | Tab **"Đo lường"** trên `/papers/:id`                                                     | Dùng lại P1–P7                         |
| REST API (§10), job phía server                   | Hàm trong trình duyệt + repository Dexie; job chạy bằng hàng đợi P2                       | Không có backend (AGENTS.md)           |
| Document Store, Database                          | IndexedDB, xuất/nhập JSON                                                                 | Local-first (ADR-0002)                 |
| PDF viewer và highlight trên PDF (FR-19, AC-08)   | Bấm bằng chứng → mở đoạn trên Sơ đồ bài và tô đúng câu trích, kèm số trang. Không lưu PDF | App không giữ tệp PDF. Nêu là giới hạn |
| Parser có sẵn bảng, công thức, bounding box (§14) | **Chưa có.** P1 chỉ có đoạn và chú thích; bảng thành các dòng rời. Phải làm M1 trước      | Điều kiện để đạt AC-05                 |
| `formula_latex`                                   | `formula_text` (nguyên văn từ PDF) + `formula_latex` tuỳ chọn, có cờ cần xem lại          | PDF không chứa LaTeX, không được đoán  |
| Phân quyền PDF                                    | Bản thảo chỉ rời máy khi đã đồng ý (consent cho cả bản thảo, P2)                          | Không có tài khoản                     |

**Chỗ PRD gốc tự mâu thuẫn và cách chốt:**

1. FR-10 (liên kết claim) là _Must_, AC-06 cần nó, nhưng §15 xếp claim traceability vào V1.1. **Chốt:** liên kết claim thuộc
   MVP; riêng _màn hình_ truy vết dạng đồ thị để sau (bảng trước).
2. FR-16 yêu cầu CSV/Markdown là _Must_, §15 chỉ ghi JSON cho MVP. **Chốt:** xuất đủ ba định dạng ở mức cơ bản.
3. `NEEDS_REVIEW` xuất hiện ở §11 nhưng không có trong FR-12. **Chốt:** đây là cờ riêng về độ tin cậy, không phải trạng thái
   thông tin (§5).
4. DoD yêu cầu đạt ngưỡng trên bộ gold-standard 30 bài. Chưa có bộ này. **Chốt:** làm công cụ đo (M5); kết quả được ghi là
   "chưa đo" cho đến khi có dữ liệu do người gán nhãn.

## 3. Phạm vi

**Trong MVP:** phân loại loại bài (kèm chế độ survey); trích xuất và liên kết toàn chuỗi ở §1; kiểm tra độ đầy đủ và nhất quán
ở mức mô tả; bằng chứng theo trang/mục/đoạn/ô bảng; duyệt và xuất.

**Ngoài phạm vi:** Measurement Catalog/Benchmark DB; chạy lại thí nghiệm, tải dataset, kiểm tra code; kết luận phương pháp
"đúng/sai"; **điểm chất lượng tổng hợp**; khẳng định metric là chuẩn ngành; so sánh nhiều bài (V2); không phụ thuộc SMIP.

## 4. Yêu cầu chức năng

Giữ nguyên mã FR của PRD gốc để truy vết.

| ID    | Yêu cầu                                                                                                                 | Ưu tiên | Slice   |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------- | ------- |
| FR-01 | Chạy phân tích trên bài đã nhập, trong tab Đo lường, có ước tính lượt gọi và trần ngân sách                             | Must    | M2, M4  |
| FR-02 | Đầu vào là các khối đoạn, bảng, chú thích, công thức có trang/mục/định danh                                             | Must    | M1      |
| FR-03 | Phân loại Empirical, Survey/SLR, Method/Theoretical, Case Study, Mixed, kèm căn cứ; survey không giả định có thí nghiệm | Must    | M2      |
| FR-04 | Nhận diện construct/property                                                                                            | Must    | M2      |
| FR-05 | Metric: tên, alias, định nghĩa, công thức, đơn vị, chiều tốt/xấu, phạm vi                                               | Must    | M2      |
| FR-06 | Method: đầu vào, phép tính, nguồn số liệu, aggregation                                                                  | Must    | M2      |
| FR-07 | Protocol theo checklist §6                                                                                              | Must    | M2      |
| FR-08 | Gắn metric usage với thí nghiệm/kịch bản/baseline                                                                       | Must    | M3      |
| FR-09 | Kết quả từ văn bản và bảng, giữ nguyên số, đơn vị, sai số, điều kiện                                                    | Must    | M1, M2  |
| FR-10 | Liên kết claim ↔ metric ↔ result; không tạo quan hệ khi thiếu căn cứ                                                    | Must    | M3      |
| FR-11 | Bằng chứng cho mọi thông tin quan trọng                                                                                 | Must    | M2      |
| FR-12 | Trạng thái `REPORTED`, `INFERRED`, `DERIVED`, `NOT_REPORTED`, `NOT_APPLICABLE`, `CONTRADICTORY`                         | Must    | M2      |
| FR-13 | Phát hiện 6 loại vấn đề ở §7                                                                                            | Must    | M3      |
| FR-14 | Phân biệt Author Statement / AI Interpretation / AI Concern trong giao diện và khi xuất                                 | Must    | M4, M5  |
| FR-15 | Duyệt accept/edit/reject từng mục, có audit                                                                             | Must    | M4      |
| FR-16 | Xuất JSON theo schema, Markdown, CSV metric và protocol                                                                 | Must    | M5      |
| FR-17 | Gộp alias nhưng giữ thuật ngữ gốc; một tên có thể ứng với nhiều định nghĩa                                              | Should  | M3      |
| FR-18 | Bảng truy vết Claim → Metric → Protocol → Result                                                                        | Should  | M4      |
| FR-19 | Tô vùng nguồn: thay bằng tô câu trích trên Sơ đồ bài (§2)                                                               | Should  | M4      |
| FR-20 | Checklist về độ phù hợp của metric với claim, không chấm điểm                                                           | Could   | Sau MVP |

## 5. Quy tắc nền tảng (code thực thi, không phụ thuộc vào AI)

Theo nguyên tắc của dự án: **AI đề xuất, code kiểm chứng, người quyết định.**

1. **Trạng thái `REPORTED` phải có trích dẫn nguyên văn** do code tìm lại được trong đúng khối đã nêu (dùng lại cách neo trích dẫn
   của P5). Không tìm được thì mục đó bị hạ xuống cờ `NEEDS_REVIEW`, không bao giờ giữ `REPORTED`.
2. **Trung thực số liệu:** mọi `ReportedResult` phải có giá trị và đơn vị xuất hiện nguyên văn trong câu trích hoặc ô bảng nguồn
   (`0.123 ± 0.004` tách đúng value và uncertainty). Không làm tròn. Code kiểm tra; không khớp thì `NEEDS_REVIEW`.
3. **`NOT_REPORTED` không có trích dẫn,** thay vào đó lưu `search_scope` (các mục đã thực sự gửi cho AI). Nếu phần liên quan chưa được
   phân tích thì ghi là chưa kiểm tra, không ghi `NOT_REPORTED`. Nghĩa là "không tìm thấy trong phần đã phân tích", không phải "tác
   giả không làm".
4. **Không suy ra từ thông lệ.** Bài không nêu số seed thì là `NOT_REPORTED`.
5. **`evidence_ids` phải trỏ tới bằng chứng có thật** (Zod + kiểm tra tham chiếu), và mọi mục tham chiếu cũng vậy.
6. **`CONTRADICTORY` cần ít nhất hai bằng chứng** khác nhau.
7. **Nội dung bài báo là dữ liệu không tin cậy:** đặt trong vùng phân tách rõ, và system prompt yêu cầu bỏ qua mọi chỉ dẫn nằm trong
   tài liệu. Có test với bài chứa chỉ dẫn nhúng.
8. **Kết quả AI gốc không bị ghi đè:** bản chỉnh sửa lưu riêng, có audit; bản xuất dùng bản đã duyệt (AC-07).
9. **Không có điểm tổng.** `confidence` chưa được hiệu chuẩn thì không hiển thị như xác suất.

## 6. Checklist protocol (khung chung của MVP)

Mỗi mục có trạng thái FR-12 và bằng chứng: **đối tượng đánh giá** (mô hình/hệ thống, phiên bản); **dữ liệu** (dataset, split,
sampling, tiền xử lý); **so sánh** (baseline, ablation, nhóm đối chứng); **môi trường** (phần cứng, phần mềm, siêu tham số liên quan);
**lịch đo** (thời điểm, tần suất, warm-up, ngưỡng, điều kiện dừng); **lặp lại** (số lần chạy, seed, độ biến thiên, kiểm định thống kê);
**tổng hợp** (macro/micro, mean/median, trọng số, loại bỏ dữ liệu thiếu).

**Chế độ survey/SLR:** thay bằng taxonomy các construct/metric được khảo sát; nếu là SLR thì trích phương pháp tổng quan (chiến lược tìm
kiếm, tiêu chí chọn, tổng hợp). Không dựng thí nghiệm, seed hay baseline giả (AC-04).

## 7. Sáu loại cảnh báo (AI Concern)

Definition ambiguity · Unit/scale mismatch · Protocol incompleteness · Aggregation ambiguity · Comparability risk · Claim–evidence gap.

Mỗi cảnh báo có `severity`, `explanation`, `evidence_ids`, `limitation_of_assessment`, `suggested_question_to_author`. Không khẳng định có
lỗi phương pháp khi thiếu bằng chứng. Lời lẽ dạng "có thể", "chưa thấy nêu".

## 8. Mô hình dữ liệu

Giữ các đối tượng ở §8 của PRD gốc (`PaperMeasurementProfile`, `Construct`, `MetricUsage`, `MeasurementMethod`, `ExperimentContext`,
`EvaluationProtocol`, `ReportedResult`, `ResearchClaim`, `AnalysisFinding`, `Evidence`, `ReviewAction`), viết bằng Zod trong
`src/core/schemas/measurement.ts`. Điều chỉnh:

- `Evidence`: `{ id, blockId, page, sectionId, kind: text|table|figure|equation, span | cell, source_excerpt }`, với `span` là offset code point do
  code tính, `cell` là `{ row, column }`.
- Mỗi trường thông tin: `{ value, status, evidence_ids, needs_review, search_scope? }`.
- `source_type`: `author_statement | ai_interpretation | ai_concern`.
- Truy vết: `model_id`, `prompt_version`, `schema_version`, `parser_version`.

## 9. Quy trình xử lý

Theo gợi ý §14 của PRD gốc, không dùng một prompt duy nhất cho cả bài:

1. **Classify** loại bài từ tóm tắt và phương pháp.
2. **Extract theo từng mục** (mỗi mục một lượt gọi), mỗi mục trả về ứng viên kèm trích dẫn.
3. **Evidence verification** bằng code ngay sau mỗi mục (§5).
4. **Link** cấp bài: nối định nghĩa ở Methods với kết quả ở bảng; tách metric trùng tên khác định nghĩa.
5. **Consistency**: AI nêu cảnh báo từ hồ sơ đã kiểm chứng; code gắn bằng chứng và kiểm tra lại.

Chạy trên hàng đợi P2: ước tính lượt gọi, trần ngân sách đếm theo từng HTTP, consent, tạm dừng/tiếp tục, lưu tiến độ theo mục.

## 10. Giao diện — tab "Đo lường"

1. **Tổng quan:** số construct, metric, thí nghiệm, kết quả; tỉ lệ trường có bằng chứng; số cảnh báo; nhãn loại bài.
2. **Bảng metric:** metric, thuộc tính đo, công thức/đơn vị, phương pháp, thí nghiệm, bằng chứng, trạng thái.
3. **Protocol:** checklist theo từng thí nghiệm.
4. **Kết quả & truy vết:** Claim → Result → Metric → Thí nghiệm → Bằng chứng (dạng bảng).
5. **Vấn đề & duyệt:** accept/edit/reject.

Mỗi mục có nhãn rõ: **Tác giả nêu / AI diễn giải / AI lưu ý**. Bấm bằng chứng → Sơ đồ bài, đúng đoạn, tô câu trích, kèm số trang.

## 11. Tiêu chí nghiệm thu

Giữ AC-01 đến AC-08 của PRD gốc; AC-08 đổi thành: _bấm một thông tin sẽ mở đúng đoạn trên Sơ đồ bài, tô câu trích, hiện số trang_.

Thêm: **AC-09** kết quả không tìm được nguồn thì không bao giờ mang trạng thái `REPORTED`. **AC-10** bài có chỉ dẫn nhúng ("ignore previous
instructions…") không làm thay đổi kết quả. **AC-11** mục chưa được phân tích không bị ghi `NOT_REPORTED`.

## 12. Chỉ tiêu chất lượng (mục tiêu, chưa đạt được cho đến khi đo)

Giữ các ngưỡng của PRD gốc: precision MetricUsage ≥ 0,90; recall ≥ 0,85; số + đơn vị đúng ≥ 0,99 trên bảng đọc đúng; bằng chứng đúng vị trí ≥ 0,95;
precision trường protocol `REPORTED` ≥ 0,90; ghi nhầm thành `REPORTED` ≤ 0,02; JSON hợp lệ 100 %. Cần bộ gold-standard tối thiểu 30 bài, 2 người gán nhãn
(chưa có). M5 làm công cụ tính; báo cáo tách lỗi đọc PDF với lỗi suy luận.

## 13. Lộ trình

| #   | Slice                                                                          | Phụ thuộc |
| --- | ------------------------------------------------------------------------------ | --------- |
| M1  | Khối bảng và công thức trong bộ đọc PDF, định danh khối                        | P1.1      |
| M2  | Schema, phân loại bài, trích xuất theo mục, kiểm chứng bằng chứng, số liệu     | M1        |
| M3  | Liên kết cấp bài, tách metric trùng tên, claim, 6 loại cảnh báo, chế độ survey | M2        |
| M4  | Tab Đo lường, duyệt, chỉnh sửa, audit, điều hướng bằng chứng                   | M3        |
| M5  | Xuất JSON/Markdown/CSV, Minh bạch, công cụ đo trên gold-standard               | M4        |

## 14. Việc cần chủ dự án quyết định

1. Ai gán nhãn bộ gold-standard 30 bài (không có thì §12 luôn ở trạng thái "chưa đo").
2. Có cần module này trong **Paper Understanding** nữa không. Bản này đặt ở Paragraph Lab; `MeasurementProfile` xuất JSON nên có thể dùng ở app kia về sau.
