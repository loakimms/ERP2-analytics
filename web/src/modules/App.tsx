import React from 'react';
import { AppShell } from './layout/AppShell';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './auth/AuthGate';

const CHUNK_RELOAD_FLAG = 'analytics:chunk-load-reload-v1';
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(error: unknown): boolean {
  const text = String((error as any)?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(text);
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: unknown | null }> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    if (isChunkLoadError(error) && typeof window !== 'undefined') {
      try {
        const lastReloadedAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_FLAG) || '0');
        if (!lastReloadedAt || Date.now() - lastReloadedAt > CHUNK_RELOAD_COOLDOWN_MS) {
          window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        window.location.reload();
        return;
      }
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const message = isChunkLoadError(this.state.error)
      ? '화면 파일이 갱신되었습니다. 새로고침 후 다시 시도하세요.'
      : '화면을 표시하는 중 오류가 발생했습니다.';
    return (
      <div style={{ minHeight: '100vh', padding: 24, background: '#020617', color: '#e5e7eb' }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 18 }}>{message}</h1>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#111827', color: '#e5e7eb' }}
        >
          새로고침
        </button>
      </div>
    );
  }
}

export const App: React.FC = () => {
  const isE2EHarnessPath =
    typeof window !== 'undefined' && window.location.pathname === '/analytics/test/ads-columns';

  React.useEffect(() => {
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      try {
        const lastReloadedAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_FLAG) || '0');
        if (lastReloadedAt && Date.now() - lastReloadedAt <= CHUNK_RELOAD_COOLDOWN_MS) return;
        window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
      } catch {
        // continue with reload
      }
      window.location.reload();
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppErrorBoundary>
          {isE2EHarnessPath ? (
            <AppShell />
          ) : (
            <AuthGate>
              <AppShell />
            </AuthGate>
          )}
        </AppErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
};

