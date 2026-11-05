-- ============================================================================
-- Spectra Database Seed Script (Supabase PostgreSQL 16)
-- Populates 5 NASA Benchmark Targets at Epoch 2025.5, Active Learning Queue,
-- Sample Observer Profiles, and Observation Discussion Threads.
-- SPECIFICATION.md §2.2, §5.1, §9.2
-- ============================================================================

-- 0. Telemetry Heartbeat
INSERT INTO heartbeat (id, last_ping, irsa_status, active_workers)
VALUES (1, NOW(), 'operational', 1)
ON CONFLICT (id) DO UPDATE SET last_ping = EXCLUDED.last_ping, irsa_status = EXCLUDED.irsa_status;

-- 1. Seed Observer Profiles (Zero-Auth Cryptographic Session Fingerprints)
INSERT INTO observers (observer_id, key_hash, handle, total_classifications, calibration_seen, calibration_correct, reliability_weight)
VALUES
    ('00000000-0000-0000-0000-000000000001', encode(sha256('system_moderator_key'::bytea), 'hex'), 'SPHEREx-Moderator', 250, 250, 250, 1.00),
    ('11111111-1111-1111-1111-111111111111', encode(sha256('observer_vega_409'::bytea), 'hex'), 'Observer-Vega-409', 42, 10, 9, 0.95),
    ('22222222-2222-2222-2222-222222222222', encode(sha256('observer_orion_112'::bytea), 'hex'), 'Observer-Orion-112', 31, 8, 7, 0.88),
    ('33333333-3333-3333-3333-333333333333', encode(sha256('observer_cygnus_774'::bytea), 'hex'), 'Observer-Cygnus-774', 58, 14, 13, 0.92),
    ('44444444-4444-4444-4444-444444444444', encode(sha256('observer_draco_052'::bytea), 'hex'), 'Observer-Draco-052', 19, 5, 4, 0.83),
    ('55555555-5555-5555-5555-555555555555', encode(sha256('observer_cassiopeia_318'::bytea), 'hex'), 'Observer-Cassiopeia-318', 27, 6, 5, 0.86)
ON CONFLICT (observer_id) DO UPDATE SET
    handle = EXCLUDED.handle,
    reliability_weight = EXCLUDED.reliability_weight;

-- 2. The 5 Mandatory NASA Benchmark Targets (Epoch 2025.5 Ground Truth)
-- Target: Barnard's Star
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, consensus_class, consensus_score,
    shannon_entropy, verification_status, data_release
) VALUES (
    'benchmark_barnard', 'Barnard''s Star', 'benchmark',
    269.44639, 4.76676, 180.0, 'comparator',
    TRUE, 'M4V Red Dwarf', ARRAY[31.4253, 28.6820, 26.2473, 24.0660, 22.0957, 20.3035, 18.6637, 17.1561, 15.7644, 14.4759, 13.2801, 12.1685, 11.1342, 10.1713, 9.2751, 8.4413, 7.6663, 6.9469, 6.2801, 5.6633, 5.0939, 4.5694, 4.0877, 3.6463, 3.2431, 2.8758, 2.5424, 2.2405, 1.9683, 1.7235, 1.5043, 1.3085, 1.1344, 0.9801, 0.8439, 0.7240, 0.6190, 0.5274, 0.4477, 0.3786, 0.3191, 0.2679, 0.2241, 0.1868, 0.1551, 0.1283, 0.1057, 0.0868, 0.0710, 0.0578, 0.0469, 0.0379, 0.0305, 0.0245, 0.0196, 0.0156, 0.0123, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100, 0.0100]::REAL[], 0.0,
    '{}'::jsonb, 0.92, 'high_proper_motion_star', '{"high_proper_motion_star": 0.92, "other": 0.08}'::jsonb,
    'M4V high proper motion (+10.39"/yr North, 1.68 px/yr along PA 355.6°)', 12, 'high_proper_motion_star', 0.95,
    0.15, 'verified_discovery', 'spherex_qr2'
) ON CONFLICT (subject_id) DO UPDATE SET
    ra = EXCLUDED.ra,
    dec = EXCLUDED.dec,
    recommended_tab = EXCLUDED.recommended_tab,
    spectrum_array = EXCLUDED.spectrum_array;

-- Target: WISE 0855-0714
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, consensus_class, consensus_score,
    shannon_entropy, verification_status, data_release
) VALUES (
    'benchmark_wise_0855', 'WISE 0855-0714', 'benchmark',
    133.73712, -7.24038, 180.0, 'comparator',
    TRUE, 'Y4 Sub-Brown Dwarf', ARRAY[0.0050, 0.0067, 0.0068, 0.0053, 0.0035, 0.0031, 0.0044, 0.0063, 0.0070, 0.0058, 0.0039, 0.0030, 0.0039, 0.0058, 0.0070, 0.0063, 0.0044, 0.0031, 0.0035, 0.0053, 0.0068, 0.0067, 0.0050, 0.0033, 0.0032, 0.0047, 0.0065, 0.0069, 0.0055, 0.0037, 0.0030, 0.0042, 0.0061, 0.0070, 0.0061, 0.0041, 0.0030, 0.0037, 0.0056, 0.0069, 0.0065, 0.0047, 0.0032, 0.0033, 0.0050, 0.0067, 0.0068, 0.0052, 0.0035, 0.0031, 0.0045, 0.0063, 0.0070, 0.0058, 0.0039, 0.0030, 0.0040, 0.0059, 0.0070, 0.0063, 0.0044, 0.0031, 0.0035, 0.0053, 0.0068, 0.0067, 0.0049, 0.0033, 0.0032, 0.0048, 0.0065, 0.0069, 0.0055, 0.0101, 0.0102, 0.0104, 0.0110, 0.0119, 0.0138, 0.0171, 0.0228, 0.0319, 0.0460, 0.0665, 0.0948, 0.1319, 0.1775, 0.2302, 0.2870, 0.3433, 0.3938, 0.4327, 0.4554, 0.4590, 0.4430, 0.4096, 0.3627, 0.3079, 0.2507, 0.1960, 0.1476, 0.1073]::REAL[], 0.0,
    '{}'::jsonb, 0.98, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.92, "other": 0.08}'::jsonb,
    'Y4 sub-brown dwarf (8.15"/yr West along PA 274.7°, thermal peak in D5/D6)', 12, 'moving_brown_dwarf', 0.95,
    0.15, 'verified_discovery', 'spherex_qr2'
) ON CONFLICT (subject_id) DO UPDATE SET
    ra = EXCLUDED.ra,
    dec = EXCLUDED.dec,
    recommended_tab = EXCLUDED.recommended_tab,
    spectrum_array = EXCLUDED.spectrum_array;

