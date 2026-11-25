import { ArrowLeft, Download, FileUp, Library, LoaderCircle, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { labKgIds } from '@/shared/labKg/client';
import { LabKgActions } from '@/shared/labKg/LabKgActions';
import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';
import type { CorpusTopics as TopicsSnapshot, TopicName } from '@/core/schemas/corpusTopics';
import { useAuth } from '@/shared/auth/authContext';
import { CorpusConflict } from '@/shared/storage/errors';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
import { importPaperFile } from '@/modules/paper-import';
import { Button } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { IconButton } from '@/shared/ui/IconButton';
import { DataTable } from '@/shared/ui/DataTable';
import { PageHeader } from '@/shared/ui/PageHeader';
import { AppraisalPanel } from './AppraisalPanel';
import { Intake } from './Intake';
import { CorpusBuild } from './CorpusBuild';
import { CorpusLabels } from './CorpusLabels';
import { CorpusProfileCard } from './CorpusProfileCard';
import { CorpusTopics } from './CorpusTopics';
import { CorpusKeywords } from './CorpusKeywords';
import { CorpusOpenKg } from './CorpusOpenKg';
import { CorpusPassages } from './CorpusPassages';
import { CorpusScgRoadmap } from './CorpusScgRoadmap';
import { JournalHarvest } from './JournalHarvest';
import { kinds, memberRoleLabel, versionLabel } from './labels';
import { downloadManifest } from './manifest';
import { PrismaPanel } from './PrismaPanel';
import { ProtocolForm } from './ProtocolForm';
import { MembersTableToolbar } from './MembersTableToolbar';
import { retrievedMember } from './acquisition';
import { TopicSearch } from './TopicSearch';
import styles from './corpus.module.css';

type SaveOptions = { checkpoint?: boolean; expectedVersion?: number };
const CORPUS_AREAS = [
  {
    id: 'collection',
    label: 'Thu thập',
    description: 'Tìm bài theo chủ đề hoặc lấy mẫu từ tạp chí.',
  },
  {
    id: 'quality',
    label: 'Sàng lọc & chất lượng',
    description: 'Theo dõi PRISMA, đánh giá chất lượng, dựng paper model và nhãn.',
  },
  {
    id: 'analysis',
    label: 'Phân tích',
    description: 'Profile, chủ đề, từ khóa và các đồ thị nghiên cứu.',
  },
  {
    id: 'members',
    label: 'Thành viên',
    description: 'Danh sách bài, định danh và trạng thái thu thập.',
  },
  {
    id: 'protocol',
    label: 'Giao thức & phát hành',
    description: 'Tiêu chí nghiên cứu và lịch sử các phiên bản đã phát hành.',
  },
] as const;
type CorpusArea = (typeof CORPUS_AREAS)[number]['id'];

export default function DetailPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const { user, getIdToken } = useAuth();
  const projectId = useHubProjectId() ?? '';
  const [conflict, setConflict] = useState(false);
  const [record, setRecord] = useState<{ doc: Corpus; version: number | null }>();
  const corpus = record?.doc;
  const [loaded, setLoaded] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('all');
  const [readFilter, setReadFilter] = useState('all');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberSort, setMemberSort] = useState('default');
  const memberPdfInput = useRef<HTMLInputElement>(null);
  const pdfTargetMember = useRef<string | null>(null);
  const [uploadingMemberId, setUploadingMemberId] = useState<string | null>(null);
  const [memberPdfError, setMemberPdfError] = useState<{ memberId: string; message: string } | null>(null);
  const [workspace, setWorkspace] = useState<{
    corpusId: string | undefined;
    active: CorpusArea;
    visited: Set<CorpusArea>;
  }>(() => ({ corpusId: id, active: 'collection', visited: new Set(['collection']) }));
  const currentWorkspace =
    workspace.corpusId === id
      ? workspace
      : { corpusId: id, active: 'collection' as const, visited: new Set<CorpusArea>(['collection']) };
  const { active: activeArea, visited: visitedAreas } = currentWorkspace;
  const [error, setError] = useState('');
  const [topicsData, setTopicsData] = useState<{ snapshot: TopicsSnapshot | undefined; names: TopicName[] }>({
    snapshot: undefined,
    names: [],
  });
  const receiveTopics = useCallback(
    (snapshot: TopicsSnapshot | undefined, names: TopicName[]) => setTopicsData({ snapshot, names }),
    [],
  );
  const openArea = (area: CorpusArea) => {
    setWorkspace((current) => {
      const base =
        current.corpusId === id
          ? current
          : { corpusId: id, active: 'collection' as const, visited: new Set<CorpusArea>(['collection']) };
      return { ...base, active: area, visited: new Set(base.visited).add(area) };
    });
  };
  useEffect(() => {
    if (id)
      void repo.corpora
        .getVersioned(id)
        .then((value) => {
          setRecord(value);
          setLoaded(true);
        })
        .catch((e: unknown) => {
          setError(String(e));
          setLoaded(true);
        });
  }, [id, repo]);
  /** Saves the corpus. `checkpoint` coalesces hot writes (a triage batch); the next plain save sends them. */
  async function save(value: Corpus, options: SaveOptions = {}) {
    try {
      setRecord(
        options.checkpoint
          ? { doc: await repo.corpora.checkpoint(value), version: null }
          : await repo.corpora.saveVersioned(value, options.expectedVersion),
      );
    } catch (e) {
      if (e instanceof CorpusConflict) setConflict(true);
      throw e;
    }
  }
  async function importMemberPdf(memberId: string, file: File) {
    if (!corpus || uploadingMemberId) return;
    const member = corpus.members.find((item) => item.memberId === memberId);
    if (!member) return;
    if (!projectId) {
      setMemberPdfError({ memberId, message: 'Không tìm thấy project để lưu PDF.' });
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLocaleLowerCase('en').endsWith('.pdf')) {
      setMemberPdfError({ memberId, message: 'Chọn tệp PDF để nhập.' });
      return;
    }
    setUploadingMemberId(memberId);
    setMemberPdfError(null);
    try {
      const paper = await importPaperFile(file, repo, {
        projectId,
        getIdToken,
        title: member.title,
        reuseExisting: true,
      });
      const updated = retrievedMember(member, paper);
      await save({
        ...corpus,
        updatedAt: new Date().toISOString(),
        members: corpus.members.map((item) => (item.memberId === memberId ? updated : item)),
      });
    } catch (cause) {
      setMemberPdfError({
        memberId,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setUploadingMemberId(null);
    }
  }
  /** Shows the lab's current copy after a conflict; edits not yet saved are dropped. */
  async function reload() {
    if (!id) return;
    try {
      setRecord(await repo.corpora.reload(id));
      setConflict(false);
      setError('');
      setEditing(false);
      setAdding(false);
    } catch (e) {
      setError(String(e));
    }
  }
  if (!loaded)
    return (
      <section className={styles.loadingState} role="status" aria-live="polite" aria-busy="true">
        <span className={styles.loadingIcon} aria-hidden="true">
          <LoaderCircle size={22} />
        </span>
        <div>
          <strong>Đang mở không gian Corpus</strong>
          <p>Đang tải thành viên, giao thức và dữ liệu phân tích.</p>
        </div>
        <div className={styles.loadingPreview} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  if (!corpus) return <p role="alert">Không tìm thấy corpus. {error}</p>;
  const protocol = corpus.protocol.at(-1);
  async function release() {
    if (!record || record.version === null || !protocol) return;
    setReleasing(true);
    try {
      setRecord(await repo.corpora.release(record.doc, record.version));
    } catch (e) {
      if (e instanceof CorpusConflict) setConflict(true);
      setError(String(e));
    } finally {
      setReleasing(false);
    }
  }
  function download() {
    if (!corpus) return;
    try {
      downloadManifest(corpus);
    } catch (e) {
      setError(String(e));
    }
  }
  const count = (key: 'retrieval' | 'textRead', value: string) =>
    corpus.members.filter((m) => m[key] === value).length;
  const query = memberQuery.trim().toLocaleLowerCase('vi');
  const members = corpus.members
    .filter((member) => filter === 'all' || member.retrieval === filter)
    .filter((member) => readFilter === 'all' || member.textRead === readFilter)
    .filter((member) => {
      if (!query) return true;
      return [
        member.title,
        member.identifiers.doi,
        ...(member.identifiers.doiAliases ?? []),
        member.identifiers.openalexId,
        ...(member.identifiers.openalexIdAliases ?? []),
        ...member.identifiers.paperIds,
        ...member.identifiers.libraryIds,
        member.exportId,
      ]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('vi').includes(query));
    })
    .sort((a, b) => {
      if (memberSort === 'title_asc' || memberSort === 'title_desc') {
        const direction = memberSort === 'title_asc' ? 1 : -1;
        return direction * (a.title ?? a.exportId).localeCompare(b.title ?? b.exportId, 'vi');
      }
      if (memberSort === 'year_desc' || memberSort === 'year_asc') {
        const direction = memberSort === 'year_desc' ? -1 : 1;
        return (
          direction *
          ((a.stratum.year ?? Number.MAX_SAFE_INTEGER) - (b.stratum.year ?? Number.MAX_SAFE_INTEGER))
        );
      }
      if (memberSort === 'retrieved_first') {
        const rank = { retrieved: 0, sought: 1, not_retrieved: 2 };
        return rank[a.retrieval] - rank[b.retrieval];
      }
      return 0;
    });
  const stats: [string, number][] = [
    ['Đang tìm', count('retrieval', 'sought')],
    ['Đã lấy', count('retrieval', 'retrieved')],
    ['Không lấy được', count('retrieval', 'not_retrieved')],
    ['Toàn văn', count('textRead', 'FULL_TEXT')],
    ['Abstract', count('textRead', 'ABSTRACT_ONLY')],
    ['Siêu dữ liệu', count('textRead', 'METADATA_ONLY')],
  ];
  const body = protocol?.body;
  const yearRange = body?.years.length ? `${Math.min(...body.years)}–${Math.max(...body.years)}` : 'Mọi năm';
  const facts: [string, string][] = !body
    ? []
    : 'researchQuestion' in body
      ? [
          ['Research question', body.researchQuestion || 'Chưa đặt'],
          ['Tiêu chí chọn', body.inclusion.join('; ') || 'Chưa có'],
          ['Tiêu chí loại', body.exclusion.join('; ') || 'Chưa có'],
          ['Năm', yearRange],
        ]
      : [
          ['Tạp chí', body.venues.map((venue) => venue.name).join(', ') || 'Chưa có'],
          ['Loại bài', body.articleTypes.join(', ') || 'Mọi loại'],
          ['Năm', yearRange],
        ];
  const pending = corpus.pendingConfirmations?.length ?? 0;
  return (
    <div className={styles.page}>
      <PageHeader
        title={corpus.title}
        lead={
          <span className={styles.badges}>
            <Badge>{kinds[corpus.kind]}</Badge>
            <Badge>Giao thức v{protocol?.version ?? '—'}</Badge>
            {!user && <Badge>Chỉ trên máy này</Badge>}
          </span>
        }
      >
        <div className={styles.detailActions}>
          <Link to="/corpus" className={styles.back}>
            <ArrowLeft size={14} aria-hidden="true" />
            Corpus
          </Link>
          <IconButton label="Sửa giao thức" onClick={() => setEditing(true)}>
            <Pencil size={18} />
          </IconButton>
          <IconButton label="Xuất manifest" onClick={download}>
            <Download size={18} />
          </IconButton>
          <Button
            variant="primary"
            disabled={releasing || conflict || record?.version === null}
            onClick={() => void release()}
          >
            Phát hành
          </Button>
        </div>
      </PageHeader>
      {error && !conflict && <p role="alert">Có lỗi xảy ra. {error}</p>}
      {conflict && (
        <div role="alert" className={styles.conflict}>
          <p>Corpus đã được người khác sửa nên thay đổi của bạn chưa được lưu. Tải bản mới rồi làm lại.</p>
          <Button size="sm" onClick={() => void reload()}>
            Tải bản mới
          </Button>
        </div>
      )}

      <dl className={styles.stats} aria-label="Thu thập">
        <div>
          <dt>Tổng số bài</dt>
          <dd>{corpus.members.length}</dd>
        </div>
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <nav className={styles.workspaceNav} aria-label="Khu vực làm việc trong corpus">
        {CORPUS_AREAS.map((area) => (
          <Button
            key={area.id}
            type="button"
            variant="ghost"
            size="sm"
            className={styles.workspaceNavItem}
            aria-current={activeArea === area.id ? 'page' : undefined}
            aria-controls={`corpus-area-${area.id}`}
            onClick={() => openArea(area.id)}
          >
            <span>{area.label}</span>
          </Button>
        ))}
      </nav>
      <p className={styles.workspaceDescription} role="status">
        {CORPUS_AREAS.find((area) => area.id === activeArea)?.description}
      </p>

      {visitedAreas.has('collection') && (
        <section
          id="corpus-area-collection"
          className={styles.workspacePanel}
          aria-label="Thu thập"
          hidden={activeArea !== 'collection'}
        >
          {corpus.kind !== 'topic' && <JournalHarvest corpus={corpus} save={save} />}
          {corpus.kind === 'topic' && <TopicSearch corpus={corpus} save={save} />}
        </section>
      )}
      {visitedAreas.has('quality') && (
        <section
          className={styles.workspacePanel}
          id="corpus-area-quality"
          aria-label="Sàng lọc và chất lượng"
          hidden={activeArea !== 'quality'}
        >
          {corpus.kind === 'topic' && <PrismaPanel corpus={corpus} />}
          {corpus.kind === 'topic' && <AppraisalPanel corpus={corpus} save={save} />}
          <CorpusBuild key={JSON.stringify([corpus.id, user?.uid])} corpus={corpus} save={save} />
          <CorpusLabels corpus={corpus} save={save} />
        </section>
      )}
      {visitedAreas.has('analysis') && (
        <section
          id="corpus-area-analysis"
          className={styles.workspacePanel}
          aria-label="Phân tích"
          hidden={activeArea !== 'analysis'}
        >
          {corpus.kind === 'journal' && <CorpusProfileCard corpus={corpus} />}
          <LabKgActions
            key={user?.uid}
            ids={labKgIds(corpus.members.map(({ identifiers }) => identifiers))}
          />
          <CorpusTopics corpus={corpus} onData={receiveTopics} />
          <CorpusKeywords corpus={corpus} />
          <CorpusScgRoadmap corpus={corpus} />
          <CorpusOpenKg key={corpus.id} corpus={corpus} save={save} />
          <CorpusPassages key={`passages-${corpus.id}`} corpus={corpus} />
        </section>
      )}
      {visitedAreas.has('members') && (
        <section
          id="corpus-area-members"
          className={styles.workspacePanel}
          aria-label="Thành viên"
          hidden={activeArea !== 'members'}
        >
          <section
            aria-labelledby="corpus-members"
            className={`${styles.members} ${styles.membersTableShell}`}
          >
            <div className={styles.membersToolbar}>
              <div>
                <h2 id="corpus-members">Thành viên</h2>
                <p className={styles.muted}>Danh sách bài và trạng thái thu thập trong corpus.</p>
              </div>
              <div className={styles.cardTools}>
                <Button
                  size="sm"
                  leadingIcon={<Plus size={16} aria-hidden="true" />}
                  onClick={() => setAdding(true)}
                >
                  Thêm bài vào corpus
                </Button>
              </div>
            </div>
            {pending > 0 && (
              <div className={styles.notice}>
                <span>{pending} bài trùng tên và năm với bài đã có, cần bạn xác nhận.</span>
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  Xác nhận
                </Button>
              </div>
            )}
            <input
              ref={memberPdfInput}
              className={styles.memberPdfInput}
              type="file"
              accept=".pdf,application/pdf"
              aria-label="Chọn PDF cho bài báo"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                const memberId = pdfTargetMember.current;
                event.currentTarget.value = '';
                pdfTargetMember.current = null;
                if (file && memberId) void importMemberPdf(memberId, file);
              }}
            />
            {corpus.members.length > 0 && (
              <MembersTableToolbar
                query={memberQuery}
                onQueryChange={setMemberQuery}
                retrievalFilter={filter}
                onRetrievalFilterChange={setFilter}
                readFilter={readFilter}
                onReadFilterChange={setReadFilter}
                sort={memberSort}
                onSortChange={setMemberSort}
                visibleCount={members.length}
                totalCount={corpus.members.length}
              />
            )}
            {corpus.members.length === 0 ? (
              <div className={styles.emptyMembers}>
                <Library size={28} aria-hidden="true" />
                <strong>Corpus chưa có bài nào</strong>
                <span>Thêm bài từ Library, từ bài đã nhập hoặc dán một danh sách DOI.</span>
              </div>
            ) : members.length === 0 ? (
              <div className={styles.emptyMembers}>
                <strong>Không tìm thấy bài phù hợp</strong>
                <span>Thử đổi từ khóa hoặc bộ lọc.</span>
              </div>
            ) : (
              <DataTable
                aria-label="Thành viên trong corpus"
                className={styles.membersTable}
                scrollClassName={styles.membersTableScroll}
              >
                <thead>
                  <tr>
                    <th>Title / DOI</th>
                    <th>Định danh</th>
                    <th>Vai trò</th>
                    <th>Thu thập</th>
                    <th>Đã đọc</th>
                    <th>Phiên bản</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.memberId}>
                      <td className={styles.memberTitle}>
                        {m.retrieval === 'retrieved' && m.identifiers.paperIds[0] ? (
                          <Link
                            className={styles.memberPaperLink}
                            to={`/papers/${encodeURIComponent(m.identifiers.paperIds[0])}?pane=fulltext`}
                            aria-label={`Mở bài báo trong trình đọc: ${m.title || m.identifiers.doi || m.exportId}`}
                          >
                            {m.title || m.identifiers.doi || m.exportId}
                          </Link>
                        ) : (
                          m.title || m.identifiers.doi || m.exportId
                        )}
                        {topicsData.snapshot?.members
                          .filter((member) => member.corpusId === corpus.id && member.memberId === m.memberId)
                          .map((member) => (
                            <div key={member.memberId}>
                              Chủ đề:{' '}
                              {topicsData.names.find((name) => name.topicId === member.topicId)?.name ||
                                topicsData.snapshot?.topics
                                  .find((topic) => topic.topicId === member.topicId)
                                  ?.words.join(', ') ||
                                'Ngoại lệ'}{' '}
                              ·{' '}
                              {member.probability === null
                                ? '—'
                                : `${(member.probability * 100).toFixed(1)}%`}{' '}
                              {member.weak && '· gán yếu'} · {member.keyphrases.join(', ')}
                            </div>
                          ))}
                      </td>
                      <td className={styles.ids}>
                        {[
                          m.identifiers.doi,
                          m.identifiers.openalexId,
                          ...m.identifiers.paperIds,
                          ...m.identifiers.libraryIds,
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                      <td>{memberRoleLabel(m.role)}</td>
                      <td
                        className={`${styles.memberStatusCell} ${m.retrieval === 'not_retrieved' ? styles.memberRetrievalCell : ''}`}
                      >
                        <Badge
                          tone={
                            m.retrieval === 'retrieved'
                              ? 'success'
                              : m.retrieval === 'not_retrieved'
                                ? 'danger'
                                : 'accent'
                          }
                        >
                          {
                            {
                              sought: 'Đang tìm',
                              retrieved: 'Đã lấy',
                              not_retrieved: 'Không lấy được',
                            }[m.retrieval]
                          }
                        </Badge>
                        {m.retrieval === 'not_retrieved' && (
                          <div className={styles.memberPdfAction}>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={Boolean(uploadingMemberId)}
                              leadingIcon={<FileUp size={14} aria-hidden="true" />}
                              onClick={() => {
                                pdfTargetMember.current = m.memberId;
                                memberPdfInput.current?.click();
                              }}
                            >
                              {uploadingMemberId === m.memberId ? 'Đang nhập PDF…' : 'Nhập PDF'}
                            </Button>
                            {memberPdfError?.memberId === m.memberId && (
                              <span className={styles.memberPdfError} role="alert">
                                {memberPdfError.message}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={styles.memberStatusCell}>
                        <Badge tone={m.textRead === 'FULL_TEXT' ? 'success' : 'neutral'}>
                          {
                            {
                              FULL_TEXT: 'Toàn văn',
                              ABSTRACT_ONLY: 'Abstract',
                              METADATA_ONLY: 'Siêu dữ liệu',
                            }[m.textRead]
                          }
                        </Badge>
                      </td>
                      <td>{versionLabel(m.version)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>
        </section>
      )}
      {visitedAreas.has('protocol') && (
        <section
          className={styles.workspacePanel}
          id="corpus-area-protocol"
          aria-label="Giao thức và phát hành"
          hidden={activeArea !== 'protocol'}
        >
          <div className={styles.lower}>
            <Card>
              <div className={styles.cardHead}>
                <h2>Giao thức v{protocol?.version ?? '—'}</h2>
                <IconButton size="sm" label="Sửa giao thức" onClick={() => setEditing(true)}>
                  <Pencil size={16} />
                </IconButton>
              </div>
              <dl className={styles.facts}>
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <div className={styles.cardHead}>
                <h2>Lịch sử phát hành</h2>
              </div>
              {corpus.releases.length === 0 ? (
                <p className={styles.muted}>
                  Chưa phát hành lần nào. Phát hành chốt danh sách bài bằng một mã băm để dẫn lại về sau.
                </p>
              ) : (
                <ol className={styles.releases}>
                  {[...corpus.releases].reverse().map((r) => {
                    const index = corpus.releases.indexOf(r);
                    const same = index > 0 && corpus.releases[index - 1]?.digest === r.digest;
                    return (
                      <li key={r.id}>
                        <code>{r.digest.replace(/^sha256:/u, '').slice(0, 12)}</code>
                        <span>
                          {new Date(r.createdAt).toLocaleString('vi-VN')}, {r.memberCount} bài
                          {same ? ', không đổi so với bản trước' : ''}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          </div>
        </section>
      )}

      {adding && (
        <Dialog
          kind="form"
          title="Thêm bài vào corpus"
          description="Chọn bài từ Library, từ bài đã nhập, hoặc dán danh sách DOI. Bài trùng được gộp hoặc hỏi lại bạn."
          onClose={() => setAdding(false)}
        >
          <Intake corpus={corpus} save={save} heading={false} />
        </Dialog>
      )}
      {editing && protocol && (
        <Dialog
          kind="form"
          title="Sửa giao thức"
          description={`Lưu sẽ tạo phiên bản v${protocol.version + 1}. Phiên bản v${protocol.version} được giữ nguyên.`}
          onClose={() => setEditing(false)}
        >
          <ProtocolForm
            kind={corpus.kind}
            initial={protocol.body}
            label="Lưu phiên bản mới"
            onCancel={() => setEditing(false)}
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
        </Dialog>
      )}
    </div>
  );
}
