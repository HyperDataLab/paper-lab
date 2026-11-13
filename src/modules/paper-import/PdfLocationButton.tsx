import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/Button';

export function PdfLocationButton({
  page,
  onClick,
  children,
  className,
}: {
  page: number | null | undefined;
  onClick: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      title="Mở trong PDF"
      aria-label={page ? `Mở trang ${page} trong PDF` : 'Mở đoạn gốc trong PDF'}
      onClick={onClick}
    >
      {children ?? (page ? `Tr. ${page}` : 'Đoạn gốc')} <ArrowUpRight size={12} aria-hidden="true" />
    </Button>
  );
}
