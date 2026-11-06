import { IconLayoutDashboard } from '@tabler/icons-react';

import { FeaturePlaceholder } from '@/components/common/FeaturePlaceholder';

export function DashboardPage() {
  return (
    <FeaturePlaceholder
      title="Dashboard"
      description="An overview of your documents, scans and recent activity."
      icon={IconLayoutDashboard}
    />
  );
}
