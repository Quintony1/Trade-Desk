-- Reference only — server.js runs these same statements automatically on startup,
-- so you don't need to run this by hand. Useful if you want to inspect the schema
-- or run it manually against a different Postgres instance.

create extension if not exists pgcrypto;

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  trade_ref     text,
  symbol        text not null,
  contract_type text,
  stake         numeric,
  payout        numeric,
  profit        numeric not null,
  buy_time      timestamptz,
  sell_time     timestamptz,
  result        text generated always as (
                  case when profit > 0 then 'win'
                       when profit < 0 then 'loss'
                       else 'breakeven' end
                ) stored,
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists trades_user_id_idx on trades (user_id);
