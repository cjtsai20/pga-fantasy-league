-- Two Race to the FedEx Cup career slots per member: adds `slot` (1 or 2) to season_careers and makes
-- (member, slot) the key. An existing career becomes slot 1. Run once after season_careers.sql; safe to
-- re-run. (Fresh installs get this from season_careers.sql / schema.sql directly.)
alter table season_careers add column if not exists slot smallint not null default 1;
alter table season_careers drop constraint if exists season_careers_slot_check;
alter table season_careers add constraint season_careers_slot_check check (slot in (1, 2));
alter table season_careers drop constraint if exists season_careers_pkey;
alter table season_careers add constraint season_careers_pkey primary key (user_id, slot);
