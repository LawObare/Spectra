import React, { useState, useEffect, useMemo } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
} from '../components/GlobalCommandHeader';

/**
 * Spectra Tab 5: Observation Discussions & External Archive Cross-Match (<ObservationDiscussions />)
 * Specification Anchor: SPECIFICATION.md §3.3, §6.3.5; DESIGN.md
 * Role: E4 (role:E4-frontend)
 */

export interface DiscussionReply {
  id: string;
  authorHandle: string;
  isModerator: boolean;
  timestampIso: string;
  body: string;
}

export interface DiscussionThread {
  id: string;
  title: string;
  authorHandle: string;
  isModerator: boolean;
  timestampIso: string;
  classification: string;
  confidencePct: number;
  ra: number;
  dec: number;
  fovArcsec: number;
  renderMode: 'blink' | 'difference' | 'coadd';
  targetName: string;
  body: string;
  upvotes: number;
  replies: DiscussionReply[];
}

const CLASSIFICATION_CATEGORIES = [
  { id: 'moving_brown_dwarf', label: 'High-PM Substellar / Brown Dwarf' },
  { id: 'circumstellar_disk', label: 'Circumstellar Disk / Dipper Occultation' },
  { id: 'mira_agb_pulsator', label: 'AGB / Mira Long-Period Variable' },
  { id: 'interstellar_ice', label: 'Molecular Cloud 3.0–4.67 µm Ice Absorption' },
  { id: 'high_z_emission', label: 'Extragalactic Hα / [OIII] Line Emitter' },
  { id: 'solar_system_mover', label: 'Solar System Asteroid / NEOWISE Mover' },
  { id: 'instrumental_flag', label: 'Detector Persistence / Cosmic Ray Artifact' },
];

const INITIAL_THREADS: DiscussionThread[] = [
  {
    id: 'thr-wise0855-d5',
    title: 'WISE 0855-0714: Clean 8.15"/yr westward motion in Band D5 (4.12 µm) with expected D1–D3 dropout',
    authorHandle: 'Obs-7F3A',
    isModerator: false,
    timestampIso: '2026-11-04T08:14:00Z',
    classification: 'moving_brown_dwarf',
    confidencePct: 98,
    ra: 133.73712,
    dec: -7.24038,
    fovArcsec: 120,
    renderMode: 'difference',
    targetName: 'WISE 0855-0714',
    body: 'Wavelength-matched difference subtraction between Pass 1 (MJD 60810) and Pass 4 (MJD 61360) in Band D5 (R=110) isolates the dipole shift at Δα = -8.12"/yr, PA = 265°. Bands D1–D3 (<2.4 µm) show pure zodiacal background noise consistent with Teff ~ 250 K CH4/H2O atmospheric opacity.',
    upvotes: 14,
    replies: [
      {
        id: 'rep-1',
        authorHandle: 'SPHEREx-CalTeam',
        isModerator: true,
        timestampIso: '2026-11-04T08:42:00Z',
        body: 'Verified against QR2 astrometric solution. Note that Pass 3 had a 1.4° LVF roll offset; the pre-reprojection WCS-WAVE filter properly retained only exposures within the Δλ/λ <= 1/(2R) window.',
      },
    ],
  },
  {
    id: 'thr-m42-ice',
    title: 'Orion Trapezium (M42) sightline: Deep H2O (3.05 µm) and CO2 (4.27 µm) ice optical depth in D4/D5',
    authorHandle: 'Obs-C91E',
    isModerator: false,
    timestampIso: '2026-11-04T09:05:00Z',
    classification: 'interstellar_ice',
    confidencePct: 92,
    ra: 83.82208,
    dec: -5.39111,
    fovArcsec: 180,
    renderMode: 'coadd',
    targetName: 'Orion Nebula (M42 / Trapezium)',
    body: 'Extracted 102-channel spectrum on embedded protostellar point source 14" NE of Theta1 Ori C. Laboratory Gerakines (1995) A-value integration yields N(H2O) = 2.4e18 cm^-2 and N(CO2)/N(H2O) = 0.19.',
    upvotes: 9,
    replies: [],
  },
  {
    id: 'thr-rwaur-dim',
    title: 'RW Aurigae A: >1.6 mag continuum dimming in Band D1 (0.93 µm) with stable D4/D5 thermal dust excess',
    authorHandle: 'Obs-44B2',
    isModerator: false,
    timestampIso: '2026-11-04T10:19:00Z',
    classification: 'circumstellar_disk',
    confidencePct: 95,
    ra: 76.95647,
    dec: 30.4013,
    fovArcsec: 120,
    renderMode: 'blink',
    targetName: 'RW Aurigae',
    body: 'Stationary monopole centroid matches Gaia DR3 within 0.08 px. Forced 3x3 aperture photometry shows steep short-wavelength extinction event between MJD 60810 and MJD 61178 while 4.1 µm warm inner-disk emission remains constant.',
    upvotes: 11,
    replies: [],
  },
];