-- Target: Epsilon Indi B
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, consensus_class, consensus_score,
    shannon_entropy, verification_status, data_release
) VALUES (
    'benchmark_eps_indi_b', 'Epsilon Indi B', 'benchmark',
    331.09566, -56.80031, 180.0, 'spectrophotometer',
    TRUE, 'T1+T6 Brown Dwarf Binary', ARRAY[7.0401, 6.3812, 5.8135, 5.3207, 4.8899, 4.5109, 4.1750, 3.8738, 3.5959, 3.3221, 3.0211, 2.6549, 2.2031, 1.6990, 1.2437, 0.9627, 0.9237, 1.0840, 1.3204, 1.5105, 1.5898, 1.5519, 1.4172, 1.2111, 0.9632, 0.7145, 0.5149, 0.4076, 0.4095, 0.5028, 0.6439, 0.7850, 0.8928, 0.9557, 0.9787, 0.9744, 0.9550, 0.9290, 0.9010, 0.8732, 0.8464, 0.8207, 0.7962, 0.7727, 0.7504, 0.7290, 0.7086, 0.6889, 0.6700, 0.6515, 0.6330, 0.6134, 0.5914, 0.5648, 0.5313, 0.4891, 0.4384, 0.3823, 0.3270, 0.2810, 0.2519, 0.2440, 0.2565, 0.2837, 0.3173, 0.3492, 0.3742, 0.3900, 0.3974, 0.3983, 0.3949, 0.3892, 0.3825, 0.3753, 0.3681, 0.3610, 0.3542, 0.3475, 0.3410, 0.3347, 0.3285, 0.3226, 0.3168, 0.3111, 0.3057, 0.3003, 0.2951, 0.2901, 0.2852, 0.2804, 0.2757, 0.2712, 0.2668, 0.2624, 0.2582, 0.2541, 0.2501, 0.2462, 0.2424, 0.2387, 0.2350, 0.2315]::REAL[], 0.0,
    '{}'::jsonb, 0.89, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.92, "other": 0.08}'::jsonb,
    'T1+T6 binary (4.68"/yr SE along PA 121.8°, 1/cos(dec) astrometric test)', 12, 'moving_brown_dwarf', 0.95,
    0.15, 'verified_discovery', 'spherex_qr2'
) ON CONFLICT (subject_id) DO UPDATE SET
    ra = EXCLUDED.ra,
    dec = EXCLUDED.dec,
    recommended_tab = EXCLUDED.recommended_tab,
    spectrum_array = EXCLUDED.spectrum_array;

-- Target: RW Aurigae
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, consensus_class, consensus_score,
    shannon_entropy, verification_status, data_release
) VALUES (
    'benchmark_rw_aur', 'RW Aurigae', 'benchmark',
    76.95647, 30.40130, 180.0, 'comparator',
    TRUE, 'Classical T Tauri Star', ARRAY[12.3542, 11.6342, 10.9903, 10.4111, 9.8876, 9.4121, 8.9785, 8.5814, 8.2166, 7.8803, 7.5693, 7.2809, 7.0129, 6.7630, 6.5296, 6.3112, 6.1063, 5.9137, 5.7325, 5.5616, 5.4003, 5.2477, 5.1032, 4.9662, 4.8363, 4.7129, 4.5956, 4.4841, 4.3780, 4.2771, 4.1812, 4.0900, 4.0033, 3.9212, 3.8434, 3.7700, 3.7009, 3.6360, 3.5755, 3.5192, 3.4674, 3.4200, 3.3770, 3.3384, 3.3043, 3.2746, 3.2492, 3.2281, 3.2109, 3.1976, 3.1877, 3.1808, 3.1766, 3.1744, 3.1738, 3.1740, 3.1745, 3.1744, 3.1732, 3.1701, 3.1645, 3.1557, 3.1432, 3.1266, 3.1055, 3.0797, 3.0489, 3.0133, 2.9729, 2.9279, 2.8787, 2.8258, 2.7695, 2.7105, 2.6493, 2.5867, 2.5232, 2.4595, 2.3962, 2.3338, 2.2728, 2.2136, 2.1566, 2.1020, 2.0502, 2.0011, 1.9550, 1.9118, 1.8714, 1.8338, 1.7988, 1.7664, 1.7364, 1.7085, 1.6825, 1.6584, 1.6359, 1.6148, 1.5950, 1.5763, 1.5586, 1.5418]::REAL[], 0.0,
    '{"H2O": 1.2e+17, "CO": 3.4e+16}'::jsonb, 0.85, 'variable_star', '{"variable_star": 0.92, "other": 0.08}'::jsonb,
    'Classical T Tauri star with circumstellar occultation dimming (>1.5 mag)', 12, 'variable_star', 0.95,
    0.15, 'verified_discovery', 'spherex_qr2'
) ON CONFLICT (subject_id) DO UPDATE SET
    ra = EXCLUDED.ra,
    dec = EXCLUDED.dec,
    recommended_tab = EXCLUDED.recommended_tab,
    spectrum_array = EXCLUDED.spectrum_array;

-- Target: R Draconis
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, consensus_class, consensus_score,
    shannon_entropy, verification_status, data_release
) VALUES (
    'benchmark_r_dra', 'R Draconis', 'benchmark',
    248.16773, 66.75504, 180.0, 'spectrophotometer',
    TRUE, 'Mira-type Pulsating AGB Variable', ARRAY[1.4740, 1.6294, 1.7958, 1.9734, 2.1622, 2.3621, 2.5728, 2.7941, 3.0255, 3.2664, 3.5161, 3.7737, 4.0382, 4.3086, 4.5835, 4.8615, 5.1413, 5.4211, 5.6993, 5.9742, 6.2438, 6.5064, 6.7600, 7.0029, 7.2330, 7.4488, 7.6483, 7.8301, 7.9926, 8.1344, 8.2543, 8.3513, 8.4245, 8.4734, 8.4974, 8.4963, 8.4703, 8.4194, 8.3442, 8.2452, 8.1235, 7.9799, 7.8158, 7.6326, 7.4316, 7.2146, 6.9833, 6.7395, 6.4851, 6.2219, 5.9517, 5.6765, 5.3981, 5.1182, 4.8386, 4.5607, 4.2861, 4.0162, 3.7522, 3.4952, 3.2462, 3.0061, 2.7755, 2.5551, 2.3452, 2.1463, 1.9584, 1.7817, 1.6162, 1.4617, 1.3181, 1.1851, 1.0624, 0.9496, 0.8462, 0.7519, 0.6661, 0.5884, 0.5182, 0.4549, 0.3981, 0.3471, 0.3013, 0.2600, 0.2226, 0.1887, 0.1577, 0.1296, 0.1044, 0.0826, 0.0645, 0.0502, 0.0500, 0.0500, 0.0500, 0.0500, 0.0500, 0.0500, 0.0500, 0.0500, 0.0500, 0.0500]::REAL[], 0.0,
    '{"H2O": 8.5e+16, "CO2": 2.1e+16}'::jsonb, 0.82, 'pulsating_variable', '{"pulsating_variable": 0.92, "other": 0.08}'::jsonb,
    'Mira AGB variable (P=245d pulsation cycle, 8.61° from NEP)', 12, 'pulsating_variable', 0.95,
    0.15, 'verified_discovery', 'spherex_qr2'
) ON CONFLICT (subject_id) DO UPDATE SET
    ra = EXCLUDED.ra,
    dec = EXCLUDED.dec,
    recommended_tab = EXCLUDED.recommended_tab,
    spectrum_array = EXCLUDED.spectrum_array;

