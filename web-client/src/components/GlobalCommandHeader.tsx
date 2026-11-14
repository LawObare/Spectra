import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { queryClient } from '../App';
import { Button, Badge, Input } from './ui';
import { cn } from '../lib/utils';

export interface BenchmarkPill {
  id: string;
  name: string;
  label: string;
  ra: number;
  dec: number;
  preset?: 'brown_dwarf' | 'true_nir' | 'water_ice' | 'comet_outgassing' | 'custom';
  description: string;
  category?: 'SPHEREx Verification' | 'Deep Field' | 'Galactic / Nebular' | 'Extragalactic';
}

/**
 * Reference Calibration Targets (SPECIFICATION.md §1.1, §4.0)
 * Exported for search resolution and calibration verification across workspaces.
 */
export const MANDATORY_BENCHMARKS: BenchmarkPill[] = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    label: "Barnard's (Speed Demon)",
    ra: 269.44639,
    dec: 4.76676,
    preset: 'true_nir',
    description: 'The Cosmic Speed Demon — Fastest-moving star sprinting at +10.39"/yr North (1.68 px/yr)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    label: 'WISE 0855 (Frozen Dwarf)',
    ra: 133.73712,
    dec: -7.24038,
    preset: 'brown_dwarf',
    description: 'The Frozen Brown Dwarf — Cold as ice (-10°C), glowing in SPHEREx mid-IR (8.15"/yr West)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi B',
    label: 'Eps Indi B (Twin Worlds)',
    ra: 331.09566,
    dec: -56.80031,
    preset: 'brown_dwarf',
    description: 'The Invisible Twin Worlds — T1+T6 binary pair blended in a single pixel (4.68"/yr SE)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'rw_aur',
    name: 'RW Aurigae',
    label: 'RW Aurigae (Flashing Star)',
    ra: 76.95647,
    dec: 30.4013,
    preset: 'comet_outgassing',
    description: 'The Flashing Baby Star — Violent dust clouds blocking 75% of light across seasons',
    category: 'SPHEREx Verification',
  },
  {
    id: 'r_dra',
    name: 'R Draconis',
    label: 'R Draconis (Pulsing Giant)',
    ra: 248.16773,
    dec: 66.75504,
    preset: 'water_ice',
    description: 'The Beating Giant Heart — Red giant pulsating in brightness every 245 days',
    category: 'SPHEREx Verification',
  },
];

/**
 * Extended Astronomical Catalog for Instant Local Name Resolution
 * Complements CDS Sesame (SIMBAD/NED/VizieR) and backend /api/resolve.
 */
