CREATE TABLE services (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name varchar(100) NOT NULL,
 description varchar(400) NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 15 AND 240),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE weekly_hours (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 weekday integer NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 opens time NOT NULL,
 closes time NOT NULL,
 CHECK(closes > opens), UNIQUE(weekday,opens,closes)
);
CREATE TABLE schedule_blocks (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 CHECK(ends_at > starts_at)
);
INSERT INTO services(name,description,duration_minutes) VALUES
 ('Orientación inicial','Una conversación para definir tus necesidades y próximos pasos. Servicio ficticio.',30),
 ('Asesoría personalizada','Una sesión para trabajar una consulta en detalle. Servicio ficticio.',60),
 ('Revisión de seguimiento','Revisión de avances y recomendaciones. Servicio ficticio.',45);
INSERT INTO weekly_hours(weekday,opens,closes)
 SELECT day, '09:00'::time, '12:00'::time FROM generate_series(1,6) day;
INSERT INTO weekly_hours(weekday,opens,closes)
 SELECT day, '14:00'::time, '18:00'::time FROM generate_series(1,5) day;
