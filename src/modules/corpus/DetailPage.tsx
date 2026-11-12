import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { canonicalDigest } from '@/core/corpus';
import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';
import { useAuth } from '@/shared/auth/authContext';
import { CorpusConflict, pullCorpus, pushCorpus } from '@/shared/corpusSync';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { Select } from '@/shared/ui/Select';
import { Intake } from './Intake';
import { CorpusBuild } from './CorpusBuild';
import { kinds } from './labels';
import { ProtocolForm } from './ProtocolForm';
import styles from './corpus.module.css';

export default function DetailPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const { user, getIdToken } = useAuth();
  const [conflict, setConflict] = useState<{ version: string | null }>();
  const conflictRef = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [corpus, setCorpus] = useState<Corpus>();
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  useEffect(() => {
    if (id)
      void repo.corpora
        .get(id)
        .then((value) => {
          setCorpus(value);
          setLoaded(true);
        })
        .catch((e: unknown) => {
          setError(String(e));
          setLoaded(true);
        });
  }, [id, repo]);
  async function save(value: Corpus) {
    const saved = await repo.corpora.save(value);
    setCorpus(saved);
    if (user) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        queue.current = queue.current
          .then(async () => {
            if (conflictRef.current) return;
            const latest = await repo.corpora.get(saved.id);
            const token = await getIdToken();
            if (!latest || !token) return;
            const state = await repo.corpora.syncState(saved.id);
            try {
              const version = await pushCorpus(latest, state?.version ?? null, token);
              await repo.corpora.setSyncState(latest.id, version, latest);
            } catch (e) {
              if (e instanceof CorpusConflict) {
                conflictRef.current = true;
                setConflict({ version: e.version });
              } else setError(String(e));
            }
          })
          .catch((e: unknown) => setError(String(e)));
      }, 500);
    }
  }
  async function resolveConflict(keep: boolean) {
    if (!corpus || !conflict) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      if (keep) {
        const latest = await repo.corpora.get(corpus.id);
        if (!latest) return;
        const version = await pushCorpus(latest, conflict.version, token);
        await repo.corpora.setSyncState(latest.id, version, latest);
      } else {
        const value = await pullCorpus(corpus.id, token);
        await repo.corpora.save(value.corpus);
        await repo.corpora.setSyncState(value.corpus.id, value.version, value.corpus);
        setCorpus(value.corpus);
      }
      conflictRef.current = false;
      setConflict(undefined);
    } catch (e) {
      if (e instanceof CorpusConflict) setConflict({ version: e.version });
      else setError(String(e));
    }
  }
  if (!loaded) return <p>Đang tải…</p>;
  if (!corpus) return <p role="alert">Không tìm thấy corpus. {error}</p>;
  const protocol = corpus.protocol.at(-1);
  async function release() {
    if (!corpus || !protocol) return;
    try {
      const contents = {
        protocol: { version: protocol.version, body: protocol.body },
        members: corpus.members
          .map((m) => ({
            memberId: m.memberId,
            role: m.role,
            stratum: m.stratum,
            identifiers: m.identifiers,
          }))
          .sort((a, b) => a.memberId.localeCompare(b.memberId)),
      };
      const digest = await canonicalDigest(JSON.parse(JSON.stringify(contents)) as unknown);
      const at = new Date().toISOString();
      await save({
        ...corpus,
        updatedAt: at,
        releases: [
          ...corpus.releases,
          {
            id: crypto.randomUUID(),
            createdAt: at,
            protocolVersion: protocol.version,
            digest,
            memberCount: corpus.members.length,
            registryVersion: null,
          },
        ],
      });
    } catch (e) {
      setError(String(e));
    }
  }
  function download() {
    if (!corpus) return;
    try {
      const json = JSON.stringify(CorpusSchema.parse(corpus), null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${
        corpus.title
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/gu, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-')
          .replace(/^-|-$/gu, '') || 'corpus'
      }.corpus.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }
  const count = (key: 'retrieval' | 'textRead', value: string) =>
    corpus.members.filter((m) => m[key] === value).length;
  return (
    <div className={styles.page}>
      <Link to="/corpus">← Corpus</Link>
      <header>
        <h1>{corpus.title}</h1>
        <p>
          {kinds[corpus.kind]} · Giao thức phiên bản {protocol?.version ?? '—'} · {corpus.members.length} bài
        </p>
        <p className={styles.muted}>
          Tìm kiếm: {count('retrieval', 'sought')} · Đã lấy: {count('retrieval', 'retrieved')} · Không lấy
          được: {count('retrieval', 'not_retrieved')}
          <br />
          Toàn văn: {count('textRead', 'FULL_TEXT')} · Tóm tắt: {count('textRead', 'ABSTRACT_ONLY')} · Siêu dữ
          liệu: {count('textRead', 'METADATA_ONLY')}
        </p>
      </header>
      {error && <p role="alert">Có lỗi xảy ra. {error}</p>}
      {!user && <p>Đăng nhập để đồng bộ corpus.</p>}
      {conflict && (
        <div role="alert">
          <p>Corpus đã được người khác sửa</p>
          <Button onClick={() => void resolveConflict(false)}>Tải bản mới</Button>
          <Button onClick={() => void resolveConflict(true)}>Giữ bản của tôi</Button>
        </div>
      )}
      <Card>
        <Intake corpus={corpus} save={save} />
      </Card>
      <CorpusBuild corpus={corpus} save={save} />
      <Card>
        <h2>Thành viên</h2>
        <Select label="Trạng thái thu thập" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="sought">Đang tìm</option>
          <option value="retrieved">Đã lấy</option>
          <option value="not_retrieved">Không lấy được</option>
        </Select>
        <DataTable>
          <thead>
            <tr>
              <th>Tiêu đề / DOI</th>
              <th>Định danh</th>
              <th>Vai trò</th>
              <th>Thu thập</th>
              <th>Đã đọc</th>
              <th>Phiên bản</th>
            </tr>
          </thead>
          <tbody>
            {corpus.members
              .filter((m) => filter === 'all' || m.retrieval === filter)
              .map((m) => (
                <tr key={m.memberId}>
                  <td>{m.title || m.identifiers.doi || m.exportId}</td>
                  <td>
                    {[
                      m.identifiers.doi,
                      m.identifiers.openalexId,
                      ...m.identifiers.paperIds,
                      ...m.identifiers.libraryIds,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td>{m.role ?? '—'}</td>
                  <td>
                    {
                      { sought: 'Đang tìm', retrieved: 'Đã lấy', not_retrieved: 'Không lấy được' }[
                        m.retrieval
                      ]
                    }
                  </td>
                  <td>
                    {
                      { FULL_TEXT: 'Toàn văn', ABSTRACT_ONLY: 'Tóm tắt', METADATA_ONLY: 'Siêu dữ liệu' }[
                        m.textRead
                      ]
                    }
                  </td>
                  <td>{m.version ?? '—'}</td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      </Card>
      <Card>
        <h2>Giao thức</h2>
        <p>Phiên bản: {corpus.protocol.map((p) => p.version).join(', ')}</p>
        <Button onClick={() => setEditing(!editing)}>Sửa giao thức</Button>
        {editing && protocol && (
          <ProtocolForm
            kind={corpus.kind}
            initial={protocol.body}
            label="Lưu phiên bản mới"
            onSave={(body) => {
              const at = new Date().toISOString();
              void save(
                CorpusSchema.parse({
                  ...corpus,
                  updatedAt: at,
                  protocol: [...corpus.protocol, { version: protocol.version + 1, createdAt: at, body }],
                }),
              )
                .then(() => setEditing(false))
                .catch((e: unknown) => setError(String(e)));
            }}
          />
        )}
      </Card>
      <Card>
        <h2>Phát hành</h2>
        <div className={styles.row}>
          <Button onClick={() => void release()}>Phát hành</Button>
          <Button onClick={download}>Xuất manifest</Button>
        </div>
        <ul>
          {corpus.releases.map((r, i) => (
            <li key={r.id}>
              {new Date(r.createdAt).toLocaleString('vi-VN')} ·{' '}
              {r.digest.replace(/^sha256:/u, '').slice(0, 12)} · {r.memberCount} bài
              {i > 0 && corpus.releases[i - 1]?.digest === r.digest ? ' · không đổi so với bản trước' : ''}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
