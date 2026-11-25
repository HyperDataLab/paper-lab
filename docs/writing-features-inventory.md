# Kiểm kê tính năng Writing của PaperLab

**Ngày rà soát:** 23/11/2026
**Phạm vi:** code hiện có trong nhánh làm việc, tài liệu PRD/roadmap và lịch sử tính năng Writing của PaperLab.
**Mục đích:** ghi lại tính năng nào đang hoạt động, nơi người dùng tìm thấy, dữ liệu được lưu ra sao, phần nào thuộc sản phẩm Writing Lab và những khoảng trống còn lại.

## 1. Tóm tắt điều hành

PaperLab hiện có một bộ công cụ **đọc, phân tích và đánh giá cách viết trong bài báo khoa học**. Tính năng nằm trong không gian làm việc của từng bài báo, không phải trình soạn thảo để người dùng viết bài. Kết quả có thể được mở lại, kiểm tra theo trích đoạn gốc, xem lịch sử quyết định của người dùng và đưa vào báo cáo phân tích.

Các năng lực writing trực tiếp đang có:

1. **Writing space:** tổng quan văn phong, mạch lạc và các phát hiện cần xem lại; phân tích paragraph theo section; phân tích stance/engagement; từ vựng và cụm từ lặp; kiểm tra độ nhạy của điểm với thay đổi chỉ về văn phong.
2. **Phân tích diễn ngôn và lập luận:** rhetorical moves, reporting/validity, độ khớp abstract với nội dung, claims theo Toulmin/AIF, nguồn dẫn và quyết định xác nhận/bác bỏ.
3. **Brief có căn cứ:** tóm tắt cấu trúc bài, research gap, contribution, key facts và main claims bằng trích dẫn mở về vị trí trong bài.
4. **Đánh giá và phản biện:** reviewer AI theo các góc nhìn, ghi chú độc lập của người đọc, các kiểm tra cấu trúc và dữ liệu có thể xác minh.
5. **Scientific Contribution Graph (SCG):** trích xuất và duyệt đóng góp khoa học; Contribution Graph (NCG) cho bài thuộc miền ML/NLP, có thể tải dữ liệu ZIP.
6. **Hồ sơ và đầu ra nghiên cứu:** hồ sơ bài báo, báo cáo in/lưu PDF, đối chiếu phiên bản phân tích và các bản xuất dữ liệu của những phần liên quan.

Các trang viết paragraph độc lập **Evaluate / Revise / Generate / History / Calibration** từng là một phần roadmap và các lát cắt S5–S12 đã được ghi nhận hoàn tất. Hiện chúng không còn được đăng ký ở sidebar/route của PaperLab trong `src/app/modules.ts`; roadmap nói các trang viết độc lập đang chuyển sang Writing Lab. Đây là ranh giới sản phẩm cần giữ rõ: PaperLab phân tích bài và lưu paper-level analysis; Writing Lab sở hữu luồng viết/sửa paragraph độc lập.

## 2. Bản đồ tính năng