export const SEARCHABLE_SKY_CATALOG: BenchmarkPill[] = [
  ...MANDATORY_BENCHMARKS,
  {
    id: 'nep_tdf',
    name: 'SPHEREx / JWST NEP Deep Field',
    label: 'NEP Deep Field',
    ra: 260.7,
    dec: 65.8,
    preset: 'true_nir',
    description: 'North Ecliptic Pole calibration zone (>50 SPHEREx passes/yr)',
    category: 'Deep Field',
  },
  {
    id: 'sep_df',
    name: 'SPHEREx SEP Deep Field (LMC Adjacent)',
    label: 'SEP Deep Field',
    ra: 90.0,
    dec: -66.5607,
    preset: 'water_ice',
    description: 'South Ecliptic Pole deep coverage zone (~100 deg²)',
    category: 'Deep Field',
  },
  {
    id: 'm42_orion',
    name: 'Orion Nebula (M42 / Trapezium)',
    label: 'M42 Orion',
    ra: 83.82208,
    dec: -5.39111,
    preset: 'water_ice',
    description: 'Massive star-forming region; strong H2O/CO2 3.0–4.27 µm ice absorption',
    category: 'Galactic / Nebular',
  },
  {
    id: 'trappist1',
    name: 'TRAPPIST-1 (2MASS J23062928-0502285)',
    label: 'TRAPPIST-1',
    ra: 346.62233,
    dec: -5.04144,
    preset: 'brown_dwarf',
    description: 'M8V ultra-cool dwarf exoplanet host (1.10"/yr proper motion)',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm31_core',
    name: 'Andromeda Galaxy (M31 / NGC 224)',
    label: 'M31 Andromeda',
    ra: 10.68471,
    dec: 41.26875,
    preset: 'true_nir',
    description: 'Local Group giant spiral; 220,000 ly disk with dust lanes and satellite dwarf galaxies',
    category: 'Extragalactic',
  },
  {
    id: 'm51_whirlpool',
    name: 'Whirlpool Galaxy (M51 / NGC 5194)',
    label: 'M51 Whirlpool',
    ra: 202.46958,
    dec: 47.19528,
    preset: 'true_nir',
    description: 'Grand-design face-on spiral galaxy interacting with dwarf galaxy NGC 5195',
    category: 'Extragalactic',
  },
  {
    id: 'm82_cigar',
    name: 'Cigar Galaxy (M82 / NGC 3034)',
    label: 'M82 Cigar',
    ra: 148.96846,
    dec: 69.6797,
    preset: 'water_ice',
    description: 'Prototypical starburst galaxy; superwind bipolar outflows and intense infrared PAH emission',
    category: 'Extragalactic',
  },
  {
    id: 'm87_virgo',
    name: 'Virgo A (M87 / NGC 4486)',
    label: 'M87 Virgo A',
    ra: 187.70593,
    dec: 12.39112,
    preset: 'true_nir',
    description: 'Supergiant elliptical galaxy in Virgo cluster; host of 6.5B M☉ supermassive black hole and relativistic jet',
    category: 'Extragalactic',
  },
  {
    id: 'ngc253_sculptor',
    name: 'Sculptor Galaxy (NGC 253 / Silver Coin)',
    label: 'NGC 253 Sculptor',
    ra: 11.88806,
    dec: -25.28822,
    preset: 'water_ice',
    description: 'Nearby starburst intermediate spiral; heavy interstellar dust lanes and nuclear star cluster',
    category: 'Extragalactic',
  },
  {
    id: 'm101_pinwheel',
    name: 'Pinwheel Galaxy (M101 / NGC 5457)',
    label: 'M101 Pinwheel',
    ra: 210.80227,
    dec: 54.34895,
    preset: 'true_nir',
    description: 'Face-on grand spiral galaxy; prominent HII starburst regions and pristine spiral structure',
    category: 'Extragalactic',
  },
  {
    id: 'cdfs',
    name: 'Chandra Deep Field South (GOODS-S)',
    label: 'CDFS / GOODS-S',
    ra: 53.1225,
    dec: -27.805,
    preset: 'true_nir',
    description: 'Extragalactic deep survey field (z = 0.5–4.0 galaxy spectrophotometry)',
    category: 'Extragalactic',
  },
  {
    id: 'vega',
    name: 'Vega (Alpha Lyrae / CALSPEC Standard)',
    label: 'Vega',
    ra: 279.23473,
    dec: 38.78369,
    preset: 'true_nir',
    description: 'A0V primary spectrophotometric zero-point standard',
    category: 'Galactic / Nebular',
  },
  {
    id: 'sgra_star',
    name: 'Sagittarius A* (Galactic Center)',
    label: 'Sagittarius A*',
    ra: 266.41682,
    dec: -29.00782,
    preset: 'true_nir',
    description: 'Supermassive black hole at the dynamical center of the Milky Way',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm1_crab',
    name: 'Crab Nebula (M1 / NGC 1952)',
    label: 'M1 Crab Nebula',
    ra: 83.63308,
    dec: 22.0145,
    preset: 'true_nir',
    description: 'Supernova remnant with central pulsar powering synchrotron nebula',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm45_pleiades',
    name: 'Pleiades (M45 / Seven Sisters)',
    label: 'M45 Pleiades',
    ra: 56.75,
    dec: 24.1167,
    preset: 'true_nir',
    description: 'Open cluster embedded in bright reflection nebulosity',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm104_sombrero',
    name: 'Sombrero Galaxy (M104 / NGC 4594)',
    label: 'M104 Sombrero',
    ra: 189.99763,
    dec: -11.62305,
    preset: 'true_nir',
    description: 'Unbarred spiral galaxy with prominent circumstellar dust lane',
    category: 'Extragalactic',
  },
  {
    id: 'm33_triangulum',
    name: 'Triangulum Galaxy (M33 / NGC 598)',
    label: 'M33 Triangulum',
    ra: 23.4621,
    dec: 30.65994,
    preset: 'true_nir',
    description: 'Third-largest member of the Local Group; rich in starburst HII complexes',
    category: 'Extragalactic',
  },
  {
    id: 'betelgeuse',
    name: 'Betelgeuse (Alpha Orionis)',
    label: 'Betelgeuse',
    ra: 88.79294,
    dec: 7.40706,
    preset: 'water_ice',
    description: 'Red supergiant pulsating variable with circumstellar molecular dust shells',
    category: 'Galactic / Nebular',
  },
  {
    id: 'sirius',
    name: 'Sirius (Alpha Canis Majoris)',
    label: 'Sirius',
    ra: 101.28716,
    dec: -16.71612,
    preset: 'true_nir',
    description: 'Brightest star in night sky; A1V + DA white dwarf binary',
    category: 'Galactic / Nebular',
  },
  {
    id: 'proxima',
    name: 'Proxima Centauri (Alpha Centauri C)',
    label: 'Proxima Centauri',
    ra: 217.42894,
    dec: -62.67949,
    preset: 'brown_dwarf',
    description: 'M5.5Ve flare star and closest known star to the Solar System (1.30 pc)',
    category: 'Galactic / Nebular',
  },
  {
    id: 'polaris',
    name: 'Polaris (Alpha Ursae Minoris)',
    label: 'Polaris',
    ra: 37.95456,
    dec: 89.26411,
    preset: 'true_nir',
    description: 'North celestial pole Classical Cepheid variable standard',
    category: 'Galactic / Nebular',
  },
];

