import React from 'react';
import { AppShell } from './layout/AppShell';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './auth/AuthGate';

export const App: React.FC = () => {
  const isE2EHarnessPath =
    typeof window !== 'undefined' && window.location.pathname === '/analytics/test/ads-columns';

  return (
    <BrowserRouter>
      <AuthProvider>
        {isE2EHarnessPath ? (
          <AppShell />
        ) : (
          <AuthGate>
            <AppShell />
          </AuthGate>
        )}
      </AuthProvider>
    </BrowserRouter>
  );
};

