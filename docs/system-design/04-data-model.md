# 04 · Data model (PostgreSQL)

Migrations live in `apps/api/migrations/*.sql`. The API applies them on boot under an advisory lock, and `npm run db:migrate` applies them manually.

```mermaid
erDiagram
  players ||--o{ sessions : has
  players ||--o{ match_players : plays
  players ||--o{ sanctions : receives
  matches ||--o{ match_players : seats
  matches ||--o{ anticheat_flags : records
  matches ||--o{ review_queue : may_need
  matches ||--|| replays : stores
  players {
    uuid id PK
    text nickname
    text status "active|suspended|banned"
    timestamptz suspended_until
    text wallet_address "UNIQUE, phase 2"
  }
  sessions {
    uuid id PK
    uuid player_id FK
    timestamptz expires_at
    timestamptz revoked_at
  }
  matches {
    uuid id PK
    text server_id
    bigint seed
    text config_hash
    text status "running|finished|abandoned|invalidated"
    bool verified
  }
  match_players {
    uuid match_id PK
    smallint slot PK
    uuid player_id FK "NULL for bots"
    smallint rank
    text status "finished|dnf|forfeit"
    int finish_time_ms
    real suspicion_score
    text suspicion_level
    bool verified
    jsonb telemetry
  }
  anticheat_flags {
    bigserial id PK
    uuid match_id FK
    int tick
    text kind
    real points
  }
  review_queue {
    bigserial id PK
    uuid match_id FK
    uuid player_id FK
    text level
    text status "open|cleared|confirmed"
  }
  sanctions {
    bigserial id PK
    uuid player_id FK
    text kind "temporary_suspension|ban"
    timestamptz ends_at
  }
  replays {
    uuid match_id PK
    int size_bytes
    bytea data "gzip JSON"
  }
```

## Integrity rules

* `match_players (match_id, player_id)` is unique when `player_id` is set, so one account takes one seat.
* A match is **registered at countdown** (`POST /internal/matches`) with its roster, seed and config hash. A result is accepted only if it matches all of them and the match is still `running`. Retries are idempotent (`already_recorded`).
* Writing a result is a single transaction: outcome, per-player rows, flags, replay, review queue and sanctions.
* `POST /internal/servers/:id/boot` marks every `running` match of that server `abandoned` (`server_restart`).
* Stats and the leaderboard count only `matches.status = 'finished' AND verified` and `match_players.verified`.

## Indexes

`sessions(player_id)`, `matches(server_id) WHERE status='running'`, `matches(ended_at DESC)`, `match_players(player_id)`, `anticheat_flags(match_id)` and `(player_id)`, `review_queue(created_at) WHERE status='open'`.

## Retention (recommended)

Replays are the largest table (roughly 30–120 KB gzipped per match). Keep them for 30 days for casual matches and for the dispute window plus 1 year for prize matches. Move older ones to object storage.
