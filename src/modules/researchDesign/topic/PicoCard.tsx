import { Card } from '@/shared/ui/Card';
import { BlurField } from './BlurField';
import type { Props } from './types';
export function PicoCard({ check, change }: Props) {
  return (
    <Card>
      <h3>PICO</h3>
      {(['population', 'exposure', 'comparison', 'outcome'] as const).map((field) => (
        <BlurField
          key={field}
          label={
            {
              population: 'Quần thể',
              exposure: 'Phơi nhiễm hoặc can thiệp',
              comparison: 'So sánh',
              outcome: 'Kết quả',
            }[field]
          }
          value={check.pico[field]}
          save={(value) => change((c) => ({ ...c, pico: { ...c.pico, [field]: value } }))}
        />
      ))}
    </Card>
  );
}
