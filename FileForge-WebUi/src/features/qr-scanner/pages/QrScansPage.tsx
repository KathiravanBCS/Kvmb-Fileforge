import { IconQrcode } from '@tabler/icons-react';

import { FeaturePlaceholder } from '@/components/common/FeaturePlaceholder';

export function QrScansPage() {
  return (
    <FeaturePlaceholder
      title="QR Code Scanner"
      description="Scan QR codes and review your scan history."
      icon={IconQrcode}
    />
  );
}
