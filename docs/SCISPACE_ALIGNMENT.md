# PaperLab và định hướng SciSpace

**Ngày rà soát:** 2026-11-10
**Phạm vi:** kiểm tra code giao diện, handlers, LLM clients, core logic, storage và tài liệu của PaperLab; đọc README và một số luồng chính của SLR Paper Fetcher; đối chiếu với các trang SciSpace công khai.
**Mục đích:** phân biệt chức năng chạy được với schema/UI/roadmap mới chỉ tạo khung, rồi đề xuất thứ tự phát triển.

## Cách đọc trạng thái

- **Chạy được trong app:** có đường đi từ thao tác UI tới logic/service và lưu/hiển thị kết quả. Chưa có nghĩa là đã xác minh live provider hoặc chất lượng đầu ra.
- **Một phần / giới hạn:** có luồng hoạt động nhưng scope, provider, dữ liệu đầu vào hoặc trải nghiệm còn hạn chế.
- **Khung:** có schema, nhãn, màn hình, prompt hoặc roadmap; chưa thấy đường đi đủ từ UI tới kết quả sử dụng được.
- **Chưa có:** không tìm thấy chức năng tương ứng trong code được rà.

Roadmap là kế hoạch/trạng thái tự khai, không dùng làm bằng chứng duy nhất. Unit test chứng minh logic cục bộ theo fixture; nó không tự chứng minh tích hợp dịch vụ bên ngoài, hiệu quả trên bài thật hoặc mức sẵn sàng sản phẩm.

## Kết luận sau khi rà code

PaperLab **không chỉ là bộ khung**: nhiều luồng có handlers, gọi core/LLM/service, lưu qua repository và có màn hình xem/duyệt. Tuy vậy, một số nội dung roadmap/UI rộng hơn phần chức năng thực tế. Cần gọi là **beta chức năng theo phạm vi hẹp**, không nên mặc định là các module tương đương sản phẩm hoàn chỉnh.

Khoảng trống lớn nhất so với workflow SciSpace:

1. Chưa thấy Chat with Paper tự do, có câu trả lời trích dẫn từng đoạn/trang và hỏi tiếp.
2. Luồng tìm bài đang giới hạn ở OpenAlex với số kết quả/cách mở rộng được giới hạn trong code; chưa phải tìm kiếm đa nguồn có protocol/search log đầy đủ.
3. SLR Paper Fetcher chưa được ghép thành cùng một dịch vụ với PaperLab; có một số năng lực tương tự được triển khai riêng.
4. Chất lượng extraction chưa được chứng minh bằng gold-standard; tài liệu hiện tại cũng ghi bộ đánh giá tối thiểu chưa có.

## Module lớn để tự kiểm tra

Trạng thái bên dưới là đánh giá code hiện tại, không bắt buộc phải giữ nguyên. Dùng cột **Tự kiểm tra** để bạn mở app và đánh dấu theo trải nghiệm thực tế.

**Ý nghĩa trạng thái:**

- **Đã làm:** luồng chính có thể dùng trong phạm vi đã mô tả.
- **Đang làm:** có chức năng hoạt động nhưng còn thiếu phần quan trọng hoặc bị giới hạn.
- **Có khung:** đã có màn hình/schema/prompt/code nền, nhưng chưa có luồng sản phẩm đủ dùng.
- **Chưa có:** chưa tìm thấy chức năng tương ứng.
- **Cần kiểm chứng:** có code, nhưng chưa có bằng chứng chất lượng/tích hợp thực tế đủ để kết luận.

