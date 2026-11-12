import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { newCorpus } from '@/core/corpus';
import type { Corpus } from '@/core/schemas/corpus';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { ProtocolForm } from './ProtocolForm';
import { kinds } from './labels';
import styles from './corpus.module.css';

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const [items, setItems] = useState<Corpus[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Corpus['kind']>('topic');
  const [error, setError] = useState('');
  useEffect(() => {
    void repo.corpora
      .list()
      .then(setItems)
      .catch((e: unknown) => setError(String(e)));
  }, [repo]);
  async function create(body: Corpus['protocol'][number]['body']) {
    if (!title.trim()) {
      setError('Hãy nhập tên corpus.');
      return;
    }
    try {
      const at = new Date().toISOString();
      const value = newCorpus({
        id: crypto.randomUUID(),
        title: title.trim(),
        kind,
        createdAt: at,
        protocol: [{ version: 1, createdAt: at, body }],
      } as Parameters<typeof newCorpus>[0]);
      await repo.corpora.save(value);
      navigate(`/corpus/${value.id}`);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className={styles.page}>
      <h1>Corpus</h1>
      <Card>
        <h2>Tạo corpus</h2>
        <div className={styles.form}>
          <TextField label="Tên corpus" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select
            label="Loại corpus"
            value={kind}
            onChange={(e) => setKind(e.target.value as Corpus['kind'])}
          >
            <option value="topic">Chủ đề</option>
            <option value="journal">Journal</option>
            <option value="control">Đối chứng</option>
          </Select>
          <ProtocolForm key={kind} kind={kind} label="Tạo corpus" onSave={(body) => void create(body)} />
        </div>
      </Card>
      {error && <p role="alert">{error}</p>}
      <h2>Các corpus</h2>
      {items.length === 0 ? (
        <p>Chưa có corpus nào.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <Link to={`/corpus/${item.id}`}>{item.title}</Link>
                <p className={styles.muted}>
                  {kinds[item.kind]} · {item.members.length} bài · cập nhật{' '}
                  {new Date(item.updatedAt).toLocaleString('vi-VN')}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
