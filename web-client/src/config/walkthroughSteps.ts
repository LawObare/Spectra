export type WalkthroughChapterId =
  | 'header'
  | 'navigator'
  | 'comparator'
  | 'spectral'
  | 'ice'
  | 'forum'
  | 'admin';

export type ExploreTabId = 'navigator' | 'comparator' | 'spectral' | 'ice' | 'discussions';

export interface WalkthroughStep {
  id: string;
  chapterId: WalkthroughChapterId;
  chapterNumber: number;
  chapterLabel: string;
  routePrefix: '/explore' | '/admin';
  routePath?: string;
  tab?: ExploreTabId;
  targetSelector?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  title: string;
  description: string;
  tryHint?: string;
  ctaNextLabel?: string;
  secondaryFinishLabel?: string;
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  // Chapter 1 — Top Command Bar & Case Workflow (Explore)
  {
    id: 'header-case-banner',
    chapterId: 'header',
    chapterNumber: 1,
    chapterLabel: 'Command Bar',
    routePrefix: '/explore',
    placement: 'center',
    title: 'Welcome to Spectra: Active Case & Two Tracks',
    description:
      'SPHEREx scans the whole infrared sky every 6 months. Follow Track A (1. Time-Domain -> 2. 102-Band Spectrum) to spot moving or flashing stars and identify them, or test icy dust clouds in Ice Studio.',
    tryHint: 'Watch how the Active Case strip keeps your selected sky target pinned across workspaces.',
  },
  {
    id: 'header-search-catalog',
    chapterId: 'header',
    chapterNumber: 1,
    chapterLabel: 'Command Bar',
    routePrefix: '/explore',
    targetSelector: '[data-tour="header-search-catalog"]',
    placement: 'bottom',
    title: 'Search Any Coordinate or Open Source Catalog (24)',
    description:
      'Type any J2000 coordinate or object name (like Barnard\'s Star or RW Aurigae), press Cmd+K / Ctrl+K for quick commands, or open Source Catalog (24) to pick curated NASA targets.',
    tryHint: 'Mission Briefing toggles the overview page anytime.',
  },
  {
    id: 'header-nav-share',
    chapterId: 'header',
    chapterNumber: 1,
    chapterLabel: 'Command Bar',
    routePrefix: '/explore',
    targetSelector: '[data-tour="header-nav-share"]',
    placement: 'bottom',
    title: 'Workspaces, ? Guide & Reproducible Share Links',
    description:
      'Switch tabs across the sky survey pipeline here. Use Share to copy an exact deep link to your current view, or click ? Guide anytime to replay this full walkthrough or inspect just one tab.',
  },

  // Chapter 2 — Tab 1: Navigator Sky Dome
  {
    id: 'navigator-layer-toggles',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Navigator',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-layer-toggles"]',
    placement: 'bottom',
    title: 'Toggle SPHEREx Footprint & Coverage Meshes',
    description:
      'Switch sky survey overlays on the interactive sphere: LVF Footprints show detector frames, DR1/QR3 Coverage Mesh highlights surveyed regions, and Installed shows green pre-cached cutouts ready for instant playback.',
    tryHint: 'Try dragging the sky dome or zooming with your scroll wheel.',
  },
  {
    id: 'navigator-cutout-controls',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Navigator',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-cutout-controls"]',
    placement: 'left',
    title: 'Set Cutout Box Size & Query/Install Regions',
    description:
      'Adjust RA/Dec or pick a Cutout Size (60" to 600"). Query Selected Coverage checks NASA IRSA exposures here, or you can pick an already-installed cutout for immediate science inspection.',
  },
  {
    id: 'navigator-open-comparator',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Navigator',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-open-comparator"]',
    placement: 'top',
    title: 'Launch Your Sky Stamp in Time-Domain',
    description:
      'Once your target coordinates and box width are set, click this primary button to load all 6-month survey passes into the GPU Time-Domain Comparator.',
  },

