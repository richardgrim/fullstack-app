CREATE TABLE accounts (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name varchar(80) NOT NULL,
 email varchar(254) NOT NULL UNIQUE,
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'client' CHECK(role IN ('client','manager')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE bookings (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id integer NOT NULL REFERENCES accounts(id),
 service_id integer NOT NULL REFERENCES services(id),
 service_name varchar(100) NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','attended','missed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at > starts_at),
 -- Una agenda única; [) permite que una cita empiece cuando acaba otra.
 EXCLUDE USING gist (tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status <> 'cancelled')
);
CREATE INDEX bookings_account ON bookings(account_id,starts_at);
