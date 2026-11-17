import { useState } from 'react';
import { checkPlan } from '@/core/researchDesign/draft/checkPlan';
import { gridCells, setRunMatrix } from '@/core/researchDesign/draft/planOps';
import { runCount, type DraftRunMatrix } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { useResearchDesign } from '../ResearchDesignProvider';
import { planFlagText } from '../analyses/planText';
import { GridForm } from '../runs/GridForm';

export default function RunsSection() {
  const state = useResearchDesign();
  const [message, setMessage] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  if (state.loading) return <p>Đang tải…</p>;
  if (state.error) return <p>Không tải được ma trận chạy.</p>;
  const { draft } = state.design;
  const matrix = draft.runMatrix;
  const count = runCount(matrix);
  const preview = gridCells(draft, 20);
  const flags = checkPlan(draft).filter((f) => f.subject === 'runMatrix' || f.rule === 'AN-05');
  const save = async (value: DraftRunMatrix) => {
    try {
      await state.save((record) => {
        const result = setRunMatrix(record.draft, value);
        if (!result.ok) throw new Error(result.error);
        return { ...record, draft: result.doc };
      });
      setFormVersion((v) => v + 1);
      setMessage('Đã lưu lưới chạy.');
      return true;
    } catch {
      setMessage('Lưới chạy đã thay đổi và không thể lưu. Vui lòng kiểm tra lại.');
      return false;
    }
  };
  return (
    <>
      <h2>Ma trận chạy</h2>
      <p>Điều kiện × dataset × seed, tên experiment và tag MLflow.</p>
      {message && <p role="status">{message}</p>}
      <Card>
        <h3>Lưới chạy</h3>
        <GridForm key={formVersion} draft={draft} readOnly={false} save={save} />
      </Card>
      <Card>
        <h3>Số lần chạy</h3>
        <p>
          {count
            ? `${matrix.conditions.length} điều kiện × ${matrix.datasets.length} dataset × ${matrix.seeds.length} seed = ${count} lần chạy`
            : 'Chưa đủ để tính số lần chạy.'}
        </p>
        {flags.map((f, i) => (
          <p key={i}>
            <Badge tone="warning">Cần xem lại</Badge> {planFlagText(f, draft)}
          </p>
        ))}
      </Card>
      <Card>
        <h3>Các ô đầu tiên</h3>
        {preview.cells.length ? (
          <table>
            <thead>
              <tr>
                <th scope="col">
                  Điều kiện
                  <br />
                  plan.condition_id
                </th>
                <th scope="col">
                  Dataset
                  <br />
                  plan.dataset_id
                </th>
                <th scope="col">
                  Seed
                  <br />
                  plan.seed
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.cells.map((cell) => (
                <tr key={`${cell.condition}/${cell.dataset}/${cell.seed}`}>
                  <td>
                    {cell.condition} {draft.conditions.find((c) => c.id === cell.condition)?.name}
                  </td>
                  <td>
                    {cell.dataset} {draft.datasets.find((d) => d.id === cell.dataset)?.name}
                  </td>
                  <td>{cell.seed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Chưa có ô nào trong lưới chạy đã lưu.</p>
        )}
        {preview.total > preview.cells.length && <p>… và {preview.total - preview.cells.length} ô nữa</p>}
        <p>plan.id và plan.version được gán khi đóng băng.</p>
      </Card>
    </>
  );
}
