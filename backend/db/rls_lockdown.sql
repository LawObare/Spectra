-- Spectra Supabase Row-Level Security Lockdown (SPECIFICATION.md §10.3)
-- Browser carries ZERO Supabase keys; all traffic flows through FastAPI backend.
-- Enabling RLS with no anon policies ensures PostgREST rejects direct browser access.

ALTER TABLE heartbeat           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE observers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE discussion_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE discussion_replies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_training_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_footprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_mocs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE installed_sections  ENABLE ROW LEVEL SECURITY;
