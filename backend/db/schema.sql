-- Spectra Database Schema (Supabase PostgreSQL 16)
-- SPECIFICATION.md §5.1

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 0. Heartbeat Table for Container & IRSA Connectivity Telemetry
CREATE TABLE IF NOT EXISTS heartbeat (
    id INT PRIMARY KEY DEFAULT 1,
    last_ping TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    irsa_status TEXT NOT NULL DEFAULT 'operational',
    active_workers INT NOT NULL DEFAULT 1,
    CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO heartbeat (id, last_ping, irsa_status, active_workers)
VALUES (1, NOW(), 'operational', 1)
ON CONFLICT (id) DO NOTHING;

-- 1. Sky Subjects (Pre-seeded Benchmarks + Active-Learning Queue + On-Demand Cache)
CREATE TABLE IF NOT EXISTS subjects (
    subject_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    ra DOUBLE PRECISION NOT NULL,
    dec DOUBLE PRECISION NOT NULL,
    fov_arcsec DOUBLE PRECISION NOT NULL DEFAULT 180.0,
    recommended_tab TEXT NOT NULL,
    is_calibration BOOLEAN NOT NULL DEFAULT FALSE,
    expert_ground_truth TEXT,
    spectrum_array REAL[] NOT NULL,
    redshift_z DOUBLE PRECISION DEFAULT 0.0,
    ice_column_densities JSONB DEFAULT '{}'::jsonb,
    ai_anomaly_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    ai_predicted_class TEXT NOT NULL,
    ai_probabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_explanation TEXT NOT NULL,
    classification_count INT NOT NULL DEFAULT 0,
    consensus_class TEXT,
    consensus_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    shannon_entropy DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    data_release TEXT NOT NULL DEFAULT 'spherex_qr2',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subjects_spatial ON subjects (ra, dec);
CREATE INDEX IF NOT EXISTS idx_subjects_priority ON subjects (recommended_tab, shannon_entropy DESC, ai_anomaly_score DESC);

-- 2. Observer Profiles (Zero-Auth Cryptographic Session Fingerprinting)
CREATE TABLE IF NOT EXISTS observers (
    id BIGSERIAL PRIMARY KEY,
    observer_id UUID UNIQUE NOT NULL,
    key_hash TEXT NOT NULL,
    handle TEXT NOT NULL,
    total_classifications INT NOT NULL DEFAULT 0,
    calibration_seen INT NOT NULL DEFAULT 0,
    calibration_correct INT NOT NULL DEFAULT 0,
    reliability_weight DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Structured Classifications (Feeds Active-Learning & Consensus Engine)
CREATE TABLE IF NOT EXISTS classifications (
    id BIGSERIAL PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
    observer_id UUID NOT NULL REFERENCES observers(observer_id) ON DELETE CASCADE,
    tab_workflow TEXT NOT NULL,
    primary_class TEXT NOT NULL,
    feature_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    motion_telemetry JSONB,
    ice_aperture_telemetry JSONB,
    confidence DOUBLE PRECISION NOT NULL,
    observer_weight_snapshot DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classifications_subject ON classifications(subject_id);
CREATE INDEX IF NOT EXISTS idx_classifications_observer ON classifications(observer_id);

-- 4. Observation Discussion Threads (Tab 5 Public Feed)
CREATE TABLE IF NOT EXISTS discussion_threads (
    thread_id BIGSERIAL PRIMARY KEY,
    subject_id TEXT REFERENCES subjects(subject_id) ON DELETE SET NULL,
    author_id UUID NOT NULL REFERENCES observers(observer_id) ON DELETE CASCADE,
    author_handle TEXT NOT NULL,
    channel TEXT NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) <= 120),
    body TEXT NOT NULL CHECK (char_length(body) <= 4000),
    hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
    ra DOUBLE PRECISION NOT NULL,
    dec DOUBLE PRECISION NOT NULL,
    fov_arcsec DOUBLE PRECISION NOT NULL DEFAULT 180.0,
    state_query TEXT NOT NULL,
    preview_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    upvotes INT NOT NULL DEFAULT 0,
    moderator_verified BOOLEAN NOT NULL DEFAULT FALSE,
    admin_verification_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_channel ON discussion_threads(channel);
CREATE INDEX IF NOT EXISTS idx_threads_coords ON discussion_threads(ra, dec);

-- 5. Discussion Replies
CREATE TABLE IF NOT EXISTS discussion_replies (
    reply_id BIGSERIAL PRIMARY KEY,
    thread_id BIGINT NOT NULL REFERENCES discussion_threads(thread_id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES observers(observer_id) ON DELETE CASCADE,
    author_handle TEXT NOT NULL,
    body TEXT NOT NULL CHECK (char_length(body) <= 2000),
    moderator_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replies_thread ON discussion_replies(thread_id);

-- 6. Admin Model Training Runs (Persists Training History for /admin Tabs 1, 2, 3)
CREATE TABLE IF NOT EXISTS ml_training_runs (
    run_id TEXT PRIMARY KEY,
    model_architecture TEXT NOT NULL,
    hyperparameters JSONB NOT NULL,
    epochs_completed INT NOT NULL DEFAULT 0,
    final_train_loss DOUBLE PRECISION,
    final_val_loss DOUBLE PRECISION,
    final_val_f1 DOUBLE PRECISION,
    telemetry_frames JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'running',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. SPHEREx Mission Coverage Footprints Cache (Fast Full-Sky Navigator Coverage)
CREATE TABLE IF NOT EXISTS coverage_footprints (
    obs_id TEXT PRIMARY KEY,
    collection TEXT NOT NULL DEFAULT 'spherex_qr2',
    detector TEXT NOT NULL,
    mjd DOUBLE PRECISION,
    wavelength TEXT,
    ra_center DOUBLE PRECISION NOT NULL,
    dec_center DOUBLE PRECISION NOT NULL,
    s_region TEXT NOT NULL,
    access_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coverage_spatial ON coverage_footprints (ra_center, dec_center);
CREATE INDEX IF NOT EXISTS idx_coverage_collection ON coverage_footprints (collection);

-- 8. Precomputed All-Sky HEALPix MOCs per SPHEREx Data Release (QR2 & QR3)
CREATE TABLE IF NOT EXISTS coverage_mocs (
    collection TEXT PRIMARY KEY,
    moc_order INT NOT NULL,
    moc_json JSONB NOT NULL,
    sky_fraction DOUBLE PRECISION NOT NULL,
    cell_count INT NOT NULL,
    exposure_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. User-Installed SPHEREx Sky Sections (Persisted Cutout Tensors & 102-Channel Spectra)
CREATE TABLE IF NOT EXISTS installed_sections (
    section_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    ra DOUBLE PRECISION NOT NULL,
    dec DOUBLE PRECISION NOT NULL,
    fov_arcsec DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'installing',
    epochs INT NOT NULL DEFAULT 0,
    bands INT NOT NULL DEFAULT 6,
    height INT NOT NULL DEFAULT 0,
    width INT NOT NULL DEFAULT 0,
    source_badge TEXT NOT NULL DEFAULT '[IRSA Live]',
    tensor_path TEXT,
    spectrum_json JSONB,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installed_sections_spatial ON installed_sections (ra, dec);
CREATE INDEX IF NOT EXISTS idx_installed_sections_status ON installed_sections (status, created_at DESC);
