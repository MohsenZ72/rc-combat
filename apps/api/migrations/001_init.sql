-- Core schema for RC Combat: accounts, sessions, matches, results,
-- anti-cheat flags, review queue, sanctions and replays.

CREATE TABLE players (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname         text NOT NULL CHECK (char_length(nickname) BETWEEN 3 AND 16),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  suspended_until  timestamptz,
  -- Reserved for wallet sign-in (phase 2); unique when set.
  wallet_address   text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_player_idx ON sessions (player_id);

CREATE TABLE matches (
  id           uuid PRIMARY KEY,
  server_id    text NOT NULL,
  track_id     text NOT NULL,
  seed         bigint NOT NULL,
  config_hash  text NOT NULL,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'abandoned', 'invalidated')),
  verified     boolean NOT NULL DEFAULT false,
  end_reason   text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_running_idx ON matches (server_id) WHERE status = 'running';
CREATE INDEX matches_ended_idx ON matches (ended_at DESC);

CREATE TABLE match_players (
  match_id         uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  slot             smallint NOT NULL,
  player_id        uuid REFERENCES players (id) ON DELETE SET NULL,
  nickname         text NOT NULL,
  is_bot           boolean NOT NULL DEFAULT false,
  rank             smallint,
  status           text CHECK (status IN ('finished', 'dnf', 'forfeit')),
  finish_time_ms   integer,
  laps_completed   smallint,
  progress         real,
  suspicion_score  real NOT NULL DEFAULT 0,
  suspicion_level  text NOT NULL DEFAULT 'normal',
  verified         boolean NOT NULL DEFAULT false,
  telemetry        jsonb,
  PRIMARY KEY (match_id, slot)
);
CREATE INDEX match_players_player_idx ON match_players (player_id) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX match_players_one_seat_idx ON match_players (match_id, player_id) WHERE player_id IS NOT NULL;

CREATE TABLE anticheat_flags (
  id          bigserial PRIMARY KEY,
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  slot        smallint NOT NULL,
  player_id   uuid REFERENCES players (id) ON DELETE SET NULL,
  tick        integer NOT NULL,
  kind        text NOT NULL,
  points      real NOT NULL,
  detail      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anticheat_flags_match_idx ON anticheat_flags (match_id);
CREATE INDEX anticheat_flags_player_idx ON anticheat_flags (player_id) WHERE player_id IS NOT NULL;

CREATE TABLE review_queue (
  id           bigserial PRIMARY KEY,
  match_id     uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  player_id    uuid REFERENCES players (id) ON DELETE SET NULL,
  level        text NOT NULL,
  score        real NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared', 'confirmed')),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX review_queue_open_idx ON review_queue (created_at) WHERE status = 'open';

CREATE TABLE sanctions (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('temporary_suspension', 'ban')),
  reason      text NOT NULL,
  match_id    uuid REFERENCES matches (id) ON DELETE SET NULL,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz
);
CREATE INDEX sanctions_player_idx ON sanctions (player_id);

CREATE TABLE replays (
  match_id    uuid PRIMARY KEY REFERENCES matches (id) ON DELETE CASCADE,
  format      text NOT NULL DEFAULT 'json+gzip',
  size_bytes  integer NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
