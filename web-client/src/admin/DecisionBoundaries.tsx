import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { ModelArchitecture } from './hooks/useAdminTelemetry';
import { cn } from '../lib/utils';

type NodeKind = 'target' | 'class' | 'feature' | 'template';

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ active: boolean; x: number; y: number; moved: boolean }>({ active: false, x: 0, y: 0, moved: false });

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

  // Project normalized graph coords [-1, 1] into canvas pixel coordinates
  const projectNode = (n: GraphNode, width: number, height: number) => {
    const scale = Math.min(width, height) * 0.41 * zoom;
    return {
      cx: width * 0.5 + pan.x + n.x * scale,
      cy: height * 0.5 + pan.y + n.y * scale,
    };
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
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (const r of [0.35, 0.65, 0.92]) {
      ctx.beginPath();
      ctx.arc(width * 0.5 + pan.x, height * 0.5 + pan.y, Math.min(width, height) * 0.41 * r * zoom, 0, Math.PI * 2);
      ctx.stroke();
    }

    const focusId = hoveredNodeId || selectedNodeId;
    const coords = new Map<string, { cx: number; cy: number }>();
    for (const n of visibleNodes) {
      coords.set(n.id, projectNode(n, width, height));
    }

    // Draw edges
    for (const e of visibleEdges) {
      const a = coords.get(e.source);
      const b = coords.get(e.target);
      if (!a || !b) continue;
      const isFocused = !focusId || e.source === focusId || e.target === focusId;
      ctx.globalAlpha = focusId ? (isFocused ? 0.95 : 0.14) : 0.72;
      ctx.strokeStyle = EDGE_COLORS[e.relation] || '#64748b';
      ctx.lineWidth = Math.max(1, e.weight * 3.0);
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();

      if (focusId && isFocused) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, (a.cx + b.cx) * 0.5, (a.cy + b.cy) * 0.5 - 3);
      }
    }
    ctx.globalAlpha = 1;

    // Draw nodes
    for (const n of visibleNodes) {
      const p = coords.get(n.id);
      if (!p) continue;
      const style = NODE_COLORS[n.kind];
      const isSelected = n.id === selectedNodeId;
      const isHover = n.id === hoveredNodeId;
      const r = n.kind === 'class' ? 12 : n.kind === 'target' ? 9.5 : 8.5;

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
      ctx.font = n.kind === 'class' ? 'bold 11px system-ui, sans-serif' : '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, p.cx, p.cy + r + 13);
    }
  }, [visibleNodes, visibleEdges, selectedNodeId, hoveredNodeId, zoom, pan]);

  const hitTestNode = (clientX: number, clientY: number): GraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    for (const n of visibleNodes) {
      const { cx, cy } = projectNode(n, rect.width, rect.height);
      if (Math.hypot(mx - cx, my - cy) <= 15) return n;
    }
    return null;
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* TOP TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              AI Knowledge & Relationship Graph
            </h2>
            <p className="text-[11px] text-muted-foreground">
              PyTorch latent representations linking Sky Targets, Spectral Features, Archive Templates & AI Class Hubs
            </p>
          </div>
          {graph?.checkpoint_meta && (
            <Badge variant="sky" className="font-mono text-[10px]">
              {graph.embedding_space === 'trained'
                ? `Trained LoRA r=${graph.checkpoint_meta.lora_r} (${Math.round((graph.checkpoint_meta.val_acc || 0) * 100)}% acc)`
                : 'Untrained Base Model'}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={modelName}
            onChange={(e) => setModelName(e.target.value as ModelArchitecture)}
            className="bg-background border border-border rounded px-2 py-1 text-xs font-mono"
          >
            <option value="SpectralResNet102">SpectralResNet102</option>
            <option value="DipoleConvNet3D">DipoleConvNet3D</option>
            <option value="AstroFeatureSVM">AstroFeatureSVM</option>
          </select>

          <div className="flex rounded border border-border bg-secondary/40 p-0.5 font-mono text-[11px]">
            <button
              onClick={() => setSpace('base')}
              className={cn(
                'px-2.5 py-1 rounded transition-colors',
                space === 'base' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-muted-foreground'
              )}
            >
              Base (Untrained)
            </button>
            <button
              onClick={() => setSpace('trained')}
              className={cn(
                'px-2.5 py-1 rounded transition-colors',
                space === 'trained' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-muted-foreground'
              )}
            >
              Trained (SFT/LoRA)
            </button>
          </div>

          <div className="flex items-center gap-1.5 border border-border rounded px-2 py-1 bg-background">
            <span className="text-[10px] font-mono text-muted-foreground">min sim {minSimilarity.toFixed(2)}</span>
            <input
              type="range"
              min={0.1}
              max={0.85}
              step={0.05}
              value={minSimilarity}
              onChange={(e) => setMinSimilarity(Number(e.target.value))}
              className="w-20 accent-primary"
            />
          </div>

          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            Reset View
          </Button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/20 px-5 py-1.5 shrink-0 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'target', 'class', 'feature', 'template'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] border transition-colors',
                kindFilter === k
                  ? 'bg-primary text-primary-foreground border-primary font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {k === 'all' ? 'All Nodes' : NODE_COLORS[k].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-muted-foreground">
            {visibleNodes.length} nodes · {visibleEdges.length} relationships
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter node name..."
            className="bg-background border border-border rounded px-2.5 py-0.5 text-xs w-44"
          />
        </div>
      </div>

      {/* GRAPH CANVAS + INSPECTOR */}
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {loading && !graph && (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground z-10">
              Computing PyTorch embedding graph...
            </div>
          )}
          {error && (
            <div className="absolute top-3 left-3 z-10 rounded border border-rose-500/40 bg-rose-950/70 px-3 py-1.5 text-xs text-rose-200">
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
                setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
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
          <div className="absolute bottom-3 left-3 rounded-md border border-border/80 bg-card/90 backdrop-blur px-3 py-2 text-[10px] flex flex-wrap gap-3">
            {(['target', 'class', 'feature', 'template'] as NodeKind[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: NODE_COLORS[k].fill }} />
                {NODE_COLORS[k].label}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT NODE & RELATIONSHIP INSPECTOR */}
        <aside className="w-[340px] shrink-0 border-l border-border bg-card/40 overflow-y-auto p-4 flex flex-col gap-3">
          {selectedNode ? (
            <>
              <Card className="border-border">
                <CardHeader className="py-2.5 px-3.5 border-b border-border bg-secondary/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-[10px] font-mono px-2 py-0.5 rounded border', NODE_COLORS[selectedNode.kind].badge)}>
                      {NODE_COLORS[selectedNode.kind].label}
                    </span>
                    {selectedNode.meta.ra !== undefined && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {Number(selectedNode.meta.ra).toFixed(3)}°, {Number(selectedNode.meta.dec).toFixed(3)}°
                      </span>
                    )}
                  </div>
                  <CardTitle className="text-sm font-semibold mt-1.5">{selectedNode.label}</CardTitle>
                </CardHeader>
                <CardContent className="p-3.5 text-xs flex flex-col gap-2">
                  {selectedNode.kind === 'target' && (
                    <>
                      <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                        <div className="bg-secondary/30 p-1.5 rounded">
                          <span className="text-muted-foreground block">CH4 3.32µm</span>
                          <span className="text-amber-300 font-bold">{selectedNode.meta.ch4_332_depth}</span>
                        </div>
                        <div className="bg-secondary/30 p-1.5 rounded">
                          <span className="text-muted-foreground block">H2O 3.05µm</span>
                          <span className="text-sky-300 font-bold">{selectedNode.meta.h2o_305_depth}</span>
                        </div>
                        <div className="bg-secondary/30 p-1.5 rounded">
                          <span className="text-muted-foreground block">D5/D2 Color</span>
                          <span className="text-emerald-300 font-bold">{selectedNode.meta.ir_color_d5_d2}</span>
                        </div>
                        <div className="bg-secondary/30 p-1.5 rounded">
                          <span className="text-muted-foreground block">Domain</span>
                          <span className="text-foreground font-bold truncate block">{selectedNode.meta.domain_class}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Link
                          to={`/admin/internals?target=${encodeURIComponent(selectedNode.meta.target_id || '')}`}
                          className="flex-1"
                        >
                          <Button size="sm" className="w-full text-xs">Inspect in Co-Pilot →</Button>
                        </Link>
                        <Link
                          to={`/explore?tab=navigator&ra=${selectedNode.meta.ra}&dec=${selectedNode.meta.dec}`}
                        >
                          <Button size="sm" variant="outline" className="text-xs">Sky View</Button>
                        </Link>
                      </div>
                    </>
                  )}
                  {selectedNode.kind !== 'target' && (
                    <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">
                      {JSON.stringify(selectedNode.meta, null, 2)}
                    </pre>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardHeader className="py-2 px-3.5 border-b border-border bg-secondary/40">
                  <CardTitle className="text-xs font-semibold">
                    Connected Relationships ({selectedConnections.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2 flex flex-col gap-1.5 max-h-[380px] overflow-y-auto">
                  {selectedConnections.map(({ edge, peer }, idx) => (
                    <button
                      key={`${edge.source}-${edge.target}-${idx}`}
                      onClick={() => peer && setSelectedNodeId(peer.id)}
                      className="text-left p-2 rounded border border-border/60 hover:border-primary/60 bg-background/60 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{peer?.label || edge.target}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{edge.relation} · {edge.label}</div>
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                        {edge.weight.toFixed(2)}
                      </Badge>
                    </button>
                  ))}
                  {selectedConnections.length === 0 && (
                    <div className="text-xs text-muted-foreground p-2">
                      No relationships pass current similarity threshold ({minSimilarity.toFixed(2)}).
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Click any node in the graph to inspect relationships.</div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default DecisionBoundaries;
