-- Which tool the assistant is compelled to run on every turn.
--
-- Upgraded Onyx sets search_usage to AUTO for every custom persona, so retrieval
-- became the assistant's choice. For a question it believes it can answer from
-- general knowledge it does not search at all, and answers from the model's own
-- knowledge instead of the tenant's documents -- for a site assistant, a
-- confident answer about the wrong organisation.
--
-- Setting this makes the middleware send forced_tool_id, which is tool_choice
-- REQUIRED on the Onyx side, restoring the old always-retrieve behaviour. It is
-- a column rather than a config key because it decides which tool runs, and
-- config is free-form text that must not reach that decision.
--
-- The value is Onyx's tool.id for internal_search, which is per-deployment.

ALTER TABLE chatbot_tenant
    ADD COLUMN IF NOT EXISTS search_tool_id INTEGER;
