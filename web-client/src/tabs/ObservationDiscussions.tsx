import React, { useMemo, useRef, useState } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { useRealtimeDiscussions } from '../hooks/useRealtimeDiscussions';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
} from '../components/GlobalCommandHeader';
import { Badge, Button, Input } from '../components/ui';

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
  hashtags?: string[];
  classVotes?: Partial<Record<ClassVoteKey, number>>;
}

type ClassVoteKey = 'V_mover' | 'V_var' | 'V_ice' | 'V_artifact';

interface ClassificationShortcut {
  id: string;
  label: string;
  classification: string;
  hashtag: string;
  voteKey: ClassVoteKey;
  channel: string;
}

const CLASSIFICATION_CATEGORIES = [
  { id: 'moving_brown_dwarf', label: 'High-PM Substellar / Brown Dwarf' },
  { id: 'variable_star', label: 'Flashing Variable' },
  { id: 'circumstellar_disk', label: 'Circumstellar Disk / Dipper Occultation' },
  { id: 'mira_agb_pulsator', label: 'AGB / Mira Long-Period Variable' },
  { id: 'interstellar_ice', label: 'Molecular Cloud 3.0–4.67 µm Ice Absorption' },
  { id: 'high_z_emission', label: 'Extragalactic Hα / [OIII] Line Emitter' },
  { id: 'solar_system_mover', label: 'Solar System Asteroid / NEOWISE Mover' },
  { id: 'optical_blend_artifact', label: 'Optical Blend / Artifact' },
  { id: 'instrumental_flag', label: 'Detector Persistence / Cosmic Ray Artifact' },
];

