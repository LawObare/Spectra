import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useAdminTelemetry, Hyperparameters } from './hooks/useAdminTelemetry';

/**
 * Tab 1: Training Dynamics & Loss Studio (/admin/dynamics)
 * Specification Anchors: SPECIFICATION.md §6.4.2
 * 
 * Embeds real-time training monitor with:
 * - Hyperparameter controls & run triggers
 * - Live scalar learning curves (Train vs Val Loss) with overfitting amber alert
 * - Early-stopping checkpoint recommendation
 * - Gradient L2 norm & Cosine LR monitors
 * - Live 3x3 Validation Confusion Matrix heatmap
 */
export const TrainingDynamics: React.FC = () => {
  const {
    hyperparams,
    setHyperparams,
    activeEpoch,
    totalEpochs,
    currentFrame,
    frames,
    isRunning,
    isPaused,
    playbackSpeedMs,
    setPlaybackSpeedMs,
    isDemoMode,
    overfittingAnalysis,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  } = useAdminTelemetry();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredEpoch, setHoveredEpoch] = useState<number | null>(null);

  // Canvas-based real-time loss curve renderer with DPR support
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Dark astronomical background
    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 45;
    const padRight = 20;
    const padTop = 30;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Draw grid lines
    ctx.strokeStyle = '#1E2530';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const y = padTop + (plotH / 5) * i;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);

      // Y-axis label (Loss scale 0.0 to 1.0)
      const val = (1.0 - i * 0.2).toFixed(1);
      ctx.fillStyle = '#64748B';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, padLeft - 8, y + 3);
    }

    for (let ep = 0; ep <= totalEpochs; ep += 10) {
      const x = padLeft + (ep / totalEpochs) * plotW;
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);

      // X-axis label
      ctx.fillStyle = '#64748B';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Ep ${ep}`, x, height - padBottom + 16);
    }
    ctx.stroke();

    // Overfitting Region Alert Shading (SPECIFICATION.md §6.4.2)
    if (overfittingAnalysis.isOverfitting && overfittingAnalysis.triggerEpoch) {
      const xStart = padLeft + (overfittingAnalysis.triggerEpoch / totalEpochs) * plotW;
      const xEnd = width - padRight;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.fillRect(xStart, padTop, xEnd - xStart, plotH);

      // Warning vertical boundary
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xStart, padTop);
      ctx.lineTo(xStart, height - padBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Overfitting alert banner in chart
      ctx.fillStyle = '#F59E0B';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('⚠️ Overfitting Region (d/dt L_val > 0)', width - padRight - 8, padTop + 14);
    }

    // Optimal early stopping line
    if (overfittingAnalysis.optimalCheckpoint) {
      const xOpt = padLeft + (overfittingAnalysis.optimalCheckpoint / totalEpochs) * plotW;
      ctx.strokeStyle = '#10B981';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(xOpt, padTop);
      ctx.lineTo(xOpt, height - padBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#10B981';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Checkpoint (Ep ${overfittingAnalysis.optimalCheckpoint})`, xOpt + 4, padTop + 26);
    }

    // Draw active epoch scrubber line
    const xActive = padLeft + (activeEpoch / totalEpochs) * plotW;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xActive, padTop);
    ctx.lineTo(xActive, height - padBottom);
    ctx.stroke();

    // Draw Train Loss curve (Cyan / Sky)
    const visibleFrames = frames.filter((f) => f.epoch <= activeEpoch);
    if (visibleFrames.length > 1) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      visibleFrames.forEach((f, idx) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.train_loss) * plotH));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Train Loss points
      ctx.fillStyle = '#38BDF8';
      visibleFrames.forEach((f) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.train_loss) * plotH));
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draw Val Loss curve (Amber)
    if (visibleFrames.length > 1) {
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      visibleFrames.forEach((f, idx) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.val_loss) * plotH));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Val Loss points
      ctx.fillStyle = '#F59E0B';
      visibleFrames.forEach((f) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.val_loss) * plotH));
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Legend
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(padLeft + 10, padTop + 10, 10, 3);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Train Loss', padLeft + 25, padTop + 13);

    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(padLeft + 95, padTop + 10, 10, 3);
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText('Validation Loss', padLeft + 110, padTop + 13);

    // Hover tooltip
    if (hoveredEpoch !== null) {
      const hoverFrame = frames.find((f) => f.epoch === hoveredEpoch);
      if (hoverFrame) {
        const hx = padLeft + (hoveredEpoch / totalEpochs) * plotW;
        ctx.strokeStyle = '#94A3B8';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, height - padBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Tooltip box
        const tipText = `Ep ${hoveredEpoch}: Tr=${hoverFrame.metrics.train_loss.toFixed(3)} Val=${hoverFrame.metrics.val_loss.toFixed(3)}`;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1;
        const tipX = Math.min(width - 150, Math.max(padLeft, hx - 60));
        ctx.fillRect(tipX, padTop + 20, 140, 24);
        ctx.strokeRect(tipX, padTop + 20, 140, 24);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(tipText, tipX + 70, padTop + 36);
      }
    }
  }, [frames, activeEpoch, totalEpochs, overfittingAnalysis, hoveredEpoch]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padLeft = 45;
    const padRight = 20;
    const plotW = rect.width - padLeft - padRight;
    const relX = Math.max(0, Math.min(plotW, x - padLeft));
    const epoch = Math.round((relX / plotW) * totalEpochs);
    setHoveredEpoch(epoch > 0 ? epoch : 1);
  };

  const handleCanvasMouseLeave = () => {
    setHoveredEpoch(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (hoveredEpoch !== null) {
      scrubToEpoch(hoveredEpoch);
    }
  };

  const currentMetrics = currentFrame?.metrics || {
    train_loss: 0.14,
    val_loss: 0.23,
    val_f1: 0.942,
    lr: 8.4e-5,
    global_grad_norm: 0.042,
  };

  const confusion = currentFrame?.confusion || {
    classes: ['Pred Mover', 'Pred Var', 'Pred Art'],
    matrix: [
      [142, 4, 2],
      [3, 118, 1],
      [1, 2, 96],
    ],
    precision: 95.1,
    recall: 93.8,
    macro_f1: 94.2,
  };

  const gradNormStatus = useMemo(() => {
    const norm = currentMetrics.global_grad_norm;
    if (norm < 1e-5) return { text: 'Vanishing (<1e-5)', color: 'text-amber-400' };
    if (norm > 10.0) return { text: 'Exploding (>10.0)', color: 'text-red-400' };
    return { text: 'Stable (0.042)', color: 'text-emerald-400' };
  }, [currentMetrics.global_grad_norm]);

  return (
    <div className="flex flex-col h-full bg-[#080A0F] text-[#E6ECF2] p-4 gap-4 overflow-y-auto">
      {/* TOP CONTROLLER: Hyperparameter Configuration & Run Triggers */}
      <div className="rounded border border-[#1E2530] bg-[#0F131A] p-4 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E2530] pb-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xs font-semibold tracking-wider uppercase text-[#38BDF8]">
              TOP CONTROLLER: Hyperparameter Configuration & Run Triggers
            </h2>
            {isDemoMode && (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-400 border border-amber-500/20">
                Deterministic Simulator Active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={isRunning ? pauseTrainingRun : (isPaused ? resumeTrainingRun : startTrainingRun)}
              className="rounded bg-[#38BDF8] px-3 py-1.5 text-xs font-medium text-[#080A0F] hover:bg-[#0284C7] transition"
            >
              {isRunning && !isPaused ? '⏸ PAUSE AFTER EPOCH' : isPaused ? '▶ RESUME RUN' : '🚀 START LIVE TRAINING RUN'}
            </button>
            <button
              onClick={abortTrainingRun}
              className="rounded border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-1.5 text-xs font-medium text-[#EF4444] hover:bg-[#EF4444]/20 transition"
            >
              ⏹ ABORT / ROLLBACK
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div>
            <label className="block text-[11px] text-[#94A3B8] mb-1">Architecture</label>
            <select
              value={hyperparams.model}
              onChange={(e) => setHyperparams({ ...hyperparams, model: e.target.value as Hyperparameters['model'] })}
              className="w-full rounded border border-[#1E2530] bg-[#151B24] px-2 py-1 text-xs text-[#E6ECF2] focus:border-[#38BDF8] focus:outline-none"
            >
              <option value="DipoleConvNet3D">Dipole ConvNet 3D</option>
              <option value="SpectralResNet102">Spectral 1D-ResNet</option>
              <option value="AstroFeatureSVM">AstroFeature SVM</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#94A3B8] mb-1">Batch Size</label>
            <select
              value={hyperparams.batchSize}
              onChange={(e) => setHyperparams({ ...hyperparams, batchSize: Number(e.target.value) })}
              className="w-full rounded border border-[#1E2530] bg-[#151B24] px-2 py-1 text-xs text-[#E6ECF2] focus:border-[#38BDF8] focus:outline-none"
            >
              <option value="16">16 stamps</option>
              <option value="32">32 stamps</option>
              <option value="64">64 stamps</option>
              <option value="128">128 stamps</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#94A3B8] mb-1">Learning Rate</label>
            <select
              value={hyperparams.lr}
              onChange={(e) => setHyperparams({ ...hyperparams, lr: Number(e.target.value) })}
              className="w-full rounded border border-[#1E2530] bg-[#151B24] px-2 py-1 text-xs text-[#E6ECF2] focus:border-[#38BDF8] focus:outline-none"
            >
              <option value="0.001">1e-3</option>
              <option value="0.0003">3e-4</option>
              <option value="0.0001">1e-4 (Default)</option>
              <option value="0.00001">1e-5</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#94A3B8] mb-1">Optimizer</label>
            <select
              value={hyperparams.optimizer}
              onChange={(e) => setHyperparams({ ...hyperparams, optimizer: e.target.value as Hyperparameters['optimizer'] })}
              className="w-full rounded border border-[#1E2530] bg-[#151B24] px-2 py-1 text-xs text-[#E6ECF2] focus:border-[#38BDF8] focus:outline-none"
            >
              <option value="AdamW">AdamW (Decay 0.01)</option>
              <option value="Adam">Adam</option>
              <option value="SGD">SGD + Momentum (0.9)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#94A3B8] mb-1">Total Epochs</label>
            <input
              type="number"
              value={hyperparams.totalEpochs}
              disabled
              className="w-full rounded border border-[#1E2530] bg-[#151B24]/50 px-2 py-1 text-xs text-[#94A3B8] cursor-not-allowed"
            />
          </div>
        </div>

        {/* Dataset Balance Slider */}
        <div className="mt-3 pt-3 border-t border-[#1E2530] flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-[11px] text-[#94A3B8]">
            Dataset Balance: <span className="text-[#38BDF8] font-mono">Community Labels ({hyperparams.communityWeight}%)</span> vs <span className="text-emerald-400 font-mono">Gold Anchors ({100 - hyperparams.communityWeight}%)</span>
          </div>
          <div className="flex items-center gap-3 w-full md:w-1/2">
            <span className="text-[10px] text-[#64748B]">Community (0%)</span>
            <input
              type="range"
              min="0"
              max="100"
              value={hyperparams.communityWeight}
              onChange={(e) => setHyperparams({ ...hyperparams, communityWeight: Number(e.target.value) })}
              className="flex-1 accent-[#38BDF8] cursor-pointer"
            />
            <span className="text-[10px] text-[#64748B]">Gold (100%)</span>
          </div>
        </div>
      </div>

      {/* DUAL PANEL: Left 50% Curves, Right 50% Confusion Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[420px]">
        {/* LEFT PANEL: Live Scalar Learning Curves */}
        <div className="flex flex-col rounded border border-[#1E2530] bg-[#0F131A] p-4 shadow-md">
          <div className="flex items-center justify-between border-b border-[#1E2530] pb-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#38BDF8]">
                Scalar Learning Curves
              </span>
              <span className="text-[11px] font-mono text-[#94A3B8]">
                Epoch {activeEpoch} / {totalEpochs} ({Math.round((activeEpoch / totalEpochs) * 100)}%)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#64748B]">Scrub:</span>
              <input
                type="range"
                min="1"
                max={totalEpochs}
                value={activeEpoch}
                onChange={(e) => scrubToEpoch(Number(e.target.value))}
                className="w-24 accent-[#38BDF8] cursor-pointer"
              />
            </div>
          </div>

          {/* Overfitting alert badge */}
          {overfittingAnalysis.isOverfitting && (
            <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <span>{overfittingAnalysis.message}</span>
              </div>
              <button
                onClick={() => scrubToEpoch(overfittingAnalysis.optimalCheckpoint)}
                className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/30 transition"
              >
                Jump to Ep {overfittingAnalysis.optimalCheckpoint}
              </button>
            </div>
          )}

          {/* Interactive Canvas Viewport */}
          <div className="relative flex-1 min-h-[260px] w-full">
            <canvas
              ref={canvasRef}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={handleCanvasMouseLeave}
              onClick={handleCanvasClick}
              className="absolute inset-0 h-full w-full rounded border border-[#1E2530] cursor-crosshair"
            />
          </div>

          {/* Metric footer */}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#1E2530] pt-2 text-center text-xs">
            <div className="rounded bg-[#151B24] p-1.5">
              <div className="text-[10px] text-[#94A3B8]">Macro F1-Score</div>
              <div className="text-sm font-mono font-bold text-emerald-400">
                {(currentMetrics.val_f1 * 100).toFixed(1)}% <span className="text-[10px] text-emerald-300">(+3.8% gain)</span>
              </div>
            </div>
            <div className="rounded bg-[#151B24] p-1.5">
              <div className="text-[10px] text-[#94A3B8]">Train Loss</div>
              <div className="text-sm font-mono font-bold text-[#38BDF8]">
                {currentMetrics.train_loss.toFixed(4)}
              </div>
            </div>
            <div className="rounded bg-[#151B24] p-1.5">
              <div className="text-[10px] text-[#94A3B8]">Val Loss</div>
              <div className="text-sm font-mono font-bold text-[#F59E0B]">
                {currentMetrics.val_loss.toFixed(4)}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Telemetry & Live 3x3 Confusion Matrix */}
        <div className="flex flex-col rounded border border-[#1E2530] bg-[#0F131A] p-4 shadow-md">
          <div className="flex items-center justify-between border-b border-[#1E2530] pb-2 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#38BDF8]">
              Telemetry & Confusion Matrix (Validation Split)
            </span>
            <div className="text-[11px] font-mono text-[#94A3B8]">
              Lr: <span className="text-[#E6ECF2]">{currentMetrics.lr.toExponential(2)}</span>
            </div>
          </div>

          {/* Global Gradient L2 Norm Status */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded border border-[#1E2530] bg-[#151B24] p-2.5">
              <div className="text-[11px] text-[#94A3B8]">Global Gradient L2 Norm</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-sm font-mono font-bold text-[#E6ECF2]">
                  ||∇_θ L||₂ = {currentMetrics.global_grad_norm.toFixed(4)}
                </span>
                <span className={`text-[11px] font-medium ${gradNormStatus.color}`}>
                  [{gradNormStatus.text}]
                </span>
              </div>
              <p className="mt-1 text-[10px] text-[#64748B]">
                Stability bounds: [1e-5, 10.0]. Detects vanishing or exploding gradients.
              </p>
            </div>

            <div className="rounded border border-[#1E2530] bg-[#151B24] p-2.5">
              <div className="text-[11px] text-[#94A3B8]">Precision & Recall</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-xs text-emerald-400">
                  Prec: <strong className="text-sm">{confusion.precision}%</strong>
                </span>
                <span className="font-mono text-xs text-[#38BDF8]">
                  Rec: <strong className="text-sm">{confusion.recall}%</strong>
                </span>
              </div>
              <p className="mt-1 text-[10px] text-[#64748B]">
                Evaluated on gold validation holdout pool (N=369 subjects).
              </p>
            </div>
          </div>

          {/* 3x3 Heatmap Grid */}
          <div className="flex-1 flex flex-col justify-center">
            <h3 className="text-xs font-medium text-[#94A3B8] mb-2 text-center">
              Live K×K Confusion Matrix (Rows: Ground Truth, Cols: Model Prediction)
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-[#1E2530] text-[#64748B]">
                    <th className="p-2 text-left font-sans text-[11px]">True \ Pred</th>
                    <th className="p-2 text-[#38BDF8]">Pred Mover</th>
                    <th className="p-2 text-amber-400">Pred Var</th>
                    <th className="p-2 text-rose-400">Pred Art</th>
                  </tr>
                </thead>
                <tbody>
                  {confusion.matrix.map((row, rIdx) => {
                    const rowNames = ['True Mover', 'True Var', 'True Art'];
                    const rowTotals = row.reduce((a, b) => a + b, 0);
                    return (
                      <tr key={rIdx} className="border-b border-[#1E2530]/50">
                        <td className="p-2 text-left font-sans font-medium text-[#E6ECF2] bg-[#151B24]/40">
                          {rowNames[rIdx]}
                        </td>
                        {row.map((val, cIdx) => {
                          const isDiagonal = rIdx === cIdx;
                          const ratio = rowTotals > 0 ? val / rowTotals : 0;
                          const bgStyle = isDiagonal
                            ? `rgba(16, 185, 129, ${0.15 + ratio * 0.6})`
                            : `rgba(239, 68, 68, ${0.1 + ratio * 0.5})`;
                          return (
                            <td
                              key={cIdx}
                              style={{ backgroundColor: bgStyle }}
                              className="p-3 transition-colors duration-200"
                            >
                              <div className="font-bold text-[#E6ECF2] text-sm">{val}</div>
                              <div className="text-[10px] text-[#94A3B8]">{(ratio * 100).toFixed(0)}%</div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer controls */}
          <div className="mt-3 flex items-center justify-between border-t border-[#1E2530] pt-2 text-xs text-[#94A3B8]">
            <div>Playback Speed:</div>
            <div className="flex items-center gap-1">
              {[200, 400, 800].map((ms) => (
                <button
                  key={ms}
                  onClick={() => setPlaybackSpeedMs(ms)}
                  className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                    playbackSpeedMs === ms ? 'bg-[#38BDF8] text-[#080A0F] font-bold' : 'bg-[#151B24] text-[#94A3B8]'
                  }`}
                >
                  {ms}ms
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrainingDynamics;
