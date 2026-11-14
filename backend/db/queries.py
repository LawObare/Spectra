"""Type-safe parameterized SQL queries (SPECIFICATION.md §5.2).

All SQL operations executed via asyncpg parameterized queries ($1, $2, ...).
"""
from __future__ import annotations

# 1. Subject Queries
GET_SUBJECT_BY_ID = """
SELECT * FROM subjects WHERE subject_id = $1 LIMIT 1;
"""

GET_NEXT_ACTIVE_LEARNING_SUBJECT = """
SELECT * FROM subjects
WHERE recommended_tab = $1
  AND verification_status = 'pending'
ORDER BY (shannon_entropy * 0.6 + ai_anomaly_score * 0.4) DESC
LIMIT 1;
"""

# 2. Observer Cryptographic Session Upsert
UPSERT_OBSERVER = """
INSERT INTO observers (observer_id, key_hash, handle)
VALUES ($1, $2, $3)
ON CONFLICT (observer_id) DO UPDATE
SET key_hash = EXCLUDED.key_hash,
    handle = EXCLUDED.handle
RETURNING *;
"""

UPDATE_OBSERVER_CALIBRATION = """
UPDATE observers
SET total_classifications = total_classifications + 1,
    calibration_seen = calibration_seen + 1,
    calibration_correct = calibration_correct + $2,
    reliability_weight = $3
WHERE observer_id = $1
RETURNING *;
"""

# 3. Citizen Science Classifications
CREATE_CLASSIFICATION = """
INSERT INTO classifications (
    subject_id, observer_id, tab_workflow, primary_class,
    feature_tags, motion_telemetry, ice_aperture_telemetry,
    confidence, observer_weight_snapshot
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
) RETURNING *;
"""

UPDATE_SUBJECT_CONSENSUS = """
UPDATE subjects
SET classification_count = classification_count + 1,
    consensus_class = $2,
    consensus_score = $3,
    shannon_entropy = $4,
    verification_status = $5
WHERE subject_id = $1
RETURNING *;
"""

# 4. Community Discussion Forum (Tab 5)
CREATE_DISCUSSION_THREAD = """
INSERT INTO discussion_threads (
    subject_id, author_id, author_handle, channel, title,
    body, hashtags, ra, dec, fov_arcsec, state_query, preview_metrics
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
) RETURNING *;
"""

GET_DISCUSSION_THREADS = """
SELECT thread_id, subject_id, author_id, author_handle, channel, title,
       body, hashtags, ra, dec, fov_arcsec, state_query, preview_metrics,
       upvotes, moderator_verified, admin_verification_note, created_at
FROM discussion_threads
WHERE channel = $1 OR $1 = 'all'
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
"""

ADD_DISCUSSION_REPLY = """
INSERT INTO discussion_replies (
    thread_id, author_id, author_handle, body, moderator_verified
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;
"""

# 5. Heartbeat Keep-Alive
PING_HEARTBEAT = """
UPDATE heartbeat SET last_ping = NOW() WHERE id = 1 RETURNING last_ping;
"""

# 6. Helper query used by existing API layer (queue/next)
GET_SUBJECT = """
SELECT * FROM subjects
WHERE category = $1 AND verification_status = 'pending'
ORDER BY (shannon_entropy * 0.6 + ai_anomaly_score * 0.4) DESC
LIMIT $2;
"""

# All parameterized queries in definition order for EXPLAIN/CI validation
ALL_QUERIES = [
    GET_SUBJECT_BY_ID,
    GET_NEXT_ACTIVE_LEARNING_SUBJECT,
    UPSERT_OBSERVER,
    UPDATE_OBSERVER_CALIBRATION,
    CREATE_CLASSIFICATION,
    UPDATE_SUBJECT_CONSENSUS,
    CREATE_DISCUSSION_THREAD,
    GET_DISCUSSION_THREADS,
    ADD_DISCUSSION_REPLY,
    PING_HEARTBEAT,
    GET_SUBJECT,
]
