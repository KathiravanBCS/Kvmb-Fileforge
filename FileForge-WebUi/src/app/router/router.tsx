import { Navigate, createBrowserRouter } from 'react-router-dom';

import { FullPageLoader } from '@/components/feedback/FullPageLoader';
import { NotFoundPage } from '@/components/feedback/NotFoundPage';
import { RouteError } from '@/components/feedback/RouteError';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { NAV_ITEMS } from './navigation';
import { HOME_PATH } from './paths';

export const router = createBrowserRouter([
  {
    element: <ProtectedRoute />,
    errorElement: <RouteError />,
    HydrateFallback: FullPageLoader,
    children: [
      {
        element: <AppShell />,
        children: [
          // Pathless route so a failing page renders its error inside the shell, not instead of it.
          {
            errorElement: <RouteError />,
            children: [
              { index: true, element: <Navigate to={HOME_PATH} replace /> },
              ...NAV_ITEMS.map(({ path, lazy }) => ({ path, lazy })),
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