interface LucideIconProps {
  className?: string;
}

const lucideSvgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

const CompassIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="compass">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const HistoryIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="history">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

const ActivityIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="activity">
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  </svg>
);

const SnowflakeIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="snowflake">
    <line x1="2" x2="22" y1="12" y2="12" />
    <line x1="12" x2="12" y1="2" y2="22" />
    <path d="m20 16-4-4 4-4" />
    <path d="m4 8 4 4-4 4" />
    <path d="m16 4-4 4-4-4" />
    <path d="m8 20 4-4 4 4" />
  </svg>
);

const MessageSquareIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="message-square">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SparklesIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="sparkles">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </svg>
);

const BookOpenIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="book-open">
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </svg>
);

const SearchIcon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="search">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const Share2Icon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="share-2">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
    <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
  </svg>
);

const Link2Icon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="link-2">
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <line x1="8" x2="16" y1="12" y2="12" />
  </svg>
);

const Code2Icon: React.FC<LucideIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg {...lucideSvgProps} className={className} data-lucide="code-2">
    <path d="m18 16 4-4-4-4" />
    <path d="m6 8-4 4 4 4" />
    <path d="m14.5 4-5 16" />
  </svg>
);

const TABS: Array<{ id: string; label: string; icon: React.FC<LucideIconProps> }> = [
  { id: 'navigator', label: 'Navigator', icon: CompassIcon },
  { id: 'comparator', label: 'Time-Domain', icon: HistoryIcon },
  { id: 'spectral', label: '102-Band Spectrum', icon: ActivityIcon },
  { id: 'ice', label: 'Ice Studio', icon: SnowflakeIcon },
  { id: 'discussions', label: 'Community Forum', icon: MessageSquareIcon },
];

/**
 * Original Spectra Emblem: Celestial Survey Sphere + 6-Band Infrared Spectral Prism (D1-D6)
 */
