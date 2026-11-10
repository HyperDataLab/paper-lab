import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './FeatureCard.module.css';

interface FeatureCardProps {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export function FeatureCard({ to, icon: Icon, title, description }: FeatureCardProps) {
  return (
    <Link to={to} className={styles.card}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className={styles.content}>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <ArrowRight className={styles.arrow} size={16} aria-hidden="true" />
    </Link>
  );
}