| Nhóm                               | Người dùng làm gì                                                                                   | Tình trạng trong PaperLab                                                                     | Điểm vào / mã chính                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Writing space                      | Xem chất lượng văn phong, mạch văn, stance và từ vựng của bài                                       | Có, theo từng bài báo                                                                         | `paper-import` → `WritingSpace.tsx`, `AnalysisColumn.tsx`              |
| Phân tích toàn bài                 | Chạy các phân tích còn thiếu, có dự toán lượt gọi, tiến độ và khả năng dừng/tiếp tục                | Có                                                                                            | `RunAllCard.tsx`, `paperJobs.ts`                                       |
| Rhetoric / moves                   | Tìm cấu trúc lập luận theo section, validity threats, disclosure và abstract alignment              | Có                                                                                            | `PaperRhetoric.tsx`, `core/rhetoric`                                   |
| Argument                           | Trích claims, evidence/grounds, warrant, backing, qualifier, rebuttal; xem Toulmin hoặc AIF         | Có                                                                                            | `PaperArguments.tsx`, `ArgumentDiagram.tsx`, `core/argument`           |
| Paper brief                        | Tóm tắt bài, facts có nguồn, research gap/contribution và main claims từ phân tích đã lưu           | Có                                                                                            | `PaperDigest.tsx`, `PaperSummary.tsx`, `core/paperSummary`             |
| Phản biện                          | Lưu nhận xét người đọc, chọn góc nhìn, chạy reviewer và duyệt nhận định có trích đoạn               | Có                                                                                            | `PaperReview.tsx`, `ReviewResults.tsx`                                 |
| Hồ sơ bài báo                      | Tổng hợp theo các câu hỏi về khoa học, lập luận, diễn ngôn, viết học thuật và bối cảnh              | Có                                                                                            | `PaperProfile.tsx`, `core/paperProfile`                                |
| SCG / NCG                          | Xem, duyệt và xuất đồ thị contribution                                                              | Có; NCG được thiết kế cho ML/NLP                                                              | `PaperScg.tsx`, `PaperContribution.tsx`, `core/contribution`           |
| Writing Bank                       | Dùng snapshot chuẩn hóa của research design, threats, claim types, metrics, protocols và benchmarks | Có phần tích hợp/đọc snapshot trong dự án; không phải trình soạn thảo bài viết                | `researchDesign/bank/BankPanel.tsx`                                    |
| Đóng gói research design           | Xem trước, đóng băng phiên bản, tải ZIP và gửi plan đã duyệt sang ResearchHub                       | Có; hỗ trợ chuẩn bị kế hoạch nghiên cứu chứ không soạn manuscript                             | `researchDesign/sections/PackageSection.tsx`, `researchDesign/package` |
| Paragraph Evaluate/Revise/Generate | Nhập một paragraph, chẩn đoán, đề xuất chỉnh/sinh và đánh giá lại                                   | Đã có trong lịch sử/roadmap; hiện không đăng ký thành module PaperLab                         | `docs/PRD.md`, `docs/ROADMAP.md`, `src/app/modules.ts`                 |
| Báo cáo paragraph                  | In/lưu PDF, xem phiên bản và so sánh trước/sau                                                      | Báo cáo và so sánh còn trong mã; thuộc luồng paragraph cũ, không phải Writing space của paper | `src/modules/report`                                                   |

## 3. Writing space trong bài báo

### 3.1 Mục tiêu và nội dung

`WritingSpace` tổ chức các công cụ trả lời câu hỏi “bài này được viết và nối ý như thế nào?”. Phần tổng quan chỉ đọc những phân tích đã lưu, sau đó đưa người dùng đến công cụ tạo dữ liệu còn thiếu. Các khối hiện gồm:

- **Tổng quan discourse/writing:** trạng thái phân tích, chỉ số, kết quả và lối mở sang nội dung chi tiết.
- **Phát hiện writing:** issue được neo vào câu/đoạn và có giải thích; người đọc có thể mở văn bản gốc tại vị trí tương ứng, xác nhận hoặc bỏ qua theo loại phát hiện.
- **Phân tích theo paragraph/section:** dùng batch pipeline và section-aware prompts để xem cấu trúc, câu và mạch giữa các đoạn. Có thể giới hạn hiển thị/lọc về những paragraph liên quan.
- **Stance và engagement:** nhận diện lựa chọn stance/engagement trong bài, gắn phát hiện với văn bản nguồn.
- **Từ vựng:** xem các tín hiệu từ vựng và mở vị trí dẫn chứng trong bài.
- **Style probe:** kiểm tra mức nhạy của điểm với phép viết lại chỉ đổi văn phong; cần có điểm paragraph trước khi chạy.

> Lưu ý: những chỉ báo như câu dài, passive voice hay từ loại là tín hiệu để xem xét, không tự động kết luận bài viết sai. Sổ tay/PRD yêu cầu diễn giải điểm cùng coverage, confidence và giới hạn ngữ cảnh.

### 3.2 Chạy phân tích

`RunAllCard` có thể chạy các phân tích còn thiếu theo hàng đợi hữu hạn, cho xem ước tính lượt gọi và thời lượng, hiện trạng thái theo nhóm mục tiêu, dừng tác vụ đang chạy, mở tác vụ riêng để sửa phạm vi và giữ lại phần đã hoàn tất. Bộ “Phân tích toàn bài” hiện liệt kê digest/snapshot, argument/measure/rhetoric, batch/stance; reviewer và style probe có điều kiện chạy riêng nên không nằm trong một nút chạy toàn bộ.

