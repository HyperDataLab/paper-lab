import styles from './page.module.css';

const STEPS = [
  { title: 'Tách câu', text: 'Chia đoạn thành câu và token, ngay trên máy này.', ai: false },
  { title: 'Ngữ pháp từng câu', text: 'Chủ ngữ, động từ chính, Topic, Action và Stress.', ai: true },
  { title: 'Cấu trúc paragraph', text: 'Kiểu paragraph, ý chính, vai trò từng câu và mạch nối.', ai: true },
  { title: 'Đánh giá theo ngữ cảnh', text: 'AI xét lại từng gợi ý; bạn giữ hoặc bỏ.', ai: true },
  { title: 'Chấm điểm', text: 'Năm tiêu chí theo rubric thử nghiệm, thang 0–100.', ai: true },
];

/** What happens after the paragraph is pasted, so the empty page says what it will do. */
export function ProcessGuide() {
  return (
    <aside className={styles.guide} aria-labelledby="process-guide">
      <h2 id="process-guide">Quy trình phân tích</h2>
      <ol>
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className={styles.guideNumber} aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <strong>
                {step.title}
                {step.ai && <span className={styles.aiTag}>AI</span>}
              </strong>
              <small>{step.text}</small>
            </span>
          </li>
        ))}
      </ol>
      <p>Mỗi bước AI chỉ chạy khi bạn bấm, và chỉ đưa ra gợi ý. Bạn quyết định giữ hay bỏ.</p>
    </aside>
  );
}
