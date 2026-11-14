import React, { useMemo, useState } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { useRealtimeDiscussions } from '../hooks/useRealtimeDiscussions';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
} from '../components/GlobalCommandHeader';
import { Button, Badge, Input, Select } from '../components/ui';

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
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'TARGET'>('ALL');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newBody, setNewBody] = useState<string>('');
  const [newClass, setNewClass] = useState<string>('moving_brown_dwarf');
  const [selectedShortcut, setSelectedShortcut] =
    useState<ClassificationShortcut | null>(null);
  const [newConfidence, setNewConfidence] = useState<number>(90);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to post reply.');
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
    <div className="flex h-full w-full flex-col lg:flex-row overflow-hidden bg-background font-sans text-xs text-foreground">
      {/* LEFT PANEL: External Archive Cross-Match & Zero-Auth Telemetry Session */}
      <aside className="flex w-full lg:w-[320px] xl:w-[340px] shrink-0 flex-col max-h-56 lg:max-h-none border-b lg:border-b-0 lg:border-r border-border bg-card overflow-y-auto p-4 gap-4">
        {/* Active Coordinate Cross-Match Header */}
        <div className="rounded-sm border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">
              Active Sky Field Cross-Match
            </span>
            <Badge variant="sky" className="font-mono text-[10px]">
              Community Product
            </Badge>
          </div>
          <div className="mt-1.5 font-medium text-foreground">
            {activeTargetName || 'Selected Field'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-primary">
            J2000 RA {ra.toFixed(5)}° · Dec {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}° · FoV {fovArcsec}&quot;
          </div>
        </div>

        {/* External Astronomical Archive Links */}
        <div>
          <h3 className="mb-2 text-xs font-semibold text-foreground">
            External Archive Cross-Match Verification
          </h3>
          <div className="flex flex-col gap-1.5">
            {externalArchives.map((arch) => (
              <a
                key={arch.name}
                href={arch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col rounded-sm border border-border bg-background p-2.5 transition-colors duration-150 hover:border-primary"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground group-hover:text-primary">
                    {arch.name}
                  </span>
                  <svg className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <span className="mt-0.5 text-[11px] text-muted-foreground">{arch.desc}</span>
              </a>
            ))}
          </div>
        </div>

        {/* Zero-Auth Telemetry Session Info */}
        <div className="mt-auto rounded-sm border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Observer Telemetry Session</span>
            <span className="font-mono text-[10px] text-emerald-400">
              {sseConnected ? 'SSE Live' : 'Local Sync'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Handle: <strong className="font-mono text-foreground">{identity.handle}</strong> (Zero-Auth UUIDv4 + SHA-256 key)
          </div>
        </div>
      </aside>

      {/* CENTERED CHAT SECTION: Observation Note Composer & Threaded Candidate Feed */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden items-center">
        {/* Top Filter Bar */}
        <div className="w-full border-b border-border bg-card px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant={scopeFilter === 'ALL' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setScopeFilter('ALL')}
                className={scopeFilter === 'ALL' ? 'border-primary/50 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}
              >
                All Sky Observations ({threads.length})
              </Button>
              <Button
                variant={scopeFilter === 'TARGET' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setScopeFilter('TARGET')}
                className={scopeFilter === 'TARGET' ? 'border-primary/50 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}
              >
                Near {ra.toFixed(2)}°, {dec.toFixed(2)}° (r ≤ 1.5°)
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="forum-class-filter" className="text-[11px] text-muted-foreground">
                Classification:
              </label>
              <Select
                id="forum-class-filter"
                sizeVariant="xs"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="bg-background text-foreground"
              >
                <option value="ALL">All Classifications</option>
                {CLASSIFICATION_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div className="w-full flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {/* New Observation Note Composer */}
            <form
              onSubmit={handleCreateThread}
              className="rounded-sm border border-border bg-card p-3.5"
            >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border">
              <span className="font-semibold text-foreground">
                Log Observation Note & Pin Current Sky State
              </span>
              <span className="font-mono text-[11px] tabular-nums text-primary">
                Pinned: {activeTargetName || 'Field'} ({ra.toFixed(4)}°, {dec.toFixed(4)}° · {fovArcsec}&quot; · {renderMode})
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-muted-foreground">
                Structured classification:
              </span>
              {CLASSIFICATION_SHORTCUTS.map((shortcut) => (
                <Button
                  key={shortcut.id}
                  type="button"
                  variant={selectedShortcut?.id === shortcut.id ? 'secondary' : 'outline'}
                  size="xs"
                  aria-pressed={selectedShortcut?.id === shortcut.id}
                  onClick={() => {
                    setSelectedShortcut(shortcut);
                    setNewClass(shortcut.classification);
                  }}
                  className="font-mono text-[10px]"
                >
                  {shortcut.label}
                </Button>
              ))}
              {selectedShortcut && (
                <span className="font-mono text-[10px] text-primary">
                  {selectedShortcut.hashtag} will be attached
                </span>
              )}
            </div>

            <div className="mt-2.5 grid grid-cols-12 gap-2">
              <div className="col-span-12 md:col-span-6">
                <label htmlFor="obs-title" className="block text-[11px] text-muted-foreground">
                  Observation Summary
                </label>
                <Input
                  id="obs-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Dipole shift in D5 at MJD 61360 or H2O 3.05 µm absorption..."
                  className="mt-1 bg-background text-xs"
                />
              </div>
              <div className="col-span-8 md:col-span-4">
                <label htmlFor="obs-class" className="block text-[11px] text-muted-foreground">
                  Candidate Classification
                </label>
                <Select
                  id="obs-class"
                  sizeVariant="sm"
                  value={newClass}
                  onChange={(e) => {
                    setNewClass(e.target.value);
                    setSelectedShortcut(null);
                  }}
                  className="mt-1 w-full bg-background"
                >
                  {CLASSIFICATION_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-4 md:col-span-2">
                <label htmlFor="obs-conf" className="block text-[11px] text-muted-foreground">
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
                  className="mt-2.5 w-full accent-primary"
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
                className="w-full rounded-sm border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Posting as <strong className="font-mono text-foreground">{identity.handle}</strong> · Community Product
              </span>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={isSubmitting || !newTitle.trim() || !newBody.trim()}
              >
                {isSubmitting ? 'Publishing…' : 'Publish Observation Note'}
              </Button>
            </div>
            {submitError && (
              <p className="mt-2 font-mono text-[11px] text-destructive" role="alert">
                {submitError}
              </p>
            )}
          </form>

          {/* Threaded Observations List */}
          <div className="space-y-3.5">
            {isLoading && (
              <div className="rounded-sm border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
                Loading community discussions from archive database…
              </div>
            )}
            {!isLoading && loadError && (
              <div className="rounded-sm border border-destructive/50 bg-card p-4 text-center font-mono text-xs text-destructive" role="alert">
                Forum archive unavailable ({loadError}). Check database connectivity.
              </div>
            )}
            {!isLoading && !loadError && filteredThreads.length === 0 && (
              <div className="rounded-sm border border-border bg-card p-6 text-center text-xs text-muted-foreground">
                No community observations match the active spatial or classification filter.
              </div>
            )}
            {filteredThreads.map((t) => {
              const catLabel =
                t.classification === 'unclassified'
                  ? 'Unclassified'
                  : CLASSIFICATION_CATEGORIES.find((c) => c.id === t.classification)?.label ||
                    t.classification;
              return (
                <article
                  key={t.id}
                  className="rounded-sm border border-border bg-card p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-semibold text-foreground">{t.title}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono text-foreground">{t.authorHandle}</span>
                        {t.isModerator && (
                          <Badge variant="amber">[Moderator]</Badge>
                        )}
                        <span>·</span>
                        <Badge variant="sky">
                          {t.confidencePct > 0 ? `${catLabel} (${t.confidencePct}%)` : catLabel}
                        </Badge>
                        <span>·</span>
                        <span className="font-mono text-[10px]">
                          {t.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                        </span>
                      </div>
                    </div>

                    {/* Pinned State Jump Controls */}
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleRestorePinnedState(t, 'navigator')}
                        className="font-mono text-[10px] tabular-nums"
                        title="Center sky mosaic on this observation's coordinates"
                      >
                        Sky Map ({t.ra.toFixed(2)}°, {t.dec.toFixed(2)}°)
                      </Button>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleRestorePinnedState(t, 'comparator')}
                        title="Open this target and render mode in Tab 2 Comparator"
                      >
                        Inspect in Comparator →
                      </Button>
                    </div>
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed text-foreground/90">
                    {t.body}
                  </p>

                  {t.hashtags && t.hashtags.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {t.hashtags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-primary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                    <span className="mr-1 text-[10px] text-muted-foreground">
                      Classify this observation:
                    </span>
                    {CLASSIFICATION_SHORTCUTS.map((shortcut) => (
                      <Button
                        key={shortcut.id}
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => void handleClassificationVote(t, shortcut)}
                        className="font-mono text-[9px]"
                      >
                        {shortcut.label}
                      </Button>
                    ))}
                    {CLASSIFICATION_SHORTCUTS.map((shortcut) => {
                      const votes = t.classVotes?.[shortcut.voteKey] ?? 0;
                      return votes > 0 ? (
                        <span key={shortcut.voteKey} className="font-mono text-[9px] text-muted-foreground">
                          {shortcut.voteKey} {votes}
                        </span>
                      ) : null;
                    })}
                  </div>

                  {/* Replies */}
                  {t.replies.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-border pt-2.5 pl-3">
                      {t.replies.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-sm border border-border bg-background p-2 text-xs"
                        >
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="font-mono font-medium text-foreground">
                              {r.authorHandle}
                            </span>
                            {r.isModerator && (
                              <Badge variant="amber" className="text-[9px] px-1 py-0">[Moderator]</Badge>
                            )}
                            <span>·</span>
                            <span className="font-mono">
                              {r.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-foreground">{r.body}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick Reply Input */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleAddReply(t.id);
                    }}
                    className="mt-2.5 flex items-center gap-2"
                  >
                    <Input
                      type="text"
                      value={replyDrafts[t.id] || ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                      }
                      placeholder="Add verification reply or ephemeris cross-match note..."
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
                </article>
              );
            })}
          </div>
          </div>
        </div>
      </section>
    </div>
  );
};
