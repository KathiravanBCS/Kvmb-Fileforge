import { formatBytes } from '../utils';
import { StatCard } from './StatCard';

interface StorageUsageCardProps {
  label: string;
  fileCount: number | undefined;
  totalBytes: number | undefined;
  loading: boolean;
  error?: boolean;
}

/** How much storage is in use: the size, and the number of files behind it. */
export function StorageUsageCard({ label, fileCount, totalBytes, loading, error = false }: StorageUsageCardProps) {
  const known = totalBytes !== undefined && fileCount !== undefined;
  return (
    <StatCard
      label={label}
      value={known ? formatBytes(totalBytes) : undefined}
      hint={known ? (fileCount === 1 ? '1 file' : `${fileCount.toLocaleString()} files`) : undefined}
      loading={loading}
      error={error}
    />
  );
}