-- 3. Active-Learning Queue Candidates (20 Distributed Science Targets)
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j032541-112045', 'SPX J0325-1120', 'queue_anomaly', 51.4231, -11.3458, 120.0, 'comparator',
    FALSE, NULL, ARRAY[0.2273, 0.2411, 0.2576, 0.2764, 0.2975, 0.3206, 0.3455, 0.3720, 0.3997, 0.4284, 0.4579, 0.4877, 0.5177, 0.5475, 0.5769, 0.6054, 0.6329, 0.6591, 0.6837, 0.7065, 0.7272, 0.7456, 0.7616, 0.7749, 0.7855, 0.7933, 0.7981, 0.8000, 0.7988, 0.7947, 0.7876, 0.7777, 0.7649, 0.7496, 0.7317, 0.7115, 0.6892, 0.6650, 0.6392, 0.6120, 0.5836, 0.5544, 0.5247, 0.4947, 0.4648, 0.4353, 0.4063, 0.3783, 0.3516, 0.3263, 0.3027, 0.2812, 0.2618, 0.2448, 0.2303, 0.2185, 0.2096, 0.2035, 0.2004, 0.2003, 0.2032, 0.2091, 0.2179, 0.2294, 0.2437, 0.2606, 0.2798, 0.3013, 0.3247, 0.3499, 0.3766, 0.4045, 0.4333, 0.4629, 0.4928, 0.5228, 0.5525, 0.5817, 0.6101, 0.6375, 0.6634, 0.6877, 0.7101, 0.7304, 0.7485, 0.7640, 0.7769, 0.7871, 0.7943, 0.7987, 0.8000, 0.7983, 0.7937, 0.7861, 0.7757, 0.7625, 0.7467, 0.7285, 0.7079, 0.6853, 0.6608, 0.6347]::REAL[], 0.00,
    '{}'::jsonb, 0.94, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.45).', 0, 1.45, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j051219+214402', 'SPX J0512+2144', 'queue_anomaly', 78.0812, 21.7341, 150.0, 'comparator',
    FALSE, NULL, ARRAY[0.7997, 0.7996, 0.7964, 0.7904, 0.7814, 0.7696, 0.7551, 0.7381, 0.7187, 0.6971, 0.6735, 0.6482, 0.6214, 0.5934, 0.5645, 0.5349, 0.5050, 0.4750, 0.4453, 0.4161, 0.3878, 0.3606, 0.3348, 0.3106, 0.2883, 0.2681, 0.2503, 0.2349, 0.2222, 0.2123, 0.2053, 0.2011, 0.2000, 0.2019, 0.2068, 0.2145, 0.2252, 0.2386, 0.2545, 0.2730, 0.2937, 0.3165, 0.3411, 0.3673, 0.3948, 0.4234, 0.4527, 0.4825, 0.5125, 0.5424, 0.5718, 0.6005, 0.6283, 0.6547, 0.6796, 0.7027, 0.7237, 0.7426, 0.7590, 0.7728, 0.7839, 0.7922, 0.7975, 0.7999, 0.7992, 0.7956, 0.7891, 0.7796, 0.7673, 0.7524, 0.7350, 0.7152, 0.6932, 0.6694, 0.6438, 0.6168, 0.5886, 0.5596, 0.5299, 0.5000, 0.4700, 0.4404, 0.4113, 0.3831, 0.3561, 0.3306, 0.3067, 0.2848, 0.2650, 0.2475, 0.2326, 0.2204, 0.2109, 0.2044, 0.2007, 0.2001, 0.2025, 0.2079, 0.2161, 0.2272, 0.2411, 0.2575]::REAL[], 0.00,
    '{}'::jsonb, 0.88, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.62).', 0, 1.62, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j091402-085521', 'SPX J0914-0855', 'queue_anomaly', 138.5089, -8.9225, 120.0, 'comparator',
    FALSE, NULL, ARRAY[0.7878, 0.7948, 0.7989, 0.8000, 0.7981, 0.7932, 0.7854, 0.7747, 0.7613, 0.7453, 0.7268, 0.7060, 0.6832, 0.6586, 0.6324, 0.6049, 0.5763, 0.5469, 0.5171, 0.4871, 0.4573, 0.4278, 0.3991, 0.3714, 0.3450, 0.3201, 0.2971, 0.2760, 0.2572, 0.2408, 0.2270, 0.2160, 0.2078, 0.2024, 0.2001, 0.2008, 0.2044, 0.2110, 0.2205, 0.2328, 0.2478, 0.2653, 0.2851, 0.3070, 0.3309, 0.3565, 0.3835, 0.4117, 0.4408, 0.4704, 0.5004, 0.5303, 0.5600, 0.5890, 0.6172, 0.6442, 0.6697, 0.6936, 0.7155, 0.7352, 0.7527, 0.7675, 0.7798, 0.7892, 0.7957, 0.7993, 0.7999, 0.7974, 0.7921, 0.7838, 0.7726, 0.7588, 0.7423, 0.7234, 0.7023, 0.6792, 0.6543, 0.6279, 0.6001, 0.5714, 0.5419, 0.5121, 0.4821, 0.4523, 0.4230, 0.3944, 0.3669, 0.3407, 0.3161, 0.2934, 0.2727, 0.2543, 0.2383, 0.2250, 0.2144, 0.2067, 0.2018, 0.2000, 0.2012, 0.2053, 0.2124, 0.2224]::REAL[], 0.00,
    '{}'::jsonb, 0.91, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.25).', 0, 1.25, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j110455+381209', 'SPX J1104+3812', 'queue_anomaly', 166.2301, 38.2025, 150.0, 'comparator',
    FALSE, NULL, ARRAY[0.2622, 0.2451, 0.2306, 0.2188, 0.2098, 0.2036, 0.2005, 0.2003, 0.2031, 0.2089, 0.2176, 0.2291, 0.2433, 0.2601, 0.2793, 0.3007, 0.3241, 0.3492, 0.3759, 0.4038, 0.4326, 0.4621, 0.4920, 0.5220, 0.5518, 0.5810, 0.6095, 0.6368, 0.6628, 0.6871, 0.7096, 0.7300, 0.7481, 0.7637, 0.7766, 0.7868, 0.7942, 0.7986, 0.8000, 0.7984, 0.7939, 0.7864, 0.7760, 0.7629, 0.7471, 0.7289, 0.7084, 0.6859, 0.6614, 0.6354, 0.6080, 0.5795, 0.5502, 0.5204, 0.4904, 0.4606, 0.4311, 0.4023, 0.3744, 0.3479, 0.3228, 0.2995, 0.2782, 0.2592, 0.2425, 0.2284, 0.2171, 0.2085, 0.2029, 0.2002, 0.2006, 0.2039, 0.2102, 0.2193, 0.2313, 0.2460, 0.2632, 0.2828, 0.3045, 0.3282, 0.3536, 0.3805, 0.4086, 0.4375, 0.4671, 0.4971, 0.5270, 0.5567, 0.5859, 0.6141, 0.6413, 0.6670, 0.6910, 0.7132, 0.7332, 0.7509, 0.7660, 0.7785, 0.7883, 0.7951, 0.7990, 0.7999]::REAL[], 0.00,
    '{}'::jsonb, 0.82, 'high_proper_motion_star', '{"high_proper_motion_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.10).', 0, 1.10, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j145520-421105', 'SPX J1455-4211', 'queue_anomaly', 223.8354, -42.1848, 180.0, 'comparator',
    FALSE, NULL, ARRAY[0.3853, 0.3582, 0.3325, 0.3085, 0.2864, 0.2664, 0.2488, 0.2337, 0.2212, 0.2116, 0.2048, 0.2009, 0.2001, 0.2022, 0.2073, 0.2154, 0.2263, 0.2399, 0.2561, 0.2748, 0.2957, 0.3186, 0.3434, 0.3697, 0.3974, 0.4260, 0.4554, 0.4852, 0.5152, 0.5451, 0.5745, 0.6031, 0.6307, 0.6570, 0.6817, 0.7047, 0.7255, 0.7442, 0.7603, 0.7739, 0.7848, 0.7928, 0.7978, 0.7999, 0.7990, 0.7952, 0.7883, 0.7786, 0.7661, 0.7509, 0.7333, 0.7133, 0.6911, 0.6671, 0.6414, 0.6143, 0.5860, 0.5569, 0.5272, 0.4972, 0.4673, 0.4377, 0.4087, 0.3806, 0.3538, 0.3283, 0.3046, 0.2829, 0.2633, 0.2461, 0.2314, 0.2194, 0.2102, 0.2039, 0.2006, 0.2002, 0.2029, 0.2085, 0.2170, 0.2284, 0.2424, 0.2591, 0.2781, 0.2994, 0.3227, 0.3477, 0.3743, 0.4021, 0.4309, 0.4604, 0.4903, 0.5203, 0.5500, 0.5793, 0.6078, 0.6352, 0.6613, 0.6857, 0.7083, 0.7288, 0.7471, 0.7628]::REAL[], 0.00,
    '{}'::jsonb, 0.89, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.35).', 0, 1.35, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j180211+094412', 'SPX J1802+0944', 'queue_anomaly', 270.5482, 9.7367, 120.0, 'comparator',
    FALSE, NULL, ARRAY[0.7817, 0.7700, 0.7556, 0.7386, 0.7192, 0.6977, 0.6742, 0.6489, 0.6222, 0.5942, 0.5653, 0.5358, 0.5059, 0.4759, 0.4461, 0.4170, 0.3886, 0.3613, 0.3355, 0.3112, 0.2889, 0.2687, 0.2508, 0.2353, 0.2226, 0.2126, 0.2054, 0.2012, 0.2000, 0.2018, 0.2066, 0.2143, 0.2248, 0.2381, 0.2541, 0.2724, 0.2931, 0.3158, 0.3404, 0.3665, 0.3940, 0.4226, 0.4519, 0.4817, 0.5117, 0.5415, 0.5710, 0.5997, 0.6275, 0.6540, 0.6789, 0.7020, 0.7232, 0.7421, 0.7586, 0.7725, 0.7836, 0.7920, 0.7974, 0.7998, 0.7993, 0.7958, 0.7893, 0.7799, 0.7677, 0.7529, 0.7355, 0.7158, 0.6939, 0.6701, 0.6445, 0.6176, 0.5894, 0.5604, 0.5308, 0.5008, 0.4709, 0.4412, 0.4121, 0.3839, 0.3569, 0.3313, 0.3074, 0.2854, 0.2655, 0.2480, 0.2330, 0.2207, 0.2112, 0.2045, 0.2008, 0.2001, 0.2024, 0.2077, 0.2158, 0.2269, 0.2406, 0.2570, 0.2757, 0.2968, 0.3198, 0.3447]::REAL[], 0.00,
    '{}'::jsonb, 0.85, 'high_proper_motion_star', '{"high_proper_motion_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.15).', 0, 1.15, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j211944-301255', 'SPX J2119-3012', 'queue_anomaly', 319.9342, -30.2153, 150.0, 'comparator',
    FALSE, NULL, ARRAY[0.6638, 0.6881, 0.7104, 0.7307, 0.7487, 0.7642, 0.7771, 0.7872, 0.7944, 0.7987, 0.8000, 0.7983, 0.7936, 0.7860, 0.7755, 0.7623, 0.7465, 0.7282, 0.7076, 0.6849, 0.6604, 0.6343, 0.6068, 0.5783, 0.5490, 0.5192, 0.4892, 0.4594, 0.4299, 0.4011, 0.3733, 0.3468, 0.3218, 0.2986, 0.2774, 0.2585, 0.2419, 0.2279, 0.2167, 0.2082, 0.2027, 0.2002, 0.2006, 0.2041, 0.2105, 0.2198, 0.2319, 0.2466, 0.2639, 0.2836, 0.3054, 0.3292, 0.3547, 0.3816, 0.4097, 0.4387, 0.4684, 0.4983, 0.5283, 0.5579, 0.5870, 0.6153, 0.6423, 0.6680, 0.6920, 0.7140, 0.7339, 0.7515, 0.7666, 0.7790, 0.7886, 0.7953, 0.7991, 0.7999, 0.7977, 0.7925, 0.7844, 0.7735, 0.7598, 0.7435, 0.7248, 0.7039, 0.6809, 0.6561, 0.6298, 0.6021, 0.5734, 0.5440, 0.5142, 0.4842, 0.4544, 0.4250, 0.3964, 0.3688, 0.3425, 0.3178, 0.2949, 0.2741, 0.2555, 0.2394, 0.2258, 0.2150]::REAL[], 0.00,
    '{}'::jsonb, 0.93, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.70).', 0, 1.70, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j234812+012019', 'SPX J2348+0120', 'queue_anomaly', 357.0504, 1.3386, 120.0, 'comparator',
    FALSE, NULL, ARRAY[0.2265, 0.2155, 0.2074, 0.2023, 0.2001, 0.2009, 0.2047, 0.2114, 0.2210, 0.2334, 0.2485, 0.2661, 0.2860, 0.3081, 0.3321, 0.3577, 0.3848, 0.4130, 0.4421, 0.4718, 0.5018, 0.5317, 0.5613, 0.5904, 0.6185, 0.6454, 0.6709, 0.6946, 0.7164, 0.7361, 0.7534, 0.7682, 0.7803, 0.7895, 0.7959, 0.7994, 0.7998, 0.7973, 0.7917, 0.7833, 0.7720, 0.7581, 0.7415, 0.7225, 0.7013, 0.6781, 0.6531, 0.6266, 0.5988, 0.5700, 0.5406, 0.5107, 0.4807, 0.4509, 0.4216, 0.3931, 0.3657, 0.3395, 0.3150, 0.2924, 0.2718, 0.2535, 0.2377, 0.2244, 0.2140, 0.2064, 0.2017, 0.2000, 0.2013, 0.2056, 0.2128, 0.2229, 0.2358, 0.2513, 0.2693, 0.2896, 0.3120, 0.3363, 0.3622, 0.3895, 0.4179, 0.4471, 0.4768, 0.5068, 0.5367, 0.5663, 0.5952, 0.6231, 0.6498, 0.6750, 0.6984, 0.7199, 0.7392, 0.7561, 0.7704, 0.7820, 0.7908, 0.7967, 0.7997, 0.7996, 0.7965, 0.7905]::REAL[], 0.00,
    '{}'::jsonb, 0.87, 'moving_brown_dwarf', '{"moving_brown_dwarf": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.40).', 0, 1.40, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j021533+412055', 'SPX J0215+4120', 'queue_anomaly', 33.8875, 41.3486, 180.0, 'spectrophotometer',
    FALSE, NULL, ARRAY[0.4266, 0.3979, 0.3703, 0.3439, 0.3191, 0.2961, 0.2752, 0.2565, 0.2402, 0.2265, 0.2156, 0.2075, 0.2023, 0.2001, 0.2009, 0.2047, 0.2114, 0.2210, 0.2334, 0.2485, 0.2660, 0.2860, 0.3080, 0.3320, 0.3576, 0.3847, 0.4129, 0.4420, 0.4717, 0.5017, 0.5316, 0.5612, 0.5902, 0.6184, 0.6453, 0.6708, 0.6945, 0.7164, 0.7360, 0.7533, 0.7681, 0.7802, 0.7895, 0.7959, 0.7994, 0.7998, 0.7973, 0.7918, 0.7833, 0.7721, 0.7581, 0.7416, 0.7226, 0.7014, 0.6782, 0.6532, 0.6267, 0.5989, 0.5702, 0.5407, 0.5108, 0.4808, 0.4510, 0.4217, 0.3932, 0.3657, 0.3396, 0.3151, 0.2925, 0.2719, 0.2536, 0.2377, 0.2245, 0.2140, 0.2064, 0.2017, 0.2000, 0.2013, 0.2056, 0.2128, 0.2229, 0.2357, 0.2512, 0.2692, 0.2895, 0.3119, 0.3362, 0.3621, 0.3894, 0.4178, 0.4470, 0.4767, 0.5067, 0.5366, 0.5662, 0.5950, 0.6230, 0.6497, 0.6749, 0.6984, 0.7198, 0.7391]::REAL[], 0.00,
    '{}'::jsonb, 0.78, 'variable_star', '{"variable_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 0.95).', 0, 0.95, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j064512-164258', 'SPX J0645-1642', 'queue_anomaly', 101.3000, -16.7161, 180.0, 'comparator',
    FALSE, NULL, ARRAY[0.3055, 0.2837, 0.2640, 0.2467, 0.2319, 0.2198, 0.2105, 0.2041, 0.2006, 0.2002, 0.2027, 0.2082, 0.2166, 0.2279, 0.2418, 0.2584, 0.2773, 0.2985, 0.3217, 0.3467, 0.3732, 0.4010, 0.4297, 0.4592, 0.4891, 0.5191, 0.5489, 0.5782, 0.6067, 0.6342, 0.6603, 0.6848, 0.7075, 0.7281, 0.7464, 0.7622, 0.7755, 0.7860, 0.7936, 0.7983, 0.8000, 0.7987, 0.7944, 0.7872, 0.7771, 0.7643, 0.7488, 0.7308, 0.7105, 0.6882, 0.6639, 0.6380, 0.6107, 0.5823, 0.5531, 0.5234, 0.4934, 0.4635, 0.4339, 0.4051, 0.3771, 0.3504, 0.3252, 0.3017, 0.2802, 0.2609, 0.2440, 0.2297, 0.2181, 0.2092, 0.2033, 0.2004, 0.2004, 0.2034, 0.2094, 0.2183, 0.2300, 0.2444, 0.2614, 0.2807, 0.3023, 0.3258, 0.3511, 0.3778, 0.4058, 0.4347, 0.4642, 0.4941, 0.5241, 0.5538, 0.5830, 0.6114, 0.6387, 0.6645, 0.6887, 0.7111, 0.7313, 0.7492, 0.7647, 0.7774, 0.7874, 0.7946]::REAL[], 0.00,
    '{}'::jsonb, 0.84, 'pulsating_variable', '{"pulsating_variable": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.20).', 0, 1.20, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j122906+020308', 'SPX J1229+0203', 'queue_anomaly', 187.2750, 2.0522, 180.0, 'spectrophotometer',
    FALSE, NULL, ARRAY[0.4635, 0.4934, 0.5234, 0.5531, 0.5823, 0.6107, 0.6380, 0.6639, 0.6882, 0.7105, 0.7308, 0.7488, 0.7643, 0.7771, 0.7872, 0.7944, 0.7987, 0.8000, 0.7983, 0.7936, 0.7860, 0.7755, 0.7622, 0.7464, 0.7281, 0.7075, 0.6848, 0.6603, 0.6342, 0.6067, 0.5782, 0.5489, 0.5191, 0.4891, 0.4592, 0.4298, 0.4010, 0.3732, 0.3467, 0.3217, 0.2985, 0.2773, 0.2584, 0.2418, 0.2279, 0.2166, 0.2082, 0.2027, 0.2002, 0.2006, 0.2041, 0.2105, 0.2198, 0.2319, 0.2467, 0.2640, 0.2837, 0.3055, 0.3293, 0.3548, 0.3817, 0.4098, 0.4389, 0.4685, 0.4984, 0.5284, 0.5581, 0.5872, 0.6154, 0.6424, 0.6681, 0.6921, 0.7141, 0.7340, 0.7516, 0.7666, 0.7790, 0.7886, 0.7954, 0.7991, 0.7999, 0.7977, 0.7925, 0.7844, 0.7734, 0.7598, 0.7435, 0.7248, 0.7038, 0.6808, 0.6560, 0.6296, 0.6020, 0.5733, 0.5439, 0.5140, 0.4841, 0.4542, 0.4249, 0.3962, 0.3687, 0.3424]::REAL[], 0.00,
    '{}'::jsonb, 0.72, 'variable_star', '{"variable_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 0.88).', 0, 0.88, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j160522-241519', 'SPX J1605-2415', 'queue_anomaly', 241.3417, -24.2553, 150.0, 'comparator',
    FALSE, NULL, ARRAY[0.2478, 0.2653, 0.2851, 0.3071, 0.3310, 0.3565, 0.3836, 0.4118, 0.4408, 0.4705, 0.5004, 0.5304, 0.5600, 0.5891, 0.6172, 0.6442, 0.6697, 0.6936, 0.7155, 0.7353, 0.7527, 0.7676, 0.7798, 0.7892, 0.7957, 0.7993, 0.7999, 0.7974, 0.7921, 0.7838, 0.7726, 0.7587, 0.7423, 0.7234, 0.7023, 0.6792, 0.6543, 0.6278, 0.6001, 0.5714, 0.5419, 0.5120, 0.4821, 0.4523, 0.4229, 0.3944, 0.3669, 0.3407, 0.3161, 0.2934, 0.2727, 0.2543, 0.2383, 0.2250, 0.2144, 0.2067, 0.2018, 0.2000, 0.2012, 0.2053, 0.2124, 0.2224, 0.2352, 0.2506, 0.2684, 0.2886, 0.3110, 0.3352, 0.3610, 0.3882, 0.4166, 0.4458, 0.4755, 0.5055, 0.5354, 0.5650, 0.5939, 0.6218, 0.6486, 0.6739, 0.6974, 0.7190, 0.7384, 0.7554, 0.7698, 0.7815, 0.7905, 0.7965, 0.7996, 0.7997, 0.7967, 0.7909, 0.7821, 0.7705, 0.7562, 0.7393, 0.7200, 0.6986, 0.6751, 0.6499, 0.6232, 0.5953]::REAL[], 0.00,
    '{}'::jsonb, 0.76, 'variable_star', '{"variable_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.05).', 0, 1.05, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j192518+424701', 'SPX J1925+4247', 'queue_anomaly', 291.3250, 42.7836, 180.0, 'spectrophotometer',
    FALSE, NULL, ARRAY[0.2730, 0.2546, 0.2386, 0.2252, 0.2145, 0.2068, 0.2019, 0.2000, 0.2011, 0.2053, 0.2123, 0.2222, 0.2349, 0.2503, 0.2681, 0.2883, 0.3106, 0.3347, 0.3606, 0.3878, 0.4161, 0.4453, 0.4750, 0.5050, 0.5349, 0.5645, 0.5934, 0.6214, 0.6482, 0.6735, 0.6970, 0.7186, 0.7381, 0.7551, 0.7696, 0.7814, 0.7904, 0.7964, 0.7996, 0.7997, 0.7968, 0.7910, 0.7822, 0.7707, 0.7564, 0.7396, 0.7204, 0.6989, 0.6755, 0.6504, 0.6237, 0.5958, 0.5669, 0.5374, 0.5075, 0.4775, 0.4478, 0.4185, 0.3901, 0.3628, 0.3369, 0.3125, 0.2901, 0.2697, 0.2517, 0.2361, 0.2232, 0.2130, 0.2057, 0.2014, 0.2000, 0.2016, 0.2062, 0.2138, 0.2242, 0.2373, 0.2531, 0.2714, 0.2919, 0.3145, 0.3390, 0.3650, 0.3925, 0.4210, 0.4502, 0.4800, 0.5100, 0.5399, 0.5694, 0.5982, 0.6260, 0.6525, 0.6776, 0.7008, 0.7221, 0.7411, 0.7577, 0.7718, 0.7831, 0.7916, 0.7972, 0.7998]::REAL[], 0.00,
    '{}'::jsonb, 0.81, 'pulsating_variable', '{"pulsating_variable": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.15).', 0, 1.15, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_j205611+445520', 'SPX J2056+4455', 'queue_anomaly', 314.0458, 44.9222, 180.0, 'comparator',
    FALSE, NULL, ARRAY[0.4966, 0.5266, 0.5563, 0.5854, 0.6137, 0.6408, 0.6666, 0.6906, 0.7128, 0.7329, 0.7506, 0.7658, 0.7784, 0.7881, 0.7950, 0.7990, 0.8000, 0.7979, 0.7929, 0.7850, 0.7742, 0.7607, 0.7445, 0.7260, 0.7051, 0.6823, 0.6576, 0.6313, 0.6037, 0.5751, 0.5457, 0.5159, 0.4859, 0.4560, 0.4266, 0.3980, 0.3703, 0.3439, 0.3191, 0.2962, 0.2752, 0.2565, 0.2402, 0.2265, 0.2156, 0.2075, 0.2023, 0.2001, 0.2009, 0.2046, 0.2114, 0.2210, 0.2334, 0.2484, 0.2660, 0.2859, 0.3080, 0.3320, 0.3576, 0.3847, 0.4129, 0.4420, 0.4717, 0.5016, 0.5316, 0.5612, 0.5902, 0.6183, 0.6453, 0.6707, 0.6945, 0.7163, 0.7360, 0.7533, 0.7681, 0.7802, 0.7895, 0.7959, 0.7994, 0.7998, 0.7973, 0.7918, 0.7834, 0.7721, 0.7581, 0.7416, 0.7226, 0.7014, 0.6782, 0.6532, 0.6267, 0.5989, 0.5702, 0.5407, 0.5108, 0.4809, 0.4511, 0.4218, 0.3932, 0.3658, 0.3397, 0.3151]::REAL[], 0.00,
    '{}'::jsonb, 0.75, 'variable_star', '{"variable_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 0.90).', 0, 0.90, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_splices_0142', 'SPLICES J1627-2430', 'queue_anomaly', 246.7500, -24.5000, 180.0, 'ice_studio',
    FALSE, NULL, ARRAY[0.3674, 0.3950, 0.4235, 0.4529, 0.4827, 0.5127, 0.5425, 0.5720, 0.6007, 0.6284, 0.6548, 0.6797, 0.7028, 0.7238, 0.7427, 0.7591, 0.7729, 0.7840, 0.7922, 0.7975, 0.7999, 0.7992, 0.7956, 0.7890, 0.7795, 0.7673, 0.7523, 0.7349, 0.7151, 0.6931, 0.6692, 0.6437, 0.6166, 0.5885, 0.5594, 0.5298, 0.4998, 0.4699, 0.4402, 0.4112, 0.3830, 0.3560, 0.3304, 0.3066, 0.2847, 0.2649, 0.2475, 0.2325, 0.2203, 0.2109, 0.2043, 0.2007, 0.2001, 0.2025, 0.2079, 0.2162, 0.2273, 0.2411, 0.2576, 0.2764, 0.2975, 0.3206, 0.3455, 0.3720, 0.3997, 0.4284, 0.4579, 0.4877, 0.5177, 0.5475, 0.5769, 0.6054, 0.6329, 0.6591, 0.6837, 0.7065, 0.7272, 0.7456, 0.7616, 0.7749, 0.7855, 0.7933, 0.7981, 0.8000, 0.7988, 0.7947, 0.7876, 0.7777, 0.7649, 0.7496, 0.7317, 0.7115, 0.6892, 0.6650, 0.6392, 0.6120, 0.5836, 0.5545, 0.5247, 0.4948, 0.4648, 0.4353]::REAL[], 0.00,
    '{"H2O": 1.5e+17, "CO2": 3.8e+16, "CO": 8200000000000000.0}'::jsonb, 0.86, 'ice_background_star', '{"ice_background_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.30).', 0, 1.30, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_splices_0588', 'SPLICES J1810-1802', 'queue_anomaly', 272.5000, -18.0333, 180.0, 'ice_studio',
    FALSE, NULL, ARRAY[0.7563, 0.7395, 0.7202, 0.6988, 0.6754, 0.6502, 0.6235, 0.5956, 0.5667, 0.5372, 0.5073, 0.4773, 0.4476, 0.4183, 0.3899, 0.3626, 0.3367, 0.3124, 0.2899, 0.2696, 0.2516, 0.2360, 0.2231, 0.2130, 0.2057, 0.2014, 0.2000, 0.2016, 0.2063, 0.2138, 0.2243, 0.2374, 0.2532, 0.2715, 0.2920, 0.3147, 0.3391, 0.3652, 0.3927, 0.4212, 0.4505, 0.4802, 0.5102, 0.5401, 0.5696, 0.5984, 0.6262, 0.6527, 0.6777, 0.7010, 0.7222, 0.7412, 0.7578, 0.7718, 0.7832, 0.7916, 0.7972, 0.7998, 0.7994, 0.7960, 0.7897, 0.7804, 0.7684, 0.7537, 0.7364, 0.7168, 0.6950, 0.6712, 0.6458, 0.6189, 0.5908, 0.5618, 0.5322, 0.5023, 0.4723, 0.4426, 0.4135, 0.3853, 0.3582, 0.3325, 0.3085, 0.2864, 0.2664, 0.2488, 0.2337, 0.2212, 0.2115, 0.2048, 0.2009, 0.2001, 0.2022, 0.2073, 0.2154, 0.2263, 0.2399, 0.2561, 0.2748, 0.2957, 0.3187, 0.3434, 0.3698, 0.3974]::REAL[], 0.00,
    '{"H2O": 1.5e+17, "CO2": 3.8e+16, "CO": 8200000000000000.0}'::jsonb, 0.90, 'ice_background_star', '{"ice_background_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.55).', 0, 1.55, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_splices_0912', 'SPLICES J2039+4219', 'queue_anomaly', 309.7500, 42.3167, 180.0, 'ice_studio',
    FALSE, NULL, ARRAY[0.3720, 0.3997, 0.4284, 0.4579, 0.4877, 0.5177, 0.5475, 0.5769, 0.6054, 0.6329, 0.6591, 0.6837, 0.7065, 0.7272, 0.7456, 0.7616, 0.7749, 0.7855, 0.7933, 0.7981, 0.8000, 0.7988, 0.7947, 0.7876, 0.7777, 0.7649, 0.7496, 0.7317, 0.7115, 0.6892, 0.6650, 0.6392, 0.6120, 0.5836, 0.5545, 0.5247, 0.4948, 0.4648, 0.4353, 0.4063, 0.3784, 0.3516, 0.3263, 0.3028, 0.2812, 0.2618, 0.2448, 0.2303, 0.2185, 0.2096, 0.2035, 0.2004, 0.2003, 0.2032, 0.2091, 0.2178, 0.2294, 0.2437, 0.2606, 0.2798, 0.3013, 0.3247, 0.3499, 0.3765, 0.4045, 0.4333, 0.4629, 0.4928, 0.5227, 0.5525, 0.5817, 0.6101, 0.6374, 0.6634, 0.6877, 0.7101, 0.7304, 0.7485, 0.7640, 0.7769, 0.7870, 0.7943, 0.7986, 0.8000, 0.7983, 0.7937, 0.7861, 0.7757, 0.7625, 0.7467, 0.7285, 0.7079, 0.6853, 0.6608, 0.6347, 0.6073, 0.5788, 0.5495, 0.5197, 0.4897, 0.4598, 0.4304]::REAL[], 0.00,
    '{"H2O": 1.5e+17, "CO2": 3.8e+16, "CO": 8200000000000000.0}'::jsonb, 0.84, 'ice_background_star', '{"ice_background_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.25).', 0, 1.25, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_splices_1140', 'SPLICES J0431+1808', 'queue_anomaly', 67.7500, 18.1333, 180.0, 'ice_studio',
    FALSE, NULL, ARRAY[0.6417, 0.6674, 0.6914, 0.7135, 0.7335, 0.7511, 0.7662, 0.7787, 0.7884, 0.7952, 0.7991, 0.7999, 0.7978, 0.7927, 0.7847, 0.7738, 0.7602, 0.7440, 0.7253, 0.7044, 0.6815, 0.6567, 0.6304, 0.6028, 0.5742, 0.5448, 0.5149, 0.4849, 0.4551, 0.4257, 0.3971, 0.3695, 0.3431, 0.3184, 0.2955, 0.2746, 0.2559, 0.2397, 0.2261, 0.2153, 0.2073, 0.2022, 0.2001, 0.2009, 0.2048, 0.2116, 0.2213, 0.2338, 0.2490, 0.2666, 0.2866, 0.3087, 0.3328, 0.3584, 0.3856, 0.4138, 0.4429, 0.4726, 0.5026, 0.5325, 0.5621, 0.5911, 0.6192, 0.6461, 0.6715, 0.6952, 0.7170, 0.7366, 0.7538, 0.7685, 0.7805, 0.7897, 0.7961, 0.7994, 0.7998, 0.7972, 0.7916, 0.7830, 0.7717, 0.7576, 0.7410, 0.7220, 0.7007, 0.6775, 0.6524, 0.6259, 0.5981, 0.5693, 0.5398, 0.5099, 0.4799, 0.4501, 0.4208, 0.3923, 0.3649, 0.3389, 0.3144, 0.2918, 0.2713, 0.2530, 0.2373, 0.2241]::REAL[], 0.00,
    '{"H2O": 1.5e+17, "CO2": 3.8e+16, "CO": 8200000000000000.0}'::jsonb, 0.88, 'ice_background_star', '{"ice_background_star": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.40).', 0, 1.40, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_gal_0332', 'SPX Galaxy 0332-2748', 'queue_anomaly', 53.1167, -27.8083, 180.0, 'spectrophotometer',
    FALSE, NULL, ARRAY[0.2523, 0.2704, 0.2908, 0.3133, 0.3377, 0.3637, 0.3911, 0.4195, 0.4488, 0.4786, 0.5085, 0.5384, 0.5680, 0.5968, 0.6246, 0.6513, 0.6764, 0.6997, 0.7211, 0.7402, 0.7570, 0.7711, 0.7826, 0.7912, 0.7970, 0.7997, 0.7995, 0.7963, 0.7901, 0.7810, 0.7691, 0.7545, 0.7374, 0.7179, 0.6963, 0.6726, 0.6473, 0.6204, 0.5924, 0.5634, 0.5339, 0.5039, 0.4740, 0.4443, 0.4151, 0.3868, 0.3596, 0.3339, 0.3098, 0.2876, 0.2675, 0.2497, 0.2344, 0.2218, 0.2120, 0.2051, 0.2011, 0.2000, 0.2020, 0.2070, 0.2149, 0.2256, 0.2391, 0.2552, 0.2737, 0.2945, 0.3173, 0.3420, 0.3682, 0.3958, 0.4244, 0.4538, 0.4836, 0.5136, 0.5434, 0.5729, 0.6015, 0.6292, 0.6556, 0.6804, 0.7035, 0.7245, 0.7432, 0.7595, 0.7733, 0.7842, 0.7924, 0.7976, 0.7999, 0.7992, 0.7954, 0.7888, 0.7792, 0.7669, 0.7518, 0.7343, 0.7144, 0.6924, 0.6685, 0.6429, 0.6158, 0.5876]::REAL[], 0.85,
    '{}'::jsonb, 0.81, 'galaxy', '{"galaxy": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.65).', 0, 1.65, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;