export const SpectraLogoSvg: React.FC<{ className?: string }> = ({ className = 'h-7 w-7' }) => {
  const uid = React.useId().replace(/:/g, '');
  const bgId = `spx-bg-${uid}`;
  const ringId = `spx-ring-${uid}`;
  const prismId = `spx-prism-${uid}`;

  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Spectra All-Sky Spectral Explorer Logo"
    >
      <defs>
        <radialGradient id={bgId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#16233B" />
          <stop offset="65%" stopColor="#080D1A" />
          <stop offset="100%" stopColor="#03050B" />
        </radialGradient>
        <linearGradient id={ringId} x1="8" y1="12" x2="88" y2="84" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={prismId} x1="28" y1="24" x2="62" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {/* Outer celestial sphere & gradient aperture ring */}
      <circle cx="48" cy="48" r="41" fill={`url(#${bgId})`} stroke={`url(#${ringId})`} strokeWidth="2.4" />
      <circle cx="48" cy="48" r="35" stroke="#38BDF8" strokeOpacity="0.14" strokeWidth="1" />

      {/* Subtle survey meridian orbit */}
      <ellipse
        cx="48"
        cy="48"
        rx="44"
        ry="15"
        transform="rotate(-24 48 48)"
        stroke="#7DD3FC"
        strokeOpacity="0.45"
        strokeWidth="1.4"
      />
      <circle cx="84" cy="31" r="2.2" fill="#38BDF8" />

      {/* 6-band infrared spectral dispersion rays (D1-D6) */}
      <path d="M51 39 L82 28" stroke="#38BDF8" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M53 42.5 L84 36.5" stroke="#34D399" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M54.5 46 L85 45" stroke="#FACC15" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M56 49.5 L84 53.5" stroke="#FB923C" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M57.5 53 L82 61.5" stroke="#F472B6" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M59 56.5 L78 69" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round" />

      {/* Incoming white starlight beam */}
      <path d="M12 40 L37 45" stroke="#F8FAFC" strokeWidth="2.3" strokeLinecap="round" />

      {/* Central crystalline dispersion prism */}
      <polygon
        points="45,23 26,64 62,64"
        fill={`url(#${prismId})`}
        stroke="#E2E8F0"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path d="M45 25 L50 63" stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="1.2" />

      {/* Source diffraction star & field stars */}
      <path d="M13 33 L14.1 38.4 L19.5 39.5 L14.1 40.6 L13 46 L11.9 40.6 L6.5 39.5 L11.9 38.4 Z" fill="#F8FAFC" />
      <circle cx="70" cy="19" r="1.4" fill="#BAE6FD" fillOpacity="0.85" />
      <circle cx="24" cy="73" r="1.2" fill="#FDE68A" fillOpacity="0.8" />
    </svg>
  );
};

export const NasaMeatballSvg = SpectraLogoSvg;

/**
 * Client-Side Coordinate & Sexagesimal Parser
 * Handles:
 * - Decimal: "133.73712, -7.24038" or "133.73712 -7.24038"
 * - Sexagesimal: "08h54m56.91s -07d14m25.4s" or "08:54:56.91 -07:14:25.4"
 */
