import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/config/env'; // fail fast on invalid environment configuration
import { AppProviders } from '@/app/providers/AppProviders';
import { App } from '@/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
