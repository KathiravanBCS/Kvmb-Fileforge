import { SimpleGrid, Stack, Text, TextInput } from '@mantine/core';

import type { CardDraft, CardDraftKey } from '../utils';

interface CardFormProps {
  draft: CardDraft;
  errors: Partial<Record<CardDraftKey, string>>;
  onChange: (key: CardDraftKey, value: string) => void;
  /** A card that was already saved or discarded can no longer be edited. */
  readOnly?: boolean;
}

/** The fields read from a card, editable. Empty means "not on the card". */
export function CardForm({ draft, errors, onChange, readOnly = false }: CardFormProps) {
  const field = (key: CardDraftKey, label: string, extra: { type?: string; autoComplete?: string } = {}) => (
    <TextInput
      label={label}
      value={draft[key]}
      error={errors[key]}
      readOnly={readOnly}
      onChange={(event) => onChange(key, event.currentTarget.value)}
      {...extra}
    />
  );

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {field('fullName', 'Full name')}
        {field('jobTitle', 'Job title')}
        {field('companyName', 'Company')}
        {field('department', 'Department')}
        {field('email', 'E-mail', { type: 'email' })}
        {field('mobile', 'Mobile', { type: 'tel' })}
      </SimpleGrid>
      {field('website', 'Website')}

      <Text size="sm" fw={600} mt="xs">
        Address
      </Text>
      {field('line1', 'Street')}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {field('city', 'City')}
        {field('state', 'State')}
        {field('postalCode', 'Postal code')}
        {field('country', 'Country')}
      </SimpleGrid>

      <Text size="sm" fw={600} mt="xs">
        Profiles
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {field('linkedin', 'LinkedIn')}
        {field('github', 'GitHub')}
      </SimpleGrid>
    </Stack>
  );
}
