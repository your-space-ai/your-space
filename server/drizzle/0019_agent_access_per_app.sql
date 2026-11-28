-- Agent access per app (spec 018). Grants and app keys outlive a kit change; only removing an app
-- retires them. Replaced first, before any data changes below.
CREATE OR REPLACE FUNCTION retire_agent_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.desired = 'removed' AND OLD.desired <> 'removed' THEN
    DELETE FROM agent_grant WHERE app_id = OLD.id;
    DELETE FROM agent_credential WHERE app_id = OLD.id;
    UPDATE agent_binding SET enabled_roles='{}', credential=NULL, kit_digest='', credential_revision=revision+1, revision=revision+1
      WHERE app_id = OLD.id;
    UPDATE agent_request SET status='stale', input=NULL, revision=revision+1
      WHERE app_id=OLD.id AND status='pending';
  ELSIF NEW.kit IS DISTINCT FROM OLD.kit OR NEW.kit_source IS DISTINCT FROM OLD.kit_source
     OR NEW.commit IS DISTINCT FROM OLD.commit OR NEW.compose IS DISTINCT FROM OLD.compose
     OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.images IS DISTINCT FROM OLD.images THEN
    -- A pending request was admitted under the old app; its binding revision no longer matches.
    UPDATE agent_binding SET revision=revision+1 WHERE app_id = OLD.id;
    UPDATE agent_request SET status='stale', input=NULL, revision=revision+1
      WHERE app_id=OLD.id AND status='pending';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
ALTER TABLE "agent_grant" ADD COLUMN "credential" text;--> statement-breakpoint
ALTER TABLE "agent_grant" ADD COLUMN "asks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- A 017 grant reached the routes of its roles the owner had enabled for the app. One that reached none
-- gives no access now either.
UPDATE agent_grant g SET roles = array(SELECT r FROM unnest(g.roles) AS r WHERE r = ANY(b.enabled_roles))
  FROM agent_binding b WHERE b.app_id = g.app_id;
--> statement-breakpoint
DELETE FROM agent_grant g USING app a WHERE a.id = g.app_id AND NOT EXISTS (
  SELECT 1 FROM unnest(g.roles) AS role_id
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.kit->'agentAccess'->'roles'->role_id->'routes', '[]'::jsonb)) AS route_id
  WHERE a.kit->'agentAccess'->'routes' ? route_id);
--> statement-breakpoint
DELETE FROM agent_grant g WHERE NOT EXISTS (SELECT 1 FROM app a WHERE a.id = g.app_id);
--> statement-breakpoint
-- The credential its roles used; none when they used several, for the owner to pick.
UPDATE agent_grant g SET credential = CASE
    WHEN a.kit->'agentAccess' ? 'credential' THEN a.kit->'agentAccess'->'credential'->>'binding'
    ELSE (SELECT CASE WHEN count(DISTINCT c) = 1 THEN min(c) END FROM (
      SELECT a.kit->'agentAccess'->'routes'->(a.kit->'agentAccess'->'roles'->role_id->'routes'->>0)->>'credential' AS c
      FROM unnest(g.roles) AS role_id) AS used)
  END
  FROM app a WHERE a.id = g.app_id;
--> statement-breakpoint
-- Every route that asked, by the owner's setting, the kit's recommendation or a write's default, asks.
UPDATE agent_grant g SET asks = COALESCE((
    SELECT jsonb_agg(DISTINCT jsonb_build_object('method', rt->>'method', 'path', regexp_replace(rt->>'path', '\{[^}/]*\}', '*', 'g')))
    FROM unnest(g.roles) AS role_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.kit->'agentAccess'->'roles'->role_id->'routes', '[]'::jsonb)) AS route_id
    CROSS JOIN LATERAL (SELECT a.kit->'agentAccess'->'routes'->route_id AS rt) AS declared
    WHERE rt IS NOT NULL AND (rt->>'effect' IS NULL OR rt->>'effect' = 'read')
      AND COALESCE(g.overrides->>route_id, rt->>'approval', CASE WHEN rt->>'method' = 'GET' THEN 'allow' ELSE 'ask' END) = 'ask'
  ), '[]'::jsonb)
  FROM app a WHERE a.id = g.app_id;
--> statement-breakpoint
-- A request pending under 017 names a route ID; it can't be approved as a call.
UPDATE agent_request SET status='stale', input=NULL, revision=revision+1 WHERE status='pending';