INSERT INTO subjects (
    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,
    is_calibration, expert_ground_truth, spectrum_array, redshift_z,
    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,
    ai_explanation, classification_count, shannon_entropy, verification_status, data_release
) VALUES (
    'spx_gal_1236', 'SPX Galaxy 1236+6214', 'queue_anomaly', 189.2000, 62.2333, 180.0, 'spectrophotometer',
    FALSE, NULL, ARRAY[0.5211, 0.5509, 0.5801, 0.6086, 0.6360, 0.6620, 0.6864, 0.7089, 0.7294, 0.7475, 0.7632, 0.7763, 0.7866, 0.7940, 0.7985, 0.8000, 0.7985, 0.7940, 0.7866, 0.7764, 0.7633, 0.7477, 0.7295, 0.7091, 0.6866, 0.6622, 0.6362, 0.6088, 0.5804, 0.5511, 0.5213, 0.4913, 0.4615, 0.4319, 0.4031, 0.3753, 0.3486, 0.3235, 0.3002, 0.2789, 0.2597, 0.2430, 0.2288, 0.2174, 0.2087, 0.2030, 0.2003, 0.2005, 0.2037, 0.2099, 0.2190, 0.2309, 0.2455, 0.2626, 0.2821, 0.3038, 0.3275, 0.3528, 0.3797, 0.4077, 0.4367, 0.4662, 0.4962, 0.5261, 0.5558, 0.5850, 0.6133, 0.6405, 0.6662, 0.6903, 0.7125, 0.7326, 0.7504, 0.7656, 0.7782, 0.7880, 0.7950, 0.7990, 0.8000, 0.7980, 0.7930, 0.7851, 0.7744, 0.7609, 0.7448, 0.7262, 0.7054, 0.6826, 0.6579, 0.6317, 0.6041, 0.5755, 0.5461, 0.5163, 0.4863, 0.4565, 0.4270, 0.3984, 0.3707, 0.3443, 0.3195, 0.2965]::REAL[], 1.24,
    '{}'::jsonb, 0.83, 'galaxy', '{"galaxy": 0.8, "artifact": 0.2}'::jsonb,
    'Active-learning anomaly queued for citizen verification (Shannon entropy = 1.50).', 0, 1.50, 'pending', 'spherex_qr2'
) ON CONFLICT (subject_id) DO NOTHING;

