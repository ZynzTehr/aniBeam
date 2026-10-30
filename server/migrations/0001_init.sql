-- The chat's tables (spec section 7). Each id comes from an identity column, so ids grow in the
-- order rows are added, and history pages by id rather than by time. Times are timestamptz.

-- A chat account: the user id from a verified sign-in and a handle, never an email (spec section 5).
create table users (
  id bigint generated always as identity primary key,
  auth_uid text not null constraint users_auth_uid_key unique,
  handle text not null,
  created_at timestamptz not null default now(),
  banned_at timestamptz
);
-- Handles are unique ignoring case: Aki and aki can't both exist. Handles will hold only A to Z,
-- a to z, 0 to 9 and _, the letters lower() folds alike in every locale.
create unique index users_handle_lower_key on users (lower(handle));

create table messages (
  id bigint generated always as identity primary key,
  room_key text not null,
  user_id bigint not null constraint messages_user_id_fkey references users (id),
  -- char_length counts code points, so 500 single emoji fit. An accented letter typed as two
  -- code points (e and a combining accent), or a joined emoji such as a family, counts as more.
  body text not null constraint messages_body_check check (char_length(body) between 1 and 500),
  spoiler boolean not null default false,
  created_at timestamptz not null default now(),
  hidden_at timestamptz
);
-- A room's history, newest first, a page at a time.
create index messages_room_key_id_idx on messages (room_key, id desc);

create table reports (
  id bigint generated always as identity primary key,
  message_id bigint not null constraint reports_message_id_fkey references messages (id),
  reporter_id bigint not null constraint reports_reporter_id_fkey references users (id),
  reason text not null
    constraint reports_reason_check check (reason in ('spoiler', 'abuse', 'spam', 'other')),
  created_at timestamptz not null default now(),
  -- One report per person per message, so three reports are three people.
  constraint reports_message_id_reporter_id_key unique (message_id, reporter_id)
);