  // Chapter 3 — Tab 2: Time-Domain Comparator
  {
    id: 'comparator-target-switch',
    chapterId: 'comparator',
    chapterNumber: 3,
    chapterLabel: 'Time-Domain',
    routePrefix: '/explore',
    tab: 'comparator',
    targetSelector: '[data-tour="comparator-target-switch"]',
    placement: 'bottom',
    title: 'Quickly Swap Targets or Installed Stamps',
    description:
      'Use Switch Target (24) or Browse Installed Cutouts to jump between moving brown dwarfs, flashing young stars, and pulsating giants with visual thumbnails.',
  },
  {
    id: 'comparator-canvas-player',
    chapterId: 'comparator',
    chapterNumber: 3,
    chapterLabel: 'Time-Domain',
    routePrefix: '/explore',
    tab: 'comparator',
    targetSelector: '[data-tour="comparator-canvas-player"]',
    placement: 'right',
    title: 'Inspect Pixels on the WebGL2 Canvas',
    description:
      'Click any glowing dot on the sky stamp to lock the probe crosshair onto that pixel, extract its infrared light curve, or drag/circle interesting discoveries.',
    tryHint: 'Use Scale (Fit, 1X, 2X, 4X) above the image to inspect tight stars.',
  },
  {
    id: 'comparator-playback-modes',
    chapterId: 'comparator',
    chapterNumber: 3,
    chapterLabel: 'Time-Domain',
    routePrefix: '/explore',
    tab: 'comparator',
    targetSelector: '[data-tour="comparator-playback-modes"]',
    placement: 'left',
    title: 'Blink, Diff, or Co-Add Across 6-Month Passes',
    description:
      'Use Play (or Spacebar) and the Epoch pills to flip between survey passes. Switch to Motion Diff [2] to turn moving stars into bright/dark pairs, or Deep Co-Add [3] to boost ultra-faint objects.',
  },
  {
    id: 'comparator-rgb-stretch',
    chapterId: 'comparator',
    chapterNumber: 3,
    chapterLabel: 'Time-Domain',
    routePrefix: '/explore',
    tab: 'comparator',
    targetSelector: '[data-tour="comparator-rgb-stretch"]',
    placement: 'left',
    title: 'Contrast Stretch, Colormaps & Band-Matched Cells',
    description:
      'Slide Faint Contrast Boost (Asinh) to bring out dim glow, pick Grayscale/Viridis colormaps, or click cells in the Coverage Matrix to inspect a specific wavelength detector (D1–D6) and pass.',
  },

  // Chapter 4 — Tab 3: 102-Band Spectrum
  {
    id: 'spectral-hero-sharpen',
    chapterId: 'spectral',
    chapterNumber: 4,
    chapterLabel: '102-Band Spectrum',
    routePrefix: '/explore',
    tab: 'spectral',
    targetSelector: '[data-tour="spectral-hero-sharpen"]',
    placement: 'bottom',
    title: 'Preview Sketch vs. Full 102-Color Resolution',
    description:
      'Every cutout starts with 6 broadband anchor points (D1–D6). Click Sharpen to 102 Colors (IRSA) whenever you want the full 102-channel SPHEREx spectrum to resolve sharp molecular gas dips.',
  },
  {
    id: 'spectral-cheat-sheet',
    chapterId: 'spectral',
    chapterNumber: 4,
    chapterLabel: '102-Band Spectrum',
    routePrefix: '/explore',
    tab: 'spectral',
    targetSelector: '[data-tour="spectral-cheat-sheet"]',
    placement: 'bottom',
    title: 'Read Curve Shapes at a Glance',
    description:
      'Use this 3-shape visual key: Warm Stars slope down toward the right, Cold Brown Dwarfs show a 3.3 um methane dip and climb at 4–5 um, and Galaxies/Dusty Stars show bumpy shifted peaks.',
  },
  {
    id: 'spectral-lab-chart',
    chapterId: 'spectral',
    chapterNumber: 4,
    chapterLabel: '102-Band Spectrum',
    routePrefix: '/explore',
    tab: 'spectral',
    targetSelector: '[data-tour="spectral-lab-chart"]',
    placement: 'top',
    title: 'Hover Any Wavelength for a Live Translation',
    description:
      'Move your cursor across the curve to translate what each infrared wavelength detects (hot starlight vs. gas fingerprints vs. cold heat glow), check amber detector quality flags, and read the 3-point summary card.',
  },
  {
    id: 'spectral-verdict-matches',
    chapterId: 'spectral',
    chapterNumber: 4,
    chapterLabel: '102-Band Spectrum',
    routePrefix: '/explore',
    tab: 'spectral',
    targetSelector: '[data-tour="spectral-verdict-matches"]',
    placement: 'left',
    title: 'Compare Library Matches & Lock In Your Verdict',
    description:
      'Click any reference object below to overlay its shape against your measurement, then stamp your Case Report using the Verdict buttons—or open Ice Studio if dust ice vs. cold star is ambiguous.',
  },

