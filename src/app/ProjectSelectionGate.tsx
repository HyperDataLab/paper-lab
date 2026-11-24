import { ArrowRight, FolderKanban, LogIn, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/auth/authContext';
import { RESEARCH_HUB_URL } from '@/shared/auth/config';
import { listResearchHubProjects, type ResearchHubProject } from '@/shared/pdfStore/researchHubProjects';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import styles from './projectSelection.module.css';

type ProjectListState = { userId: string; items: ResearchHubProject[] };
type ProjectListError = { userId: string; message: string };

export function ProjectSelectionGate({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const { user, ready, error: authError, signIn, signOut, getAccessToken, getIdToken } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [projectList, setProjectList] = useState<ProjectListState | null>(null);
  const [projectError, setProjectError] = useState<ProjectListError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const projects = user && projectList && projectList.userId === user.uid ? projectList.items : null;
  const error = user && projectError && projectError.userId === user.uid ? projectError.message : '';
  const loading = Boolean(user && !projects && !error);

  useEffect(() => {
    if (projectId || !user || !ready) return;
    const controller = new AbortController();
    void (async () => {
      const token = getAccessToken ? await getAccessToken() : await getIdToken();
      if (!token) throw new Error('Không lấy được phiên SSO hợp lệ. Hãy đăng nhập lại.');
      const items = await listResearchHubProjects(token, controller.signal);
      if (!controller.signal.aborted) {
        setProjectList({ userId: user.uid, items });
        setProjectError(null);
      }
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setProjectError({
          userId: user.uid,
          message: cause instanceof Error ? cause.message : 'Không tải được danh sách project.',
        });
      }
    });
    return () => controller.abort();
  }, [getAccessToken, getIdToken, projectId, ready, retryKey, user]);

  if (projectId) return children;
  if (!ready) return <Loading label="Đang kiểm tra phiên đăng nhập…" />;

  const retry = () => {
    setProjectList(null);
    setProjectError(null);
    // The effect is retriggered by this state change without changing the selected route.
    setRetryKey((key) => key + 1);
  };

  function choose(project: ResearchHubProject) {
    const query = new URLSearchParams(location.search);
    query.set('projectId', project.id);
    navigate(`${location.pathname}?${query.toString()}${location.hash}`, { replace: true });
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-labelledby="project-selection-title">
        <div className={styles.icon} aria-hidden="true">
          <FolderKanban size={21} />
        </div>
        <div className={styles.content}>
          <p className={styles.eyebrow}>RESEARCHHUB</p>
          <h1 id="project-selection-title">{user ? 'Chọn project để tiếp tục' : 'Đăng nhập vào PaperLab'}</h1>
          <p className={styles.intro}>
            {user
              ? `Đang đăng nhập bằng ${user.email}. Chọn một project bạn có quyền truy cập để mở workspace.`
              : 'Đăng nhập bằng HyperDataLab SSO. Sau khi xác thực, PaperLab sẽ tải danh sách project bạn được phép mở.'}
          </p>
          {!user ? (
            <div className={styles.actions}>
              <Button variant="primary" leadingIcon={<LogIn size={16} />} onClick={() => void signIn()}>
                Đăng nhập SSO
              </Button>
              {authError && (
                <p className={styles.error} role="alert">
                  {authError}
                </p>
              )}
            </div>
          ) : (
            <>
              {loading && <Loading label="Đang tải project được cấp quyền…" />}
              {error && (
                <div className={styles.errorPanel} role="alert">
                  <p>{error}</p>
                  <div className={styles.actions}>
                    <Button leadingIcon={<RefreshCw size={15} />} onClick={retry}>
                      Tải lại danh sách
                    </Button>
                    <Button variant="ghost" onClick={() => void signOut()}>
                      Đăng xuất
                    </Button>
                  </div>
                </div>
              )}
              {!loading && !error && projects?.length === 0 && (
                <div className={styles.empty}>
                  <strong>Tài khoản chưa có project khả dụng</strong>
                  <p>Tạo project hoặc xin quyền truy cập trong ResearchHub, sau đó tải lại danh sách.</p>
                  <div className={styles.actions}>
                    {RESEARCH_HUB_URL && (
                      <a className={styles.link} href={RESEARCH_HUB_URL}>
                        Mở ResearchHub <ArrowRight size={14} aria-hidden="true" />
                      </a>
                    )}
                    <Button onClick={retry}>Tải lại danh sách</Button>
                  </div>
                </div>
              )}
              {!loading && !error && !!projects?.length && (
                <div className={styles.projectList} aria-label="Project ResearchHub của bạn">
                  <div className={styles.listHeading}>
                    <span>Project có thể truy cập</span>
                    <span className={styles.projectCount}>
                      {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                    </span>
                  </div>
                  {projects.map((project) => (
                    <Button key={project.id} className={styles.project} onClick={() => choose(project)}>
                      <span className={styles.projectIcon} aria-hidden="true">
                        <FolderKanban size={17} />
                      </span>
                      <span className={styles.projectText}>
                        <strong>{project.name}</strong>
                        <small>ID · {project.id}</small>
                      </span>
                      <span className={styles.projectAction}>
                        <span>Mở project</span>
                        <span className={styles.arrow} aria-hidden="true">
                          <ArrowRight size={16} />
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
