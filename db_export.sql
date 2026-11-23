--
-- PostgreSQL database dump
--


-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: cleanup_old_login_attempts(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_login_attempts(days_to_keep integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM login_attempts
  WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


--
-- Name: search_models_by_tags(text[], character varying, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_models_by_tags(search_tags text[], search_category character varying DEFAULT NULL::character varying, limit_count integer DEFAULT 20) RETURNS TABLE(source character varying, model_id text, name character varying, description text, tags text[], category character varying, match_score integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.source,
    v.model_id,
    v.name,
    v.description,
    v.tags,
    v.category,
    (SELECT COUNT(*) FROM unnest(v.tags) tag WHERE tag = ANY(search_tags))::INTEGER as match_score
  FROM v_all_models v
  WHERE
    (search_category IS NULL OR v.category = search_category)
    AND v.tags && search_tags
  ORDER BY match_score DESC, v.created_at DESC
  LIMIT limit_count;
END;
$$;


--
-- Name: update_ai_scenes_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ai_scenes_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_scene_3dgs_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_scene_3dgs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


--
-- Name: update_tag_usage_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_tag_usage_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE model_tags
    SET usage_count = usage_count + 1
    WHERE name = ANY(NEW.tags);
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    UPDATE model_tags
    SET usage_count = GREATEST(0, usage_count - 1)
    WHERE name = ANY(OLD.tags);
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: update_ui_controls_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ui_controls_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_lockouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_lockouts (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    target_type character varying(20) DEFAULT 'user'::character varying NOT NULL,
    locked_by character varying(20) DEFAULT 'auto'::character varying NOT NULL,
    reason character varying(500),
    locked_at timestamp without time zone DEFAULT now() NOT NULL,
    unlock_at timestamp without time zone,
    unlocked_by character varying(100),
    unlocked_at timestamp without time zone,
    ip_address character varying(45)
);


--
-- Name: account_lockouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_lockouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_lockouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_lockouts_id_seq OWNED BY public.account_lockouts.id;


--
-- Name: ad_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    renter_name character varying(200),
    "position" jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb NOT NULL,
    rotation jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb NOT NULL,
    scale jsonb DEFAULT '{"x": 1, "y": 1, "z": 1}'::jsonb NOT NULL,
    model_url character varying(500),
    trigger_type character varying(20) DEFAULT 'link'::character varying NOT NULL,
    target_url character varying(500),
    target_world_url character varying(500),
    target_world_name character varying(200),
    rent_start timestamp without time zone,
    rent_end timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    portal_type character varying(20) DEFAULT 'link'::character varying,
    target_world_id character varying(255),
    deep_link text
);


--
-- Name: admin_action_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_action_logs (
    id integer NOT NULL,
    admin_user_id integer,
    action character varying(100) NOT NULL,
    resource character varying(100),
    resource_id character varying(100),
    details text,
    ip_address character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: admin_action_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_action_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_action_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_action_logs_id_seq OWNED BY public.admin_action_logs.id;


--
-- Name: admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_sessions (
    id integer NOT NULL,
    admin_user_id integer,
    token_hash character varying(255) NOT NULL,
    ip_address character varying(50),
    user_agent text,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: admin_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_sessions_id_seq OWNED BY public.admin_sessions.id;


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    email character varying(100),
    full_name character varying(100),
    is_active boolean DEFAULT true,
    last_login_at timestamp without time zone,
    last_login_ip character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    role character varying(20) DEFAULT 'admin'::character varying
);


--
-- Name: admin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_users_id_seq OWNED BY public.admin_users.id;


--
-- Name: agent_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    key_hash text NOT NULL,
    key_prefix character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: agent_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    world_id text,
    jti character varying(64) NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen timestamp with time zone,
    current_position jsonb,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_transient_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_transient_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jti character varying(64) NOT NULL,
    source_world_id character varying(64) NOT NULL,
    source_world_name character varying(255),
    source_world_url text,
    agent_id character varying(64) NOT NULL,
    agent_name character varying(100) NOT NULL,
    avatar_config jsonb DEFAULT '{}'::jsonb,
    home_world_url text,
    initial_position jsonb,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen timestamp with time zone,
    current_position jsonb,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    home_world_url text,
    avatar_config jsonb DEFAULT '{}'::jsonb,
    can_teleport boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    push_tier character varying(20) DEFAULT 'inherit'::character varying NOT NULL,
    CONSTRAINT agents_push_tier_check CHECK (((push_tier)::text = ANY (ARRAY[('inherit'::character varying)::text, ('eco'::character varying)::text, ('standard'::character varying)::text, ('realtime'::character varying)::text])))
);


--
-- Name: ai_call_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_call_log (
    id bigint NOT NULL,
    purpose character varying(40),
    provider_id integer,
    provider_name character varying(100),
    adapter character varying(30),
    model character varying(160),
    caller character varying(120),
    ok boolean DEFAULT true NOT NULL,
    error_code character varying(60),
    error_message character varying(400),
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    attempts smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    mission_id uuid,
    region_key character varying(60),
    context_meta jsonb
);


--
-- Name: TABLE ai_call_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_call_log IS 'LLM 调用账本（只存元数据与 token 数，绝不存密钥与 prompt 全文）';


--
-- Name: COLUMN ai_call_log.purpose; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_call_log.purpose IS '调用用途，决定预算与降级策略';


--
-- Name: COLUMN ai_call_log.adapter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_call_log.adapter IS 'wire format 适配器名，决定报文结构';


--
-- Name: COLUMN ai_call_log.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_call_log.attempts IS '实际发出的请求次数（429/5xx 会 >1）';


--
-- Name: ai_call_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_call_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_call_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_call_log_id_seq OWNED BY public.ai_call_log.id;


--
-- Name: ai_generated_scenes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_generated_scenes (
    id integer NOT NULL,
    scene_name character varying(255) NOT NULL,
    description text NOT NULL,
    scene_type character varying(50),
    scene_config jsonb NOT NULL,
    layout_data jsonb NOT NULL,
    object_count integer DEFAULT 0,
    ai_provider character varying(50),
    user_id integer,
    is_public boolean DEFAULT false,
    view_count integer DEFAULT 0,
    thumbnail_url character varying(500),
    tags text[],
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ai_generated_scenes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_generated_scenes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_generated_scenes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_generated_scenes_id_seq OWNED BY public.ai_generated_scenes.id;


--
-- Name: ai_provider_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_provider_audit_log (
    id integer NOT NULL,
    provider_id integer,
    action character varying(50) NOT NULL,
    config_key character varying(200),
    old_value text,
    new_value text,
    changed_by integer,
    ip_address inet,
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ai_provider_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_provider_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_provider_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_provider_audit_log_id_seq OWNED BY public.ai_provider_audit_log.id;


--
-- Name: ai_provider_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_provider_configs (
    id integer NOT NULL,
    provider_id integer,
    config_key character varying(200) NOT NULL,
    config_value text,
    is_sensitive boolean DEFAULT false,
    display_order integer DEFAULT 0,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ai_provider_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_provider_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_provider_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_provider_configs_id_seq OWNED BY public.ai_provider_configs.id;


--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_providers (
    id integer NOT NULL,
    provider_name character varying(100) NOT NULL,
    display_name character varying(200) NOT NULL,
    provider_type character varying(50) NOT NULL,
    is_enabled boolean DEFAULT false,
    is_default boolean DEFAULT false,
    config_schema jsonb,
    icon_url text,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ai_providers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_providers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_providers_id_seq OWNED BY public.ai_providers.id;


--
-- Name: ai_scene_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_scene_favorites (
    id integer NOT NULL,
    scene_id integer,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ai_scene_favorites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_scene_favorites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_scene_favorites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_scene_favorites_id_seq OWNED BY public.ai_scene_favorites.id;


--
-- Name: animation_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animation_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    anim_key character varying(50) NOT NULL,
    glb_url text NOT NULL,
    glb_hash text,
    label character varying(100),
    description text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_by_admin_id integer,
    created_by_name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    platform character varying(50),
    platform_name character varying(100),
    sound_url text,
    sound_name character varying(255)
);


--
-- Name: bone_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bone_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id character varying(100) NOT NULL,
    source_bone_name character varying(100) NOT NULL,
    target_bone_name character varying(100) NOT NULL,
    confidence_score double precision DEFAULT 1.0,
    auto_mapped boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buildings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plot_id uuid NOT NULL,
    building_name character varying(100),
    model_url character varying(255),
    "position" jsonb,
    rotation jsonb,
    scale jsonb DEFAULT '{"x": 1, "y": 1, "z": 1}'::jsonb,
    assets jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tags text[] DEFAULT '{}'::text[],
    category character varying(50) DEFAULT 'ai_generated'::character varying,
    auto_tags jsonb DEFAULT '{}'::jsonb
);


--
-- Name: character_appearance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_appearance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    face_brows character varying(255),
    face_glasses character varying(255),
    face_nose character varying(255),
    face_skin character varying(255),
    face_ears character varying(255),
    face_mouth character varying(255),
    face_beard character varying(255),
    face_jaw character varying(255),
    hair character varying(255),
    top_wear character varying(255),
    bottom_wear character varying(255),
    shoes character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: character_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    glb_url text,
    glb_hash text,
    thumbnail_url text,
    access_level character varying(20) DEFAULT 'public'::character varying,
    character_role character varying(20) DEFAULT 'player'::character varying,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by_admin_id integer,
    created_by_name character varying(100),
    anim_walk_url text,
    anim_run_url text,
    anim_jump_url text,
    anim_attack1_url text,
    anim_hit_url text,
    anim_death_url text,
    anim_attack2_url text,
    anim_attack3_url text,
    anim_idle_url text,
    anim_turn_left_url text,
    anim_turn_right_url text,
    anim_attack_stab_url text,
    anim_attack_slash_url text,
    anim_attack_swing_url text,
    anim_attack_uppercut_url text,
    anim_sheath_url text,
    anim_draw_sword_url text,
    anim_set jsonb DEFAULT '{}'::jsonb,
    weapon_id uuid,
    weapon_config jsonb DEFAULT '{}'::jsonb,
    bone_map jsonb DEFAULT '{}'::jsonb,
    anim_sounds jsonb DEFAULT '{}'::jsonb,
    weapon_sounds jsonb DEFAULT '{}'::jsonb,
    is_federated boolean DEFAULT false,
    source_world_id character varying(100),
    source_template_id character varying(100),
    resource_urls jsonb DEFAULT '{}'::jsonb,
    anim_adapt jsonb DEFAULT '{}'::jsonb,
    last_sync_time timestamp without time zone,
    fit_config jsonb DEFAULT '{}'::jsonb,
    calibration_config jsonb DEFAULT '{}'::jsonb,
    weapon_socket_config jsonb DEFAULT '{}'::jsonb,
    bone_mapping_config jsonb DEFAULT '{}'::jsonb,
    is_calibrated boolean DEFAULT false,
    calibrated_at timestamp without time zone,
    calibration_version integer DEFAULT 1,
    model_source_platform character varying(30) DEFAULT NULL::character varying,
    selected_anim_platform character varying(50) DEFAULT NULL::character varying,
    anim_mode character varying(20) DEFAULT 'custom'::character varying
);


--
-- Name: COLUMN character_templates.selected_anim_platform; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.character_templates.selected_anim_platform IS '模板选择的动作库平台: mixamo/hunyuan3d/makehuman/other/NULL';


--
-- Name: COLUMN character_templates.anim_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.character_templates.anim_mode IS '动作模式: platform(使用平台动作) 或 custom(使用自定义动作)';


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100),
    level integer DEFAULT 1,
    health integer DEFAULT 100,
    max_health integer DEFAULT 100,
    attack_power integer DEFAULT 10,
    defense integer DEFAULT 5,
    experience integer DEFAULT 0,
    "position" jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb,
    respawn_point jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_position jsonb,
    last_online timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    realname character varying(100),
    bio text
);


--
-- Name: config_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_audit_log (
    id integer NOT NULL,
    config_key character varying(255) NOT NULL,
    old_value text,
    new_value text,
    changed_by integer,
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address character varying(45)
);


--
-- Name: COLUMN config_audit_log.changed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.config_audit_log.changed_by IS '操作管理员 admin_users.id（configService 写入 userId）';


--
-- Name: config_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.config_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: config_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.config_audit_log_id_seq OWNED BY public.config_audit_log.id;


--
-- Name: custom_npcs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_npcs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    avatar_emoji character varying(10) DEFAULT '🤖'::character varying,
    description text,
    world_name character varying(100),
    tag character varying(100),
    "position" jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb,
    ai_provider character varying(50),
    ai_model character varying(200),
    ai_endpoint text,
    ai_key text,
    system_prompt text,
    shape_code text,
    shape_desc text,
    detect_range integer DEFAULT 10,
    approach_range integer DEFAULT 5,
    greeting text,
    farewell text,
    greet_trigger character varying(20) DEFAULT 'approach'::character varying,
    is_active boolean DEFAULT true,
    roam boolean DEFAULT false,
    face_player boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by character varying(100)
);


--
-- Name: equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    equipment_type character varying(50),
    equipment_name character varying(100),
    model_url character varying(255),
    glow boolean DEFAULT false,
    stats jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: federation_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.federation_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    source_world_id character varying(100) NOT NULL,
    source_template_id character varying(100) NOT NULL,
    local_template_id character varying(100) NOT NULL,
    template_data jsonb,
    resource_urls jsonb DEFAULT '{}'::jsonb,
    bone_map jsonb DEFAULT '{}'::jsonb,
    anim_adapt jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    category character varying(50)
);


--
-- Name: gallery_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gallery_configs (
    id integer NOT NULL,
    name character varying(255) DEFAULT '默认配置'::character varying,
    start_x double precision DEFAULT 193,
    start_y double precision DEFAULT 1,
    start_z double precision DEFAULT 918,
    matrix_width double precision DEFAULT 20,
    buffer_rate double precision DEFAULT 0.2,
    row_spacing double precision DEFAULT 4,
    col_spacing double precision DEFAULT 1.5,
    max_photo_width double precision DEFAULT 5,
    max_photo_height double precision DEFAULT 4,
    sort_by character varying(50) DEFAULT 'exif_date_desc'::character varying,
    folder_gap double precision DEFAULT 8,
    jitter double precision DEFAULT 0.3,
    is_active boolean DEFAULT false,
    total_photos integer DEFAULT 0,
    total_videos integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: gallery_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gallery_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gallery_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gallery_configs_id_seq OWNED BY public.gallery_configs.id;


--
-- Name: gallery_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gallery_items (
    id integer NOT NULL,
    config_id integer NOT NULL,
    folder_name character varying(255),
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_type character varying(50) NOT NULL,
    photo_date timestamp without time zone,
    pos_x double precision DEFAULT 0,
    pos_y double precision DEFAULT 1,
    pos_z double precision DEFAULT 0,
    width double precision DEFAULT 2,
    height double precision DEFAULT 1.5,
    rot_y double precision DEFAULT 0,
    sort_order integer DEFAULT 0,
    is_folder_marker boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: gallery_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gallery_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gallery_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gallery_items_id_seq OWNED BY public.gallery_items.id;


--
-- Name: game_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_config (
    id integer NOT NULL,
    config_key character varying(255) NOT NULL,
    config_value text,
    description text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: game_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_config_id_seq OWNED BY public.game_config.id;


--
-- Name: generated_buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_buildings (
    id integer NOT NULL,
    user_id integer,
    name character varying(255) NOT NULL,
    description text,
    image_path character varying(500),
    prompt text,
    task_id character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'processing'::character varying,
    model_url text,
    thumbnail_url text,
    local_path character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp without time zone,
    tags text[],
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_status CHECK (((status)::text = ANY (ARRAY[('processing'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: generated_buildings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generated_buildings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generated_buildings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generated_buildings_id_seq OWNED BY public.generated_buildings.id;


--
-- Name: geometry_buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geometry_buildings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name character varying(255) NOT NULL,
    template_id character varying(100) NOT NULL,
    geometry_data jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tags text[] DEFAULT '{}'::text[],
    category character varying(50) DEFAULT 'building'::character varying,
    description text,
    auto_tags jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: geometry_buildings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geometry_buildings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geometry_buildings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geometry_buildings_id_seq OWNED BY public.geometry_buildings.id;


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    ip_address character varying(45) NOT NULL,
    target_type character varying(20) DEFAULT 'user'::character varying NOT NULL,
    success boolean DEFAULT false NOT NULL,
    reason character varying(200),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: login_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_attempts_id_seq OWNED BY public.login_attempts.id;


--
-- Name: maintenance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_logs (
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


--
-- Name: maintenance_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.maintenance_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: maintenance_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.maintenance_logs_id_seq OWNED BY public.maintenance_logs.id;


--
-- Name: model_bounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_bounds (
    path text NOT NULL,
    unit_radius real NOT NULL,
    source character varying(20) DEFAULT 'runtime'::character varying,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE model_bounds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.model_bounds IS '模型文件单位尺度半径，用于未加载对象按模型边缘做距离判定';


--
-- Name: COLUMN model_bounds.unit_radius; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_bounds.unit_radius IS 'scale=1 时的水平半径（米）；实际半径 = unit_radius × scale_x';


--
-- Name: model_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_tags (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    description text,
    parent_tag_id integer,
    usage_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: model_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_tags_id_seq OWNED BY public.model_tags.id;


--
-- Name: monster_drops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monster_drops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_name character varying(100),
    rarity character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: monsters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monsters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    monster_type character varying(50),
    spawn_position jsonb NOT NULL,
    health integer DEFAULT 50,
    max_health integer DEFAULT 50,
    attack_power integer DEFAULT 8,
    reward_exp integer DEFAULT 10,
    drop_rate numeric(3,2) DEFAULT 0.3,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    geometry_type character varying(50) DEFAULT 'slime'::character varying,
    geometry_color character varying(20) DEFAULT '#44ff88'::character varying,
    defense integer DEFAULT 0,
    level integer DEFAULT 1,
    move_speed double precision DEFAULT 2.0,
    aggro_range double precision DEFAULT 10.0,
    attack_range double precision DEFAULT 1.5,
    respawn_seconds integer DEFAULT 60,
    drop_expire_seconds integer DEFAULT 120,
    drop_pool_id uuid,
    drop_max_per_user integer DEFAULT 1,
    move_range double precision DEFAULT 10.0,
    patrol_mode character varying(20) DEFAULT 'random'::character varying,
    patrol_path jsonb
);


--
-- Name: npc_chat_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.npc_chat_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    npc_id uuid NOT NULL,
    player_id character varying(100),
    player_name character varying(100),
    role character varying(10) NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: npcs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.npcs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    model_url character varying(500),
    model_type character varying(20) DEFAULT 'glb'::character varying,
    avatar_emoji character varying(10) DEFAULT '🧑'::character varying,
    "position" jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb,
    rotation jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb,
    scale double precision DEFAULT 1.0,
    ai_provider character varying(50) DEFAULT 'qwen'::character varying,
    ai_model character varying(100),
    system_prompt text,
    personality jsonb DEFAULT '{"tags": [], "farewell": "", "greeting": ""}'::jsonb,
    behavior jsonb DEFAULT '{"auto_greet": true, "patrol_points": [], "greet_cooldown": 30, "idle_animation": "idle", "patrol_enabled": false, "talk_animation": "talk", "walk_animation": "walk", "approach_player": true, "detection_radius": 8, "approach_distance": 2.5}'::jsonb,
    memory_config jsonb DEFAULT '{"context_turns": 8, "remember_players": true}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    shape_code text,
    shape_desc text
);


--
-- Name: object_transform_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_transform_overrides (
    object_id character varying(100) NOT NULL,
    position_x double precision DEFAULT 0,
    position_y double precision DEFAULT 0,
    position_z double precision DEFAULT 0,
    rotation_x double precision DEFAULT 0,
    rotation_y double precision DEFAULT 0,
    rotation_z double precision DEFAULT 0,
    scale_x double precision DEFAULT 1,
    scale_y double precision DEFAULT 1,
    scale_z double precision DEFAULT 1,
    object_name character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    shop_item_id uuid NOT NULL,
    quantity integer DEFAULT 1,
    total_price numeric(10,2),
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    payment_reference character varying(100)
);


--
-- Name: part_libraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_libraries (
    id integer NOT NULL,
    world_id character varying(100) DEFAULT 'default'::character varying NOT NULL,
    pack_key character varying(60) NOT NULL,
    display_name character varying(120) NOT NULL,
    style_family character varying(60),
    description text,
    source_type character varying(20) DEFAULT 'external_kit'::character varying NOT NULL,
    source_ref character varying(500),
    license_info jsonb,
    cover_image character varying(500),
    status character varying(20) DEFAULT 'pending_review'::character varying NOT NULL,
    reviewed_by integer,
    reviewed_at timestamp with time zone,
    priority smallint DEFAULT 100 NOT NULL,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    prev_status character varying(20),
    deleted_at timestamp with time zone,
    source_path text
);


--
-- Name: TABLE part_libraries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.part_libraries IS '零件库 = 风格基调包；每个 pack 一个子目录';


--
-- Name: COLUMN part_libraries.license_info; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_libraries.license_info IS '人工核验留痕：授权类型/作者/来源';


--
-- Name: COLUMN part_libraries.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_libraries.status IS 'pending_review（AI 隐身）| active | archived | rejected | deleted（回收站，可恢复；清空后不可恢复）';


--
-- Name: COLUMN part_libraries.prev_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_libraries.prev_status IS '软删除前的状态；恢复时回填（NULL=恢复为 active）';


--
-- Name: COLUMN part_libraries.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_libraries.deleted_at IS '进入回收站的时间；非 NULL 即在回收站内';


--
-- Name: COLUMN part_libraries.source_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_libraries.source_path IS '来源目录绝对路径（扫描通道填写）；与 pack_key 一起判定"同一个包"，避免同名不同包混库。NULL=早期数据';


--
-- Name: part_libraries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_libraries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: part_libraries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_libraries_id_seq OWNED BY public.part_libraries.id;


--
-- Name: part_library_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_library_items (
    id bigint NOT NULL,
    library_id integer NOT NULL,
    model_id integer NOT NULL,
    part_key character varying(80) NOT NULL,
    part_role character varying(40) NOT NULL,
    part_subtype character varying(60),
    grid_w real,
    grid_h real,
    grid_d real,
    collidable boolean DEFAULT true NOT NULL,
    repeat_allowed boolean DEFAULT true NOT NULL,
    stack_rule character varying(20) DEFAULT 'none'::character varying NOT NULL,
    lod_policy character varying(20) DEFAULT 'auto'::character varying NOT NULL,
    thumbnail character varying(500),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE part_library_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.part_library_items IS '零件清单：库 → 零件 → uploaded_models 记录';


--
-- Name: COLUMN part_library_items.grid_w; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_library_items.grid_w IS '模数宽度（从包围盒自动填），装配时用于网格对齐校验';


--
-- Name: COLUMN part_library_items.collidable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_library_items.collidable IS '是否阻挡玩家（wall/door=true，window/trim=false）';


--
-- Name: COLUMN part_library_items.lod_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.part_library_items.lod_policy IS 'never = 不生成 LOD 变体（面数低于门槛时自动设置）';


--
-- Name: part_library_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_library_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: part_library_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_library_items_id_seq OWNED BY public.part_library_items.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: pending_trust_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_trust_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(255) NOT NULL,
    world_name character varying(255) NOT NULL,
    world_url character varying(500) NOT NULL,
    public_key text NOT NULL,
    source_ip character varying(45),
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE pending_trust_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pending_trust_requests IS '待审批的联邦信任握手请求（当 trustRequiresApproval 开启时使用）';


--
-- Name: player_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_id uuid NOT NULL,
    acquired_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_used boolean DEFAULT false,
    used_at timestamp without time zone
);


--
-- Name: plots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    "position" jsonb NOT NULL,
    size jsonb DEFAULT '{"depth": 10, "width": 10}'::jsonb,
    buildings jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: portal_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portal_id uuid NOT NULL,
    character_id uuid NOT NULL,
    used_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: portals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    source_position jsonb NOT NULL,
    target_position jsonb NOT NULL,
    target_world_url character varying(255),
    portal_type character varying(50) DEFAULT 'local'::character varying,
    is_active boolean DEFAULT true,
    is_bidirectional boolean DEFAULT true,
    cooldown_seconds integer DEFAULT 0,
    required_level integer DEFAULT 1,
    created_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    show_in_list boolean DEFAULT true
);


--
-- Name: COLUMN portals.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.portals.created_by IS '创建者 users.id（UUID；portal.js 写入 req.userId）';


--
-- Name: resource_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id character varying(100) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_url text NOT NULL,
    resource_hash character varying(64),
    file_size integer,
    format character varying(20),
    quality_level character varying(20) DEFAULT 'high'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reward_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pool_id uuid NOT NULL,
    code character varying(500) NOT NULL,
    reward_name character varying(200) NOT NULL,
    reward_desc text,
    platform_url character varying(500),
    is_claimed boolean DEFAULT false,
    claimed_by uuid,
    claimed_at timestamp without time zone,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reward_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_pools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pool_name character varying(200) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scene_3dgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scene_3dgs (
    id integer NOT NULL,
    scene_name character varying(255) NOT NULL,
    description text,
    scene_type character varying(50) DEFAULT 'outdoor'::character varying,
    source_type character varying(50) DEFAULT 'upload'::character varying,
    rad_file_path character varying(500),
    rad_file_url character varying(500),
    file_size bigint DEFAULT 0,
    thumbnail_url character varying(500),
    splat_count integer DEFAULT 0,
    lod_levels integer DEFAULT 8,
    is_public boolean DEFAULT true,
    view_count integer DEFAULT 0,
    tags text[] DEFAULT '{}'::text[],
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scene_3dgs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scene_3dgs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scene_3dgs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scene_3dgs_id_seq OWNED BY public.scene_3dgs.id;


--
-- Name: security_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_questions (
    id integer NOT NULL,
    question_text character varying(200) NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: security_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_questions_id_seq OWNED BY public.security_questions.id;


--
-- Name: shop_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    item_name character varying(100),
    description text,
    price numeric(10,2),
    quantity integer DEFAULT 0,
    model_url character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid,
    shop_name character varying(100),
    "position" jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    skill_name character varying(100),
    trigger_text character varying(255),
    effect_type character varying(50),
    effect_duration integer,
    effect_power integer,
    range_distance integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    id integer NOT NULL,
    config_key character varying(255) NOT NULL,
    config_value text,
    description text,
    is_sensitive boolean DEFAULT false,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_config_id_seq OWNED BY public.system_config.id;


--
-- Name: teleport_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teleport_history (
    id integer NOT NULL,
    user_id uuid,
    source_world_id character varying(255),
    source_world_name character varying(255),
    target_world_id character varying(255),
    target_world_name character varying(255),
    context jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE teleport_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.teleport_history IS '用户跨世界传送历史记录';


--
-- Name: teleport_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teleport_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teleport_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teleport_history_id_seq OWNED BY public.teleport_history.id;


--
-- Name: template_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    skill_name character varying(100) NOT NULL,
    trigger_text character varying(255),
    skill_type character varying(30) DEFAULT 'attack'::character varying,
    skill_scope character varying(20) DEFAULT 'portable'::character varying,
    animation_clip character varying(100),
    effect_type character varying(50) DEFAULT 'AOE_DAMAGE'::character varying,
    effect_power integer DEFAULT 0,
    range_distance integer DEFAULT 5,
    effect_duration integer DEFAULT 1000,
    cooldown integer DEFAULT 3000,
    particle_effect character varying(100),
    icon_emoji character varying(10) DEFAULT '⚡'::character varying,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    anim_glb_url text,
    fx_preset character varying(30) DEFAULT 'none'::character varying,
    fx_color character varying(20) DEFAULT NULL::character varying,
    fx_glow double precision,
    fx_particle character varying(30) DEFAULT NULL::character varying,
    fx_duration integer DEFAULT 2000,
    fx_blade_color character varying(20) DEFAULT NULL::character varying,
    fx_glow_intensity double precision,
    fx_particle_type character varying(30) DEFAULT 'none'::character varying,
    fx_duration_legacy integer DEFAULT 2000,
    fx_sound_url text,
    fx_sound_volume double precision DEFAULT 0.8
);


--
-- Name: terrains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terrains (
    id integer NOT NULL,
    name character varying(80) NOT NULL,
    note character varying(200) DEFAULT ''::character varying NOT NULL,
    is_builtin boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    seed bigint DEFAULT 1 NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    zone_enabled boolean DEFAULT false NOT NULL,
    zone_x double precision,
    zone_z double precision,
    zone_size double precision,
    zone_priority integer DEFAULT 0 NOT NULL,
    pos_x double precision,
    pos_z double precision,
    width double precision,
    depth double precision,
    base_y double precision DEFAULT 0 NOT NULL,
    color character varying(16) DEFAULT '#2d5016'::character varying,
    grid_size integer DEFAULT 100,
    priority integer DEFAULT 0 NOT NULL
);


--
-- Name: terrains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terrains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terrains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terrains_id_seq OWNED BY public.terrains.id;


--
-- Name: threejs_code_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threejs_code_blocks (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    code text NOT NULL,
    raw_code text,
    clean_options jsonb DEFAULT '{}'::jsonb,
    tags text[] DEFAULT '{}'::text[],
    thumbnail_url character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    source_type character varying(20) DEFAULT 'paste'::character varying,
    source_url text,
    auto_fixes jsonb DEFAULT '[]'::jsonb,
    import_status character varying(20) DEFAULT 'ok'::character varying
);


--
-- Name: COLUMN threejs_code_blocks.source_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.threejs_code_blocks.source_type IS '来源类型：paste | html | js | url（入库渠道，决定是否需重新清洗）';


--
-- Name: COLUMN threejs_code_blocks.source_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.threejs_code_blocks.source_url IS '来源 URL（source_type=url/html 时的原始地址）';


--
-- Name: COLUMN threejs_code_blocks.auto_fixes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.threejs_code_blocks.auto_fixes IS '清洗器实际施加的修改列表（JSONB 数组，审计用；≠ 用户选择的 clean_options）';


--
-- Name: COLUMN threejs_code_blocks.import_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.threejs_code_blocks.import_status IS '导入状态：ok | pending | failed（清洗/预检未通过的代码块不参与世界加载）';


--
-- Name: threejs_code_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.threejs_code_blocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: threejs_code_blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.threejs_code_blocks_id_seq OWNED BY public.threejs_code_blocks.id;


--
-- Name: token_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_usage (
    nonce character varying(64) NOT NULL,
    principal_type character varying(16) NOT NULL,
    subject_id character varying(255),
    source_world_id character varying(64),
    target_world_id character varying(64),
    used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trusted_worlds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trusted_worlds (
    world_id character varying(255) NOT NULL,
    world_name character varying(255) NOT NULL,
    world_url text NOT NULL,
    public_key text NOT NULL,
    enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_central boolean DEFAULT false,
    endpoint_key character varying(500)
);


--
-- Name: TABLE trusted_worlds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trusted_worlds IS '信任的其他世界列表';


--
-- Name: ui_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ui_controls (
    id integer NOT NULL,
    control_id character varying(100) NOT NULL,
    control_name character varying(200) NOT NULL,
    control_type character varying(50) NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    position_x character varying(20) DEFAULT '0'::character varying,
    position_y character varying(20) DEFAULT '0'::character varying,
    width character varying(20) DEFAULT 'auto'::character varying,
    height character varying(20) DEFAULT 'auto'::character varying,
    position_type character varying(20) DEFAULT 'fixed'::character varying,
    mobile_position_x character varying(20),
    mobile_position_y character varying(20),
    mobile_width character varying(20),
    mobile_height character varying(20),
    style_config jsonb DEFAULT '{}'::jsonb,
    is_visible boolean DEFAULT true,
    is_enabled boolean DEFAULT true,
    z_index integer DEFAULT 1000,
    related_module character varying(100),
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    h_align character varying(10) DEFAULT 'left'::character varying,
    v_align character varying(10) DEFAULT 'top'::character varying,
    landscape_position_x character varying(20),
    landscape_position_y character varying(20),
    landscape_width character varying(20),
    landscape_height character varying(20)
);


--
-- Name: ui_controls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ui_controls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ui_controls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ui_controls_id_seq OWNED BY public.ui_controls.id;


--
-- Name: uploaded_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_models (
    id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    saved_file_name character varying(255) NOT NULL,
    path character varying(500) NOT NULL,
    file_type character varying(10) NOT NULL,
    file_size bigint NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tags text[] DEFAULT '{}'::text[],
    category character varying(50) DEFAULT 'uploaded'::character varying,
    description text,
    auto_tags jsonb DEFAULT '{}'::jsonb,
    thumbnail_path text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    display_name character varying(255),
    pack_id integer,
    part_category character varying(20) DEFAULT 'model'::character varying NOT NULL
);


--
-- Name: COLUMN uploaded_models.pack_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.uploaded_models.pack_id IS '→ part_libraries.id；NULL=普通模型';


--
-- Name: COLUMN uploaded_models.part_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.uploaded_models.part_category IS 'model=用户上传（进上传模型页） | part=零件库扫描（只进零件库页）';


--
-- Name: uploaded_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.uploaded_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: uploaded_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.uploaded_models_id_seq OWNED BY public.uploaded_models.id;


--
-- Name: user_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    months integer NOT NULL,
    amount_cents integer NOT NULL,
    payment_method character varying(30) DEFAULT 'wechat'::character varying,
    proof_image_url text,
    note text,
    started_at timestamp without time zone,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    txn_no character varying(100),
    order_no character varying(100),
    world_id character varying(100)
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    role character varying(20) DEFAULT 'user'::character varying,
    federation_user boolean DEFAULT false,
    security_question_id integer,
    security_answer character varying(255)
);


--
-- Name: v_all_models; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_all_models AS
 SELECT 'geometry'::text AS source,
    (geometry_buildings.id)::text AS model_id,
    geometry_buildings.name,
    geometry_buildings.description,
    geometry_buildings.template_id AS model_type,
    NULL::character varying AS model_path,
    geometry_buildings.tags,
    geometry_buildings.category,
    geometry_buildings.auto_tags,
    geometry_buildings.created_at,
    geometry_buildings.updated_at
   FROM public.geometry_buildings
UNION ALL
 SELECT 'uploaded'::text AS source,
    (uploaded_models.id)::text AS model_id,
    uploaded_models.file_name AS name,
    uploaded_models.description,
    uploaded_models.file_type AS model_type,
    uploaded_models.path AS model_path,
    uploaded_models.tags,
    uploaded_models.category,
    uploaded_models.auto_tags,
    uploaded_models.created_at,
    uploaded_models.updated_at
   FROM public.uploaded_models
UNION ALL
 SELECT 'ai_building'::text AS source,
    (generated_buildings.id)::text AS model_id,
    generated_buildings.name,
    COALESCE(generated_buildings.description, generated_buildings.prompt) AS description,
    'ai_generated'::character varying AS model_type,
    COALESCE(generated_buildings.model_url, (generated_buildings.local_path)::text) AS model_path,
    generated_buildings.tags,
    'ai_generated'::character varying AS category,
    '{}'::jsonb AS auto_tags,
    generated_buildings.created_at,
    generated_buildings.updated_at
   FROM public.generated_buildings
  WHERE (((generated_buildings.status)::text = 'completed'::text) AND ((generated_buildings.model_url IS NOT NULL) OR (generated_buildings.local_path IS NOT NULL)));


--
-- Name: visitor_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_sessions (
    id bigint NOT NULL,
    visitor_type character varying(10) NOT NULL,
    session_key character varying(128) NOT NULL,
    user_id uuid,
    ip character varying(64),
    ua text,
    world_id text,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone,
    duration_sec integer,
    end_reason character varying(16)
);


--
-- Name: visitor_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visitor_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visitor_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visitor_sessions_id_seq OWNED BY public.visitor_sessions.id;


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id bigint NOT NULL,
    owner_type character varying(10) NOT NULL,
    owner_id uuid NOT NULL,
    currency character varying(20) DEFAULT 'coin'::character varying NOT NULL,
    amount bigint NOT NULL,
    balance_after bigint NOT NULL,
    kind character varying(40) NOT NULL,
    idempotency_key character varying(100),
    ref_type character varying(40),
    ref_id character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_transactions_id_seq OWNED BY public.wallet_transactions.id;


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    owner_type character varying(10) DEFAULT 'user'::character varying NOT NULL,
    owner_id uuid NOT NULL,
    currency character varying(20) DEFAULT 'coin'::character varying NOT NULL,
    balance bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallets_balance_check CHECK ((balance >= 0))
);


--
-- Name: weapon_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weapon_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    weapon_id uuid NOT NULL,
    skill_name character varying(100) NOT NULL,
    effect_type character varying(30) DEFAULT 'none'::character varying,
    trigger_type character varying(30) DEFAULT 'manual'::character varying,
    duration integer DEFAULT 3000,
    sound_url text,
    sort_order integer DEFAULT 0,
    is_confirmed boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: weapons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weapons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    weapon_type character varying(30) DEFAULT 'builtin_lightsaber'::character varying,
    glb_url text,
    config jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_by_admin_id integer,
    created_by_name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    default_effect character varying(30) DEFAULT 'none'::character varying,
    icon_emoji character varying(10)
);


--
-- Name: world_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    kind character varying(40) NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    region_key character varying(60),
    created_by character varying(60) DEFAULT 'world_ai'::character varying NOT NULL,
    origin character varying(20) DEFAULT 'ai'::character varying NOT NULL,
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    schedule jsonb DEFAULT '{}'::jsonb NOT NULL,
    gameplay_def character varying(40),
    gameplay_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    win_when jsonb DEFAULT '[]'::jsonb NOT NULL,
    spawned_object_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    reward jsonb,
    participants jsonb DEFAULT '[]'::jsonb NOT NULL,
    result jsonb,
    reward_summary jsonb,
    plan_step_id uuid,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    settling_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_world_activities_status CHECK (((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('announced'::character varying)::text, ('running'::character varying)::text, ('settling'::character varying)::text, ('finished'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: world_activity_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_activity_participants (
    id bigint NOT NULL,
    activity_id uuid NOT NULL,
    actor_type character varying(10) NOT NULL,
    actor_id character varying(100) NOT NULL,
    score bigint DEFAULT 0 NOT NULL,
    reward_granted boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_activity_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_activity_participants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_activity_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_activity_participants_id_seq OWNED BY public.world_activity_participants.id;


--
-- Name: world_ai_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_ai_configs (
    id integer NOT NULL,
    world_id character varying(100) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    provider_id integer,
    model character varying(150),
    system_prompt text,
    temperature real DEFAULT 0.4 NOT NULL,
    max_tokens integer DEFAULT 4000 NOT NULL,
    allowed_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    allowed_regions uuid[],
    risk_policy jsonb DEFAULT '{"low": "auto", "high": "approve", "medium": "auto"}'::jsonb NOT NULL,
    autonomy character varying(20) DEFAULT 'managed'::character varying NOT NULL,
    provider_map jsonb DEFAULT '{}'::jsonb NOT NULL,
    context_window_tokens integer,
    budget jsonb DEFAULT '{"toolsPerDay": 200, "toolsPerRun": 12, "tokensPerDay": 2000000, "llmCallsPerDay": 60, "newObjectsPerRun": 20, "wallClockSecPerRun": 180}'::jsonb NOT NULL,
    schedule jsonb DEFAULT '{"planHours": 6, "observeMin": 10, "optimizeHours": 24}'::jsonb NOT NULL,
    runtime_state character varying(20) DEFAULT 'stopped'::character varying NOT NULL,
    last_heartbeat_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: world_ai_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_ai_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_ai_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_ai_configs_id_seq OWNED BY public.world_ai_configs.id;


--
-- Name: world_ai_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_ai_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    name character varying(120) NOT NULL,
    key_hash character varying(255) NOT NULL,
    key_prefix character varying(40) NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    usage_count integer DEFAULT 0 NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    created_by character varying(120)
);


--
-- Name: world_ai_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_ai_experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    region_key character varying(60),
    rule character varying(10) NOT NULL,
    hypothesis text NOT NULL,
    metric_key character varying(40) DEFAULT 'visits'::character varying NOT NULL,
    status character varying(20) DEFAULT 'experimenting'::character varying NOT NULL,
    baseline_value numeric,
    experiment_value numeric,
    delta_pct numeric,
    sample_n integer DEFAULT 0 NOT NULL,
    change_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    baseline_days integer DEFAULT 7 NOT NULL,
    experiment_days integer DEFAULT 3 NOT NULL,
    cooldown_until timestamp with time zone NOT NULL,
    verdict_note text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    region_id uuid,
    CONSTRAINT ck_world_ai_exp_status CHECK (((status)::text = ANY (ARRAY[('experimenting'::character varying)::text, ('solidified'::character varying)::text, ('rolled_back'::character varying)::text, ('inconclusive'::character varying)::text])))
);


--
-- Name: world_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id uuid NOT NULL,
    risk_tier character varying(10) NOT NULL,
    payload jsonb,
    decision character varying(20),
    decided_by integer,
    decided_at timestamp with time zone,
    comment text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_build_missions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_build_missions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    region_key character varying(60) NOT NULL,
    title character varying(120) NOT NULL,
    prompt text NOT NULL,
    constraints jsonb DEFAULT '{}'::jsonb NOT NULL,
    budget jsonb DEFAULT '{}'::jsonb NOT NULL,
    autonomy_snapshot character varying(20) DEFAULT 'managed'::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    executed_stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_id integer,
    provider_resolution jsonb DEFAULT '{}'::jsonb NOT NULL,
    origin character varying(20) DEFAULT 'ai'::character varying NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT ck_world_build_missions_autonomy CHECK (((autonomy_snapshot)::text = ANY (ARRAY[('managed'::character varying)::text, ('semi_autonomous'::character varying)::text, ('autonomous'::character varying)::text]))),
    CONSTRAINT ck_world_build_missions_placement_policy CHECK ((COALESCE((constraints ->> 'placement_policy'::text), 'avoid'::text) = 'avoid'::text)),
    CONSTRAINT ck_world_build_missions_status CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('queued'::character varying)::text, ('running'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('rolled_back'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: world_chat_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_chat_log (
    id bigint NOT NULL,
    sender_type character varying(10) NOT NULL,
    sender_id character varying(80),
    sender_name character varying(100) NOT NULL,
    message text NOT NULL,
    "position" jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_chat_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_chat_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_chat_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_chat_log_id_seq OWNED BY public.world_chat_log.id;


--
-- Name: world_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_config (
    key character varying(255) NOT NULL,
    value text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE world_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.world_config IS '世界配置表，存储当前世界的联邦配置';


--
-- Name: world_drops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_drops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code_id uuid NOT NULL,
    monster_id uuid,
    "position" jsonb DEFAULT '{"x": 0, "y": 0, "z": 0}'::jsonb NOT NULL,
    dropped_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone NOT NULL,
    is_picked boolean DEFAULT false,
    picked_by uuid,
    picked_at timestamp without time zone
);


--
-- Name: world_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    entity_type character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    purpose character varying(40),
    region_key character varying(60),
    visual jsonb NOT NULL,
    physical jsonb NOT NULL,
    npc_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    gameplay jsonb DEFAULT '{}'::jsonb NOT NULL,
    origin character varying(20) DEFAULT 'ai'::character varying NOT NULL,
    created_by character varying(64),
    spec jsonb,
    spec_hash text,
    state jsonb DEFAULT '{"phase": "building", "active": true}'::jsonb NOT NULL,
    entity_state jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_entity_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_entity_parts (
    id bigint NOT NULL,
    entity_id uuid NOT NULL,
    world_object_id integer,
    part_key character varying(60) NOT NULL,
    part_role character varying(40) NOT NULL,
    asset_ref jsonb,
    local_transform jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_entity_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_entity_parts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_entity_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_entity_parts_id_seq OWNED BY public.world_entity_parts.id;


--
-- Name: world_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_events (
    id bigint NOT NULL,
    seq bigint DEFAULT nextval('public.world_events_seq_seq'::regclass) NOT NULL,
    world_id character varying(100) NOT NULL,
    type character varying(40) NOT NULL,
    actor_type character varying(10),
    actor_id character varying(100),
    region_id uuid,
    entity_id uuid,
    world_object_id integer,
    target_id character varying(100),
    x real,
    y real,
    z real,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_events_id_seq OWNED BY public.world_events.id;


--
-- Name: world_gen3d_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_gen3d_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    provider character varying(40) DEFAULT 'tripo'::character varying NOT NULL,
    provider_task_id character varying(200),
    idempotency_key character varying(200),
    prompt text,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    created_by character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    title character varying(200) NOT NULL,
    vision text,
    hard_rules text[] DEFAULT '{}'::text[] NOT NULL,
    soft_prefs text[] DEFAULT '{}'::text[] NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    source character varying(20) DEFAULT 'human'::character varying NOT NULL,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    entity_id uuid,
    world_object_id integer,
    region_key character varying(60),
    interaction_type character varying(30) NOT NULL,
    key character varying(60) NOT NULL,
    label character varying(120),
    "position" jsonb,
    radius real DEFAULT 3.0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    grants jsonb,
    once_per_day boolean DEFAULT false NOT NULL,
    daily_count integer DEFAULT 0 NOT NULL,
    daily_reset_on date,
    origin character varying(20) DEFAULT 'ai'::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_memories (
    id bigint NOT NULL,
    world_id character varying(100) NOT NULL,
    scope character varying(20) NOT NULL,
    subject_id character varying(128),
    kind character varying(20) NOT NULL,
    content text NOT NULL,
    importance smallint DEFAULT 3 NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    source character varying(20) DEFAULT 'operator'::character varying NOT NULL,
    plan_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_memories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_memories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_memories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_memories_id_seq OWNED BY public.world_memories.id;


--
-- Name: world_metrics_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_metrics_daily (
    day date NOT NULL,
    world_id character varying(100) NOT NULL,
    region_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    metric_key character varying(40) NOT NULL,
    metric_value numeric DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_missions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_missions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    statement text NOT NULL,
    north_star jsonb DEFAULT '{}'::jsonb NOT NULL,
    phases jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_phase smallint DEFAULT 1 NOT NULL,
    weekly_plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_report jsonb,
    monthly_budget jsonb DEFAULT '{}'::jsonb NOT NULL,
    pending_statement text,
    review_options jsonb,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    paused_reason text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_object_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_object_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100),
    name character varying(120) NOT NULL,
    color character varying(16),
    collapsed boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_objects (
    id integer NOT NULL,
    type character varying(50) NOT NULL,
    name character varying(255),
    model_path character varying(500),
    position_x double precision DEFAULT 0,
    position_y double precision DEFAULT 0,
    position_z double precision DEFAULT 0,
    rotation_x double precision DEFAULT 0,
    rotation_y double precision DEFAULT 0,
    rotation_z double precision DEFAULT 0,
    scale_x double precision DEFAULT 1,
    scale_y double precision DEFAULT 1,
    scale_z double precision DEFAULT 1,
    building_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    model_type character varying(50),
    threejs_code text,
    world_id integer DEFAULT 1,
    video_props jsonb DEFAULT '{"loop": false, "muted": true, "autoplay": false}'::jsonb,
    has_collision boolean DEFAULT false,
    custom_config jsonb,
    is_locked boolean DEFAULT false,
    agent_description text,
    origin character varying(20) DEFAULT 'human'::character varying,
    created_by character varying(64),
    entity_id uuid,
    region_id character varying(60),
    visible boolean DEFAULT true,
    cast_shadow boolean DEFAULT true,
    receive_shadow boolean DEFAULT true,
    group_id uuid
);


--
-- Name: COLUMN world_objects.has_collision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.world_objects.has_collision IS '是否启用碰撞检测，默认关闭';


--
-- Name: COLUMN world_objects.custom_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.world_objects.custom_config IS '对象自定义配置(JSONB)，可包含粒子、动画、材质等参数';


--
-- Name: world_objects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_objects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_objects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_objects_id_seq OWNED BY public.world_objects.id;


--
-- Name: world_plan_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_plan_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    phase_no integer DEFAULT 1 NOT NULL,
    seq integer NOT NULL,
    tool_name character varying(60) NOT NULL,
    params jsonb NOT NULL,
    rationale text,
    expected_effect jsonb,
    verify_tool character varying(60),
    verify_params jsonb,
    risk_tier character varying(10) DEFAULT 'low'::character varying NOT NULL,
    human_risk_locked boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    execution_id bigint,
    result jsonb,
    error text,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    goal_id uuid,
    version integer DEFAULT 1 NOT NULL,
    title character varying(200) NOT NULL,
    summary text,
    overview text,
    phases jsonb DEFAULT '[]'::jsonb NOT NULL,
    risks jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    reviewed_by integer,
    reviewed_at timestamp with time zone,
    approved_by integer,
    approved_at timestamp with time zone,
    rejected_reason text,
    progress jsonb DEFAULT '{"doneSteps": 0, "totalSteps": 0, "failedSteps": 0, "currentStepId": null}'::jsonb NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    generated_by_plan_id uuid,
    llm_call_id bigint,
    prompt_digest text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_regions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    region_key character varying(60) NOT NULL,
    world_id character varying(100) NOT NULL,
    name character varying(120) NOT NULL,
    purpose character varying(40),
    bounds jsonb NOT NULL,
    autonomy character varying(20) NOT NULL,
    gridsnap jsonb DEFAULT '{}'::jsonb NOT NULL,
    constraints jsonb DEFAULT '{}'::jsonb NOT NULL,
    gameplay jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    last_active_at timestamp with time zone,
    preferred_provider_id integer,
    origin character varying(20) DEFAULT 'ai'::character varying NOT NULL,
    created_by character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_world_regions_autonomy CHECK (((autonomy)::text = ANY (ARRAY[('managed'::character varying)::text, ('semi_autonomous'::character varying)::text, ('autonomous'::character varying)::text]))),
    CONSTRAINT ck_world_regions_bounds_kind CHECK (((bounds ->> 'kind'::text) = 'rect'::text))
);


--
-- Name: world_reward_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_reward_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    actor_type character varying(10) NOT NULL,
    actor_id character varying(100) NOT NULL,
    interaction_id uuid,
    interaction_key character varying(60),
    region_key character varying(60),
    code_id uuid,
    code character varying(120),
    count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pvp_enabled boolean DEFAULT false,
    pve_enabled boolean DEFAULT true,
    allow_foreign_attack boolean DEFAULT false,
    damage_multiplier double precision DEFAULT 1.0,
    allow_skill_types text[] DEFAULT ARRAY['perform'::text, 'build'::text],
    max_foreign_level integer DEFAULT 999,
    respawn_enabled boolean DEFAULT true,
    friendly_fire boolean DEFAULT false,
    world_type character varying(30) DEFAULT 'normal'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: world_sfx_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_sfx_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    provider character varying(60) DEFAULT 'doubao_seed_audio'::character varying NOT NULL,
    model character varying(80),
    prompt text NOT NULL,
    prompt_en text,
    duration_sec numeric(6,2),
    sample_rate integer DEFAULT 44100 NOT NULL,
    format character varying(16) DEFAULT 'mp3'::character varying NOT NULL,
    preview_path text,
    preview_url text,
    size_bytes integer,
    actual_duration numeric(8,2),
    imported boolean DEFAULT false NOT NULL,
    asset_url text,
    asset_name text,
    asset_size integer,
    compress_ratio numeric(6,2),
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    error_hint text,
    attempts integer DEFAULT 0 NOT NULL,
    latency_ms integer,
    created_by character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_sky_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_sky_presets (
    id integer NOT NULL,
    name character varying(60) NOT NULL,
    kind character varying(16) DEFAULT 'image'::character varying NOT NULL,
    url character varying(255) NOT NULL,
    width integer,
    height integer,
    use_env boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: world_sky_presets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_sky_presets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_sky_presets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_sky_presets_id_seq OWNED BY public.world_sky_presets.id;


--
-- Name: world_task_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_task_progress (
    id bigint NOT NULL,
    task_id uuid NOT NULL,
    actor_type character varying(10) NOT NULL,
    actor_id character varying(100) NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    reward_granted boolean DEFAULT false NOT NULL,
    claimed_at timestamp with time zone,
    completed_at timestamp with time zone,
    objective_index integer DEFAULT 0 NOT NULL,
    last_seq bigint DEFAULT 0 NOT NULL
);


--
-- Name: world_task_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_task_progress_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_task_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_task_progress_id_seq OWNED BY public.world_task_progress.id;


--
-- Name: world_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_id character varying(100) NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    type character varying(30) DEFAULT 'side'::character varying NOT NULL,
    objectives jsonb DEFAULT '[]'::jsonb NOT NULL,
    region_key character varying(60),
    region_ref uuid,
    entity_id uuid,
    giver jsonb,
    status character varying(20) DEFAULT 'published'::character varying NOT NULL,
    visibility character varying(20) DEFAULT 'agent_only'::character varying NOT NULL,
    repeatable boolean DEFAULT false NOT NULL,
    max_completions integer,
    completion_count integer DEFAULT 0 NOT NULL,
    reward jsonb,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    origin character varying(20) DEFAULT 'ai'::character varying NOT NULL,
    plan_step_id uuid,
    world_day integer,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    giver_type character varying(20),
    giver_id character varying(100),
    source_template character varying(60),
    gameplay_def character varying(40),
    CONSTRAINT ck_world_tasks_visibility CHECK (((visibility)::text = ANY (ARRAY[('public'::character varying)::text, ('agent_only'::character varying)::text, ('human_only'::character varying)::text])))
);


--
-- Name: world_tool_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_tool_executions (
    id bigint NOT NULL,
    world_id character varying(100) NOT NULL,
    plan_id uuid,
    plan_step_id uuid,
    tool_name character varying(60) NOT NULL,
    params jsonb NOT NULL,
    risk_tier character varying(10) NOT NULL,
    status character varying(20) NOT NULL,
    before_state jsonb,
    after_state jsonb,
    undo_payload jsonb,
    undoable boolean DEFAULT false NOT NULL,
    approval_id uuid,
    actor character varying(64) NOT NULL,
    reason text,
    error text,
    result jsonb,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: world_tool_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_tool_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_tool_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_tool_executions_id_seq OWNED BY public.world_tool_executions.id;


--
-- Name: world_weather; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_weather (
    id integer NOT NULL,
    weather_type character varying(30) DEFAULT 'sunny'::character varying NOT NULL,
    sky_mode character varying(20) DEFAULT 'day'::character varying NOT NULL,
    fog_enabled boolean DEFAULT false NOT NULL,
    fog_density double precision DEFAULT 0.01 NOT NULL,
    rain_intensity double precision DEFAULT 0.5 NOT NULL,
    snow_intensity double precision DEFAULT 0.5 NOT NULL,
    wind_speed double precision DEFAULT 1.0 NOT NULL,
    sun_angle double precision DEFAULT 45 NOT NULL,
    day_cycle_enabled boolean DEFAULT false NOT NULL,
    day_cycle_speed double precision DEFAULT 1.0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    fog_color character varying(20) DEFAULT '#cccccc'::character varying,
    intensity double precision DEFAULT 1.0,
    duration integer DEFAULT 0,
    start_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    end_time timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: world_weather_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_weather_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_weather_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_weather_id_seq OWNED BY public.world_weather.id;


--
-- Name: account_lockouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_lockouts ALTER COLUMN id SET DEFAULT nextval('public.account_lockouts_id_seq'::regclass);


--
-- Name: admin_action_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs ALTER COLUMN id SET DEFAULT nextval('public.admin_action_logs_id_seq'::regclass);


--
-- Name: admin_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions ALTER COLUMN id SET DEFAULT nextval('public.admin_sessions_id_seq'::regclass);


--
-- Name: admin_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_id_seq'::regclass);


--
-- Name: ai_call_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_log ALTER COLUMN id SET DEFAULT nextval('public.ai_call_log_id_seq'::regclass);


--
-- Name: ai_generated_scenes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generated_scenes ALTER COLUMN id SET DEFAULT nextval('public.ai_generated_scenes_id_seq'::regclass);


--
-- Name: ai_provider_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_audit_log ALTER COLUMN id SET DEFAULT nextval('public.ai_provider_audit_log_id_seq'::regclass);


--
-- Name: ai_provider_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs ALTER COLUMN id SET DEFAULT nextval('public.ai_provider_configs_id_seq'::regclass);


--
-- Name: ai_providers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers ALTER COLUMN id SET DEFAULT nextval('public.ai_providers_id_seq'::regclass);


--
-- Name: ai_scene_favorites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scene_favorites ALTER COLUMN id SET DEFAULT nextval('public.ai_scene_favorites_id_seq'::regclass);


--
-- Name: config_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_audit_log ALTER COLUMN id SET DEFAULT nextval('public.config_audit_log_id_seq'::regclass);


--
-- Name: gallery_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_configs ALTER COLUMN id SET DEFAULT nextval('public.gallery_configs_id_seq'::regclass);


--
-- Name: gallery_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_items ALTER COLUMN id SET DEFAULT nextval('public.gallery_items_id_seq'::regclass);


--
-- Name: game_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_config ALTER COLUMN id SET DEFAULT nextval('public.game_config_id_seq'::regclass);


--
-- Name: generated_buildings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_buildings ALTER COLUMN id SET DEFAULT nextval('public.generated_buildings_id_seq'::regclass);


--
-- Name: geometry_buildings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geometry_buildings ALTER COLUMN id SET DEFAULT nextval('public.geometry_buildings_id_seq'::regclass);


--
-- Name: login_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts ALTER COLUMN id SET DEFAULT nextval('public.login_attempts_id_seq'::regclass);


--
-- Name: maintenance_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs ALTER COLUMN id SET DEFAULT nextval('public.maintenance_logs_id_seq'::regclass);


--
-- Name: model_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags ALTER COLUMN id SET DEFAULT nextval('public.model_tags_id_seq'::regclass);


--
-- Name: part_libraries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_libraries ALTER COLUMN id SET DEFAULT nextval('public.part_libraries_id_seq'::regclass);


--
-- Name: part_library_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_library_items ALTER COLUMN id SET DEFAULT nextval('public.part_library_items_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: scene_3dgs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_3dgs ALTER COLUMN id SET DEFAULT nextval('public.scene_3dgs_id_seq'::regclass);


--
-- Name: security_questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_questions ALTER COLUMN id SET DEFAULT nextval('public.security_questions_id_seq'::regclass);


--
-- Name: system_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config ALTER COLUMN id SET DEFAULT nextval('public.system_config_id_seq'::regclass);


--
-- Name: teleport_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teleport_history ALTER COLUMN id SET DEFAULT nextval('public.teleport_history_id_seq'::regclass);


--
-- Name: terrains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terrains ALTER COLUMN id SET DEFAULT nextval('public.terrains_id_seq'::regclass);


--
-- Name: threejs_code_blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threejs_code_blocks ALTER COLUMN id SET DEFAULT nextval('public.threejs_code_blocks_id_seq'::regclass);


--
-- Name: ui_controls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_controls ALTER COLUMN id SET DEFAULT nextval('public.ui_controls_id_seq'::regclass);


--
-- Name: uploaded_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_models ALTER COLUMN id SET DEFAULT nextval('public.uploaded_models_id_seq'::regclass);


--
-- Name: visitor_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_sessions ALTER COLUMN id SET DEFAULT nextval('public.visitor_sessions_id_seq'::regclass);


--
-- Name: wallet_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions ALTER COLUMN id SET DEFAULT nextval('public.wallet_transactions_id_seq'::regclass);


--
-- Name: world_activity_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_activity_participants ALTER COLUMN id SET DEFAULT nextval('public.world_activity_participants_id_seq'::regclass);


--
-- Name: world_ai_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_ai_configs ALTER COLUMN id SET DEFAULT nextval('public.world_ai_configs_id_seq'::regclass);


--
-- Name: world_chat_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_chat_log ALTER COLUMN id SET DEFAULT nextval('public.world_chat_log_id_seq'::regclass);


--
-- Name: world_entity_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entity_parts ALTER COLUMN id SET DEFAULT nextval('public.world_entity_parts_id_seq'::regclass);


--
-- Name: world_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_events ALTER COLUMN id SET DEFAULT nextval('public.world_events_id_seq'::regclass);


--
-- Name: world_memories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_memories ALTER COLUMN id SET DEFAULT nextval('public.world_memories_id_seq'::regclass);


--
-- Name: world_objects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects ALTER COLUMN id SET DEFAULT nextval('public.world_objects_id_seq'::regclass);


--
-- Name: world_sky_presets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_sky_presets ALTER COLUMN id SET DEFAULT nextval('public.world_sky_presets_id_seq'::regclass);


--
-- Name: world_task_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_task_progress ALTER COLUMN id SET DEFAULT nextval('public.world_task_progress_id_seq'::regclass);


--
-- Name: world_tool_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_tool_executions ALTER COLUMN id SET DEFAULT nextval('public.world_tool_executions_id_seq'::regclass);


--
-- Name: world_weather id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_weather ALTER COLUMN id SET DEFAULT nextval('public.world_weather_id_seq'::regclass);


--
-- Data for Name: account_lockouts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.account_lockouts (id, username, target_type, locked_by, reason, locked_at, unlock_at, unlocked_by, unlocked_at, ip_address) FROM stdin;
\.


--
-- Data for Name: ad_slots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ad_slots (id, name, renter_name, "position", rotation, scale, model_url, trigger_type, target_url, target_world_url, target_world_name, rent_start, rent_end, is_active, created_at, updated_at, portal_type, target_world_id, deep_link) FROM stdin;
\.


--
-- Data for Name: admin_action_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_action_logs (id, admin_user_id, action, resource, resource_id, details, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: admin_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_sessions (id, admin_user_id, token_hash, ip_address, user_agent, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: admin_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_users (id, username, password_hash, email, full_name, is_active, last_login_at, last_login_ip, created_at, updated_at, role) FROM stdin;
1	admin	$2b$10$RdJQhiy42PGvDNQI90/Fi.aOmm8tr7M6zrczyeAhIM8gWHff1WAxi	admin@virtualworld.com	系统管理员	t	2026-11-19 14:39:38.718564	::1	2026-02-11 09:13:34.359303	2026-07-23 15:10:16.884151	admin
\.


--
-- Data for Name: agent_api_keys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agent_api_keys (id, agent_id, key_hash, key_prefix, status, expires_at, created_at, revoked_at) FROM stdin;
\.


--
-- Data for Name: agent_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agent_sessions (id, agent_id, world_id, jti, issued_at, expires_at, last_seen, current_position, status, revoked_at, created_at) FROM stdin;
\.


--
-- Data for Name: agent_transient_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agent_transient_sessions (id, jti, source_world_id, source_world_name, source_world_url, agent_id, agent_name, avatar_config, home_world_url, initial_position, issued_at, expires_at, last_seen, current_position, status, revoked_at, created_at) FROM stdin;
\.


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agents (id, name, description, status, home_world_url, avatar_config, can_teleport, created_at, updated_at, push_tier) FROM stdin;
\.


--
-- Data for Name: ai_call_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_call_log (id, purpose, provider_id, provider_name, adapter, model, caller, ok, error_code, error_message, input_tokens, output_tokens, total_tokens, latency_ms, attempts, created_at, mission_id, region_key, context_meta) FROM stdin;
\.


--
-- Data for Name: ai_generated_scenes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_generated_scenes (id, scene_name, description, scene_type, scene_config, layout_data, object_count, ai_provider, user_id, is_public, view_count, thumbnail_url, tags, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: ai_provider_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_provider_audit_log (id, provider_id, action, config_key, old_value, new_value, changed_by, ip_address, changed_at) FROM stdin;
\.


--
-- Data for Name: ai_provider_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_provider_configs (id, provider_id, config_key, config_value, is_sensitive, display_order, updated_by, updated_at) FROM stdin;
\.


--
-- Data for Name: ai_providers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_providers (id, provider_name, display_name, provider_type, is_enabled, is_default, config_schema, icon_url, description, created_at, updated_at) FROM stdin;
6	openai_chatgpt	OpenAI ChatGPT	chat	f	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "sk-开头的OpenAI API密钥"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://api.openai.com/v1", "required": false, "sensitive": false, "placeholder": "https://api.openai.com/v1 或代理地址"}, {"key": "model", "type": "select", "label": "模型", "default": "gpt-3.5-turbo", "options": ["gpt-4", "gpt-4-turbo-preview", "gpt-3.5-turbo", "gpt-3.5-turbo-16k"], "required": true, "sensitive": false, "description": "选择要使用的GPT模型"}, {"key": "temperature", "max": "2", "min": "0", "step": "0.1", "type": "number", "label": "创造性", "default": "0.7", "required": false, "sensitive": false, "description": "控制回答的随机性，0-2之间，数值越高越有创造性"}, {"key": "max_tokens", "max": "4096", "min": "1", "type": "number", "label": "最大令牌数", "default": "2000", "required": false, "sensitive": false, "description": "单次回复的最大长度"}], "features": ["chat", "scene_generation"]}	https://openai.com/favicon.ico	OpenAI ChatGPT大模型，支持AI对话、场景生成等功能。支持GPT-4和GPT-3.5系列模型。	2026-02-13 11:18:15.558016	2026-02-13 11:18:15.558016
4	tencent_hunyuan3d	腾讯混元3D	image_to_3d,text_to_3d	f	f	{"fields": [{"key": "secret_id", "type": "text", "label": "Secret ID", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"}, {"key": "secret_key", "type": "password", "label": "Secret Key", "required": true, "sensitive": true, "placeholder": "32位字符串"}, {"key": "region", "type": "select", "label": "地域", "default": "ap-guangzhou", "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "required": true, "sensitive": false}]}	\N	腾讯混元3D，支持图片转3D模型、文字生成3D等	2026-02-13 08:58:53.642456	2026-07-10 17:58:30.20516
5	tripo	Tripo AI	image_to_3d,text_to_3d	t	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "description": "Tripo AI的API密钥，可在 https://platform.tripo3d.ai 获取", "placeholder": "tsk-开头的API密钥"}, {"key": "mode", "type": "select", "label": "生成模式", "default": "preview", "options": ["preview", "refine"], "required": false, "sensitive": false, "description": "preview(快速预览) 或 refine(精细化)"}, {"key": "model_version", "type": "text", "label": "模型版本", "default": "v2.0-20240919", "required": false, "sensitive": false, "description": "API模型版本号"}], "pricing": {"refine": "精细模式约2-5分钟", "preview": "快速模式约10-30秒"}, "docs_url": "https://platform.tripo3d.ai/docs", "features": ["image_to_3d", "text_to_3d"]}	https://platform.tripo3d.ai/favicon.ico	Tripo AI - 专业的AI图片/文本转3D模型服务，支持快速预览和精细化生成	2026-02-13 10:44:09.532864	2026-10-10 11:40:26.932538
1678	tripo_ai	Tripo AI	image_to_3d,text_to_3d	f	f	{"fields": [{"key": "api_token", "type": "password", "label": "API Token", "required": true, "sensitive": true, "placeholder": "Tripo AI API Token"}]}	\N	Tripo AI，支持图片转3D模型、文字生成3D等	2026-07-09 18:31:42.545811	2026-07-09 18:31:42.545811
1	tencent_hunyuan	腾讯混元	chat	f	f	{"fields": [{"key": "secret_id", "type": "text", "label": "Secret ID", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"}, {"key": "secret_key", "type": "password", "label": "Secret Key", "required": true, "sensitive": true, "placeholder": "32位字符串"}, {"key": "region", "type": "select", "label": "地域", "default": "ap-guangzhou", "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "required": true, "sensitive": false}]}	\N	腾讯混元大模型，支持对话、图生3D等功能	2026-02-13 08:58:53.642456	2026-07-10 17:58:22.627926
2	aliyun_qianwen	阿里通义千问	chat	t	t	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "sk-开头的密钥"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://dashscope.aliyuncs.com/api/v1", "required": false, "sensitive": false, "placeholder": "https://dashscope.aliyuncs.com/api/v1"}, {"key": "model", "type": "select", "label": "模型", "default": "qwen-plus", "options": ["qwen-max", "qwen-plus", "qwen-turbo"], "required": true, "sensitive": false}]}	\N	阿里云通义千问大模型，支持对话、文本生成等	2026-02-13 08:58:53.642456	2026-10-08 16:42:27.215539
3	bytedance_doubao	字节豆包	chat	t	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "输入豆包API密钥"}, {"key": "endpoint_id", "type": "text", "label": "接入点ID", "required": true, "sensitive": false, "placeholder": "ep-开头的ID"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://ark.cn-beijing.volces.com/api/v3", "required": false, "sensitive": false, "placeholder": "https://ark.cn-beijing.volces.com/api/v3"}]}	\N	字节跳动豆包大模型，支持对话、文本生成等	2026-02-13 08:58:53.642456	2026-10-09 13:20:56.131104
4529	doubao_seed_audio	豆包音频生成	sfx	f	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key（豆包语音控制台）", "required": true, "sensitive": true, "placeholder": "从 console.volcengine.com/speech 新版控制台获取的 Key，不是方舟的 Key"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://openspeech.bytedance.com/api/v3", "required": false, "sensitive": false, "placeholder": "https://openspeech.bytedance.com/api/v3"}, {"key": "model", "type": "select", "label": "模型", "default": "seed-audio-1.0", "options": ["seed-audio-1.0"], "required": true, "sensitive": false}, {"key": "sample_rate", "type": "select", "label": "采样率", "default": "44100", "options": ["24000", "32000", "44100", "48000"], "required": false, "sensitive": false}, {"key": "format", "type": "select", "label": "输出格式", "default": "mp3", "options": ["mp3", "wav", "pcm", "ogg_opus"], "required": false, "sensitive": false}, {"key": "auth_mode", "type": "select", "label": "鉴权方式", "default": "x-api-key", "options": ["x-api-key", "bearer"], "required": false, "sensitive": false, "description": "豆包语音用 x-api-key；火山方舟用 bearer。留空则按 API 地址自动判断。"}]}	\N	豆包音频生成模型（Seed-Audio 1.0）：按提示词生成音效/环境声/声音场景。支持文本、参考音频、参考图片输入，单次最长 120 秒。需在豆包语音控制台单独开通权限。	2026-11-03 18:52:11.604567	2026-11-03 18:52:11.604567
4584	elevenlabs_sfx	ElevenLabs 音效生成	sfx	f	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "在 elevenlabs.io/app/settings/api-keys 获取"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://api.elevenlabs.io/v1", "required": false, "sensitive": false, "placeholder": "https://api.elevenlabs.io/v1"}, {"key": "api_path", "type": "text", "label": "接口路径", "default": "/sound-generation", "required": false, "sensitive": false, "placeholder": "/sound-generation"}, {"key": "auth_mode", "type": "select", "label": "鉴权方式", "default": "xi-api-key", "options": ["xi-api-key", "x-api-key", "bearer"], "required": false, "sensitive": false}, {"key": "model_id", "type": "select", "label": "模型", "default": "eleven_text_to_sound_v3", "options": ["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"], "required": false, "sensitive": false}, {"key": "output_format", "type": "select", "label": "输出格式", "default": "mp3_22050_32", "options": ["mp3_22050_32", "mp3_44100_32", "mp3_44100_64", "mp3_44100_128", "pcm_44100"], "required": false, "sensitive": false, "description": "mp3_22050_32 体积最小（3 秒约 12KB），mp3_44100_128 音质最好但体积大 4 倍"}]}	\N	ElevenLabs 音效生成模型：专注文生短音效，支持 0.5-30 秒时长控制、无缝循环开关、可指定低码率输出。音质公认第一档。注意免费档输出需署名且不可商用，商用需 Starter 及以上订阅。	2026-11-03 20:37:19.729971	2026-11-03 20:37:19.729971
\.


--
-- Data for Name: ai_scene_favorites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_scene_favorites (id, scene_id, user_id, created_at) FROM stdin;
\.


--
-- Data for Name: animation_library; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.animation_library (id, name, anim_key, glb_url, glb_hash, label, description, is_active, sort_order, created_by_admin_id, created_by_name, created_at, updated_at, platform, platform_name, sound_url, sound_name) FROM stdin;
da38dc15-9fd6-45cb-b680-36afe6e9e58a	⚔️ 挥砍	attack_slash	/uploads/anim-library/anim-1788168032972-885973649.glb	8e77917fcf97ac46393e3cb2bb562f2eeac08cf939ae189b95ce9178b6ecee91	⚔️ 挥砍	\N	t	0	\N	\N	2026-08-31 17:20:32.979466	2026-08-31 17:20:32.979466	mixamo	Mixamo	\N	\N
bf560d02-abd2-4724-ab68-e7a7bb833c43	🗡️ 刺击	attack_stab	/uploads/anim-library/anim-1788167798666-521945808.glb	a659d257ce7bc398da2d83e7168fdf21f9a8338f538b17203c06e37d402494b0	🗡️ 刺击	\N	f	0	\N	\N	2026-08-31 17:16:38.674478	2026-08-31 17:16:38.674478	mixamo	Mixamo	\N	\N
540e957a-5f2b-4e13-99df-535b39f56a77	↪️ 左转	turn_left	/uploads/anim-library/anim-1788168714856-574180717.glb	baac6cb8bad10e62629c147bc58738e218aa346dc887204301d85acb4b070903	↪️ 左转	\N	t	0	\N	\N	2026-08-31 17:31:54.868216	2026-08-31 17:31:54.868216	mixamo	Mixamo	\N	\N
b3970acb-10f5-46ff-9a7c-8f9164c79791	↩️ 右转	turn_right	/uploads/anim-library/anim-1788168727165-321057812.glb	4fcc50ff7d206c5194f3954e92c91dc85b0818d857c982d0099e97282b1c7ecb	↩️ 右转	\N	t	0	\N	\N	2026-08-31 17:32:07.172915	2026-08-31 17:32:07.172915	mixamo	Mixamo	\N	\N
8490b858-cdf8-45e3-85ca-5f86446fe294	🗡️ 刺击	attack_stab	/uploads/anim-library/anim-1788169110614-246124029.glb	46593059d6fad97b6f73160ddfccf4de9e9fb62e08e5e83202bdb36c195605cb	🗡️ 刺击	\N	t	0	\N	\N	2026-08-31 17:38:30.623439	2026-08-31 17:38:30.623439	mixamo	Mixamo	\N	\N
efab2417-dc80-4231-8251-b6dfcc52cc5b	↪️ 左转	turn_left	/uploads/anim-library/anim-1779271254599-672965757.fbx	7f4de6259429e8cab1189e4f67d707c53b16903f561a32fcd41e84971693e2b4	↪️ 左转	\N	f	0	\N	\N	2026-05-20 18:00:54.614778	2026-05-20 18:00:54.614778	mixamo	\N	\N	\N
7ca31039-d43d-403b-9c21-e02a33c2af2c	↪️ 左转	turn_left	/uploads/anim-library/anim-1779271272539-116470477.fbx	7f4de6259429e8cab1189e4f67d707c53b16903f561a32fcd41e84971693e2b4	↪️ 左转	\N	f	0	\N	\N	2026-05-20 18:01:12.545287	2026-05-20 18:01:12.545287	mixamo	\N	\N	\N
07e09a7a-2d4d-426a-b31c-d1a352ebe994	待机	idle	/uploads/anim-library/anim-1779266358942-3366866.fbx	db77eab2265c49bb97b127da51bd978ded1316986276c377d07b0beb4139046b	🧍 待机	\N	f	0	\N	\N	2026-05-20 16:39:18.950046	2026-05-20 16:39:18.950046	mixamo	\N	\N	\N
3b619417-202b-4bb4-bef4-db319f2702d4	↪️ 左转	turn_left	/uploads/anim-library/anim-1779272114900-270542364.fbx	7f4de6259429e8cab1189e4f67d707c53b16903f561a32fcd41e84971693e2b4	↪️ 左转	\N	f	0	\N	\N	2026-05-20 18:15:14.915526	2026-05-20 18:15:14.915526	mixamo	Mixamo	\N	\N
7762fd31-ba90-4643-bed5-1ad85b85591b	🏃 奔跑	run	/uploads/anim-library/anim-1779263475939-548011705.fbx	4bbe421419c2f3b121fa98562baada31d24b92d3ff0ae94deb5e14a3ce7bd0c3	🏃 奔跑	\N	f	0	\N	\N	2026-05-20 15:51:16.403758	2026-05-20 15:51:16.403758	mixamo	\N	\N	\N
4677f959-6077-41da-9b39-a6ce2f0c36d8	🧍 待机	idle	/uploads/anim-library/anim-1779353424049-284795928.glb	4c2ffcdad54a40e5f0f9a6eeb31e7c0b96088c18414f22e3bf3b3cc1c3de4eff	🧍 待机	\N	f	0	\N	\N	2026-05-21 16:50:24.119959	2026-05-21 16:50:24.119959	mixamo	Mixamo	\N	\N
71b6d514-f39c-49b2-893d-760fc32f44a6	🏃 奔跑	run	/uploads/anim-library/anim-1779359981454-823651996.glb	5c984e09b87f931b45dbc897fc5e3480f47ea414798158d30acfce05ad11146a	🏃 奔跑	\N	t	0	\N	\N	2026-05-21 18:39:41.532381	2026-05-21 18:39:41.532381	mixamo	Mixamo	\N	\N
f4bf646d-852f-476a-80e2-9931229a1aad	🦘 跳跃	jump	/uploads/anim-library/anim-1779410637651-700800011.glb	e518593bfcd2f99b73c514deecaf2b33f1a934e16904daf2539b3afe00949ed9	🦘 跳跃	\N	f	0	\N	\N	2026-05-22 08:43:58.091629	2026-05-22 08:43:58.091629	mixamo	Mixamo	\N	\N
77f3b78d-f230-42ef-863f-0f42d18cf39f	🦘 跳跃	jump	/uploads/anim-library/anim-1779415657416-64578244.glb	f9e4884247251bd9e6418fa78838b8a4554c92b3881b614837bffc831311f37b	🦘 跳跃	\N	t	0	\N	\N	2026-05-22 10:07:37.427535	2026-05-22 10:07:37.427535	mixamo	Mixamo	\N	\N
838e8fe3-aac5-4a3f-b0d6-d4ee8b5461fd	🚶 走路	walk	/uploads/anim-library/anim-1779416734316-192850102.glb	6219160ba47c9cd19845e72457bb8292b133025a95b8e78e9917e3b5721bf365	🚶 走路	\N	t	0	\N	\N	2026-05-22 10:25:34.324424	2026-05-22 10:25:34.324424	mixamo	Mixamo	\N	\N
6522a525-2738-4e41-88df-330de0e9cd0c	🧍 待机	idle	/uploads/anim-library/anim-1779410080245-425427073.glb	2370407dbc30c49efab735e6e9f8d7393f06d06f5dfee27758635722e899e0a9	🧍 待机	\N	f	0	\N	\N	2026-05-22 08:34:40.317037	2026-05-22 08:34:40.317037	mixamo	Mixamo	\N	\N
896f6ca4-e0f2-4f3a-847e-548f0fc246c3	🧍 待机	idle	/uploads/anim-library/anim-1779417216335-269714658.glb	9cfbd1b630931ae0354a7d1055cc76b685cf7467db57694086c2b632b16eb239	🧍 待机	\N	f	0	\N	\N	2026-05-22 10:33:36.3484	2026-05-22 10:33:36.3484	mixamo	Mixamo	\N	\N
cffc0c48-4cce-4f9a-a1ac-9a4e20eebba6	🧍 待机	idle	/uploads/anim-library/anim-1780048384423-799659208.glb	bf15cf64dfd1052530e716b2beaacc5a506916f9a11b73a468d099e4c128aacc	🧍 待机	\N	t	0	\N	\N	2026-05-29 17:53:04.451081	2026-05-29 17:53:04.451081	mixamo	Mixamo	\N	\N
23340edf-ae8f-4670-b52b-7eba4ab2b07a	⚔️ 挥砍	attack_slash	/uploads/anim-library/anim-1788167785209-773140698.glb	42c5c876a4aef96b8729e6737971ec35ab9f0799f8cf5c748e667b842b5ee5b7	⚔️ 挥砍	\N	f	0	\N	\N	2026-08-31 17:16:25.238626	2026-08-31 17:16:25.238626	mixamo	Mixamo	\N	\N
\.


--
-- Data for Name: bone_mappings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bone_mappings (id, template_id, source_bone_name, target_bone_name, confidence_score, auto_mapped, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: buildings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.buildings (id, plot_id, building_name, model_url, "position", rotation, scale, assets, created_at, updated_at, tags, category, auto_tags) FROM stdin;
\.


--
-- Data for Name: character_appearance; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.character_appearance (id, character_id, face_brows, face_glasses, face_nose, face_skin, face_ears, face_mouth, face_beard, face_jaw, hair, top_wear, bottom_wear, shoes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: character_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.character_templates (id, name, description, glb_url, glb_hash, thumbnail_url, access_level, character_role, is_active, is_default, sort_order, created_at, updated_at, created_by_admin_id, created_by_name, anim_walk_url, anim_run_url, anim_jump_url, anim_attack1_url, anim_hit_url, anim_death_url, anim_attack2_url, anim_attack3_url, anim_idle_url, anim_turn_left_url, anim_turn_right_url, anim_attack_stab_url, anim_attack_slash_url, anim_attack_swing_url, anim_attack_uppercut_url, anim_sheath_url, anim_draw_sword_url, anim_set, weapon_id, weapon_config, bone_map, anim_sounds, weapon_sounds, is_federated, source_world_id, source_template_id, resource_urls, anim_adapt, last_sync_time, fit_config, calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated, calibrated_at, calibration_version, model_source_platform, selected_anim_platform, anim_mode) FROM stdin;
\.


--
-- Data for Name: characters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.characters (id, user_id, name, level, health, max_health, attack_power, defense, experience, "position", respawn_point, created_at, updated_at, last_position, last_online, realname, bio) FROM stdin;
\.


--
-- Data for Name: config_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.config_audit_log (id, config_key, old_value, new_value, changed_by, changed_at, ip_address) FROM stdin;
\.


--
-- Data for Name: custom_npcs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.custom_npcs (id, name, avatar_emoji, description, world_name, tag, "position", ai_provider, ai_model, ai_endpoint, ai_key, system_prompt, shape_code, shape_desc, detect_range, approach_range, greeting, farewell, greet_trigger, is_active, roam, face_player, created_at, updated_at, created_by) FROM stdin;
\.


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.equipment (id, character_id, equipment_type, equipment_name, model_url, glow, stats, created_at) FROM stdin;
\.


--
-- Data for Name: federation_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.federation_templates (id, user_id, source_world_id, source_template_id, local_template_id, template_data, resource_urls, bone_map, anim_adapt, is_active, created_at, updated_at, category) FROM stdin;
\.


--
-- Data for Name: gallery_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.gallery_configs (id, name, start_x, start_y, start_z, matrix_width, buffer_rate, row_spacing, col_spacing, max_photo_width, max_photo_height, sort_by, folder_gap, jitter, is_active, total_photos, total_videos, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: gallery_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.gallery_items (id, config_id, folder_name, file_name, file_path, file_type, photo_date, pos_x, pos_y, pos_z, width, height, rot_y, sort_order, is_folder_marker, created_at) FROM stdin;
\.


--
-- Data for Name: game_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.game_config (id, config_key, config_value, description, updated_at, created_at) FROM stdin;
1	character_editor_config	{\n  "character": {\n    "scale": 1,\n    "headColor": 16755353,\n    "bodyColor": 4886754\n  },\n  "sword": {\n    "position": {\n      "x": 0.03,\n      "y": -0.47,\n      "z": 0.1\n    },\n    "rotation": {\n      "x": 35,\n      "y": 95,\n      "z": 85\n    },\n    "hiltColor": 0,\n    "bladeColor": 65535,\n    "bladeLength": 1.2,\n    "glowIntensity": 2\n  },\n  "attack": {\n    "duration": 500,\n    "swingAngle": 100,\n    "armSwing": 0.6,\n    "trajectory": {\n      "startOffset": {\n        "x": 0,\n        "y": 0,\n        "z": 0\n      },\n      "endOffset": {\n        "x": 0,\n        "y": 0,\n        "z": 0\n      },\n      "midRotation": 0\n    }\n  },\n  "animation": {\n    "walkSpeed": 1.5\n  }\n}	\N	2026-02-24 16:16:53.627001	2026-02-24 14:28:48.020215
8	world_weather	{"type":"clear","intensity":95,"wind":20,"auto_cycle":false,"cycle_interval":6,"last_switch_at":null,"sky_id":"proc:dusk","sky_link":false,"sky_map":{},"updated_at":"2026-11-18T07:07:04.208Z","sky":{"id":"proc:dusk","name":"黄昏","kind":"procedural","preset":"dusk","url":null,"width":null,"height":null,"use_env":false,"builtin":true,"top":"#1b2450","bottom":"#ff9b52"}}	\N	2026-11-18 15:07:04.209421	2026-03-02 15:37:39.318307
\.


--
-- Data for Name: generated_buildings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.generated_buildings (id, user_id, name, description, image_path, prompt, task_id, status, model_url, thumbnail_url, local_path, created_at, completed_at, tags, updated_at) FROM stdin;
\.


--
-- Data for Name: geometry_buildings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.geometry_buildings (id, user_id, name, template_id, geometry_data, created_at, tags, category, description, auto_tags, updated_at) FROM stdin;
\.


--
-- Data for Name: login_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.login_attempts (id, username, ip_address, target_type, success, reason, created_at) FROM stdin;
\.


--
-- Data for Name: maintenance_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.maintenance_logs (id, script_id, script_label, category, status, result_summary, result_detail, affected_rows, error_message, executed_by, started_at, finished_at) FROM stdin;
\.


--
-- Data for Name: model_bounds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.model_bounds (path, unit_radius, source, updated_at) FROM stdin;
\.


--
-- Data for Name: model_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.model_tags (id, name, category, description, parent_tag_id, usage_count, created_at) FROM stdin;
3	交通工具	type	车辆、船只等	\N	0	2026-02-13 15:21:24.286438
5	动物	type	各类动物模型	\N	0	2026-02-13 15:21:24.286438
7	道具	type	游戏道具、物品	\N	0	2026-02-13 15:21:24.286438
8	家具	type	室内外家具	\N	0	2026-02-13 15:21:24.286438
11	科幻	style	科幻未来风格	\N	0	2026-02-13 15:21:24.286438
12	魔幻	style	魔幻奇幻风格	\N	0	2026-02-13 15:21:24.286438
13	中式	style	中国传统风格	\N	0	2026-02-13 15:21:24.286438
14	欧式	style	欧洲风格	\N	0	2026-02-13 15:21:24.286438
15	日式	style	日本风格	\N	0	2026-02-13 15:21:24.286438
16	卡通	style	卡通风格	\N	0	2026-02-13 15:21:24.286438
17	微型	size	非常小的物体	\N	0	2026-02-13 15:21:24.286438
21	巨型	size	超大型物体	\N	0	2026-02-13 15:21:24.286438
25	沙漠	theme	沙漠场景	\N	0	2026-02-13 15:21:24.286438
26	雪地	theme	雪地冰川	\N	0	2026-02-13 15:21:24.286438
27	海洋	theme	海洋海滩	\N	0	2026-02-13 15:21:24.286438
28	太空	theme	太空场景	\N	0	2026-02-13 15:21:24.286438
29	地下城	theme	地下城场景	\N	0	2026-02-13 15:21:24.286438
30	废墟	theme	废弃场景	\N	0	2026-02-13 15:21:24.286438
32	商业	function	商业建筑	\N	0	2026-02-13 15:21:24.286438
33	工业	function	工业建筑	\N	0	2026-02-13 15:21:24.286438
34	娱乐	function	娱乐设施	\N	0	2026-02-13 15:21:24.286438
36	宗教	function	宗教建筑	\N	0	2026-02-13 15:21:24.286438
37	交通	function	交通设施	\N	0	2026-02-13 15:21:24.286438
38	可交互	attribute	可以交互的物体	\N	0	2026-02-13 15:21:24.286438
39	动态	attribute	有动画的物体	\N	0	2026-02-13 15:21:24.286438
41	透明	attribute	透明或半透明	\N	0	2026-02-13 15:21:24.286438
42	高精度	attribute	高精度模型	\N	0	2026-02-13 15:21:24.286438
43	低多边形	attribute	低多边形风格	\N	0	2026-02-13 15:21:24.286438
20	大型	size	大型物体	\N	1	2026-02-13 15:21:24.286438
35	军事	function	军事设施	\N	1	2026-02-13 15:21:24.286438
2	自然景观	type	山川、树木等自然元素	\N	1	2026-02-13 15:21:24.286438
6	植物	type	花草树木	\N	1	2026-02-13 15:21:24.286438
24	森林	theme	森林场景	\N	1	2026-02-13 15:21:24.286438
19	中型	size	中等大小	\N	9	2026-02-13 15:21:24.286438
9	现代	style	现代风格	\N	1	2026-02-13 15:21:24.286438
22	城市	theme	城市场景相关	\N	1	2026-02-13 15:21:24.286438
40	发光	attribute	自发光物体	\N	1	2026-02-13 15:21:24.286438
4	装饰物	type	装饰性物品	\N	9	2026-02-13 15:21:24.286438
23	乡村	theme	乡村场景相关	\N	1	2026-02-13 15:21:24.286438
31	住宅	function	居住类建筑	\N	1	2026-02-13 15:21:24.286438
1	建筑物	type	各类建筑结构	\N	2	2026-02-13 15:21:24.286438
10	古典	style	古典传统风格	\N	2	2026-02-13 15:21:24.286438
18	小型	size	小型物体	\N	2	2026-02-13 15:21:24.286438
\.


--
-- Data for Name: monster_drops; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.monster_drops (id, item_name, rarity, created_at) FROM stdin;
\.


--
-- Data for Name: monsters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.monsters (id, monster_type, spawn_position, health, max_health, attack_power, reward_exp, drop_rate, is_active, created_at, updated_at, geometry_type, geometry_color, defense, level, move_speed, aggro_range, attack_range, respawn_seconds, drop_expire_seconds, drop_pool_id, drop_max_per_user, move_range, patrol_mode, patrol_path) FROM stdin;
\.


--
-- Data for Name: npc_chat_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.npc_chat_history (id, npc_id, player_id, player_name, role, content, created_at) FROM stdin;
\.


--
-- Data for Name: npcs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.npcs (id, name, description, model_url, model_type, avatar_emoji, "position", rotation, scale, ai_provider, ai_model, system_prompt, personality, behavior, memory_config, is_active, created_at, updated_at, shape_code, shape_desc) FROM stdin;
\.


--
-- Data for Name: object_transform_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.object_transform_overrides (object_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, object_name, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (id, buyer_id, shop_item_id, quantity, total_price, status, created_at, updated_at, payment_reference) FROM stdin;
\.


--
-- Data for Name: part_libraries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.part_libraries (id, world_id, pack_key, display_name, style_family, description, source_type, source_ref, license_info, cover_image, status, reviewed_by, reviewed_at, priority, stats, created_at, updated_at, prev_status, deleted_at, source_path) FROM stdin;
\.


--
-- Data for Name: part_library_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.part_library_items (id, library_id, model_id, part_key, part_role, part_subtype, grid_w, grid_h, grid_d, collidable, repeat_allowed, stack_rule, lod_policy, thumbnail, tags, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at) FROM stdin;
\.


--
-- Data for Name: pending_trust_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pending_trust_requests (id, world_id, world_name, world_url, public_key, source_ip, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: player_inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.player_inventory (id, user_id, code_id, acquired_at, is_used, used_at) FROM stdin;
\.


--
-- Data for Name: plots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.plots (id, owner_id, "position", size, buildings, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: portal_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portal_logs (id, portal_id, character_id, used_at) FROM stdin;
\.


--
-- Data for Name: portals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portals (id, name, description, source_position, target_position, target_world_url, portal_type, is_active, is_bidirectional, cooldown_seconds, required_level, created_by, created_at, updated_at, show_in_list) FROM stdin;
\.


--
-- Data for Name: resource_references; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.resource_references (id, template_id, resource_type, resource_url, resource_hash, file_size, format, quality_level, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: reward_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reward_codes (id, pool_id, code, reward_name, reward_desc, platform_url, is_claimed, claimed_by, claimed_at, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: reward_pools; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reward_pools (id, pool_name, description, created_at) FROM stdin;
\.


--
-- Data for Name: scene_3dgs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scene_3dgs (id, scene_name, description, scene_type, source_type, rad_file_path, rad_file_url, file_size, thumbnail_url, splat_count, lod_levels, is_public, view_count, tags, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: security_questions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.security_questions (id, question_text, sort_order, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: shop_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.shop_items (id, shop_id, item_name, description, price, quantity, model_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: shops; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.shops (id, merchant_id, shop_name, "position", created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.skills (id, character_id, skill_name, trigger_text, effect_type, effect_duration, effect_power, range_distance, created_at) FROM stdin;
\.


--
-- Data for Name: system_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_config (id, config_key, config_value, description, is_sensitive, updated_by, updated_at, created_at) FROM stdin;
4	HUNYUAN3D_ENABLED	false	是否启用混元3D功能	f	\N	2026-02-11 09:02:23.484269	2026-02-11 09:02:23.484269
5	HUNYUAN3D_DEFAULT_QUALITY	medium	默认模型质量 (low/medium/high)	f	\N	2026-02-11 09:02:23.484269	2026-02-11 09:02:23.484269
6	HUNYUAN3D_MAX_TASKS	10	最大并发任务数	f	\N	2026-02-11 09:02:23.484269	2026-02-11 09:02:23.484269
610	model_guard.enabled	false	\N	f	\N	2026-09-07 14:11:20.046138	2026-07-31 16:53:49.589367
611	model_guard.show_warning	false	\N	f	\N	2026-09-07 14:11:20.048781	2026-07-31 16:53:49.591154
612	model_guard.placeholder_style	stickman	\N	f	\N	2026-09-07 14:11:20.051196	2026-07-31 16:53:49.594627
613	model_guard.character_bundle_mode	retarget	\N	f	\N	2026-09-07 14:11:20.05366	2026-07-31 16:53:49.596798
168	seo_description	一个 AI Agent 是一等公民的 3D 在线世界。任何 AI 仅凭域名即可零凭证进入，拥有身份与 Avatar，在世界里行走说话，并被真人玩家实时看见。Node.js 18+ 二十行代码跑通。	SEO描述（Description）	f	\N	2026-09-22 16:58:29.345731	2026-06-23 17:49:53.155687
3	TENCENT_REGION	ap-guangzhou	腾讯云地域	f	1	2026-02-11 09:56:17.614031	2026-02-11 09:02:23.484269
169	seo_keywords	AI Agent,虚拟世界,3D世界,MCP,WebSocket,Three.js	SEO关键词（Keywords）	f	\N	2026-09-22 16:58:29.346245	2026-06-23 17:49:53.156317
1252	lod_mid_max_faces	10000	LOD中模面数上限（faces 模式：不管源多大，中模压到该面数以内）	f	\N	2026-11-18 13:50:35.207781	2026-09-14 12:40:35.283485
614	model_guard.anim_guard_enabled	false	\N	f	\N	2026-09-07 14:11:20.055805	2026-07-31 16:53:49.598769
615	model_guard.anim_max_file_size	5	\N	f	\N	2026-09-07 14:11:20.058183	2026-07-31 16:53:49.600773
616	model_guard.anim_max_tracks	200	\N	f	\N	2026-09-07 14:11:20.060006	2026-07-31 16:53:49.602589
617	model_guard.anim_max_keyframes	20000	\N	f	\N	2026-09-07 14:11:20.061986	2026-07-31 16:53:49.604194
618	model_guard.anim_max_duration	30	\N	f	\N	2026-09-07 14:11:20.065734	2026-07-31 16:53:49.605715
619	model_guard.anim_max_meshes	10	\N	f	\N	2026-09-07 14:11:20.068624	2026-07-31 16:53:49.607266
620	model_guard.anim_total_max_size	30	\N	f	\N	2026-09-07 14:11:20.070943	2026-07-31 16:53:49.61042
621	model_guard.anim_guard_remote_only	false	\N	f	\N	2026-09-07 14:11:20.073354	2026-07-31 16:53:49.613171
550	subscription_first_auth_cents	6000	首次授权费（分）	f	\N	2026-07-29 17:29:00.595804	2026-07-29 17:29:00.595804
551	subscription_first_auth_months	2	首次授权包含月数	f	\N	2026-07-29 17:29:00.595804	2026-07-29 17:29:00.595804
552	subscription_reauth_after_months	12	断订多少个月后需重新授权	f	\N	2026-07-29 17:29:00.595804	2026-07-29 17:29:00.595804
167	seo_title	创世虚拟世界 · 让 AI Agent 走进的 3D 世界	SEO标题（Title）	f	\N	2026-09-22 16:58:29.34458	2026-06-23 17:49:53.119825
1054	lod_mid_far_dist	100	LOD中模带距离(米)，高模带外 ≤ 该值用中模	f	\N	2026-11-18 13:50:35.202134	2026-09-12 20:51:29.786591
1055	lod_far_dist	200	LOD低模带距离(米)，中模带外 ≤ 该值用低模，超出显示蓝方块	f	\N	2026-11-18 13:50:35.20642	2026-09-12 20:51:29.787369
1253	lod_mid_percent	25	LOD中模压缩百分比（percent 模式：中模=源×该%）	f	\N	2026-09-14 12:40:35.284243	2026-09-14 12:40:35.284243
148	first_deploy_date	2026-06-22	订阅系统配置	f	\N	2026-06-22 17:45:07.361378	2026-06-22 17:45:07.361378
149	subscription_price_cents	300	订阅系统配置	f	\N	2026-06-22 17:45:07.362862	2026-06-22 17:45:07.362862
150	billing_company	济宁米多信息科技有限公司	订阅系统配置	f	\N	2026-06-22 17:45:07.364258	2026-06-22 17:45:07.364258
151	cn_payment_methods	wechat,alipay	订阅系统配置	f	\N	2026-06-22 17:45:07.365558	2026-06-22 17:45:07.365558
152	en_payment_methods	paypal,crypto	订阅系统配置	f	\N	2026-06-22 17:45:07.366751	2026-06-22 17:45:07.366751
21	world_url	http://localhost:3002	世界访问URL（对外域名）	f	\N	2026-11-18 13:50:35.199244	2026-04-08 16:27:13.494513
916	voice_max_receivers	5	附近语音同时接收人数上限（可选 3/5/7，超出自动切换文字模式）	f	\N	2026-09-08 15:35:56.387979	2026-09-08 11:11:28.708477
1254	lod_low_target_faces	100	LOD低模目标面数（低模样式标准）	f	\N	2026-11-18 13:50:35.208498	2026-09-14 12:40:35.284968
1251	lod_mid_cap_mode	faces	LOD中模压缩方式：faces=按面数上限 / percent=按压缩百分比	f	\N	2026-11-18 13:50:35.207098	2026-09-14 12:40:35.263074
32	default_language	zh-CN	系统默认语言	f	\N	2026-11-16 17:31:55.671309	2026-06-10 09:55:36.84856
1458	agent_enabled	true	Agent 接入总开关（默认关，上线手动开）	f	\N	2026-10-11 13:00:06.989769	2026-09-17 21:45:50.877229
20	world_name	米多100的3002	世界名称	f	\N	2026-11-18 13:50:35.191642	2026-04-08 16:27:13.46635
4976	world_ai_gen3d_provider	undefined	\N	f	\N	2026-10-10 18:15:11.664104	2026-10-10 07:38:25.226596
1053	lod_near_dist	30	LOD高模带距离(米)，玩家到模型表面 ≤ 该值用高模	f	\N	2026-11-18 13:50:35.201327	2026-09-12 20:51:29.770138
1380	player_lod_full_dist	100	角色LOD完整模型距离(米)，玩家间距离 ≤ 该值显示对方选择的GLB角色模型	f	\N	2026-09-17 12:07:58.155018	2026-09-17 10:47:46.034272
1381	player_lod_reload_dist	80	角色LOD GLB重载距离(米)，走远降级后走近该值才重载GLB（滞后窗口）	f	\N	2026-09-17 12:07:58.155655	2026-09-17 10:47:46.057243
1382	player_lod_hide_dist	500	角色LOD隐藏距离(米)，玩家间距离 > 该值完全不渲染对方	f	\N	2026-09-17 12:07:58.156324	2026-09-17 10:47:46.057796
1383	player_lod_show_dist	450	角色LOD恢复显示距离(米)，走远消失后走近该值才重新显示棍人（滞后窗口）	f	\N	2026-09-17 12:07:58.156802	2026-09-17 10:47:46.058222
606	model_guard.max_file_size	10	\N	f	\N	2026-09-07 14:11:20.035922	2026-07-31 16:53:49.52416
607	model_guard.max_triangles	50000	\N	f	\N	2026-09-07 14:11:20.040655	2026-07-31 16:53:49.584292
608	model_guard.max_vertices	30000	\N	f	\N	2026-09-07 14:11:20.042586	2026-07-31 16:53:49.586161
609	model_guard.max_mesh_count	20	\N	f	\N	2026-09-07 14:11:20.044405	2026-07-31 16:53:49.587822
22	world_description	world_description_restored	世界描述	f	\N	2026-11-18 13:50:35.199967	2026-04-08 16:27:13.495139
4820	world_ai_steward_enabled	false	\N	f	\N	2026-10-09 22:47:30.91381	2026-10-09 20:03:01.909969
958	lod_enabled	true	模型LOD分级渲染开关（true/false）	f	\N	2026-11-18 13:50:35.200616	2026-09-11 19:18:52.220072
1638	chat_log_s3_prefix	chat-archive	S3 key 前缀（默认 chat-archive/YYYY/MM/DD.jsonl.gz）	f	\N	2026-09-18 06:57:25.212124	2026-09-18 06:57:25.212124
1633	chat_log_retention_days	7	本地保留天数（1~365），到期清除已成功归档的本地行	f	\N	2026-09-18 07:01:55.6678	2026-09-18 06:57:25.209633
1634	chat_log_remote_enabled	false	远端归档开关（默认关）	f	\N	2026-09-18 07:03:04.139985	2026-09-18 06:57:25.21025
1635	chat_log_remote_provider	none	归档目的地（none|s3|baidu[预留]）	f	\N	2026-09-18 07:03:04.141106	2026-09-18 06:57:25.210746
1462	max_agents	50	全局并发 Agent 上限	f	\N	2026-10-10 08:13:29.035716	2026-09-17 21:45:50.893979
1459	agent_push_default	eco	Agent 推送默认档（eco|standard|realtime）	f	\N	2026-10-10 08:15:45.100111	2026-09-17 21:45:50.892425
1461	agent_voice_relay	false	语音是否中继给 Agent（默认关）	f	\N	2026-10-10 08:14:57.909711	2026-09-17 21:45:50.893469
1641	chat_log_upload_hour	3	每日归档时刻（0~23，默认凌晨 3 点）	f	\N	2026-09-18 06:57:25.213504	2026-09-18 06:57:25.213504
5522	building_floor_height	2.4	AI 建楼默认层高(米)：building recipe 每层的高度。墙件比它矮时自动沿高度堆叠（0.625m 的 building_block 叠 4 块 = 2.4m 一层）	f	\N	2026-10-12 17:48:18.795762	2026-10-12 17:48:18.795762
5647	ambient_music	{"enabled":false,"url":"/uploads/character-templates/sounds/env-city.mp3","mode":"loop","volume":0.55,"fadeIn":3}	场景背景音乐（进世界播放）	f	\N	2026-11-03 19:14:07.662419	2026-11-03 16:49:47.533368
1	TENCENT_SECRET_ID		腾讯云 SecretId	t	1	2026-02-11 09:56:17.605647	2026-02-11 09:02:23.484269
856	world_ground_config	{"width":2000,"depth":2000,"gridSize":100,"color":"#2d5016"}	世界主地块大小配置	f	\N	2026-10-18 11:05:42.207269	2026-08-24 17:37:52.821403
5598	audio_weather	{"wind":{"enabled":true,"url":"/uploads/character-templates/sounds/weather-wind.mp3","candidates":["/uploads/character-templates/sounds/weather-wind.mp3"],"maxVolume":0.09,"freqFrom":100,"freqTo":250},"rain":{"enabled":true,"url":"/uploads/character-templates/sounds/weather-rain.mp3","candidates":["/uploads/character-templates/sounds/weather-rain.mp3","/uploads/character-templates/sounds/weather-rain-b.mp3"],"maxVolume":0.7},"snow":{"enabled":true,"url":"/uploads/character-templates/sounds/weather-snow-light.mp3","candidates":["/uploads/character-templates/sounds/weather-snow-light.mp3"],"maxVolume":0.25},"fog":{"enabled":true,"url":"/uploads/character-templates/sounds/weather-fog-desert.mp3","candidates":["/uploads/character-templates/sounds/weather-fog-desert.mp3"],"maxVolume":0.2,"lowpassFrom":20000,"lowpassTo":1800},"thunder":{"enabled":true,"url":"/uploads/character-templates/sounds/weather-thunder.mp3","candidates":["/uploads/character-templates/sounds/weather-thunder.mp3"],"minGap":15,"maxGap":40,"volume":0.45}}	天气联动音频配置（风/雨/雪/雾/雷）	f	\N	2026-11-15 08:52:02.23991	2026-11-03 12:31:04.975971
1632	chat_log_enabled	true	聊天记录总开关（关后停止写入 world_chat_log）	f	\N	2026-09-18 07:09:16.611881	2026-09-18 06:57:25.186775
16	world_spawn_point	{"position":{"x":-21.460311304223232,"y":9.273048136136243,"z":14.977859510073646},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}	世界出生点位置和变换	f	\N	2026-11-18 16:01:58.413039	2026-02-12 17:11:16.952862
2585	agent_max_speed	12	Agent 移动速度上限 m/s（1~20，默认 9 与真人一致）	f	\N	2026-09-20 10:39:32.596533	2026-09-19 07:09:21.106244
3899	agent_follow_speed	8	Agent 跟随速度上限 m/s（1~20，默认 8；仅 follow 使用）	f	\N	2026-09-20 14:32:20.050306	2026-09-20 14:31:47.62095
4557	threejs_issue_config	{"thresholds":{"bigGeometry":1000,"bigDimension":50,"timers":1,"minObjectDim":0.5}}	Three.js 问题库词条配置（后台可视化维护）	f	\N	2026-09-24 16:40:19.585853	2026-09-24 15:58:07.49825
2598	agent_observe_rate_key	1	Key Agent observe 采样率（次/秒，1~10，默认 1）	f	\N	2026-10-10 08:14:57.908872	2026-09-19 07:12:36.289122
2306	agent_max_connections_per_agent	1	单个 Agent 并发连接上限（1~10，超出时新连接顶掉旧连接）	f	\N	2026-10-10 08:14:57.909297	2026-09-18 19:09:30.945751
5605	ambient_pads	[{"id":"pad_wind","name":"env-wind.mp3","url":"/uploads/character-templates/sounds/env-wind.mp3","x":0,"y":0,"z":0,"radius":120,"volume":0.35,"loop":false,"fadeIn":3,"enabled":true},{"id":"pad_birds","name":"env-birds.mp3","url":"/uploads/character-templates/sounds/env-birds.mp3","x":900,"y":8.5,"z":700,"radius":40,"volume":0.6,"loop":false,"fadeIn":2,"enabled":true}]	环境声点位（声音 + 坐标 + 可听半径 + 音量）	f	\N	2026-11-05 16:59:32.188731	2026-11-03 13:37:57.334215
4975	world_ai_gen3d_enabled	undefined	\N	f	\N	2026-10-10 18:15:11.661435	2026-10-10 07:38:25.175317
2	TENCENT_SECRET_KEY		腾讯云 SecretKey	t	1	2026-02-11 09:56:17.611956	2026-02-11 09:02:23.484269
1639	chat_log_s3_access_key		S3 access key（密钥加密存储，见 setSensitiveConfigValue）	t	\N	2026-09-18 07:01:58.400377	2026-09-18 06:57:25.212525
1640	chat_log_s3_secret_key		S3 secret key（密钥加密存储，见 setSensitiveConfigValue）	t	\N	2026-09-18 07:01:58.434263	2026-09-18 06:57:25.212916
5718	POLYFORK_API_KEY		\N	f	\N	2026-11-12 11:28:59.804004	2026-11-12 10:27:32.759278
5370	TRIPO_API_KEY		\N	t	\N	2026-10-10 11:42:37.768693	2026-10-10 11:41:30.594188
1637	chat_log_s3_bucket		S3 bucket 名	f	\N	2026-09-18 07:01:58.366584	2026-09-18 06:57:25.211742
1636	chat_log_s3_endpoint		S3 兼容 endpoint（覆盖 OSS/COS/MinIO）	f	\N	2026-09-18 07:01:58.366172	2026-09-18 06:57:25.211295
147	world_id		世界唯一标识	f	\N	2026-06-22 17:45:07.315001	2026-06-22 17:45:07.315001
\.


--
-- Data for Name: teleport_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teleport_history (id, user_id, source_world_id, source_world_name, target_world_id, target_world_name, context, created_at) FROM stdin;
\.


--
-- Data for Name: template_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.template_skills (id, template_id, skill_name, trigger_text, skill_type, skill_scope, animation_clip, effect_type, effect_power, range_distance, effect_duration, cooldown, particle_effect, icon_emoji, sort_order, created_at, anim_glb_url, fx_preset, fx_color, fx_glow, fx_particle, fx_duration, fx_blade_color, fx_glow_intensity, fx_particle_type, fx_duration_legacy, fx_sound_url, fx_sound_volume) FROM stdin;
\.


--
-- Data for Name: terrains; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.terrains (id, name, note, is_builtin, is_active, seed, params, created_at, updated_at, zone_enabled, zone_x, zone_z, zone_size, zone_priority, pos_x, pos_z, width, depth, base_y, color, grid_size, priority) FROM stdin;
\.


--
-- Data for Name: threejs_code_blocks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.threejs_code_blocks (id, name, description, code, raw_code, clean_options, tags, thumbnail_url, created_at, updated_at, source_type, source_url, auto_fixes, import_status) FROM stdin;
\.


--
-- Data for Name: token_usage; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.token_usage (nonce, principal_type, subject_id, source_world_id, target_world_id, used_at) FROM stdin;
\.


--
-- Data for Name: trusted_worlds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trusted_worlds (world_id, world_name, world_url, public_key, enabled, created_at, updated_at, is_central, endpoint_key) FROM stdin;
\.


--
-- Data for Name: ui_controls; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ui_controls (id, control_id, control_name, control_type, category, position_x, position_y, width, height, position_type, mobile_position_x, mobile_position_y, mobile_width, mobile_height, style_config, is_visible, is_enabled, z_index, related_module, description, created_at, updated_at, created_by, updated_by, h_align, v_align, landscape_position_x, landscape_position_y, landscape_width, landscape_height) FROM stdin;
1719	mobile_turn_right_btn	右转按钮	button	mobile	auto	180px	50px	50px	fixed	6%	13%	50px	50px	{}	t	t	1000	mobileControls.js	按住向右转向（等效桌面端E键）	2026-07-22 15:45:39.776259	2026-11-16 11:55:12.392488	\N	1	right	bottom	0%	18%	50px	50px
16	btn_profile	个人资料	button	general	0px	20px	48px	48px	fixed	0px	20px	48px	48px	{}	t	t	1000	ui.js	右上角个人资料按钮	2026-03-08 08:45:38.853341	2026-11-16 11:55:12.380339	\N	1	left	top	0px	20px	48px	48px
39	debug_panel	坐标调试面板	panel	general	42%	2%	277.732px	30px	fixed	0%	0%	274px	33px	{}	t	t	1000	main.js	显示当前坐标、FPS、相机模式等调试信息	2026-06-02 14:49:05.160948	2026-11-16 11:55:12.381381	\N	1	right	top	23%	0%	275px	30px
35	minimap	小地图	minimap	general	0%	0%	112px	74px	fixed	0%	1%	136px	76px	{}	f	t	1000	ui.js	右上角小地图	2026-06-02 14:49:05.155127	2026-11-16 11:55:12.382434	\N	1	right	top	0%	0%	136px	76px
95	performance_monitor	性能监控面板	panel	general	8%	6%	200px	120px	fixed	auto	auto	150px	100px	{}	f	t	1000	performance-optimization.js	显示FPS和性能指标	2026-06-18 15:34:26.474001	2026-11-16 11:55:12.383494	\N	1	right	bottom	auto	auto	150px	100px
1718	mobile_turn_left_btn	左转按钮	button	mobile	auto	180px	50px	50px	fixed	23%	12%	50px	50px	{}	t	t	1000	mobileControls.js	按住向左转向（等效桌面端Q键）	2026-07-22 15:45:39.773824	2026-11-16 11:55:12.393472	\N	1	right	bottom	12%	18%	50px	50px
5	skill_hud	技能栏	panel	general	35%	94%	283px	30px	absolute	42%	82%	auto	58px	{}	f	t	1000	skillHUD.js	屏幕底部技能栏	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.384603	\N	1	left	bottom	42%	82%	auto	58px
17	btn_inventory	物品管理	button	general	60px	20px	48px	48px	fixed	60px	20px	48px	48px	{}	t	t	1000	ui.js	右上角物品管理按钮	2026-03-08 08:45:38.853341	2026-11-16 11:55:12.385642	\N	1	left	top	60px	20px	48px	48px
1	mobile_joystick	移动摇杆	joystick	mobile	24px	auto	150px	150px	fixed	2%	3%	150px	150px	{}	t	t	1000	mobileControls.js	左下角虚拟摇杆，控制角色移动	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.394483	\N	1	left	bottom	2%	3%	150px	150px
4	mobile_camera_toggle_btn	视角切换按钮	button	mobile	auto	24px	60px	60px	fixed	2%	25%	45px	46px	{}	t	t	1000	mobileControls.js	第一/第三人称视角切换	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.395775	\N	1	right	bottom	22%	0%	44px	44px
2	mobile_jump_btn	跳跃按钮	button	mobile	auto	24px	70px	70px	fixed	22%	0%	57px	59px	{}	t	t	1000	mobileControls.js	右下角跳跃按钮	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.396965	\N	1	right	bottom	11%	0%	53px	52px
19326	wi_fab	玩法按钮	button	general	1%	15%	126.159px	30px	fixed	0%	15%	88px	30px	{}	t	t	880	worldInteractions.js	打开玩法/任务面板	2026-11-16 11:23:32.33745	2026-11-16 14:58:44.917283	\N	1	left	top	0%	182px	88px	30px
17715	federation_portal_btn	联邦传送门按钮	button	general	0%	11%	141.008px	50.0586px	fixed	0%	6%	114.399px	39.9245px	{}	t	t	1000	federationUI.js	打开联邦世界传送界面	2026-11-03 19:58:33.642708	2026-11-16 11:55:12.387561	\N	1	right	top	1%	2%	auto	auto
7	health_bar	血条	healthbar	general	13%	1%	50px	31px	fixed	29%	12%	70px	30px	{}	f	t	1000	ui.js	左上角生命值显示	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.388484	\N	1	left	top	19%	2%	70px	30px
92	portal_btn	世界传送门按钮	button	general	0%	4%	142.833px	54.0167px	fixed	0%	13%	173.119px	45.9569px	{}	t	t	1000	portalManager.js	打开传送门界面	2026-06-18 15:34:26.47102	2026-11-16 11:55:12.37875	\N	1	right	top	0%	14%	156px	35px
19325	btn_language	语言切换按钮	button	general	120px	20px	48px	48px	fixed	120px	20px	48px	48px	{}	t	t	1000	main.js	切换中英文界面	2026-11-16 10:51:32.926797	2026-11-16 11:55:12.389359	\N	1	left	top	120px	20px	48px	48px
6	skill_voice_btn	语音按钮	button	general	3%	7%	54px	48px	fixed	0%	35%	58px	58px	{}	t	t	1000	skillHUD.js	语音输入按钮	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.390389	\N	1	left	bottom	0%	35%	58px	58px
3	mobile_sprint_btn	冲刺按钮	button	mobile	auto	24px	60px	60px	fixed	5%	0%	57px	57px	{}	t	t	1000	mobileControls.js	冲刺/加速按钮	2026-03-08 08:11:01.849169	2026-11-16 11:55:12.391408	\N	1	right	bottom	0%	0%	55px	55px
\.


--
-- Data for Name: uploaded_models; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.uploaded_models (id, file_name, saved_file_name, path, file_type, file_size, created_at, tags, category, description, auto_tags, thumbnail_path, updated_at, display_name, pack_id, part_category) FROM stdin;
\.


--
-- Data for Name: user_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_subscriptions (id, user_id, months, amount_cents, payment_method, proof_image_url, note, started_at, expires_at, created_at, txn_no, order_no, world_id) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, email, password_hash, created_at, updated_at, role, federation_user, security_question_id, security_answer) FROM stdin;
\.


--
-- Data for Name: visitor_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.visitor_sessions (id, visitor_type, session_key, user_id, ip, ua, world_id, entered_at, last_seen_at, left_at, duration_sec, end_reason) FROM stdin;
\.


--
-- Data for Name: wallet_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wallet_transactions (id, owner_type, owner_id, currency, amount, balance_after, kind, idempotency_key, ref_type, ref_id, created_at) FROM stdin;
\.


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wallets (owner_type, owner_id, currency, balance, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: weapon_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.weapon_skills (id, weapon_id, skill_name, effect_type, trigger_type, duration, sound_url, sort_order, is_confirmed, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: weapons; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.weapons (id, name, weapon_type, glb_url, config, is_active, sort_order, created_by_admin_id, created_by_name, created_at, updated_at, default_effect, icon_emoji) FROM stdin;
\.


--
-- Data for Name: world_activities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_activities (id, world_id, kind, title, description, region_key, created_by, origin, status, schedule, gameplay_def, gameplay_params, rules, win_when, spawned_object_ids, reward, participants, result, reward_summary, plan_step_id, scheduled_at, started_at, settling_at, finished_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_activity_participants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_activity_participants (id, activity_id, actor_type, actor_id, score, reward_granted, joined_at) FROM stdin;
\.


--
-- Data for Name: world_ai_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_ai_configs (id, world_id, enabled, provider_id, model, system_prompt, temperature, max_tokens, allowed_scopes, allowed_regions, risk_policy, autonomy, provider_map, context_window_tokens, budget, schedule, runtime_state, last_heartbeat_at, last_error, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_ai_credentials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_ai_credentials (id, world_id, name, key_hash, key_prefix, scopes, status, expires_at, last_used_at, usage_count, revoked_at, created_at, created_by) FROM stdin;
\.


--
-- Data for Name: world_ai_experiments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_ai_experiments (id, world_id, region_key, rule, hypothesis, metric_key, status, baseline_value, experiment_value, delta_pct, sample_n, change_steps, baseline_days, experiment_days, cooldown_until, verdict_note, decided_at, created_at, updated_at, region_id) FROM stdin;
\.


--
-- Data for Name: world_approvals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_approvals (id, world_id, target_type, target_id, risk_tier, payload, decision, decided_by, decided_at, comment, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: world_build_missions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_build_missions (id, world_id, region_key, title, prompt, constraints, budget, autonomy_snapshot, status, plan, executed_stats, provider_id, provider_resolution, origin, created_by, created_at, started_at, finished_at) FROM stdin;
\.


--
-- Data for Name: world_chat_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_chat_log (id, sender_type, sender_id, sender_name, message, "position", created_at) FROM stdin;
\.


--
-- Data for Name: world_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_config (key, value, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_drops; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_drops (id, code_id, monster_id, "position", dropped_at, expires_at, is_picked, picked_by, picked_at) FROM stdin;
\.


--
-- Data for Name: world_entities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_entities (id, world_id, entity_type, name, purpose, region_key, visual, physical, npc_refs, gameplay, origin, created_by, spec, spec_hash, state, entity_state, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_entity_parts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_entity_parts (id, entity_id, world_object_id, part_key, part_role, asset_ref, local_transform, sort_order, created_at) FROM stdin;
\.


--
-- Data for Name: world_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_events (id, seq, world_id, type, actor_type, actor_id, region_id, entity_id, world_object_id, target_id, x, y, z, payload, created_at) FROM stdin;
\.


--
-- Data for Name: world_gen3d_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_gen3d_jobs (id, world_id, status, provider, provider_task_id, idempotency_key, prompt, spec, params, result, error, attempts, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_goals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_goals (id, world_id, title, vision, hard_rules, soft_prefs, is_primary, source, approved_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_interactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_interactions (id, world_id, entity_id, world_object_id, region_key, interaction_type, key, label, "position", radius, payload, conditions, grants, once_per_day, daily_count, daily_reset_on, origin, enabled, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_memories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_memories (id, world_id, scope, subject_id, kind, content, importance, tags, source, plan_id, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_metrics_daily; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_metrics_daily (day, world_id, region_id, metric_key, metric_value, computed_at) FROM stdin;
\.


--
-- Data for Name: world_missions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_missions (id, world_id, statement, north_star, phases, current_phase, weekly_plan, last_report, monthly_budget, pending_statement, review_options, status, paused_reason, started_at, finished_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_object_groups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_object_groups (id, world_id, name, color, collapsed, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_objects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_objects (id, type, name, model_path, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, building_id, created_at, updated_at, model_type, threejs_code, world_id, video_props, has_collision, custom_config, is_locked, agent_description, origin, created_by, entity_id, region_id, visible, cast_shadow, receive_shadow, group_id) FROM stdin;
\.


--
-- Data for Name: world_plan_steps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_plan_steps (id, plan_id, phase_no, seq, tool_name, params, rationale, expected_effect, verify_tool, verify_params, risk_tier, human_risk_locked, status, execution_id, result, error, scheduled_at, started_at, finished_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_plans (id, world_id, goal_id, version, title, summary, overview, phases, risks, status, revision, reviewed_by, reviewed_at, approved_by, approved_at, rejected_reason, progress, started_at, finished_at, generated_by_plan_id, llm_call_id, prompt_digest, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_regions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_regions (id, region_key, world_id, name, purpose, bounds, autonomy, gridsnap, constraints, gameplay, tags, status, metrics, notes, last_active_at, preferred_provider_id, origin, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_reward_grants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_reward_grants (id, world_id, actor_type, actor_id, interaction_id, interaction_key, region_key, code_id, code, count, created_at) FROM stdin;
\.


--
-- Data for Name: world_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_rules (id, pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier, allow_skill_types, max_foreign_level, respawn_enabled, friendly_fire, world_type, created_at, updated_at) FROM stdin;
4fe1c6f3-e692-4b75-a56b-3a021eb06033	f	t	f	1	{perform,build}	999	t	f	normal	2026-02-25 17:03:19.561528	2026-10-09 22:50:19.910734
\.


--
-- Data for Name: world_sfx_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_sfx_jobs (id, status, provider, model, prompt, prompt_en, duration_sec, sample_rate, format, preview_path, preview_url, size_bytes, actual_duration, imported, asset_url, asset_name, asset_size, compress_ratio, params, error, error_hint, attempts, latency_ms, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: world_sky_presets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_sky_presets (id, name, kind, url, width, height, use_env, sort_order, created_at) FROM stdin;
\.


--
-- Data for Name: world_task_progress; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_task_progress (id, task_id, actor_type, actor_id, state, status, reward_granted, claimed_at, completed_at, objective_index, last_seq) FROM stdin;
\.


--
-- Data for Name: world_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_tasks (id, world_id, title, description, type, objectives, region_key, region_ref, entity_id, giver, status, visibility, repeatable, max_completions, completion_count, reward, conditions, origin, plan_step_id, world_day, expires_at, created_at, updated_at, giver_type, giver_id, source_template, gameplay_def) FROM stdin;
\.


--
-- Data for Name: world_tool_executions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_tool_executions (id, world_id, plan_id, plan_step_id, tool_name, params, risk_tier, status, before_state, after_state, undo_payload, undoable, approval_id, actor, reason, error, result, latency_ms, created_at, finished_at) FROM stdin;
\.


--
-- Data for Name: world_weather; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_weather (id, weather_type, sky_mode, fog_enabled, fog_density, rain_intensity, snow_intensity, wind_speed, sun_angle, day_cycle_enabled, day_cycle_speed, updated_at, fog_color, intensity, duration, start_time, end_time, created_at) FROM stdin;
\.


--
-- Name: account_lockouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.account_lockouts_id_seq', 1, false);


--
-- Name: admin_action_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_action_logs_id_seq', 1, false);


--
-- Name: admin_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_sessions_id_seq', 1, false);


--
-- Name: admin_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_users_id_seq', 652, true);


--
-- Name: ai_call_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_call_log_id_seq', 1, false);


--
-- Name: ai_generated_scenes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_generated_scenes_id_seq', 1, false);


--
-- Name: ai_provider_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_provider_audit_log_id_seq', 1, false);


--
-- Name: ai_provider_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_provider_configs_id_seq', 1, false);


--
-- Name: ai_providers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_providers_id_seq', 5047, true);


--
-- Name: ai_scene_favorites_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_scene_favorites_id_seq', 1, false);


--
-- Name: config_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.config_audit_log_id_seq', 1, false);


--
-- Name: gallery_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gallery_configs_id_seq', 1, false);


--
-- Name: gallery_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gallery_items_id_seq', 1, false);


--
-- Name: game_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.game_config_id_seq', 575, true);


--
-- Name: generated_buildings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.generated_buildings_id_seq', 1, false);


--
-- Name: geometry_buildings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.geometry_buildings_id_seq', 1, false);


--
-- Name: login_attempts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.login_attempts_id_seq', 1, false);


--
-- Name: maintenance_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.maintenance_logs_id_seq', 1, false);


--
-- Name: model_tags_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.model_tags_id_seq', 27911, true);


--
-- Name: part_libraries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.part_libraries_id_seq', 1, false);


--
-- Name: part_library_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.part_library_items_id_seq', 1, false);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_reset_tokens_id_seq', 1, false);


--
-- Name: scene_3dgs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.scene_3dgs_id_seq', 1, true);


--
-- Name: security_questions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.security_questions_id_seq', 1, false);


--
-- Name: system_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.system_config_id_seq', 5838, true);


--
-- Name: teleport_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.teleport_history_id_seq', 1, false);


--
-- Name: terrains_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.terrains_id_seq', 1, false);


--
-- Name: threejs_code_blocks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.threejs_code_blocks_id_seq', 1, false);


--
-- Name: ui_controls_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ui_controls_id_seq', 19732, true);


--
-- Name: uploaded_models_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.uploaded_models_id_seq', 1, false);


--
-- Name: visitor_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.visitor_sessions_id_seq', 1, false);


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.wallet_transactions_id_seq', 84, true);


--
-- Name: world_activity_participants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_activity_participants_id_seq', 56, true);


--
-- Name: world_ai_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_ai_configs_id_seq', 1, false);


--
-- Name: world_chat_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_chat_log_id_seq', 1, false);


--
-- Name: world_entity_parts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_entity_parts_id_seq', 1, false);


--
-- Name: world_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_events_id_seq', 1, false);


--
-- Name: world_events_seq_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_events_seq_seq', 25267, true);


--
-- Name: world_memories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_memories_id_seq', 1, false);


--
-- Name: world_objects_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_objects_id_seq', 1, false);


--
-- Name: world_sky_presets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_sky_presets_id_seq', 1, false);


--
-- Name: world_task_progress_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_task_progress_id_seq', 1, false);


--
-- Name: world_tool_executions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_tool_executions_id_seq', 1, false);


--
-- Name: world_weather_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_weather_id_seq', 1, false);


--
-- Name: account_lockouts account_lockouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_lockouts
    ADD CONSTRAINT account_lockouts_pkey PRIMARY KEY (id);


--
-- Name: ad_slots ad_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_slots
    ADD CONSTRAINT ad_slots_pkey PRIMARY KEY (id);


--
-- Name: admin_action_logs admin_action_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs
    ADD CONSTRAINT admin_action_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_sessions admin_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_username_key UNIQUE (username);


--
-- Name: agent_api_keys agent_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_api_keys
    ADD CONSTRAINT agent_api_keys_pkey PRIMARY KEY (id);


--
-- Name: agent_sessions agent_sessions_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_jti_key UNIQUE (jti);


--
-- Name: agent_sessions agent_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_pkey PRIMARY KEY (id);


--
-- Name: agent_transient_sessions agent_transient_sessions_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_transient_sessions
    ADD CONSTRAINT agent_transient_sessions_jti_key UNIQUE (jti);


--
-- Name: agent_transient_sessions agent_transient_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_transient_sessions
    ADD CONSTRAINT agent_transient_sessions_pkey PRIMARY KEY (id);


--
-- Name: agents agents_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_name_key UNIQUE (name);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: ai_call_log ai_call_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_log
    ADD CONSTRAINT ai_call_log_pkey PRIMARY KEY (id);


--
-- Name: ai_generated_scenes ai_generated_scenes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generated_scenes
    ADD CONSTRAINT ai_generated_scenes_pkey PRIMARY KEY (id);


--
-- Name: ai_provider_audit_log ai_provider_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_audit_log
    ADD CONSTRAINT ai_provider_audit_log_pkey PRIMARY KEY (id);


--
-- Name: ai_provider_configs ai_provider_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs
    ADD CONSTRAINT ai_provider_configs_pkey PRIMARY KEY (id);


--
-- Name: ai_provider_configs ai_provider_configs_provider_id_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs
    ADD CONSTRAINT ai_provider_configs_provider_id_config_key_key UNIQUE (provider_id, config_key);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_provider_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_provider_name_key UNIQUE (provider_name);


--
-- Name: ai_scene_favorites ai_scene_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scene_favorites
    ADD CONSTRAINT ai_scene_favorites_pkey PRIMARY KEY (id);


--
-- Name: ai_scene_favorites ai_scene_favorites_scene_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scene_favorites
    ADD CONSTRAINT ai_scene_favorites_scene_id_user_id_key UNIQUE (scene_id, user_id);


--
-- Name: animation_library animation_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animation_library
    ADD CONSTRAINT animation_library_pkey PRIMARY KEY (id);


--
-- Name: bone_mappings bone_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bone_mappings
    ADD CONSTRAINT bone_mappings_pkey PRIMARY KEY (id);


--
-- Name: bone_mappings bone_mappings_template_id_source_bone_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bone_mappings
    ADD CONSTRAINT bone_mappings_template_id_source_bone_name_key UNIQUE (template_id, source_bone_name);


--
-- Name: buildings buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_pkey PRIMARY KEY (id);


--
-- Name: character_appearance character_appearance_character_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_appearance
    ADD CONSTRAINT character_appearance_character_id_key UNIQUE (character_id);


--
-- Name: character_appearance character_appearance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_appearance
    ADD CONSTRAINT character_appearance_pkey PRIMARY KEY (id);


--
-- Name: character_templates character_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_templates
    ADD CONSTRAINT character_templates_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: config_audit_log config_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_audit_log
    ADD CONSTRAINT config_audit_log_pkey PRIMARY KEY (id);


--
-- Name: custom_npcs custom_npcs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_npcs
    ADD CONSTRAINT custom_npcs_pkey PRIMARY KEY (id);


--
-- Name: equipment equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_pkey PRIMARY KEY (id);


--
-- Name: federation_templates federation_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federation_templates
    ADD CONSTRAINT federation_templates_pkey PRIMARY KEY (id);


--
-- Name: federation_templates federation_templates_user_id_source_world_id_source_templat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federation_templates
    ADD CONSTRAINT federation_templates_user_id_source_world_id_source_templat_key UNIQUE (user_id, source_world_id, source_template_id);


--
-- Name: gallery_configs gallery_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_configs
    ADD CONSTRAINT gallery_configs_pkey PRIMARY KEY (id);


--
-- Name: gallery_items gallery_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_pkey PRIMARY KEY (id);


--
-- Name: game_config game_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_config
    ADD CONSTRAINT game_config_config_key_key UNIQUE (config_key);


--
-- Name: game_config game_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_config
    ADD CONSTRAINT game_config_pkey PRIMARY KEY (id);


--
-- Name: generated_buildings generated_buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_buildings
    ADD CONSTRAINT generated_buildings_pkey PRIMARY KEY (id);


--
-- Name: generated_buildings generated_buildings_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_buildings
    ADD CONSTRAINT generated_buildings_task_id_key UNIQUE (task_id);


--
-- Name: geometry_buildings geometry_buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geometry_buildings
    ADD CONSTRAINT geometry_buildings_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: maintenance_logs maintenance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_pkey PRIMARY KEY (id);


--
-- Name: model_bounds model_bounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_bounds
    ADD CONSTRAINT model_bounds_pkey PRIMARY KEY (path);


--
-- Name: model_tags model_tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags
    ADD CONSTRAINT model_tags_name_key UNIQUE (name);


--
-- Name: model_tags model_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags
    ADD CONSTRAINT model_tags_pkey PRIMARY KEY (id);


--
-- Name: monster_drops monster_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monster_drops
    ADD CONSTRAINT monster_drops_pkey PRIMARY KEY (id);


--
-- Name: monsters monsters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monsters
    ADD CONSTRAINT monsters_pkey PRIMARY KEY (id);


--
-- Name: npc_chat_history npc_chat_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.npc_chat_history
    ADD CONSTRAINT npc_chat_history_pkey PRIMARY KEY (id);


--
-- Name: npcs npcs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.npcs
    ADD CONSTRAINT npcs_pkey PRIMARY KEY (id);


--
-- Name: object_transform_overrides object_transform_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_transform_overrides
    ADD CONSTRAINT object_transform_overrides_pkey PRIMARY KEY (object_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: part_libraries part_libraries_pack_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_libraries
    ADD CONSTRAINT part_libraries_pack_key_key UNIQUE (pack_key);


--
-- Name: part_libraries part_libraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_libraries
    ADD CONSTRAINT part_libraries_pkey PRIMARY KEY (id);


--
-- Name: part_library_items part_library_items_library_id_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_library_items
    ADD CONSTRAINT part_library_items_library_id_model_id_key UNIQUE (library_id, model_id);


--
-- Name: part_library_items part_library_items_library_id_part_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_library_items
    ADD CONSTRAINT part_library_items_library_id_part_key_key UNIQUE (library_id, part_key);


--
-- Name: part_library_items part_library_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_library_items
    ADD CONSTRAINT part_library_items_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: pending_trust_requests pending_trust_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_trust_requests
    ADD CONSTRAINT pending_trust_requests_pkey PRIMARY KEY (id);


--
-- Name: pending_trust_requests pending_trust_requests_world_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_trust_requests
    ADD CONSTRAINT pending_trust_requests_world_id_key UNIQUE (world_id);


--
-- Name: player_inventory player_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_inventory
    ADD CONSTRAINT player_inventory_pkey PRIMARY KEY (id);


--
-- Name: player_inventory player_inventory_user_id_code_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_inventory
    ADD CONSTRAINT player_inventory_user_id_code_id_key UNIQUE (user_id, code_id);


--
-- Name: plots plots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plots
    ADD CONSTRAINT plots_pkey PRIMARY KEY (id);


--
-- Name: portal_logs portal_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_logs
    ADD CONSTRAINT portal_logs_pkey PRIMARY KEY (id);


--
-- Name: portals portals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portals
    ADD CONSTRAINT portals_pkey PRIMARY KEY (id);


--
-- Name: resource_references resource_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_references
    ADD CONSTRAINT resource_references_pkey PRIMARY KEY (id);


--
-- Name: resource_references resource_references_template_id_resource_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_references
    ADD CONSTRAINT resource_references_template_id_resource_type_key UNIQUE (template_id, resource_type);


--
-- Name: reward_codes reward_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_codes
    ADD CONSTRAINT reward_codes_pkey PRIMARY KEY (id);


--
-- Name: reward_pools reward_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_pools
    ADD CONSTRAINT reward_pools_pkey PRIMARY KEY (id);


--
-- Name: scene_3dgs scene_3dgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_3dgs
    ADD CONSTRAINT scene_3dgs_pkey PRIMARY KEY (id);


--
-- Name: security_questions security_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_questions
    ADD CONSTRAINT security_questions_pkey PRIMARY KEY (id);


--
-- Name: security_questions security_questions_question_text_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_questions
    ADD CONSTRAINT security_questions_question_text_key UNIQUE (question_text);


--
-- Name: shop_items shop_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_items
    ADD CONSTRAINT shop_items_pkey PRIMARY KEY (id);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_config_key_key UNIQUE (config_key);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (id);


--
-- Name: teleport_history teleport_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teleport_history
    ADD CONSTRAINT teleport_history_pkey PRIMARY KEY (id);


--
-- Name: template_skills template_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_skills
    ADD CONSTRAINT template_skills_pkey PRIMARY KEY (id);


--
-- Name: terrains terrains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terrains
    ADD CONSTRAINT terrains_pkey PRIMARY KEY (id);


--
-- Name: threejs_code_blocks threejs_code_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threejs_code_blocks
    ADD CONSTRAINT threejs_code_blocks_pkey PRIMARY KEY (id);


--
-- Name: token_usage token_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_usage
    ADD CONSTRAINT token_usage_pkey PRIMARY KEY (nonce);


--
-- Name: trusted_worlds trusted_worlds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_worlds
    ADD CONSTRAINT trusted_worlds_pkey PRIMARY KEY (world_id);


--
-- Name: ui_controls ui_controls_control_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_controls
    ADD CONSTRAINT ui_controls_control_id_key UNIQUE (control_id);


--
-- Name: ui_controls ui_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_controls
    ADD CONSTRAINT ui_controls_pkey PRIMARY KEY (id);


--
-- Name: uploaded_models uploaded_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_models
    ADD CONSTRAINT uploaded_models_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions uq_wallet_tx_idem; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT uq_wallet_tx_idem UNIQUE (idempotency_key);


--
-- Name: world_activity_participants uq_world_activity_participant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_activity_participants
    ADD CONSTRAINT uq_world_activity_participant UNIQUE (activity_id, actor_id);


--
-- Name: world_entities uq_world_entities_spec; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entities
    ADD CONSTRAINT uq_world_entities_spec UNIQUE (world_id, spec_hash);


--
-- Name: world_entity_parts uq_world_entity_parts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entity_parts
    ADD CONSTRAINT uq_world_entity_parts UNIQUE (entity_id, part_key);


--
-- Name: world_interactions uq_world_interactions_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_interactions
    ADD CONSTRAINT uq_world_interactions_key UNIQUE (world_id, interaction_type, key);


--
-- Name: world_reward_grants uq_world_reward_grants; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_reward_grants
    ADD CONSTRAINT uq_world_reward_grants UNIQUE (actor_type, actor_id, interaction_key);


--
-- Name: world_task_progress uq_world_task_progress_actor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_task_progress
    ADD CONSTRAINT uq_world_task_progress_actor UNIQUE (task_id, actor_id);


--
-- Name: user_subscriptions user_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: visitor_sessions visitor_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_sessions
    ADD CONSTRAINT visitor_sessions_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (owner_type, owner_id, currency);


--
-- Name: weapon_skills weapon_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weapon_skills
    ADD CONSTRAINT weapon_skills_pkey PRIMARY KEY (id);


--
-- Name: weapons weapons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weapons
    ADD CONSTRAINT weapons_pkey PRIMARY KEY (id);


--
-- Name: world_activities world_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_activities
    ADD CONSTRAINT world_activities_pkey PRIMARY KEY (id);


--
-- Name: world_activity_participants world_activity_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_activity_participants
    ADD CONSTRAINT world_activity_participants_pkey PRIMARY KEY (id);


--
-- Name: world_ai_configs world_ai_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_ai_configs
    ADD CONSTRAINT world_ai_configs_pkey PRIMARY KEY (id);


--
-- Name: world_ai_configs world_ai_configs_world_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_ai_configs
    ADD CONSTRAINT world_ai_configs_world_id_key UNIQUE (world_id);


--
-- Name: world_ai_credentials world_ai_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_ai_credentials
    ADD CONSTRAINT world_ai_credentials_pkey PRIMARY KEY (id);


--
-- Name: world_ai_experiments world_ai_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_ai_experiments
    ADD CONSTRAINT world_ai_experiments_pkey PRIMARY KEY (id);


--
-- Name: world_approvals world_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_approvals
    ADD CONSTRAINT world_approvals_pkey PRIMARY KEY (id);


--
-- Name: world_build_missions world_build_missions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_build_missions
    ADD CONSTRAINT world_build_missions_pkey PRIMARY KEY (id);


--
-- Name: world_chat_log world_chat_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_chat_log
    ADD CONSTRAINT world_chat_log_pkey PRIMARY KEY (id);


--
-- Name: world_config world_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_config
    ADD CONSTRAINT world_config_pkey PRIMARY KEY (key);


--
-- Name: world_drops world_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_drops
    ADD CONSTRAINT world_drops_pkey PRIMARY KEY (id);


--
-- Name: world_entities world_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entities
    ADD CONSTRAINT world_entities_pkey PRIMARY KEY (id);


--
-- Name: world_entity_parts world_entity_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entity_parts
    ADD CONSTRAINT world_entity_parts_pkey PRIMARY KEY (id);


--
-- Name: world_events world_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_events
    ADD CONSTRAINT world_events_pkey PRIMARY KEY (id);


--
-- Name: world_gen3d_jobs world_gen3d_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_gen3d_jobs
    ADD CONSTRAINT world_gen3d_jobs_pkey PRIMARY KEY (id);


--
-- Name: world_goals world_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_goals
    ADD CONSTRAINT world_goals_pkey PRIMARY KEY (id);


--
-- Name: world_interactions world_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_interactions
    ADD CONSTRAINT world_interactions_pkey PRIMARY KEY (id);


--
-- Name: world_memories world_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_memories
    ADD CONSTRAINT world_memories_pkey PRIMARY KEY (id);


--
-- Name: world_metrics_daily world_metrics_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_metrics_daily
    ADD CONSTRAINT world_metrics_daily_pkey PRIMARY KEY (day, world_id, region_id, metric_key);


--
-- Name: world_missions world_missions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_missions
    ADD CONSTRAINT world_missions_pkey PRIMARY KEY (id);


--
-- Name: world_object_groups world_object_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_object_groups
    ADD CONSTRAINT world_object_groups_pkey PRIMARY KEY (id);


--
-- Name: world_objects world_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_pkey PRIMARY KEY (id);


--
-- Name: world_plan_steps world_plan_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plan_steps
    ADD CONSTRAINT world_plan_steps_pkey PRIMARY KEY (id);


--
-- Name: world_plans world_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plans
    ADD CONSTRAINT world_plans_pkey PRIMARY KEY (id);


--
-- Name: world_plans world_plans_world_id_goal_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plans
    ADD CONSTRAINT world_plans_world_id_goal_id_version_key UNIQUE (world_id, goal_id, version);


--
-- Name: world_regions world_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_regions
    ADD CONSTRAINT world_regions_pkey PRIMARY KEY (id);


--
-- Name: world_regions world_regions_region_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_regions
    ADD CONSTRAINT world_regions_region_key_key UNIQUE (region_key);


--
-- Name: world_reward_grants world_reward_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_reward_grants
    ADD CONSTRAINT world_reward_grants_pkey PRIMARY KEY (id);


--
-- Name: world_rules world_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_rules
    ADD CONSTRAINT world_rules_pkey PRIMARY KEY (id);


--
-- Name: world_sfx_jobs world_sfx_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_sfx_jobs
    ADD CONSTRAINT world_sfx_jobs_pkey PRIMARY KEY (id);


--
-- Name: world_sky_presets world_sky_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_sky_presets
    ADD CONSTRAINT world_sky_presets_pkey PRIMARY KEY (id);


--
-- Name: world_task_progress world_task_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_task_progress
    ADD CONSTRAINT world_task_progress_pkey PRIMARY KEY (id);


--
-- Name: world_tasks world_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_tasks
    ADD CONSTRAINT world_tasks_pkey PRIMARY KEY (id);


--
-- Name: world_tool_executions world_tool_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_tool_executions
    ADD CONSTRAINT world_tool_executions_pkey PRIMARY KEY (id);


--
-- Name: world_weather world_weather_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_weather
    ADD CONSTRAINT world_weather_pkey PRIMARY KEY (id);


--
-- Name: idx_account_lockouts_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_lockouts_username ON public.account_lockouts USING btree (username, unlock_at);


--
-- Name: idx_ad_slots_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_slots_active ON public.ad_slots USING btree (is_active);


--
-- Name: idx_ad_slots_portal_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_slots_portal_type ON public.ad_slots USING btree (portal_type);


--
-- Name: idx_ad_slots_rent_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_slots_rent_end ON public.ad_slots USING btree (rent_end);


--
-- Name: idx_ad_slots_target_world_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_slots_target_world_id ON public.ad_slots USING btree (target_world_id);


--
-- Name: idx_admin_action_logs_admin_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_action_logs_admin_user_id ON public.admin_action_logs USING btree (admin_user_id);


--
-- Name: idx_admin_action_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_action_logs_created_at ON public.admin_action_logs USING btree (created_at);


--
-- Name: idx_admin_sessions_admin_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_sessions_admin_user_id ON public.admin_sessions USING btree (admin_user_id);


--
-- Name: idx_admin_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_sessions_expires_at ON public.admin_sessions USING btree (expires_at);


--
-- Name: idx_admin_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_users_username ON public.admin_users USING btree (username);


--
-- Name: idx_agent_api_keys_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_api_keys_agent ON public.agent_api_keys USING btree (agent_id);


--
-- Name: idx_agent_api_keys_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_api_keys_prefix ON public.agent_api_keys USING btree (key_prefix);


--
-- Name: idx_agent_sessions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_sessions_agent ON public.agent_sessions USING btree (agent_id);


--
-- Name: idx_agent_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_sessions_expires ON public.agent_sessions USING btree (expires_at);


--
-- Name: idx_agent_transient_sessions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_transient_sessions_agent ON public.agent_transient_sessions USING btree (agent_id);


--
-- Name: idx_agent_transient_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_transient_sessions_expires ON public.agent_transient_sessions USING btree (expires_at);


--
-- Name: idx_agent_transient_sessions_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_transient_sessions_jti ON public.agent_transient_sessions USING btree (jti);


--
-- Name: idx_ai_call_log_fail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_fail ON public.ai_call_log USING btree (created_at DESC) WHERE (ok = false);


--
-- Name: idx_ai_call_log_mission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_mission ON public.ai_call_log USING btree (mission_id);


--
-- Name: idx_ai_call_log_provider_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_provider_time ON public.ai_call_log USING btree (provider_id, created_at DESC);


--
-- Name: idx_ai_call_log_purpose_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_purpose_time ON public.ai_call_log USING btree (purpose, created_at DESC);


--
-- Name: idx_ai_call_log_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_region ON public.ai_call_log USING btree (region_key);


--
-- Name: idx_ai_provider_audit_log_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_provider_audit_log_provider ON public.ai_provider_audit_log USING btree (provider_id);


--
-- Name: idx_ai_provider_audit_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_provider_audit_log_time ON public.ai_provider_audit_log USING btree (changed_at DESC);


--
-- Name: idx_ai_provider_configs_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_provider_configs_provider ON public.ai_provider_configs USING btree (provider_id);


--
-- Name: idx_ai_providers_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_providers_enabled ON public.ai_providers USING btree (is_enabled);


--
-- Name: idx_ai_providers_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_providers_type ON public.ai_providers USING btree (provider_type);


--
-- Name: idx_ai_scene_favorites_scene_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scene_favorites_scene_id ON public.ai_scene_favorites USING btree (scene_id);


--
-- Name: idx_ai_scene_favorites_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scene_favorites_user_id ON public.ai_scene_favorites USING btree (user_id);


--
-- Name: idx_ai_scenes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scenes_created_at ON public.ai_generated_scenes USING btree (created_at);


--
-- Name: idx_ai_scenes_is_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scenes_is_public ON public.ai_generated_scenes USING btree (is_public);


--
-- Name: idx_ai_scenes_scene_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scenes_scene_type ON public.ai_generated_scenes USING btree (scene_type);


--
-- Name: idx_ai_scenes_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scenes_tags ON public.ai_generated_scenes USING gin (tags);


--
-- Name: idx_ai_scenes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_scenes_user_id ON public.ai_generated_scenes USING btree (user_id);


--
-- Name: idx_bone_mappings_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bone_mappings_source ON public.bone_mappings USING btree (template_id, source_bone_name);


--
-- Name: idx_bone_mappings_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bone_mappings_template ON public.bone_mappings USING btree (template_id);


--
-- Name: idx_buildings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_category ON public.buildings USING btree (category);


--
-- Name: idx_buildings_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_tags ON public.buildings USING gin (tags);


--
-- Name: idx_character_templates_federated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_character_templates_federated ON public.character_templates USING btree (is_federated);


--
-- Name: idx_character_templates_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_character_templates_source ON public.character_templates USING btree (source_world_id, source_template_id);


--
-- Name: idx_characters_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_user_id ON public.characters USING btree (user_id);


--
-- Name: idx_config_audit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_config_audit_key ON public.config_audit_log USING btree (config_key);


--
-- Name: idx_config_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_config_audit_time ON public.config_audit_log USING btree (changed_at DESC);


--
-- Name: idx_custom_npcs_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_npcs_created_by ON public.custom_npcs USING btree (created_by);


--
-- Name: idx_federation_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_federation_templates_active ON public.federation_templates USING btree (is_active);


--
-- Name: idx_federation_templates_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_federation_templates_category ON public.federation_templates USING btree (category);


--
-- Name: idx_federation_templates_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_federation_templates_source ON public.federation_templates USING btree (source_world_id, source_template_id);


--
-- Name: idx_federation_templates_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_federation_templates_user ON public.federation_templates USING btree (user_id);


--
-- Name: idx_gallery_items_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_items_config ON public.gallery_items USING btree (config_id);


--
-- Name: idx_gallery_items_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_items_position ON public.gallery_items USING btree (config_id, pos_z);


--
-- Name: idx_gallery_items_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_items_sort ON public.gallery_items USING btree (sort_order);


--
-- Name: idx_game_config_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_config_key ON public.game_config USING btree (config_key);


--
-- Name: idx_gen3d_jobs_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gen3d_jobs_idem ON public.world_gen3d_jobs USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_gen3d_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gen3d_jobs_status ON public.world_gen3d_jobs USING btree (status, updated_at DESC);


--
-- Name: idx_gen3d_jobs_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gen3d_jobs_world ON public.world_gen3d_jobs USING btree (world_id, created_at DESC);


--
-- Name: idx_generated_buildings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_buildings_status ON public.generated_buildings USING btree (status);


--
-- Name: idx_generated_buildings_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_buildings_tags ON public.generated_buildings USING gin (tags);


--
-- Name: idx_generated_buildings_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_buildings_task_id ON public.generated_buildings USING btree (task_id);


--
-- Name: idx_generated_buildings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_buildings_user_id ON public.generated_buildings USING btree (user_id);


--
-- Name: idx_geometry_buildings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geometry_buildings_created_at ON public.geometry_buildings USING btree (created_at);


--
-- Name: idx_geometry_buildings_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geometry_buildings_tags ON public.geometry_buildings USING gin (tags);


--
-- Name: idx_geometry_buildings_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geometry_buildings_template_id ON public.geometry_buildings USING btree (template_id);


--
-- Name: idx_geometry_buildings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geometry_buildings_user_id ON public.geometry_buildings USING btree (user_id);


--
-- Name: idx_geometry_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geometry_category ON public.geometry_buildings USING btree (category);


--
-- Name: idx_geometry_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geometry_tags ON public.geometry_buildings USING gin (tags);


--
-- Name: idx_login_attempts_ip_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_ip_created ON public.login_attempts USING btree (ip_address, created_at);


--
-- Name: idx_login_attempts_username_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_username_created ON public.login_attempts USING btree (username, created_at);


--
-- Name: idx_ml_script_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ml_script_id ON public.maintenance_logs USING btree (script_id);


--
-- Name: idx_ml_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ml_started_at ON public.maintenance_logs USING btree (started_at DESC);


--
-- Name: idx_ml_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ml_status ON public.maintenance_logs USING btree (status);


--
-- Name: idx_model_bounds_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_bounds_updated ON public.model_bounds USING btree (updated_at);


--
-- Name: idx_model_tags_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_tags_category ON public.model_tags USING btree (category);


--
-- Name: idx_model_tags_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_tags_name ON public.model_tags USING btree (name);


--
-- Name: idx_monsters_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monsters_active ON public.monsters USING btree (is_active);


--
-- Name: idx_npc_chat_npc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_npc_chat_npc ON public.npc_chat_history USING btree (npc_id, player_id, created_at);


--
-- Name: idx_npcs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_npcs_active ON public.npcs USING btree (is_active);


--
-- Name: idx_orders_buyer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer_id ON public.orders USING btree (buyer_id);


--
-- Name: idx_part_items_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_items_library ON public.part_library_items USING btree (library_id);


--
-- Name: idx_part_items_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_items_model ON public.part_library_items USING btree (model_id);


--
-- Name: idx_part_items_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_items_role ON public.part_library_items USING btree (part_role);


--
-- Name: idx_part_items_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_items_tags ON public.part_library_items USING gin (tags);


--
-- Name: idx_part_libraries_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_libraries_deleted ON public.part_libraries USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_part_libraries_source_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_libraries_source_path ON public.part_libraries USING btree (source_path) WHERE (source_path IS NOT NULL);


--
-- Name: idx_part_libraries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_libraries_status ON public.part_libraries USING btree (status);


--
-- Name: idx_part_libraries_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_libraries_world ON public.part_libraries USING btree (world_id);


--
-- Name: idx_password_reset_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_user ON public.password_reset_tokens USING btree (user_id, used);


--
-- Name: idx_pending_trust_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_trust_status ON public.pending_trust_requests USING btree (status);


--
-- Name: idx_pending_trust_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_trust_world ON public.pending_trust_requests USING btree (world_id);


--
-- Name: idx_pending_trust_world_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_trust_world_id ON public.pending_trust_requests USING btree (world_id);


--
-- Name: idx_player_inventory_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_inventory_unread ON public.player_inventory USING btree (user_id, is_used);


--
-- Name: idx_player_inventory_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_inventory_user ON public.player_inventory USING btree (user_id);


--
-- Name: idx_plots_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plots_owner_id ON public.plots USING btree (owner_id);


--
-- Name: idx_portal_logs_character; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_logs_character ON public.portal_logs USING btree (character_id);


--
-- Name: idx_portals_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portals_active ON public.portals USING btree (is_active);


--
-- Name: idx_resource_references_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_references_template ON public.resource_references USING btree (template_id);


--
-- Name: idx_resource_references_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_references_type ON public.resource_references USING btree (resource_type);


--
-- Name: idx_reward_codes_claimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_codes_claimed ON public.reward_codes USING btree (is_claimed);


--
-- Name: idx_reward_codes_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_codes_pool ON public.reward_codes USING btree (pool_id);


--
-- Name: idx_scene_3dgs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scene_3dgs_created_at ON public.scene_3dgs USING btree (created_at DESC);


--
-- Name: idx_scene_3dgs_is_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scene_3dgs_is_public ON public.scene_3dgs USING btree (is_public);


--
-- Name: idx_scene_3dgs_scene_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scene_3dgs_scene_type ON public.scene_3dgs USING btree (scene_type);


--
-- Name: idx_scene_3dgs_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scene_3dgs_source_type ON public.scene_3dgs USING btree (source_type);


--
-- Name: idx_security_questions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_questions_active ON public.security_questions USING btree (is_active);


--
-- Name: idx_sfx_jobs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfx_jobs_created ON public.world_sfx_jobs USING btree (created_at DESC);


--
-- Name: idx_sfx_jobs_imported; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfx_jobs_imported ON public.world_sfx_jobs USING btree (imported, created_at DESC);


--
-- Name: idx_sfx_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfx_jobs_status ON public.world_sfx_jobs USING btree (status, updated_at DESC);


--
-- Name: idx_shops_merchant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shops_merchant_id ON public.shops USING btree (merchant_id);


--
-- Name: idx_system_config_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_config_key ON public.system_config USING btree (config_key);


--
-- Name: idx_teleport_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teleport_history_created ON public.teleport_history USING btree (created_at);


--
-- Name: idx_teleport_history_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teleport_history_time ON public.teleport_history USING btree (created_at DESC);


--
-- Name: idx_teleport_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teleport_history_user ON public.teleport_history USING btree (user_id);


--
-- Name: idx_threejs_blocks_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threejs_blocks_tags ON public.threejs_code_blocks USING gin (tags);


--
-- Name: idx_token_usage_used_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_usage_used_at ON public.token_usage USING btree (used_at);


--
-- Name: idx_trusted_worlds_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_worlds_enabled ON public.trusted_worlds USING btree (enabled);


--
-- Name: idx_trusted_worlds_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_worlds_endpoint ON public.trusted_worlds USING btree (endpoint_key);


--
-- Name: idx_trusted_worlds_is_central; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_worlds_is_central ON public.trusted_worlds USING btree (is_central);


--
-- Name: idx_ui_controls_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ui_controls_category ON public.ui_controls USING btree (category);


--
-- Name: idx_ui_controls_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ui_controls_type ON public.ui_controls USING btree (control_type);


--
-- Name: idx_ui_controls_visible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ui_controls_visible ON public.ui_controls USING btree (is_visible);


--
-- Name: idx_uploaded_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_category ON public.uploaded_models USING btree (category);


--
-- Name: idx_uploaded_models_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_models_created_at ON public.uploaded_models USING btree (created_at);


--
-- Name: idx_uploaded_models_display_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_models_display_name ON public.uploaded_models USING btree (display_name);


--
-- Name: idx_uploaded_models_file_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_models_file_type ON public.uploaded_models USING btree (file_type);


--
-- Name: idx_uploaded_models_pack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_models_pack ON public.uploaded_models USING btree (pack_id);


--
-- Name: idx_uploaded_models_part; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_models_part ON public.uploaded_models USING btree (part_category);


--
-- Name: idx_uploaded_models_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_models_tags ON public.uploaded_models USING gin (tags);


--
-- Name: idx_uploaded_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploaded_tags ON public.uploaded_models USING gin (tags);


--
-- Name: idx_user_subscriptions_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_expire ON public.user_subscriptions USING btree (expires_at);


--
-- Name: idx_user_subscriptions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_expires ON public.user_subscriptions USING btree (expires_at);


--
-- Name: idx_user_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_user ON public.user_subscriptions USING btree (user_id);


--
-- Name: idx_user_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_user_id ON public.user_subscriptions USING btree (user_id);


--
-- Name: idx_vs_entered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vs_entered ON public.visitor_sessions USING btree (entered_at DESC);


--
-- Name: idx_vs_key_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vs_key_recent ON public.visitor_sessions USING btree (session_key, last_seen_at DESC);


--
-- Name: idx_vs_left; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vs_left ON public.visitor_sessions USING btree (left_at) WHERE (left_at IS NOT NULL);


--
-- Name: idx_vs_type_entered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vs_type_entered ON public.visitor_sessions USING btree (visitor_type, entered_at DESC);


--
-- Name: idx_wallet_tx_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_tx_owner ON public.wallet_transactions USING btree (owner_type, owner_id, created_at);


--
-- Name: idx_wap_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wap_activity ON public.world_activity_participants USING btree (activity_id);


--
-- Name: idx_world_activities_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_activities_region ON public.world_activities USING btree (region_key);


--
-- Name: idx_world_activities_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_activities_status ON public.world_activities USING btree (status);


--
-- Name: idx_world_activities_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_activities_world ON public.world_activities USING btree (world_id);


--
-- Name: idx_world_ai_credentials_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_ai_credentials_prefix ON public.world_ai_credentials USING btree (key_prefix);


--
-- Name: idx_world_ai_credentials_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_ai_credentials_world ON public.world_ai_credentials USING btree (world_id);


--
-- Name: idx_world_ai_exp_cooldown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_ai_exp_cooldown ON public.world_ai_experiments USING btree (cooldown_until);


--
-- Name: idx_world_ai_exp_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_ai_exp_region ON public.world_ai_experiments USING btree (world_id, region_key, created_at DESC);


--
-- Name: idx_world_ai_exp_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_ai_exp_region_id ON public.world_ai_experiments USING btree (world_id, region_id, created_at DESC);


--
-- Name: idx_world_ai_exp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_ai_exp_status ON public.world_ai_experiments USING btree (world_id, status);


--
-- Name: idx_world_approvals_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_approvals_pending ON public.world_approvals USING btree (world_id, decision);


--
-- Name: idx_world_approvals_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_approvals_target ON public.world_approvals USING btree (target_type, target_id);


--
-- Name: idx_world_build_missions_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_build_missions_region ON public.world_build_missions USING btree (region_key);


--
-- Name: idx_world_build_missions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_build_missions_status ON public.world_build_missions USING btree (status);


--
-- Name: idx_world_build_missions_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_build_missions_world ON public.world_build_missions USING btree (world_id);


--
-- Name: idx_world_chat_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_chat_log_created_at ON public.world_chat_log USING btree (created_at DESC);


--
-- Name: idx_world_chat_log_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_chat_log_sender ON public.world_chat_log USING btree (sender_type, created_at DESC);


--
-- Name: idx_world_drops_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_drops_active ON public.world_drops USING btree (is_picked, expires_at);


--
-- Name: idx_world_entities_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_entities_region ON public.world_entities USING btree (region_key);


--
-- Name: idx_world_entities_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_entities_world ON public.world_entities USING btree (world_id);


--
-- Name: idx_world_entity_parts_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_entity_parts_entity ON public.world_entity_parts USING btree (entity_id);


--
-- Name: idx_world_entity_parts_object; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_entity_parts_object ON public.world_entity_parts USING btree (world_object_id);


--
-- Name: idx_world_events_region_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_events_region_time ON public.world_events USING btree (region_id, created_at DESC);


--
-- Name: idx_world_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_events_type_time ON public.world_events USING btree (type, created_at DESC);


--
-- Name: idx_world_events_world_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_events_world_time ON public.world_events USING btree (world_id, created_at DESC);


--
-- Name: idx_world_goals_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_goals_world ON public.world_goals USING btree (world_id);


--
-- Name: idx_world_interactions_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_interactions_region ON public.world_interactions USING btree (region_key);


--
-- Name: idx_world_interactions_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_interactions_world ON public.world_interactions USING btree (world_id);


--
-- Name: idx_world_memories_recall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_memories_recall ON public.world_memories USING btree (world_id, scope, kind, importance DESC);


--
-- Name: idx_world_metrics_daily_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_metrics_daily_world ON public.world_metrics_daily USING btree (world_id, day DESC);


--
-- Name: idx_world_missions_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_missions_world ON public.world_missions USING btree (world_id, status);


--
-- Name: idx_world_object_groups_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_object_groups_world ON public.world_object_groups USING btree (world_id);


--
-- Name: idx_world_objects_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_building_id ON public.world_objects USING btree (building_id);


--
-- Name: idx_world_objects_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_created_at ON public.world_objects USING btree (created_at DESC);


--
-- Name: idx_world_objects_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_entity ON public.world_objects USING btree (entity_id);


--
-- Name: idx_world_objects_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_group ON public.world_objects USING btree (group_id);


--
-- Name: idx_world_objects_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_origin ON public.world_objects USING btree (origin);


--
-- Name: idx_world_objects_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_pos ON public.world_objects USING btree (position_x, position_z);


--
-- Name: idx_world_objects_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_region ON public.world_objects USING btree (region_id);


--
-- Name: idx_world_objects_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_type ON public.world_objects USING btree (type);


--
-- Name: idx_world_objects_type_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_type_pos ON public.world_objects USING btree (type, position_x, position_z);


--
-- Name: idx_world_plan_steps_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_plan_steps_plan ON public.world_plan_steps USING btree (plan_id, status);


--
-- Name: idx_world_plans_world_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_plans_world_status ON public.world_plans USING btree (world_id, status);


--
-- Name: idx_world_regions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_regions_status ON public.world_regions USING btree (status);


--
-- Name: idx_world_regions_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_regions_world ON public.world_regions USING btree (world_id);


--
-- Name: idx_world_reward_grants_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_reward_grants_actor ON public.world_reward_grants USING btree (actor_type, actor_id);


--
-- Name: idx_world_reward_grants_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_reward_grants_region ON public.world_reward_grants USING btree (region_key);


--
-- Name: idx_world_task_progress_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_task_progress_actor ON public.world_task_progress USING btree (actor_type, actor_id, status);


--
-- Name: idx_world_tasks_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tasks_region ON public.world_tasks USING btree (region_key);


--
-- Name: idx_world_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tasks_status ON public.world_tasks USING btree (world_id, status, visibility);


--
-- Name: idx_world_tasks_world; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tasks_world ON public.world_tasks USING btree (world_id);


--
-- Name: idx_world_tool_exec_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tool_exec_plan ON public.world_tool_executions USING btree (plan_id);


--
-- Name: idx_world_tool_exec_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tool_exec_step ON public.world_tool_executions USING btree (plan_step_id);


--
-- Name: idx_world_tool_exec_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tool_exec_tool ON public.world_tool_executions USING btree (tool_name, status);


--
-- Name: idx_world_tool_exec_world_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_tool_exec_world_time ON public.world_tool_executions USING btree (world_id, created_at DESC);


--
-- Name: terrains_area_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX terrains_area_idx ON public.terrains USING btree (is_active, priority DESC);


--
-- Name: terrains_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX terrains_name_uq ON public.terrains USING btree (lower((name)::text));


--
-- Name: terrains_zone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX terrains_zone_idx ON public.terrains USING btree (zone_enabled, is_active);


--
-- Name: uq_part_libraries_packkey_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_part_libraries_packkey_lower ON public.part_libraries USING btree (lower((pack_key)::text));


--
-- Name: uq_trusted_worlds_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trusted_worlds_endpoint ON public.trusted_worlds USING btree (endpoint_key) WHERE (endpoint_key IS NOT NULL);


--
-- Name: uq_world_missions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_world_missions_active ON public.world_missions USING btree (world_id) WHERE ((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('running'::character varying)::text, ('paused'::character varying)::text, ('awaiting_review'::character varying)::text]));


--
-- Name: buildings trg_buildings_tags_usage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_buildings_tags_usage AFTER INSERT OR DELETE OR UPDATE OF tags ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.update_tag_usage_count();


--
-- Name: geometry_buildings trg_geometry_tags_usage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_geometry_tags_usage AFTER INSERT OR DELETE OR UPDATE OF tags ON public.geometry_buildings FOR EACH ROW EXECUTE FUNCTION public.update_tag_usage_count();


--
-- Name: scene_3dgs trg_scene_3dgs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scene_3dgs_updated_at BEFORE UPDATE ON public.scene_3dgs FOR EACH ROW EXECUTE FUNCTION public.update_scene_3dgs_updated_at();


--
-- Name: uploaded_models trg_uploaded_tags_usage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_uploaded_tags_usage AFTER INSERT OR DELETE OR UPDATE OF tags ON public.uploaded_models FOR EACH ROW EXECUTE FUNCTION public.update_tag_usage_count();


--
-- Name: ui_controls trigger_ui_controls_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_ui_controls_updated_at BEFORE UPDATE ON public.ui_controls FOR EACH ROW EXECUTE FUNCTION public.update_ui_controls_updated_at();


--
-- Name: ai_generated_scenes trigger_update_ai_scenes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_ai_scenes_updated_at BEFORE UPDATE ON public.ai_generated_scenes FOR EACH ROW EXECUTE FUNCTION public.update_ai_scenes_updated_at();


--
-- Name: admin_action_logs admin_action_logs_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_logs
    ADD CONSTRAINT admin_action_logs_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: admin_sessions admin_sessions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.admin_users(id) ON DELETE CASCADE;


--
-- Name: agent_api_keys agent_api_keys_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_api_keys
    ADD CONSTRAINT agent_api_keys_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_sessions agent_sessions_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: ai_provider_audit_log ai_provider_audit_log_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_audit_log
    ADD CONSTRAINT ai_provider_audit_log_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.ai_providers(id) ON DELETE CASCADE;


--
-- Name: ai_provider_configs ai_provider_configs_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs
    ADD CONSTRAINT ai_provider_configs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.ai_providers(id) ON DELETE CASCADE;


--
-- Name: ai_scene_favorites ai_scene_favorites_scene_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scene_favorites
    ADD CONSTRAINT ai_scene_favorites_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.ai_generated_scenes(id) ON DELETE CASCADE;


--
-- Name: buildings buildings_plot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_plot_id_fkey FOREIGN KEY (plot_id) REFERENCES public.plots(id) ON DELETE CASCADE;


--
-- Name: character_appearance character_appearance_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_appearance
    ADD CONSTRAINT character_appearance_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: character_templates character_templates_weapon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_templates
    ADD CONSTRAINT character_templates_weapon_id_fkey FOREIGN KEY (weapon_id) REFERENCES public.weapons(id) ON DELETE SET NULL;


--
-- Name: characters characters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: equipment equipment_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: federation_templates federation_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federation_templates
    ADD CONSTRAINT federation_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: world_interactions fk_world_interactions_entity; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_interactions
    ADD CONSTRAINT fk_world_interactions_entity FOREIGN KEY (entity_id) REFERENCES public.world_entities(id) ON DELETE CASCADE;


--
-- Name: gallery_items gallery_items_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.gallery_configs(id) ON DELETE CASCADE;


--
-- Name: model_tags model_tags_parent_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags
    ADD CONSTRAINT model_tags_parent_tag_id_fkey FOREIGN KEY (parent_tag_id) REFERENCES public.model_tags(id);


--
-- Name: npc_chat_history npc_chat_history_npc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.npc_chat_history
    ADD CONSTRAINT npc_chat_history_npc_id_fkey FOREIGN KEY (npc_id) REFERENCES public.npcs(id) ON DELETE CASCADE;


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_shop_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shop_item_id_fkey FOREIGN KEY (shop_item_id) REFERENCES public.shop_items(id);


--
-- Name: part_library_items part_library_items_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_library_items
    ADD CONSTRAINT part_library_items_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.part_libraries(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: player_inventory player_inventory_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_inventory
    ADD CONSTRAINT player_inventory_code_id_fkey FOREIGN KEY (code_id) REFERENCES public.reward_codes(id) ON DELETE CASCADE;


--
-- Name: player_inventory player_inventory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_inventory
    ADD CONSTRAINT player_inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: plots plots_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plots
    ADD CONSTRAINT plots_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: portal_logs portal_logs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_logs
    ADD CONSTRAINT portal_logs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: portal_logs portal_logs_portal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_logs
    ADD CONSTRAINT portal_logs_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE CASCADE;


--
-- Name: reward_codes reward_codes_claimed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_codes
    ADD CONSTRAINT reward_codes_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES public.users(id);


--
-- Name: reward_codes reward_codes_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_codes
    ADD CONSTRAINT reward_codes_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.reward_pools(id) ON DELETE CASCADE;


--
-- Name: shop_items shop_items_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_items
    ADD CONSTRAINT shop_items_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: shops shops_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: skills skills_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: teleport_history teleport_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teleport_history
    ADD CONSTRAINT teleport_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: template_skills template_skills_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_skills
    ADD CONSTRAINT template_skills_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.character_templates(id) ON DELETE CASCADE;


--
-- Name: ui_controls ui_controls_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_controls
    ADD CONSTRAINT ui_controls_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: ui_controls ui_controls_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_controls
    ADD CONSTRAINT ui_controls_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: users users_security_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_security_question_id_fkey FOREIGN KEY (security_question_id) REFERENCES public.security_questions(id);


--
-- Name: visitor_sessions visitor_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_sessions
    ADD CONSTRAINT visitor_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: weapon_skills weapon_skills_weapon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weapon_skills
    ADD CONSTRAINT weapon_skills_weapon_id_fkey FOREIGN KEY (weapon_id) REFERENCES public.weapons(id) ON DELETE CASCADE;


--
-- Name: world_activity_participants world_activity_participants_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_activity_participants
    ADD CONSTRAINT world_activity_participants_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.world_activities(id) ON DELETE CASCADE;


--
-- Name: world_approvals world_approvals_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_approvals
    ADD CONSTRAINT world_approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.admin_users(id);


--
-- Name: world_drops world_drops_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_drops
    ADD CONSTRAINT world_drops_code_id_fkey FOREIGN KEY (code_id) REFERENCES public.reward_codes(id) ON DELETE CASCADE;


--
-- Name: world_drops world_drops_monster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_drops
    ADD CONSTRAINT world_drops_monster_id_fkey FOREIGN KEY (monster_id) REFERENCES public.monsters(id) ON DELETE SET NULL;


--
-- Name: world_drops world_drops_picked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_drops
    ADD CONSTRAINT world_drops_picked_by_fkey FOREIGN KEY (picked_by) REFERENCES public.users(id);


--
-- Name: world_entity_parts world_entity_parts_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entity_parts
    ADD CONSTRAINT world_entity_parts_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.world_entities(id) ON DELETE CASCADE;


--
-- Name: world_entity_parts world_entity_parts_world_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_entity_parts
    ADD CONSTRAINT world_entity_parts_world_object_id_fkey FOREIGN KEY (world_object_id) REFERENCES public.world_objects(id) ON DELETE CASCADE;


--
-- Name: world_goals world_goals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_goals
    ADD CONSTRAINT world_goals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admin_users(id);


--
-- Name: world_interactions world_interactions_world_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_interactions
    ADD CONSTRAINT world_interactions_world_object_id_fkey FOREIGN KEY (world_object_id) REFERENCES public.world_objects(id) ON DELETE SET NULL;


--
-- Name: world_objects world_objects_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.generated_buildings(id) ON DELETE CASCADE;


--
-- Name: world_objects world_objects_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.world_object_groups(id) ON DELETE SET NULL;


--
-- Name: world_plan_steps world_plan_steps_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plan_steps
    ADD CONSTRAINT world_plan_steps_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.world_plans(id) ON DELETE CASCADE;


--
-- Name: world_plans world_plans_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plans
    ADD CONSTRAINT world_plans_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admin_users(id);


--
-- Name: world_plans world_plans_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plans
    ADD CONSTRAINT world_plans_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.world_goals(id);


--
-- Name: world_plans world_plans_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_plans
    ADD CONSTRAINT world_plans_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(id);


--
-- Name: world_reward_grants world_reward_grants_interaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_reward_grants
    ADD CONSTRAINT world_reward_grants_interaction_id_fkey FOREIGN KEY (interaction_id) REFERENCES public.world_interactions(id) ON DELETE SET NULL;


--
-- Name: world_task_progress world_task_progress_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_task_progress
    ADD CONSTRAINT world_task_progress_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.world_tasks(id) ON DELETE CASCADE;


--
-- Name: world_tasks world_tasks_region_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_tasks
    ADD CONSTRAINT world_tasks_region_ref_fkey FOREIGN KEY (region_ref) REFERENCES public.world_regions(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--