| Module lớn | Trạng thái hiện tại | Phạm vi đã thấy trong code | Tự kiểm tra | Ghi chú của bạn |
| --- | --- | --- | --- | --- |
| 1. Tìm bài và quản lý thư viện | **Đang làm** | DOI/CSV lookup, metadata, taxonomy OpenAlex, trạng thái truy cập, đính kèm PDF và tải arXiv. | ☐ | |
| 2. Nhập bài và đọc PDF | **Đã làm** | Nhập PDF/TeX/Markdown/TXT, mục lục, reader theo section, trang, bảng/công thức cơ bản. PDF.js đọc text layer. | ☐ | PDF scan cần OCR; parser/layout cần thử với PDF thật. |
| 3. Phân tích một bài báo | **Đang làm** | Hồ sơ 5 chiều, Snapshot, metadata, lập luận, rhetoric/stance/vocabulary, paper checks, batch analysis và AI reviewer theo tác vụ. | ☐ | Các tác vụ chạy riêng; hồ sơ có thể còn dấu gạch nếu chưa chạy/lưu kết quả. |
| 4. Trích xuất và so sánh nhiều bài | **Đang làm** | Project, thêm bài/cột, Standard/High Quality extraction, cell review/audit, CSV/JSON export. Bài đã import dùng full text; DOI không có PDF có thể chỉ dùng abstract. | ☐ | Chỉ hai mode extraction đang được bật trong RunPanel. Chất lượng output cần review. |
| 5. Tìm kiếm/sàng lọc/tổng hợp Deep Research | **Đang làm** | Đề xuất và duyệt search plan, tìm OpenAlex, citation expansion có giới hạn, AI screening suggestion, quyết định include/exclude bởi người dùng, grounded synthesis. | ☐ | Chưa phải tìm đa database hoặc systematic review hoàn chỉnh. |
| 6. Chat hỏi đáp tự do với bài báo | **Chưa có** | Có tác vụ phân tích có cấu trúc và reviewer, nhưng chưa thấy hội thoại hỏi tự do nhiều lượt gắn quote/page. | ☐ | Năng lực lớn cần thiết nếu muốn gần SciSpace. |
| 7. Viết học thuật: Evaluate / Revise / Generate | **Đã làm** | Phân tích đoạn, score/issue review, viết lại, tạo đoạn, meaning checks và chấp nhận trước khi lưu. | ☐ | Cần kiểm định heuristic/score; meaning checks không chứng minh khoa học đúng. |
| 8. Lịch sử, báo cáo, backup/transfer | **Đã làm** | History, so sánh phiên bản, report, JSON export/import; dữ liệu nằm local trong browser. | ☐ | Chưa phải đồng bộ cloud hay cộng tác nhiều người. |
| 9. Tích hợp SLR Paper Fetcher | **Chưa có tích hợp trực tiếp** | PaperLab có chức năng tương tự ở DOI library/PDF reader; Fetcher riêng có GROBID, SQLite, Ollama/Gemini và SLR sync. | ☐ | Chưa thấy PaperLab gọi GROBID hoặc API Fetcher. Cần chốt ranh giới hệ thống. |
| 10. Calibration và đánh giá chất lượng | **Có khung; cần kiểm chứng** | Có calibration module, schemas/tools và gold-data code. | ☐ | Chưa có gold-standard tối thiểu 30 bài do hai người gán nhãn theo ghi chú trong ROADMAP. |
| 11. Zotero/EndNote và notebook/notes | **Chưa xác nhận** | Có RIS export ở thư viện. | ☐ | Chưa thấy đồng bộ Zotero/EndNote hoặc ghi chú thống nhất xuyên suốt workflow. |

### Chi tiết căn cứ để đối chiếu

