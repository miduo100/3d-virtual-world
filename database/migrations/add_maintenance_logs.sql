-- 后台维护脚本执行日志表
-- 背景：src/routes/adminMaintenance.js 直接 INSERT/SELECT maintenance_logs，
--       但历史库中该表由运行时创建、迁移链里一直没有；新环境（空库首启）会缺表，
--       表现为「系统维护」页所有脚本执行 500（relation "maintenance_logs" does not exist）。
-- 幂等：可重复执行。

CREATE TABLE IF NOT EXISTS maintenance_logs (
    id integer NOT NULL,
    script_id character varying(80) NOT NULL,
    script_label character varying(200),
    category character varying(50) DEFAULT 'cleanup'::character varying,
    status character varying(20) DEFAULT 'running'::character varying NOT NULL,
    result_summary text,
    result_detail text,
    affected_rows integer DEFAULT 0,
    error_message text,
    executed_by character varying(100) DEFAULT 'admin'::character varying,
    started_at timestamp without time zone DEFAULT now(),
    finished_at timestamp without time zone
);

CREATE SEQUENCE IF NOT EXISTS maintenance_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE ONLY maintenance_logs ALTER COLUMN id SET DEFAULT nextval('maintenance_logs_id_seq'::regclass);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'maintenance_logs_pkey'
          AND conrelid = 'maintenance_logs'::regclass
    ) THEN
        ALTER TABLE ONLY maintenance_logs ADD CONSTRAINT maintenance_logs_pkey PRIMARY KEY (id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ml_script_id ON maintenance_logs USING btree (script_id);
CREATE INDEX IF NOT EXISTS idx_ml_started_at ON maintenance_logs USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_status ON maintenance_logs USING btree (status);
