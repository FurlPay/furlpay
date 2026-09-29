-- ---------------------------------------------------------------------------
-- Content leads and interactions — the marketing/contact domain.
--
-- WHY THIS IS NOT IN THE REVENUE TABLES. A report download is INTEREST, not
-- income. 0018 holds what FurlPay earned; this holds who asked for something.
-- Keeping them in one table would, sooner or later, put a pipeline count into
-- a revenue report — so they are separate tables, read by separate ADMIN_ONLY
-- endpoints, and joined only deliberately if a verified attribution mechanism
-- ever exists.
--
-- ONE PERSON, MANY INTERACTIONS. The email IS the lead's primary key, so a
-- third download by the same address updates one contact instead of creating a
-- third. Each download is its own row in content_interactions, so the history
-- is preserved without duplicating the person.
--
-- CONSENT IS TWO COLUMNS, NOT ONE.
--   consent_at        — the required consent for the transaction itself.
--   marketing_consent — an explicit, separate opt-in. DEFAULT FALSE, and no
--                       code path infers it from the presence of the other.
-- consent_version and consent_ip make a historical consent auditable after the
-- wording changes, which is the whole point of recording it.
--
-- MINIMAL COLLECTION. Only fields with a stated purpose. No referrer, no user
-- agent, no fingerprint, no geolocation. consent_ip is kept because it is the
-- record OF the consent (same as the newsletter) and nothing else.
--
-- Additive: two new tables. No existing table is touched.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_leads (
  -- Normalised (trimmed, lowercased) email. The identity, so a repeat
  -- submission updates rather than duplicates.
  email                 text        PRIMARY KEY,

  first_name            text        NOT NULL,
  last_name             text        NOT NULL,
  company               text        NOT NULL,
  job_title             text        NOT NULL,
  country               text        NOT NULL,
  phone                 text        NULL,
  interests             text[]      NULL,

  -- Internal segmentation hint from a consumer-domain list. NOT a claim about
  -- the person, and never used to reject or gate anything. See
  -- lib/leads/types.ts classifyEmail for the stated limitations.
  email_type            text        NOT NULL DEFAULT 'unknown',

  -- How we first met them. Never overwritten on a later submission.
  first_source          text        NOT NULL,

  consent_at            timestamptz NOT NULL,
  consent_version       text        NOT NULL,
  consent_ip            text        NOT NULL,

  marketing_consent     boolean     NOT NULL DEFAULT false,
  marketing_consent_at  timestamptz NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_source_known CHECK (
    first_source IN ('report_download','webinar_registration')
  ),
  CONSTRAINT lead_email_type_known CHECK (
    email_type IN ('business','consumer','unknown')
  ),
  -- A marketing opt-in must carry the moment it was given. Without that
  -- timestamp the permission is unprovable, which in a dispute is the same as
  -- not having it.
  CONSTRAINT lead_marketing_consent_dated CHECK (
    marketing_consent = false OR marketing_consent_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS content_leads_created_idx
  ON content_leads (created_at DESC);
-- Segment by company for the ops view.
CREATE INDEX IF NOT EXISTS content_leads_company_idx
  ON content_leads (lower(company));
-- The marketing-permitted subset, which is the only list an email send may use.
CREATE INDEX IF NOT EXISTS content_leads_marketing_idx
  ON content_leads (marketing_consent)
  WHERE marketing_consent = true;

CREATE TABLE IF NOT EXISTS content_interactions (
  id            uuid        PRIMARY KEY,
  -- Not a FK: an interaction is a fact that happened, and it must survive a
  -- lead being erased under a deletion request. Erasure removes the person;
  -- the aggregate "a report was downloaded" is not personal data once the
  -- address is gone.
  lead_email    text        NOT NULL,
  event_type    text        NOT NULL,
  content_type  text        NOT NULL,
  -- The public slug, never an internal id.
  content_id    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT interaction_type_known CHECK (
    event_type IN ('report_download','webinar_registration')
  ),
  CONSTRAINT interaction_content_type_known CHECK (
    content_type IN ('report','webinar')
  )
);

CREATE INDEX IF NOT EXISTS content_interactions_created_idx
  ON content_interactions (created_at DESC);
CREATE INDEX IF NOT EXISTS content_interactions_lead_idx
  ON content_interactions (lead_email, created_at DESC);
-- "Top downloaded reports" / "top registered webinars".
CREATE INDEX IF NOT EXISTS content_interactions_content_idx
  ON content_interactions (content_type, content_id, created_at DESC);

-- ── Access ─────────────────────────────────────────────────────────────────
-- Deny-by-default, same posture as 0001_init.sql and 0016_rls_money_tables.sql:
-- RLS on, zero policies. Service key only; the anon key gets nothing. These
-- rows are other people's names, employers and email addresses, and there is no
-- public read path to them anywhere in the application.
ALTER TABLE content_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_interactions ENABLE ROW LEVEL SECURITY;
