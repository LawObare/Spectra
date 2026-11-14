import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';

/**
 * Spectra Root Application Component
 * Specification Anchor: SPECIFICATION.md §6.1.1
 * Enforces Zero-Auth Route Isolation between /explore/* and /admin/*
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 30, // 30 minutes cache for astronomy cutouts
      refetchOnWindowFocus: false,
    },
  },
});

// Lazy-loaded route chunks (Zero-Auth Route Isolation)
const PublicExplorerPortal = lazy(async () => ({
  default: () => (
    <div className="flex min-h-screen items-center justify-center bg-[#090C10] font-mono text-[#00F0FF]">
      INITIALIZING SPECTRA EXPLORER PORTAL...
    </div>
  ),
}));

const AdminMissionControl = lazy(async () => ({
  default: () => (
    <div className="flex min-h-screen items-center justify-center bg-[#090C10] font-mono text-amber-400">
      INITIALIZING SPECTRA ADMIN MISSION CONTROL...
    </div>
  ),
}));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="flex min-h-screen items-center justify-center bg-[#090C10] font-mono text-[#00F0FF]">
                INITIALIZING SPECTRA WORKBENCH...
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate to="/explore" replace />} />
              <Route path="/explore/*" element={<PublicExplorerPortal />} />
              {/* Zero-Auth Route-Isolated Admin Suite (No blocking login screens) */}
              <Route path="/admin/*" element={<AdminMissionControl />} />
              <Route path="*" element={<Navigate to="/explore" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
