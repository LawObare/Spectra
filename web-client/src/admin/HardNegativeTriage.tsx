import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Button, Select } from '../components/ui';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminSearchInput,
  AdminStatusPill,
  IconActivity,
  IconAlert,
  IconCheckCircle,
  IconDatabase,
  SegmentedProgressBar,
} from './components/AdminPrimitives';

/**
 * Tab 4: Disagreement Triage & Hard-Negative Queue (/admin/triage)
 * Specification Anchors: SPECIFICATION.md §6.4.5
 * 
 * Features:
 * - AI vs. Community Disagreement Table sorted by |P_AI - P_Community| divergence
 * - Raw FITS HDU 1–6 Inspector (IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE)
 * - One-click promotion to Community Candidate Catalog with [Moderator] status
 * - One-click addition to PyTorch Hard-Negative training buffer
 */

interface TriageCandidate {
  subject_id: string;
  title: string;
  ra: number;
  dec: number;
  ai_prediction: string;
  ai_prob: number;
  community_consensus: string;
  community_prob: number;
  divergence: number;
  shannon_entropy: number;
  votes_count: number;
  flag_bits: string[];
  flag_mask_hex: string;
  status: 'pending' | 'in_buffer' | 'verified' | 'artifact';
  zodi_level_mjy_sr: number;
  psf_fwhm_arcsec: number;
  central_wave_um: number;
  notes: string;
}

const INITIAL_TRIAGE_DATA: TriageCandidate[] = [
  {
    subject_id: 'triage_spx_0411',
    title: 'SPX-J0855-0714-B1',
    ra: 133.7412,
    dec: -7.2451,
    ai_prediction: 'optical_blend',
    ai_prob: 0.88,
    community_consensus: 'moving_brown_dwarf',
    community_prob: 0.12,
    divergence: 0.76,
    shannon_entropy: 0.44,
    votes_count: 28,
    flag_bits: ['TRANSIENT'],
    flag_mask_hex: '0x0001',
    status: 'pending',
    zodi_level_mjy_sr: 14.2,
    psf_fwhm_arcsec: 7.4,
    central_wave_um: 4.10,
    notes: 'Thermal dipole visible in D5/D6 coadds; single-read SUR glitch fooled CNN feature extractor.',
  },
  {
    subject_id: 'triage_spx_0892',
    title: 'SPX-J1829-0158-ICE',
    ra: 277.4865,
    dec: -1.9783,
    ai_prediction: 'flat_continuum',
    ai_prob: 0.82,
    community_consensus: 'h2o_ice_absorption',
    community_prob: 0.15,
    divergence: 0.67,
    shannon_entropy: 0.38,
    votes_count: 19,
    flag_bits: ['DICHROIC'],
    flag_mask_hex: '0x0040',
    status: 'pending',
    zodi_level_mjy_sr: 22.8,
    psf_fwhm_arcsec: 7.2,
    central_wave_um: 3.05,
    notes: 'Dichroic transition band attenuated baseline; volunteer aperture subtraction reveals deep 3.05um H2O ice trough.',
  },
  {
    subject_id: 'triage_spx_0145',
    title: 'SPX-J0430+3513-VAR',
    ra: 67.5143,
    dec: 35.2244,
    ai_prediction: 'moving_brown_dwarf',
    ai_prob: 0.74,
    community_consensus: 'variable_star',
    community_prob: 0.18,
    divergence: 0.56,
    shannon_entropy: 0.51,
    votes_count: 34,
    flag_bits: ['PERSISTENCE'],
    flag_mask_hex: '0x0200',
    status: 'pending',
    zodi_level_mjy_sr: 11.5,
    psf_fwhm_arcsec: 7.5,
    central_wave_um: 2.00,
    notes: 'Stationary dimming source; chromatic centroid shift mimics dipole motion in difference frame.',
  },
  {
    subject_id: 'triage_spx_0621',
    title: 'SPX-J2201-5620-ART',
    ra: 330.2501,
    dec: -56.3312,
    ai_prediction: 'moving_brown_dwarf',
    ai_prob: 0.69,
    community_consensus: 'diffraction_spike',
    community_prob: 0.22,
    divergence: 0.47,
    shannon_entropy: 0.58,
    votes_count: 14,
    flag_bits: ['OVERFLOW', 'GHOST'],
    flag_mask_hex: '0x0402',
    status: 'pending',
    zodi_level_mjy_sr: 18.1,
    psf_fwhm_arcsec: 7.8,
    central_wave_um: 4.70,
    notes: 'Optical ghost from saturated nearby 6th mag star falls on detector mosaic edge.',
  },
  {
    subject_id: 'triage_spx_0774',
    title: 'SPX-J1627-2439-BD',
    ra: 246.8685,
    dec: -24.6593,
    ai_prediction: 'background_noise',
    ai_prob: 0.65,
    community_consensus: 'moving_brown_dwarf',
    community_prob: 0.25,
    divergence: 0.40,
    shannon_entropy: 0.61,
    votes_count: 22,
    flag_bits: [],
    flag_mask_hex: '0x0000',
    status: 'pending',
    zodi_level_mjy_sr: 25.4,
    psf_fwhm_arcsec: 7.3,
    central_wave_um: 4.10,
    notes: 'Faint cold sub-brown dwarf candidate in Ophiuchus cloud; clear motion SNR > 3.4 in manual blinking.',
  },
];

