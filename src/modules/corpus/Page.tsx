import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { newCorpus } from '@/core/corpus';
import type { Corpus } from '@/core/schemas/corpus';
import { useAuth } from '@/shared/auth/authContext';
import { CorpusConflict, pullCorpus, pullCorpora, pushCorpus } from '@/shared/corpusSync';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { ProtocolForm } from './ProtocolForm';
import { kinds } from './labels';
import { createEswaPair, ESWA_SEED } from './journalSampling';
import styles from './corpus.module.css';

export default function Page() {
  const repo = useRepositories();
  const { user, getIdToken } = useAuth();
  const [conflict, setConflict] = useState<{ corpus: Corpus; version: string | null }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<Corpus[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Corpus['kind']>('topic');
  const [error, setError] = useState('');
  async function sync() {
    try {
      const token = await getIdToken();
      if (!token) return;
      const remote = await pullCorpora(token);
      const local = await repo.corpora.list();
      for (const item of local) {
        const other = remote.find((entry) => entry.id === item.id);
        const state = await repo.corpora.syncState(item.id);
        const dirty = !state || state.snapshot !== JSON.stringify(item);
        if (other && dirty && state?.version !== other.version) {
          setConflict({ corpus: item, version: other.version });
          break;
        }
        if (!other || (dirty && other.version === state?.version)) {
          try {
            const version = await pushCorpus(item, state?.version ?? null, token);
            await repo.corpora.setSyncState(item.id, version, item);
          } catch (e) {
            if (e instanceof CorpusConflict) {
              setConflict({ corpus: item, version: e.version });
              break;
            }
            throw e;
          }
        } else if (!dirty && other.version !== state?.version && other.updatedAt > item.updatedAt) {
          const value = await pullCorpus(item.id, token);
          if (!(await repo.corpora.replaceSynced(value.corpus, value.version, item))) {
            const latest = await repo.corpora.get(item.id);
            if (latest) setConflict({ corpus: latest, version: value.version });
          }
        }
      }
      for (const item of remote.filter((entry) => !local.some((value) => value.id === entry.id))) {
        const value = await pullCorpus(item.id, token);
        if (!(await repo.corpora.replaceSynced(value.corpus, value.version, undefined))) {
          const latest = await repo.corpora.get(item.id);
          if (latest) setConflict({ corpus: latest, version: value.version });
        }
      }
      setItems(await repo.corpora.list());
    } catch (e) {
      setError(String(e));
    }
  }
  async function resolveConflict(keep: boolean) {
    if (!conflict) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      if (keep) {
        const latest = await repo.corpora.get(conflict.corpus.id);
        if (!latest) return;
        const version = await pushCorpus(latest, conflict.version, token);
        await repo.corpora.setSyncState(latest.id, version, latest);
      } else {
        const value = await pullCorpus(conflict.corpus.id, token);
        await repo.corpora.save(value.corpus);
        await repo.corpora.setSyncState(value.corpus.id, value.version, value.corpus);
      }
      setConflict(undefined);
      setItems(await repo.corpora.list());
    } catch (e) {
      if (e instanceof CorpusConflict) setConflict({ ...conflict, version: e.version });
      else setError(String(e));
    }
  }
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
      <Button
        onClick={() =>
          void (async () => {
            try {
              const pair = createEswaPair(crypto.randomUUID(), crypto.randomUUID(), new Date().toISOString());
              for (const item of pair) await repo.corpora.save(item);
              setItems(await repo.corpora.list());
            } catch (e) {
              setError(String(e));
            }
          })()
        }
      >
        Tạo cặp ESWA
      </Button>
      <p>Seed cho cặp ESWA: {ESWA_SEED}</p>
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
      {user ? <Button onClick={() => void sync()}>Đồng bộ</Button> : <p>Đăng nhập để đồng bộ corpus.</p>}
      {conflict && (
        <div role="alert">
          <p>Corpus đã được người khác sửa: {conflict.corpus.title}</p>
          <Button onClick={() => void resolveConflict(false)}>Tải bản mới</Button>
          <Button onClick={() => void resolveConflict(true)}>Giữ bản của tôi</Button>
        </div>
      )}
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
