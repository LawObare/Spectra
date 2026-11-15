import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { ModelArchitecture } from './hooks/useAdminTelemetry';
import { cn } from '../lib/utils';
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminSearchInput,
  AdminStatusPill,
  IconActivity,
  IconCpu,
  IconLayers,
  IconNetwork,
} from './components/AdminPrimitives';

type NodeKind = 'target' | 'class' | 'feature' | 'template';

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  z?: number;
  meta: Record<string, any>;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  relation: 'classified_as' | 'spectral_feature' | 'cosine_similarity' | 'latent_cluster';
  label: string;
}

interface GraphPayload {
  model_name: string;
  embedding_space: 'base' | 'trained';
  checkpoint_meta: Record<string, any>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS: Record<NodeKind, { fill: string; stroke: string; badge: string; label: string }> = {
  target: { fill: '#0ea5e9', stroke: '#7dd3fc', badge: 'text-sky-300 border-sky-500/40 bg-sky-500/10', label: 'Sky Target' },
  class: { fill: '#8b5cf6', stroke: '#c4b5fd', badge: 'text-violet-300 border-violet-500/40 bg-violet-500/10', label: 'AI Class Hub' },
  feature: { fill: '#f59e0b', stroke: '#fcd34d', badge: 'text-amber-300 border-amber-500/40 bg-amber-500/10', label: 'Spectral Feature' },
  template: { fill: '#10b981', stroke: '#6ee7b7', badge: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10', label: 'Archive Template' },
};

const EDGE_COLORS: Record<GraphEdge['relation'], string> = {
  classified_as: 'rgba(139, 92, 246, 0.55)',
  spectral_feature: 'rgba(245, 158, 11, 0.55)',
  cosine_similarity: 'rgba(16, 185, 129, 0.50)',
  latent_cluster: 'rgba(56, 189, 248, 0.45)',
};

export const DecisionBoundaries: React.FC = () => {
  const [modelName, setModelName] = useState<ModelArchitecture>('SpectralResNet102');
  const [space, setSpace] = useState<'trained' | 'base'>('trained');
  const [minSimilarity, setMinSimilarity] = useState<number>(0.25);
  const [kindFilter, setKindFilter] = useState<'all' | NodeKind>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [autoOrbit, setAutoOrbit] = useState<boolean>(true);
  const [rotation, setRotation] = useState<{ yaw: number; pitch: number }>({
    yaw: -0.52,
    pitch: 0.32,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ active: boolean; x: number; y: number; moved: boolean }>({ active: false, x: 0, y: 0, moved: false });

  useEffect(() => {
    if (viewMode !== '3d' || !autoOrbit) return;
    const id = window.setInterval(() => {
      if (!dragRef.current.active) {
        setRotation((r) => ({ ...r, yaw: r.yaw + 0.006 }));
      }
    }, 33);
    return () => clearInterval(id);
  }, [viewMode, autoOrbit]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(
      `/api/admin/graph?model=${encodeURIComponent(modelName)}&space=${space}&min_similarity=${minSimilarity.toFixed(2)}`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: GraphPayload) => {
        if (cancelled) return;
        setGraph(data);
        setSelectedNodeId((prev) => {
          if (prev && data.nodes.some((n) => n.id === prev)) return prev;
          return data.nodes.find((n) => n.kind === 'target')?.id || data.nodes[0]?.id || null;
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed loading knowledge graph');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modelName, space, minSimilarity]);

  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    const q = searchQuery.trim().toLowerCase();
    return graph.nodes.filter((n) => {
      if (kindFilter !== 'all' && n.kind !== kindFilter) return false;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [graph, kindFilter, searchQuery]);

  const visibleNodeSet = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((e) => visibleNodeSet.has(e.source) && visibleNodeSet.has(e.target));
  }, [graph, visibleNodeSet]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph?.nodes || []) map.set(n.id, n);
    return map;
  }, [graph]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) || null : null;

  const selectedConnections = useMemo(() => {
    if (!selectedNodeId || !graph) return [];
    return graph.edges
      .filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
      .map((e) => {
        const peerId = e.source === selectedNodeId ? e.target : e.source;
        return { edge: e, peer: nodeMap.get(peerId) || null };
      })
      .sort((a, b) => b.edge.weight - a.edge.weight);
  }, [selectedNodeId, graph, nodeMap]);

  // Project normalized graph coords [-1, 1]^3 into canvas pixel coordinates + perspective depth
  const projectCoords = (nx: number, ny: number, nz: number, width: number, height: number) => {
    const scale = Math.min(width, height) * 0.41 * zoom;
    if (viewMode === '2d') {
      return {
        cx: width * 0.5 + pan.x + nx * scale,
        cy: height * 0.5 + pan.y + ny * scale,
        depth: 0,
        pScale: 1,
      };
    }

    const cosY = Math.cos(rotation.yaw);
    const sinY = Math.sin(rotation.yaw);
    const cosP = Math.cos(rotation.pitch);
    const sinP = Math.sin(rotation.pitch);

    const x1 = nx * cosY - nz * sinY;
    const z1 = nx * sinY + nz * cosY;
    const y2 = ny * cosP - z1 * sinP;
    const z2 = ny * sinP + z1 * cosP;

    const fov = 2.8;
    const pScale = fov / Math.max(0.9, fov + z2);
    return {
      cx: width * 0.5 + pan.x + x1 * scale * pScale,
      cy: height * 0.5 + pan.y + y2 * scale * pScale,
      depth: z2,
      pScale,
    };
  };

  const projectNode = (n: GraphNode, width: number, height: number) => {
    const nz = typeof n.z === 'number' ? n.z : 0;
    return projectCoords(n.x, n.y, nz, width, height);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background radial glow
    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, width, height);

    if (viewMode === '3d') {
      const steps = 64;
      for (const r of [0.42, 0.78, 1.08]) {
        // XZ equatorial orbital ring
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const theta = (i / steps) * Math.PI * 2;
          const pt = projectCoords(Math.cos(theta) * r, 0, Math.sin(theta) * r, width, height);
          if (i === 0) ctx.moveTo(pt.cx, pt.cy);
          else ctx.lineTo(pt.cx, pt.cy);
        }
        ctx.stroke();

        // XY meridional reference ring
        if (r === 0.78) {
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.10)';
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * Math.PI * 2;
            const pt = projectCoords(Math.cos(theta) * r, Math.sin(theta) * r, 0, width, height);
            if (i === 0) ctx.moveTo(pt.cx, pt.cy);
            else ctx.lineTo(pt.cx, pt.cy);
          }
          ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      for (const r of [0.35, 0.65, 0.92]) {
        ctx.beginPath();
        ctx.arc(width * 0.5 + pan.x, height * 0.5 + pan.y, Math.min(width, height) * 0.41 * r * zoom, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const focusId = hoveredNodeId || selectedNodeId;
    const coords = new Map<string, { cx: number; cy: number; depth: number; pScale: number }>();
    for (const n of visibleNodes) {
      coords.set(n.id, projectNode(n, width, height));
    }

    // Depth-sort edges (average depth back-to-front)
    const sortedEdges = [...visibleEdges].sort((ea, eb) => {
      const da = ((coords.get(ea.source)?.depth ?? 0) + (coords.get(ea.target)?.depth ?? 0)) * 0.5;
      const db = ((coords.get(eb.source)?.depth ?? 0) + (coords.get(eb.target)?.depth ?? 0)) * 0.5;
      return db - da;
    });

    // Draw edges
    for (const e of sortedEdges) {
      const a = coords.get(e.source);
      const b = coords.get(e.target);
      if (!a || !b) continue;
      const isFocused = !focusId || e.source === focusId || e.target === focusId;
      ctx.globalAlpha = focusId ? (isFocused ? 0.95 : 0.14) : 0.70;
      ctx.strokeStyle = EDGE_COLORS[e.relation] || '#64748b';
      ctx.lineWidth = Math.max(1, e.weight * 3.0);
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();

      if (focusId && isFocused) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, (a.cx + b.cx) * 0.5, (a.cy + b.cy) * 0.5 - 3);
      }
    }
    ctx.globalAlpha = 1;

    // Depth-sort nodes back-to-front so foreground nodes overlap distant ones cleanly
    const sortedNodes = [...visibleNodes].sort(
      (na, nb) => (coords.get(nb.id)?.depth ?? 0) - (coords.get(na.id)?.depth ?? 0)
    );

    // Draw nodes
    for (const n of sortedNodes) {
      const p = coords.get(n.id);
      if (!p) continue;
      const style = NODE_COLORS[n.kind];
      const isSelected = n.id === selectedNodeId;
      const isHover = n.id === hoveredNodeId;
      const baseR = n.kind === 'class' ? 12 : n.kind === 'target' ? 9.5 : 8.5;
      const r = Math.max(4.5, baseR * p.pScale);
      const depthFade = viewMode === '3d' ? Math.max(0.42, Math.min(1, 0.88 - p.depth * 0.25)) : 1;

      ctx.save();
      ctx.globalAlpha = isSelected || isHover ? 1 : depthFade;

      if (isSelected || isHover) {
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
        ctx.fill();
      }

      ctx.fillStyle = style.fill;
      ctx.strokeStyle = isSelected ? '#ffffff' : style.stroke;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      ctx.beginPath();
      if (n.kind === 'class') {
        // Diamond hub
        ctx.moveTo(p.cx, p.cy - r);
        ctx.lineTo(p.cx + r, p.cy);
        ctx.lineTo(p.cx, p.cy + r);
        ctx.lineTo(p.cx - r, p.cy);
        ctx.closePath();
      } else if (n.kind === 'feature') {
        // Square molecular feature badge
        ctx.rect(p.cx - r * 0.85, p.cy - r * 0.85, r * 1.7, r * 1.7);
      } else {
        ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#ffffff' : '#e2e8f0';
      ctx.font = n.kind === 'class' ? 'bold 11px "IBM Plex Sans", system-ui, sans-serif' : '10px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, p.cx, p.cy + r + 13);
      ctx.restore();
    }

    // 3D PC1/PC2/PC3 Axis Compass in bottom-right corner
    if (viewMode === '3d' && width > 180 && height > 140) {
      const originX = width - 56;
      const originY = height - 52;
      const axisLen = 28;
      const cosY = Math.cos(rotation.yaw);
      const sinY = Math.sin(rotation.yaw);
      const cosP = Math.cos(rotation.pitch);
      const sinP = Math.sin(rotation.pitch);

      const axes: Array<{ label: string; vec: [number, number, number]; color: string }> = [
        { label: 'PC1', vec: [1, 0, 0], color: '#38bdf8' },
        { label: 'PC2', vec: [0, 1, 0], color: '#34d399' },
        { label: 'PC3', vec: [0, 0, 1], color: '#f59e0b' },
      ];
      for (const ax of axes) {
        const [vx, vy, vz] = ax.vec;
        const x1 = vx * cosY - vz * sinY;
        const z1 = vx * sinY + vz * cosY;
        const y2 = vy * cosP - z1 * sinP;
        const ex = originX + x1 * axisLen;
        const ey = originY + y2 * axisLen;
        ctx.strokeStyle = ax.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.fillStyle = ax.color;
        ctx.font = 'bold 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ax.label, originX + x1 * (axisLen + 11), originY + y2 * (axisLen + 11) + 3);
      }
    }
  }, [visibleNodes, visibleEdges, selectedNodeId, hoveredNodeId, zoom, pan, viewMode, rotation]);

  const hitTestNode = (clientX: number, clientY: number): GraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    // Test closest (foreground) nodes first
    const projected = visibleNodes
      .map((n) => ({ n, p: projectNode(n, rect.width, rect.height) }))
      .sort((a, b) => a.p.depth - b.p.depth);
    for (const { n, p } of projected) {
      if (Math.hypot(mx - p.cx, my - p.cy) <= Math.max(12, 15 * p.pScale)) return n;
    }
    return null;
  };

  return (
    <div className="h-full w-full overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
        <AdminPageHeader
          title="AI Knowledge & Latent Graph"
          subtitle="Explore PyTorch latent embeddings linking sky targets, spectral features, archive templates, and class hubs."
          actions={
            <>
              {graph?.checkpoint_meta && (
                <AdminStatusPill tone={graph.embedding_space === 'trained' ? 'emerald' : 'amber'}>
                  {graph.embedding_space === 'trained'
                    ? `LoRA r=${graph.checkpoint_meta.lora_r} · ${Math.round((graph.checkpoint_meta.val_acc || 0) * 100)}% acc`
                    : 'Untrained Base Prior'}
                </AdminStatusPill>
              )}
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value as ModelArchitecture)}
                className="h-8 rounded-lg border border-white/[0.1] bg-background/80 px-3 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
              >
                <option value="SpectralResNet102">SpectralResNet102</option>
                <option value="DipoleConvNet3D">DipoleConvNet3D</option>
                <option value="AstroFeatureSVM">AstroFeatureSVM</option>
              </select>
              <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSpace('base')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors font-medium',
                    space === 'base' ? 'bg-amber-500/20 text-amber-300' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Base
                </button>
                <button
                  type="button"
                  onClick={() => setSpace('trained')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors font-medium',
                    space === 'trained'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Trained LoRA
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                  setRotation({ yaw: -0.52, pitch: 0.32 });
                }}
              >
                Reset View
              </Button>
            </>
          }
        />

