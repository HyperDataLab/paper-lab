import { projectHeader } from '@/shared/scope';
import { guardPaperSize } from '@/shared/paper/sizeGuard';
import { PDF_WORKER_URL, projectScopedUrl } from './index';

type WorkerError = { message?: unknown };

/** Downloads an OpenAlex-listed OA copy through the authenticated PaperLab worker to avoid publisher CORS. */
export async function downloadOpenAlexPdf(
  doi: string,
  pdfUrl: string,
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(projectScopedUrl(`${PDF_WORKER_URL}/v1/pdfs/openalex`, projectId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...projectHeader(projectId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ doi, pdfUrl }),
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(
      'Không kết nối được Worker tải PDF của PaperLab. Kiểm tra mạng hoặc bản Worker đã được cập nhật.',
      { cause },
    );
  }

  if (!response.ok) {
    let message = `Worker tải PDF trả lỗi HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as WorkerError;
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Keep the status message when the worker did not return JSON.
    }
    throw new Error(message);
  }

  const data = await response.arrayBuffer();
  guardPaperSize(data.byteLength);
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-')
    throw new Error('Worker tải về dữ liệu không phải PDF.');
  return data;
}
