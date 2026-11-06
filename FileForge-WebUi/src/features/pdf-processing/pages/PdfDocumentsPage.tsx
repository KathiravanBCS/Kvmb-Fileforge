import { IconFileTypePdf } from '@tabler/icons-react';

import { FeaturePlaceholder } from '@/components/common/FeaturePlaceholder';

export function PdfDocumentsPage() {
  return (
    <FeaturePlaceholder
      title="PDF Processing"
      description="Work with PDF documents."
      icon={IconFileTypePdf}
    />
  );
}