-- 4. Observation Discussion Threads (Tab 5 Sample Community Discussions)
INSERT INTO discussion_threads (
    subject_id, author_id, author_handle, channel, title,
    body, hashtags, ra, dec, fov_arcsec, state_query, preview_metrics, upvotes, moderator_verified, admin_verification_note
) VALUES
    (
        'benchmark_barnard', '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'movers',
        'Confirmed +10.39"/yr proper motion on Barnard''s Star',
        'Official SPHEREx verification note: Barnard''s Star (M4V) exhibits unmistakable North-directed dipole motion across survey passes (+1.68 px/yr). Wavelength-matched differencing cleanly eliminates false LVF smile residuals.',
        '["#benchmark", "#high-proper-motion", "#red-dwarf", "#verified"]'::jsonb,
        269.44639, 4.76676, 180.0, 'tab=comparator&ra=269.44639&dec=4.76676&fov=180&mode=diff&preset=true_nir',
        '{"pm_arcsec_yr": 10.39, "snr": 48.2, "pa_deg": 355.6}'::jsonb, 15, TRUE, 'Verified by SPHEREx Mission Calibration Lead'
    ),
    (
        'benchmark_wise_0855', '11111111-1111-1111-1111-111111111111', 'Observer-Vega-409', 'movers',
        'Faint thermal dipole in D5/D6 coadds for cold brown dwarf WISE 0855',
        'Examined the inverse-variance coadd of Bands D5 and D6. As predicted, this sub-brown dwarf (T_eff ~ 250K) is completely invisible in Bands D1-D3 but clearly translates West at 8.15"/yr in the longer wavelengths.',
        '["#brown-dwarf", "#cold-y-dwarf", "#coadd", "#wise0855"]'::jsonb,
        133.73712, -7.24038, 180.0, 'tab=comparator&ra=133.73712&dec=-7.24038&fov=180&mode=diff&preset=brown_dwarf',
        '{"pm_arcsec_yr": 8.15, "snr": 7.4, "pa_deg": 274.7}'::jsonb, 11, FALSE, NULL
    ),
    (
        'benchmark_eps_indi_b', '22222222-2222-2222-2222-222222222222', 'Observer-Orion-112', 'spectra',
        'Composite T1+T6 spectral de-blending for Epsilon Indi B',
        'Loaded Epsilon Indi B in Tab 3. Running the two-component NNLS unmixing solver shows textbook methane absorption at 1.4 um and 1.9 um matching the unresolved T1+T6 binary template.',
        '["#spectral-unmixing", "#brown-dwarf-binary", "#methane"]'::jsonb,
        331.09566, -56.80031, 180.0, 'tab=spectrophotometer&ra=331.09566&dec=-56.80031&fov=180&preset=brown_dwarf',
        '{"t1_weight": 0.62, "t6_weight": 0.38, "nnls_residual": 0.041}'::jsonb, 9, TRUE, 'Consistent with ESO VLT synthetic binary benchmarks'
    ),
    (
        'benchmark_rw_aur', '33333333-3333-3333-3333-333333333333', 'Observer-Cygnus-774', 'discoveries',
        'Severe occultation dimming event observed in RW Aurigae',
        'Comparing Pass 1 against Pass 2 shows >1.6 mag dimming across all 6 detectors. Stationary monopole with circumstellar dust disk occultation.',
        '["#t-tauri", "#disk-occultation", "#variability"]'::jsonb,
        76.95647, 30.40130, 180.0, 'tab=comparator&ra=76.95647&dec=30.40130&fov=180&mode=diff&preset=comet_outgassing',
        '{"delta_mag": 1.62, "is_stationary": true}'::jsonb, 8, FALSE, NULL
    ),
    (
        'benchmark_r_dra', '44444444-4444-4444-4444-444444444444', 'Observer-Draco-052', 'spectra',
        'NEP Deep Field 245-day cycle validation on R Draconis',
        'Located only 8.61 degrees from NEP, R Draconis has high pass cadence. Spectral light curve clearly traces the 245-day Mira pulsation cycle with massive CO overtone fluctuations.',
        '["#mira-variable", "#agb-star", "#nep-deep-field"]'::jsonb,
        248.16773, 66.75504, 180.0, 'tab=spectrophotometer&ra=248.16773&dec=66.75504&fov=180&preset=water_ice',
        '{"period_days": 245.2, "co_depth": 0.42}'::jsonb, 7, FALSE, NULL
    ),
    (
        'spx_splices_0588', '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'ices',
        'Deep 3.05 μm H2O and 4.27 μm CO2 interstellar ice absorption in SPLICES candidate',
        'Pencil-beam optical depth integration toward background star SPLICES J1810-1802 reveals prominent water ice column density N(H2O) = 1.5e17 cm^-2 and CO2 column density N(CO2) = 3.8e16 cm^-2.',
        '["#interstellar-ice", "#splices", "#optical-depth", "#astrochemistry"]'::jsonb,
        272.5000, -18.0333, 180.0, 'tab=ice_studio&ra=272.5000&dec=-18.0333&fov=180',
        '{"n_h2o": 1.5e17, "n_co2": 3.8e16, "co2_to_h2o": 0.253}'::jsonb, 14, TRUE, 'Verified SPLICES dense cloud field candidate'
    );