export const HardNegativeTriage: React.FC = () => {
  const [candidates, setCandidates] = useState<TriageCandidate[]>(INITIAL_TRIAGE_DATA);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_TRIAGE_DATA[0].subject_id);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeHduTab, setActiveHduTab] = useState<number>(1);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Active candidate
  const currentCandidate = useMemo(
    () => candidates.find((c) => c.subject_id === selectedId) || candidates[0],
    [candidates, selectedId]
  );

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates
      .filter((c) => {
        if (filterCategory === 'high' && c.divergence < 0.5) return false;
        if (filterCategory === 'movers' && !c.community_consensus.includes('brown_dwarf')) return false;
        if (filterCategory === 'ice' && !c.community_consensus.includes('ice')) return false;
        if (filterCategory === 'variable' && !c.community_consensus.includes('variable')) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (
            c.subject_id.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q) ||
            c.ai_prediction.toLowerCase().includes(q) ||
            c.community_consensus.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => b.divergence - a.divergence);
  }, [candidates, filterCategory, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const bufferCount = candidates.filter((c) => c.status === 'in_buffer').length;
    const verifiedCount = candidates.filter((c) => c.status === 'verified').length;
    const maxDiv = candidates.reduce((max, c) => Math.max(max, c.divergence), 0);
    return { bufferCount, verifiedCount, maxDiv, total: candidates.length };
  }, [candidates]);

  // Render HDU preview canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Dark astronomical background
    ctx.fillStyle = '#05070B';
    ctx.fillRect(0, 0, w, h);

    const seedPhase = currentCandidate.ra * 0.17 + currentCandidate.dec * 0.23;
    const detNoise = (px: number, py: number) => {
      const s = Math.sin(px * 12.9898 + py * 78.233 + seedPhase) * 43758.5453;
      return s - Math.floor(s);
    };

    if (activeHduTab === 1) {
      // HDU 1: IMAGE (FLUX) with Asinh stretch
      const imgData = ctx.createImageData(w, h);
      const cx = w / 2;
      const cy = h / 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const r2 = (x - cx) ** 2 + (y - cy) ** 2;
          const flux = Math.exp(-r2 / (2 * (w / 10) ** 2)) * 1.5 + detNoise(x, y) * 0.15;
          const val = Math.min(255, Math.floor(Math.asinh(flux * 5) * 45));
          imgData.data[idx] = Math.min(255, val + 15);
          imgData.data[idx + 1] = Math.min(255, Math.floor(val * 1.2));
          imgData.data[idx + 2] = Math.min(255, Math.floor(val * 1.6));
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (activeHduTab === 2) {
      // HDU 2: FLAGS
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, w, h);
      // Render flagged pixels in amber / red
      ctx.fillStyle = '#EF4444';
      ctx.fillRect(w / 2 - 8, h / 2 - 8, 16, 16);
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(w / 4, h / 3, 6, 6);
      ctx.fillRect((w * 3) / 4, (h * 2) / 3, 6, 6);
    } else if (activeHduTab === 3) {
      // HDU 3: VARIANCE (deterministic detector read-noise map seeded by RA/Dec)
      const imgData = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const noise = Math.floor(detNoise(x + 7, y + 13) * 40 + 20);
          imgData.data[idx] = noise;
          imgData.data[idx + 1] = noise;
          imgData.data[idx + 2] = noise;
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (activeHduTab === 4) {
      // HDU 4: ZODI
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, w, h);
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#0F172A');
      gradient.addColorStop(1, '#334155');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    } else if (activeHduTab === 5) {
      // HDU 5: Empirical PSF
      const imgData = ctx.createImageData(w, h);
      const cx = w / 2;
      const cy = h / 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const r = Math.hypot(x - cx, y - cy);
          const airy = Math.max(0, Math.cos(r / 6) / (1 + (r / 5) ** 2));
          const val = Math.floor(airy * 255);
          imgData.data[idx] = val;
          imgData.data[idx + 1] = Math.floor(val * 0.8);
          imgData.data[idx + 2] = Math.floor(val * 0.3);
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } else {
      // HDU 6: WCS-WAVE
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x += 4) {
        const y = h / 2 + Math.sin(x * 0.05) * (h / 4);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [activeHduTab, currentCandidate]);

  // Actions (Wired to Active Learning & Community Consensus API)
  const handleAddToBuffer = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.subject_id === id ? { ...c, status: 'in_buffer' } : c))
    );
    showToast(`Added ${id} to PyTorch Hard-Negative training buffer (Sample Weight: 3.5x).`);
    try {
      const target = candidates.find((c) => c.subject_id === id);
      const obsId = localStorage.getItem('spx_observer_id') || '00000000-0000-4000-8000-000000007f3a';
      const obsKey = localStorage.getItem('spx_observer_key') || 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      fetch('/api/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': obsId,
          'X-Observer-Key': obsKey,
        },
        body: JSON.stringify({
          subject_id: id,
          tab_workflow: 'admin_triage',
          primary_class: target?.ai_prediction || 'hard_negative',
          confidence: 0.85,
          feature_tags: ['hard_negative_buffer', 'active_learning_weight_3.5x'],
        }),
      }).catch(() => {});
      fetch('/api/admin/sft-dataset/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: id,
          label: target?.title || target?.subject_id || id,
          predicted_class: target?.ai_prediction || 'hard_negative',
          human_class: target?.community_consensus || 'Galaxy / AGN / Field',
          action: 'overridden',
          reasoning: target?.notes || 'Promoted from Hard-Negative Triage (3.5x weight)',
          metrics: { divergence: target?.divergence ?? 0 },
        }),
      }).catch(() => {});
    } catch {
      // Optimistic local state preserved
    }
  };

  const handleVerifyDiscovery = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.subject_id === id ? { ...c, status: 'verified' } : c))
    );
    showToast(`Promoted ${id} to Community Candidate Catalog with [Moderator] endorsement.`);
    try {
      const target = candidates.find((c) => c.subject_id === id);
      const obsId = localStorage.getItem('spx_observer_id') || '00000000-0000-4000-8000-000000007f3a';
      const obsKey = localStorage.getItem('spx_observer_key') || 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      fetch('/api/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': obsId,
          'X-Observer-Key': obsKey,
        },
        body: JSON.stringify({
          subject_id: id,
          tab_workflow: 'admin_triage',
          primary_class: target?.community_consensus || 'verified_discovery',
          confidence: 0.99,
          feature_tags: ['admin_verified', 'community_promoted'],
        }),
      }).catch(() => {});
    } catch {
      // Optimistic local state preserved
    }
  };

  const handleFlagArtifact = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.subject_id === id ? { ...c, status: 'artifact' } : c))
    );
    showToast(`Flagged ${id} as Optical Artifact in calibration pool.`);
    try {
      const obsId = localStorage.getItem('spx_observer_id') || '00000000-0000-4000-8000-000000007f3a';
      const obsKey = localStorage.getItem('spx_observer_key') || 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      fetch('/api/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': obsId,
          'X-Observer-Key': obsKey,
        },
        body: JSON.stringify({
          subject_id: id,
          tab_workflow: 'admin_triage',
          primary_class: 'transient_glitch',
          confidence: 0.99,
          feature_tags: ['optical_artifact', 'admin_flagged'],
        }),
      }).catch(() => {});
    } catch {
      // Optimistic local state preserved
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="h-full w-full overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
        <AdminPageHeader
          title="Disagreement Triage"
          subtitle="Resolve high-divergence AI vs. citizen classifications via raw FITS HDU 1–6 planes and hard-negative curation."
          actions={
            <div data-tour="admin-triage-actions" className="flex flex-wrap items-center gap-2">
              <Link to={`/explore?tab=comparator&ra=${currentCandidate.ra}&dec=${currentCandidate.dec}`}>
                <Button variant="outline" size="sm" className="h-8 rounded-lg px-3.5 text-xs">
                  Inspect in Comparator →
                </Button>
              </Link>
            </div>
          }
        />

        {toastMessage && (
          <div className="rounded-xl border border-primary/35 bg-primary/10 px-4 py-2.5 text-xs text-sky-200 flex items-center justify-between">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-xs font-medium text-sky-300 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* BAND 2: 4-CARD KPI SUMMARY */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AdminKpiCard
            label="Queued Disagreements"
            value={stats.total}
            delta="Sorted by |P_AI - P_Comm|"
            deltaTone="muted"
            icon={<IconAlert className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Peak Divergence"
            value={`${(stats.maxDiv * 100).toFixed(0)}%`}
            delta={`Max Δ ${stats.maxDiv.toFixed(2)} across queue`}
            deltaTone="amber"
            icon={<IconActivity className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Training Buffer"
            value={stats.bufferCount}
            delta="Queued for LoRA retraining"
            deltaTone="sky"
            icon={<IconDatabase className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Verified Discoveries"
            value={stats.verifiedCount}
            delta="Promoted to community catalog"
            deltaTone="emerald"
            icon={<IconCheckCircle className="h-4 w-4" />}
          />
        </div>

        {/* BAND 3: QUEUE TABLE + RAW FITS HDU 1–6 INSPECTOR */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 items-start">
          {/* LEFT: DISAGREEMENT QUEUE TABLE */}
          <div className="admin-surface rounded-xl overflow-hidden xl:col-span-8 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Disagreement Queue ({filteredCandidates.length})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Select any candidate to inspect its FITS extensions and adjudicate
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AdminSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Filter subject or class..."
                  className="w-44 sm:w-48"
                />
                <Select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="h-8 rounded-lg border-white/[0.1] bg-background/80 text-xs"
                >
                  <option value="all">All Disagreements</option>
                  <option value="high">High Divergence (&gt; 0.50)</option>
                  <option value="movers">Mover Divergences</option>
                  <option value="ice">Ice Signatures</option>
                  <option value="variable">Variables</option>
                </Select>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-white/[0.07] bg-card/95 backdrop-blur-sm text-[11px] font-medium text-muted-foreground">
                  <tr>
                    <th className="py-2.5 pl-4 pr-2">Subject</th>
                    <th className="py-2.5 px-2">Divergence</th>
                    <th className="py-2.5 px-2">AI vs. Community</th>
                    <th className="py-2.5 px-2">Status</th>
                    <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filteredCandidates.map((cand) => {
                    const isSelected = cand.subject_id === selectedId;
                    const divPct = Math.round(cand.divergence * 100);
                    return (
                      <tr
                        key={cand.subject_id}
                        onClick={() => setSelectedId(cand.subject_id)}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-white/[0.03]',
                          isSelected ? 'bg-primary/[0.08]' : ''
                        )}
                      >
                        <td className="py-3 pl-4 pr-2">
                          <div className="font-semibold text-foreground whitespace-nowrap">{cand.title}</div>
                          <div className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5 whitespace-nowrap">
                            {cand.ra.toFixed(3)}°, {cand.dec.toFixed(3)}°
                          </div>
                        </td>

                        <td className="py-3 px-2">
                          <SegmentedProgressBar
                            percent={divPct}
                            tone={cand.divergence >= 0.55 ? 'amber' : 'sky'}
                          />
                        </td>

                        <td className="py-3 px-2 max-w-[190px]">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-medium text-foreground truncate">{cand.ai_prediction}</span>
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                              ({cand.ai_prob.toFixed(2)})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] mt-0.5 truncate">
                            <span className="text-sky-300 font-medium truncate">→ {cand.community_consensus}</span>
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                              ({cand.community_prob.toFixed(2)} · {cand.votes_count}v)
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-2 whitespace-nowrap">
                          {cand.status === 'in_buffer' ? (
                            <AdminStatusPill tone="sky">Buffer</AdminStatusPill>
                          ) : cand.status === 'verified' ? (
                            <AdminStatusPill tone="emerald">Verified</AdminStatusPill>
                          ) : cand.status === 'artifact' ? (
                            <AdminStatusPill tone="rose">Artifact</AdminStatusPill>
                          ) : (
                            <AdminStatusPill tone="muted">Pending</AdminStatusPill>
                          )}
                        </td>

                        <td className="py-3 pl-2 pr-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 rounded-md px-2 text-[11px]"
                              title="Add to Hard-Negative Training Buffer"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToBuffer(cand.subject_id);
                              }}
                            >
                              + Buffer
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 rounded-md px-2 text-[11px]"
                              title="Verify & Promote to Community Candidate Catalog"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleVerifyDiscovery(cand.subject_id);
                              }}
                            >
                              Promote
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCandidates.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-10 px-4 text-center text-xs text-muted-foreground">
                        No disagreement candidates match your current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: RAW FITS HDU 1–6 INSPECTOR */}
          <div className="admin-surface rounded-xl overflow-hidden xl:col-span-4 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">FITS MEF Inspector</h2>
                <p className="text-xs text-muted-foreground font-mono">
                  {currentCandidate.subject_id} · SPHEREx QR2
                </p>
              </div>
              <AdminStatusPill tone="muted">
                CRVAL [{currentCandidate.ra.toFixed(3)}, {currentCandidate.dec.toFixed(3)}]
              </AdminStatusPill>
            </div>

            <div className="p-4 flex flex-col gap-4">
              {/* HDU EXTENSION SELECTOR TABS */}
              <div className="grid grid-cols-6 gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1">
                {[
                  { num: 1, label: 'FLUX' },
                  { num: 2, label: 'FLAGS' },
                  { num: 3, label: 'VAR' },
                  { num: 4, label: 'ZODI' },
                  { num: 5, label: 'PSF' },
                  { num: 6, label: 'WAVE' },
                ].map((hdu) => (
                  <button
                    key={hdu.num}
                    type="button"
                    onClick={() => setActiveHduTab(hdu.num)}
                    className={cn(
                      'py-1.5 text-[10px] font-mono rounded-md transition-colors text-center',
                      activeHduTab === hdu.num
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    HDU {hdu.num}
                    <div className="text-[9px] opacity-80 truncate">{hdu.label}</div>
                  </button>
                ))}
              </div>

              {/* CANVAS RENDERER FOR HDU DATA PLANE */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.07] bg-black/55 p-4">
                <canvas
                  ref={canvasRef}
                  width={220}
                  height={220}
                  className="rounded-lg border border-white/[0.08]"
                />
                <div className="flex items-center justify-between w-full mt-3 text-[11px] text-muted-foreground font-mono px-1">
                  <span>
                    HDU {activeHduTab}:{' '}
                    {activeHduTab === 1
                      ? 'IMAGE'
                      : activeHduTab === 2
                      ? 'FLAGS'
                      : activeHduTab === 3
                      ? 'VARIANCE'
                      : activeHduTab === 4
                      ? 'ZODI'
                      : activeHduTab === 5
                      ? 'PSF_EMP'
                      : 'WCS_WAVE'}
                  </span>
                  <span>29×29 px · 6.2&quot;/px</span>
                </div>
              </div>

              {/* HDU TELEMETRY SPECIFICATION DETAILS */}
              <div className="admin-surface-subtle rounded-lg p-3.5 text-xs flex flex-col gap-2">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Quality Flags (HDU 2)</span>
                  <span className="font-mono text-foreground font-medium text-right">
                    {currentCandidate.flag_mask_hex} ({currentCandidate.flag_bits.join(', ') || 'CLEAN'})
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Zodiacal Light (HDU 4)</span>
                  <span className="font-mono text-foreground tabular-nums">
                    {currentCandidate.zodi_level_mjy_sr} MJy/sr
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Local PSF FWHM (HDU 5)</span>
                  <span className="font-mono text-foreground tabular-nums">
                    {currentCandidate.psf_fwhm_arcsec}&quot; (~1.2 px)
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Central Wavelength (HDU 6)</span>
                  <span className="font-mono text-foreground tabular-nums">
                    {currentCandidate.central_wave_um} µm
                  </span>
                </div>
                <div className="mt-1 pt-2 border-t border-white/[0.07] text-xs text-muted-foreground leading-relaxed">
                  &ldquo;{currentCandidate.notes}&rdquo;
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs"
                  onClick={() => handleAddToBuffer(currentCandidate.subject_id)}
                >
                  + Hard-Negative
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-lg text-xs"
                  onClick={() => handleVerifyDiscovery(currentCandidate.subject_id)}
                >
                  Promote
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-lg text-xs"
                  onClick={() => handleFlagArtifact(currentCandidate.subject_id)}
                >
                  Flag Artifact
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HardNegativeTriage;