- **Home:** `src/modules/home/Page.tsx` tạo extraction project và hiển thị paper/project gần đây. Tile “Tìm và sàng lọc bài” chỉ điều hướng vào Extraction; tìm kiếm diễn ra trong Deep Research sau đó.
- **Paper import:** `src/modules/paper-import/importPaperFile.ts` và `src/shared/paper/pdfParser.ts` xử lý file và PDF text layer. Không có OCR trong luồng này.
- **Library:** `src/modules/paper-import/LibraryPanel.tsx`, `src/modules/paper-import/useLibrary.ts`, `src/shared/scholar/client.ts` xử lý DOI/CSV, lookup, retry, arXiv và attach.
- **Paper analysis:** `PaperMapPage.tsx` điều hướng các tab; `PaperProfile.tsx` tổng hợp repository; các component như `PaperArguments.tsx`, `PaperRhetoric.tsx`, `PaperStance.tsx`, `PaperVocabulary.tsx`, `PaperReview.tsx` chạy các tác vụ riêng.
- **Extraction:** `src/modules/extraction/ProjectPage.tsx`, `RunPanel.tsx`, `DeepResearch.tsx` và `src/shared/llm/llmExtraction.ts` triển khai matrix, chạy extraction, screening, search và synthesis.
- **Writing:** `src/modules/evaluate/Page.tsx`, `src/modules/revise/Page.tsx`, `src/modules/generate/Page.tsx` triển khai workflow đoạn.
- **Dữ liệu local:** History/Transfer dùng browser storage và JSON backup; xem `src/modules/history/Page.tsx`, `src/modules/transfer/Page.tsx`.
- **Roadmap:** `docs/ROADMAP.md`, `docs/PRD_Extraction.md`, `docs/PRD_Measurement.md` là yêu cầu/trạng thái tự khai; đối chiếu cùng code vì roadmap không chứng minh chất lượng end-to-end.

## Deep Research hiện thực sự làm gì

Code trong `src/modules/extraction/DeepResearch.tsx` có luồng hoạt động, nhưng cần mô tả đúng phạm vi:

1. LLM đề xuất query/tiêu chí; người dùng sửa và duyệt kế hoạch.
2. Scholar client tìm work trên OpenAlex theo query và khoảng năm.
3. Citation expansion lấy bài trích dẫn/được trích dẫn từ một số paper đã include, với giới hạn cứng trong component.
4. LLM gợi ý sàng lọc; người dùng quyết định trạng thái candidate/include/exclude/uncertain.
5. Paper được chọn có thể đưa sang extraction matrix; LLM tổng hợp claims theo theme/agreement/disagreement/gap và có bước grounding.

Đây là **workflow research trợ giúp có người duyệt**, không phải hệ thống tìm kiếm toàn diện nhiều database, không phải tự động systematic review, và không đảm bảo tổng hợp không bỏ sót nghiên cứu.

## SLR Paper Fetcher: dùng được gì và chưa nối gì

README của `E:\Project SWP\SLR_Paper_Fetcher` mô tả DOI/CSV/Excel, tìm/tải PDF, GROBID PDF→TEI/Markdown với source mapping, AI provider Ollama/Gemini, SQLite và đồng bộ SLR System. Đây là năng lực của **một ứng dụng riêng**.

Trong PaperLab đã thấy DOI library, arXiv download, PDF attachment, PDF.js parser, OpenAlex và các phân tích tương tự ở một số tầng. Chưa thấy PaperLab gọi GROBID hoặc API của Fetcher để tái sử dụng full-text map. Vì vậy không nên ghi “đã tích hợp Fetcher”; chính xác hơn là **có phần chức năng tương tự được xây riêng, tích hợp hệ thống chưa xác nhận**.

Kiến trúc cần được quyết định trước khi ghép: PaperLab được mô tả là SPA Firebase/local-first/IndexedDB; Fetcher là FastAPI/Docker/SQLite cùng các dịch vụ GROBID và AI. Tham khảo `docs/adr/0001-static-spa-firebase-hosting.md`, `docs/adr/0002-local-first-storage.md`, `docs/adr/0005-self-host-on-oracle-cloud.md`.

## Flow phát triển đề xuất

### P0 — Đóng khoảng cách “có màn hình” và “luồng hoàn chỉnh”

- Với từng module, xác định điều kiện hoàn tất end-to-end: input thật, xử lý, lỗi/partial result, lưu, mở lại, review và export.
- Trong UI, phân biệt dữ liệu chưa chạy, chạy một phần, không tìm thấy trong phạm vi đã quét và không áp dụng.
- Sửa nội dung Home/roadmap để nói đúng phạm vi tìm kiếm OpenAlex và các mode thực sự chạy được.

### P1 — Chat with Paper có citation grounding

- Hỏi trên paper đang mở; mỗi câu trả lời phải chứa quote và vị trí page/section có thể xác minh.
- Bấm citation mở đúng đoạn trong reader; lưu câu hỏi/trả lời/ghi chú vào paper.
- Bổ sung retrieval theo chunk/page; đừng gửi toàn văn mù quáng trong mỗi câu hỏi.
- Xử lý prompt injection trong nội dung paper như dữ liệu không tin cậy.

