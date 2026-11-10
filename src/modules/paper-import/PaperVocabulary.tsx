import { useEffect, useMemo, useState } from 'react';
import {
  BASELINE_MIN_PAPERS,
  BUNDLE_WORDS,
  languageBaseline,
  languageMetrics,
  proseParagraphs,
  repeatedPhrases,
  type LanguageBaseline,
  type LanguageMetrics,
} from '@/core/academicLanguage';
import type { Finding, Paper } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { placeLabel } from './paperLabels';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import styles from './page.module.css';

type MetricKey = Exclude<keyof LanguageMetrics, 'words'>;
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const percent = (value: number | null) => (value === null ? '—' : `${decimal.format(value * 100)} %`);
const plain = (value: number | null) => (value === null ? '—' : decimal.format(value));
const ROWS: { key: MetricKey; label: string; show: (value: number | null) => string }[] = [
  { key: 'lexicalDensity', label: 'Mật độ từ nội dung', show: percent },
  { key: 'diversity', label: 'Từ khác nhau trên 1.000 từ', show: plain },
  { key: 'longWordShare', label: 'Từ dài (từ 8 chữ cái)', show: percent },
  { key: 'sentenceWords', label: 'Số từ trung bình mỗi câu', show: plain },
];

// Sections are usually shorter than the 1,000 words diversity needs.
const SECTION_ROWS = ROWS.filter((row) => row.key !== 'diversity');

export function PaperVocabulary({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: Finding['locations'][number]) => void;
}) {
  const repo = useRepositories();
  const [baseline, setBaseline] = useState<LanguageBaseline | null>(null);
  useEffect(() => {
    let active = true;
    void repo.papers.list().then((papers) => {
      if (active) setBaseline(languageBaseline(papers.filter((other) => other.id !== paper.id)));
    });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  const prose = useMemo(() => proseParagraphs(paper), [paper]);
  const overall = useMemo(() => languageMetrics(prose), [prose]);
  const phrases = useMemo(() => repeatedPhrases(prose), [prose]);
  const sections = useMemo(
    () =>
      paper.sections
        .map((section) => ({ section, metrics: languageMetrics(proseParagraphs(paper, section.id)) }))
        .filter(({ metrics }) => metrics.words >= 100),
    [paper],
  );
  return (
    <>
      <Card>
        <h2>Từ vựng</h2>
        <p className={styles.tabHelp}>
          Số mô tả, không phải điểm. Mức phù hợp khác nhau theo lĩnh vực nên cần đọc cùng mốc so sánh.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Chỉ số</th>
              <th scope="col">Bài này</th>
              <th scope="col">{baseline ? `Trung vị ${baseline.papers} bài khác` : 'Mốc so sánh'}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.show(overall[row.key])}</td>
                <td>{baseline ? row.show(baseline[row.key]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!baseline && (
          <p className={styles.tabHelp}>
            Mốc so sánh xuất hiện khi đã nhập ít nhất {BASELINE_MIN_PAPERS} bài khác. Nên chọn bài cùng lĩnh
            vực.
          </p>
        )}
      </Card>
      <Card>
        <h2>So sánh giữa các mục</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Mục</th>
              <th scope="col">Số từ</th>
              {SECTION_ROWS.map((row) => (
                <th scope="col" key={row.key}>
                  {row.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(({ section, metrics }) => (
              <tr key={section.id}>
                <th scope="row">
                  {SECTION_ROLE_LABELS[section.role]} · {section.heading}
                </th>
                <td>{metrics.words}</td>
                {SECTION_ROWS.map((row) => (
                  <td key={row.key}>{row.show(metrics[row.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2>Cụm từ lặp lại</h2>
        <p className={styles.tabHelp}>
          Cụm {BUNDLE_WORDS} từ xuất hiện từ 3 lần trở lên, ở ít nhất 2 đoạn. Lặp thuật ngữ là bình thường;
          cụm chung chung lặp nhiều mới đáng xem lại.
        </p>
        {phrases.length === 0 ? (
          <p>Không có cụm từ lặp lại đáng kể.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Cụm từ</th>
                <th scope="col">Số lần</th>
                <th scope="col">Số đoạn</th>
                <th scope="col">Lần đầu</th>
              </tr>
            </thead>
            <tbody>
              {phrases.map((item) => (
                <tr key={item.phrase}>
                  <th scope="row">{item.phrase}</th>
                  <td>{item.count}</td>
                  <td>{item.paragraphs}</td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => onLocation(item.location)}>
                      {placeLabel(paper, item.location.paragraphId)}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
