import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const RELOAD_GUARD_KEY = 'spx_chunk_reload_at';

function reloadOnceForStaleBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0');
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Ignore storage access failures
  }
  window.location.reload();
  return true;
}

// Automatically recover when a new deployment replaces lazy chunk hashes while a tab is open
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadOnceForStaleBuild();
});

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected UI error' };
  }

  componentDidCatch(error: Error) {
    const msg = error?.message || '';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('Loading chunk')
    ) {
      reloadOnceForStaleBuild();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center text-white">
          <div className="max-w-md space-y-3 rounded-2xl border border-white/15 bg-neutral-950 p-6">
            <h1 className="text-base font-semibold">Spectra Updated</h1>
            <p className="text-xs text-neutral-400">
              A newer version of Spectra was deployed while this tab was open. Reload to load the latest view.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-400 cursor-pointer"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