  // Chapter 5 — Tab 4: Cosmic Ice Studio
  {
    id: 'ice-sightline-picker',
    chapterId: 'ice',
    chapterNumber: 5,
    chapterLabel: 'Ice Studio',
    routePrefix: '/explore',
    tab: 'ice',
    targetSelector: '[data-tour="ice-sightline-picker"]',
    placement: 'right',
    title: 'Independent Track: Pick an Icy Cloud Sightline',
    description:
      'Ice Studio tests background stars shining through cold molecular clouds. Choose a cosmic ice sightline (Elias 16, J110621, Orion Nebula) or an installed target like RW Aurigae.',
  },
  {
    id: 'ice-aperture-check',
    chapterId: 'ice',
    chapterNumber: 5,
    chapterLabel: 'Ice Studio',
    routePrefix: '/explore',
    tab: 'ice',
    targetSelector: '[data-tour="ice-aperture-check"]',
    placement: 'right',
    title: 'Star Beam vs. Empty Sky Ring Sanity Test',
    description:
      'Toggle between Star Beam and Empty Sky Ring. Real frozen H2O and CO2 absorb starlight along the green inner beam—not in the empty amber ring beside the star.',
  },
  {
    id: 'ice-studio-transmission',
    chapterId: 'ice',
    chapterNumber: 5,
    chapterLabel: 'Ice Studio',
    routePrefix: '/explore',
    tab: 'ice',
    targetSelector: '[data-tour="ice-studio-transmission"]',
    placement: 'left',
    title: 'Spot Frozen Molecules Below the 100% Baseline',
    description:
      'In % Light Passing Through (zoomed on the 2.4–5 um Ice Zone), valleys hanging below 100% reveal colors swallowed by frozen water (3.05 um), CO2 (4.27 um), and CO (4.67 um) along the beam.',
  },

  // Chapter 6 — Tab 5: Community Forum & Bridge to /admin
  {
    id: 'forum-feed-composer',
    chapterId: 'forum',
    chapterNumber: 6,
    chapterLabel: 'Community Forum',
    routePrefix: '/explore',
    tab: 'discussions',
    targetSelector: '[data-tour="forum-feed-composer"]',
    placement: 'bottom',
    title: 'Publish Observations & Review Citizen Discoveries',
    description:
      'Share your active cutout and verdict with one click, tag findings (#mover, #variable, #ice_source), or filter the sky feed by nearby fields and Moderator Verified discoveries.',
  },
  {
    id: 'forum-admin-bridge',
    chapterId: 'forum',
    chapterNumber: 6,
    chapterLabel: 'Next: /admin AI Lab',
    routePrefix: '/explore',
    tab: 'discussions',
    placement: 'center',
    title: 'Explore Complete — How to Reach /admin Mission Control',
    description:
      'You\'ve covered the entire Sky Explorer suite! Spectra also includes an isolated AI Mission Control (/admin) where models are fine-tuned and disagreements are triaged. Anytime later, open /admin by typing "/admin" in your browser URL bar OR pressing Cmd+K / Ctrl+K and choosing "Open Mission Control (/admin)".',
    tryHint: 'Continue below to open /admin right now and walk through all 5 AI lab workstations.',
    ctaNextLabel: 'Go to /admin & Continue Tour →',
    secondaryFinishLabel: 'Finish Explore Tour',
  },

