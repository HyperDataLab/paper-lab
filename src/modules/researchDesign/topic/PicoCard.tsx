import { BlurField } from './BlurField';
import type { Props } from './types';
const picoFields = [
  { key: 'population', marker: 'P', label: 'Quần thể' },
  { key: 'exposure', marker: 'I', label: 'Phơi nhiễm hoặc can thiệp' },
  { key: 'comparison', marker: 'C', label: 'So sánh' },
  { key: 'outcome', marker: 'O', label: 'Kết quả' },
] as const;
export function PicoCard({ check, change }: Props) {
  return (
    <div className="topic-pico-rows">
      {picoFields.map(({ key, marker, label }) => (
        <div className="topic-pico-row" key={key}>
          <BlurField
            id={key === 'population' ? 'topic-pico' : `topic-pico-${key}`}
            label={label}
            labelPrefix={`${marker} ·`}
            value={check.pico[key]}
            rows={1}
            maxRows={8}
            save={(value) => change((c) => ({ ...c, pico: { ...c.pico, [key]: value } }))}
          />
        </div>
      ))}
    </div>
  );
}