        {/* BAND 2: 4-CARD KPI SUMMARY */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AdminKpiCard
            label="Visible Nodes"
            value={visibleNodes.length}
            delta={`${graph?.nodes.length ?? 0} total in manifold`}
            deltaTone="sky"
            icon={<IconNetwork className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Active Edges"
            value={visibleEdges.length}
            delta={`Threshold cos ≥ ${minSimilarity.toFixed(2)}`}
            deltaTone="muted"
            icon={<IconActivity className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Embedding Space"
            value={space === 'trained' ? 'Fine-Tuned' : 'Base Prior'}
            delta={
              graph?.checkpoint_meta
                ? `LoRA r=${graph.checkpoint_meta.lora_r} · ${Math.round((graph.checkpoint_meta.val_acc || 0) * 100)}% val`
                : 'Unadapted encoder'
            }
            deltaTone={space === 'trained' ? 'emerald' : 'amber'}
            icon={<IconLayers className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Backbone Architecture"
            value={modelName}
            delta={viewMode === '3d' ? '3D Galaxy Orbit' : '2D Projection'}
            deltaTone="muted"
            icon={<IconCpu className="h-4 w-4" />}
          />
        </div>

        {/* BAND 3: GRAPH WORKSPACE + NODE INSPECTOR */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* LEFT: GRAPH CARD */}
          <div className="admin-surface rounded-xl overflow-hidden lg:col-span-8 flex flex-col">
            {/* FILTER & PROJECTION HEADER */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'target', 'class', 'feature', 'template'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(k)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      kindFilter === k
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-white/[0.04] text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {k === 'all' ? 'All Nodes' : NODE_COLORS[k].label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setViewMode('3d')}
                    className={cn(
                      'px-2 py-0.5 rounded transition-colors font-medium',
                      viewMode === '3d' ? 'bg-primary/20 text-sky-300' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    3D
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('2d')}
                    className={cn(
                      'px-2 py-0.5 rounded transition-colors font-medium',
                      viewMode === '2d' ? 'bg-primary/20 text-sky-300' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    2D
                  </button>
                </div>

                {viewMode === '3d' && (
                  <Button
                    size="sm"
                    variant={autoOrbit ? 'default' : 'outline'}
                    className="h-7 rounded-md px-2.5 text-[11px]"
                    onClick={() => setAutoOrbit((v) => !v)}
                  >
                    {autoOrbit ? 'Orbit: ON' : 'Orbit: OFF'}
                  </Button>
                )}

                <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-background/60 px-2.5 py-1">
                  <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                    sim {minSimilarity.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={0.85}
                    step={0.05}
                    value={minSimilarity}
                    onChange={(e) => setMinSimilarity(Number(e.target.value))}
                    className="w-16 accent-primary"
                  />
                </div>

                <AdminSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Filter node..."
                  className="w-40 sm:w-44"
                />
              </div>
            </div>

            {/* CANVAS STAGE */}
            <div className="relative h-[460px] lg:h-[580px] overflow-hidden bg-black/35">
              {loading && !graph && (
                <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground z-10">
                  Computing PyTorch embedding graph...
                </div>
              )}
              {error && (
                <div className="absolute top-3 left-3 z-10 rounded-lg border border-rose-500/35 bg-rose-500/15 px-3 py-1.5 text-xs text-rose-200">
                  {error}
                </div>
              )}
              <canvas
                ref={canvasRef}
                className="w-full h-full cursor-grab active:cursor-grabbing"
                onWheel={(e) => {
                  e.preventDefault();
                  setZoom((z) => Math.max(0.55, Math.min(2.4, z * (e.deltaY < 0 ? 1.08 : 0.92))));
                }}
                onMouseDown={(e) => {
                  dragRef.current = { active: true, x: e.clientX, y: e.clientY, moved: false };
                }}
                onMouseMove={(e) => {
                  if (dragRef.current.active) {
                    const dx = e.clientX - dragRef.current.x;
                    const dy = e.clientY - dragRef.current.y;
                    if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
                    dragRef.current.x = e.clientX;
                    dragRef.current.y = e.clientY;
                    setAutoOrbit(false);
                    if (viewMode === '3d' && !e.shiftKey) {
                      setRotation((r) => ({
                        yaw: r.yaw + dx * 0.008,
                        pitch: Math.max(-1.2, Math.min(1.2, r.pitch + dy * 0.008)),
                      }));
                    } else {
                      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
                    }
                  } else {
                    const hit = hitTestNode(e.clientX, e.clientY);
                    setHoveredNodeId(hit ? hit.id : null);
                  }
                }}
                onMouseUp={(e) => {
                  const wasMoved = dragRef.current.moved;
                  dragRef.current.active = false;
                  if (!wasMoved) {
                    const hit = hitTestNode(e.clientX, e.clientY);
                    if (hit) setSelectedNodeId(hit.id);
                  }
                }}
                onMouseLeave={() => {
                  dragRef.current.active = false;
                  setHoveredNodeId(null);
                }}
              />

              {/* LEGEND OVERLAY */}
              <div className="absolute bottom-3 left-3 rounded-lg border border-white/[0.08] bg-card/90 backdrop-blur px-3 py-1.5 text-[11px] flex flex-wrap items-center gap-3">
                {(['target', 'class', 'feature', 'template'] as NodeKind[]).map((k) => (
                  <span key={k} className="flex items-center gap-1.5 text-foreground/90">
                    <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: NODE_COLORS[k].fill }} />
                    {NODE_COLORS[k].label}
                  </span>
                ))}
                <span className="text-muted-foreground font-mono text-[10px] border-l border-white/[0.08] pl-2.5">
                  {viewMode === '3d' ? 'Drag: 3D orbit · Shift+Drag: pan · Wheel: zoom' : 'Drag: pan · Wheel: zoom'}
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: NODE & RELATIONSHIP INSPECTOR */}
          <aside className="lg:col-span-4 flex flex-col gap-5">
            {selectedNode ? (
              <>
                <div className="admin-surface rounded-xl overflow-hidden">
                  <div className="border-b border-white/[0.07] px-4 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'text-[11px] font-medium px-2 py-0.5 rounded-full border',
                          NODE_COLORS[selectedNode.kind].badge
                        )}
                      >
                        {NODE_COLORS[selectedNode.kind].label}
                      </span>
                      {selectedNode.meta.ra !== undefined && (
                        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                          {Number(selectedNode.meta.ra).toFixed(3)}°, {Number(selectedNode.meta.dec).toFixed(3)}°
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-foreground mt-2">{selectedNode.label}</h3>
                  </div>

                  <div className="p-4 text-xs flex flex-col gap-3">
                    {selectedNode.kind === 'target' && (
                      <>
                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="admin-surface-subtle rounded-lg px-3 py-2">
                            <span className="text-[11px] text-muted-foreground block">CH4 3.32µm</span>
                            <span className="font-mono font-semibold text-amber-300 tabular-nums">
                              {selectedNode.meta.ch4_332_depth}
                            </span>
                          </div>
                          <div className="admin-surface-subtle rounded-lg px-3 py-2">
                            <span className="text-[11px] text-muted-foreground block">H2O 3.05µm</span>
                            <span className="font-mono font-semibold text-sky-300 tabular-nums">
                              {selectedNode.meta.h2o_305_depth}
                            </span>
                          </div>
                          <div className="admin-surface-subtle rounded-lg px-3 py-2">
                            <span className="text-[11px] text-muted-foreground block">D5/D2 Color</span>
                            <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                              {selectedNode.meta.ir_color_d5_d2}
                            </span>
                          </div>
                          <div className="admin-surface-subtle rounded-lg px-3 py-2">
                            <span className="text-[11px] text-muted-foreground block">Domain</span>
                            <span className="font-medium text-foreground truncate block">
                              {selectedNode.meta.domain_class}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Link
                            to={`/admin/internals?target=${encodeURIComponent(selectedNode.meta.target_id || '')}`}
                            className="flex-1"
                          >
                            <Button size="sm" className="w-full rounded-lg text-xs">
                              Inspect in Co-Pilot →
                            </Button>
                          </Link>
                          <Link to={`/explore?tab=navigator&ra=${selectedNode.meta.ra}&dec=${selectedNode.meta.dec}`}>
                            <Button size="sm" variant="outline" className="rounded-lg text-xs">
                              Sky View
                            </Button>
                          </Link>
                        </div>
                      </>
                    )}
                    {selectedNode.kind !== 'target' && (
                      <pre className="admin-surface-subtle rounded-lg p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">
                        {JSON.stringify(selectedNode.meta, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>

                <div className="admin-surface rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
                    <h3 className="text-sm font-semibold text-foreground">Connected Relationships</h3>
                    <AdminStatusPill tone="muted">{selectedConnections.length}</AdminStatusPill>
                  </div>
                  <div className="max-h-[340px] overflow-y-auto divide-y divide-white/[0.06]">
                    {selectedConnections.map(({ edge, peer }, idx) => (
                      <button
                        key={`${edge.source}-${edge.target}-${idx}`}
                        type="button"
                        onClick={() => peer && setSelectedNodeId(peer.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">
                            {peer?.label || edge.target}
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground">
                            {edge.relation} · {edge.label}
                          </div>
                        </div>
                        <AdminStatusPill tone="sky">{edge.weight.toFixed(2)}</AdminStatusPill>
                      </button>
                    ))}
                    {selectedConnections.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                        No relationships pass current similarity threshold ({minSimilarity.toFixed(2)}).
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="admin-surface rounded-xl p-6 text-center text-xs text-muted-foreground">
                Click any node in the graph to inspect relationships.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default DecisionBoundaries;