Các panel phân tích rhetoric và arguments cho phép chọn section, xử lý kết quả từng phần và tiếp tục phần dang dở. Lỗi hoặc section bị bỏ qua được báo riêng để người dùng không hiểu nhầm kết quả một phần là toàn bài.

### 3.3 Tính kiểm chứng

- Phát hiện lưu thông tin section/paragraph cùng vị trí trong bài; bấm vị trí sẽ đưa người đọc về nguồn.
- Các trích dẫn tóm tắt có liên kết về paragraph/trang PDF.
- Kết quả AI được kiểm tra/neo bởi code ở nơi có thể; trích dẫn không neo được cần bị loại thay vì hiển thị như chứng cứ xác thực.
- Có phân biệt trạng thái do AI đề xuất và trạng thái người đọc xác nhận/bác bỏ.

## 4. Claims, lập luận và rhetorical structure

### 4.1 Rhetoric và reporting

`PaperRhetoric` chạy phân tích trên section được chọn, có thể tiếp tục từ checkpoint và lưu kết quả theo bài. Kết quả được nhóm theo các loại rhetorical/reporting finding; người dùng mở trích đoạn trong paper reader rồi xác nhận/bác bỏ. Nhánh moves còn đối chiếu các claim trong abstract với phần thân (Results/Discussion). “Không tìm thấy đoạn tương ứng” không đồng nghĩa claim sai; giao diện nêu rõ giới hạn đó.

### 4.2 Argument map

`PaperArguments` cung cấp hai cách đọc:

- **Toulmin:** claim chính/phụ; grounds; warrant do tác giả nêu hoặc AI suy ra (được gắn nhãn riêng); backing; qualifier; rebuttal.
- **AIF:** xem cấu trúc argument của toàn bài hoặc claim được chọn; sơ đồ hoặc danh sách; lọc theo claim type và chuyển giữa các claim.

Người dùng có thể xem evidence level/basis, mở claim hoặc premise tại nguồn và xác nhận/bác bỏ từng claim. Kết quả AI đang được chia theo section để tiếp tục khi một phần lỗi. Kết quả AI không thay thế việc kiểm tra khoa học của người dùng.

### 4.3 Research gap, claims và limits

`PaperSummary` không tự chạy AI. Nó đọc dữ liệu đã lưu và cho biết khi nào cần mở phân tích liên quan:

- Gap và contribution lấy từ rhetorical analysis, kèm câu trích dẫn và vị trí.
- Main claims lấy từ argument analysis, có lọc loại claim và đường dẫn về đoạn gốc.
- Limits lấy từ dữ liệu tương ứng trong insights.
- Khi thiếu kết quả, CTA dẫn tới panel cần chạy thay vì dựng nội dung thay thế.

### 4.4 Scientific Contribution Graph

`PaperContribution` phân đoạn văn bản bài báo, chạy AI theo chunks có checkpoint và kiểm tra các cụm/triples trước khi dựng model. Màn hình báo phần đã bỏ vì không xác minh được và cảnh báo ngoài miền hỗ trợ. Có đầu ra `ncg.zip`.

`PaperScg` tạo SCG từ đóng góp, prerequisite và alignment; lưu checkpoint tiến độ, có bước duyệt/review và render graph/evidence. SCG/NCG là cấu trúc tri thức cho phân tích đóng góp, không phải công cụ viết phần Contributions cho manuscript.

## 5. Brief, tóm tắt và dữ kiện có nguồn

### Tóm tắt bài (`PaperDigest`)

- Sinh headline, overview, section và bullet/block có cấu trúc.
- Kèm nguồn trang/paragraph; bấm nguồn mở đúng vị trí đọc.
- Có cờ cho dữ liệu/số liệu cần thận trọng; phần source gắn với từng nội dung.
- Ghi rõ khi AI chỉ đọc một phần đầu của bài (`read/total`).
- Người dùng có thể tạo lại; trạng thái, lỗi và tiến độ được hiển thị.
- Luồng này yêu cầu đồng ý gửi dữ liệu bài báo cho AI và lưu bản chạy qua repository.

### Tóm tắt tổng hợp (`PaperSummary`)

Đây là view trên các kết quả rhetoric, snapshot và argument đã có; không phải một bài viết do AI tự tổng hợp không nguồn. Nó cho phép người dùng nhìn nhanh gap/contribution, key facts, claims và mở dẫn chứng gốc. Facts hỗ trợ Methods, Outcome, Results, Population, Sample size, Duration và Location.

