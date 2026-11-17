import type { KeyboardEvent } from 'react';
import { cloudWords } from '@/core/corpusKeywords';
import type { CorpusKeyword } from '@/core/schemas/corpusKeywords';
import styles from './keywords.module.css';

const pressed = (event: KeyboardEvent, act: () => void) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  act();
};

export function KeywordCloud({
  keywords,
  selected,
  onSelect,
}: {
  keywords: CorpusKeyword[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const words = cloudWords(keywords);
  return (
    <div
      className={styles.cloud}
      role="group"
      aria-label={`Đám mây ${words.length} keyword phổ biến nhất: cỡ chữ theo số bài, độ đậm theo điểm TB. Bảng bên dưới có cùng số liệu.`}
    >
      {words.map((word) => (
        <span
          key={word.id}
          role="button"
          tabIndex={0}
          aria-pressed={selected === word.id}
          aria-label={`${word.name}: ${word.paperCount} bài, điểm TB ${word.meanScore.toFixed(2)}`}
          title={`${word.paperCount} bài · điểm TB ${word.meanScore.toFixed(2)}`}
          className={`${styles.word} ${styles[`s${word.size}`]} ${styles[`t${word.tone}`]} ${selected === word.id ? styles.selected : ''}`}
          onClick={() => onSelect(word.id)}
          onKeyDown={(event) => pressed(event, () => onSelect(word.id))}
        >
          {word.name}
        </span>
      ))}
    </div>
  );
}
