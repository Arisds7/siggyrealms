-- =========================================================
-- Migration 0013: auth_nonces table for SIWE authentication
-- Run in Supabase SQL Editor before deploying V2 auth changes.
-- =========================================================

-- Stores one-time-use nonces issued to wallets during SIWE login.
-- Each nonce:
--   • Is linked to a specific wallet_address (case-normalized to checksum form)
--   • Expires after 10 minutes if unused
--   • Is marked used_at once the signature is verified (replay protection)
-- Expired/used rows can be pruned periodically; there is no sensitive data here.

create table if not exists auth_nonces (
  id           uuid        primary key default gen_random_uuid(),
  wallet_address text      not null,
  nonce        text        not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '10 minutes'),
  used_at      timestamptz             -- null = not yet used
);

-- Index for fast lookup during verify (wallet + nonce + used_at check)
create index if not exists idx_auth_nonces_wallet_nonce
  on auth_nonces (wallet_address, nonce);

-- Optional: auto-delete expired & used nonces older than 1 hour
-- (keeps table small; safe to skip if no cron available)
-- create index if not exists idx_auth_nonces_expires_at on auth_nonces (expires_at);