export function parseCoordinateInput(input: string): { ra: number; dec: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern 1: Sexagesimal (e.g. 08h54m56.91s, -07d14m25.4s or 08:54:56.91, -07:14:25.4)
  const sexaRegex =
    /^(\d{1,2})[h:\s]\s*(\d{1,2})[m:\s]\s*(\d{1,2}(?:\.\d+)?)[s]?[\s,]+\s*([+-]?\d{1,2})[d°:\s]\s*(\d{1,2})[m':\s]\s*(\d{1,2}(?:\.\d+)?)[s"]?$/i;
  const sexaMatch = trimmed.match(sexaRegex);
  if (sexaMatch) {
    const rh = parseFloat(sexaMatch[1]);
    const rm = parseFloat(sexaMatch[2]);
    const rs = parseFloat(sexaMatch[3]);
    const raDeg = (rh + rm / 60 + rs / 3600) * 15;

    const decSign = sexaMatch[4].startsWith('-') ? -1 : 1;
    const dd = Math.abs(parseFloat(sexaMatch[4]));
    const dm = parseFloat(sexaMatch[5]);
    const ds = parseFloat(sexaMatch[6]);
    const decDeg = decSign * (dd + dm / 60 + ds / 3600);

    if (raDeg >= 0 && raDeg <= 360 && decDeg >= -90 && decDeg <= 90) {
      return { ra: parseFloat(raDeg.toFixed(6)), dec: parseFloat(decDeg.toFixed(6)) };
    }
  }

  // Pattern 2: Decimal (e.g. 133.73712, -7.24038 or 133.73712 -7.24038)
  const decimalRegex = /^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/;
  const decMatch = trimmed.match(decimalRegex);
  if (decMatch) {
    const ra = parseFloat(decMatch[1]);
    const dec = parseFloat(decMatch[2]);
    if (ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90) {
      return { ra: parseFloat(ra.toFixed(6)), dec: parseFloat(dec.toFixed(6)) };
    }
  }

  return null;
}

export interface GlobalCommandHeaderProps {
  onOpenCommandPalette?: () => void;
  onToggleMissionBriefing?: () => void;
  isMissionBriefingActive?: boolean;
  onOpenCatalog?: () => void;
}

export const GlobalCommandHeader: React.FC<GlobalCommandHeaderProps> = ({
  onOpenCommandPalette,
  onToggleMissionBriefing,
  isMissionBriefingActive = false,
  onOpenCatalog,
}) => {
  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    sourceBadge,
    totalEpochs,
    setCoordinates,
    setRgbPreset,
  } = useTelemetryStore();

  const { tab, setTab, setRa, setDec, setPreset } = useSpectraUrlState();

  const [searchInput, setSearchInput] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isBackendLive, setIsBackendLive] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Backend Health Ping (/api/health/live)
  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health/live', { method: 'GET' });
        if (active) setIsBackendLive(res.ok);
      } catch {
        if (active) setIsBackendLive(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Compute 14 Bytes/Pixel Payload Gauge (SPECIFICATION.md §6.2.4)
  const payloadMb = useMemo(() => {
    const nEpochs = Math.max(1, totalEpochs || 4);
    const nPixelsPerBand = Math.pow(fovArcsec / 6.2, 2);
    const totalBytes = nEpochs * 6 * nPixelsPerBand * 14;
    return totalBytes / 1e6;
  }, [fovArcsec, totalEpochs]);

  // Filter local catalog suggestions as user types
  const filteredCatalog = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return SEARCHABLE_SKY_CATALOG;
    const normQ = q.replace(/[-'\s]/g, '');
    return SEARCHABLE_SKY_CATALOG.filter(
      (item) =>
        item.name.toLowerCase().replace(/[-'\s]/g, '').includes(normQ) ||
        item.description.toLowerCase().includes(q) ||
        `${item.ra.toFixed(4)} ${item.dec.toFixed(4)}`.includes(q)
    );
  }, [searchInput]);

  const applyResolvedTarget = useCallback(
    (
      targetRa: number,
      targetDec: number,
      name: string,
      badge: string,
      preset?: BenchmarkPill['preset']
    ) => {
      setCoordinates(targetRa, targetDec, name, badge);
      setRa(targetRa);
      setDec(targetDec);
      if (preset) {
        setRgbPreset(preset);
        setPreset(preset);
      }
      setSearchInput('');
      setIsSearchFocused(false);
    },
    [setCoordinates, setDec, setPreset, setRa, setRgbPreset]
  );

  // Execute Universal Coordinate or Name Resolution (ICRS Decimal, Sexagesimal, Local Catalog, Backend /api/resolve, CDS Sesame SIMBAD/NED)
  const executeSearchResolution = useCallback(
    async (rawQuery: string) => {
      const value = rawQuery.trim();
      if (!value) return;

      // 1. Direct Coordinate Parse (<1 ms)
      const parsedCoords = parseCoordinateInput(value);
      if (parsedCoords) {
        const matched = MANDATORY_BENCHMARKS.find(
          (b) =>
            Math.abs(b.ra - parsedCoords.ra) < 0.05 &&
            Math.abs(b.dec - parsedCoords.dec) < 0.05
        );
        applyResolvedTarget(
          parsedCoords.ra,
          parsedCoords.dec,
          matched ? matched.name : `J2000 ${parsedCoords.ra.toFixed(4)}°, ${parsedCoords.dec >= 0 ? '+' : ''}${parsedCoords.dec.toFixed(4)}°`,
          matched ? '[NASA Benchmark (Pre-cached)]' : '[Synthetic Injection Mode]',
          matched?.preset
        );
        return;
      }

      // 2. Local Catalog Match
      const norm = value.toLowerCase().replace(/[-'\s]/g, '');
      const catalogHit = SEARCHABLE_SKY_CATALOG.find(
        (item) =>
          item.name.toLowerCase().replace(/[-'\s]/g, '').includes(norm) ||
          item.label.toLowerCase().replace(/[-'\s]/g, '').includes(norm)
      );
      if (catalogHit) {
        const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === catalogHit.id);
        applyResolvedTarget(
          catalogHit.ra,
          catalogHit.dec,
          catalogHit.name,
          isBench ? '[NASA Benchmark (Pre-cached)]' : '[Synthetic Injection Mode]',
          catalogHit.preset
        );
        return;
      }

      setIsResolving(true);
      try {
        // 3. Try Backend /api/resolve (with 1.5s timeout)
        try {
          const backendCtrl = new AbortController();
          const backendTimer = setTimeout(() => backendCtrl.abort(), 1500);
          try {
            const res = await fetch(`/api/resolve?q=${encodeURIComponent(value)}`, {
              signal: backendCtrl.signal,
            });
            if (res.ok) {
              const data = await res.json();
              if (typeof data.ra === 'number' && typeof data.dec === 'number') {
                applyResolvedTarget(
                  data.ra,
                  data.dec,
                  data.target_name || value,
                  data.source_badge || '[IRSA Live (spherex_qr2)]'
                );
                setIsResolving(false);
                return;
              }
            }
          } finally {
            clearTimeout(backendTimer);
          }
        } catch {
          // Proceed to CDS Sesame resolver
        }

        // 4. Try CDS Sesame (SIMBAD / NED / VizieR) Universal Astronomical Name Resolver (with 2.5s timeout)
        const sesameCtrl = new AbortController();
        const sesameTimer = setTimeout(() => sesameCtrl.abort(), 2500);
        const sesameUrl = `https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV?${encodeURIComponent(
          value
        )}`;
        try {
          const sesameRes = await fetch(sesameUrl, { signal: sesameCtrl.signal });
          if (sesameRes.ok) {
            const xmlText = await sesameRes.text();
            const jradegMatch = xmlText.match(/<jradeg>([+-]?\d+(?:\.\d+)?)<\/jradeg>/i);
            const jdedegMatch = xmlText.match(/<jdedeg>([+-]?\d+(?:\.\d+)?)<\/jdedeg>/i);
            const onameMatch = xmlText.match(/<oname>([^<]+)<\/oname>/i);
            if (jradegMatch && jdedegMatch) {
              const resolvedRa = parseFloat(jradegMatch[1]);
              const resolvedDec = parseFloat(jdedegMatch[1]);
              const resolvedName = onameMatch ? onameMatch[1].trim() : value;
              if (Number.isFinite(resolvedRa) && Number.isFinite(resolvedDec)) {
                applyResolvedTarget(
                  resolvedRa,
                  resolvedDec,
                  resolvedName,
                  '[SIMBAD / IRSA Resolved]'
                );
              }
            }
          }
        } finally {
          clearTimeout(sesameTimer);
        }
      } catch {
        // Graceful fallback
      } finally {
        setIsResolving(false);
      }
    },
    [applyResolvedTarget]
  );

  const prefetchBenchmark = useCallback((name: string) => {
    queryClient.prefetchQuery({
      queryKey: ['benchmark_cache', name],
      queryFn: async () => {
        try {
          const res = await fetch(`/benchmarks/${encodeURIComponent(name)}.json`);
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      },
      staleTime: 1000 * 60 * 60,
    });
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShareFeedback('Deep link copied to clipboard!');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  const handleCopyIframe = () => {
    const embedUrl = new URL(window.location.href);
    embedUrl.searchParams.set('embed', '1');
    const iframeCode = `<iframe src="${embedUrl.toString()}" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(iframeCode);
    setShareFeedback('iFrame embed snippet copied!');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  return (
    <header className="relative z-50 shrink-0 flex min-h-[56px] xl:h-[56px] flex-wrap xl:flex-nowrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 bg-neutral-950/90 backdrop-blur-xl px-3 sm:px-4 py-1.5 xl:py-0 font-sans text-xs text-foreground select-none">
      {/* 1. Spectra Branding & Quick Actions */}
      <div className="order-1 flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 min-w-0">
        <Link
          to="/"
          aria-label="SPHEREx — return to mission home"
          title="Return to the SPHEREx mission home page"
          className="group flex items-center gap-2 rounded-lg px-1.5 py-1 -mx-1 transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          <SpectraLogoSvg className="h-8 w-8 drop-shadow-sm transition-transform group-hover:scale-105" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-extrabold tracking-tight text-white leading-none transition-colors group-hover:text-sky-300">
                SPHEREx
              </span>
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse"
                title="SPHEREx Operational Status: All 6 Near-IR Detectors Active (0.75 - 5.0 μm)"
              />
            </div>
            <span className="hidden sm:inline text-[9px] tracking-wider uppercase text-neutral-400 font-medium mt-0.5">
              NASA All-Sky Survey
            </span>
          </div>
        </Link>

        <span className="hidden sm:inline-block h-4 w-px bg-white/10 mx-0.5" aria-hidden="true" />

        {/* Mission Briefing / Sky Workstation Toggle */}
        {onToggleMissionBriefing && (
          <button
            type="button"
            onClick={onToggleMissionBriefing}
            className={cn(
              'h-8 rounded-lg px-2.5 text-xs font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap',
              isMissionBriefingActive
                ? 'bg-primary text-white shadow-sm ring-1 ring-white/15'
                : 'border border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08] hover:border-white/20 hover:text-white'
            )}
            title="Toggle between NASA SPHEREx Mission Launchpad and Workstation"
          >
            <SparklesIcon className={cn('h-3.5 w-3.5 shrink-0', isMissionBriefingActive ? 'text-white' : 'text-sky-400')} />
            <span>{isMissionBriefingActive ? 'Sky Workstation' : 'Mission Briefing'}</span>
          </button>
        )}

        {/* Authoritative Source Catalog Button */}
        {onOpenCatalog && (
          <button
            type="button"
            onClick={onOpenCatalog}
            className="h-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 px-2.5 text-xs font-medium text-neutral-200 hover:text-white inline-flex items-center gap-1.5 transition-all whitespace-nowrap"
            title="Browse all 24 calibrated astronomical targets across the survey"
          >
            <BookOpenIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="hidden xl:inline">Source Catalog</span>
            <span className="xl:hidden">Catalog</span>
            <span className="rounded-md bg-sky-500/15 border border-sky-400/20 px-1.5 py-0.5 text-[10px] font-mono leading-none text-sky-300">
              24
            </span>
          </button>
        )}

        {/* Data Provenance Badge */}
        <Badge
          variant="secondary"
          className="hidden 2xl:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/[0.04] px-2.5 font-mono text-[10px] tabular-nums text-neutral-400"
          title="Active dataset provenance"
        >
          {sourceBadge}
        </Badge>
      </div>

      {/* 2. Universal Coordinate & Object Name Resolver (SIMBAD / NED / ICRS / Catalog) */}
      <div ref={searchContainerRef} className="order-2 relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px] sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSearchResolution(searchInput);
          }}
          className="relative flex items-center"
        >
          <label htmlFor="spectra-coord-search" className="sr-only">
            Search sky coordinates (J2000 decimal or sexagesimal) or astronomical object name
          </label>
          <SearchIcon className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-neutral-400" />
          <Input
            id="spectra-coord-search"
            type="text"
            value={searchInput}
            onFocus={() => setIsSearchFocused(true)}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setIsSearchFocused(true);
            }}
            placeholder={
              activeTargetName
                ? `${activeTargetName} (${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°) — Search RA/Dec or object...`
                : "Search RA/Dec (e.g. 269.44, 4.76) or object (Barnard's Star, WISE 0855)..."
            }
            className="h-8 w-full pl-8 pr-16 rounded-lg bg-white/[0.04] border border-white/10 focus:border-sky-400/60 focus:bg-neutral-900/90 font-mono text-xs tabular-nums text-foreground placeholder:text-neutral-500"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {isResolving && (
              <span className="px-1 font-sans text-[10px] text-sky-400">Resolving…</span>
            )}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="inline-flex h-5 items-center rounded-md border border-white/10 bg-white/[0.06] px-1.5 font-mono text-[10px] text-neutral-400 hover:border-white/20 hover:text-white transition-colors"
              title="Open command palette (⌘K / Ctrl+K)"
              aria-label="Open command palette"
            >
              ⌘&nbsp;K
            </button>
          </div>
        </form>

        {/* Search Resolver Autocomplete & Coordinate Format Helper Popover */}
        {isSearchFocused && (
          <div className="absolute left-0 right-0 top-10 z-50 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-neutral-950/95 backdrop-blur-xl p-1.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-2 py-1.5 text-[10px] text-neutral-400">
              <span>Enter J2000 decimal, sexagesimal (HH:MM:SS ±DD:MM:SS), or SIMBAD object name</span>
              <span className="font-mono text-neutral-300">↵ Enter</span>
            </div>

            {parseCoordinateInput(searchInput) && (
              <button
                type="button"
                onClick={() => executeSearchResolution(searchInput)}
                className="mt-1 flex w-full items-center justify-between rounded-lg border border-primary/40 bg-white/[0.06] px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-primary/15 transition-colors"
              >
                <span>Go to J2000 coordinates</span>
                <span className="font-mono text-sky-300">
                  {parseCoordinateInput(searchInput)?.ra.toFixed(5)}°,{' '}
                  {parseCoordinateInput(searchInput)?.dec.toFixed(5)}°
                </span>
              </button>
            )}

            <div className="mt-1 flex flex-col gap-0.5">
              {filteredCatalog.map((item) => {
                const isCurrent =
                  Math.abs(ra - item.ra) < 0.01 && Math.abs(dec - item.dec) < 0.01;
                const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => {
                      if (isBench) prefetchBenchmark(item.name);
                    }}
                    onClick={() =>
                      applyResolvedTarget(
                        item.ra,
                        item.dec,
                        item.name,
                        isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]',
                        item.preset
                      )
                    }
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150',
                      isCurrent
                        ? 'bg-white/[0.08] text-foreground'
                        : 'text-neutral-300 hover:bg-white/[0.05] hover:text-white'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-white">{item.name}</span>
                        {item.category && (
                          <Badge variant="outline" className="text-[10px] border-white/15 text-neutral-300">
                            {item.category}
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-neutral-400">
                        {item.description}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-sky-400">
                      {item.ra.toFixed(3)}° {item.dec >= 0 ? `+${item.dec.toFixed(3)}` : item.dec.toFixed(3)}°
                    </span>
                  </button>
                );
              })}

              {searchInput.trim().length > 1 && !parseCoordinateInput(searchInput) && (
                <button
                  type="button"
                  onClick={() => executeSearchResolution(searchInput)}
                  className="mt-1 flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-left text-xs text-foreground hover:border-sky-400/50 transition-colors"
                >
                  <span>
                    Query SIMBAD / NED / IRSA resolver for &ldquo;{searchInput.trim()}&rdquo;
                  </span>
                  <span className="font-mono text-[11px] text-sky-400">Resolve ↵</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Workspace Tab Switcher & Share */}
      <div className="order-3 flex w-full xl:w-auto items-center justify-between xl:justify-end gap-2 min-w-0 border-t border-white/10 pt-1.5 xl:border-t-0 xl:pt-0 xl:shrink-0">
        {/* Compact Tensor Memory Readout */}
        <div
          className={cn(
            'hidden 2xl:inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] tabular-nums shrink-0',
            payloadMb >= 2.0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-white/10 bg-white/[0.04] text-neutral-300'
          )}
          title={`Cutout FoV: ${fovArcsec}" · Uncompressed float32 tensor payload (${
            totalEpochs || 4
          } passes × 6 bands × 14 B/px)`}
        >
          <span>{fovArcsec}&quot;</span>
          <span className="text-white/15">|</span>
          <span>{payloadMb.toFixed(2)}&nbsp;MB</span>
        </div>

        <nav
          aria-label="Workspaces"
          className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 overflow-x-auto max-w-full min-w-0"
        >
          {TABS.map((t) => {
            const isActive = tab === t.id && !isMissionBriefingActive;
            const TabIcon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (isMissionBriefingActive && onToggleMissionBriefing) {
                    onToggleMissionBriefing();
                  }
                }}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group shrink-0 whitespace-nowrap h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                  isActive
                    ? 'bg-primary text-white shadow-sm ring-1 ring-white/15'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                )}
              >
                <TabIcon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 transition-colors',
                    isActive ? 'text-white' : 'text-sky-400/80 group-hover:text-sky-300'
                  )}
                />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Share & Embed Exporter Dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setIsShareOpen(!isShareOpen)}
            aria-expanded={isShareOpen}
            className={cn(
              'h-8 rounded-lg border px-2.5 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-all',
              isShareOpen
                ? 'border-sky-400/50 bg-sky-500/15 text-white'
                : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08] hover:border-white/20 hover:text-white'
            )}
          >
            <Share2Icon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span>Share</span>
          </button>

          {isShareOpen && (
            <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-white/10 bg-neutral-950/95 backdrop-blur-xl p-3 shadow-2xl">
              <div className="mb-2 text-xs font-medium text-white">
                Share current view state
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLink}
                  className="w-full justify-start gap-2 rounded-lg border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-normal text-neutral-200 hover:text-white"
                >
                  <Link2Icon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span>Copy deep link URL</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyIframe}
                  className="w-full justify-start gap-2 rounded-lg border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-normal text-neutral-200 hover:text-white"
                >
                  <Code2Icon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span>Copy iframe embed (?embed=1)</span>
                </Button>
              </div>
              {shareFeedback && (
                <div role="status" aria-live="polite" className="mt-2 text-[11px] text-emerald-400">
                  {shareFeedback}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
