import { Library, Plus } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { ItemCard, ItemGrid } from '@/shared/ui/ItemCard';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newCorpus } from '@/core/corpus';
import type { Corpus } from '@/core/schemas/corpus';
import { useAuth } from '@/shared/auth/authContext';
import { searchBankJournals } from '@/shared/bank/journals';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Empty } from '@/shared/ui/StateNote';
import { Select } from '@/shared/ui/Select';
import { TextField } from '@/shared/ui/TextField';
import { ProtocolForm } from './ProtocolForm';
import { kinds } from './labels';
import { createEswaPair, ESWA_JOURNAL_NAME, ESWA_SEED } from './journalSampling';
import { downloadManifest } from './manifest';
import styles from './corpus.module.css';

export default function Page() {
  const repo = useRepositories();
  const { user, getIdToken } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Corpus[]>([]);
  const [creating, setCreating] = useState(false);
  const [creatingEswa, setCreatingEswa] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Corpus['kind']>('topic');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<Corpus | null>(null);
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
  async function createEswa() {
    setCreatingEswa(true);
    try {
      const result = await searchBankJournals(getIdToken, ESWA_JOURNAL_NAME);
      const journal =
        result.status === 'ok'
          ? result.items.find((item) => item.kind === 'journal' && item.profile === 'jr.eswa')
          : undefined;
      const pair = createEswaPair(
        crypto.randomUUID(),
        crypto.randomUUID(),
        new Date().toISOString(),
        undefined,
        journal,
      );
      for (const item of pair) await repo.corpora.save(item);
      setItems(await repo.corpora.list());
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingEswa(false);
    }
  }
  return (
    <div className={styles.page}>
      <PageHeader
        title="Corpus"
        lead="Tập bài báo có tiêu chí chọn rõ ràng, dùng làm nền cho tổng hợp và so sánh."
      >
        <Button
          variant="primary"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={() => setCreating(true)}
        >
          Corpus mới
        </Button>
      </PageHeader>
      <section className={styles.eswaSeedPanel} aria-label="Bộ corpus ESWA">
        <span className={styles.eswaSeedIcon} aria-hidden="true">
          <Library size={19} />
        </span>
        <div className={styles.eswaSeedCopy}>
          <Badge tone="accent">Bộ mẫu</Badge>
          <strong>Tạo cặp corpus ESWA</strong>
          <span>
            Seed dùng để tái lập kết quả: <code>{ESWA_SEED}</code>
          </span>
        </div>
        <Button disabled={creatingEswa} onClick={() => void createEswa()}>
          {creatingEswa ? 'Đang tạo cặp ESWA…' : 'Tạo cặp ESWA'}
        </Button>
      </section>
      {error && <p role="alert">{error}</p>}
      {!user && <p className={styles.muted}>Đăng nhập tài khoản lab để lưu corpus trong kho dữ liệu lab.</p>}
      {items.length === 0 ? (
        <Empty title="Chưa có corpus nào." hint="Corpus bạn tạo sẽ hiện ở đây.">
          <Button onClick={() => setCreating(true)}>Tạo corpus đầu tiên</Button>
        </Empty>
      ) : (
        <section className={styles.corpusCollection} aria-labelledby="corpus-list-title">
          <header className={styles.corpusCollectionHeading}>
            <div>
              <h2 id="corpus-list-title">Corpus của bạn</h2>
              <p>Mở một corpus để tiếp tục thu thập, sàng lọc và phân tích bài báo.</p>
            </div>
            <Badge>
              {items.length} {items.length === 1 ? 'corpus' : 'corpora'}
            </Badge>
          </header>
          <ItemGrid label="Các corpus">
            {items.map((item) => {
              const body = item.protocol.at(-1)?.body;
              const about = !body
                ? ''
                : 'researchQuestion' in body
                  ? body.researchQuestion
                  : body.venues.map((venue) => venue.name).join(', ');
              const retrieved = item.members.filter((m) => m.retrieval === 'retrieved').length;
              return (
                <li key={item.id}>
                  <ItemCard
                    to={`/corpus/${item.id}`}
                    icon={<Library size={20} />}
                    title={item.title}
                    description={about}
                    badges={<Badge>{kinds[item.kind]}</Badge>}
                    actions={[
                      { label: 'Mở', onSelect: () => navigate(`/corpus/${item.id}`) },
                      {
                        label: 'Xuất manifest',
                        onSelect: () => {
                          try {
                            downloadManifest(item);
                          } catch (e) {
                            setError(String(e));
                          }
                        },
                      },
                      { label: 'Xoá', danger: true, onSelect: () => setRemoving(item) },
                    ]}
                    stats={[
                      { label: 'Bài', value: item.members.length },
                      { label: 'Đã lấy', value: retrieved },
                      { label: 'Phát hành', value: item.releases.length },
                    ]}
                    progress={
                      item.members.length
                        ? {
                            value: retrieved,
                            max: item.members.length,
                            label: `Đã lấy ${retrieved}/${item.members.length} bài`,
                          }
                        : undefined
                    }
                    footer={
                      <>
                        <span>Giao thức v{item.protocol.at(-1)?.version ?? 1}</span>
                        <span>Cập nhật {new Date(item.updatedAt).toLocaleDateString('vi-VN')}</span>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ItemGrid>
        </section>
      )}
      {creating && (
        <Dialog
          kind="form"
          title="Tạo corpus"
          description="Đặt tên và tiêu chí chọn bài. Sửa tiêu chí về sau sẽ tạo một phiên bản protocol mới."
          onClose={() => setCreating(false)}
        >
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
            <ProtocolForm
              key={kind}
              kind={kind}
              label="Tạo corpus"
              onSave={(body) => void create(body)}
              onCancel={() => setCreating(false)}
            />
          </div>
        </Dialog>
      )}
      {removing && (
        <Dialog
          title="Xoá corpus này?"
          description={`Corpus “${removing.title}” cùng giao thức và các bản phát hành sẽ bị xoá. Bài báo trong Library không bị xoá.`}
          onClose={() => setRemoving(null)}
        >
          <DialogActions>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = removing;
                setRemoving(null);
                void repo.corpora
                  .delete(target.id)
                  .then(() => repo.corpora.list())
                  .then(setItems)
                  .catch((e: unknown) => setError(String(e)));
              }}
            >
              Xoá corpus
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
