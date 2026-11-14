import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 30, // 30 min cache for cutouts
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <BrowserRouter>
          <div className="min-h-screen bg-space-950 text-white font-mono flex flex-col">
            {/* Header placeholder */}
            <header className="h-14 border-b border-space-800 px-4 flex items-center justify-between bg-space-900">
              <div className="flex items-center space-x-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-telemetry-cyan animate-pulse"></span>
                <span className="font-bold tracking-wider text-telemetry-cyan">SPECTRA // MISSION CONTROL</span>
                <span className="text-xs px-2 py-0.5 rounded bg-space-800 text-gray-300">NASA SPHEREx</span>
              </div>
              <div className="text-xs text-gray-400">
                PORT: <span className="text-telemetry-cyan">7860</span> | ENGINE: <span className="text-telemetry-green">FASTAPI UVLOOP</span>
              </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 p-6">
              <Routes>
                <Route
                  path="/explore"
                  element={
                    <div className="border border-space-800 bg-space-900/60 p-6 rounded-lg max-w-4xl mx-auto mt-12">
                      <h2 className="text-xl font-bold text-telemetry-cyan mb-3">SPHEREx Exploration Suite Initialized</h2>
                      <p className="text-sm text-gray-300 mb-4">
                        Zero-copy Float32 multi-epoch time-domain and hyperspectral processing engine.
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        <div className="p-3 border border-space-800 rounded bg-space-950">
                          <div className="text-xs text-gray-400">TARGET RESOLVER</div>
                          <div className="text-sm text-telemetry-cyan font-bold mt-1">SIAv2 & Sesame</div>
                        </div>
                        <div className="p-3 border border-space-800 rounded bg-space-950">
                          <div className="text-xs text-gray-400">PIPELINE</div>
                          <div className="text-sm text-telemetry-cyan font-bold mt-1">HDU 1–6 Reproject</div>
                        </div>
                        <div className="p-3 border border-space-800 rounded bg-space-950">
                          <div className="text-xs text-gray-400">GPU RENDER</div>
                          <div className="text-sm text-telemetry-cyan font-bold mt-1">WebGL2 Float32</div>
                        </div>
                        <div className="p-3 border border-space-800 rounded bg-space-950">
                          <div className="text-xs text-gray-400">AUTH IDENTITY</div>
                          <div className="text-sm text-telemetry-cyan font-bold mt-1">Zero-Auth Observer</div>
                        </div>
                      </div>
                    </div>
                  }
                />
                <Route path="/" element={<Navigate to="/explore" replace />} />
                <Route
                  path="*"
                  element={
                    <div className="text-center mt-20 text-gray-400">
                      <p className="text-lg">404 // ROUTE NOT FOUND</p>
                    </div>
                  }
                />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </NuqsAdapter>
    </QueryClientProvider>
  );
};

export default App;
