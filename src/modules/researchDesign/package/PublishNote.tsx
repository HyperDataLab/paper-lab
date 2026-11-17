import type { PublishOutcome } from './usePlanPublisher';

export function PublishNote({ note }: { note: PublishOutcome }) {
  return (
    <>
      <p role={note.ok ? 'status' : 'alert'}>{note.text}</p>
      {note.detail && (
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          <p>{note.detail}</p>
        </details>
      )}
    </>
  );
}