// Web Crypto API identity generator (satisfies DESIGN.md §6)
function ensureZeroAuthIdentity(): { observerId: string; observerKey: string; handle: string } {
  let obsId = localStorage.getItem('spx_observer_id');
  let obsKey = localStorage.getItem('spx_observer_key');

  if (!obsId && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    obsId = crypto.randomUUID();
    localStorage.setItem('spx_observer_id', obsId);
  } else if (!obsId) {
    obsId = '00000000-0000-4000-8000-000000007f3a';
    localStorage.setItem('spx_observer_id', obsId);
  }

  if (!obsKey && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    obsKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('spx_observer_key', obsKey);
  } else if (!obsKey) {
    obsKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    localStorage.setItem('spx_observer_key', obsKey);
  }

  const shortSuffix = obsId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return {
    observerId: obsId,
    observerKey: obsKey,
    handle: `Obs-${shortSuffix}`,
  };
}

export const ObservationDiscussions: React.FC = () => {
  const {
    ra,
    dec,
    fovArcsec,
    renderMode,
    activeTargetName,
    setCoordinates,
    setFov,
    setRenderMode,
  } = useTelemetryStore();

  const {
    setTab,
    setRa,
    setDec,
    setFov: setUrlFov,
    setMode: setUrlMode,
  } = useSpectraUrlState();

  const identity = useMemo(() => ensureZeroAuthIdentity(), []);

  const [threads, setThreads] = useState<DiscussionThread[]>(INITIAL_THREADS);
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'TARGET'>('ALL');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newBody, setNewBody] = useState<string>('');
  const [newClass, setNewClass] = useState<string>('moving_brown_dwarf');
  const [newConfidence, setNewConfidence] = useState<number>(90);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sseConnected, setSseConnected] = useState<boolean>(false);

  // Attempt non-blocking SSE connection to /api/forum/stream (Issue #23)
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/forum/stream');
      es.onopen = () => setSseConnected(true);
      es.onerror = () => {
        setSseConnected(false);
        es?.close();
      };
    } catch {
      setSseConnected(false);
    }
    return () => {
      es?.close();
    };
  }, []);

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (scopeFilter === 'TARGET') {
        const dist = Math.hypot(t.ra - ra, t.dec - dec);
        if (dist > 1.5) return false;
      }
      if (classFilter !== 'ALL' && t.classification !== classFilter) {
        return false;
      }
      return true;
    });
  }, [classFilter, dec, ra, scopeFilter, threads]);

  // Submit new observation thread (attaches X-Observer-ID and X-Observer-Key per SPECIFICATION.md §3.3)
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim()) return;

    const created: DiscussionThread = {
      id: `thr-${Date.now()}`,
      title: newTitle.trim(),
      authorHandle: identity.handle,
      isModerator: false,
      timestampIso: new Date().toISOString(),
      classification: newClass,
      confidencePct: newConfidence,
      ra,
      dec,
      fovArcsec,
      renderMode,
      targetName:
        activeTargetName ||
        `J2000 ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`,
      body: newBody.trim(),
      upvotes: 1,
      replies: [],
    };

    setThreads((prev) => [created, ...prev]);
    setNewTitle('');
    setNewBody('');

    try {
      await fetch('/api/forum/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify(created),
      });
    } catch {
      // Optimistic local state preserved when backend is offline
    }
  };

  const handleAddReply = (threadId: string) => {
    const text = (replyDrafts[threadId] || '').trim();
    if (!text) return;

    const reply: DiscussionReply = {
      id: `rep-${Date.now()}`,
      authorHandle: identity.handle,
      isModerator: false,
      timestampIso: new Date().toISOString(),
      body: text,
    };

    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, replies: [...t.replies, reply] } : t
      )
    );
    setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
  };

  // Restore exact sky coordinate & comparator state from a discussion post
  const handleRestorePinnedState = (
    t: DiscussionThread,
    destTab: 'navigator' | 'comparator'
  ) => {
    const matched = SEARCHABLE_SKY_CATALOG.find(
      (item) => Math.abs(item.ra - t.ra) < 0.05 && Math.abs(item.dec - t.dec) < 0.05
    );
    const isBench = matched && MANDATORY_BENCHMARKS.some((b) => b.id === matched.id);
    setCoordinates(
      t.ra,
      t.dec,
      t.targetName,
      isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]'
    );
    setRa(t.ra);
    setDec(t.dec);
    setFov(t.fovArcsec);
    setUrlFov(t.fovArcsec);
    setRenderMode(t.renderMode);
    setUrlMode(t.renderMode);
    setTab(destTab);
  };

  // External Archive Cross-Match URLs for Active Coordinate (ra, dec)
  const externalArchives = useMemo(
    () => [
      {
        name: 'NASA/IPAC IRSA SPHEREx Explorer',
        desc: 'Official IPAC Firefly spectral image & HiPS portal',
        url: `https://irsa.ipac.caltech.edu/applications/spherex/search-spectral-images`,
      },
      {
        name: 'CDS SIMBAD Astronomical Database',
        desc: `2' cone search around ${ra.toFixed(4)}°, ${dec.toFixed(4)}°`,
        url: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${encodeURIComponent(
          `${ra} ${dec >= 0 ? '+' : ''}${dec}`
        )}&Radius=2&Radius.unit=arcmin`,
      },
      {
        name: 'VizieR Gaia DR3 Astrometry (I/355)',
        desc: 'Parallax, proper motion (pmRA, pmDE), and G/BP/RP photometry',
        url: `https://vizier.cds.unistra.fr/viz-bin/VizieR-4?-source=I/355/gaiadr3&-c=${encodeURIComponent(
          `${ra} ${dec >= 0 ? '+' : ''}${dec}`
        )}&-c.rs=60`,
      },
      {
        name: 'IRSA ZTF / WISE Time-Domain Archive',
        desc: 'Optical & mid-infrared historical light curves',
        url: `https://irsa.ipac.caltech.edu/irsaviewer/?__action=layout.showDropDown&view=HiPSList`,
      },
      {
        name: 'IAU Transient Name Server (TNS)',
        desc: 'Supernovae, tidal disruption events, and fast transients',
        url: `https://www.wis-tns.org/search?&ra=${ra.toFixed(5)}&decl=${dec.toFixed(
          5
        )}&radius=120&coords_unit=arcsec`,
      },
    ],
    [dec, ra]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#080A0F] font-sans text-xs text-[#E6ECF2]">
      {/* LEFT 32%: External Archive Cross-Match & Zero-Auth Telemetry Session Panel */}
      <aside className="flex w-[360px] xl:w-[400px] shrink-0 flex-col border-r border-[#1E2530] bg-[#0F131A] overflow-y-auto p-4 gap-4">
        {/* Active Coordinate Cross-Match Header */}
        <div className="rounded-sm border border-[#1E2530] bg-[#080A0F] p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#E6ECF2]">
              Active Sky Field Cross-Match
            </span>
            <span className="rounded-sm border border-[#1E2530] bg-[#151B24] px-1.5 py-0.5 font-mono text-[10px] text-[#38BDF8]">
              Community Product
            </span>
          </div>
          <div className="mt-1.5 font-medium text-[#E6ECF2]">
            {activeTargetName || 'Selected Field'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#38BDF8]">
            J2000 RA {ra.toFixed(5)}° · Dec {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}° · FoV {fovArcsec}&quot;
          </div>
        </div>

        {/* External Astronomical Archive Links */}
        <div>
          <h3 className="mb-2 text-xs font-semibold text-[#E6ECF2]">
            External Archive Cross-Match Verification
          </h3>
          <div className="flex flex-col gap-1.5">
            {externalArchives.map((arch) => (
              <a
                key={arch.name}
                href={arch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col rounded-sm border border-[#1E2530] bg-[#080A0F] p-2.5 transition-colors duration-150 hover:border-[#38BDF8]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#E6ECF2] group-hover:text-[#38BDF8]">
                    {arch.name}
                  </span>
                  <span className="font-mono text-[10px] text-[#94A3B8]">↗</span>
                </div>
                <span className="mt-0.5 text-[11px] text-[#94A3B8]">{arch.desc}</span>
              </a>
            ))}
          </div>
        </div>

        {/* Zero-Auth Telemetry Session Info */}
        <div className="mt-auto rounded-sm border border-[#1E2530] bg-[#080A0F] p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#E6ECF2]">Observer Telemetry Session</span>
            <span className="font-mono text-[10px] text-[#22C55E]">
              {sseConnected ? 'SSE Live' : 'Local Sync'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#94A3B8]">
            Handle: <strong className="font-mono text-[#E6ECF2]">{identity.handle}</strong> (Zero-Auth UUIDv4 + SHA-256 key)
          </div>
        </div>
      </aside>

      {/* RIGHT 68%: Observation Note Composer & Threaded Candidate Feed */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2530] bg-[#0F131A] px-4 py-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setScopeFilter('ALL')}
              className={`rounded-sm border px-2.5 py-1 text-xs ${
                scopeFilter === 'ALL'
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
            >
              All Sky Observations ({threads.length})
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('TARGET')}
              className={`rounded-sm border px-2.5 py-1 text-xs ${
                scopeFilter === 'TARGET'
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
            >
              Near {ra.toFixed(2)}°, {dec.toFixed(2)}° (r ≤ 1.5°)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="forum-class-filter" className="text-[11px] text-[#94A3B8]">
              Classification:
            </label>
            <select
              id="forum-class-filter"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="rounded-sm border border-[#1E2530] bg-[#080A0F] px-2 py-1 text-xs text-[#E6ECF2] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              <option value="ALL">All Classifications</option>
              {CLASSIFICATION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* New Observation Note Composer */}
          <form
            onSubmit={handleCreateThread}
            className="rounded-sm border border-[#1E2530] bg-[#0F131A] p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1E2530]">
              <span className="font-semibold text-[#E6ECF2]">
                Log Observation Note & Pin Current Sky State
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[#38BDF8]">
                Pinned: {activeTargetName || 'Field'} ({ra.toFixed(4)}°, {dec.toFixed(4)}° · {fovArcsec}&quot; · {renderMode})
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-12 gap-2">
              <div className="col-span-12 md:col-span-6">
                <label htmlFor="obs-title" className="block text-[11px] text-[#94A3B8]">
                  Observation Summary
                </label>
                <input
                  id="obs-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Dipole shift in D5 at MJD 61360 or H2O 3.05 µm absorption..."
                  className="mt-1 w-full rounded-sm border border-[#1E2530] bg-[#080A0F] px-2.5 py-1.5 text-xs text-[#E6ECF2] placeholder-[#94A3B8] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                />
              </div>
              <div className="col-span-8 md:col-span-4">
                <label htmlFor="obs-class" className="block text-[11px] text-[#94A3B8]">
                  Candidate Classification
                </label>
                <select
                  id="obs-class"
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-[#1E2530] bg-[#080A0F] px-2 py-1.5 text-xs text-[#E6ECF2] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                >
                  {CLASSIFICATION_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-4 md:col-span-2">
                <label htmlFor="obs-conf" className="block text-[11px] text-[#94A3B8]">
                  Confidence ({newConfidence}%)
                </label>
                <input
                  id="obs-conf"
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={newConfidence}
                  onChange={(e) => setNewConfidence(Number(e.target.value))}
                  className="mt-2.5 w-full accent-[#38BDF8]"
                />
              </div>
            </div>

            <div className="mt-2">
              <label htmlFor="obs-body" className="sr-only">
                Detailed astrophysical notes, MJD pass numbers, and band metrics
              </label>
              <textarea
                id="obs-body"
                rows={2}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Record MJD passes, detector bands (D1–D6), proper motion vectors, or optical depth metrics..."
                className="w-full rounded-sm border border-[#1E2530] bg-[#080A0F] p-2.5 text-xs text-[#E6ECF2] placeholder-[#94A3B8] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              />
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-[#94A3B8]">
                Posting as <strong className="font-mono text-[#E6ECF2]">{identity.handle}</strong> · Community Product
              </span>
              <button
                type="submit"
                className="rounded-sm border border-[#38BDF8] bg-[#151B24] px-3 py-1.5 text-xs font-medium text-[#E6ECF2] hover:bg-[#38BDF8]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              >
                Publish Observation Note
              </button>
            </div>
          </form>

          {/* Threaded Observations List */}
          <div className="space-y-3">
            {filteredThreads.map((t) => {
              const catLabel =
                CLASSIFICATION_CATEGORIES.find((c) => c.id === t.classification)?.label ||
                t.classification;
              return (
                <article
                  key={t.id}
                  className="rounded-sm border border-[#1E2530] bg-[#0F131A] p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-semibold text-[#E6ECF2]">{t.title}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#94A3B8]">
                        <span className="font-mono text-[#E6ECF2]">{t.authorHandle}</span>
                        {t.isModerator && (
                          <span className="rounded-sm border border-[#F59E0B] bg-[#151B24] px-1.5 py-0.2 font-mono text-[10px] text-[#F59E0B]">
                            [Moderator]
                          </span>
                        )}
                        <span>·</span>
                        <span className="rounded-sm border border-[#1E2530] bg-[#080A0F] px-1.5 py-0.2 text-[10px] text-[#38BDF8]">
                          {catLabel} ({t.confidencePct}%)
                        </span>
                        <span>·</span>
                        <span className="font-mono text-[10px]">
                          {t.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                        </span>
                      </div>
                    </div>

                    {/* Pinned State Jump Controls */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRestorePinnedState(t, 'navigator')}
                        className="rounded-sm border border-[#1E2530] bg-[#080A0F] px-2 py-1 font-mono text-[10px] tabular-nums text-[#E6ECF2] hover:border-[#38BDF8]"
                        title="Center sky mosaic on this observation's coordinates"
                      >
                        Sky Map ({t.ra.toFixed(2)}°, {t.dec.toFixed(2)}°)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRestorePinnedState(t, 'comparator')}
                        className="rounded-sm border border-[#38BDF8] bg-[#151B24] px-2 py-1 text-[10px] font-medium text-[#E6ECF2] hover:bg-[#38BDF8]/20"
                        title="Open this target and render mode in Tab 2 Comparator"
                      >
                        Inspect in Comparator →
                      </button>
                    </div>
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed text-[#E6ECF2]/90">
                    {t.body}
                  </p>

                  {/* Replies */}
                  {t.replies.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-[#1E2530] pt-2.5 pl-3">
                      {t.replies.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-sm border border-[#1E2530] bg-[#080A0F] p-2 text-xs"
                        >
                          <div className="flex items-center gap-2 text-[10px] text-[#94A3B8]">
                            <span className="font-mono font-medium text-[#E6ECF2]">
                              {r.authorHandle}
                            </span>
                            {r.isModerator && (
                              <span className="rounded-sm border border-[#F59E0B] bg-[#151B24] px-1 py-0.2 font-mono text-[9px] text-[#F59E0B]">
                                [Moderator]
                              </span>
                            )}
                            <span>·</span>
                            <span className="font-mono">
                              {r.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#E6ECF2]">{r.body}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick Reply Input */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      type="text"
                      value={replyDrafts[t.id] || ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                      }
                      placeholder="Add verification reply or ephemeris cross-match note..."
                      className="flex-1 rounded-sm border border-[#1E2530] bg-[#080A0F] px-2.5 py-1 text-xs text-[#E6ECF2] placeholder-[#94A3B8] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddReply(t.id)}
                      className="rounded-sm border border-[#1E2530] bg-[#151B24] px-2.5 py-1 text-xs text-[#E6ECF2] hover:border-[#38BDF8]"
                    >
                      Reply
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
