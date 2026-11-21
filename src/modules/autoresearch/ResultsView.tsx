import type { ResultsArtifact } from '@/core/autoresearch/results-contract';
import styles from './autoresearch.module.css';

const verdict = { supported: 'Ủng hộ', refuted: 'Bác bỏ', inconclusive: 'Chưa kết luận' };
const reason: Record<string, string> = {
  unsupported_test: 'Chưa hỗ trợ phép kiểm định',
  unsupported_parameters: 'Chưa hỗ trợ tham số của phép kiểm định',
  missing_results: 'Thiếu kết quả theo kế hoạch',
  unpaired_seeds: 'Không ghép cặp được theo seed',
  incomplete_pairs: 'Chỉ dùng các cặp có đủ kết quả',
  insufficient_data: 'Dữ liệu chưa đủ để tính phép kiểm định',
  asymptotic: 'p xấp xỉ, có hiệu chỉnh thứ hạng trùng',
  missing_contrast: 'Thiếu metric hoặc điều kiện so sánh',
  criterion_needs_review: 'Cần người đối chiếu tiêu chí bác bỏ',
};
const number = (value: number | null) => value ?? '—';
export function ResultsView({
  value,
  hypotheses,
}: {
  value: ResultsArtifact;
  hypotheses?: Map<string, string>;
}) {
  const name = (id: string) => hypotheses?.get(id) ?? id;
  return (
    <>
      <div className={styles.graphScroll}>
        <table>
          <caption>Thống kê mô tả theo Dataset và điều kiện</caption>
          <thead>
            <tr>
              {['Dataset', 'Điều kiện', 'Metric', 'n', 'Mean', 'SD'].map((heading) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.table.map((row, i) => (
              <tr key={i}>
                <td>{row.dataset}</td>
                <td>{row.condition}</td>
                <td>{row.metric}</td>
                <td>{row.n}</td>
                <td>{number(row.mean)}</td>
                <td>{number(row.sd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.graphScroll}>
        <table>
          <caption>Phép kiểm định theo kế hoạch</caption>
          <thead>
            <tr>
              {[
                'Hypothesis',
                'Dataset',
                'Metric',
                'Điều kiện',
                'Phép kiểm định',
                'Statistic',
                'p',
                'p hiệu chỉnh',
                'Kết luận',
                'Ghi chú',
              ].map((heading) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.tests.map((row, i) => (
              <tr key={i}>
                <td>{name(row.hypothesisId)}</td>
                <td>{row.dataset}</td>
                <td>{row.metric ?? '—'}</td>
                <td>{row.conditions.join(' − ') || '—'}</td>
                <td>{row.test}</td>
                <td>{number(row.statistic)}</td>
                <td>{number(row.p)}</td>
                <td>{number(row.corrected)}</td>
                <td>{verdict[row.verdict]}</td>
                <td>{row.reason ? (reason[row.reason] ?? row.reason) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{value.narrative}</p>
      <h5>Khuyến nghị · {value.recommendation}</h5>
      <ul>
        {value.hypotheses.map((row) => (
          <li key={row.hypothesisId}>
            {name(row.hypothesisId)} · {verdict[row.verdict]}
          </li>
        ))}
      </ul>
    </>
  );
}
