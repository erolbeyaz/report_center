-- Demo data for Report Center. Everything here is synthetic; IPs are from documentation ranges (RFC 5737).
CREATE DATABASE demo;
\connect demo

CREATE ROLE report_reader LOGIN PASSWORD 'demo-reader-password';
CREATE SCHEMA audit;
CREATE SCHEMA ops;

CREATE TABLE audit.access_log (
  event_time  timestamptz NOT NULL,
  username    text NOT NULL,
  application text NOT NULL,
  action      text NOT NULL,
  source_ip   text NOT NULL,
  result      text NOT NULL
);

INSERT INTO audit.access_log
SELECT now() - (random() * interval '60 days'),
       (ARRAY['alice','bob','carol','dave','erin','frank','grace','svc-batch','svc-backup'])[1 + floor(random() * 9)::int],
       (ARRAY['Payments API','Customer Portal','Admin Console','Data Warehouse','HR System'])[1 + floor(random() * 5)::int],
       (ARRAY['LOGIN','LOGIN','LOGIN','LOGOUT','PASSWORD_CHANGE','ROLE_GRANT','EXPORT'])[1 + floor(random() * 7)::int],
       (ARRAY['192.0.2.','198.51.100.','203.0.113.'])[1 + floor(random() * 3)::int] || (10 + floor(random() * 200)::int),
       CASE WHEN random() < 0.12 THEN 'FAILED' ELSE 'SUCCESS' END
FROM generate_series(1, 4000);

CREATE TABLE audit.change_log (
  changed_at  timestamptz NOT NULL,
  changed_by  text NOT NULL,
  system      text NOT NULL,
  change_type text NOT NULL,
  ticket      text NOT NULL,
  summary     text NOT NULL,
  approved_by text
);

INSERT INTO audit.change_log
SELECT now() - (random() * interval '90 days'),
       (ARRAY['alice','bob','carol','dave'])[1 + floor(random() * 4)::int],
       (ARRAY['payments-db','portal-web','k8s-prod','firewall-edge','ldap'])[1 + floor(random() * 5)::int],
       ct,
       'CHG-' || (10000 + i),
       (ARRAY['Version upgrade','Configuration update','Certificate renewal','Access rule update','Capacity increase'])[1 + floor(random() * 5)::int],
       CASE WHEN ct = 'emergency' AND random() < 0.5 THEN NULL ELSE (ARRAY['grace','heidi'])[1 + floor(random() * 2)::int] END
FROM (SELECT i, (ARRAY['standard','standard','standard','normal','emergency','rollback'])[1 + floor(random() * 6)::int] AS ct
      FROM generate_series(1, 600) AS i) AS s;

CREATE TABLE ops.backup_jobs (
  started_at   timestamptz NOT NULL,
  job          text NOT NULL,
  target       text NOT NULL,
  status       text NOT NULL,
  duration_min integer NOT NULL,
  size_gb      numeric(8, 1) NOT NULL
);

INSERT INTO ops.backup_jobs
SELECT d + time '01:00' + (random() * interval '40 minutes'), 'nightly-' || t, t,
       CASE WHEN random() < 0.06 THEN 'FAILED' WHEN random() < 0.08 THEN 'PARTIAL' ELSE 'COMPLETED' END,
       15 + floor(random() * 90)::int, round((20 + random() * 400)::numeric, 1)
FROM generate_series(date_trunc('day', now()) - interval '60 days', date_trunc('day', now()), interval '1 day') AS d,
     unnest(ARRAY['payments-db','portal-db','dwh','file-share']) AS t;

GRANT CONNECT ON DATABASE demo TO report_reader;
GRANT USAGE ON SCHEMA audit, ops TO report_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA audit, ops TO report_reader;
