import { Image, Skeleton } from '@mantine/core';

import { useObjectUrl } from '@/features/central-storage/hooks/useObjectUrl';

interface PhotoThumbProps {
  file: File;
  alt: string;
  height?: number;
}

/** A small preview of a photo that has not been uploaded yet (it only ever exists in this browser). */
export function PhotoThumb({ file, alt, height = 72 }: PhotoThumbProps) {
  const url = useObjectUrl(file);
  return url ? (
    <Image src={url} alt={alt} h={height} w="auto" fit="contain" radius="sm" style={{ border: '1px solid var(--mantine-color-default-border)' }} />
  ) : (
    <Skeleton h={height} w={height * 1.6} radius="sm" />
  );
}
