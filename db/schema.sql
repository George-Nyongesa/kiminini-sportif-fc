-- =====================================================================
-- Kiminini Sportif FC — PostgreSQL Schema
-- Run with: psql -U $PGUSER -d $PGDATABASE -f db/schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid() if ever needed

-- ---------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE fixture_status AS ENUM ('scheduled', 'live', 'finished', 'postponed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE home_away AS ENUM ('home', 'away');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE match_event_type AS ENUM
    ('goal', 'assist', 'yellow_card', 'red_card', 'substitution_in', 'substitution_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_type AS ENUM ('membership_due', 'event_fee', 'donation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(20) UNIQUE NOT NULL
                CHECK (name IN ('fan', 'player', 'coach', 'tm', 'treasurer', 'admin'))
);

INSERT INTO roles (name) VALUES
  ('fan'), ('player'), ('coach'), ('tm'), ('treasurer'), ('admin')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  full_name             VARCHAR(120) NOT NULL,
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         VARCHAR(255),               -- NULL for pure-OAuth accounts
  google_id             VARCHAR(255) UNIQUE,
  facebook_id           VARCHAR(255) UNIQUE,
  phone_number          VARCHAR(20),
  avatar_url            VARCHAR(500) DEFAULT '/images/default-avatar.png',
  role_id               INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_membership_active  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_auth_method CHECK (
    password_hash IS NOT NULL OR google_id IS NOT NULL OR facebook_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------------------------------------------------------------------
-- PLAYERS  (extends users for Player/Coach/TM roster profiles)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jersey_number   SMALLINT CHECK (jersey_number BETWEEN 1 AND 99),
  position        VARCHAR(30),        -- e.g. Goalkeeper, Center-Back, Winger, Head Coach
  date_of_birth   DATE,
  bio             TEXT,
  photo_url       VARCHAR(500) DEFAULT '/images/default-player.png',
  is_captain      BOOLEAN NOT NULL DEFAULT FALSE,
  is_public       BOOLEAN NOT NULL DEFAULT TRUE,   -- shown on public squad list
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);

-- ---------------------------------------------------------------------
-- FIXTURES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixtures (
  id                SERIAL PRIMARY KEY,
  opponent          VARCHAR(120) NOT NULL,
  competition       VARCHAR(120) DEFAULT 'League',
  match_date        TIMESTAMPTZ NOT NULL,
  venue             VARCHAR(150),
  home_away         home_away NOT NULL DEFAULT 'home',
  status            fixture_status NOT NULL DEFAULT 'scheduled',
  our_score         SMALLINT DEFAULT 0,
  opponent_score    SMALLINT DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixtures_match_date ON fixtures(match_date);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status);

-- ---------------------------------------------------------------------
-- MATCH EVENTS (live ticker feed)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_events (
  id            SERIAL PRIMARY KEY,
  fixture_id    INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  player_id     INTEGER REFERENCES players(id) ON DELETE SET NULL,
  event_type    match_event_type NOT NULL,
  minute        SMALLINT CHECK (minute BETWEEN 0 AND 130),
  notes         VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_events_fixture_id ON match_events(fixture_id);
CREATE INDEX IF NOT EXISTS idx_match_events_player_id ON match_events(player_id);

-- ---------------------------------------------------------------------
-- PAYMENTS (M-Pesa membership dues, event fees, donations)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount                NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  phone_number          VARCHAR(20) NOT NULL,
  payment_type          payment_type NOT NULL DEFAULT 'membership_due',
  status                payment_status NOT NULL DEFAULT 'pending',
  checkout_request_id   VARCHAR(100) UNIQUE,   -- returned by STK push initiation
  mpesa_receipt_number  VARCHAR(100),          -- returned by the callback on success
  raw_callback_payload  JSONB,                 -- full Daraja callback, for audit/debug
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_checkout_request_id ON payments(checkout_request_id);

-- ---------------------------------------------------------------------
-- POTM VOTES (supports the Fan-tier voting feature)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS potm_votes (
  id            SERIAL PRIMARY KEY,
  fixture_id    INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fixture_id, user_id)   -- one vote per fan per fixture
);

CREATE INDEX IF NOT EXISTS idx_potm_votes_fixture_id ON potm_votes(fixture_id);

-- ---------------------------------------------------------------------
-- SESSION STORE
-- connect-pg-simple can auto-create this table, but it's declared here
-- explicitly so `npm run db:init` provisions everything in one pass.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session" (
  "sid"     VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"    JSON NOT NULL,
  "expire"  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON "session" ("expire");

-- ---------------------------------------------------------------------
-- updated_at auto-touch trigger (users, fixtures, payments)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fixtures_updated_at ON fixtures;
CREATE TRIGGER trg_fixtures_updated_at BEFORE UPDATE ON fixtures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
