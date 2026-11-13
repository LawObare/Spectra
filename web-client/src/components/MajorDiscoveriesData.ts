/**
 * Major Astronomical Discoveries Catalog for NASA SPHEREx Portal
 * Production-grade catalog organizing all landmark targets across the SPHEREx mission pillars:
 * 1. Nearby Worlds & Brown Dwarfs (Astrometric Motion & Parallax)
 * 2. Water & Biogenic Ices (Interstellar Ice Reservoirs & Origins of Life)
 * 3. Cosmic Inflation & Deep Fields (450M Galaxies & Epoch of Reionization)
 * 4. Galactic Architecture & Supermassive Black Holes
 * 5. Stellar Variables & Transients
 */

export interface MajorDiscovery {
  id: string;
  name: string;
  codename?: string;
  title: string;
  category: 'nearby_worlds' | 'water_ices' | 'deep_fields' | 'galaxies' | 'variables';
  categoryLabel: string;
  ra: number;
  dec: number;
  distanceLightYears?: string;
  spectralType?: string;
  motionRate?: string;
  preset: 'true_nir' | 'brown_dwarf' | 'water_ice' | 'comet_outgassing' | 'custom';
  launchTab: 'comparator' | 'spectral' | 'ice' | 'navigator';
  launchLabel: string;
  badge: '[NASA Benchmark (Pre-cached)]' | '[IRSA Live (spherex_qr2)]' | '[Synthetic Injection Mode]';
  narrative: string;
  scienceGoal: string;
  spectralBands: string;
  isMandatoryBenchmark?: boolean;
}

