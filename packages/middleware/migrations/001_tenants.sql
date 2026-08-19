-- Tenant records for the embeddable chatbot widget.
--
-- The columns are the fields that must not be editable as free text: which
-- assistant a tenant reaches, how much it may spend, and where it may be
-- embedded. Everything presentational lives in config, which rowToTenant spreads
-- underneath these so it can never override them.

CREATE TABLE IF NOT EXISTS chatbot_tenant (
    tenant_id       TEXT PRIMARY KEY,
    assistant_id    TEXT        NOT NULL,

    -- Required, not nullable. Every turn costs inference credits, so an uncapped
    -- public endpoint is a billing risk rather than merely a traffic one.
    daily_turn_cap  INTEGER     NOT NULL,

    -- Checked on the widget document request, and used for frame-ancestors.
    allowed_origins TEXT[]      NOT NULL DEFAULT '{}',

    -- Presentation settings in the shared config contract shape.
    config          JSONB       NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
