import { z } from 'zod';

import { ApiProperty } from '@nestjs/swagger';

/** Body of PATCH /files. Validated with Zod (the class below only documents it for Swagger). */
export const renameFileSchema = z.object({
  path: z.string().min(1).max(400),
  newName: z.string().min(1).max(255),
});

export class RenameFileDto {
  @ApiProperty({
    example: 'invoices/2026/draft.pdf',
    description: 'Path of the file, relative to the FileForge folder.',
  })
  path: string;

  @ApiProperty({ example: 'final.pdf', description: 'New file name (same folder).' })
  newName: string;
}

export class OneDriveItemDto {
  @ApiProperty({ example: 'invoice-001.pdf' })
  name: string;

  @ApiProperty({ enum: ['file', 'folder'] })
  type: 'file' | 'folder';

  @ApiProperty({ example: 20480, description: 'Bytes (0 for folders).' })
  size: number;

  @ApiProperty({ type: String, nullable: true, example: 'application/pdf' })
  mimeType: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-11-04T12:00:00Z' })
  modifiedAt: string | null;

  @ApiProperty({ example: 'invoices/invoice-001.pdf', description: 'Relative to the FileForge folder.' })
  path: string;
}

export class OneDriveListingDto {
  @ApiProperty({ example: 'invoices', description: 'The folder that was listed ("" is the FileForge root).' })
  path: string;

  @ApiProperty({ type: [OneDriveItemDto] })
  items: OneDriveItemDto[];

  @ApiProperty({ description: 'True when the folder holds more items than were returned (1000).' })
  truncated: boolean;
}

export class ConnectionSummaryDto {
  @ApiProperty({ example: '1', description: 'BIGINT as a decimal string.' })
  id: string;

  @ApiProperty({ example: 'OneDrive' })
  name: string;

  @ApiProperty({ type: String, nullable: true, example: 'FileForge' })
  rootFolderPath: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastAuthAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastVerifiedAt: string | null;
}

export class OneDriveStatusDto {
  @ApiProperty({
    enum: ['not_connected', 'connected', 'consent_required', 'reauth_required', 'owned_by_other_user', 'error'],
  })
  status: string;

  @ApiProperty({ type: ConnectionSummaryDto, nullable: true })
  connection: ConnectionSummaryDto | null;
}

export class ConnectUrlDto {
  @ApiProperty({ description: 'Send the browser here to grant OneDrive access on Microsoft.' })
  url: string;
}