const CLASSIFICATION_SHORTCUTS: ClassificationShortcut[] = [
  {
    id: 'mover',
    label: '[+ Dipole/Mover]',
    classification: 'moving_brown_dwarf',
    hashtag: '#mover',
    voteKey: 'V_mover',
    channel: 'movers',
  },
  {
    id: 'variable',
    label: '[+ Flashing Variable]',
    classification: 'variable_star',
    hashtag: '#variable',
    voteKey: 'V_var',
    channel: 'discoveries',
  },
  {
    id: 'ice_source',
    label: '[+ Interstellar Ice]',
    classification: 'interstellar_ice',
    hashtag: '#ice_source',
    voteKey: 'V_ice',
    channel: 'ices',
  },
  {
    id: 'blend_artifact',
    label: '[+ Optical Blend/Artifact]',
    classification: 'optical_blend_artifact',
    hashtag: '#blend_artifact',
    voteKey: 'V_artifact',
    channel: 'artifacts',
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

  const { threads, setThreads, sseConnected, isLoading, loadError } =
    useRealtimeDiscussions<DiscussionThread>([]);
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'TARGET' | 'VERIFIED'>('ALL');
  const [feedSort, setFeedSort] = useState<'latest' | 'top'>('latest');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newBody, setNewBody] = useState<string>('');
  const [newClass, setNewClass] = useState<string>('moving_brown_dwarf');
  const [selectedShortcut, setSelectedShortcut] =
    useState<ClassificationShortcut | null>(null);
  const [showMoreCategories, setShowMoreCategories] = useState<boolean>(false);
  const [newConfidence, setNewConfidence] = useState<number>(90);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [upvotedIds, setUpvotedIds] = useState<Record<string, boolean>>({});
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const composerTitleRef = useRef<HTMLInputElement>(null);

  const nearbyCount = useMemo(
    () => threads.filter((t) => Math.hypot(t.ra - ra, t.dec - dec) <= 1.5).length,
    [dec, ra, threads]
  );

  const verifiedCount = useMemo(
    () => threads.filter((t) => t.isModerator).length,
    [threads]
  );

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of threads) {
      counts[t.classification] = (counts[t.classification] ?? 0) + 1;
    }
    return counts;
  }, [threads]);

  const trendingTopics = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const t of threads) {
      for (const raw of t.hashtags ?? []) {
        const tag = raw.startsWith('#') ? raw : `#${raw}`;
        freq[tag] = (freq[tag] ?? 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12);
  }, [threads]);

  const topDiscussions = useMemo(() => {
    return [...threads]
      .sort(
        (a, b) =>
          b.upvotes + b.replies.length - (a.upvotes + a.replies.length) ||
          b.timestampIso.localeCompare(a.timestampIso)
      )
      .slice(0, 3);
  }, [threads]);

  const filteredThreads = useMemo(() => {
    const matching = threads.filter((t) => {
      if (scopeFilter === 'TARGET' && Math.hypot(t.ra - ra, t.dec - dec) > 1.5) {
        return false;
      }
      if (scopeFilter === 'VERIFIED' && !t.isModerator) {
        return false;
      }
      if (classFilter !== 'ALL' && t.classification !== classFilter) {
        return false;
      }
      if (
        tagFilter &&
        !(t.hashtags ?? []).some((tag) => (tag.startsWith('#') ? tag : `#${tag}`) === tagFilter)
      ) {
        return false;
      }
      return true;
    });
    if (feedSort === 'top') {
      return [...matching].sort(
        (a, b) =>
          b.upvotes + b.replies.length - (a.upvotes + a.replies.length) ||
          b.timestampIso.localeCompare(a.timestampIso)
      );
    }
    return matching;
  }, [classFilter, dec, feedSort, ra, scopeFilter, tagFilter, threads]);

  // Submit new observation thread (attaches X-Observer-ID and X-Observer-Key per SPECIFICATION.md §3.3)
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim() || isSubmitting) return;

    setSubmitError(null);
    setIsSubmitting(true);
    const hashtags = selectedShortcut ? [selectedShortcut.hashtag] : [];
    const taggedBody = hashtags.length > 0 && !newBody.includes(hashtags[0])
      ? `${newBody.trim()} ${hashtags[0]}`
      : newBody.trim();
    const draftTitle = newTitle.trim();
    const targetName =
      activeTargetName ||
      `J2000 ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`;

    try {
      const response = await fetch('/api/forum/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify({
          title: draftTitle,
          body: taggedBody,
          classification: newClass,
          confidencePct: newConfidence,
          ra,
          dec,
          fovArcsec,
          renderMode,
          targetName,
          hashtags,
          classificationVote: selectedShortcut?.id ?? null,
          channel: selectedShortcut?.channel ?? 'discoveries',
        }),
      });
      if (!response.ok) {
        setSubmitError(`Failed to publish observation (HTTP ${response.status}).`);
        return;
      }
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (payload.thread?.id !== undefined) {
        const saved = {
          ...payload.thread,
          id: String(payload.thread.id),
          replies: payload.thread.replies ?? [],
        } as DiscussionThread;
        setThreads((prev) =>
          prev.some((thread) => thread.id === saved.id)
            ? prev.map((thread) => (thread.id === saved.id ? saved : thread))
            : [saved, ...prev]
        );
      }
      setNewTitle('');
      setNewBody('');
      setSelectedShortcut(null);
      setShowMoreCategories(false);
      setNewClass('moving_brown_dwarf');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to reach forum API.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddReply = async (threadId: string) => {
    const text = (replyDrafts[threadId] || '').trim();
    if (!text || !/^\d+$/.test(threadId)) return;

    setSubmitError(null);
    try {
      const response = await fetch('/api/forum/replies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify({ threadId: Number(threadId), body: text }),
      });
      if (!response.ok) {
        setSubmitError(`Failed to post reply (HTTP ${response.status}).`);
        return;
      }
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (payload.thread) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? ({ ...t, ...payload.thread, id: threadId } as DiscussionThread) : t
          )
        );
      }
      setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
      setExpandedReplies((prev) => ({ ...prev, [threadId]: true }));
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to post reply.');
    }
  };

  const handleUpvoteThread = async (threadId: string) => {
    if (!/^\d+$/.test(threadId) || upvotedIds[threadId]) return;

    setUpvotedIds((prev) => ({ ...prev, [threadId]: true }));
    try {
      const response = await fetch(`/api/forum/threads/${threadId}/upvote`, {
        method: 'POST',
        headers: {
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
      });
      if (!response.ok) {
        setUpvotedIds((prev) => ({ ...prev, [threadId]: false }));
        return;
      }
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (payload.thread) {
        setThreads((prev) =>
          prev.map((item) =>
            item.id === threadId ? { ...item, ...payload.thread, id: threadId } : item
          )
        );
      }
    } catch {
      setUpvotedIds((prev) => ({ ...prev, [threadId]: false }));
    }
  };

  const handleClassificationVote = async (
    thread: DiscussionThread,
    shortcut: ClassificationShortcut
  ) => {
    if (!/^\d+$/.test(thread.id)) return;

    try {
      const response = await fetch(`/api/forum/threads/${thread.id}/classifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify({ classificationVote: shortcut.id }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (!payload.thread) return;
      setThreads((prev) =>
        prev.map((item) =>
          item.id === thread.id
            ? { ...item, ...payload.thread, id: thread.id }
            : item
        )
      );
    } catch {
      // Surface feed availability via loadError / submitError rather than mutating unpersisted state.
    }
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
      isBench ? '[NASA Benchmark (Pre-cached)]' : '[Community Observation]'
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
        name: 'Pan-STARRS PS1 Optical Cutouts',
        desc: 'Color and grizy stack cutouts at the active J2000 position',
        url: `https://ps1images.stsci.edu/cgi-bin/ps1cutouts?pos=${encodeURIComponent(
          `${ra.toFixed(6)} ${dec.toFixed(6)}`
        )}`,
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
    <div
      className="relative flex h-full w-full justify-center overflow-hidden bg-background bg-cover bg-center bg-no-repeat font-sans text-xs text-foreground"
      style={{ backgroundImage: "url('/images/galaxy.jpg')" }}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-background/65 backdrop-blur-[1px]"
        aria-hidden="true"
      />
      <div className="relative z-10 flex h-full w-full max-w-[1440px] flex-col lg:flex-row overflow-hidden">
        {/* LEFT RAIL: Feed Views, External Archives & Zero-Auth Observer Footer */}
        <aside
          aria-label="Forum Navigation and Archives"
          className="flex w-full lg:w-[236px] xl:w-[252px] shrink-0 flex-col max-h-56 lg:max-h-none border-b lg:border-b-0 lg:border-r border-border/80 bg-card/55 backdrop-blur-md overflow-y-auto px-3.5 py-4 gap-5"
        >
          {/* Feed Navigation Views (modeled on My Feed / Groups / Bookmarks) */}
          <nav className="flex flex-col gap-1" aria-label="Feed Scope">
            <button
              type="button"
              onClick={() => setScopeFilter('ALL')}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                scopeFilter === 'ALL'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l9-8 9 8v8a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-8z" />
                </svg>
                All Sky Feed
              </span>
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {threads.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScopeFilter('TARGET')}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                scopeFilter === 'TARGET'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364 0a6.364 6.364 0 11-12.728 0 6.364 6.364 0 0112.728 0z" />
                </svg>
                Near Active Field
              </span>
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-300">
                {nearbyCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScopeFilter('VERIFIED')}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                scopeFilter === 'VERIFIED'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Moderator Verified
              </span>
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {verifiedCount}
              </span>
            </button>
          </nav>

          {/* External Astronomical Archive Cross-Match */}
          <div className="border-t border-border/70 pt-4">
            <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Archive Cross-Match
            </h3>
            <div className="flex flex-col gap-1">
              {externalArchives.map((arch) => (
                <a
                  key={arch.name}
                  href={arch.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={arch.desc}
                  className="group flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                >
                  <span className="truncate font-medium">{arch.name}</span>
                  <svg className="h-3 w-3 shrink-0 opacity-60 group-hover:text-primary group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Bottom Observer Identity & SSE Status */}
          <div className="mt-auto border-t border-border/70 pt-3 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/40 font-mono text-[10px] font-semibold text-primary">
                {identity.handle.slice(-2)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px] font-medium text-foreground">
                  {identity.handle}
                </div>
                <div className="text-[10px] text-muted-foreground">Zero-Auth Session</div>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] ${
                sseConnected
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-secondary text-muted-foreground border border-border'
              }`}
            >
              {sseConnected ? 'SSE Live' : 'Offline'}
            </span>
          </div>
        </aside>

        {/* CENTER CHAT STREAM */}
        <section
          aria-label="Community Chat Stream"
          className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 pb-8">
            {/* New Post / Observation Note Composer (modeled on design.webp New Post card) */}
            <form
              onSubmit={handleCreateThread}
              className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md shadow-sm overflow-hidden"
            >
              <div className="px-4 pt-3.5 pb-2 space-y-1.5">
                <input
                  ref={composerTitleRef}
                  id="obs-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Observation headline (e.g. Dipole shift in D5 at MJD 61360)..."
                  className="w-full bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <label htmlFor="obs-body" className="sr-only">
                  Detailed astrophysical notes, MJD pass numbers, and band metrics
                </label>
                <textarea
                  id="obs-body"
                  rows={3}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="New observation note... record MJD passes, bands (D1–D6), proper motion vectors, or ice column metrics."
                  className="w-full resize-none bg-transparent text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[10px] text-muted-foreground">
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 text-primary tabular-nums">
                    Pin: {activeTargetName || 'Field'} ({ra.toFixed(4)}°, {dec >= 0 ? '+' : ''}{dec.toFixed(4)}° · {fovArcsec}&quot; · {renderMode})
                  </span>
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 text-foreground/90">
                    {CLASSIFICATION_CATEGORIES.find((c) => c.id === newClass)?.label || newClass} ({newConfidence}%)
                  </span>
                  {selectedShortcut && (
                    <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
                      {selectedShortcut.hashtag}
                    </span>
                  )}
                </div>
              </div>

              {showMoreCategories && (
                <div className="border-t border-border/60 bg-background/50 px-4 py-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Select Candidate Classification
                    </span>
                    <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      Confidence {newConfidence}%
                      <input
                        id="obs-conf"
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={newConfidence}
                        onChange={(e) => setNewConfidence(Number(e.target.value))}
                        className="w-24 accent-primary"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CLASSIFICATION_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setNewClass(cat.id);
                          setSelectedShortcut(null);
                        }}
                        className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                          newClass === cat.id
                            ? 'border-primary bg-primary/15 text-foreground font-medium'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-background/40 px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {CLASSIFICATION_SHORTCUTS.map((shortcut) => (
                    <button
                      key={shortcut.id}
                      type="button"
                      aria-pressed={selectedShortcut?.id === shortcut.id}
                      onClick={() => {
                        if (selectedShortcut?.id === shortcut.id) {
                          setSelectedShortcut(null);
                        } else {
                          setSelectedShortcut(shortcut);
                          setNewClass(shortcut.classification);
                        }
                      }}
                      className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                        selectedShortcut?.id === shortcut.id
                          ? 'border-primary/60 bg-primary/15 text-primary font-medium'
                          : 'border-transparent bg-secondary/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {shortcut.hashtag}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowMoreCategories((prev) => !prev)}
                    className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                      showMoreCategories
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                    }`}
                  >
                    Classification ▾
                  </button>
                </div>

                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={isSubmitting || !newTitle.trim() || !newBody.trim()}
                  className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3"
                  title="Publish Observation Note"
                >
                  {isSubmitting ? 'Posting…' : 'Post'}
                  <svg className="ml-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14m-6-6l6 6-6 6" />
                  </svg>
                </Button>
              </div>
              {submitError && (
                <p className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-[11px] text-destructive" role="alert">
                  {submitError}
                </p>
              )}
            </form>

            {/* Sort / Filter Tabs Strip (modeled on Following | Featured | Rising) */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFeedSort('latest')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    feedSort === 'latest'
                      ? 'bg-card border border-border text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Latest
                </button>
                <button
                  type="button"
                  onClick={() => setFeedSort('top')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    feedSort === 'top'
                      ? 'bg-card border border-border text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Featured
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter(scopeFilter === 'TARGET' ? 'ALL' : 'TARGET')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    scopeFilter === 'TARGET'
                      ? 'bg-card border border-primary/50 text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <svg className="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Active Target (r ≤ 1.5°)
                </button>
              </div>

              {(classFilter !== 'ALL' || tagFilter !== null || scopeFilter !== 'ALL') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {classFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setClassFilter('ALL')}
                      className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                    >
                      {CLASSIFICATION_CATEGORIES.find((c) => c.id === classFilter)?.label || classFilter} ×
                    </button>
                  )}
                  {tagFilter && (
                    <button
                      type="button"
                      onClick={() => setTagFilter(null)}
                      className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-500/20"
                    >
                      {tagFilter} ×
                    </button>
                  )}
                  {scopeFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setScopeFilter('ALL')}
                      className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Reset Scope ×
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Threaded Observations List */}
            <div className="space-y-4">
              {isLoading && (
                <div className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-6 text-center font-mono text-xs text-muted-foreground">
                  Loading community discussions from archive database…
                </div>
              )}
              {!isLoading && loadError && (
                <div className="rounded-xl border border-destructive/50 bg-card/85 backdrop-blur-md p-4 text-center font-mono text-xs text-destructive" role="alert">
                  Forum archive unavailable ({loadError}). Check database connectivity.
                </div>
              )}
              {!isLoading && !loadError && filteredThreads.length === 0 && (
                <div className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-6 text-center text-xs text-muted-foreground">
                  No community observations match the active filters.
                </div>
              )}
              {filteredThreads.map((t) => {
                const catLabel =
                  t.classification === 'unclassified'
                    ? 'Unclassified'
                    : CLASSIFICATION_CATEGORIES.find((c) => c.id === t.classification)?.label ||
                      t.classification;
                const repliesOpen =
                  expandedReplies[t.id] ?? t.replies.length > 0;

                return (
                  <article
                    key={t.id}
                    id={`thread-${t.id}`}
                    className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-4 space-y-3"
                  >
                    {/* Post Author Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary font-mono text-[10px] font-semibold text-foreground">
                          {t.authorHandle.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-foreground">
                              {t.authorHandle}
                            </span>
                            {t.isModerator && (
                              <Badge variant="amber" className="text-[9px] px-1.5 py-0">
                                [Moderator]
                              </Badge>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {t.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleRestorePinnedState(t, 'navigator')}
                        className="font-mono text-[10px] text-muted-foreground hover:text-foreground tabular-nums"
                        title="Center Sky Map on this observation's coordinates"
                      >
                        Sky Map ({t.ra.toFixed(2)}°, {t.dec.toFixed(2)}°)
                      </Button>
                    </div>

                    {/* Title + Body */}
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-semibold text-foreground leading-snug">
                        {t.title}
                      </h4>
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {t.body}
                      </p>
                    </div>

                    {/* Embedded Telemetry State Card (modeled on code preview + Read All ->) */}
                    <div className="rounded-lg border border-border bg-background/90 overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-secondary/30 px-3 py-1.5 font-mono text-[10px]">
                        <span className="text-foreground/90 font-medium">
                          {t.targetName}
                        </span>
                        <span className="text-primary">
                          {t.confidencePct > 0 ? `${catLabel} · ${t.confidencePct}%` : catLabel}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 py-2 font-mono text-[11px] tabular-nums">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">RA (J2000)</div>
                          <div className="text-foreground">{t.ra.toFixed(5)}°</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Dec (J2000)</div>
                          <div className="text-foreground">
                            {t.dec >= 0 ? `+${t.dec.toFixed(5)}` : t.dec.toFixed(5)}°
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">FoV</div>
                          <div className="text-foreground">{t.fovArcsec}&quot;</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Render Mode</div>
                          <div className="text-amber-400">{t.renderMode}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestorePinnedState(t, 'comparator')}
                        className="flex w-full items-center justify-center gap-1.5 border-t border-border/70 bg-secondary/20 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary/50"
                      >
                        Inspect in Comparator
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>

                    {/* Hashtags Row */}
                    {t.hashtags && t.hashtags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.hashtags.map((rawTag) => {
                          const tag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setTagFilter((cur) => (cur === tag ? null : tag))
                              }
                              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                                tagFilter === tag
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Action / Reaction Footer Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleUpvoteThread(t.id)}
                          disabled={Boolean(upvotedIds[t.id])}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors ${
                            upvotedIds[t.id] || t.upvotes > 0
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                              : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground'
                          }`}
                          title="Upvote observation note"
                        >
                          <span aria-hidden="true">▲</span>
                          <span>{t.upvotes}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedReplies((prev) => ({ ...prev, [t.id]: !repliesOpen }))
                          }
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                          title="Toggle verification replies"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h8m-8 4h5m-7 5l-4 1 1-4V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H6z" />
                          </svg>
                          <span>{t.replies.length}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRestorePinnedState(t, 'navigator')}
                          className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                          title="Open field in Sky Map"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        {CLASSIFICATION_SHORTCUTS.map((shortcut) => {
                          const votes = t.classVotes?.[shortcut.voteKey] ?? 0;
                          return (
                            <button
                              key={shortcut.id}
                              type="button"
                              onClick={() => void handleClassificationVote(t, shortcut)}
                              className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                            >
                              {shortcut.hashtag}
                              {votes > 0 ? ` · ${votes}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Replies & Quick Reply Form */}
                    {repliesOpen && (
                      <div className="space-y-2 border-t border-border/70 pt-3">
                        {t.replies.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-lg border border-border/80 bg-background/80 p-2.5 text-xs"
                          >
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="font-mono font-medium text-foreground">
                                {r.authorHandle}
                              </span>
                              {r.isModerator && (
                                <Badge variant="amber" className="text-[9px] px-1 py-0">
                                  [Moderator]
                                </Badge>
                              )}
                              <span>·</span>
                              <span className="font-mono">
                                {r.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-foreground/90">{r.body}</p>
                          </div>
                        ))}

                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleAddReply(t.id);
                          }}
                          className="flex items-center gap-2 pt-0.5"
                        >
                          <Input
                            type="text"
                            value={replyDrafts[t.id] || ''}
                            onChange={(e) =>
                              setReplyDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                            }
                            placeholder="Add verification reply or ephemeris note..."
                            className="flex-1 h-7 text-xs bg-background"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="xs"
                            disabled={!(replyDrafts[t.id] || '').trim()}
                          >
                            Reply
                          </Button>
                        </form>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* RIGHT RAIL: Active Field Card, Classifications Filter (replaces dropdown), Trending Topics, Top Discussions */}
        <aside
          aria-label="Classifications and Trending Topics"
          className="flex w-full lg:w-[276px] xl:w-[300px] shrink-0 flex-col max-h-72 lg:max-h-none border-t lg:border-t-0 lg:border-l border-border/80 bg-card/55 backdrop-blur-md overflow-y-auto p-4 gap-5"
        >
          {/* Active Sky Field Highlight Card (modeled on top-right promo card) */}
          <div className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground truncate">
                {activeTargetName || 'Active Sky Field'}
              </span>
              <Badge variant="amber" className="shrink-0 font-mono text-[9px]">
                Community
              </Badge>
            </div>
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground leading-relaxed">
              J2000 RA {ra.toFixed(4)}° · Dec {dec >= 0 ? `+${dec.toFixed(4)}` : dec.toFixed(4)}° · FoV {fovArcsec}&quot; ({renderMode})
            </p>
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <Button
                type="button"
                size="xs"
                onClick={() => setTab('comparator')}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold"
              >
                Inspect Field
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => composerTitleRef.current?.focus()}
                className="rounded-lg"
              >
                Pin Note
              </Button>
            </div>
          </div>

          {/* Classifications List (replaces the dropdown directly right of the chat stream) */}
          <div role="region" aria-label="Classifications">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Classifications</h3>
              {classFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setClassFilter('ALL')}
                  className="text-[10px] text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                aria-pressed={classFilter === 'ALL'}
                onClick={() => setClassFilter('ALL')}
                className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors ${
                  classFilter === 'ALL'
                    ? 'border-border bg-card text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground'
                }`}
              >
                <span className="truncate">All Classifications</span>
                <span className="ml-2 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {threads.length}
                </span>
              </button>
              {CLASSIFICATION_CATEGORIES.map((cat) => {
                const count = classCounts[cat.id] ?? 0;
                const active = classFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setClassFilter(active ? 'ALL' : cat.id)}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                      active
                        ? 'border-primary/50 bg-card text-foreground font-medium'
                        : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground'
                    }`}
                  >
                    <span className="truncate">{cat.label}</span>
                    <span
                      className={`ml-2 shrink-0 font-mono text-[10px] tabular-nums ${
                        count > 0 ? 'text-primary' : 'text-muted-foreground/60'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trending Topics (dynamic tags from live archive discussions) */}
          {trendingTopics.length > 0 && (
            <div role="region" aria-label="Trending Topics">
              <h3 className="mb-2 text-xs font-semibold text-foreground">Trending Topics</h3>
              <div className="flex flex-wrap gap-1.5">
                {trendingTopics.map(([tag]) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={tagFilter === tag}
                    onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                      tagFilter === tag
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Top Discussions */}
          {topDiscussions.length > 0 && (
            <div role="region" aria-label="Top Discussions">
              <h3 className="mb-2 text-xs font-semibold text-foreground">Top Discussions</h3>
              <div className="flex flex-col divide-y divide-border/60">
                {topDiscussions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setClassFilter('ALL');
                      setScopeFilter('ALL');
                      setTagFilter(null);
                      document.getElementById(`thread-${item.id}`)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      });
                    }}
                    className="py-2.5 text-left transition-colors hover:text-primary"
                  >
                    <div className="line-clamp-2 text-[11px] font-medium text-foreground/90 leading-snug">
                      {item.title}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {item.replies.length} replies · {item.upvotes} upvotes
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
