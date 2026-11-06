import {
  IconAddressBook,
  IconChartBar,
  IconDatabaseCog,
  IconFileInvoice,
  IconFiles,
  IconFirstAidKit,
  IconFileTypePdf,
  IconFolders,
  IconId,
  IconLayoutDashboard,
  IconMail,
  IconPlugConnected,
  IconQrcode,
  IconReceipt,
  IconSettings,
  type Icon,
} from '@tabler/icons-react';
import type { LazyRouteFunction, RouteObject } from 'react-router-dom';

import type { AppAbility, AppAction, AppSubject } from '@/lib/casl/ability';

export interface NavItem {
  path: string;
  label: string;
  icon: Icon;
  lazy: LazyRouteFunction<RouteObject>;
  /** Shown in the sidebar only when the user's ability allows this (UX only: the API enforces it, and pages re-check). */
  requires?: { action: AppAction; subject: AppSubject };
  /** Sidebar group this entry lives under (see NAV_GROUPS). Entries without one are top-level. */
  group?: NavGroupId;
}

export type NavGroupId = 'files' | 'storage-admin';

/** Sidebar groups: related pages share one collapsible entry, so the menu stays short as features are added. */
export const NAV_GROUPS: Record<NavGroupId, { label: string; icon: Icon }> = {
  files: { label: 'Files', icon: IconFolders },
  'storage-admin': { label: 'Storage Admin', icon: IconDatabaseCog },
};

// Single source of truth for the sidebar, breadcrumbs and the lazily loaded feature routes.
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    icon: IconLayoutDashboard,
    lazy: async () => ({ Component: (await import('@/features/dashboard/pages/DashboardPage')).DashboardPage }),
  },
  {
    path: '/business-cards',
    label: 'Business Card Scanner',
    icon: IconId,
    lazy: async () => ({
      Component: (await import('@/features/business-cards/pages/BusinessCardsPage')).BusinessCardsPage,
    }),
  },
  {
    path: '/pdf-documents',
    label: 'PDF Processing',
    icon: IconFileTypePdf,
    lazy: async () => ({
      Component: (await import('@/features/pdf-processing/pages/PdfDocumentsPage')).PdfDocumentsPage,
    }),
  },
  {
    path: '/qr-scans',
    label: 'QR Code Scanner',
    icon: IconQrcode,
    lazy: async () => ({ Component: (await import('@/features/qr-scanner/pages/QrScansPage')).QrScansPage }),
  },
  {
    path: '/contacts',
    label: 'Contacts',
    icon: IconAddressBook,
    lazy: async () => ({ Component: (await import('@/features/contacts/pages/ContactsPage')).ContactsPage }),
  },
  {
    path: '/invoices',
    label: 'Invoices',
    icon: IconFileInvoice,
    lazy: async () => ({ Component: (await import('@/features/invoices/pages/InvoicesPage')).InvoicesPage }),
  },
  {
    path: '/receipts',
    label: 'Receipts',
    icon: IconReceipt,
    lazy: async () => ({ Component: (await import('@/features/receipts/pages/ReceiptsPage')).ReceiptsPage }),
  },
  {
    path: '/reports',
    label: 'Report Studio',
    icon: IconChartBar,
    lazy: async () => ({ Component: (await import('@/features/report-studio/pages/ReportsPage')).ReportsPage }),
  },
  {
    path: '/email',
    label: 'Email',
    icon: IconMail,
    lazy: async () => ({ Component: (await import('@/features/email/pages/EmailPage')).EmailPage }),
  },
  {
    path: '/files',
    label: 'File Manager',
    icon: IconFolders,
    group: 'files',
    lazy: async () => ({ Component: (await import('@/features/file-manager/pages/FilesPage')).FilesPage }),
  },
  {
    path: '/my-files',
    label: 'My Files',
    icon: IconFiles,
    group: 'files',
    requires: { action: 'read', subject: 'CentralStorageFile' },
    lazy: async () => ({ Component: (await import('@/features/central-storage/pages/MyFilesPage')).MyFilesPage }),
  },
  {
    path: '/admin/storage',
    label: 'Admin Storage',
    icon: IconDatabaseCog,
    group: 'storage-admin',
    requires: { action: 'manage', subject: 'CentralStorageAdministration' },
    lazy: async () => ({
      Component: (await import('@/features/central-storage/pages/AdminStoragePage')).AdminStoragePage,
    }),
  },
  {
    path: '/admin/storage/settings',
    label: 'Storage Settings',
    icon: IconPlugConnected,
    group: 'storage-admin',
    requires: { action: 'manage', subject: 'CentralStorageAdministration' },
    lazy: async () => ({
      Component: (await import('@/features/central-storage/pages/CentralStorageSettingsPage')).CentralStorageSettingsPage,
    }),
  },
  {
    path: '/admin/storage/recovery',
    label: 'Storage Recovery',
    icon: IconFirstAidKit,
    group: 'storage-admin',
    requires: { action: 'manage', subject: 'CentralStorageAdministration' },
    lazy: async () => ({
      Component: (await import('@/features/central-storage/pages/StorageRecoveryPage')).StorageRecoveryPage,
    }),
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: IconSettings,
    lazy: async () => ({ Component: (await import('@/features/settings/pages/SettingsPage')).SettingsPage }),
  },
];

/** The item whose path best matches (the longest), so `/admin/storage/settings` is not mistaken for `/admin/storage`. */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((item) => pathname === item.path || pathname.startsWith(`${item.path}/`)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
}

/** The sidebar entries this user may see. Items without `requires` are always shown. */
export function visibleNavItems(ability: AppAbility, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => !item.requires || ability.can(item.requires.action, item.requires.subject));
}

export type SidebarEntry =
  | { kind: 'item'; item: NavItem }
  | { kind: 'group'; id: NavGroupId; label: string; icon: Icon; items: NavItem[] };

/**
 * The sidebar's shape: top-level entries and groups, in the order of NAV_ITEMS (a group sits where its first visible member is).
 * A group none of whose members is visible does not appear at all (an ordinary user never sees "Storage Admin").
 */
export function groupNavItems(items: readonly NavItem[]): SidebarEntry[] {
  const entries: SidebarEntry[] = [];
  const groups = new Map<NavGroupId, Extract<SidebarEntry, { kind: 'group' }>>();
  for (const item of items) {
    if (!item.group) {
      entries.push({ kind: 'item', item });
      continue;
    }
    let group = groups.get(item.group);
    if (!group) {
      group = { kind: 'group', id: item.group, ...NAV_GROUPS[item.group], items: [] };
      groups.set(item.group, group);
      entries.push(group);
    }
    group.items.push(item);
  }
  return entries;
}