export const MAJOR_DISCOVERIES: MajorDiscovery[] = [
  // ==========================================
  // 1. NEARBY WORLDS & BROWN DWARFS (MOTION)
  // ==========================================
  {
    id: 'barnard',
    name: "Barnard's Star",
    codename: 'GJ 699',
    title: 'The Cosmic Speed Demon',
    category: 'nearby_worlds',
    categoryLabel: 'Nearby Worlds (Motion)',
    ra: 269.44639,
    dec: 4.76676,
    distanceLightYears: '5.96 ly',
    spectralType: 'M4V Red Dwarf',
    motionRate: '+10.39"/yr North (1.68 px/yr)',
    preset: 'true_nir',
    launchTab: 'comparator',
    launchLabel: 'Track Motion in Time-Domain',
    badge: '[NASA Benchmark (Pre-cached)]',
    narrative:
      'The fastest-moving star in the northern sky. It sprints across the celestial sphere at 10.39 arcseconds per year—shifting noticeably across discrete 6-month SPHEREx survey passes.',
    scienceGoal: 'Measure stellar kinematic velocity and sub-pixel proper motion across 2-year survey baseline.',
    spectralBands: 'Bands 1–3 (0.75–2.42 μm)',
    isMandatoryBenchmark: true,
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    codename: 'WISE J085510.83-071442.5',
    title: 'The Frozen Brown Dwarf',
    category: 'nearby_worlds',
    categoryLabel: 'Nearby Worlds (Motion)',
    ra: 133.73712,
    dec: -7.24038,
    distanceLightYears: '7.53 ly',
    spectralType: 'Y4 Sub-Brown Dwarf',
    motionRate: '8.15"/yr West (1.31 px/yr)',
    preset: 'brown_dwarf',
    launchTab: 'comparator',
    launchLabel: 'Inspect Cold Infrared Mover',
    badge: '[NASA Benchmark (Pre-cached)]',
    narrative:
      'As cold as an ice cube (-10°C / 260 K). It is the fourth-closest system to our Sun and entirely invisible to optical telescopes, glowing exclusively in SPHEREx mid-infrared detectors D5 and D6.',
    scienceGoal: 'Detect atmospheric water clouds and methane absorption in sub-stellar planetary analogs.',
    spectralBands: 'Bands 5–6 (3.82–5.00 μm)',
    isMandatoryBenchmark: true,
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi Ba+Bb',
    codename: 'HD 208313 B',
    title: 'The Invisible Binary Pair',
    category: 'nearby_worlds',
    categoryLabel: 'Nearby Worlds (Motion)',
    ra: 331.09566,
    dec: -56.80031,
    distanceLightYears: '11.87 ly',
    spectralType: 'T1 + T6 Brown Dwarf Binary',
    motionRate: '4.68"/yr SE (0.76 px/yr)',
    preset: 'brown_dwarf',
    launchTab: 'comparator',
    launchLabel: 'Analyze Blended Motion',
    badge: '[NASA Benchmark (Pre-cached)]',
    narrative:
      'Two brown dwarf worlds locked in an orbit so tight they blend into a single 6.2-arcsecond SPHEREx pixel. Demonstrates high-proper-motion 1/cos(dec) astrometric projection in the deep southern sky.',
    scienceGoal: 'Separate orbital displacement from barycentric space motion using multi-epoch differential coadds.',
    spectralBands: 'Bands 2–5 (1.11–4.42 μm)',
    isMandatoryBenchmark: true,
  },
  {
    id: 'trappist1',
    name: 'TRAPPIST-1',
    codename: '2MASS J23062928-0502285',
    title: 'Seven Earth-Sized Worlds',
    category: 'nearby_worlds',
    categoryLabel: 'Nearby Worlds (Motion)',
    ra: 346.62233,
    dec: -5.04144,
    distanceLightYears: '40.66 ly',
    spectralType: 'M8V Ultra-Cool Dwarf',
    motionRate: '1.10"/yr (0.18 px/yr)',
    preset: 'brown_dwarf',
    launchTab: 'spectral',
    launchLabel: 'Extract 102-Band Host Spectrum',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'A compact ultra-cool dwarf star harboring seven temperate terrestrial exoplanets. SPHEREx spectrophotometry characterizes the stellar infrared SED to constrain planetary irradiation environments.',
    scienceGoal: 'Measure molecular water and flare activity across 0.75–5.0 μm.',
    spectralBands: 'Bands 1–6 (0.75–5.00 μm)',
  },
  {
    id: 'proxima',
    name: 'Proxima Centauri',
    codename: 'Alpha Centauri C',
    title: 'Our Closest Stellar Neighbor',
    category: 'nearby_worlds',
    categoryLabel: 'Nearby Worlds (Motion)',
    ra: 217.42894,
    dec: -62.67949,
    distanceLightYears: '4.24 ly',
    spectralType: 'M5.5Ve Flare Star',
    motionRate: '3.85"/yr SW',
    preset: 'true_nir',
    launchTab: 'comparator',
    launchLabel: 'Measure Parallax & Motion',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'The closest known star to the Sun, hosting at least two confirmed exoplanets. Exhibits massive stellar parallax and flares that alter infrared continuum flux across survey epochs.',
    scienceGoal: 'Characterize energetic flare emissions in near-infrared and refine absolute parallax.',
    spectralBands: 'Bands 1–4 (0.75–3.82 μm)',
  },

  // ==========================================
  // 2. WATER & BIOGENIC ICES (ORIGINS OF LIFE)
  // ==========================================
  {
    id: 'm42_orion',
    name: 'Orion Nebula & Trapezium',
    codename: 'M42 / NGC 1976',
    title: 'The Cosmic Water Ice Factory',
    category: 'water_ices',
    categoryLabel: 'Water & Biogenic Ices',
    ra: 83.82208,
    dec: -5.39111,
    distanceLightYears: '1,344 ly',
    spectralType: 'HII Star-Forming Region',
    preset: 'water_ice',
    launchTab: 'ice',
    launchLabel: 'Calculate Ice Column Density',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'A violent stellar nursery where hundreds of newborn solar systems are condensing from molecular clouds. SPHEREx probes the massive 3.05 μm H2O and 4.27 μm CO2 ice absorption bands that supply planetary water.',
    scienceGoal: 'Quantify the water-to-silicate ice ratio in protoplanetary disks (SPHEREx Pillar 3).',
    spectralBands: 'Detectors D3–D5 (2.42–4.42 μm)',
  },
  {
    id: 'elias29',
    name: 'Elias 29 (Ophiuchus Protostar)',
    codename: 'ISO-Oph 29',
    title: 'Embedded Interstellar Ice Core',
    category: 'water_ices',
    categoryLabel: 'Water & Biogenic Ices',
    ra: 246.68583,
    dec: -24.6225,
    distanceLightYears: '410 ly',
    spectralType: 'Class I Embedded Protostar',
    preset: 'water_ice',
    launchTab: 'ice',
    launchLabel: 'Analyze Cryogenic Ice Profile',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'An infant sun buried deeply inside cold molecular dust. Serves as a primary astrophysical laboratory for measuring Beer-Lambert optical depth of solid CO, CO2, and organic prebiotic mantles.',
    scienceGoal: 'Map 4.67 μm solid CO and 3.53 μm methanol ice absorption bands in pristine molecular cloud dust.',
    spectralBands: 'Detectors D4–D6 (3.00–4.80 μm)',
  },
  {
    id: 'betelgeuse',
    name: 'Betelgeuse',
    codename: 'Alpha Orionis',
    title: 'Ejected Molecular Dust Shells',
    category: 'water_ices',
    categoryLabel: 'Water & Biogenic Ices',
    ra: 88.79294,
    dec: 7.40706,
    distanceLightYears: '642 ly',
    spectralType: 'M1-2 Ia-ab Red Supergiant',
    preset: 'water_ice',
    launchTab: 'spectral',
    launchLabel: 'Explore Molecular Absorption',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'A dying red supergiant on the verge of core-collapse supernova. During its 2019-2020 Great Dimming, massive dust condensation created profound changes in circumstellar molecular opacity.',
    scienceGoal: 'Spectrophotometrically trace circumstellar gas-to-dust condensation cycles.',
    spectralBands: 'Bands 1–6 (0.75–5.00 μm)',
  },

  // ==========================================
  // 3. COSMIC INFLATION & DEEP FIELDS (PILLAR 1)
  // ==========================================
  {
    id: 'nep_tdf',
    name: 'SPHEREx / JWST NEP Deep Field',
    codename: 'North Ecliptic Pole TDF',
    title: 'The Time-Domain Cosmic Anchor',
    category: 'deep_fields',
    categoryLabel: 'Cosmic Inflation & Deep Fields',
    ra: 260.7,
    dec: 65.8,
    distanceLightYears: 'Cosmic Depth (z = 0.1–8.0)',
    spectralType: 'Ultra-Deep Calibration Zone',
    preset: 'true_nir',
    launchTab: 'navigator',
    launchLabel: 'Open High-Pass Deep Field',
    badge: '[NASA Benchmark (Pre-cached)]',
    narrative:
      'The orbital continuous viewing zone of SPHEREx and JWST. While typical sky patches are surveyed twice a year, the NEP receives over 50 orbital passes annually, creating an ultra-deep window into early galaxies.',
    scienceGoal: 'Calibrate detector flat-field response and measure large-scale cosmic infrared background clustering.',
    spectralBands: 'All 102 Channels (D1–D6)',
  },
  {
    id: 'sep_df',
    name: 'SPHEREx SEP Deep Field',
    codename: 'South Ecliptic Pole DF',
    title: 'Southern Cosmic Inflation Field',
    category: 'deep_fields',
    categoryLabel: 'Cosmic Inflation & Deep Fields',
    ra: 90.0,
    dec: -66.5607,
    distanceLightYears: 'Cosmic Depth (z = 0.5–6.0)',
    spectralType: 'LMC-Adjacent Deep Sky',
    preset: 'water_ice',
    launchTab: 'navigator',
    launchLabel: 'Inspect Southern Deep Survey',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'The southern celestial anchor covering ~100 deg² near the Large Magellanic Cloud. Maximizes signal-to-noise ratio for detecting non-Gaussianity in the primordial cosmic density field from Cosmic Inflation.',
    scienceGoal: 'Constrain primordial non-Gaussianity parameter f_NL to test inflationary physics (SPHEREx Pillar 1).',
    spectralBands: 'All 102 Channels (D1–D6)',
  },
  {
    id: 'cdfs',
    name: 'Chandra Deep Field South (GOODS-S)',
    codename: 'CDFS / GOODS-S',
    title: '450 Million Galaxies in 3D',
    category: 'deep_fields',
    categoryLabel: 'Cosmic Inflation & Deep Fields',
    ra: 53.1225,
    dec: -27.805,
    distanceLightYears: 'z = 0.5–4.5 (Billions of ly)',
    spectralType: 'Cosmological Deep Survey',
    preset: 'true_nir',
    launchTab: 'spectral',
    launchLabel: 'Simulate Galaxy Redshift (z)',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'One of the deepest multi-wavelength survey fields in astronomy. SPHEREx measures low-resolution infrared spectra for millions of galaxies, determining photometric redshifts to reconstruct the 3D cosmic web.',
    scienceGoal: 'Map galaxy clustering and baryon acoustic oscillations across 10 billion years of cosmic time.',
    spectralBands: 'Bands 1–4 (0.75–3.82 μm)',
  },
  {
    id: 'sgra_star',
    name: 'Sagittarius A* & Galactic Center',
    codename: 'Sgr A*',
    title: 'The Supermassive Black Hole Heart',
    category: 'deep_fields',
    categoryLabel: 'Cosmic Inflation & Deep Fields',
    ra: 266.41682,
    dec: -29.00782,
    distanceLightYears: '26,670 ly',
    spectralType: '4.15M Solar Mass SMBH',
    preset: 'true_nir',
    launchTab: 'navigator',
    launchLabel: 'Pierce Galactic Dust Veil',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'Completely obscured by 30 magnitudes of visual extinction from interstellar dust. SPHEREx near- and mid-infrared channels pierce the veil to resolve dense nuclear star clusters orbiting our supermassive black hole.',
    scienceGoal: 'Map extinction laws and nuclear stellar populations in the Milky Way center.',
    spectralBands: 'Bands 3–6 (2.42–5.00 μm)',
  },

  // ==========================================
  // 4. GALACTIC & EXTRAGALACTIC STRUCTURES
  // ==========================================
  {
    id: 'm82_cigar',
    name: 'Cigar Galaxy (M82)',
    codename: 'NGC 3034',
    title: 'The Infrared Starburst Superwind',
    category: 'galaxies',
    categoryLabel: 'Galaxies & Structures',
    ra: 148.96846,
    dec: 69.6797,
    distanceLightYears: '11.5M ly',
    spectralType: 'Starburst Intermediate Spiral',
    preset: 'water_ice',
    launchTab: 'spectral',
    launchLabel: 'Examine PAH Emission & Dust',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'A galaxy undergoing a furious burst of star formation ten times faster than the Milky Way. Enormous superwinds blow glowing ionized hydrogen and 3.3 μm polycyclic aromatic hydrocarbon (PAH) dust into intergalactic space.',
    scienceGoal: 'Trace energetic starburst feedback and infrared emission line ratios across galactic scales.',
    spectralBands: 'Bands 2–5 (1.11–4.42 μm)',
  },
  {
    id: 'm87_virgo',
    name: 'Virgo A (M87)',
    codename: 'NGC 4486',
    title: 'Supermassive Black Hole & Jet',
    category: 'galaxies',
    categoryLabel: 'Galaxies & Structures',
    ra: 187.70593,
    dec: 12.39112,
    distanceLightYears: '53.5M ly',
    spectralType: 'Supergiant Elliptical (cE)',
    preset: 'true_nir',
    launchTab: 'navigator',
    launchLabel: 'Survey Relativistic Host',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'The dominant supergiant elliptical galaxy at the center of the Virgo Cluster, hosting a 6.5-billion-solar-mass black hole with a 5,000-light-year relativistic jet blasting synchrotron radiation.',
    scienceGoal: 'Measure the integrated stellar population infrared light curve across the Virgo cluster.',
    spectralBands: 'Bands 1–6 (0.75–5.00 μm)',
  },
  {
    id: 'm31_core',
    name: 'Andromeda Galaxy (M31)',
    codename: 'NGC 224',
    title: 'Our Giant Spiral Sister',
    category: 'galaxies',
    categoryLabel: 'Galaxies & Structures',
    ra: 10.68471,
    dec: 41.26875,
    distanceLightYears: '2.54M ly',
    spectralType: 'SA(s)b Barred Spiral',
    preset: 'true_nir',
    launchTab: 'navigator',
    launchLabel: 'Explore 220,000 ly Disk',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'The largest galaxy in the Local Group, spanning over 3 degrees in the night sky. SPHEREx spectrophotometrically resolves unresolved stellar populations and cold dust lanes across its 220,000-light-year disk.',
    scienceGoal: 'Build all-sky spectrophotometric template of a prototypical grand-design spiral galaxy.',
    spectralBands: 'Bands 1–6 (0.75–5.00 μm)',
  },
  {
    id: 'm51_whirlpool',
    name: 'Whirlpool Galaxy (M51)',
    codename: 'NGC 5194 + NGC 5195',
    title: 'Interacting Grand-Design Spiral',
    category: 'galaxies',
    categoryLabel: 'Galaxies & Structures',
    ra: 202.46958,
    dec: 47.19528,
    distanceLightYears: '31M ly',
    spectralType: 'SA(s)bc Grand Design',
    preset: 'true_nir',
    launchTab: 'navigator',
    launchLabel: 'Inspect Tidal Interaction',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'A spectacular face-on spiral galaxy undergoing a close gravitational encounter with companion galaxy NGC 5195. Tidal shockwaves compress gas along the spiral arms, triggering explosive star formation.',
    scienceGoal: 'Map density wave shock fronts and induced infrared molecular emissions.',
    spectralBands: 'Bands 1–4 (0.75–3.82 μm)',
  },

  // ==========================================
  // 5. STELLAR VARIABLES & TRANSIENTS
  // ==========================================
  {
    id: 'rw_aur',
    name: 'RW Aurigae',
    codename: 'HD 35899',
    title: 'The Flashing Infant Star',
    category: 'variables',
    categoryLabel: 'Stellar Variables',
    ra: 76.95647,
    dec: 30.4013,
    distanceLightYears: '530 ly',
    spectralType: 'T Tauri Young Stellar Object',
    motionRate: 'Stationary (<0.2 px) / Monopole Dimming',
    preset: 'comet_outgassing',
    launchTab: 'comparator',
    launchLabel: 'Observe Monopole Flashing',
    badge: '[NASA Benchmark (Pre-cached)]',
    narrative:
      'A chaotic infant sun encircled by a turbulent protoplanetary dust disk. Massive occultation events cause it to violently dim by >1.5 magnitudes across seasons without moving a single pixel.',
    scienceGoal: 'Distinguish stationary photometric monopoles from physical proper-motion dipoles.',
    spectralBands: 'Bands 1–4 (0.75–3.82 μm)',
    isMandatoryBenchmark: true,
  },
  {
    id: 'r_dra',
    name: 'R Draconis',
    codename: 'HD 149212',
    title: 'The Beating Giant Heart',
    category: 'variables',
    categoryLabel: 'Stellar Variables',
    ra: 248.16773,
    dec: 66.75504,
    distanceLightYears: '2,100 ly',
    spectralType: 'Mira AGB Pulsating Variable',
    motionRate: 'Stationary / 245-day cycle',
    preset: 'water_ice',
    launchTab: 'comparator',
    launchLabel: 'Track 245-Day Light Cycle',
    badge: '[NASA Benchmark (Pre-cached)]',
    narrative:
      'An evolved Asymptotic Giant Branch (AGB) red giant located just 8.6° from the North Ecliptic Pole. Rhythmically expands and contracts in a 245-day pulsation cycle, pumping out infrared photons like a celestial heartbeat.',
    scienceGoal: 'Calibrate long-period variable stellar pulsation light curves in multi-epoch infrared surveys.',
    spectralBands: 'Bands 3–6 (2.42–5.00 μm)',
    isMandatoryBenchmark: true,
  },
  {
    id: 'm1_crab',
    name: 'Crab Nebula & Pulsar',
    codename: 'M1 / NGC 1952',
    title: 'Historical Supernova Remnant',
    category: 'variables',
    categoryLabel: 'Stellar Variables',
    ra: 83.63308,
    dec: 22.0145,
    distanceLightYears: '6,500 ly',
    spectralType: 'Pulsar Wind Synchrotron Nebula',
    preset: 'true_nir',
    launchTab: 'spectral',
    launchLabel: 'Analyze Synchrotron Continuum',
    badge: '[IRSA Live (spherex_qr2)]',
    narrative:
      'The expanding debris of a supernova explosion witnessed on Earth in the year 1054 AD. Driven by a central neutron star spinning 30 times a second, powering continuous infrared synchrotron emission.',
    scienceGoal: 'Measure the infrared continuum power law and filamentary elemental ejecta abundances.',
    spectralBands: 'Bands 1–6 (0.75–5.00 μm)',
  },
];
