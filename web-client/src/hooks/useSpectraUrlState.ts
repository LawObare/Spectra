import { useQueryState, parseAsFloat, parseAsString, parseAsInteger } from 'nuqs';

/**
 * Type-Safe URL Query State Management via nuqs
 * Specification Anchor: SPECIFICATION.md §6.1.3
 * URL Query Keys: Strictly tab, ra, dec, fov, cadence, mode, preset, z, px, py, embed
 */
export function useSpectraUrlState() {
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('navigator'));
  const [ra, setRa] = useQueryState('ra', parseAsFloat.withDefault(133.737120));
  const [dec, setDec] = useQueryState('dec', parseAsFloat.withDefault(-7.240380));
  const [fov, setFov] = useQueryState('fov', parseAsFloat.withDefault(180.0));
  const [cadence, setCadence] = useQueryState('cadence', parseAsString.withDefault('survey_6month'));
  const [mode, setMode] = useQueryState('mode', parseAsString.withDefault('blink'));
  const [preset, setPreset] = useQueryState('preset', parseAsString.withDefault('brown_dwarf'));
  const [z, setZ] = useQueryState('z', parseAsFloat.withDefault(0.0));
  const [probeX, setProbeX] = useQueryState('px', parseAsInteger.withDefault(16));
  const [probeY, setProbeY] = useQueryState('py', parseAsInteger.withDefault(16));
  const [embed, setEmbed] = useQueryState('embed', parseAsString.withDefault('0'));

  const isEmbed = embed === '1' || embed === 'true';

  return {
    tab,
    setTab,
    ra,
    setRa,
    dec,
    setDec,
    fov,
    setFov,
    cadence,
    setCadence,
    mode,
    setMode,
    preset,
    setPreset,
    z,
    setZ,
    probeX,
    setProbeX,
    probeY,
    setProbeY,
    embed,
    setEmbed,
    isEmbed,
  };
}
