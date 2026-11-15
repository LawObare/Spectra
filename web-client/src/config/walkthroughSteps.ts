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
  // Chapter 1 — Top Command Bar & Case Workflow (3 cards)
  {
    id: 'header-case-banner',
    chapterId: 'header',
    chapterNumber: 1,
    chapterLabel: 'Welcome',
    routePrefix: '/explore',
    placement: 'center',
    title: 'See What Human Eyes Cannot: 102 Invisible Colors',
    description:
      'Human eyes only see a tiny sliver of light (0.4–0.7 microns). NASA\'s SPHEREx space telescope sees 7× redder (0.75–5.0 µm — millionths of a meter), piercing thick Milky Way dust like night-vision goggles and splitting every star into 102 infrared "barcodes". Track A spots moving or flashing objects and unmasks what they are; Ice Studio hunts frozen ocean ingredients in dark space clouds.',
    tryHint: 'No astronomy background needed—every view translates raw space data into plain human clues.',
  },
  {
    id: 'header-search-catalog',
    chapterId: 'header',
    chapterNumber: 1,
    chapterLabel: 'Welcome',
    routePrefix: '/explore',
    targetSelector: '[data-tour="header-search-catalog"]',
    placement: 'bottom',
    title: 'Type a Star Name or Sky GPS Address (RA/Dec)',
    description:
      'Every spot on the night sky has a permanent GPS-style address called RA & Dec (Right Ascension & Declination). Type any star name (like Barnard\'s Star), paste coordinates, press Ctrl+K / ⌘K to open the quick-jump command search (or Alt+A to jump straight to /admin), or open Source Catalog (24) to explore NASA\'s greatest hits.',
    tryHint: 'Click the Spectra logo anytime to return to the overview page.',
  },
  {
    id: 'header-nav-share',
    chapterId: 'header',
    chapterNumber: 1,
    chapterLabel: 'Welcome',
    routePrefix: '/explore',
    targetSelector: '[data-tour="header-nav-share"]',
    placement: 'bottom',
    title: 'Switch Science Labs, Replay Guide, or Share',
    description:
      'Move smoothly between your 5 science labs here. Found a weird moving dot? Share copies a link with your exact sky spot and settings locked in, and ? Guide lets you replay this full tour—or explain just the tab you are looking at.',
  },

  // Chapter 2 — Tab 1: Sky Map & Sidebar Cutout Installer (4 cards)
  {
    id: 'navigator-layer-toggles',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Map',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-layer-toggles"]',
    placement: 'bottom',
    title: 'Explore the 3D Sky Sphere & Telescope Overlays',
    description:
      'Drag to spin the all-sky dome! Turn on LVF Footprints to see rectangular camera snapshots from SPHEREx\'s 6 infrared detectors, DR1/QR3 Mesh to highlight released NASA sky zones, and Installed (green) to spot regions already saved locally for instant zero-wait viewing.',
    tryHint: 'Scroll to zoom into dense starfields; each green square is ready offline.',
  },
  {
    id: 'navigator-sidebar-toggle',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Map',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-sidebar-toggle"]',
    placement: 'left',
    title: 'Open the Coverage & Cutout Sidebar Here',
    description:
      'See this sidebar icon in the top-right corner? It opens your SPHEREx Coverage Preview drawer—where you pick how wide a photo stamp to capture and install sky regions onto your device. Let\'s open it automatically on the next card!',
    tryHint: 'Click this button anytime to show or tuck away the right-hand cutout drawer.',
  },
  {
    id: 'navigator-cutout-controls',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Map',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-cutout-controls"]',
    placement: 'left',
    title: 'Why Install Cutouts Instead of Querying Live?',
    description:
      'A Full Moon spans 1,800 arcseconds (") across; a 300" Cutout Size captures a slice 1/6th of a Moon wide (where each tiny pixel is 6.2"—about a coin seen a mile away!). Query Selected Coverage fetches from NASA live (waiting ~10–30s as multi-date frames align), whereas clicking Install Cutout Section packs that patch once into Installed Sections below—so Time-Domain, Spectrum, and Ice Studio open instantaneously and offline.',
    tryHint: 'Installing prevents repeat network waits and shares your saved patch across Tabs 2, 3, and 4.',
  },
  {
    id: 'navigator-open-comparator',
    chapterId: 'navigator',
    chapterNumber: 2,
    chapterLabel: 'Sky Map',
    routePrefix: '/explore',
    tab: 'navigator',
    targetSelector: '[data-tour="navigator-open-comparator"]',
    placement: 'left',
    title: 'Send Your Sky Stamp to the Motion Blinker',
    description:
      'Once your target coordinates and box size are ready (or you clicked one of your saved Installed Sections above), hit this button to turn that patch of sky into a multi-month time-lapse.',
  },

  // Chapter 3 — Tab 2: Time-Domain Comparator (4 cards)
  {
    id: 'comparator-target-switch',
    chapterId: 'comparator',
    chapterNumber: 3,
    chapterLabel: 'Time-Domain',
    routePrefix: '/explore',
    tab: 'comparator',
    targetSelector: '[data-tour="comparator-target-switch"]',
    placement: 'bottom',
    title: 'Swap Targets or Browse Your Installed Stamps',
    description:
      'Jump effortlessly between calibrated space mysteries: nearby "failed stars" (brown dwarfs) drifting across the foreground, flickering baby stars veiled in planet-forming dust, or swollen giant stars pulsing like beating hearts.',
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
    title: 'Every Pixel Holds True Heat Brightness (Click Any Dot)',
    description:
      'Unlike a normal JPEG, every square pixel here stores raw laboratory infrared brightness. Click any glowing star dot to lock the blue crosshair onto it, measure how its light changes over time, or drag to circle a discovery.',
    tryHint: 'Use Scale (1X, 2X, 4X) right above the image to zoom in on crowded star pairs.',
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
    title: '6-Month Earth-Orbit Snapshots: Flip Like a Cartoon',
    description:
      'SPHEREx sweeps the whole sky roughly every 6 months, seeing each star from opposite sides of Earth\'s orbit. Press Spacebar (or Play) to blink between dates—a close cosmic neighbor racing past distant background stars visibly hops across pixels!',
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
    title: 'Motion Diff & "Night-Vision" Contrast Boost (Asinh)',
    description:
      'Click Motion Diff [2] to subtract an old snapshot from a new one: steady stars vanish to calm gray, while a moving star splits into a dark shadow beside a bright dot! Space mixes bright suns next to 10,000× dimmer objects—slide Asinh boost like HDR night-vision so faint neighbors glow clearly, or click any D1–D6 band cell below.',
  },

  // Chapter 4 — Tab 3: 102-Band Spectrum (4 cards)
  {
    id: 'spectral-hero-sharpen',
    chapterId: 'spectral',
    chapterNumber: 4,
    chapterLabel: '102-Band Spectrum',
    routePrefix: '/explore',
    tab: 'spectral',
    targetSelector: '[data-tour="spectral-hero-sharpen"]',
    placement: 'bottom',
    title: 'From 6-Crayon Sketch to All 102 Rainbow Colors',
    description:
      'Your fast sky stamp starts with 6 wide color buckets (bands D1–D6 across 0.75–5.0 µm)—great for seeing the overall tilt of brightness. Click Sharpen to 102 Colors (IRSA) to pull all 102 narrow NASA rainbow slices so tiny chemical gas dips snap into crystal clarity.',
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
    title: 'Read Curve Shapes: Blazing Sun (~5,800 K) vs. Oven-Warm Dwarf',
    description:
      'Hot normal stars (~5,800 K, like our Sun) blaze on the left (1 µm) and fade out right. Ultra-cold brown dwarfs cool down to ~250–1,000 K (closer to a kitchen oven than a star!), so they glow bright on the right (4–5 µm) and lose a bite at 3.3 µm eaten by methane gas (CH₄). Dusty stars and distant galaxies look bumpy across the middle.',
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
    title: 'Hover Any Color to Translate What Molecule You\'re Seeing',
    description:
      'Glide your mouse across 0.75–5.0 µm to read live translations—Hot Starlight on the left, Gas & Ice Fingerprints in the middle, Cold Heat Glow on the right. Watch out for amber triangles: those mark telescope detector glitches (like cosmic-ray hits) you shouldn\'t mistake for real dips.',
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
    title: 'Compare % Shape Matches & Lock Your Verdict',
    description:
      'See how closely your object\'s curve matches known NASA objects (% similarity), overlay them right onto your graph, and stamp your Case Report. Still unsure whether a glowing object is cold by nature or reddened behind icy dust? Open Ice Studio to break the tie!',
  },

  // Chapter 5 — Tab 4: Cosmic Ice Studio (3 cards)
  {
    id: 'ice-sightline-picker',
    chapterId: 'ice',
    chapterNumber: 5,
    chapterLabel: 'Ice Studio',
    routePrefix: '/explore',
    tab: 'ice',
    targetSelector: '[data-tour="ice-sightline-picker"]',
    placement: 'right',
    title: 'The Flashlight-Through-Frost Cosmic Experiment',
    description:
      'Inside dark star-forming nurseries at -260 °C (barely 10 degrees above absolute zero!), dust grains freeze over with water ice and dry ice—the exact building blocks of future comets and planet oceans. Pick a distant star behind a cold cloud (like RW Aurigae or Elias 16) to use it as a cosmic flashlight.',
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
    title: 'Sanity Check: Star Beam vs. Empty Sky Ring',
    description:
      'How do we prove ice really sits in front of the star and isn\'t camera noise? Toggle between the green inner Star Beam (light piercing the icy cloud) and the amber Empty Sky Ring beside it—true frozen absorption dips show up ONLY in the star beam!',
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
    title: 'Below 100% = Colors Swallowed by Frozen Water & Dry Ice',
    description:
      'With an empty view, starlight traces the dashed 100% ceiling across the top. Whenever a valley drops—say down to 75% at 3.05 µm—it means 25% of that exact infrared color was physically absorbed by water ice! Dips at 4.27 µm reveal frozen dry ice (CO₂), and 4.67 µm marks frozen carbon monoxide deep inside planet nurseries.',
  },

  // Chapter 6 — Tab 5: Community Forum & Bridge to /admin (2 cards)
  {
    id: 'forum-feed-composer',
    chapterId: 'forum',
    chapterNumber: 6,
    chapterLabel: 'Community Forum',
    routePrefix: '/explore',
    tab: 'discussions',
    targetSelector: '[data-tour="forum-feed-composer"]',
    placement: 'bottom',
    title: 'Log Your Discovery & Compare With Other Explorers',
    description:
      'Publish a field note with your sky coordinates and cutout snapshot automatically attached, tag what you spotted (#mover, #variable, #ice_source), or filter the live feed for Moderator Verified finds nearby.',
  },
  {
    id: 'forum-admin-bridge',
    chapterId: 'forum',
    chapterNumber: 6,
    chapterLabel: 'Next: AI Studio',
    routePrefix: '/explore',
    tab: 'discussions',
    placement: 'center',
    title: 'Explore Complete — Step Inside Spectra AI Studio (/admin)',
    description:
      'Every sky object you inspect can teach Spectra\'s AI! Behind the public sky tools sits Spectra AI Studio (/admin)—a visual Teachable-Machine-style workspace where you collect real sky samples into class cards, train a 102-color classifier in seconds, test live on sky cutouts, review uncertain stars, and export your model.',
    tryHint: 'Jump straight into /admin anytime with Alt+A.',
    ctaNextLabel: 'Go to AI Studio & Continue Tour →',
    secondaryFinishLabel: 'Finish Explore Tour',
  },

  // Chapter 7 — /admin Spectra AI Studio (3 Workspaces, 5 cards)
  {
    id: 'admin-class-cards',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: 'AI Studio',
    routePrefix: '/admin',
    routePath: '/admin/studio',
    targetSelector: '[data-tour="studio-class-cards"]',
    placement: 'right',
    title: 'AI Studio 1/5: Collect Sky Examples in Class Cards',
    description:
      'Each sky category lives in its own draggable card. Click + Add Sky Sample to pick real stars from any installed sky cutout, rename any class inline, remove classes you don\'t need (×), drag cards anywhere on the canvas, or click + Add a Class at the bottom to create new categories.',
    tryHint: 'Need starter data? Click "Seed Demo (60)" in the top bar to load physics-simulated spectra.',
  },
  {
    id: 'admin-train-card',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: 'AI Studio',
    routePrefix: '/admin',
    routePath: '/admin/studio',
    targetSelector: '[data-tour="studio-train-card"]',
    placement: 'bottom',
    title: 'AI Studio 2/5: Train & Manage Real PyTorch Models',
    description:
      'Every class card wires into this Training card. Click Train Model to train a real PyTorch 102-color classifier on CPU in seconds—watch Validation Accuracy (green) climb and Loss (blue) drop live. Saved checkpoints stay in Postgres where you can switch between them, download .pt weights, Delete old runs, or click Reset Model to start fresh.',
    tryHint: 'Want to adjust epochs, learning rate, or LoRA fine-tuning? Expand the Advanced drawer.',
  },
  {
    id: 'admin-preview-card',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: 'AI Studio',
    routePrefix: '/admin',
    routePath: '/admin/studio',
    targetSelector: '[data-tour="studio-preview-card"]',
    placement: 'left',
    title: 'AI Studio 3/5: Pick a Sky Field & Test Live',
    description:
      'Preview stays locked until you train a model—and stays blank until you pick a real sky field from the Input Sky Field dropdown. Once picked, click any star on the cutout (or press Run Model) to see live confidence bars and the key infrared wavelengths behind the guess. Wrong prediction? Pick the right class below and click Save.',
  },
  {
    id: 'admin-review-label',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: 'AI Studio',
    routePrefix: '/admin',
    routePath: '/admin/review',
    targetSelector: '[data-tour="admin-review-workspace"]',
    placement: 'center',
    title: 'AI Studio 4/5: Review & Relabel Uncertain Stars',
    description:
      'You\'re now in Review & Label. Installed sky cutouts are ranked with human-vs-AI disagreements and lowest-confidence targets first. Inspect the cutout and 102-color spectrum, click the true class button to save your label to Postgres, and retrain in Studio whenever you\'re ready.',
  },
  {
    id: 'admin-export-hub',
    chapterId: 'admin',
    chapterNumber: 7,
    chapterLabel: 'AI Studio',
    routePrefix: '/admin',
    routePath: '/admin/exports',
    targetSelector: '[data-tour="admin-exports-workspace"]',
    placement: 'center',
    title: 'AI Studio 5/5: Export Models (.pt) & Data Products',
    description:
      'You\'re now in Export Data & Models. Download your trained PyTorch .pt model checkpoints or export Community Data Products in standard astronomy formats (CSV, JSON, VOTable XML, and FITS). Click Sky Explorer top-right anytime to return to the public sky tools.',
  },
];

export const WALKTHROUGH_CHAPTERS: Array<{
  id: WalkthroughChapterId;
  number: number;
  label: string;
}> = [
  { id: 'header', number: 1, label: 'Welcome' },
  { id: 'navigator', number: 2, label: 'Sky Map' },
  { id: 'comparator', number: 3, label: 'Time-Domain' },
  { id: 'spectral', number: 4, label: 'Spectrum' },
  { id: 'ice', number: 5, label: 'Ice Studio' },
  { id: 'forum', number: 6, label: 'Forum' },
  { id: 'admin', number: 7, label: 'AI Studio' },
];