## 6. Phản biện người và AI

`PaperReview` thiết kế reviewer theo quy trình nhiều bước:

1. Người dùng ghi nhận xét riêng trước khi xem kết quả AI hoặc chọn bỏ qua bước ghi chú.
2. Chọn một hay nhiều reviewer lenses, section và giới hạn lượt gọi; giao diện cho biết ước lượng ký tự/lượt.
3. Chạy phản biện có thể hủy; kết quả lưu với prompt version và thời gian.
4. Xem các nhận định gắn với đoạn gốc và quyết định của người dùng.

Reviewer là một lớp đánh giá/phản biện cho bài báo, không phải tính năng tự biên tập hay tự sửa bài.

## 7. Writing Bank và hỗ trợ thiết kế nghiên cứu

`Writing Bank` là nguồn ngoài được PaperLab tích hợp theo snapshot phát hành. Trong dự án, người dùng có thể kiểm tra bản mới, lấy snapshot, nhập tệp JSON và thay snapshot sau xác nhận nếu draft đang tham chiếu. Snapshot cung cấp các collection như research design, threats to validity, claim types, metrics, protocols và benchmarks. Research question, measurement và hypothesis có thể tham chiếu định nghĩa/chuẩn từ snapshot.

Các dữ liệu như journal, article type hoặc claim type giúp **định hình và kiểm tra protocol nghiên cứu**. Đây không phải kho mẫu câu hay trình soạn thảo học thuật. Khi không có snapshot, một số đối chiếu/kiểm tra bị giới hạn; giao diện đưa ra lý do và lối sang Writing Bank.

Gói kế hoạch trong Project Detail có preview Markdown/runner, đóng băng phiên bản, tải ZIP và gửi sang ResearchHub khi đăng nhập. Đây là đầu ra protocol/plan có kiểm tra điều kiện, không phải bản thảo manuscript.

## 8. Tính năng paragraph độc lập trong lịch sử sản phẩm

`docs/PRD.md` mô tả sản phẩm paragraph-oriented bằng ba luồng: **Evaluate** (phân tích một paragraph khoa học), **Revise** (chỉnh theo issue đã chọn) và **Generate** (tạo paragraph từ claim/evidence/audience). PRD nêu các yêu cầu quan trọng:

- Giữ nguyên văn bản nguồn; bản sửa là revision riêng.
- Chỉ sửa theo vấn đề đã chọn và giữ claim, chứng cứ, số liệu, trích dẫn, phủ định, hedging, modality và mức độ khẳng định.
- Không bịa bằng chứng/số liệu; nội dung thiếu chứng cứ phải được đánh dấu `needs_evidence`.
- Đổi trước/sau cần căn chỉnh span, ghi rationale và cho người dùng duyệt trước khi thay thế nội dung gốc.
- Sinh nội dung phải lưu nguồn claim/evidence và qua kiểm tra provenance trước khi chấp nhận.

`docs/ROADMAP.md` đánh dấu các lát cắt S5–S12 (Evaluate, detectors, review, structure/flow, scoring, Revise, Generate, report/compare) hoàn tất. Nhưng trạng thái hiện tại trong registry quan trọng hơn roadmap lịch sử: `src/app/modules.ts` chỉ đăng ký Home, Papers, Extraction, Corpus, Lab KG, Transfer, Playground, Admin Requests và Settings. Không có module Evaluate/Revise/Generate/History/Calibration riêng. Roadmap nêu rõ chúng đang được chuyển sang Writing Lab.

Một số mã cũ vẫn còn:

- `src/modules/report/ReportPage.tsx` trình bày báo cáo phân tích paragraph và có nút In/Lưu PDF.
- `src/modules/report/ComparePage.tsx` so sánh bản gốc/bản sửa, thay đổi số liệu, điểm, issue và meaning checks.
- `src/core/revision`, prompt revision/generation, schema và repository của `revisions`/`generations` vẫn có trong code.

Vì vậy cần diễn đạt đây là **logic/schema/route legacy còn trong repository nhưng không có module writing độc lập trong điều hướng chính**; tài liệu này không khẳng định các route cũ bị xóa hoặc chắc chắn không thể truy cập bằng URL. Khi chuyển sản phẩm, cần quyết định rõ dữ liệu local lịch sử được di trú hay chỉ được xuất/đọc trong Writing Lab.

