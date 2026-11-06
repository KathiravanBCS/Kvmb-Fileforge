import { IconAddressBook } from '@tabler/icons-react';

import { FeaturePlaceholder } from '@/components/common/FeaturePlaceholder';

export function ContactsPage() {
  return (
    <FeaturePlaceholder
      title="Contacts"
      description="Browse and manage the contacts you have collected."
      icon={IconAddressBook}
    />
  );
}