  // Chapter 7 — /admin Mission Control (All 5 Workstations)
  {
    id: 'admin-dynamics-studio',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: '/admin AI Lab',
    routePrefix: '/admin',
    routePath: '/admin/dynamics',
    targetSelector: '[data-tour="admin-dynamics-actions"]',
    placement: 'bottom',
    title: 'Admin 1/5: Fine-Tuning Studio (/admin/dynamics)',
    description:
      'Welcome to Mission Control! Train CPU PyTorch LoRA adapters with + Train New Model, inspect the generated HF TRL SFTTrainer script, watch live Train/Val loss curves, and Promote checkpoints for inference.',
    tryHint: 'Notice the 5 AI workstations listed in the left sidebar.',
  },
  {
    id: 'admin-exports-buckets',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: '/admin AI Lab',
    routePrefix: '/admin',
    routePath: '/admin/exports',
    targetSelector: '[data-tour="admin-exports-actions"]',
    placement: 'bottom',
    title: 'Admin 2/5: Datasets & Class Buckets (/admin/exports)',
    description:
      'Inspect curated SFT prompt/completion examples across astrophysical classes, verify held-out benchmark pools, and export .jsonl corpora or PyTorch tensor bundles.',
  },
  {
    id: 'admin-live-identify',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: '/admin AI Lab',
    routePrefix: '/admin',
    routePath: '/admin/internals',
    targetSelector: '[data-tour="admin-identify-actions"]',
    placement: 'bottom',
    title: 'Admin 3/5: Live Identification Co-Pilot (/admin/internals)',
    description:
      'Pick an architecture (SpectralResNet102, DipoleConvNet3D, AstroFeatureSVM), click Run Batch Scan, compare base vs. fine-tuned confidences, and inspect Grad-CAM apertures and 102-channel attributions.',
  },
  {
    id: 'admin-embedding-space',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: '/admin AI Lab',
    routePrefix: '/admin',
    routePath: '/admin/boundaries',
    targetSelector: '[data-tour="admin-boundaries-actions"]',
    placement: 'bottom',
    title: 'Admin 4/5: Embedding Space (/admin/boundaries)',
    description:
      'Switch between Base Prior and Trained LoRA embeddings to explore how targets, spectral features, and class hubs cluster in PyTorch latent space.',
  },
  {
    id: 'admin-hard-negative-triage',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: '/admin AI Lab',
    routePrefix: '/admin',
    routePath: '/admin/triage',
    targetSelector: '[data-tour="admin-triage-actions"]',
    placement: 'bottom',
    title: 'Admin 5/5: Hard-Negative Triage & Return to Sky View',
    description:
      'Review high-divergence AI vs. citizen classifications, queue tricky examples into the Hard-Negative Training Buffer, or click Inspect in Comparator / Sky Explorer anytime to jump back to public sky analysis.',
    ctaNextLabel: 'Finish Full Walkthrough',
  },
];

export const WALKTHROUGH_CHAPTERS: Array<{
  id: WalkthroughChapterId;
  number: number;
  label: string;
}> = [
  { id: 'header', number: 1, label: 'Command Bar' },
  { id: 'navigator', number: 2, label: 'Sky Map' },
  { id: 'comparator', number: 3, label: 'Time-Domain' },
  { id: 'spectral', number: 4, label: 'Spectrum' },
  { id: 'ice', number: 5, label: 'Ice Studio' },
  { id: 'forum', number: 6, label: 'Forum' },
  { id: 'admin', number: 7, label: '/admin AI Lab' },
];