## 9. Lưu trữ, quyền riêng tư và nguồn gốc kết quả

### Paper-level analysis

Các panel lưu theo bài qua repository của `shared/storage` (ví dụ `paperInsights`, `paperReviews`, `stance`, `scg`, `measurements`). Với project ResearchHub, papers, corpora, extraction projects và **paper-level analysis** thuộc workspace dự án được đồng bộ thành object có version/ETag tại ranh giới storage. Xung đột phiên bản được phát hiện thay vì ghi đè âm thầm.

### Paragraph analysis độc lập

ADR-0007 ghi rõ standalone paragraph analyses, revisions, generations và calibration labels bị loại khỏi workspace ResearchHub. Vì vậy không nên coi các kết quả này là đã đồng bộ qua project workspace như phân tích bài báo.

### AI, consent và provenance

- Các panel AI của bài yêu cầu consent trước khi gửi văn bản qua `llm.ensureConsent('paper')`.
- Prompt có version; run lưu model/version/thời điểm và phạm vi section khi schema hỗ trợ.
- Một số luồng checkpoint kết quả từng phần để tiếp tục sau khi ngắt.
- Generated paragraph có repository và bước kiểm provenance/accept riêng trong mã legacy.
- Dữ liệu nhạy cảm vẫn phải tuân chính sách consent và không nên đưa vào LLM nếu chưa có consent.

## 10. Đầu ra và khả năng tái sử dụng

- **Báo cáo paragraph:** mở báo cáo, in/lưu PDF; xem văn bản, annotation, cấu trúc, flow, metrics, score, issues, revisions/generation và thông tin phiên bản.
- **So sánh:** đối chiếu văn bản trước/sau, delta metrics và điểm, issue, kết quả kiểm tra ý nghĩa.
- **Contribution:** xuất `ncg.zip`.
- **Measurement:** có các đầu ra JSON/Markdown/CSV ở luồng measurement (không phải Writing space thuần túy nhưng hữu ích cho nội dung phương pháp/kết quả).
- **Research design:** preview Markdown/runner và ZIP cho plan đóng băng.
- **Backup dữ liệu:** xuất/nhập workspace PaperLab qua Transfer; không nên nhầm với manuscript export.

Không tìm thấy một luồng hiện hành tạo file manuscript hoàn chỉnh (Word/Google Docs/LaTeX) từ PaperLab writing space. Báo cáo phân tích và plan ZIP là các loại đầu ra khác nhau.

## 11. Đường dẫn code và tài liệu quan trọng

### Paper writing/analyzing

- `src/modules/paper-import/AnalysisColumn.tsx` — ghép các không gian bài báo.
- `src/modules/paper-import/WritingSpace.tsx` — các block Writing và overview.
- `src/modules/paper-import/ArgumentsSpace.tsx` — arguments, gap, claims, atomics, review và rhetoric.
- `src/modules/paper-import/RunAllCard.tsx`, `paperJobs.ts` — điều phối, báo cáo tiến độ và điều kiện chạy.
- `src/modules/paper-import/PaperRhetoric.tsx`, `PaperArguments.tsx` — hai phân tích cấu trúc chính.
- `src/modules/paper-import/PaperSummary.tsx`, `PaperDigest.tsx` — summary dựa trên dữ liệu và summary do AI tạo có nguồn.
- `src/modules/paper-import/PaperReview.tsx`, `ReviewResults.tsx` — phản biện AI/người đọc.
- `src/modules/paper-import/PaperContribution.tsx`, `PaperScg.tsx` — graph đóng góp.
- `src/modules/paper-import/PaperProfile.tsx` — profile năm chiều của bài.

### Domain, schema, storage, report

- `src/core/schemas/paperInsights.ts`, `paperReview.ts`, `contribution.ts`, `scg.ts` — dữ liệu của phân tích theo bài.
- `src/core/rhetoric`, `src/core/argument`, `src/core/paperSummary`, `src/core/paperProfile`, `src/core/contribution` — domain logic.
- `src/core/prompts/index.ts` và các prompt tương ứng — prompt version.
- `src/shared/storage/paperInsights.ts`, `repositories.ts`, `generations.ts`, `revisions.ts` — ranh giới lưu dữ liệu.
- `src/modules/report/ReportPage.tsx`, `ComparePage.tsx` — báo cáo và so sánh paragraph.
- `src/modules/researchDesign/bank/BankPanel.tsx`, `useBankImport.ts` — snapshot Writing Bank.
- `src/modules/researchDesign/sections/PackageSection.tsx`, `package/` — đóng gói research plan.

