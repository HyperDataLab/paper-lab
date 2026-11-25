import { ArrowRight, FolderKanban, LogIn, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/auth/authContext';
import {
  createResearchHubProject,
  listResearchHubProjects,
  type ResearchHubProject,
} from '@/shared/pdfStore/researchHubProjects';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import { TextField } from '@/shared/ui/TextField';
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
  const {
    mode = 'sso',
    user,
    ready,
    error: authError,
    signIn,
    signOut,
    getAccessToken,
    getIdToken,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [projectList, setProjectList] = useState<ProjectListState | null>(null);
  const [projectError, setProjectError] = useState<ProjectListError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createError, setCreateError] = useState('');
  const projects = user && projectList && projectList.userId === user.uid ? projectList.items : null;
  const error = user && projectError && projectError.userId === user.uid ? projectError.message : '';
  const loading = Boolean(user && !projects && !error);
  const hasNoProjects = projects?.length === 0;

  useEffect(() => {
    if (mode === 'firebase' || projectId || !user || !ready) return;
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
  }, [getAccessToken, getIdToken, mode, projectId, ready, retryKey, user]);

  if (mode === 'firebase') return children;
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

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || creatingProject) return;
    const name = projectName.trim();
    const description = projectDescription.trim();
    if (!name || name.length > 120 || description.length > 1000) {
      setCreateError('Tên project cần từ 1 đến 120 ký tự; mô tả tối đa 1000 ký tự.');
      return;
    }
    setCreatingProject(true);
    setCreateError('');
    try {
      const token = getAccessToken ? await getAccessToken() : await getIdToken();
      if (!token) throw new Error('Phiên SSO không hợp lệ. Hãy đăng nhập lại rồi thử lần nữa.');
      const project = await createResearchHubProject(token, { name, description });
      choose(project);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Không tạo được project ResearchHub.');
    } finally {
      setCreatingProject(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-labelledby="project-selection-title">
        <div className={styles.content}>
          <div className={styles.brandRow}>
            <FolderKanban size={18} aria-hidden="true" />
            <span>ResearchHub</span>
          </div>
          <h1 id="project-selection-title">
            {!user
              ? 'Đăng nhập vào PaperLab'
              : hasNoProjects
                ? 'Tạo project đầu tiên'
                : 'Chọn project để tiếp tục'}
          </h1>
          <p className={styles.intro}>
            {!user
              ? 'Đăng nhập bằng HyperDataLab SSO để mở workspace nghiên cứu.'
              : hasNoProjects
                ? 'Project được lưu trong ResearchHub và mở ngay trong PaperLab.'
                : 'Chọn một project bạn có quyền truy cập để mở workspace.'}
          </p>
          {user && <p className={styles.accountEmail}>{user.email}</p>}
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
              {loading && (
                <div className={styles.status}>
                  <Loading label="Đang tải danh sách project…" />
                </div>
              )}
              {error && (
                <div className={styles.errorState} role="alert">
                  <p className={styles.error}>{error}</p>
                  <div className={styles.statusActions}>
                    <Button leadingIcon={<RefreshCw size={15} />} onClick={retry}>
                      Tải lại danh sách
                    </Button>
                    <Button variant="ghost" onClick={() => void signOut()}>
                      Đăng xuất
                    </Button>
                  </div>
                </div>
              )}
              {!loading && !error && hasNoProjects && (
                <div className={styles.empty}>
                  <form
                    className={styles.createProjectForm}
                    onSubmit={(event) => void handleCreateProject(event)}
                  >
                    <TextField
                      label="Tên project"
                      value={projectName}
                      onChange={(event) => setProjectName(event.currentTarget.value)}
                      placeholder="Ví dụ: Tổng quan tài liệu về học thích ứng"
                      maxLength={120}
                      required
                      controlClassName={styles.projectNameInput}
                    />
                    <TextField
                      label="Mô tả"
                      labelAction={<span className={styles.optional}>Không bắt buộc</span>}
                      multiline
                      rows={4}
                      value={projectDescription}
                      onChange={(event) => setProjectDescription(event.currentTarget.value)}
                      placeholder="Mục tiêu hoặc phạm vi nghiên cứu"
                      maxLength={1000}
                      controlClassName={styles.projectDescription}
                    />
                    {createError && (
                      <p className={styles.error} role="alert">
                        {createError}
                      </p>
                    )}
                    <div className={styles.formFooter}>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={retry}
                        disabled={creatingProject}
                        leadingIcon={<RefreshCw size={15} />}
                      >
                        Tải lại danh sách
                      </Button>
                      <Button
                        className={styles.createButton}
                        variant="primary"
                        type="submit"
                        disabled={creatingProject || !projectName.trim()}
                        leadingIcon={
                          creatingProject ? <LoaderCircle className={styles.spinner} size={16} /> : undefined
                        }
                      >
                        {creatingProject ? 'Đang tạo project…' : 'Tạo project và mở PaperLab'}
                      </Button>
                    </div>
                  </form>
                </div>
              )}
              {!loading && !error && !!projects?.length && (
                <div className={styles.projectList} aria-label="Project ResearchHub của bạn">
                  <div className={styles.listHeading}>
                    <span>Project của bạn</span>
                  </div>
                  {projects.map((project) => (
                    <Button
                      key={project.id}
                      className={styles.project}
                      aria-label={`Mở project ${project.name}`}
                      onClick={() => choose(project)}
                    >
                      <span className={styles.projectIcon} aria-hidden="true">
                        <FolderKanban size={17} />
                      </span>
                      <span className={styles.projectText}>
                        <strong>{project.name}</strong>
                      </span>
                      <span className={styles.projectAction}>
                        <span>Mở project</span>
                        <ArrowRight size={16} aria-hidden="true" />
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