-- 5. Sample Discussion Replies
INSERT INTO discussion_replies (thread_id, author_id, author_handle, body, moderator_verified)
VALUES
    (1, '11111111-1111-1111-1111-111111111111', 'Observer-Vega-409', 'The cyan Frame-0 reference ring in Tab 2 makes this displacement immediately obvious!', FALSE),
    (1, '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'Excellent observation. Note that the 1.68 px/yr motion aligns within 0.1 px of the Gaia DR3 astrometric prediction.', TRUE),
    (2, '33333333-3333-3333-3333-333333333333', 'Observer-Cygnus-774', 'Confirming non-detection in D1-D3. The honest [Not Detected at Pass Depth] state is very clear.', FALSE),
    (3, '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'Remember to check the 1/cos(dec) proper motion correction—v2.5 had a 46" offset that is now resolved.', TRUE),
    (4, '22222222-2222-2222-2222-222222222222', 'Observer-Orion-112', 'The aperture light curve in Tab 2 shows the sudden drop sharply.', FALSE),
    (6, '55555555-5555-5555-5555-555555555555', 'Observer-Cassiopeia-318', 'Is the 4.38 μm 13CO2 shoulder detectable at this depth?', FALSE),
    (6, '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'Yes, weak 13CO2 absorption is visible in the smoothed optical depth profile.', TRUE);