### Product boundary/history

- `src/app/modules.ts` — danh sách module thực sự được đăng ký hiện nay.
- `docs/PRD.md` — đặc tả Evaluate/Revise/Generate paragraph.
- `docs/ROADMAP.md` — trạng thái các lát cắt và ranh giới chuyển Writing Lab.
- `docs/adr/0007-researchhub-project-workspaces.md` — dữ liệu paper-level được đồng bộ và dữ liệu standalone bị loại.

## 12. Khoảng trống và việc cần làm tiếp

### Ưu tiên cao — làm rõ sản phẩm và dữ liệu

1. **Chốt ranh giới PaperLab/Writing Lab:** xác định module nào sẽ chuyển, route redirect ra sao và trải nghiệm người dùng khi quay lại revision cũ.
2. **Kế hoạch di trú dữ liệu:** kiểm tra người dùng có paragraph analyses/revisions/generations trong namespace cũ hay không; quyết định di trú, xuất gói hoặc để read-only. ADR hiện xác nhận dữ liệu standalone không nằm trong project workspace.
3. **Kiểm kê route legacy:** xác minh bằng router và build hiện tại route nào còn mount được; tránh kết luận dựa trên mỗi sidebar registry.

### Ưu tiên cao — chất lượng nội dung và bằng chứng

4. **Đo chất lượng với người đánh giá:** roadmap chưa cung cấp bằng chứng thực nghiệm cho độ chính xác tổng thể của rhetoric, arguments, profile hoặc score. Tạo gold set có hai reviewer độc lập, ghi agreement và error class.
5. **Kiểm tra coverage nguồn:** thể hiện bài/section/paragraph nào được gửi và đọc; bổ sung cảnh báo nhất quán khi PDF thiếu text, OCR lỗi, section không nhận diện hoặc model chỉ xử lý một phần.
6. **Duyệt phát hiện dễ dùng:** chuẩn hóa trạng thái mở/đã xác nhận/đã bác bỏ, lý do, undo và cách mang quyết định qua lần phân tích mới.
7. **Tách quan sát khỏi kết luận:** duy trì nhãn AI suy ra, độ tin cậy, nguồn trích và cảnh báo rằng kết quả cần người nghiên cứu kiểm tra.

### Ưu tiên trung bình — luồng Writing space

8. **Điều hướng theo việc cần làm:** overview hiện mở các panel con; cân nhắc một danh sách việc còn thiếu/stale và đưa thẳng tới panel tương ứng.
9. **Tái phân tích chọn lọc:** tiếp tục theo section đã lỗi hoặc stale mà không làm mất các phần tốt; rà tương thích prompt/model/scope.
10. **Tạo đầu ra có nguồn:** cho phép xuất brief/claims/gap dưới định dạng dễ đưa vào bản thảo, luôn kèm citation nội bộ và nguồn gốc; chưa biến thành đoạn viết tự do thiếu bằng chứng.
11. **Khả năng tiếp cận:** kiểm tra bàn phím, focus, đọc sơ đồ bằng screen reader và phương án bảng/list song song cho Toulmin/AIF/SCG.

### Ưu tiên trung bình — Writing Bank

12. **Độ mới và tương thích snapshot:** cho thấy snapshot hiện hành/đã cũ, release khác biệt và tác động lên draft; kiểm tra quy trình thay snapshot khi các tham chiếu đã tồn tại.
13. **Liên kết dễ truy nguyên:** từ chuẩn/metric trong bank tới version/snapshot cụ thể được dùng khi đóng băng research design.

## 13. Kết luận

PaperLab có năng lực Writing đáng kể ở **phân tích văn bản học thuật, rhetoric, lập luận, tổng hợp có nguồn và phản biện bài báo**. Sản phẩm không hiện là trình viết manuscript. Việc ưu tiên tiếp theo nên là: (1) làm rõ/kiểm chứng ranh giới và migration sang Writing Lab, (2) đo chất lượng/coverage của các phân tích bằng dữ liệu có người gán nhãn, và (3) hoàn thiện đầu ra ngắn có nguồn trích để tái sử dụng an toàn trong quy trình viết.