### P2 — Kết nối discovery với thư viện và ma trận

- Tạo đường đi rõ ràng từ OpenAlex candidates → screening người dùng duyệt → paper/abstract → tải/đính PDF → extraction matrix.
- Lưu search query, ngày tìm, provider, giới hạn kết quả, lý do include/exclude và trạng thái full-text/abstract-only.
- Nếu cần systematic review thực sự, thiết kế sau này cho nhiều database, dedupe và xuất log; không gọi OpenAlex-only flow là systematic search.

### P3 — Chốt tích hợp SLR Paper Fetcher

- Quyết định Fetcher là service riêng hay PaperLab hấp thụ chức năng nào.
- Chốt API boundary, auth, quyền truy cập PDF, nơi lưu file, mapping offset/page, versioning và failure/retry.
- Tránh có hai bản library, hai parser pipeline hoặc hai trạng thái paper không đồng bộ.

### P4 — Đánh giá chất lượng

- Tạo gold set paper/field/evidence có hai người gán nhãn, rồi đo precision/recall cho extraction và độ đúng vị trí citation.
- Tách lỗi parser/OCR, lỗi model, lỗi schema/verifier và lỗi mapping nguồn.
- Dùng số đo để quyết định cải tiến parser, prompt hay UI review; không dùng số test fixture để thay benchmark.

### P5 — Synthesis và writing từ evidence đã duyệt

- Sinh synthesis theo theme, agreement, disagreement và gap từ các cell/evidence đã duyệt.
- Mọi claim phải có citations tới evidence hỗ trợ và phản chứng; cho researcher duyệt trước khi đưa sang writing.
- Theo dõi nguồn gốc từ synthesis tới paper, passage, phiên bản extraction và quyết định review.

## Căn cứ trong repository

- `src/app/modules.ts` — registry module.
- `src/modules/home/Page.tsx` — Home tạo extraction project và các tile workflow.
- `src/modules/paper-import/importPaperFile.ts`, `src/shared/paper/pdfParser.ts` — import và PDF parsing của PaperLab.
- `src/modules/paper-import/LibraryPanel.tsx`, `src/modules/paper-import/useLibrary.ts`, `src/shared/scholar/client.ts` — DOI library và scholar lookup.
- `src/modules/paper-import/PaperProfile.tsx`, `PaperMapPage.tsx`, `PaperReview.tsx`, `useBatchRun.ts` — paper profile, reviewer và batch pipeline.
- `src/modules/extraction/ProjectPage.tsx`, `RunPanel.tsx`, `DeepResearch.tsx`, `src/shared/llm/llmExtraction.ts` — matrix, extraction modes và deep research.
- `src/modules/evaluate/Page.tsx`, `src/modules/revise/Page.tsx`, `src/modules/generate/Page.tsx` — workflow đoạn văn.
- `docs/ROADMAP.md`, `docs/PRD_Extraction.md`, `docs/PRD_Measurement.md` — yêu cầu và tự khai trạng thái; cần đọc cùng code.
- `E:\Project SWP\SLR_Paper_Fetcher\README.md` — chức năng và kiến trúc Fetcher riêng.

## Tham khảo SciSpace

- [SciSpace Literature Review](https://scispace.com/literature-review) — giới thiệu discovery, so sánh bằng cột tùy chỉnh, library và writing tools.
- [SciSpace Chat with PDF](https://scispace.com/chat-pdf) — giới thiệu hỏi đáp PDF với câu trả lời gắn citation, summary theo section và note taking.
- [SciSpace Academy workflow](https://learn.scispace.com/tutorials/how-to-conduct-literature-review-using-scispace) — khuyến nghị search/filter, evidence matrix, xác minh trong PDF và synthesis có dẫn nguồn.

Đây là mô tả tính năng công khai của SciSpace tại ngày rà soát, không phải kiểm thử trực tiếp tài khoản/phiên bản sản phẩm.
