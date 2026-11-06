import { IconFileInvoice } from '@tabler/icons-react';

import { FeaturePlaceholder } from '@/components/common/FeaturePlaceholder';

export function InvoicesPage() {
  return (
    <FeaturePlaceholder
      title="Invoices"
      description="Store and review your invoices."
      icon={IconFileInvoice}
    />
  );
}
