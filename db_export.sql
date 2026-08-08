--
-- PostgreSQL database dump
--

\restrict 2nvumZRNFebaVbbhHh3wYfLftKPTJLAcifmt1mjecwgpDovuV1VGMBmupXWpweZ

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
    changed_by uuid,
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
    updated_by uuid,
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
    CONSTRAINT valid_status CHECK (((status)::text = ANY ((ARRAY['processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
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
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


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
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


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
    merchant_id uuid NOT NULL,
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
    is_central boolean DEFAULT false
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
    display_name character varying(255)
);


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
    default_effect character varying(30) DEFAULT 'none'::character varying
);


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
    custom_config jsonb
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
-- Name: world_objects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects ALTER COLUMN id SET DEFAULT nextval('public.world_objects_id_seq'::regclass);


--
-- Name: world_weather id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_weather ALTER COLUMN id SET DEFAULT nextval('public.world_weather_id_seq'::regclass);


--
-- Data for Name: account_lockouts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.account_lockouts (id, username, target_type, locked_by, reason, locked_at, unlock_at, unlocked_by, unlocked_at, ip_address) FROM stdin;
1	1221	user	auto	连续失败 5 次（阈值 5）自动锁定 30 分钟	2026-07-09 17:52:52.368623	2026-07-09 10:22:52.368	\N	\N	\N
\.


--
-- Data for Name: ad_slots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ad_slots (id, name, renter_name, "position", rotation, scale, model_url, trigger_type, target_url, target_world_url, target_world_name, rent_start, rent_end, is_active, created_at, updated_at, portal_type, target_world_id, deep_link) FROM stdin;
860d8fa5-3118-476f-b1cf-50ed0307fb85	淘宝网	阿里巴巴	{"x": -52.1, "y": 1, "z": -94.8}	{"x": 0, "y": 0, "z": 0}	{"x": 1, "y": 1, "z": 1}	\N	link	https://www.taobao.com/	\N	\N	2026-06-08 08:00:00	2099-10-29 19:11:00	t	2026-06-11 08:39:04.713784	2026-06-11 10:14:40.351549	link	\N	\N
\.


--
-- Data for Name: admin_action_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_action_logs (id, admin_user_id, action, resource, resource_id, details, ip_address, created_at) FROM stdin;
1	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-11 09:14:08.059344
2	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-11 09:55:57.181883
3	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-11 15:07:02.122533
4	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-11 15:43:21.445603
5	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-12 15:46:31.185982
6	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-13 17:01:02.059102
7	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-24 11:05:11.745552
8	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-25 14:58:51.813047
9	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-25 16:14:03.651966
10	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-26 16:52:02.664952
11	1	LOGIN	admin_users	1	管理员登录	::1	2026-02-27 17:22:56.934324
12	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-01 07:15:22.482734
13	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-02 08:57:36.373571
14	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-02 11:54:49.983936
15	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-03 09:33:10.549786
16	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-04 09:20:19.91035
17	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-04 10:40:00.033366
18	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-04 14:25:30.837296
19	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-05 10:42:26.669019
20	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-06 10:53:22.793156
21	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-07 10:55:17.507643
22	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-08 09:10:16.599778
23	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:15:23.285223
24	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:15:23.285523
25	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:15:38.469363
26	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:15:38.539999
27	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:15:52.972452
28	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:15:53.153157
29	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:19:00.218858
30	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:19:00.219473
31	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:19:24.885707
32	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:19:24.886106
33	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:23:38.295099
34	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:23:38.295689
35	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:35:59.349267
36	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:35:59.396595
37	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:43:58.640989
38	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:43:58.751592
39	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-08 09:45:20.819483
40	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:45:29.945257
41	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:45:29.949366
42	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-08 09:46:10.816935
43	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-08 09:53:08.991422
44	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:54:07.878921
45	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:54:07.879615
46	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:55:20.049597
47	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-08 09:55:20.050177
48	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-09 14:10:05.837801
50	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 14:47:28.537613
49	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 14:47:28.536952
51	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 15:47:51.723436
52	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 15:50:05.90423
53	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 15:51:16.352884
54	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 15:51:16.353374
55	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 15:53:08.889177
56	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-09 15:53:08.889664
57	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-10 15:46:25.57504
58	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 15:46:41.588253
59	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 15:46:41.629187
60	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 15:46:54.199586
61	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 15:46:54.293226
62	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 15:48:23.982572
63	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 15:48:23.983392
65	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:02:02.86569
64	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:02:02.866107
66	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:02:11.929542
67	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:02:11.930171
68	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:05.64358
69	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:05.748
70	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:17.125496
71	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:17.214417
72	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:25.497452
73	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:25.497961
74	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:30.344024
75	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:13:30.344362
76	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:14:04.281833
77	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:14:04.288076
451	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 16:40:04.691332
78	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:14:47.742478
79	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:14:47.748269
80	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:14:57.831294
81	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:14:57.90167
82	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:15:37.128995
83	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:15:37.132216
84	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:19:14.468011
85	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:19:14.56031
86	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:19:43.816986
87	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:19:43.83352
88	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:07.968325
89	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:08.034372
90	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:17.184797
91	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:17.18524
92	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:18.492677
93	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:18.493414
94	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:33.778863
95	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:33.843971
96	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:51.55803
97	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:23:51.657983
98	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:42:56.992061
99	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:42:56.992712
100	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:46:02.814313
101	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:46:02.815483
102	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:50:15.435752
103	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:50:15.436376
104	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:50:32.357991
105	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:50:32.363138
106	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:50:41.009902
107	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:50:41.010315
108	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:55:34.924796
109	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:55:34.989982
110	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:55:53.526323
111	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:55:53.595582
112	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:56:11.290948
113	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 16:56:11.473494
114	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:01:11.389093
115	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:01:11.389415
116	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:01:33.066868
117	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:01:33.069027
118	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:01:50.062538
119	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:01:50.170691
120	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:02:09.245181
121	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:02:09.359256
122	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:02:25.177912
123	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:02:25.181961
124	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:02:28.427463
125	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:02:28.427826
126	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:03:03.060363
127	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:03:03.062136
128	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:03:15.310174
129	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:03:15.379567
130	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-10 17:42:57.157531
131	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:44:52.302714
132	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:44:52.342897
133	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:45:30.558468
134	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:45:30.564414
135	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:46:08.060183
136	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:46:08.147358
137	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:47:46.33665
138	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:47:46.337027
139	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:52:26.505386
140	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:52:26.522452
141	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:53:00.280366
142	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:53:00.31933
143	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:53:11.557183
144	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:53:11.639426
145	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:53:20.292124
146	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:53:20.292468
147	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:54:49.449921
148	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:54:49.535344
149	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:07.021911
150	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:07.024641
151	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:15.872581
152	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:15.873025
153	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:38.883651
154	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:38.895487
155	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:48.847122
156	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 17:55:48.847715
157	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:03:29.741072
158	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:03:29.806445
159	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:06:03.089426
160	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:06:03.090264
162	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:14:43.623227
161	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:14:43.622894
163	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:15:05.275076
164	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:15:05.386075
165	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:19:17.409379
166	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:19:17.409798
168	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:24:28.617326
167	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:24:28.616708
169	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:25:33.7376
170	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-10 18:25:33.739805
171	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-11 17:30:48.641005
172	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:48:02.527688
173	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:48:02.564112
174	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:48:21.378018
175	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:48:21.487086
176	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:49:21.090355
177	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:49:21.0908
178	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:49:37.896223
179	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:49:37.999086
180	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:49:53.772435
181	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:49:53.875892
182	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:56:27.174384
183	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:56:27.174726
184	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:56:40.389075
185	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:56:40.446893
186	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:56:51.128751
187	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-11 17:56:51.186474
188	1	UPDATE_UI_CONTROL	ui_controls	6	更新UI控件: skill_voice_btn	::1	2026-03-12 15:33:01.133547
189	1	UPDATE_UI_CONTROL	ui_controls	5	更新UI控件: skill_hud	::1	2026-03-12 15:33:08.707701
190	1	UPDATE_UI_CONTROL	ui_controls	6	更新UI控件: skill_voice_btn	::1	2026-03-12 15:33:25.985527
191	1	RESET_UI_CONTROL	ui_controls	16	重置UI控件: btn_profile	::1	2026-03-12 15:43:01.958719
192	1	UPDATE_UI_CONTROL	ui_controls	16	更新UI控件: btn_profile	::1	2026-03-12 15:43:10.173902
193	1	RESET_UI_CONTROL	ui_controls	17	重置UI控件: btn_inventory	::1	2026-03-12 15:43:14.679942
194	1	RESET_UI_CONTROL	ui_controls	6	重置UI控件: skill_voice_btn	::1	2026-03-12 15:43:19.986688
195	1	RESET_UI_CONTROL	ui_controls	5	重置UI控件: skill_hud	::1	2026-03-12 15:43:25.742487
196	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:43:29.939181
197	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:43:30.117249
198	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:45:31.834961
199	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:45:31.835301
200	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:45:49.138013
201	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:45:49.143205
202	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:45:59.145533
203	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:45:59.146034
204	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:46:23.91367
205	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:46:23.926529
206	1	RESET_UI_CONTROL	ui_controls	10	重置UI控件: copy_coords_btn	::1	2026-03-12 15:46:39.941292
207	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:46:43.325725
208	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 15:46:43.389953
209	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:27:14.97443
210	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:27:15.02705
211	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:27:39.747437
212	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:27:39.81387
213	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:27:53.58754
214	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:27:53.648734
215	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:28:16.722758
216	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:28:16.796061
217	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:28:35.42338
452	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 16:40:11.352686
218	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:28:35.426976
219	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:28:45.560176
220	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:28:45.727135
221	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:00.01909
222	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:00.19484
223	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:13.490962
224	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:13.673982
225	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:17.928522
226	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:17.928772
227	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:35.923867
228	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-12 16:29:35.927143
229	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-13 11:06:01.297868
230	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-13 16:37:54.819735
231	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-14 05:58:51.324949
232	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-15 07:55:36.166775
233	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-16 09:24:15.449282
234	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-17 09:32:20.013052
235	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-18 10:28:26.357934
236	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-18 17:49:54.398382
237	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-19 14:56:36.21395
238	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-19 17:26:44.189023
239	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-03-19 17:26:44.18971
240	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-20 17:04:13.94445
241	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-23 14:30:05.482234
242	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-23 16:05:19.298284
243	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-24 11:11:40.70223
244	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-25 14:33:41.265844
245	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-25 15:13:05.583909
246	1	LOGIN	admin_users	1	管理员登录	::1	2026-03-30 11:06:31.68147
247	1	LOGIN	admin_users	1	管理员登录	::1	2026-04-08 16:26:52.488288
248	1	LOGIN	admin_users	1	管理员登录	::1	2026-04-25 07:28:08.985487
249	1	LOGIN	admin_users	1	管理员登录	::1	2026-04-26 07:32:57.222425
250	1	LOGIN	admin_users	1	管理员登录	::1	2026-04-26 09:38:52.613625
251	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-06 17:43:48.372997
252	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-06 17:44:52.862459
253	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-07 14:42:33.353625
254	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-07 14:43:13.890929
255	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-05-07 16:10:19.645675
256	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-05-07 16:10:19.646113
257	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-05-07 16:10:44.995718
258	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-05-07 16:10:44.996115
259	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-09 17:58:00.915789
260	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-11 11:13:59.713223
261	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-11 11:17:35.726452
262	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-12 15:55:32.081469
263	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-05-12 16:42:09.684026
264	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-05-12 16:42:09.684759
265	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-14 15:57:09.14011
266	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-14 16:19:39.830602
267	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-14 16:20:29.911706
268	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-15 16:23:28.373651
269	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-15 16:25:12.503342
270	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-15 16:35:44.369169
271	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-15 17:29:11.457608
272	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-15 17:40:47.479833
273	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-18 11:04:42.072708
274	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-19 15:33:09.636096
275	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-20 15:43:06.219422
276	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-20 15:56:12.280938
277	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-21 14:29:45.263973
278	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-21 16:58:25.358636
279	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-21 18:00:12.537208
280	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-25 18:01:18.333456
281	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-25 18:13:17.998647
282	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-29 17:02:59.147347
283	1	LOGIN	admin_users	1	管理员登录	::1	2026-05-29 17:55:34.780656
284	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-01 09:42:36.930352
285	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-01 10:21:11.727285
286	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-02 10:39:27.510248
287	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:51:27.989336
288	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:51:36.438342
289	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:51:55.661555
290	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:52:15.65888
291	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:52:35.361154
292	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:52:44.84088
293	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:52:58.692442
294	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:54:12.381207
295	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 10:54:29.869556
296	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 11:17:15.599447
297	1	DELETE_UI_CONTROL	ui_controls	minimap	删除UI控件: minimap	::1	2026-06-02 11:17:19.778174
298	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 11:17:23.139238
299	1	CREATE_UI_CONTROL	ui_controls	25	创建UI控件: 地图 (ditu)	::1	2026-06-02 11:17:59.878211
300	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 11:18:51.70961
301	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 11:19:03.061569
302	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 11:26:25.159826
303	1	DELETE_UI_CONTROL	ui_controls	ditu	删除UI控件: ditu	::1	2026-06-02 11:26:36.169611
304	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 11:26:37.527578
305	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 11:26:52.696423
306	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 11:27:05.970497
307	1	DELETE_UI_CONTROL	ui_controls	portal_btn	删除UI控件: portal_btn	::1	2026-06-02 11:27:38.506048
308	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-02 11:27:39.652377
309	1	DELETE_UI_CONTROL	ui_controls	copy_coords_btn	删除UI控件: copy_coords_btn	::1	2026-06-02 11:28:04.142825
310	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 10个	::1	2026-06-02 11:28:05.605456
311	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 14个	::1	2026-06-02 14:55:54.518803
312	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 14个	::1	2026-06-02 15:09:05.813242
313	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 14个	::1	2026-06-02 15:09:17.998517
314	1	DELETE_UI_CONTROL	ui_controls	portal_btn	删除UI控件: portal_btn	::1	2026-06-02 15:10:13.562148
315	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-06-02 15:10:15.477783
316	1	DELETE_UI_CONTROL	ui_controls	copy_coords_btn	删除UI控件: copy_coords_btn	::1	2026-06-02 15:10:29.479925
317	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:10:32.355371
318	1	UPDATE_UI_CONTROL	ui_controls	5	更新UI控件: skill_hud	::1	2026-06-02 15:10:50.688514
319	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:10:59.007984
320	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:11:08.304764
321	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:12:52.893006
322	1	UPDATE_UI_CONTROL	ui_controls	5	更新UI控件: skill_hud	::1	2026-06-02 15:13:05.692575
323	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:27:11.50769
324	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:27:32.939608
325	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:27:44.990303
326	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:28:06.751522
327	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:28:30.205507
328	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:41:17.231205
329	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:41:33.848671
330	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:41:48.108429
331	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:43:51.235658
332	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:50:51.421386
333	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:53:34.229352
334	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 15:53:46.735377
335	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:07:07.821096
336	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:07:20.230159
337	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:09:42.998836
338	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:11:08.240677
339	1	UPDATE_UI_CONTROL	ui_controls	5	更新UI控件: skill_hud	::1	2026-06-02 16:16:30.650355
340	1	UPDATE_UI_CONTROL	ui_controls	5	更新UI控件: skill_hud	::1	2026-06-02 16:26:35.200234
341	1	UPDATE_UI_CONTROL	ui_controls	5	更新UI控件: skill_hud	::1	2026-06-02 16:26:44.003462
342	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:48:33.547432
343	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:48:45.945862
344	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:49:10.656057
345	1	UPDATE_UI_CONTROL	ui_controls	35	更新UI控件: minimap	::1	2026-06-02 16:50:29.381294
346	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 16:52:54.593811
347	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-02 16:55:26.039903
348	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:08:47.118747
349	1	UPDATE_UI_CONTROL	ui_controls	11	更新UI控件: performance_monitor	::1	2026-06-02 17:09:10.859914
350	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:09:45.165952
351	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:10:09.350365
352	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:10:14.731915
353	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:10:16.851459
354	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-02 17:23:07.886131
355	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:23:11.627526
356	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:50:40.093685
357	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:51:14.374196
358	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:51:20.11585
359	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:51:25.085579
360	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:51:28.629543
361	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:58:15.746052
362	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:58:54.231827
363	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:58:58.712708
364	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:59:37.112641
365	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 17:59:47.954106
366	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:05:57.370601
367	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:06:22.522765
368	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:09:48.958175
369	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:10:02.223409
370	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:10:19.545765
371	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:11:00.542273
372	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:16:23.509754
373	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:16:39.847669
374	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:16:48.155716
375	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:16:57.097917
376	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:17:03.109553
377	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:17:40.554867
378	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:17:46.476741
379	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:23:09.373369
380	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:23:29.341879
381	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:29:16.61667
382	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:29:49.677249
383	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-02 18:31:40.025045
384	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-03 11:25:22.263702
385	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:31:10.556652
386	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:38:14.170873
387	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:38:28.65136
388	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:39:50.398986
389	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:42:05.892339
390	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:42:19.736403
391	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:42:49.826407
392	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:43:02.84255
393	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:43:13.340928
394	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:43:25.842893
395	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 11:43:40.832471
396	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 12:08:54.198674
397	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 12:09:11.986165
398	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 12:09:48.844494
399	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:13:16.043346
400	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:14:49.192709
401	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:30:46.769995
402	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:31:01.275069
403	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:37:38.294941
404	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:37:43.136218
405	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:48:44.025865
406	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:49:04.575077
407	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:49:23.66514
408	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 14:52:45.975162
409	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:07:47.862704
410	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:09:36.507287
411	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:09:41.430249
412	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:33:15.473621
413	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:33:30.643959
414	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:33:50.629079
415	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:33:59.480405
416	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 15:34:28.616976
417	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 16:20:58.098188
418	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 18:03:46.194793
419	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 18:04:07.795765
420	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 18:04:25.059344
421	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-03 18:05:00.063069
422	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-04 15:49:47.404607
423	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-04 18:03:19.540032
424	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-05 10:13:23.481202
425	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-05 15:33:12.805151
426	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-05 16:31:02.660201
427	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-07 14:35:45.975748
428	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-07 14:39:42.514778
429	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-08 14:46:11.091481
430	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-08 15:30:22.621299
431	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-08 16:23:44.062036
432	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-08 16:23:47.918958
433	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-09 17:50:57.207655
434	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 10:49:43.169969
435	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 14:14:51.833162
436	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 15:26:00.446055
437	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 15:28:35.814101
438	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 15:31:20.993457
439	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 15:40:57.422506
440	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 15:41:18.957572
441	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-10 16:05:21.66416
442	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 13:55:40.042387
443	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 14:06:35.502683
444	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 14:31:24.193106
445	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 14:43:55.516162
446	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 14:52:02.912386
447	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 14:56:21.684278
448	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 15:17:05.386103
449	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 15:17:09.730088
450	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 16:39:34.242426
453	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 16:40:21.340889
454	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 16:54:50.827557
455	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-11 18:27:48.896321
456	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-12 09:14:25.793639
457	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-12 17:17:32.943924
458	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-13 17:13:56.385672
459	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-15 15:53:32.278424
460	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-15 18:06:10.69751
461	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 09:26:03.722789
462	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 11:53:39.527298
463	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 12:32:06.171012
464	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 15:38:38.51406
465	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 15:38:51.846998
466	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 17:19:17.477237
467	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-16 17:36:49.011968
468	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-17 16:24:40.034444
469	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-17 16:33:04.026981
470	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 12个	::1	2026-06-17 16:33:31.391345
471	1	DELETE_UI_CONTROL	ui_controls	performance_monitor	删除UI控件: performance_monitor	::1	2026-06-17 16:33:34.002403
472	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-17 16:33:39.144378
473	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-17 16:33:58.880057
474	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-17 17:40:55.298553
475	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-18 14:40:49.695806
476	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:41:08.986762
477	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:41:29.405255
478	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:41:40.034648
479	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:47:53.142232
480	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:47:54.083721
481	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:49:00.675639
482	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:49:16.019719
483	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:49:28.738377
484	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:56:43.244812
485	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 14:56:56.222743
486	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 15:13:08.05082
487	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 15:18:31.330896
488	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 15:19:17.584957
489	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 15:19:43.087388
490	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 11个	::1	2026-06-18 15:24:12.520117
491	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 15个	::1	2026-06-18 15:35:26.945124
492	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 15个	::1	2026-06-18 15:35:51.577313
493	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 15个	::1	2026-06-18 15:36:12.701313
494	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 15个	::1	2026-06-18 15:36:25.166599
495	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 15个	::1	2026-06-18 16:07:45.761078
496	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-18 16:16:13.280897
497	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-18 16:16:46.713107
498	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-18 16:26:42.322025
499	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-22 10:01:56.018693
500	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-22 11:00:44.877184
501	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-22 17:59:12.576201
502	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 09:12:12.789306
503	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 11:07:01.676844
504	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 11:16:27.991791
505	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 11:23:50.430835
506	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 14:33:13.551418
507	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 16:35:01.996925
508	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 17:00:57.911294
509	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-23 18:19:25.337329
510	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-26 09:33:00.581408
511	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-26 10:07:29.432119
512	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-26 10:17:59.048077
513	1	LOGIN	admin_users	1	管理员登录	::1	2026-06-30 18:21:37.644417
514	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-01 09:56:47.010879
515	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-03 18:27:34.142953
516	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-06 18:20:06.241154
517	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-07 15:26:57.617413
518	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-07 17:45:07.433698
519	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-08 15:13:59.828425
520	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-08 15:14:13.389017
521	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-08 17:05:48.344316
522	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-08 17:13:42.348934
523	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-09 17:10:45.329132
524	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-10 15:13:51.377011
525	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-10 17:08:08.672889
526	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 06:32:22.167613
527	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 06:50:48.935107
528	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 06:58:50.673912
529	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 06:58:58.734847
530	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 06:59:38.577239
531	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 07:00:31.013258
532	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 07:08:24.344366
533	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 07:59:44.66037
534	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 08:00:14.689341
535	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 11:00:19.359274
536	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 11:09:00.117801
537	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 11:16:01.219129
538	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-12 11:23:50.776871
539	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-13 12:02:06.281804
540	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-13 15:25:29.271645
541	1	DELETE_UI_CONTROL	ui_controls	federation_portal_btn	删除UI控件: federation_portal_btn	::1	2026-07-13 16:24:31.294645
542	1	DELETE_UI_CONTROL	ui_controls	copy_coords_btn	删除UI控件: copy_coords_btn	::1	2026-07-13 16:24:34.624263
543	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 13个	::1	2026-07-13 16:24:41.749745
544	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-16 15:26:38.890851
545	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-17 16:58:10.25828
546	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-20 17:45:49.323575
547	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 14个	::1	2026-07-20 17:46:41.389474
548	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 14个	::1	2026-07-20 17:47:15.086222
549	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 14个	::1	2026-07-20 17:49:38.935091
550	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-21 17:51:34.504984
551	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-22 15:17:33.691441
552	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-22 15:48:42.885751
553	1	UPDATE_UI_CONTROL	ui_controls	92	更新UI控件: portal_btn	::1	2026-07-22 16:17:29.68465
554	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 09:33:49.028813
555	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 09:57:11.018764
556	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:27:08.162394
557	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:30:14.538664
558	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:31:31.61701
559	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:34:15.551083
560	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:36:00.689696
561	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:37:20.822364
562	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:37:40.288087
563	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:38:14.24936
564	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:38:31.667695
565	1	BATCH_UPDATE_UI_CONTROLS	ui_controls	\N	批量更新UI控件: 16个	::1	2026-07-23 10:38:51.069679
566	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 13:43:31.771446
567	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 15:09:25.85364
568	1	CHANGE_PASSWORD	admin_users	1	修改密码	::1	2026-07-23 15:09:45.518424
569	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 15:09:58.160247
570	1	CHANGE_PASSWORD	admin_users	1	修改密码	::1	2026-07-23 15:10:16.886502
571	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 15:10:24.640806
572	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 16:53:23.560641
573	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 16:54:13.405446
574	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 17:01:30.342318
575	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 17:06:52.968052
576	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 17:13:48.35284
577	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 17:33:08.009108
578	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-23 18:31:36.211421
579	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-24 10:02:50.327889
580	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-24 10:03:11.947316
581	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-24 10:12:16.625243
582	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-25 11:10:41.107447
583	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-26 11:11:09.546535
584	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-27 18:02:40.965322
585	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 15:46:23.720456
586	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 15:46:36.208336
587	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:11:57.312701
588	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:19:26.026916
589	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:32:51.28697
590	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:39:44.868478
591	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:40:01.381787
592	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:40:33.456822
593	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:43:39.512401
594	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:43:46.5355
595	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 16:46:58.851732
596	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-28 17:40:49.461007
597	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-29 15:38:55.597764
598	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-29 16:26:52.041687
599	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-29 16:27:57.228899
600	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-29 16:28:10.166766
601	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-29 16:37:31.111355
602	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-29 17:24:42.722634
603	1	LOGIN	admin_users	1	管理员登录	::1	2026-07-31 09:03:00.98081
604	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-02 07:06:02.735164
605	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-03 09:29:21.760188
606	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-04 14:42:11.321034
607	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-05 15:46:39.146883
608	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-05 18:21:34.814283
609	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-06 09:53:03.043458
610	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-06 16:07:00.353488
611	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-06 17:42:47.945148
612	1	LOGIN	admin_users	1	管理员登录	::1	2026-08-07 16:59:48.35658
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
1	admin	$2b$10$RdJQhiy42PGvDNQI90/Fi.aOmm8tr7M6zrczyeAhIM8gWHff1WAxi	admin@virtualworld.com	系统管理员	t	2026-08-07 16:59:48.355874	::1	2026-02-11 09:13:34.359303	2026-07-23 15:10:16.884151	admin
\.


--
-- Data for Name: ai_generated_scenes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_generated_scenes (id, scene_name, description, scene_type, scene_config, layout_data, object_count, ai_provider, user_id, is_public, view_count, thumbnail_url, tags, created_at, updated_at) FROM stdin;
3	魔法森林	神秘的魔法森林，有发光的水晶和传送门	forest	{"objects": [{"type": "tree", "count": 30, "properties": {"size": "varied"}}, {"type": "crystal", "count": 10, "properties": {"size": "varied"}}, {"type": "portal", "count": 1, "properties": {"size": "large"}}], "scene_type": "forest", "environment": {"time": "day", "terrain": "hills", "weather": "fog"}}	[]	41	default	\N	t	0	\N	{森林,魔法,示例}	2026-02-12 10:50:08.64886	2026-02-12 10:50:08.64886
6	魔法森林	神秘的魔法森林，有发光的水晶和传送门	forest	{"objects": [{"type": "tree", "count": 30, "properties": {"size": "varied"}}, {"type": "crystal", "count": 10, "properties": {"size": "varied"}}, {"type": "portal", "count": 1, "properties": {"size": "large"}}], "scene_type": "forest", "environment": {"time": "day", "terrain": "hills", "weather": "fog"}}	[]	41	default	\N	t	0	\N	{森林,魔法,示例}	2026-02-12 10:50:45.311151	2026-02-12 10:50:45.311151
1	温馨小村庄	一个漂亮的村子，有几座山、茅草屋、树木和小动物	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium"}}, {"type": "cottage", "count": 5, "properties": {"size": "small"}}, {"type": "tree", "count": 10, "properties": {"size": "varied"}}, {"type": "hen", "count": 2, "properties": {"size": "small"}}, {"type": "cat", "count": 1, "properties": {"size": "small"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}}	[]	21	default	\N	t	1	\N	{村庄,温馨,示例}	2026-02-12 10:50:08.64886	2026-02-14 15:29:26.84724
7	我的village场景	搭建一个温馨的小村庄，有几座茅草屋，周围有树木和栅栏，还有一只猫和一只狗在村子里玩耍	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": -24.72932053784593, "y": 0, "z": -40.623022966857775}, "rotation": {"x": 0, "y": 1.2868485368789193, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 22.404215772665424, "y": 0, "z": -44.11286529517605}, "rotation": {"x": 0, "y": 5.365274543170969, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 24.708965539019424, "y": 0, "z": -33.72110372768181}, "rotation": {"x": 0, "y": 4.138418380732855, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.8897964887583664, "position": {"x": 1.30402773475566, "y": 0, "z": -1.3872730125302706}, "rotation": {"x": 0, "y": 0.27237704168530324, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9078283363379849, "position": {"x": 0.2562863284635619, "y": 0, "z": -4.0043667854762095}, "rotation": {"x": 0, "y": 1.8333078498524829, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.902403222208512, "position": {"x": -2.437986619019222, "y": 0, "z": -2.66285434172907}, "rotation": {"x": 0, "y": 0.39508847992008517, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7448165162239695, "position": {"x": 0.7298867809268528, "y": 0, "z": 6.296520182910028}, "rotation": {"x": 0, "y": 2.1927898287438516, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.945358093956508, "position": {"x": -2.515743890861807, "y": 0, "z": 5.943259297759987}, "rotation": {"x": 0, "y": 6.116993651678322, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2077199224302344, "position": {"x": -5.334955497211688, "y": 0, "z": -14.305304964983963}, "rotation": {"x": 0, "y": 5.449704676900236, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9348083812578469, "position": {"x": 19.738088179812117, "y": 0, "z": 8.589329325070384}, "rotation": {"x": 0, "y": 4.75514609990456, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2922242878693058, "position": {"x": 0.9106865823510191, "y": 0, "z": 9.396602862148796}, "rotation": {"x": 0, "y": 5.53470967602185, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2002450094578494, "position": {"x": 0.08844699283411828, "y": 0, "z": 18.46437832806177}, "rotation": {"x": 0, "y": 4.810613708688834, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.3646991063635394, "position": {"x": -10.5430469076911, "y": 0, "z": 13.849698383219618}, "rotation": {"x": 0, "y": 1.5862901639120313, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1409510614116392, "position": {"x": 5.9307606021411665, "y": 0, "z": 1.4061926630565296}, "rotation": {"x": 0, "y": 4.8781861787359855, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8255735255147436, "position": {"x": -2.8690843226455165, "y": 0, "z": 19.787860477655002}, "rotation": {"x": 0, "y": 5.181027039823783, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2419331792718897, "position": {"x": 9.393802441514243, "y": 0, "z": -13.291589042678238}, "rotation": {"x": 0, "y": 1.2694639613491006, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7663464299686128, "position": {"x": -7.2627530052410005, "y": 0, "z": 11.72494515585813}, "rotation": {"x": 0, "y": 5.401348045526824, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1970072616915888, "position": {"x": -1.7174510060316521, "y": 0, "z": -7.2547998715373865}, "rotation": {"x": 0, "y": 1.9446437886972838, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.9925050799578455, "position": {"x": 9.376322456381649, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 3.564593655194794, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9775196590851596, "position": {"x": 6.660096771729164, "y": 0, "z": 6.660096771729163}, "rotation": {"x": 0, "y": 1.6404626677855025, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8350285725223427, "position": {"x": 0.0000000000000005757695483321282, "y": 0, "z": 9.403030306093175}, "rotation": {"x": 0, "y": 1.8409652867792958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8184023399307201, "position": {"x": -5.786402906978163, "y": 0, "z": 5.7864029069781635}, "rotation": {"x": 0, "y": 0.40633458738093653, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8639339997615809, "position": {"x": -9.523014884132841, "y": 0, "z": 0.0000000000000011662329696085888}, "rotation": {"x": 0, "y": 3.6914462996171458, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8718500724920506, "position": {"x": -6.795409088705915, "y": 0, "z": -6.795409088705912}, "rotation": {"x": 0, "y": 0.49039978347853685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8051852700645546, "position": {"x": -0.0000000000000014766368114784918, "y": 0, "z": -8.03843640199816}, "rotation": {"x": 0, "y": 0.36181713935640314, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8267075710603049, "position": {"x": 5.88300026191655, "y": 0, "z": -5.8830002619165525}, "rotation": {"x": 0, "y": 1.568594135165414, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.9534329963609827, "position": {"x": -1.80582757988077, "y": 0, "z": -1.8624346593469063}, "rotation": {"x": 0, "y": 3.9150969416075534, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.8729056435594956, "position": {"x": 1.801947449351747, "y": 0, "z": 5.967104186292474}, "rotation": {"x": 0, "y": 0.07273015231722982, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7321020306829472, "position": {"x": -7.854754371208861, "y": 0, "z": 18.580514714849528}, "rotation": {"x": 0, "y": 1.4489538367309014, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	5	\N	{village}	2026-02-12 10:51:35.974495	2026-02-12 15:10:59.118882
5	现代化都市	繁华的城市场景，高楼大厦林立，街道上车水马龙	city	{"objects": [{"type": "skyscraper", "count": 12, "properties": {"size": "varied"}}, {"type": "lamp", "count": 20, "properties": {"size": "small"}}, {"type": "car", "count": 8, "properties": {"size": "small"}}], "scene_type": "city", "environment": {"time": "night", "terrain": "flat", "weather": "clear"}}	[]	40	default	\N	t	1	\N	{城市,现代,示例}	2026-02-12 10:50:45.311151	2026-03-04 16:15:52.301339
4	温馨小村庄	一个漂亮的村子，有几座山、茅草屋、树木和小动物	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium"}}, {"type": "cottage", "count": 5, "properties": {"size": "small"}}, {"type": "tree", "count": 10, "properties": {"size": "varied"}}, {"type": "hen", "count": 2, "properties": {"size": "small"}}, {"type": "cat", "count": 1, "properties": {"size": "small"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}}	[]	21	default	\N	t	1	\N	{村庄,温馨,示例}	2026-02-12 10:50:45.311151	2026-02-14 15:29:24.083419
2	现代化都市	繁华的城市场景，高楼大厦林立，街道上车水马龙	city	{"objects": [{"type": "skyscraper", "count": 12, "properties": {"size": "varied"}}, {"type": "lamp", "count": 20, "properties": {"size": "small"}}, {"type": "car", "count": 8, "properties": {"size": "small"}}], "scene_type": "city", "environment": {"time": "night", "terrain": "flat", "weather": "clear"}}	[]	40	default	\N	t	1	\N	{城市,现代,示例}	2026-02-12 10:50:08.64886	2026-03-04 16:15:54.061869
8	我的village场景	搭建一个温馨的小村庄，有几座茅草屋，周围有树木和栅栏，还有一只猫和一只狗在村子里玩耍	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": -24.72932053784593, "y": 0, "z": -40.623022966857775}, "rotation": {"x": 0, "y": 1.2868485368789193, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 22.404215772665424, "y": 0, "z": -44.11286529517605}, "rotation": {"x": 0, "y": 5.365274543170969, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 24.708965539019424, "y": 0, "z": -33.72110372768181}, "rotation": {"x": 0, "y": 4.138418380732855, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.8897964887583664, "position": {"x": 1.30402773475566, "y": 0, "z": -1.3872730125302706}, "rotation": {"x": 0, "y": 0.27237704168530324, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9078283363379849, "position": {"x": 0.2562863284635619, "y": 0, "z": -4.0043667854762095}, "rotation": {"x": 0, "y": 1.8333078498524829, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.902403222208512, "position": {"x": -2.437986619019222, "y": 0, "z": -2.66285434172907}, "rotation": {"x": 0, "y": 0.39508847992008517, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7448165162239695, "position": {"x": 0.7298867809268528, "y": 0, "z": 6.296520182910028}, "rotation": {"x": 0, "y": 2.1927898287438516, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.945358093956508, "position": {"x": -2.515743890861807, "y": 0, "z": 5.943259297759987}, "rotation": {"x": 0, "y": 6.116993651678322, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2077199224302344, "position": {"x": -5.334955497211688, "y": 0, "z": -14.305304964983963}, "rotation": {"x": 0, "y": 5.449704676900236, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9348083812578469, "position": {"x": 19.738088179812117, "y": 0, "z": 8.589329325070384}, "rotation": {"x": 0, "y": 4.75514609990456, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2922242878693058, "position": {"x": 0.9106865823510191, "y": 0, "z": 9.396602862148796}, "rotation": {"x": 0, "y": 5.53470967602185, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2002450094578494, "position": {"x": 0.08844699283411828, "y": 0, "z": 18.46437832806177}, "rotation": {"x": 0, "y": 4.810613708688834, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.3646991063635394, "position": {"x": -10.5430469076911, "y": 0, "z": 13.849698383219618}, "rotation": {"x": 0, "y": 1.5862901639120313, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1409510614116392, "position": {"x": 5.9307606021411665, "y": 0, "z": 1.4061926630565296}, "rotation": {"x": 0, "y": 4.8781861787359855, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8255735255147436, "position": {"x": -2.8690843226455165, "y": 0, "z": 19.787860477655002}, "rotation": {"x": 0, "y": 5.181027039823783, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2419331792718897, "position": {"x": 9.393802441514243, "y": 0, "z": -13.291589042678238}, "rotation": {"x": 0, "y": 1.2694639613491006, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7663464299686128, "position": {"x": -7.2627530052410005, "y": 0, "z": 11.72494515585813}, "rotation": {"x": 0, "y": 5.401348045526824, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1970072616915888, "position": {"x": -1.7174510060316521, "y": 0, "z": -7.2547998715373865}, "rotation": {"x": 0, "y": 1.9446437886972838, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.9925050799578455, "position": {"x": 9.376322456381649, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 3.564593655194794, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9775196590851596, "position": {"x": 6.660096771729164, "y": 0, "z": 6.660096771729163}, "rotation": {"x": 0, "y": 1.6404626677855025, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8350285725223427, "position": {"x": 0.0000000000000005757695483321282, "y": 0, "z": 9.403030306093175}, "rotation": {"x": 0, "y": 1.8409652867792958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8184023399307201, "position": {"x": -5.786402906978163, "y": 0, "z": 5.7864029069781635}, "rotation": {"x": 0, "y": 0.40633458738093653, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8639339997615809, "position": {"x": -9.523014884132841, "y": 0, "z": 0.0000000000000011662329696085888}, "rotation": {"x": 0, "y": 3.6914462996171458, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8718500724920506, "position": {"x": -6.795409088705915, "y": 0, "z": -6.795409088705912}, "rotation": {"x": 0, "y": 0.49039978347853685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8051852700645546, "position": {"x": -0.0000000000000014766368114784918, "y": 0, "z": -8.03843640199816}, "rotation": {"x": 0, "y": 0.36181713935640314, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8267075710603049, "position": {"x": 5.88300026191655, "y": 0, "z": -5.8830002619165525}, "rotation": {"x": 0, "y": 1.568594135165414, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.9534329963609827, "position": {"x": -1.80582757988077, "y": 0, "z": -1.8624346593469063}, "rotation": {"x": 0, "y": 3.9150969416075534, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.8729056435594956, "position": {"x": 1.801947449351747, "y": 0, "z": 5.967104186292474}, "rotation": {"x": 0, "y": 0.07273015231722982, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7321020306829472, "position": {"x": -7.854754371208861, "y": 0, "z": 18.580514714849528}, "rotation": {"x": 0, "y": 1.4489538367309014, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	4	\N	{village}	2026-02-12 11:11:50.556634	2026-02-12 15:10:59.985216
9	村庄	搭建一个温馨的小村庄，有几座茅草屋，周围有树木和栅栏，还有一只猫和一只狗在村子里玩耍	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": -24.72932053784593, "y": 0, "z": -40.623022966857775}, "rotation": {"x": 0, "y": 1.2868485368789193, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 22.404215772665424, "y": 0, "z": -44.11286529517605}, "rotation": {"x": 0, "y": 5.365274543170969, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 24.708965539019424, "y": 0, "z": -33.72110372768181}, "rotation": {"x": 0, "y": 4.138418380732855, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.8897964887583664, "position": {"x": 1.30402773475566, "y": 0, "z": -1.3872730125302706}, "rotation": {"x": 0, "y": 0.27237704168530324, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9078283363379849, "position": {"x": 0.2562863284635619, "y": 0, "z": -4.0043667854762095}, "rotation": {"x": 0, "y": 1.8333078498524829, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.902403222208512, "position": {"x": -2.437986619019222, "y": 0, "z": -2.66285434172907}, "rotation": {"x": 0, "y": 0.39508847992008517, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7448165162239695, "position": {"x": 0.7298867809268528, "y": 0, "z": 6.296520182910028}, "rotation": {"x": 0, "y": 2.1927898287438516, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.945358093956508, "position": {"x": -2.515743890861807, "y": 0, "z": 5.943259297759987}, "rotation": {"x": 0, "y": 6.116993651678322, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2077199224302344, "position": {"x": -5.334955497211688, "y": 0, "z": -14.305304964983963}, "rotation": {"x": 0, "y": 5.449704676900236, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9348083812578469, "position": {"x": 19.738088179812117, "y": 0, "z": 8.589329325070384}, "rotation": {"x": 0, "y": 4.75514609990456, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2922242878693058, "position": {"x": 0.9106865823510191, "y": 0, "z": 9.396602862148796}, "rotation": {"x": 0, "y": 5.53470967602185, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2002450094578494, "position": {"x": 0.08844699283411828, "y": 0, "z": 18.46437832806177}, "rotation": {"x": 0, "y": 4.810613708688834, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.3646991063635394, "position": {"x": -10.5430469076911, "y": 0, "z": 13.849698383219618}, "rotation": {"x": 0, "y": 1.5862901639120313, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1409510614116392, "position": {"x": 5.9307606021411665, "y": 0, "z": 1.4061926630565296}, "rotation": {"x": 0, "y": 4.8781861787359855, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8255735255147436, "position": {"x": -2.8690843226455165, "y": 0, "z": 19.787860477655002}, "rotation": {"x": 0, "y": 5.181027039823783, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2419331792718897, "position": {"x": 9.393802441514243, "y": 0, "z": -13.291589042678238}, "rotation": {"x": 0, "y": 1.2694639613491006, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7663464299686128, "position": {"x": -7.2627530052410005, "y": 0, "z": 11.72494515585813}, "rotation": {"x": 0, "y": 5.401348045526824, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1970072616915888, "position": {"x": -1.7174510060316521, "y": 0, "z": -7.2547998715373865}, "rotation": {"x": 0, "y": 1.9446437886972838, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.9925050799578455, "position": {"x": 9.376322456381649, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 3.564593655194794, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9775196590851596, "position": {"x": 6.660096771729164, "y": 0, "z": 6.660096771729163}, "rotation": {"x": 0, "y": 1.6404626677855025, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8350285725223427, "position": {"x": 0.0000000000000005757695483321282, "y": 0, "z": 9.403030306093175}, "rotation": {"x": 0, "y": 1.8409652867792958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8184023399307201, "position": {"x": -5.786402906978163, "y": 0, "z": 5.7864029069781635}, "rotation": {"x": 0, "y": 0.40633458738093653, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8639339997615809, "position": {"x": -9.523014884132841, "y": 0, "z": 0.0000000000000011662329696085888}, "rotation": {"x": 0, "y": 3.6914462996171458, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8718500724920506, "position": {"x": -6.795409088705915, "y": 0, "z": -6.795409088705912}, "rotation": {"x": 0, "y": 0.49039978347853685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8051852700645546, "position": {"x": -0.0000000000000014766368114784918, "y": 0, "z": -8.03843640199816}, "rotation": {"x": 0, "y": 0.36181713935640314, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8267075710603049, "position": {"x": 5.88300026191655, "y": 0, "z": -5.8830002619165525}, "rotation": {"x": 0, "y": 1.568594135165414, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.9534329963609827, "position": {"x": -1.80582757988077, "y": 0, "z": -1.8624346593469063}, "rotation": {"x": 0, "y": 3.9150969416075534, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.8729056435594956, "position": {"x": 1.801947449351747, "y": 0, "z": 5.967104186292474}, "rotation": {"x": 0, "y": 0.07273015231722982, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7321020306829472, "position": {"x": -7.854754371208861, "y": 0, "z": 18.580514714849528}, "rotation": {"x": 0, "y": 1.4489538367309014, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	1	\N	{导入}	2026-02-12 11:12:13.980088	2026-02-12 11:16:37.053461
11	village_场景_1770866283752	搭建一个温馨的小村庄，有几座茅草屋，周围有树木和栅栏，还有一只猫和一只狗在村子里玩耍	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": -24.72932053784593, "y": 0, "z": -40.623022966857775}, "rotation": {"x": 0, "y": 1.2868485368789193, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 22.404215772665424, "y": 0, "z": -44.11286529517605}, "rotation": {"x": 0, "y": 5.365274543170969, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 24.708965539019424, "y": 0, "z": -33.72110372768181}, "rotation": {"x": 0, "y": 4.138418380732855, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.8897964887583664, "position": {"x": 1.30402773475566, "y": 0, "z": -1.3872730125302706}, "rotation": {"x": 0, "y": 0.27237704168530324, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9078283363379849, "position": {"x": 0.2562863284635619, "y": 0, "z": -4.0043667854762095}, "rotation": {"x": 0, "y": 1.8333078498524829, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.902403222208512, "position": {"x": -2.437986619019222, "y": 0, "z": -2.66285434172907}, "rotation": {"x": 0, "y": 0.39508847992008517, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7448165162239695, "position": {"x": 0.7298867809268528, "y": 0, "z": 6.296520182910028}, "rotation": {"x": 0, "y": 2.1927898287438516, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.945358093956508, "position": {"x": -2.515743890861807, "y": 0, "z": 5.943259297759987}, "rotation": {"x": 0, "y": 6.116993651678322, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2077199224302344, "position": {"x": -5.334955497211688, "y": 0, "z": -14.305304964983963}, "rotation": {"x": 0, "y": 5.449704676900236, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9348083812578469, "position": {"x": 19.738088179812117, "y": 0, "z": 8.589329325070384}, "rotation": {"x": 0, "y": 4.75514609990456, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2922242878693058, "position": {"x": 0.9106865823510191, "y": 0, "z": 9.396602862148796}, "rotation": {"x": 0, "y": 5.53470967602185, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2002450094578494, "position": {"x": 0.08844699283411828, "y": 0, "z": 18.46437832806177}, "rotation": {"x": 0, "y": 4.810613708688834, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.3646991063635394, "position": {"x": -10.5430469076911, "y": 0, "z": 13.849698383219618}, "rotation": {"x": 0, "y": 1.5862901639120313, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1409510614116392, "position": {"x": 5.9307606021411665, "y": 0, "z": 1.4061926630565296}, "rotation": {"x": 0, "y": 4.8781861787359855, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8255735255147436, "position": {"x": -2.8690843226455165, "y": 0, "z": 19.787860477655002}, "rotation": {"x": 0, "y": 5.181027039823783, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2419331792718897, "position": {"x": 9.393802441514243, "y": 0, "z": -13.291589042678238}, "rotation": {"x": 0, "y": 1.2694639613491006, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7663464299686128, "position": {"x": -7.2627530052410005, "y": 0, "z": 11.72494515585813}, "rotation": {"x": 0, "y": 5.401348045526824, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1970072616915888, "position": {"x": -1.7174510060316521, "y": 0, "z": -7.2547998715373865}, "rotation": {"x": 0, "y": 1.9446437886972838, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.9925050799578455, "position": {"x": 9.376322456381649, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 3.564593655194794, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9775196590851596, "position": {"x": 6.660096771729164, "y": 0, "z": 6.660096771729163}, "rotation": {"x": 0, "y": 1.6404626677855025, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8350285725223427, "position": {"x": 0.0000000000000005757695483321282, "y": 0, "z": 9.403030306093175}, "rotation": {"x": 0, "y": 1.8409652867792958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8184023399307201, "position": {"x": -5.786402906978163, "y": 0, "z": 5.7864029069781635}, "rotation": {"x": 0, "y": 0.40633458738093653, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8639339997615809, "position": {"x": -9.523014884132841, "y": 0, "z": 0.0000000000000011662329696085888}, "rotation": {"x": 0, "y": 3.6914462996171458, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8718500724920506, "position": {"x": -6.795409088705915, "y": 0, "z": -6.795409088705912}, "rotation": {"x": 0, "y": 0.49039978347853685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8051852700645546, "position": {"x": -0.0000000000000014766368114784918, "y": 0, "z": -8.03843640199816}, "rotation": {"x": 0, "y": 0.36181713935640314, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8267075710603049, "position": {"x": 5.88300026191655, "y": 0, "z": -5.8830002619165525}, "rotation": {"x": 0, "y": 1.568594135165414, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.9534329963609827, "position": {"x": -1.80582757988077, "y": 0, "z": -1.8624346593469063}, "rotation": {"x": 0, "y": 3.9150969416075534, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.8729056435594956, "position": {"x": 1.801947449351747, "y": 0, "z": 5.967104186292474}, "rotation": {"x": 0, "y": 0.07273015231722982, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7321020306829472, "position": {"x": -7.854754371208861, "y": 0, "z": 18.580514714849528}, "rotation": {"x": 0, "y": 1.4489538367309014, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	4	\N	{导入}	2026-02-12 11:18:05.453278	2026-02-14 15:29:17.752113
10	village_场景_1770866207095	搭建一个温馨的小村庄，有几座茅草屋，周围有树木和栅栏，还有一只猫和一只狗在村子里玩耍	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": -24.72932053784593, "y": 0, "z": -40.623022966857775}, "rotation": {"x": 0, "y": 1.2868485368789193, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 22.404215772665424, "y": 0, "z": -44.11286529517605}, "rotation": {"x": 0, "y": 5.365274543170969, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 24.708965539019424, "y": 0, "z": -33.72110372768181}, "rotation": {"x": 0, "y": 4.138418380732855, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.8897964887583664, "position": {"x": 1.30402773475566, "y": 0, "z": -1.3872730125302706}, "rotation": {"x": 0, "y": 0.27237704168530324, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9078283363379849, "position": {"x": 0.2562863284635619, "y": 0, "z": -4.0043667854762095}, "rotation": {"x": 0, "y": 1.8333078498524829, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.902403222208512, "position": {"x": -2.437986619019222, "y": 0, "z": -2.66285434172907}, "rotation": {"x": 0, "y": 0.39508847992008517, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7448165162239695, "position": {"x": 0.7298867809268528, "y": 0, "z": 6.296520182910028}, "rotation": {"x": 0, "y": 2.1927898287438516, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.945358093956508, "position": {"x": -2.515743890861807, "y": 0, "z": 5.943259297759987}, "rotation": {"x": 0, "y": 6.116993651678322, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2077199224302344, "position": {"x": -5.334955497211688, "y": 0, "z": -14.305304964983963}, "rotation": {"x": 0, "y": 5.449704676900236, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9348083812578469, "position": {"x": 19.738088179812117, "y": 0, "z": 8.589329325070384}, "rotation": {"x": 0, "y": 4.75514609990456, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2922242878693058, "position": {"x": 0.9106865823510191, "y": 0, "z": 9.396602862148796}, "rotation": {"x": 0, "y": 5.53470967602185, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2002450094578494, "position": {"x": 0.08844699283411828, "y": 0, "z": 18.46437832806177}, "rotation": {"x": 0, "y": 4.810613708688834, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.3646991063635394, "position": {"x": -10.5430469076911, "y": 0, "z": 13.849698383219618}, "rotation": {"x": 0, "y": 1.5862901639120313, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1409510614116392, "position": {"x": 5.9307606021411665, "y": 0, "z": 1.4061926630565296}, "rotation": {"x": 0, "y": 4.8781861787359855, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8255735255147436, "position": {"x": -2.8690843226455165, "y": 0, "z": 19.787860477655002}, "rotation": {"x": 0, "y": 5.181027039823783, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2419331792718897, "position": {"x": 9.393802441514243, "y": 0, "z": -13.291589042678238}, "rotation": {"x": 0, "y": 1.2694639613491006, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7663464299686128, "position": {"x": -7.2627530052410005, "y": 0, "z": 11.72494515585813}, "rotation": {"x": 0, "y": 5.401348045526824, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1970072616915888, "position": {"x": -1.7174510060316521, "y": 0, "z": -7.2547998715373865}, "rotation": {"x": 0, "y": 1.9446437886972838, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.9925050799578455, "position": {"x": 9.376322456381649, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 3.564593655194794, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9775196590851596, "position": {"x": 6.660096771729164, "y": 0, "z": 6.660096771729163}, "rotation": {"x": 0, "y": 1.6404626677855025, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8350285725223427, "position": {"x": 0.0000000000000005757695483321282, "y": 0, "z": 9.403030306093175}, "rotation": {"x": 0, "y": 1.8409652867792958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8184023399307201, "position": {"x": -5.786402906978163, "y": 0, "z": 5.7864029069781635}, "rotation": {"x": 0, "y": 0.40633458738093653, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8639339997615809, "position": {"x": -9.523014884132841, "y": 0, "z": 0.0000000000000011662329696085888}, "rotation": {"x": 0, "y": 3.6914462996171458, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8718500724920506, "position": {"x": -6.795409088705915, "y": 0, "z": -6.795409088705912}, "rotation": {"x": 0, "y": 0.49039978347853685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8051852700645546, "position": {"x": -0.0000000000000014766368114784918, "y": 0, "z": -8.03843640199816}, "rotation": {"x": 0, "y": 0.36181713935640314, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8267075710603049, "position": {"x": 5.88300026191655, "y": 0, "z": -5.8830002619165525}, "rotation": {"x": 0, "y": 1.568594135165414, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.9534329963609827, "position": {"x": -1.80582757988077, "y": 0, "z": -1.8624346593469063}, "rotation": {"x": 0, "y": 3.9150969416075534, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.8729056435594956, "position": {"x": 1.801947449351747, "y": 0, "z": 5.967104186292474}, "rotation": {"x": 0, "y": 0.07273015231722982, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7321020306829472, "position": {"x": -7.854754371208861, "y": 0, "z": 18.580514714849528}, "rotation": {"x": 0, "y": 1.4489538367309014, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	4	\N	{导入}	2026-02-12 11:16:49.851235	2026-02-14 15:29:20.443468
12	village_场景_1770866496982	搭建一个温馨的小村庄，有几座茅草屋，周围有树木和栅栏，还有一只猫和一只狗在村子里玩耍	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": -24.72932053784593, "y": 0, "z": -40.623022966857775}, "rotation": {"x": 0, "y": 1.2868485368789193, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 22.404215772665424, "y": 0, "z": -44.11286529517605}, "rotation": {"x": 0, "y": 5.365274543170969, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": 24.708965539019424, "y": 0, "z": -33.72110372768181}, "rotation": {"x": 0, "y": 4.138418380732855, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.8897964887583664, "position": {"x": 1.30402773475566, "y": 0, "z": -1.3872730125302706}, "rotation": {"x": 0, "y": 0.27237704168530324, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9078283363379849, "position": {"x": 0.2562863284635619, "y": 0, "z": -4.0043667854762095}, "rotation": {"x": 0, "y": 1.8333078498524829, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.902403222208512, "position": {"x": -2.437986619019222, "y": 0, "z": -2.66285434172907}, "rotation": {"x": 0, "y": 0.39508847992008517, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7448165162239695, "position": {"x": 0.7298867809268528, "y": 0, "z": 6.296520182910028}, "rotation": {"x": 0, "y": 2.1927898287438516, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.945358093956508, "position": {"x": -2.515743890861807, "y": 0, "z": 5.943259297759987}, "rotation": {"x": 0, "y": 6.116993651678322, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2077199224302344, "position": {"x": -5.334955497211688, "y": 0, "z": -14.305304964983963}, "rotation": {"x": 0, "y": 5.449704676900236, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9348083812578469, "position": {"x": 19.738088179812117, "y": 0, "z": 8.589329325070384}, "rotation": {"x": 0, "y": 4.75514609990456, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2922242878693058, "position": {"x": 0.9106865823510191, "y": 0, "z": 9.396602862148796}, "rotation": {"x": 0, "y": 5.53470967602185, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2002450094578494, "position": {"x": 0.08844699283411828, "y": 0, "z": 18.46437832806177}, "rotation": {"x": 0, "y": 4.810613708688834, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.3646991063635394, "position": {"x": -10.5430469076911, "y": 0, "z": 13.849698383219618}, "rotation": {"x": 0, "y": 1.5862901639120313, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1409510614116392, "position": {"x": 5.9307606021411665, "y": 0, "z": 1.4061926630565296}, "rotation": {"x": 0, "y": 4.8781861787359855, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8255735255147436, "position": {"x": -2.8690843226455165, "y": 0, "z": 19.787860477655002}, "rotation": {"x": 0, "y": 5.181027039823783, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2419331792718897, "position": {"x": 9.393802441514243, "y": 0, "z": -13.291589042678238}, "rotation": {"x": 0, "y": 1.2694639613491006, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7663464299686128, "position": {"x": -7.2627530052410005, "y": 0, "z": 11.72494515585813}, "rotation": {"x": 0, "y": 5.401348045526824, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1970072616915888, "position": {"x": -1.7174510060316521, "y": 0, "z": -7.2547998715373865}, "rotation": {"x": 0, "y": 1.9446437886972838, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.9925050799578455, "position": {"x": 9.376322456381649, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 3.564593655194794, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9775196590851596, "position": {"x": 6.660096771729164, "y": 0, "z": 6.660096771729163}, "rotation": {"x": 0, "y": 1.6404626677855025, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8350285725223427, "position": {"x": 0.0000000000000005757695483321282, "y": 0, "z": 9.403030306093175}, "rotation": {"x": 0, "y": 1.8409652867792958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8184023399307201, "position": {"x": -5.786402906978163, "y": 0, "z": 5.7864029069781635}, "rotation": {"x": 0, "y": 0.40633458738093653, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8639339997615809, "position": {"x": -9.523014884132841, "y": 0, "z": 0.0000000000000011662329696085888}, "rotation": {"x": 0, "y": 3.6914462996171458, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8718500724920506, "position": {"x": -6.795409088705915, "y": 0, "z": -6.795409088705912}, "rotation": {"x": 0, "y": 0.49039978347853685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8051852700645546, "position": {"x": -0.0000000000000014766368114784918, "y": 0, "z": -8.03843640199816}, "rotation": {"x": 0, "y": 0.36181713935640314, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8267075710603049, "position": {"x": 5.88300026191655, "y": 0, "z": -5.8830002619165525}, "rotation": {"x": 0, "y": 1.568594135165414, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.9534329963609827, "position": {"x": -1.80582757988077, "y": 0, "z": -1.8624346593469063}, "rotation": {"x": 0, "y": 3.9150969416075534, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.8729056435594956, "position": {"x": 1.801947449351747, "y": 0, "z": 5.967104186292474}, "rotation": {"x": 0, "y": 0.07273015231722982, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7321020306829472, "position": {"x": -7.854754371208861, "y": 0, "z": 18.580514714849528}, "rotation": {"x": 0, "y": 1.4489538367309014, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	2	\N	{导入}	2026-02-12 11:21:41.202041	2026-02-12 14:00:44.480531
13	space_场景_1770876147700	创建一个太空基地，有几艘宇宙飞船、通讯塔、发光的能量水晶	space	{"objects": [{"type": "spaceship", "count": 3, "properties": {"size": "large", "distribution": "random"}}, {"type": "crystal", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tower", "count": 2, "properties": {"size": "large", "distribution": "random"}}], "scene_type": "space", "environment": {"time": "night", "terrain": "flat", "weather": "clear"}, "layout_hints": {"towers": "通讯设施", "crystals": "发光点缀", "spaceships": "随机停靠"}}	[{"type": "spaceship", "scale": 1.3770632507481837, "position": {"x": -12.447849038432954, "y": 0, "z": -13.305515690596526}, "rotation": {"x": 0, "y": 3.7294986946172664, "z": 0}, "properties": {"size": "large", "distribution": "random"}}, {"type": "spaceship", "scale": 1.690173244238343, "position": {"x": -7.354959499205362, "y": 0, "z": 5.518268174330906}, "rotation": {"x": 0, "y": 5.343207992886674, "z": 0}, "properties": {"size": "large", "distribution": "random"}}, {"type": "spaceship", "scale": 1.6452008422587547, "position": {"x": 5.35391614573664, "y": 0, "z": 6.5246580239696}, "rotation": {"x": 0, "y": 5.209048122705373, "z": 0}, "properties": {"size": "large", "distribution": "random"}}, {"type": "crystal", "scale": 1.240809480437342, "position": {"x": 12.668463590143787, "y": 0, "z": -5.195519660988953}, "rotation": {"x": 0, "y": 1.4890809149772049, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 0.8068903900136962, "position": {"x": -11.770791527441261, "y": 0, "z": 17.087056431810993}, "rotation": {"x": 0, "y": 4.180740639429222, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 1.1046364237202908, "position": {"x": 6.976417327461611, "y": 0, "z": -4.858913748376835}, "rotation": {"x": 0, "y": 0.3206437460536949, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 1.22233288510519, "position": {"x": -1.8025178382430198, "y": 0, "z": -19.063530248593963}, "rotation": {"x": 0, "y": 1.7722176107463066, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 0.714353831254911, "position": {"x": -0.0399380363502857, "y": 0, "z": 10.606370484021042}, "rotation": {"x": 0, "y": 1.224537280308257, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 1.4544911561912506, "position": {"x": 3.002205247721186, "y": 0, "z": -3.477597271627385}, "rotation": {"x": 0, "y": 0.25933783140009037, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 1.1754395238076831, "position": {"x": 0.8924418675553198, "y": 0, "z": 15.077221964016154}, "rotation": {"x": 0, "y": 5.366552596966661, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 1.3024053722588016, "position": {"x": -10.292682131529215, "y": 0, "z": 1.7142971788865964}, "rotation": {"x": 0, "y": 5.07748350662595, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 1.173365700821015, "position": {"x": 19.553245618033507, "y": 0, "z": -13.041824970178766}, "rotation": {"x": 0, "y": 5.856114155361672, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "crystal", "scale": 0.8933652257623104, "position": {"x": 19.066584379006592, "y": 0, "z": 10.412143168494055}, "rotation": {"x": 0, "y": 4.0619613647912045, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tower", "scale": 1.6234241325860164, "position": {"x": 8.364817014483354, "y": 0, "z": 4.807868426278802}, "rotation": {"x": 0, "y": 5.620918168106606, "z": 0}, "properties": {"size": "large", "distribution": "random"}}, {"type": "tower", "scale": 1.5516961957722666, "position": {"x": -18.436815327524254, "y": 0, "z": -12.325777959184094}, "rotation": {"x": 0, "y": 1.837065164671856, "z": 0}, "properties": {"size": "large", "distribution": "random"}}]	15	fallback	\N	f	1	\N	{导入}	2026-02-12 14:02:28.929025	2026-02-12 14:02:29.396721
14	village_1770877975255	搭建一个漂亮的村子有几座山有几个茅草屋还有母鸡带着小鸡，几个猫	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1.773445694185679, "position": {"x": -40.89676246901513, "y": 0, "z": 8.097661281414222}, "rotation": {"x": 0, "y": 5.5984699185754705, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1.773445694185679, "position": {"x": -54.71032545445996, "y": 0, "z": 1.9658211413165603}, "rotation": {"x": 0, "y": 3.01963690898153, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1.773445694185679, "position": {"x": -68.91492516263261, "y": 0, "z": 5.0067781190867535}, "rotation": {"x": 0, "y": 4.843143281288625, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 1.718032773974717, "position": {"x": -42.873828742057164, "y": 0, "z": 43.611398648087416}, "rotation": {"x": 0, "y": 1.2906997398597853, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 1.6539600619898602, "position": {"x": -43.2820120613771, "y": 0, "z": 34.96207905880067}, "rotation": {"x": 0, "y": 2.0857957638787368, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 1.7646817551075131, "position": {"x": -44.3735974297457, "y": 0, "z": 35.80881959949216}, "rotation": {"x": 0, "y": 3.6265776515185695, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 1.3099016384968183, "position": {"x": -43.75152896254694, "y": 0, "z": 34.458136938140974}, "rotation": {"x": 0, "y": 3.403207271005922, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 1.4387306594327667, "position": {"x": -39.297643168378535, "y": 0, "z": 37.928732142502746}, "rotation": {"x": 0, "y": 3.7033026806804736, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 2.2573253573149383, "position": {"x": -21.757278329012543, "y": 0, "z": 30.536216750489494}, "rotation": {"x": 0, "y": 0.9652720722519684, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2975836365559525, "position": {"x": -43.72515480067196, "y": 0, "z": 20.602067098490007}, "rotation": {"x": 0, "y": 3.4473798649684158, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 2.31187691976142, "position": {"x": -50.39938428327122, "y": 0, "z": 29.090923677702065}, "rotation": {"x": 0, "y": 1.1187941811417628, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 2.5287569118857816, "position": {"x": -58.82612325457347, "y": 0, "z": 34.13407094427944}, "rotation": {"x": 0, "y": 0.6366854775334294, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.8142008412401216, "position": {"x": -54.26767618752977, "y": 0, "z": 35.86637729396776}, "rotation": {"x": 0, "y": 6.212097692235541, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 2.233891437550946, "position": {"x": -59.05522321436355, "y": 0, "z": 56.59125049989319}, "rotation": {"x": 0, "y": 3.527443081109145, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 2.3844794383284342, "position": {"x": -59.91879698928706, "y": 0, "z": 54.90503880557247}, "rotation": {"x": 0, "y": 2.962140555737416, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 2.434941308537934, "position": {"x": -34.6949156959703, "y": 0, "z": 30.52690027077328}, "rotation": {"x": 0, "y": 2.298068564653607, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 2.278031581664789, "position": {"x": -46.65459399046483, "y": 0, "z": 26.304867156530126}, "rotation": {"x": 0, "y": 1.34299664160706, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.799351955732364, "position": {"x": -23.82465733509143, "y": 0, "z": 25.145636802043885}, "rotation": {"x": 0, "y": 3.0383565534113965, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 1.3286272574906246, "position": {"x": -32.78457930525775, "y": 0, "z": 38.96496211492766}, "rotation": {"x": 0, "y": 6.0474007665770735, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.6958029838018298, "position": {"x": -35.28464615989491, "y": 0, "z": 45.17618360259749}, "rotation": {"x": 0, "y": 0.7207006840706033, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.5236960576558618, "position": {"x": -41.495867647564744, "y": 0, "z": 47.46724022754084}, "rotation": {"x": 0, "y": 5.921320876295173, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.2714401791134478, "position": {"x": -47.51929115757633, "y": 0, "z": 44.98838562493925}, "rotation": {"x": 0, "y": 0.5808587121595675, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.4737662911085418, "position": {"x": -51.227953449690375, "y": 0, "z": 38.96496211492766}, "rotation": {"x": 0, "y": 1.4245781012464618, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.4384693511551359, "position": {"x": -47.73965728321721, "y": 0, "z": 32.7211724792752}, "rotation": {"x": 0, "y": 4.344428888360858, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.5236692121434272, "position": {"x": -41.495867647564744, "y": 0, "z": 29.739666877372343}, "rotation": {"x": 0, "y": 5.7795785676268725, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 1.6068496179700649, "position": {"x": -35.1327645439972, "y": 0, "z": 32.60185901136011}, "rotation": {"x": 0, "y": 4.212233785203771, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 1.5709120173359679, "position": {"x": -42.34189015883878, "y": 0, "z": 47.56614941977395}, "rotation": {"x": 0, "y": 0.28151227196673567, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 1.651691796859369, "position": {"x": -35.79113005657927, "y": 0, "z": 45.318024614601626}, "rotation": {"x": 0, "y": 4.4785870348196, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 1.6528253293614341, "position": {"x": -24.377715854173644, "y": 0, "z": 23.33934635048533}, "rotation": {"x": 0, "y": 3.428076667219114, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	5	\N	{已保存}	2026-02-12 14:32:55.438848	2026-02-13 10:46:19.681112
15	city_1770879830289	建一个现代化的城市，有十几栋摩天大楼，街道上有路灯和汽车，还有一个小公园	city	{"objects": [{"type": "skyscraper", "count": 12, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "lamp", "count": 20, "properties": {"size": "small", "distribution": "grid"}}, {"type": "car", "count": 8, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "count": 15, "properties": {"size": "small", "distribution": "line"}}], "scene_type": "city", "environment": {"time": "night", "terrain": "flat", "weather": "clear"}, "layout_hints": {"cars": "道路上行驶", "lamps": "街道两侧", "trees": "街道绿化", "skyscrapers": "网格排列"}}	[{"type": "skyscraper", "scale": 1.2581076401777396, "position": {"x": 38.05121186815943, "y": 0, "z": -16}, "rotation": {"x": 0, "y": 5.490508280328469, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 1.2913863990973675, "position": {"x": 46.05121186815943, "y": 0, "z": -16}, "rotation": {"x": 0, "y": 2.8450377238259126, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 1.2879863662792363, "position": {"x": 54.05121186815943, "y": 0, "z": -16}, "rotation": {"x": 0, "y": 1.860226752645533, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 1.4826002875733302, "position": {"x": 62.05121186815943, "y": 0, "z": -16}, "rotation": {"x": 0, "y": 5.185632174035798, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 0.7736491495441532, "position": {"x": 38.05121186815943, "y": 0, "z": -8}, "rotation": {"x": 0, "y": 0.1337138132105484, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 0.7095109032765543, "position": {"x": 46.05121186815943, "y": 0, "z": -8}, "rotation": {"x": 0, "y": 2.2185206904848727, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 1.492716105652378, "position": {"x": 54.05121186815943, "y": 0, "z": -8}, "rotation": {"x": 0, "y": 3.4233534111386037, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 0.7639795153534541, "position": {"x": 62.05121186815943, "y": 0, "z": -8}, "rotation": {"x": 0, "y": 5.018937544505627, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 0.7343362067649363, "position": {"x": 38.05121186815943, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 2.209014845667802, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 0.8169926982654342, "position": {"x": 46.05121186815943, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 4.652243916193528, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 1.0227598387529937, "position": {"x": 54.05121186815943, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 2.0073442050960875, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "skyscraper", "scale": 0.7376600072982921, "position": {"x": 62.05121186815943, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 6.098419653087786, "z": 0}, "properties": {"size": "varied", "distribution": "grid"}}, {"type": "lamp", "scale": 0.9679253031574083, "position": {"x": 34.05121186815943, "y": 0, "z": -20}, "rotation": {"x": 0, "y": 3.5362287827582133, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.7726395453175933, "position": {"x": 42.05121186815943, "y": 0, "z": -20}, "rotation": {"x": 0, "y": 3.482662197237865, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.7926466797806597, "position": {"x": 50.05121186815943, "y": 0, "z": -20}, "rotation": {"x": 0, "y": 0.6571547130615658, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.9234903812479262, "position": {"x": 58.05121186815943, "y": 0, "z": -20}, "rotation": {"x": 0, "y": 6.035445887959367, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.7547267163468313, "position": {"x": 66.05121186815943, "y": 0, "z": -20}, "rotation": {"x": 0, "y": 2.812215231004756, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.701396583924572, "position": {"x": 34.05121186815943, "y": 0, "z": -12}, "rotation": {"x": 0, "y": 4.643394429687125, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.7594930068595023, "position": {"x": 42.05121186815943, "y": 0, "z": -12}, "rotation": {"x": 0, "y": 0.13599544366934113, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8318590206599209, "position": {"x": 50.05121186815943, "y": 0, "z": -12}, "rotation": {"x": 0, "y": 3.0222379392818546, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8295391415960413, "position": {"x": 58.05121186815943, "y": 0, "z": -12}, "rotation": {"x": 0, "y": 5.761693241845573, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8311778742759262, "position": {"x": 66.05121186815943, "y": 0, "z": -12}, "rotation": {"x": 0, "y": 6.227557184919011, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8228667224593883, "position": {"x": 34.05121186815943, "y": 0, "z": -4}, "rotation": {"x": 0, "y": 3.199790728797191, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.7743591714872529, "position": {"x": 42.05121186815943, "y": 0, "z": -4}, "rotation": {"x": 0, "y": 5.808860850374242, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.903131106243336, "position": {"x": 50.05121186815943, "y": 0, "z": -4}, "rotation": {"x": 0, "y": 2.4238182577813063, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8703505763289422, "position": {"x": 58.05121186815943, "y": 0, "z": -4}, "rotation": {"x": 0, "y": 3.3109601807879474, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8855961244721448, "position": {"x": 66.05121186815943, "y": 0, "z": -4}, "rotation": {"x": 0, "y": 1.9551709526476961, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.836730484078815, "position": {"x": 34.05121186815943, "y": 0, "z": 4}, "rotation": {"x": 0, "y": 3.1249147896324576, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8958555200853371, "position": {"x": 42.05121186815943, "y": 0, "z": 4}, "rotation": {"x": 0, "y": 6.240591710629092, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.8404842758967833, "position": {"x": 50.05121186815943, "y": 0, "z": 4}, "rotation": {"x": 0, "y": 1.6593525444104047, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.9516648043152008, "position": {"x": 58.05121186815943, "y": 0, "z": 4}, "rotation": {"x": 0, "y": 2.030758330500297, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "lamp", "scale": 0.794669329471013, "position": {"x": 66.05121186815943, "y": 0, "z": 4}, "rotation": {"x": 0, "y": 5.409787783275998, "z": 0}, "properties": {"size": "small", "distribution": "grid"}}, {"type": "car", "scale": 0.7242723622978099, "position": {"x": 39.05121186815943, "y": 0, "z": -3.597216263785028}, "rotation": {"x": 0, "y": 5.2558221681462145, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.836239708756926, "position": {"x": 42.80121186815943, "y": 0, "z": -4.853067289528131}, "rotation": {"x": 0, "y": 1.3751552369839173, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.7119242135329295, "position": {"x": 46.55121186815943, "y": 0, "z": -3.6820922201914}, "rotation": {"x": 0, "y": 3.530853762227794, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.8053741119081254, "position": {"x": 50.30121186815943, "y": 0, "z": -4.678400595003099}, "rotation": {"x": 0, "y": 4.980032389317732, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.7815980493609448, "position": {"x": 54.05121186815943, "y": 0, "z": -3.3252861535858873}, "rotation": {"x": 0, "y": 1.741617292408616, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.7559229692415078, "position": {"x": 57.80121186815943, "y": 0, "z": -3.5443657918692453}, "rotation": {"x": 0, "y": 0.6703209117877256, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.9200215892315408, "position": {"x": 61.55121186815943, "y": 0, "z": -4.159093555974018}, "rotation": {"x": 0, "y": 2.25741745550616, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "car", "scale": 0.8541670499948184, "position": {"x": 65.30121186815943, "y": 0, "z": -4.8551182594808715}, "rotation": {"x": 0, "y": 4.533874792735608, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8969971323608265, "position": {"x": 39.05121186815943, "y": 0, "z": -4.785501527872792}, "rotation": {"x": 0, "y": 3.9776380815417283, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8055361455461779, "position": {"x": 41.05121186815943, "y": 0, "z": -4.361954364903276}, "rotation": {"x": 0, "y": 3.5275641389575796, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8405873965995004, "position": {"x": 43.05121186815943, "y": 0, "z": -3.497160908537217}, "rotation": {"x": 0, "y": 1.569780279664792, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8150922130106167, "position": {"x": 45.05121186815943, "y": 0, "z": -3.5315906933047336}, "rotation": {"x": 0, "y": 2.0430262663972636, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.9649057801842978, "position": {"x": 47.05121186815943, "y": 0, "z": -4.529031725531967}, "rotation": {"x": 0, "y": 4.003657751179839, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.9931833880054631, "position": {"x": 49.05121186815943, "y": 0, "z": -3.4108885559815167}, "rotation": {"x": 0, "y": 3.337016530143387, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.7116748422356945, "position": {"x": 51.05121186815943, "y": 0, "z": -3.6274286813356444}, "rotation": {"x": 0, "y": 3.7732959386475997, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8523456857521615, "position": {"x": 53.05121186815943, "y": 0, "z": -3.5219595494691167}, "rotation": {"x": 0, "y": 0.7753348802298617, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.7779301922923829, "position": {"x": 55.05121186815943, "y": 0, "z": -3.0047828753561907}, "rotation": {"x": 0, "y": 3.9410508176127115, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8056928653396974, "position": {"x": 57.05121186815943, "y": 0, "z": -3.099428862899847}, "rotation": {"x": 0, "y": 0.4266542163293381, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.9705490788158014, "position": {"x": 59.05121186815943, "y": 0, "z": -4.756106677005683}, "rotation": {"x": 0, "y": 2.935997687821794, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.8560725383122444, "position": {"x": 61.05121186815943, "y": 0, "z": -4.329097403342461}, "rotation": {"x": 0, "y": 4.188005429901257, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.7518639652403105, "position": {"x": 63.05121186815943, "y": 0, "z": -4.670259539921593}, "rotation": {"x": 0, "y": 3.5905035212716903, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.7997377968652711, "position": {"x": 65.05121186815943, "y": 0, "z": -3.3186917128766344}, "rotation": {"x": 0, "y": 2.6919131688523597, "z": 0}, "properties": {"size": "small", "distribution": "line"}}, {"type": "tree", "scale": 0.9488736156057582, "position": {"x": 67.05121186815943, "y": 0, "z": -3.9546330750100074}, "rotation": {"x": 0, "y": 6.1983024871223185, "z": 0}, "properties": {"size": "small", "distribution": "line"}}]	55	fallback	\N	f	6	\N	{已保存}	2026-02-12 15:03:50.478145	2026-02-13 10:46:16.463592
16	forest_1771048291840	生成一个树林	forest	{"objects": [{"type": "tree", "count": 30, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "rock", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "bush", "count": 20, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "count": 15, "properties": {"size": "small", "distribution": "random"}}, {"type": "bird", "count": 5, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "forest", "environment": {"time": "day", "terrain": "hills", "weather": "fog"}, "layout_hints": {"rocks": "随机点缀", "trees": "成林分布", "flowers": "林间开放"}}	[{"type": "tree", "scale": 1.1650831527504828, "position": {"x": -58.49383906955983, "y": 0, "z": -20.563118674734582}, "rotation": {"x": 0, "y": 2.6862841549946737, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.9011724401370574, "position": {"x": -55.64135261595693, "y": 0, "z": -14.836352743618214}, "rotation": {"x": 0, "y": 3.7679494109188307, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.0446849659079578, "position": {"x": -56.313362709184744, "y": 0, "z": -16.104607392816725}, "rotation": {"x": 0, "y": 4.982619123757087, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.8364142122864967, "position": {"x": -64.15662665617043, "y": 0, "z": -17.580609156932468}, "rotation": {"x": 0, "y": 1.3107424010176363, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.9370214590346024, "position": {"x": -57.97907352160594, "y": 0, "z": -25.063504839209653}, "rotation": {"x": 0, "y": 1.4053996887814553, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.4335801183386911, "position": {"x": -56.81755559843642, "y": 0, "z": -27.48891218356847}, "rotation": {"x": 0, "y": 4.288355863908819, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.7740722943838869, "position": {"x": -58.760342060416164, "y": 0, "z": -20.761836081402567}, "rotation": {"x": 0, "y": 4.1045305427277805, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.1613322772154768, "position": {"x": -55.9951374370228, "y": 0, "z": -21.89771800744009}, "rotation": {"x": 0, "y": 4.316939733065838, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2623216149904803, "position": {"x": -53.130312439801145, "y": 0, "z": -17.91472714849934}, "rotation": {"x": 0, "y": 4.115108938520444, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.9686913341128349, "position": {"x": -63.040093939937506, "y": 0, "z": -15.078789343437133}, "rotation": {"x": 0, "y": 3.6417861086227155, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.8957735939074837, "position": {"x": -56.74663983771358, "y": 0, "z": -16.930815182738908}, "rotation": {"x": 0, "y": 5.609277074687379, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.1824913898338132, "position": {"x": -60.40046331044277, "y": 0, "z": -23.456190214386734}, "rotation": {"x": 0, "y": 0.6110929097018497, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.180679005627846, "position": {"x": -56.60067366447352, "y": 0, "z": -16.429834839067198}, "rotation": {"x": 0, "y": 4.889638234364736, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.458387708511572, "position": {"x": -61.47383877064013, "y": 0, "z": -17.546404303312613}, "rotation": {"x": 0, "y": 4.573323065563579, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.9563703859883672, "position": {"x": -64.39899957774759, "y": 0, "z": -22.066089850962012}, "rotation": {"x": 0, "y": 6.243238728337304, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.0914790978227222, "position": {"x": -60.56242262390259, "y": 0, "z": -22.5696861103521}, "rotation": {"x": 0, "y": 2.8914658298883946, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.7048294983216894, "position": {"x": -64.21593644639469, "y": 0, "z": -19.80704388822348}, "rotation": {"x": 0, "y": 5.790561172208771, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.109007945657706, "position": {"x": -55.47361617585398, "y": 0, "z": -23.326474757609564}, "rotation": {"x": 0, "y": 0.4281154369475713, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.8798575996584145, "position": {"x": -58.210741586493384, "y": 0, "z": -22.70055120782649}, "rotation": {"x": 0, "y": 0.08753006052573135, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.106185797375501, "position": {"x": -54.92536445265273, "y": 0, "z": -16.255120192236426}, "rotation": {"x": 0, "y": 2.323235203393214, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.9304050388625359, "position": {"x": -55.18089264943329, "y": 0, "z": -23.44354640820428}, "rotation": {"x": 0, "y": 0.9387613035247269, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.7650553655100278, "position": {"x": -55.53411442298374, "y": 0, "z": -21.834476075678854}, "rotation": {"x": 0, "y": 0.4192898561159234, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2309906164092612, "position": {"x": -52.93703681756226, "y": 0, "z": -21.08448234152886}, "rotation": {"x": 0, "y": 0.37672043061405913, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.4480397239510294, "position": {"x": -57.047623839873474, "y": 0, "z": -26.44976628705564}, "rotation": {"x": 0, "y": 6.225833209451605, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.394900642207616, "position": {"x": -55.733802603046215, "y": 0, "z": -16.1132453115523}, "rotation": {"x": 0, "y": 4.819034228096529, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 1.2328555146067077, "position": {"x": -64.85009718468052, "y": 0, "z": -22.11734063688799}, "rotation": {"x": 0, "y": 3.6405371517420333, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.901501681342627, "position": {"x": -53.71471368782235, "y": 0, "z": -21.425236585744443}, "rotation": {"x": 0, "y": 2.7431519621326337, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.7647573531053701, "position": {"x": -60.230220376114666, "y": 0, "z": -22.154076512773837}, "rotation": {"x": 0, "y": 2.1777815096907287, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.8039846713475778, "position": {"x": -61.412650200029944, "y": 0, "z": -25.049562408106116}, "rotation": {"x": 0, "y": 1.5841252786166602, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "tree", "scale": 0.8877056216784401, "position": {"x": -58.33360873827718, "y": 0, "z": -20.571829909879536}, "rotation": {"x": 0, "y": 3.953910393662608, "z": 0}, "properties": {"size": "varied", "distribution": "clustered"}}, {"type": "rock", "scale": 1.4762397615459288, "position": {"x": -39.753671880455194, "y": 0, "z": -22.251931607493294}, "rotation": {"x": 0, "y": 4.076673886681079, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 0.8701202464790866, "position": {"x": -65.58678043617722, "y": 0, "z": -3.4905087788850544}, "rotation": {"x": 0, "y": 1.4675563530229114, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 1.3549487065419286, "position": {"x": -44.58549512094066, "y": 0, "z": -36.24135513656234}, "rotation": {"x": 0, "y": 4.56378793895437, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 1.1364376506966614, "position": {"x": -76.34160948031874, "y": 0, "z": -26.003134172308638}, "rotation": {"x": 0, "y": 4.12348866166316, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 1.469549763866019, "position": {"x": -41.68372121749115, "y": 0, "z": -34.80223535778952}, "rotation": {"x": 0, "y": 2.790469634938104, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 0.956262077551728, "position": {"x": -67.24703324188553, "y": 0, "z": -9.020283382646124}, "rotation": {"x": 0, "y": 5.664670781534749, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 1.3613180223213461, "position": {"x": -45.253403458204154, "y": 0, "z": -4.8470812820486735}, "rotation": {"x": 0, "y": 5.620618579724154, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 1.4969528714677185, "position": {"x": -43.96162687339518, "y": 0, "z": -12.02314031379903}, "rotation": {"x": 0, "y": 5.43441284665541, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 1.3619238634244308, "position": {"x": -68.3111507357486, "y": 0, "z": -19.464954279115435}, "rotation": {"x": 0, "y": 3.393594170489623, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "rock", "scale": 0.7186676987510143, "position": {"x": -38.45703668189721, "y": 0, "z": -3.9326011736236914}, "rotation": {"x": 0, "y": 4.417728828503739, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "bush", "scale": 0.8634777091488285, "position": {"x": -58.45203700059309, "y": 0, "z": -2.0103237707884425}, "rotation": {"x": 0, "y": 2.733688507508056, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.9718564217738167, "position": {"x": -56.33419992883921, "y": 0, "z": -13.653011303201463}, "rotation": {"x": 0, "y": 5.068105426033661, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.9556213901323382, "position": {"x": -46.89582320638218, "y": 0, "z": -32.194740686490945}, "rotation": {"x": 0, "y": 4.9388939790628, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.9241765650075776, "position": {"x": -59.550789970582514, "y": 0, "z": -4.265187180002737}, "rotation": {"x": 0, "y": 1.9523942285154456, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.7305775473504049, "position": {"x": -63.05536210293235, "y": 0, "z": -1.573446736218326}, "rotation": {"x": 0, "y": 5.409571481269625, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8865536428143298, "position": {"x": -75.44340269678935, "y": 0, "z": -37.15186883947699}, "rotation": {"x": 0, "y": 2.4625420423062487, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.7538116282472309, "position": {"x": -53.76599460514831, "y": 0, "z": -21.109898104276883}, "rotation": {"x": 0, "y": 2.954027267312522, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.7544802045893416, "position": {"x": -39.130005514828646, "y": 0, "z": -0.9942403592435021}, "rotation": {"x": 0, "y": 1.470790391398669, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.9007778163131542, "position": {"x": -59.839188548780214, "y": 0, "z": -35.31689684260785}, "rotation": {"x": 0, "y": 0.4797236387308517, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8327661695729406, "position": {"x": -45.83821005878289, "y": 0, "z": -19.725209828138667}, "rotation": {"x": 0, "y": 5.456313152649219, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8878462332021048, "position": {"x": -40.33497199103149, "y": 0, "z": -6.960105318778499}, "rotation": {"x": 0, "y": 0.5089791687607332, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.9839424171395437, "position": {"x": -40.15268867551935, "y": 0, "z": -19.28420582667304}, "rotation": {"x": 0, "y": 0.11178694890405898, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8695999937110308, "position": {"x": -66.02905901621762, "y": 0, "z": -28.40723419363175}, "rotation": {"x": 0, "y": 1.9816165563082206, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8887125899102983, "position": {"x": -63.290107047789384, "y": 0, "z": -16.528005355415306}, "rotation": {"x": 0, "y": 1.922960809537516, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.875472923078873, "position": {"x": -70.33472945499261, "y": 0, "z": -23.709589873576785}, "rotation": {"x": 0, "y": 2.8064337071984573, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.722014915494345, "position": {"x": -42.21227099531857, "y": 0, "z": -24.276075239136464}, "rotation": {"x": 0, "y": 5.199091815693716, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.7627882991049377, "position": {"x": -51.10744706837771, "y": 0, "z": -31.341276506243403}, "rotation": {"x": 0, "y": 0.5075907337917879, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8691352143885864, "position": {"x": -39.35950837355749, "y": 0, "z": -19.309917242114125}, "rotation": {"x": 0, "y": 2.9058906923185406, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.7410789476000513, "position": {"x": -42.82917411234935, "y": 0, "z": -3.6243503709827216}, "rotation": {"x": 0, "y": 2.5842523259838277, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bush", "scale": 0.8296720924254858, "position": {"x": -64.24040761802331, "y": 0, "z": -20.434101355285524}, "rotation": {"x": 0, "y": 3.5778781427495363, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.8518472459538439, "position": {"x": -48.253255176974555, "y": 0, "z": -25.36199166739642}, "rotation": {"x": 0, "y": 2.442021754212472, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.7656281867988323, "position": {"x": -56.86987465393969, "y": 0, "z": -28.88808249149873}, "rotation": {"x": 0, "y": 2.628755211882922, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.7252639542673234, "position": {"x": -55.170936179352566, "y": 0, "z": -17.16590701056145}, "rotation": {"x": 0, "y": 5.363991409675017, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.709425310442315, "position": {"x": -54.52581991939957, "y": 0, "z": -12.63979096323617}, "rotation": {"x": 0, "y": 2.767691088179231, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.8608267247522603, "position": {"x": -67.92572340716536, "y": 0, "z": -7.4612227535691}, "rotation": {"x": 0, "y": 2.174631821914544, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.8131546944124524, "position": {"x": -47.057457112540796, "y": 0, "z": -40.010645822800846}, "rotation": {"x": 0, "y": 5.991386089805338, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.8818469920632482, "position": {"x": -60.382638671031316, "y": 0, "z": -14.70283952997168}, "rotation": {"x": 0, "y": 1.778863141614823, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.8491566330573059, "position": {"x": -64.6231254743679, "y": 0, "z": -8.50856376182017}, "rotation": {"x": 0, "y": 2.854773382522281, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.9605854140461582, "position": {"x": -65.2613961168665, "y": 0, "z": -22.786335353769818}, "rotation": {"x": 0, "y": 6.143207893589391, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.9955700784598381, "position": {"x": -62.66393459924238, "y": 0, "z": -17.717100233931358}, "rotation": {"x": 0, "y": 0.15227152115386122, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.9648547824958985, "position": {"x": -59.42180774292375, "y": 0, "z": -13.663818957177941}, "rotation": {"x": 0, "y": 1.3246822176351134, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.7289062136648526, "position": {"x": -78.00448876385244, "y": 0, "z": -21.981963547125464}, "rotation": {"x": 0, "y": 1.4850029804402367, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.8106237630715188, "position": {"x": -73.15794883528064, "y": 0, "z": -11.785425835124467}, "rotation": {"x": 0, "y": 2.86742796005888, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.7972403034865652, "position": {"x": -70.70435994458116, "y": 0, "z": -2.301388695379142}, "rotation": {"x": 0, "y": 2.0737245024215403, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "flower", "scale": 0.7906180971104626, "position": {"x": -38.80338850103883, "y": 0, "z": -35.91143736836954}, "rotation": {"x": 0, "y": 5.9757855078762105, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bird", "scale": 0.8285244999030358, "position": {"x": -49.34437719046295, "y": 0, "z": -30.112949050301893}, "rotation": {"x": 0, "y": 2.037096994401617, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bird", "scale": 0.8740118172721655, "position": {"x": -43.86476770214548, "y": 0, "z": -39.25364659289629}, "rotation": {"x": 0, "y": 3.1871906501000553, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bird", "scale": 0.9217947997892186, "position": {"x": -52.785001007930816, "y": 0, "z": -17.309241549723584}, "rotation": {"x": 0, "y": 1.2899048372812558, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bird", "scale": 0.8825141918732046, "position": {"x": -51.72621723496367, "y": 0, "z": -14.757938194700241}, "rotation": {"x": 0, "y": 3.428245208927957, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "bird", "scale": 0.8979010817747447, "position": {"x": -62.106044650160655, "y": 0, "z": -22.38347701904517}, "rotation": {"x": 0, "y": 3.3644929272738526, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	80	fallback	\N	f	1	\N	{已保存}	2026-02-14 13:51:32.391722	2026-02-14 13:51:32.591599
17	village_1771048315380	茅草屋和树林	village	{"objects": [{"type": "mountain", "count": 3, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "count": 5, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "count": 10, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "count": 8, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "count": 2, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "count": 1, "properties": {"size": "small", "distribution": "random"}}], "scene_type": "village", "environment": {"time": "day", "terrain": "hills", "weather": "clear"}, "layout_hints": {"trees": "随机散布", "animals": "村子内活动", "cottages": "围绕中心圆形分布", "mountains": "远景背景"}}	[{"type": "mountain", "scale": 1, "position": {"x": 5.636915503854745, "y": 0, "z": -53.28081397012089}, "rotation": {"x": 0, "y": 3.1472427783680836, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": -33.3621875096062, "y": 0, "z": -59.592312330667184}, "rotation": {"x": 0, "y": 2.652809498068531, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "mountain", "scale": 1, "position": {"x": -18.046191193534096, "y": 0, "z": -67.35539343297967}, "rotation": {"x": 0, "y": 2.657466744197342, "z": 0}, "properties": {"size": "medium", "distribution": "background"}}, {"type": "cottage", "scale": 0.738010053176343, "position": {"x": -13.358398187232513, "y": 0, "z": -20.21392250101605}, "rotation": {"x": 0, "y": 5.939195255557802, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9905823764191686, "position": {"x": -18.014270023407043, "y": 0, "z": -26.789012666393134}, "rotation": {"x": 0, "y": 4.718676684523167, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.9325624900005848, "position": {"x": -20.38906757464252, "y": 0, "z": -20.020966777122617}, "rotation": {"x": 0, "y": 0.07476138711481259, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.8802170728227, "position": {"x": -16.681744660893596, "y": 0, "z": -24.027322773542988}, "rotation": {"x": 0, "y": 1.9734050404939971, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "cottage", "scale": 0.7554650487883002, "position": {"x": -18.465665421037098, "y": 0, "z": -24.73191567523918}, "rotation": {"x": 0, "y": 1.896355893299341, "z": 0}, "properties": {"size": "small", "distribution": "clustered"}}, {"type": "tree", "scale": 0.9271910631084154, "position": {"x": -24.0227306218995, "y": 0, "z": -35.57017981336134}, "rotation": {"x": 0, "y": 5.257570489859981, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.381332732759371, "position": {"x": -32.99196513251856, "y": 0, "z": -7.4839357495557906}, "rotation": {"x": 0, "y": 5.777108085961789, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.8806748092547464, "position": {"x": -2.6017109560027905, "y": 0, "z": -15.68457664622456}, "rotation": {"x": 0, "y": 2.923566777894517, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.9114698692515127, "position": {"x": -18.319118352720903, "y": 0, "z": -3.726245758879209}, "rotation": {"x": 0, "y": 4.3080396130366205, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1713462855251988, "position": {"x": -29.172187074836692, "y": 0, "z": -41.96798125425783}, "rotation": {"x": 0, "y": 4.552030270374858, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.495015386461345, "position": {"x": -2.3993740126442233, "y": 0, "z": -37.801882049655234}, "rotation": {"x": 0, "y": 3.5937659648488722, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 0.7568535680025049, "position": {"x": -16.9928346314109, "y": 0, "z": -16.826681041559482}, "rotation": {"x": 0, "y": 4.170722655396002, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.4427400595884958, "position": {"x": -24.339514166374045, "y": 0, "z": -15.635169208110753}, "rotation": {"x": 0, "y": 0.12303673136603648, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.1945516076252227, "position": {"x": -31.414885341454582, "y": 0, "z": -34.3375574828022}, "rotation": {"x": 0, "y": 5.78550358065521, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "tree", "scale": 1.2325977171075486, "position": {"x": -35.748801002191385, "y": 0, "z": -39.62034705057566}, "rotation": {"x": 0, "y": 5.187955848121132, "z": 0}, "properties": {"size": "varied", "distribution": "random"}}, {"type": "fence", "scale": 0.7563932786162235, "position": {"x": -9.493795712293943, "y": 0, "z": -23.23838533551131}, "rotation": {"x": 0, "y": 4.352914495170059, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.7330993882217732, "position": {"x": -13.305271618087431, "y": 0, "z": -17.32289876117911}, "rotation": {"x": 0, "y": 4.983682631286539, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.9388806211386487, "position": {"x": -19.22075819241963, "y": 0, "z": -13.24387078775697}, "rotation": {"x": 0, "y": 2.9684040236313454, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.7404514680590907, "position": {"x": -26.11915060482726, "y": 0, "z": -16.33999292310368}, "rotation": {"x": 0, "y": 4.845317992739972, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.7289294816663414, "position": {"x": -28.662168209673716, "y": 0, "z": -23.23838533551131}, "rotation": {"x": 0, "y": 1.9692441846081685, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.8793085955883587, "position": {"x": -25.068862560866915, "y": 0, "z": -29.08648970395859}, "rotation": {"x": 0, "y": 0.01547419188496972, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.7899644029547561, "position": {"x": -19.22075819241963, "y": 0, "z": -32.5939532203718}, "rotation": {"x": 0, "y": 5.732987171900958, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "fence", "scale": 0.7779904985446096, "position": {"x": -12.309331014380728, "y": 0, "z": -30.149812513550216}, "rotation": {"x": 0, "y": 4.9086416770843835, "z": 0}, "properties": {"size": "small", "distribution": "circle"}}, {"type": "hen", "scale": 0.7406091185077105, "position": {"x": -2.216708468228653, "y": 0, "z": -21.06383172554733}, "rotation": {"x": 0, "y": 5.850904248077764, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "hen", "scale": 0.7739173756936141, "position": {"x": -26.272610791466917, "y": 0, "z": -16.807352655537713}, "rotation": {"x": 0, "y": 1.359309061418656, "z": 0}, "properties": {"size": "small", "distribution": "random"}}, {"type": "cat", "scale": 0.7890762848777179, "position": {"x": -20.422869179802916, "y": 0, "z": -24.809941066012858}, "rotation": {"x": 0, "y": 1.817541241179455, "z": 0}, "properties": {"size": "small", "distribution": "random"}}]	29	fallback	\N	f	6	\N	{已保存}	2026-02-14 13:51:55.488573	2026-05-07 16:26:52.640939
18	乡村村落_1778144396568	搭建一个漂亮的村子	乡村村落	{"objects": [{"type": "village", "count": 8, "layout": "clustered", "properties": {"size": "medium"}}, {"type": "cottage", "count": 3, "layout": "random", "properties": {"size": "varied"}}, {"type": "fence", "count": 12, "layout": "line", "properties": {"size": "medium"}}, {"type": "flower", "count": 25, "layout": "random", "properties": {"size": "small"}}, {"type": "tree", "count": 7, "layout": "random", "properties": {"size": "varied"}}, {"type": "hen", "count": 5, "layout": "random", "properties": {"size": "small"}}, {"type": "bush", "count": 6, "layout": "random", "properties": {"size": "medium"}}], "atmosphere": "宁静温馨，充满质朴的田园气息", "scene_type": "乡村村落"}	[{"type": "village", "scale": 1, "position": {"x": 12.003176740078473, "y": 0, "z": 18.21046582875011}, "rotation": {"x": 0, "y": 3.4349797381820264, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": 5.213177984561966, "y": 0, "z": 17.977736040869885}, "rotation": {"x": 0, "y": 2.8327809963925423, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": 12.695757391434938, "y": 0, "z": 2.97525575823958}, "rotation": {"x": 0, "y": 5.03755437842487, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": -6.164345841124872, "y": 0, "z": -0.39813280194429623}, "rotation": {"x": 0, "y": 2.785140856432001, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": -19.96572194259837, "y": 0, "z": -4.79221848351151}, "rotation": {"x": 0, "y": 4.762427342507575, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": 7.082341699218144, "y": 0, "z": -12.496564214509531}, "rotation": {"x": 0, "y": 5.16086437418633, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": 12.989753920556161, "y": 0, "z": 15.433290785916178}, "rotation": {"x": 0, "y": 5.290597796639636, "z": 0}, "properties": {"size": "medium"}}, {"type": "village", "scale": 1, "position": {"x": -19.0333750147223, "y": 0, "z": 11.973624457045364}, "rotation": {"x": 0, "y": 1.4044792176195138, "z": 0}, "properties": {"size": "medium"}}, {"type": "cottage", "scale": 0.8830622124546172, "position": {"x": 13.171544607558296, "y": 0, "z": 8.774879544131622}, "rotation": {"x": 0, "y": 2.853082996439306, "z": 0}, "properties": {"size": "varied"}}, {"type": "cottage", "scale": 0.8457645063625577, "position": {"x": 5.9425019668586, "y": 0, "z": 19.283134489485157}, "rotation": {"x": 0, "y": 3.5213838417399983, "z": 0}, "properties": {"size": "varied"}}, {"type": "cottage", "scale": 1.15761694593829, "position": {"x": 10.76507391197368, "y": 0, "z": -8.839461700859971}, "rotation": {"x": 0, "y": 6.152312562121212, "z": 0}, "properties": {"size": "varied"}}, {"type": "fence", "scale": 1, "position": {"x": -7.796164310892234, "y": 0, "z": 19.64042249656164}, "rotation": {"x": 0, "y": 5.954560823726074, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -13.795645111997302, "y": 0, "z": 9.500824156189125}, "rotation": {"x": 0, "y": 5.482007114962938, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -19.843438997264727, "y": 0, "z": -15.216229276525244}, "rotation": {"x": 0, "y": 5.515019707788071, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -8.796808349397889, "y": 0, "z": 7.764690321019824}, "rotation": {"x": 0, "y": 2.6154257171676787, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": 13.353901664695165, "y": 0, "z": 10.322920193837618}, "rotation": {"x": 0, "y": 5.377813666527424, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -10.342282309625158, "y": 0, "z": 2.773888233594292}, "rotation": {"x": 0, "y": 0.0296322519342012, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -13.73178704181107, "y": 0, "z": -11.94738237438794}, "rotation": {"x": 0, "y": 3.5856213219183233, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": 0.5196326850642841, "y": 0, "z": 2.509619541842895}, "rotation": {"x": 0, "y": 3.856277565153322, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": 10.017966801536456, "y": 0, "z": 13.891468122291556}, "rotation": {"x": 0, "y": 0.5254371454708746, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -19.824016616883537, "y": 0, "z": 1.4491814187104701}, "rotation": {"x": 0, "y": 1.4800208443678946, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": 19.681862034458312, "y": 0, "z": -11.286854527359704}, "rotation": {"x": 0, "y": 4.605478042290374, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -1.7431470421706834, "y": 0, "z": -17.169256659006148}, "rotation": {"x": 0, "y": 4.177959062598019, "z": 0}, "properties": {"size": "medium"}}, {"type": "flower", "scale": 0.7912870208054685, "position": {"x": 3.9472434287648674, "y": 0, "z": 15.657501342685066}, "rotation": {"x": 0, "y": 4.466854520210879, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.9238120688714014, "position": {"x": 11.08956835648053, "y": 0, "z": 5.429677673112586}, "rotation": {"x": 0, "y": 0.5279713531789045, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7989437391966634, "position": {"x": -3.2148205738757625, "y": 0, "z": -1.9255061023621245}, "rotation": {"x": 0, "y": 2.3210434662485264, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7322235508578069, "position": {"x": 6.069263962420742, "y": 0, "z": -6.111213886314889}, "rotation": {"x": 0, "y": 3.394608444689556, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.816098681183957, "position": {"x": -4.443944693250433, "y": 0, "z": 17.868487647488067}, "rotation": {"x": 0, "y": 6.138527039842847, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8985100218351917, "position": {"x": -14.090705794828548, "y": 0, "z": 4.471413154102692}, "rotation": {"x": 0, "y": 4.4140140188837185, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8672311495120878, "position": {"x": -2.327981495430599, "y": 0, "z": -5.378089617119954}, "rotation": {"x": 0, "y": 0.3826047219822487, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.9477253384322827, "position": {"x": -2.9247790846638537, "y": 0, "z": 17.30503824908765}, "rotation": {"x": 0, "y": 4.547623287171774, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8896030348782483, "position": {"x": 4.373941007486451, "y": 0, "z": -12.372010364641145}, "rotation": {"x": 0, "y": 5.945464866862949, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8470193758642518, "position": {"x": 10.837216286940766, "y": 0, "z": -9.054645083173591}, "rotation": {"x": 0, "y": 3.488631128753154, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8419035602732198, "position": {"x": 19.766794870899403, "y": 0, "z": -1.654728116815427}, "rotation": {"x": 0, "y": 1.1429315192796252, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.960547893713717, "position": {"x": 19.582145508009916, "y": 0, "z": 8.521279412849388}, "rotation": {"x": 0, "y": 1.9201582214058026, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.9973044645690227, "position": {"x": -16.089279221387635, "y": 0, "z": -6.516718075122929}, "rotation": {"x": 0, "y": 6.042754584712148, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.9794647502943116, "position": {"x": -6.977781950037215, "y": 0, "z": 18.543497314952795}, "rotation": {"x": 0, "y": 5.203586740045969, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7976998678571534, "position": {"x": 19.94764871360963, "y": 0, "z": -3.356056386820711}, "rotation": {"x": 0, "y": 2.9123163715131044, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8574413354864111, "position": {"x": -2.609324149947774, "y": 0, "z": -7.198893527426851}, "rotation": {"x": 0, "y": 0.1462841168679659, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7832738642069547, "position": {"x": 12.380678283670363, "y": 0, "z": 17.554538393873813}, "rotation": {"x": 0, "y": 4.457907366586032, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8144419988389832, "position": {"x": 11.222434694551403, "y": 0, "z": -11.470062396131674}, "rotation": {"x": 0, "y": 2.701797532175946, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.9878002617217426, "position": {"x": -4.726479853469181, "y": 0, "z": 11.79279891538345}, "rotation": {"x": 0, "y": 4.151451614955603, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.8427459980725519, "position": {"x": 4.749044740421731, "y": 0, "z": 11.748878763361606}, "rotation": {"x": 0, "y": 5.237597274889163, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7690249583486422, "position": {"x": 6.697953822613766, "y": 0, "z": -10.368676468113783}, "rotation": {"x": 0, "y": 4.678521683328124, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7709009590239954, "position": {"x": 0.15480789708963627, "y": 0, "z": 5.708913014930324}, "rotation": {"x": 0, "y": 0.6331739702254353, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7955327305253238, "position": {"x": 6.336574605849343, "y": 0, "z": -18.330457523360035}, "rotation": {"x": 0, "y": 3.7557686237413255, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7238329310966853, "position": {"x": -3.992542080834255, "y": 0, "z": -8.334001397340067}, "rotation": {"x": 0, "y": 1.9868912258931692, "z": 0}, "properties": {"size": "small"}}, {"type": "flower", "scale": 0.7327392232587314, "position": {"x": -10.643867117669291, "y": 0, "z": -7.656971610130348}, "rotation": {"x": 0, "y": 2.3000762289996857, "z": 0}, "properties": {"size": "small"}}, {"type": "tree", "scale": 1.2963039424155487, "position": {"x": -7.7687130629395185, "y": 0, "z": 6.39842927683533}, "rotation": {"x": 0, "y": 0.0389299328442552, "z": 0}, "properties": {"size": "varied"}}, {"type": "tree", "scale": 1.3653927258565675, "position": {"x": 5.196055954814035, "y": 0, "z": 3.1741978927025087}, "rotation": {"x": 0, "y": 3.059433517397481, "z": 0}, "properties": {"size": "varied"}}, {"type": "tree", "scale": 0.8789059726790462, "position": {"x": -10.305912848075929, "y": 0, "z": -4.198367301786909}, "rotation": {"x": 0, "y": 0.8492924145403096, "z": 0}, "properties": {"size": "varied"}}, {"type": "tree", "scale": 0.7158800026156031, "position": {"x": 15.250272528832362, "y": 0, "z": -0.07719205429712162}, "rotation": {"x": 0, "y": 1.7207465769365768, "z": 0}, "properties": {"size": "varied"}}, {"type": "tree", "scale": 1.3751412462425698, "position": {"x": -2.9088429940916924, "y": 0, "z": -12.438114433055736}, "rotation": {"x": 0, "y": 0.9431266535395849, "z": 0}, "properties": {"size": "varied"}}, {"type": "tree", "scale": 0.98416815667361, "position": {"x": -8.004444456401787, "y": 0, "z": 14.093710463311709}, "rotation": {"x": 0, "y": 3.9363940991513786, "z": 0}, "properties": {"size": "varied"}}, {"type": "tree", "scale": 1.0974791925860645, "position": {"x": -2.5250241712579466, "y": 0, "z": 12.853235741688842}, "rotation": {"x": 0, "y": 1.9892869017485955, "z": 0}, "properties": {"size": "varied"}}, {"type": "hen", "scale": 0.7687684887818125, "position": {"x": 8.655738697926392, "y": 0, "z": -16.410709048203497}, "rotation": {"x": 0, "y": 3.077788537733033, "z": 0}, "properties": {"size": "small"}}, {"type": "hen", "scale": 0.718037286310729, "position": {"x": 7.639402826485817, "y": 0, "z": -7.679139026962311}, "rotation": {"x": 0, "y": 2.0876000483964545, "z": 0}, "properties": {"size": "small"}}, {"type": "hen", "scale": 0.7769625097716778, "position": {"x": -8.999287243004805, "y": 0, "z": 13.154441535690182}, "rotation": {"x": 0, "y": 2.104000544277991, "z": 0}, "properties": {"size": "small"}}, {"type": "hen", "scale": 0.9435452425910545, "position": {"x": -5.740732568043342, "y": 0, "z": -2.406715460105037}, "rotation": {"x": 0, "y": 1.1309513213121358, "z": 0}, "properties": {"size": "small"}}, {"type": "hen", "scale": 0.8516272195549899, "position": {"x": -12.34212379323115, "y": 0, "z": -19.84867229179464}, "rotation": {"x": 0, "y": 5.37176996186972, "z": 0}, "properties": {"size": "small"}}, {"type": "bush", "scale": 1, "position": {"x": -18.191130208931767, "y": 0, "z": -13.316781328437548}, "rotation": {"x": 0, "y": 2.642267895139622, "z": 0}, "properties": {"size": "medium"}}, {"type": "bush", "scale": 1, "position": {"x": 1.857573122584533, "y": 0, "z": -13.116014233691615}, "rotation": {"x": 0, "y": 1.7834878074135374, "z": 0}, "properties": {"size": "medium"}}, {"type": "bush", "scale": 1, "position": {"x": 6.646469746008371, "y": 0, "z": -2.7639558381116984}, "rotation": {"x": 0, "y": 0.006039876642533112, "z": 0}, "properties": {"size": "medium"}}, {"type": "bush", "scale": 1, "position": {"x": 14.551403908567544, "y": 0, "z": -14.294246774044117}, "rotation": {"x": 0, "y": 3.782781934439131, "z": 0}, "properties": {"size": "medium"}}, {"type": "bush", "scale": 1, "position": {"x": 7.867993045559075, "y": 0, "z": -15.072370991598385}, "rotation": {"x": 0, "y": 4.210910605565571, "z": 0}, "properties": {"size": "medium"}}, {"type": "bush", "scale": 1, "position": {"x": -7.409632219441647, "y": 0, "z": 16.389860139902936}, "rotation": {"x": 0, "y": 3.1818208697242834, "z": 0}, "properties": {"size": "medium"}}]	58	豆包	\N	f	3	\N	{已保存}	2026-05-07 16:59:56.641647	2026-06-09 18:08:14.330752
19	城市露天停车场_1780999816476	生成一个停车场	城市露天停车场	{"objects": [{"type": "car", "count": 20, "layout": "grid", "properties": {"size": "varied"}}, {"type": "fence", "count": 4, "layout": "line", "properties": {"size": "medium"}}, {"type": "lamp", "count": 6, "layout": "grid", "properties": {"size": "medium"}}], "atmosphere": "规整有序，充满日常通勤的烟火气", "scene_type": "城市露天停车场"}	[{"type": "car", "scale": 0.8457109070083012, "position": {"x": -92.69932842452852, "y": 0, "z": 5.8597642985848175}, "rotation": {"x": 0, "y": 4.350974425403542, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.0794621449879753, "position": {"x": -93.03086218736935, "y": 0, "z": 9.687180927141974}, "rotation": {"x": 0, "y": 3.77383214925192, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.3706154980942256, "position": {"x": -95.68428238806838, "y": 0, "z": 17.97716617325358}, "rotation": {"x": 0, "y": 1.7351410588074105, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.3926082466748475, "position": {"x": -97.50395426761753, "y": 0, "z": -18.584801154141072}, "rotation": {"x": 0, "y": 2.6228315387004493, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.151977111128768, "position": {"x": -100.95880584344977, "y": 0, "z": 14.85219630103532}, "rotation": {"x": 0, "y": 0.7376826529489297, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.8394321512959646, "position": {"x": -106.83988318970174, "y": 0, "z": 19.844189918933175}, "rotation": {"x": 0, "y": 0.37177452685810775, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.9945996367911908, "position": {"x": -74.48252295110932, "y": 0, "z": -6.625440038340628}, "rotation": {"x": 0, "y": 3.1340057710434017, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.8012531231539078, "position": {"x": -110.01470667260193, "y": 0, "z": 10.421764980095276}, "rotation": {"x": 0, "y": 5.136948902198746, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.1172464768350012, "position": {"x": -88.29237806399132, "y": 0, "z": -2.5768903840833772}, "rotation": {"x": 0, "y": 5.730600292140322, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.0226388270697062, "position": {"x": -80.07243390266626, "y": 0, "z": -12.970159335533364}, "rotation": {"x": 0, "y": 5.629546253348273, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.0626189416778735, "position": {"x": -83.62082823439344, "y": 0, "z": 13.583485840435884}, "rotation": {"x": 0, "y": 6.2342851114575675, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.0536867861904855, "position": {"x": -89.82436444989965, "y": 0, "z": 16.44699108714824}, "rotation": {"x": 0, "y": 2.697409434146166, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.8569112300733902, "position": {"x": -91.79764972825768, "y": 0, "z": 17.184424740882427}, "rotation": {"x": 0, "y": 0.5512619549481734, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.7414878951639126, "position": {"x": -83.51205383355673, "y": 0, "z": -12.30847953493484}, "rotation": {"x": 0, "y": 1.456203758701311, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.742669880360198, "position": {"x": -109.89609501350537, "y": 0, "z": 14.224256510512156}, "rotation": {"x": 0, "y": 0.9060769825700146, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 0.9097552819189758, "position": {"x": -102.8767268315214, "y": 0, "z": -11.235893033104363}, "rotation": {"x": 0, "y": 3.691639300211942, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.1778453962570037, "position": {"x": -107.2899963890973, "y": 0, "z": -13.997963405868221}, "rotation": {"x": 0, "y": 2.2238507036138846, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.3193224206664265, "position": {"x": -77.81334467709485, "y": 0, "z": -3.696121710051308}, "rotation": {"x": 0, "y": 2.2207966066737175, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.0650846708660477, "position": {"x": -99.75668027961066, "y": 0, "z": -19.983961030440195}, "rotation": {"x": 0, "y": 5.655400480146476, "z": 0}, "properties": {"size": "varied"}}, {"type": "car", "scale": 1.3807470502463193, "position": {"x": -86.6644257616234, "y": 0, "z": 7.812707007817771}, "rotation": {"x": 0, "y": 4.745979159896754, "z": 0}, "properties": {"size": "varied"}}, {"type": "fence", "scale": 1, "position": {"x": -80.65925466754643, "y": 0, "z": -7.368229089478895}, "rotation": {"x": 0, "y": 4.913008126988918, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -111.49844353904692, "y": 0, "z": 1.4215746180818698}, "rotation": {"x": 0, "y": 0.7129906179864811, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -102.56463857601825, "y": 0, "z": -14.842540046237236}, "rotation": {"x": 0, "y": 3.6842488396461466, "z": 0}, "properties": {"size": "medium"}}, {"type": "fence", "scale": 1, "position": {"x": -82.2641185566664, "y": 0, "z": -3.912599695070181}, "rotation": {"x": 0, "y": 5.972457101530659, "z": 0}, "properties": {"size": "medium"}}, {"type": "lamp", "scale": 1, "position": {"x": -100.7962526179312, "y": 0, "z": -6.665359547292855}, "rotation": {"x": 0, "y": 4.818008026315016, "z": 0}, "properties": {"size": "medium"}}, {"type": "lamp", "scale": 1, "position": {"x": -109.77956758721325, "y": 0, "z": 15.742016655482544}, "rotation": {"x": 0, "y": 1.8839311679198874, "z": 0}, "properties": {"size": "medium"}}, {"type": "lamp", "scale": 1, "position": {"x": -92.56637761022756, "y": 0, "z": 10.526311007545125}, "rotation": {"x": 0, "y": 3.689452889990805, "z": 0}, "properties": {"size": "medium"}}, {"type": "lamp", "scale": 1, "position": {"x": -86.13802328558415, "y": 0, "z": -3.054824631302818}, "rotation": {"x": 0, "y": 2.439727340014645, "z": 0}, "properties": {"size": "medium"}}, {"type": "lamp", "scale": 1, "position": {"x": -94.19286801701125, "y": 0, "z": -5.080460394896473}, "rotation": {"x": 0, "y": 3.255070262903024, "z": 0}, "properties": {"size": "medium"}}, {"type": "lamp", "scale": 1, "position": {"x": -81.68731549927497, "y": 0, "z": -5.6849999879446}, "rotation": {"x": 0, "y": 0.2425926305726318, "z": 0}, "properties": {"size": "medium"}}]	30	豆包	\N	f	1	\N	{已保存}	2026-06-09 18:10:16.546669	2026-06-09 18:10:17.047139
\.


--
-- Data for Name: ai_provider_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_provider_audit_log (id, provider_id, action, config_key, old_value, new_value, changed_by, ip_address, changed_at) FROM stdin;
1	1	config_updated	secret_id	****	****	\N	::1	2026-02-13 09:18:57.869003
2	1	config_updated	secret_key	****	****	\N	::1	2026-02-13 09:18:57.907637
3	1	config_updated	region	\N	ap-guangzhou	\N	::1	2026-02-13 09:18:57.91005
4	4	enabled	\N	\N	\N	\N	::1	2026-02-13 10:43:23.861394
5	4	config_updated	secret_id	****	****	\N	::1	2026-02-13 10:43:40.927419
6	4	config_updated	secret_key	****	****	\N	::1	2026-02-13 10:43:40.979371
7	4	config_updated	region	\N	ap-guangzhou	\N	::1	2026-02-13 10:43:40.983193
8	2	config_updated	api_key	****	****	\N	::1	2026-02-13 12:05:40.282771
9	2	config_updated	base_url	\N	https://dashscope.aliyuncs.com/api/v1	\N	::1	2026-02-13 12:05:40.286917
10	2	config_updated	model	\N	qwen-plus	\N	::1	2026-02-13 12:05:40.319532
11	2	enabled	\N	\N	\N	\N	::1	2026-02-13 12:05:52.396344
12	2	config_updated	api_key	****	****	\N	::1	2026-02-13 14:22:55.611278
13	2	config_updated	base_url	https://dashscope.aliyuncs.com/api/v1	https://dashscope.aliyuncs.com/api/v1	\N	::1	2026-02-13 14:22:55.614274
14	2	config_updated	model	qwen-plus	qwen-flash-character	\N	::1	2026-02-13 14:22:55.616606
15	3	config_updated	api_key	****	****	\N	::1	2026-02-13 14:34:49.748988
16	3	config_updated	endpoint_id	\N	ep-20260213143449-gjjnp	\N	::1	2026-02-13 14:34:49.7522
17	3	config_updated	base_url	\N	https://ark.cn-beijing.volces.com/api/v3	\N	::1	2026-02-13 14:34:49.754865
18	3	enabled	\N	\N	\N	\N	::1	2026-02-13 14:34:52.872116
19	1	disabled	\N	\N	\N	\N	::1	2026-03-02 16:07:11.82773
20	1	enabled	\N	\N	\N	\N	::1	2026-03-02 16:07:14.770155
21	2	set_default	\N	\N	\N	\N	::1	2026-03-02 16:07:21.667604
22	1	disabled	\N	\N	\N	\N	::1	2026-07-10 17:58:22.632026
23	2	disabled	\N	\N	\N	\N	::1	2026-07-10 17:58:23.523812
24	4	disabled	\N	\N	\N	\N	::1	2026-07-10 17:58:24.381929
25	4	enabled	\N	\N	\N	\N	::1	2026-07-10 17:58:26.755805
26	4	disabled	\N	\N	\N	\N	::1	2026-07-10 17:58:27.566026
27	4	enabled	\N	\N	\N	\N	::1	2026-07-10 17:58:28.93558
28	4	disabled	\N	\N	\N	\N	::1	2026-07-10 17:58:30.206352
\.


--
-- Data for Name: ai_provider_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_provider_configs (id, provider_id, config_key, config_value, is_sensitive, display_order, updated_by, updated_at) FROM stdin;
1	1	secret_id	c23a961acbd7e39ce2504bddc9fcc8e7911842826737b329ab3b78f3f19300a2b05c846db1b99a299e66617a77dc6d0b	t	0	\N	2026-02-13 09:18:57.849612
2	1	secret_key	fffb5b05fc7568b33f74c9a61942f139736f761e5e0f7b49771f1726a5c040f341bb0ed5b44e30e09d8c9d1a283a3472	t	0	\N	2026-02-13 09:18:57.906861
3	1	region	ap-guangzhou	f	0	\N	2026-02-13 09:18:57.909569
4	4	secret_id	c23a961acbd7e39ce2504bddc9fcc8e7911842826737b329ab3b78f3f19300a2b05c846db1b99a299e66617a77dc6d0b	t	0	\N	2026-02-13 10:43:40.878437
5	4	secret_key	fffb5b05fc7568b33f74c9a61942f139736f761e5e0f7b49771f1726a5c040f341bb0ed5b44e30e09d8c9d1a283a3472	t	0	\N	2026-02-13 10:43:40.978345
6	4	region	ap-guangzhou	f	0	\N	2026-02-13 10:43:40.982254
7	2	api_key	bcc773499fa88a74443f951e6f31f9cd808bc80e5ff8108a2c3a3c296adfbb9da55513769d6d6abd1107a5a3b8b9f94a	t	0	\N	2026-02-13 14:22:55.608295
8	2	base_url	https://dashscope.aliyuncs.com/api/v1	f	0	\N	2026-02-13 14:22:55.613883
9	2	model	qwen-flash-character	f	0	\N	2026-02-13 14:22:55.616154
13	3	api_key	e28115a00f3c4bdc6e5cb53dbe0e73e67e58c36e5d7e9b9e24224282beade80b266c90a8ec628cd7a29061970ba50508	t	0	\N	2026-02-13 14:34:49.735136
14	3	endpoint_id	ep-20260213143449-gjjnp	f	0	\N	2026-02-13 14:34:49.751663
15	3	base_url	https://ark.cn-beijing.volces.com/api/v3	f	0	\N	2026-02-13 14:34:49.754279
\.


--
-- Data for Name: ai_providers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_providers (id, provider_name, display_name, provider_type, is_enabled, is_default, config_schema, icon_url, description, created_at, updated_at) FROM stdin;
5	tripo	Tripo AI	image_to_3d,text_to_3d	f	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "description": "Tripo AI的API密钥，可在 https://platform.tripo3d.ai 获取", "placeholder": "tsk-开头的API密钥"}, {"key": "mode", "type": "select", "label": "生成模式", "default": "preview", "options": ["preview", "refine"], "required": false, "sensitive": false, "description": "preview(快速预览) 或 refine(精细化)"}, {"key": "model_version", "type": "text", "label": "模型版本", "default": "v2.0-20240919", "required": false, "sensitive": false, "description": "API模型版本号"}], "pricing": {"refine": "精细模式约2-5分钟", "preview": "快速模式约10-30秒"}, "docs_url": "https://platform.tripo3d.ai/docs", "features": ["image_to_3d", "text_to_3d"]}	https://platform.tripo3d.ai/favicon.ico	Tripo AI - 专业的AI图片/文本转3D模型服务，支持快速预览和精细化生成	2026-02-13 10:44:09.532864	2026-02-13 10:44:09.532864
6	openai_chatgpt	OpenAI ChatGPT	chat	f	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "sk-开头的OpenAI API密钥"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://api.openai.com/v1", "required": false, "sensitive": false, "placeholder": "https://api.openai.com/v1 或代理地址"}, {"key": "model", "type": "select", "label": "模型", "default": "gpt-3.5-turbo", "options": ["gpt-4", "gpt-4-turbo-preview", "gpt-3.5-turbo", "gpt-3.5-turbo-16k"], "required": true, "sensitive": false, "description": "选择要使用的GPT模型"}, {"key": "temperature", "max": "2", "min": "0", "step": "0.1", "type": "number", "label": "创造性", "default": "0.7", "required": false, "sensitive": false, "description": "控制回答的随机性，0-2之间，数值越高越有创造性"}, {"key": "max_tokens", "max": "4096", "min": "1", "type": "number", "label": "最大令牌数", "default": "2000", "required": false, "sensitive": false, "description": "单次回复的最大长度"}], "features": ["chat", "scene_generation"]}	https://openai.com/favicon.ico	OpenAI ChatGPT大模型，支持AI对话、场景生成等功能。支持GPT-4和GPT-3.5系列模型。	2026-02-13 11:18:15.558016	2026-02-13 11:18:15.558016
4	tencent_hunyuan3d	腾讯混元3D	image_to_3d,text_to_3d	f	f	{"fields": [{"key": "secret_id", "type": "text", "label": "Secret ID", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"}, {"key": "secret_key", "type": "password", "label": "Secret Key", "required": true, "sensitive": true, "placeholder": "32位字符串"}, {"key": "region", "type": "select", "label": "地域", "default": "ap-guangzhou", "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "required": true, "sensitive": false}]}	\N	腾讯混元3D，支持图片转3D模型、文字生成3D等	2026-02-13 08:58:53.642456	2026-07-10 17:58:30.20516
3	bytedance_doubao	字节豆包	chat	t	f	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "输入豆包API密钥"}, {"key": "endpoint_id", "type": "text", "label": "接入点ID", "required": true, "sensitive": false, "placeholder": "ep-开头的ID"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://ark.cn-beijing.volces.com/api/v3", "required": false, "sensitive": false, "placeholder": "https://ark.cn-beijing.volces.com/api/v3"}]}	\N	字节跳动豆包大模型，支持对话、文本生成等	2026-02-13 08:58:53.642456	2026-02-13 14:34:52.870753
1678	tripo_ai	Tripo AI	image_to_3d,text_to_3d	f	f	{"fields": [{"key": "api_token", "type": "password", "label": "API Token", "required": true, "sensitive": true, "placeholder": "Tripo AI API Token"}]}	\N	Tripo AI，支持图片转3D模型、文字生成3D等	2026-07-09 18:31:42.545811	2026-07-09 18:31:42.545811
1	tencent_hunyuan	腾讯混元	chat	f	f	{"fields": [{"key": "secret_id", "type": "text", "label": "Secret ID", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"}, {"key": "secret_key", "type": "password", "label": "Secret Key", "required": true, "sensitive": true, "placeholder": "32位字符串"}, {"key": "region", "type": "select", "label": "地域", "default": "ap-guangzhou", "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "required": true, "sensitive": false}]}	\N	腾讯混元大模型，支持对话、图生3D等功能	2026-02-13 08:58:53.642456	2026-07-10 17:58:22.627926
2	aliyun_qianwen	阿里通义千问	chat	f	t	{"fields": [{"key": "api_key", "type": "password", "label": "API Key", "required": true, "sensitive": true, "placeholder": "sk-开头的密钥"}, {"key": "base_url", "type": "text", "label": "API地址", "default": "https://dashscope.aliyuncs.com/api/v1", "required": false, "sensitive": false, "placeholder": "https://dashscope.aliyuncs.com/api/v1"}, {"key": "model", "type": "select", "label": "模型", "default": "qwen-plus", "options": ["qwen-max", "qwen-plus", "qwen-turbo"], "required": true, "sensitive": false}]}	\N	阿里云通义千问大模型，支持对话、文本生成等	2026-02-13 08:58:53.642456	2026-07-10 17:58:23.522697
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
979a796d-906d-47cf-ba6e-9234e3d83309	00000000-0000-0000-0000-000000000001	立方体	geometry:box	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.816011	2026-06-05 15:49:20.816011	{}	geometry	["基础几何体", "立方体"]
e217f33c-866b-4513-bcb5-903ac09efb03	00000000-0000-0000-0000-000000000001	球体	geometry:sphere	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.817671	2026-06-05 15:49:20.817671	{}	geometry	["基础几何体", "球体"]
9222766f-11bb-4e82-ba5e-d28dae76fec1	00000000-0000-0000-0000-000000000001	圆柱体	geometry:cylinder	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.818621	2026-06-05 15:49:20.818621	{}	geometry	["基础几何体", "圆柱体"]
dff6365f-ef5d-4fd9-bf7b-d987bb74eaba	00000000-0000-0000-0000-000000000001	圆锥体	geometry:cone	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.819362	2026-06-05 15:49:20.819362	{}	geometry	["基础几何体", "圆锥体"]
b0e57c7a-36cb-43d8-ad09-1ca4e0ab989f	00000000-0000-0000-0000-000000000001	平面	geometry:plane	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.820235	2026-06-05 15:49:20.820235	{}	geometry	["基础几何体", "平面"]
6ee451d7-f00d-48a0-a58c-4a4b471f96d4	00000000-0000-0000-0000-000000000001	圆环	geometry:torus	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.821043	2026-06-05 15:49:20.821043	{}	geometry	["基础几何体", "圆环"]
65ad2c12-0267-4e25-b18d-6226196a764c	00000000-0000-0000-0000-000000000001	圆环结	geometry:torus_knot	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.822912	2026-06-05 15:49:20.822912	{}	geometry	["基础几何体", "圆环结"]
ada8dfff-a3c7-48bc-9995-ebfe1e4ee422	00000000-0000-0000-0000-000000000001	二十面体	geometry:icosahedron	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.824654	2026-06-05 15:49:20.824654	{}	geometry	["基础几何体", "二十面体"]
dbbb8393-1aaf-4f79-bdc4-2ebdc95b507a	00000000-0000-0000-0000-000000000001	十二面体	geometry:dodecahedron	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.825627	2026-06-05 15:49:20.825627	{}	geometry	["基础几何体", "十二面体"]
6d858caf-f3d2-4d75-9cbf-b1c80dc7b0c0	00000000-0000-0000-0000-000000000001	八面体	geometry:octahedron	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.82655	2026-06-05 15:49:20.82655	{}	geometry	["基础几何体", "八面体"]
5a39026d-a946-4857-8cc5-96dc448ff4f5	00000000-0000-0000-0000-000000000001	四面体	geometry:tetrahedron	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.827351	2026-06-05 15:49:20.827351	{}	geometry	["基础几何体", "四面体"]
39151a0c-b283-4d39-9553-df55c6abddcc	00000000-0000-0000-0000-000000000001	环形	geometry:ring	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.828077	2026-06-05 15:49:20.828077	{}	geometry	["基础几何体", "环形"]
ccd34c20-7a3d-4e0a-8f3c-ce7992a47364	00000000-0000-0000-0000-000000000001	旋转体	geometry:lathe	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.828799	2026-06-05 15:49:20.828799	{}	geometry	["基础几何体", "旋转体"]
de0b4868-0c1b-4b2b-806d-1841ee18fe6c	00000000-0000-0000-0000-000000000001	胶囊体	geometry:capsule	\N	\N	{"x": 1, "y": 1, "z": 1}	[]	2026-06-05 15:49:20.829577	2026-06-05 15:49:20.829577	{}	geometry	["基础几何体", "胶囊体"]
\.


--
-- Data for Name: character_appearance; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.character_appearance (id, character_id, face_brows, face_glasses, face_nose, face_skin, face_ears, face_mouth, face_beard, face_jaw, hair, top_wear, bottom_wear, shoes, created_at, updated_at) FROM stdin;
f3e75d1d-1204-4935-b3fc-7e14672b70f4	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-10 11:40:31.586071	2026-02-10 11:40:31.586071
34f23ffe-6eb6-4b06-809a-729dc5061d4d	2adb4c4c-b7ec-4366-83bf-423cd455a858	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-10 11:44:46.463893	2026-02-10 11:44:46.463893
197c0cd9-6f29-4a6c-b0c7-e8c3a7aaab26	c878ce00-000d-44b4-a998-fec6ad8641c5	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-10 13:31:37.696822	2026-02-10 13:31:37.696822
4b3c8143-d152-44ee-86df-edeafd70101a	dd90434b-e31b-44d5-81b1-b0fc1efa5145	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-10 17:46:29.743128	2026-02-10 17:46:29.743128
95187241-195b-477b-a0d6-abaa66bc1323	56294dad-9f9c-4e86-9d74-41efb5fe5138	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-03-19 12:11:17.035527	2026-03-19 12:11:17.035527
\.


--
-- Data for Name: character_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.character_templates (id, name, description, glb_url, glb_hash, thumbnail_url, access_level, character_role, is_active, is_default, sort_order, created_at, updated_at, created_by_admin_id, created_by_name, anim_walk_url, anim_run_url, anim_jump_url, anim_attack1_url, anim_hit_url, anim_death_url, anim_attack2_url, anim_attack3_url, anim_idle_url, anim_turn_left_url, anim_turn_right_url, anim_attack_stab_url, anim_attack_slash_url, anim_attack_swing_url, anim_attack_uppercut_url, anim_sheath_url, anim_draw_sword_url, anim_set, weapon_id, weapon_config, bone_map, anim_sounds, weapon_sounds, is_federated, source_world_id, source_template_id, resource_urls, anim_adapt, last_sync_time, fit_config, calibration_config, weapon_socket_config, bone_mapping_config, is_calibrated, calibrated_at, calibration_version, model_source_platform, selected_anim_platform, anim_mode) FROM stdin;
f1ec4974-40e1-4feb-9840-1ec79a4f9af3	拿剑武士	\N	/uploads/character-templates/char-1779180094927-135896146.glb	83158057aaf55b8f36da61970995b9a887e4b67b8a5787d3e342a760ff9bf700	\N	public	player	t	f	0	2026-05-19 16:41:35.084811	2026-05-29 17:55:40.7114	\N	\N	/uploads/anim-library/anim-1779416734316-192850102.glb	/uploads/anim-library/anim-1779359981454-823651996.glb	/uploads/anim-library/anim-1779415657416-64578244.glb	\N	\N	\N	\N	\N	/uploads/anim-library/anim-1780048384423-799659208.glb	/uploads/anim-library/anim-1779272114900-270542364.fbx	\N	\N	\N	\N	\N	\N	\N	{}	\N	{}	{"root": "mixamorigRightToeBase", "camera": "mixamorigHeadTop_End", "rightHand": "mixamorigRightHandIndex4"}	{}	{}	f	\N	\N	{}	{}	\N	{}	{"centerPoint": {"x": 0, "y": 0, "z": 0}, "groundHeight": 0.3325078470710459, "isCalibrated": false, "footContactPoints": [{"x": -0.8262387450120594, "y": 1.2597380435999943, "z": 0.2975605534302194, "boneName": "mixamorigRightHandIndex4"}, {"x": 0.04835962921121364, "y": 0.3325078470710459, "z": 0.02713564121622669, "boneName": "mixamorigLeftLeg"}]}	{"rightHand": {"boneName": "mixamorigRightHandIndex4", "position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": -8.246699343845549, "y": -29.660519065993466, "z": 50.65688022453326}, "confirmed": false, "weaponType": "lightsaber"}}	{}	f	2026-05-19 17:46:19.539	1	auto	mixamo	platform
14b7f405-8343-4c3d-8890-7df209b7b20a	几何体棍人	内置默认方块人角色模板	\N	\N	\N	public	player	t	f	0	2026-02-26 11:41:30.391468	2026-03-19 16:42:21.135681	1	admin	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	{}	{}	{}	{}	f	\N	\N	{}	{}	\N	{}	{}	{}	{}	f	\N	1	\N	\N	custom
2ba116c5-961c-44db-8238-ca9b5aed06e1	测试跳跃不管用		/uploads/character-templates/char-1779357967829-417752268.glb	e77b44a0d44763558ca2af3666654e96717ab657ed11289581c16c7660abe65c	\N	public	player	t	f	0	2026-05-21 18:06:08.129182	2026-05-22 10:28:18.870936	\N	\N	/uploads/character-templates/char-1779416898866-656472072.glb	/uploads/character-templates/char-1779416755203-179653250.glb	/uploads/character-templates/char-1779415813676-676466044.glb	\N	\N	\N	\N	\N	/uploads/character-templates/char-1779410355442-617521426.glb	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	{}	{}	{}	{}	f	\N	\N	{}	{}	\N	{}	{"centerPoint": {"x": 0.012446854582853328, "y": 1.7496194014966062, "z": 0.03892747316925452}, "groundHeight": 0, "isCalibrated": true, "footContactPoints": []}	{"rightHand": {"boneName": "mixamorigRightHandIndex2", "position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 90}, "confirmed": true, "weaponType": "lightsaber"}}	{}	t	2026-05-22 08:46:09.549	1	auto		custom
bc350a2f-4af9-436d-b367-5538c0d4ff05	metool转GLB	\N	/uploads/character-templates/char-1780047374315-163599099.glb	02a7af0bdc27f221966304e6cf3ea6e112c2d441ccb05258d21b4e616430116e	\N	public	player	t	f	0	2026-05-29 17:36:14.531964	2026-05-29 17:36:14.957401	\N	\N	/uploads/anim-library/anim-1779416734316-192850102.glb	/uploads/anim-library/anim-1779359981454-823651996.glb	/uploads/anim-library/anim-1779415657416-64578244.glb	\N	\N	\N	\N	\N	/uploads/anim-library/anim-1779417216335-269714658.glb	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	{}	{}	{}	{}	f	\N	\N	{}	{}	\N	{}	{}	{}	{}	f	\N	1	auto	mixamo	platform
3e7089c4-0b2e-46e3-b51e-6bcffdb186e1	新生成美女无皮		/uploads/character-templates/char-1780308958337-973251791.glb	240fc219c2849824a505e9d0b5bba2ee3febc8c7d195cb6862bb763761971269	\N	public	player	t	f	0	2026-06-01 18:15:58.517934	2026-06-05 17:09:49.96662	\N	\N	/uploads/anim-library/anim-1779416734316-192850102.glb	/uploads/anim-library/anim-1779359981454-823651996.glb	/uploads/anim-library/anim-1779415657416-64578244.glb	\N	\N	\N	\N	\N	/uploads/anim-library/anim-1780048384423-799659208.glb	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	{}	{"root": "mixamorigRightToeBase", "camera": "mixamorigHead", "rightHand": "mixamorigRightHandThumb3"}	{}	{}	f	\N	\N	{}	{}	\N	{}	{"centerPoint": {"x": -0.04590518321274256, "y": 0.8999984678187027, "z": -0.021532169358142242}, "groundHeight": 0, "isCalibrated": true, "footContactPoints": []}	{"rightHand": {"boneName": "mixamorigRightHandThumb3", "position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 5, "y": -18, "z": 56}, "confirmed": true, "weaponType": "lightsaber"}}	{}	t	2026-06-05 17:08:03.566	1	auto	mixamo	platform
4601e5eb-2fe0-4ee3-9c8f-9f180bd12db4	美女	\N	/uploads/character-templates/char-1780048961474-732397004.glb	3a4129753850bc0997c1719a211f74c39ca5d1e987707eccee3cc1cb943f50cd	\N	public	player	t	f	0	2026-05-29 18:02:41.504398	2026-05-29 18:03:38.911408	\N	\N	/uploads/anim-library/anim-1779416734316-192850102.glb	/uploads/anim-library/anim-1779359981454-823651996.glb	/uploads/anim-library/anim-1779415657416-64578244.glb	\N	\N	\N	\N	\N	/uploads/anim-library/anim-1780048384423-799659208.glb	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	{}	{"root": "mixamorigRightToeBase", "camera": "mixamorigHeadTop_End", "rightHand": "mixamorigRightHandThumb3"}	{}	{}	f	\N	\N	{}	{}	\N	{}	{"centerPoint": {"x": -0.0000028924539636765445, "y": 0.9038501276622688, "z": 0.0237226763956932}, "groundHeight": 0, "isCalibrated": true, "footContactPoints": []}	{"rightHand": {"boneName": "mixamorigRightHandThumb3", "position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 90}, "confirmed": true, "weaponType": "lightsaber"}}	{}	t	2026-05-29 18:03:38.845	1	auto	mixamo	platform
fe29ed57-d8e0-4d9d-aaaf-21c1580ad05d	线上转换的GLB		/uploads/character-templates/char-1772847423638-210646326.glb	43a4067dc12fdaefa1b2d7dcf965daa354c85b3b884b7af21a38160f0d44cf0e	\N	public	player	t	f	0	2026-03-07 09:37:03.641235	2026-05-11 11:18:16.889645	1	admin	/uploads/character-templates/char-1774260405787-934220533.glb	/uploads/character-templates/char-1774312314965-745337669.glb	/uploads/character-templates/char-1772848040796-913064136.glb	/uploads/character-templates/char-1774312328044-927828072.glb	/uploads/character-templates/char-1772848040799-927322448.glb	/uploads/character-templates/char-1774312587122-55241138.glb	/uploads/character-templates/char-1772848040803-864301574.glb	/uploads/character-templates/char-1772848040803-314671954.glb	/uploads/character-templates/char-1772848040795-98054925.glb	/uploads/character-templates/char-1774337750574-469704013.glb	/uploads/character-templates/char-1774337750575-437692745.glb	/uploads/character-templates/char-1774312498749-614683128.glb	/uploads/character-templates/char-1774312498750-297291784.glb	/uploads/character-templates/char-1774312498750-971457143.glb	/uploads/character-templates/char-1774312498751-717846157.glb	/uploads/character-templates/char-1772848040802-98513754.glb	/uploads/character-templates/char-1772848040801-863156404.glb	{}	7484376f-41f6-404a-befe-4acbcbca7e2a	{}	{"root": "mixamorigLeftToeBase", "camera": "mixamorigHeadTop_End", "rightHand": "mixamorigRightHandIndex4"}	{"idle": "/uploads/character-templates/sounds/sound-1778469413508-827206774.mp3"}	{}	f	\N	\N	{}	{}	\N	{}	{"centerPoint": {"x": -0.0037289997235732675, "y": -0.0019775140278220776, "z": 0.0013134407079507526}, "groundHeight": 0.0123146422430119, "isCalibrated": true, "footContactPoints": [{"x": 0.07910201837323078, "y": 0.0123146422430119, "z": -0.04741097506597146, "boneName": "mixamorigLeftFoot"}, {"x": -0.0871950389263313, "y": 0.026068782837541694, "z": -0.047410975132010744, "boneName": "mixamorigRightFoot"}]}	{"rightHand": {"boneName": "mixamorigRightHandIndex4", "position": {"x": -0.010572414574446576, "y": 0.0012401187014590143, "z": 0.004324218066826327}, "rotation": {"x": -28, "y": 30, "z": 0}, "confirmed": true, "weaponType": "lightsaber"}}	{}	t	2026-03-25 18:08:52.502	1	\N	\N	custom
\.


--
-- Data for Name: characters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.characters (id, user_id, name, level, health, max_health, attack_power, defense, experience, "position", respawn_point, created_at, updated_at, last_position, last_online, realname, bio) FROM stdin;
96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	0c4dadd7-71f7-4074-974f-533a201aa382	大志哥_character	1	100	100	10	5	0	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	2026-02-10 11:40:31.581207	2026-02-10 11:40:31.581207	\N	2026-02-27 17:33:49.353129	\N	\N
c878ce00-000d-44b4-a998-fec6ad8641c5	c0ebeb63-5709-4cfc-a27a-ac179e48b0f2	大侠w_character	1	100	100	10	5	0	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	2026-02-10 13:31:37.69361	2026-02-10 13:31:37.69361	\N	2026-02-27 17:33:49.353129	\N	\N
2adb4c4c-b7ec-4366-83bf-423cd455a858	899b45d8-6d56-4903-b1f3-788a00f60064	米多	1	100	100	10	5	90	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	2026-02-10 11:44:46.460811	2026-07-23 11:26:13.971911	{"x": -22.44, "y": 9.64, "z": 2.74}	2026-08-08 05:43:27.678434	\N	\N
56294dad-9f9c-4e86-9d74-41efb5fe5138	e0bc4767-f17e-4992-89ae-8feb0a633d03	大志哥	1	100	100	10	5	40	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	2026-03-19 12:11:17.031577	2026-06-08 09:42:46.678762	{"x": -18.58, "y": 12.57, "z": 6.34}	2026-07-23 17:11:02.49359	大志	你好啊
dd90434b-e31b-44d5-81b1-b0fc1efa5145	1b6da92b-2a69-41c4-a6c2-a221799c9438	miduo200_character	1	100	100	10	5	0	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	2026-02-10 17:46:29.741022	2026-02-10 17:46:29.741022	{"x": -43.92, "y": 2, "z": -6.43}	2026-04-25 09:42:23.005486	\N	\N
\.


--
-- Data for Name: config_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.config_audit_log (id, config_key, old_value, new_value, changed_by, changed_at, ip_address) FROM stdin;
1	TENCENT_SECRET_ID	****	****	1	2026-02-11 09:20:27.782113	::1
2	TENCENT_SECRET_KEY	****	****	1	2026-02-11 09:20:27.78784	::1
3	TENCENT_REGION	ap-guangzhou	ap-shanghai	1	2026-02-11 09:20:27.789393	::1
4	TENCENT_SECRET_ID	****	****	1	2026-02-11 09:56:17.608545	::1
5	TENCENT_SECRET_KEY	****	****	1	2026-02-11 09:56:17.612613	::1
6	TENCENT_REGION	ap-guangzhou	ap-guangzhou	1	2026-02-11 09:56:17.614621	::1
7	model_guard.max_file_size	\N	10	\N	2026-07-31 16:53:49.544327	::1
8	model_guard.max_triangles	\N	50000	\N	2026-07-31 16:53:49.584968	::1
9	model_guard.max_vertices	\N	30000	\N	2026-07-31 16:53:49.586708	::1
10	model_guard.max_mesh_count	\N	20	\N	2026-07-31 16:53:49.58832	::1
11	model_guard.enabled	\N	false	\N	2026-07-31 16:53:49.589856	::1
12	model_guard.show_warning	\N	false	\N	2026-07-31 16:53:49.59258	::1
13	model_guard.placeholder_style	\N	stickman	\N	2026-07-31 16:53:49.595377	::1
14	model_guard.character_bundle_mode	\N	retarget	\N	2026-07-31 16:53:49.597419	::1
15	model_guard.anim_guard_enabled	\N	false	\N	2026-07-31 16:53:49.599434	::1
16	model_guard.anim_max_file_size	\N	5	\N	2026-07-31 16:53:49.601339	::1
17	model_guard.anim_max_tracks	\N	200	\N	2026-07-31 16:53:49.603131	::1
18	model_guard.anim_max_keyframes	\N	20000	\N	2026-07-31 16:53:49.604689	::1
19	model_guard.anim_max_duration	\N	30	\N	2026-07-31 16:53:49.606188	::1
20	model_guard.anim_max_meshes	\N	10	\N	2026-07-31 16:53:49.608192	::1
21	model_guard.anim_total_max_size	\N	30	\N	2026-07-31 16:53:49.611488	::1
22	model_guard.anim_guard_remote_only	\N	false	\N	2026-07-31 16:53:49.613925	::1
23	model_guard.max_file_size	10	10	\N	2026-07-31 16:53:52.604667	::1
24	model_guard.max_triangles	50000	50000	\N	2026-07-31 16:53:52.605949	::1
25	model_guard.max_vertices	30000	30000	\N	2026-07-31 16:53:52.607194	::1
26	model_guard.max_mesh_count	20	20	\N	2026-07-31 16:53:52.609988	::1
27	model_guard.enabled	false	false	\N	2026-07-31 16:53:52.611744	::1
28	model_guard.show_warning	false	false	\N	2026-07-31 16:53:52.613337	::1
29	model_guard.placeholder_style	stickman	stickman	\N	2026-07-31 16:53:52.614726	::1
30	model_guard.character_bundle_mode	retarget	self_contained	\N	2026-07-31 16:53:52.616058	::1
31	model_guard.anim_guard_enabled	false	false	\N	2026-07-31 16:53:52.617439	::1
32	model_guard.anim_max_file_size	5	5	\N	2026-07-31 16:53:52.618735	::1
33	model_guard.anim_max_tracks	200	200	\N	2026-07-31 16:53:52.620005	::1
34	model_guard.anim_max_keyframes	20000	20000	\N	2026-07-31 16:53:52.621322	::1
35	model_guard.anim_max_duration	30	30	\N	2026-07-31 16:53:52.622545	::1
36	model_guard.anim_max_meshes	10	10	\N	2026-07-31 16:53:52.623757	::1
37	model_guard.anim_total_max_size	30	30	\N	2026-07-31 16:53:52.626265	::1
38	model_guard.anim_guard_remote_only	false	false	\N	2026-07-31 16:53:52.628246	::1
39	model_guard.max_file_size	10	10	\N	2026-07-31 16:53:55.067228	::1
40	model_guard.max_triangles	50000	50000	\N	2026-07-31 16:53:55.068619	::1
41	model_guard.max_vertices	30000	30000	\N	2026-07-31 16:53:55.069863	::1
42	model_guard.max_mesh_count	20	20	\N	2026-07-31 16:53:55.071101	::1
43	model_guard.enabled	false	false	\N	2026-07-31 16:53:55.072425	::1
44	model_guard.show_warning	false	false	\N	2026-07-31 16:53:55.073651	::1
45	model_guard.placeholder_style	stickman	stickman	\N	2026-07-31 16:53:55.076971	::1
46	model_guard.character_bundle_mode	self_contained	retarget	\N	2026-07-31 16:53:55.079293	::1
47	model_guard.anim_guard_enabled	false	false	\N	2026-07-31 16:53:55.080937	::1
48	model_guard.anim_max_file_size	5	5	\N	2026-07-31 16:53:55.082408	::1
49	model_guard.anim_max_tracks	200	200	\N	2026-07-31 16:53:55.083656	::1
50	model_guard.anim_max_keyframes	20000	20000	\N	2026-07-31 16:53:55.084849	::1
51	model_guard.anim_max_duration	30	30	\N	2026-07-31 16:53:55.086056	::1
52	model_guard.anim_max_meshes	10	10	\N	2026-07-31 16:53:55.08724	::1
53	model_guard.anim_total_max_size	30	30	\N	2026-07-31 16:53:55.088434	::1
54	model_guard.anim_guard_remote_only	false	false	\N	2026-07-31 16:53:55.08958	::1
\.


--
-- Data for Name: custom_npcs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.custom_npcs (id, name, avatar_emoji, description, world_name, tag, "position", ai_provider, ai_model, ai_endpoint, ai_key, system_prompt, shape_code, shape_desc, detect_range, approach_range, greeting, farewell, greet_trigger, is_active, roam, face_player, created_at, updated_at, created_by) FROM stdin;
156f43bd-4a18-4f0b-8b72-1d10908d1f17	阿什顿飞	🤖	爱聊天的的NPC	米多	混混	{"x": 0, "y": 0, "z": 0}	openai					\N		10	5			approach	t	f	t	2026-05-06 17:52:51.102993	2026-05-06 17:52:51.102993	\N
\.


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.equipment (id, character_id, equipment_type, equipment_name, model_url, glow, stats, created_at) FROM stdin;
\.


--
-- Data for Name: gallery_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.gallery_configs (id, name, start_x, start_y, start_z, matrix_width, buffer_rate, row_spacing, col_spacing, max_photo_width, max_photo_height, sort_by, folder_gap, jitter, is_active, total_photos, total_videos, created_at, updated_at) FROM stdin;
5	默认配置	193	1	918	20	0.2	4	1.5	5.5	8	exif_date_desc	8	0.3	f	0	0	2026-06-08 16:54:26.081582	2026-07-10 17:06:06.169101
4	默认配置	193	1	918	20	0.2	4	1.5	6	8	exif_date_desc	9	0.5	f	0	0	2026-06-08 09:19:57.82602	2026-07-10 17:06:06.169101
3	默认配置	193	1	918	20	0.2	4	1.5	5	4	exif_date_desc	8	0.3	f	0	0	2026-06-07 15:09:57.53989	2026-07-10 17:06:06.169101
2	默认配置	193	1	918	20	0.2	4	1.5	5	4	exif_date_desc	8	0.3	f	0	0	2026-06-07 15:04:40.527664	2026-07-10 17:06:06.169101
1	默认配置	193	1	918	20	0.2	4	1.5	5	4	exif_date_desc	8	0.3	f	0	0	2026-06-07 14:56:37.587628	2026-07-10 17:06:06.169101
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
8	world_weather	{"type":"clear","intensity":79,"wind":50,"auto_cycle":true,"cycle_interval":17,"updated_at":"2026-07-26T02:50:58.542Z"}	\N	2026-07-26 10:50:58.601987	2026-03-02 15:37:39.318307
1	character_editor_config	{\n  "character": {\n    "scale": 1,\n    "headColor": 16755353,\n    "bodyColor": 4886754\n  },\n  "sword": {\n    "position": {\n      "x": 0.03,\n      "y": -0.47,\n      "z": 0.1\n    },\n    "rotation": {\n      "x": 35,\n      "y": 95,\n      "z": 85\n    },\n    "hiltColor": 0,\n    "bladeColor": 65535,\n    "bladeLength": 1.2,\n    "glowIntensity": 2\n  },\n  "attack": {\n    "duration": 500,\n    "swingAngle": 100,\n    "armSwing": 0.6,\n    "trajectory": {\n      "startOffset": {\n        "x": 0,\n        "y": 0,\n        "z": 0\n      },\n      "endOffset": {\n        "x": 0,\n        "y": 0,\n        "z": 0\n      },\n      "midRotation": 0\n    }\n  },\n  "animation": {\n    "walkSpeed": 1.5\n  }\n}	\N	2026-02-24 16:16:53.627001	2026-02-24 14:28:48.020215
\.


--
-- Data for Name: generated_buildings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.generated_buildings (id, user_id, name, description, image_path, prompt, task_id, status, model_url, thumbnail_url, local_path, created_at, completed_at, tags, updated_at) FROM stdin;
1	1	示例建筑1	这是一个测试建筑	\N	\N	test-task-1	completed	\N	\N	/models/generated/building-15-extracted/0bc2588c9c0adb0b9812c68902bb3768.obj	2026-02-11 08:51:51.671823	\N	\N	2026-07-09 18:31:42.545811
\.


--
-- Data for Name: geometry_buildings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.geometry_buildings (id, user_id, name, template_id, geometry_data, created_at, tags, category, description, auto_tags, updated_at) FROM stdin;
6	1	简易房屋1	simple_house	{"name": "简易房屋", "components": [{"type": "box", "color": 13935475, "depth": 4, "width": 4, "height": 3, "position": {"x": 0, "y": 1.5, "z": 0}}, {"type": "cone", "color": 9127187, "height": 2, "position": {"x": 0, "y": 4, "z": 0}, "rotation": {"x": 0, "y": 0.7853981633974483, "z": 0}, "radiusTop": 0.5, "radiusBottom": 3.5, "radialSegments": 4}, {"type": "box", "color": 6636321, "depth": 0.2, "width": 1, "height": 2, "position": {"x": 0, "y": 1, "z": 2.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 0.8, "height": 0.8, "position": {"x": -1.2, "y": 2, "z": 2.1}}]}	2026-02-14 13:55:59.311896	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.894Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.895178
7	1	谷仓	barn	{"name": "谷仓", "components": [{"type": "box", "color": 9109504, "depth": 8, "width": 6, "height": 4, "position": {"x": 0, "y": 2, "z": 0}}, {"type": "box", "color": 6908265, "depth": 9, "width": 6.5, "height": 0.5, "position": {"x": 0, "y": 4.5, "z": 0}, "rotation": {"x": 0.2, "y": 0, "z": 0}}, {"type": "box", "color": 6636321, "depth": 0.3, "width": 3, "height": 3, "position": {"x": 0, "y": 1.5, "z": 4.2}}]}	2026-02-14 14:58:08.851892	{建筑物,农业,中型,乡村,木质}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.894Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.895881
9	1	公寓楼	apartment	{"name": "公寓楼", "components": [{"type": "box", "color": 14474460, "depth": 6, "width": 8, "height": 15, "position": {"x": 0, "y": 7.5, "z": 0}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": -2.5, "y": 1.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 0, "y": 1.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 2.5, "y": 1.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": -2.5, "y": 4.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 0, "y": 4.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 2.5, "y": 4.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": -2.5, "y": 7.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 0, "y": 7.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 2.5, "y": 7.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": -2.5, "y": 10.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 0, "y": 10.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 2.5, "y": 10.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": -2.5, "y": 13.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 0, "y": 13.5, "z": 3.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 2.5, "y": 13.5, "z": 3.1}}]}	2026-02-14 14:59:50.207907	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.898Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.899263
10	1	商店	shop	{"name": "商店", "components": [{"type": "box", "color": 16739179, "depth": 4, "width": 5, "height": 3.5, "position": {"x": 0, "y": 1.75, "z": 0}}, {"type": "box", "color": 9109504, "depth": 4.5, "width": 5.5, "height": 0.3, "position": {"x": 0, "y": 3.65, "z": 0}}, {"type": "box", "color": 16766720, "depth": 0.2, "width": 3, "height": 0.8, "position": {"x": 0, "y": 4.3, "z": 0}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 2, "height": 2.5, "position": {"x": 0, "y": 1.25, "z": 2.1}}]}	2026-02-14 15:47:58.354946	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.898Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.899934
11	1	桥梁	bridge	{"name": "桥梁", "components": [{"type": "box", "color": 9127187, "depth": 3, "width": 8, "height": 0.3, "position": {"x": 0, "y": 0.15, "z": 0}}, {"type": "box", "color": 6636321, "depth": 0.2, "width": 8, "height": 0.8, "position": {"x": 0, "y": 0.7, "z": -1.4}}, {"type": "box", "color": 6636321, "depth": 0.2, "width": 8, "height": 0.8, "position": {"x": 0, "y": 0.7, "z": 1.4}}]}	2026-02-24 14:15:08.783019	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.899Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.900652
1	1	简易房屋	simple_house	{"name": "简易房屋", "components": [{"type": "box", "color": 13935475, "depth": 4, "width": 4, "height": 3, "position": {"x": 0, "y": 1.5, "z": 0}}, {"type": "cone", "color": 9127187, "height": 2, "position": {"x": 0, "y": 4, "z": 0}, "rotation": {"x": 0, "y": 0.7853981633974483, "z": 0}, "radiusTop": 0.5, "radiusBottom": 3.5, "radialSegments": 4}, {"type": "box", "color": 6636321, "depth": 0.2, "width": 1, "height": 2, "position": {"x": 0, "y": 1, "z": 2.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 0.8, "height": 0.8, "position": {"x": -1.2, "y": 2, "z": 2.1}}]}	2026-02-11 15:43:36.725942	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.858Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.859731
5	1	市场摊位	market	{"name": "市场摊位", "components": [{"type": "cylinder", "color": 9127187, "height": 2.5, "position": {"x": -1.5, "y": 1.25, "z": -1.5}, "radiusTop": 0.15, "radiusBottom": 0.15, "radialSegments": 8}, {"type": "cylinder", "color": 9127187, "height": 2.5, "position": {"x": 1.5, "y": 1.25, "z": -1.5}, "radiusTop": 0.15, "radiusBottom": 0.15, "radialSegments": 8}, {"type": "cylinder", "color": 9127187, "height": 2.5, "position": {"x": -1.5, "y": 1.25, "z": 1.5}, "radiusTop": 0.15, "radiusBottom": 0.15, "radialSegments": 8}, {"type": "cylinder", "color": 9127187, "height": 2.5, "position": {"x": 1.5, "y": 1.25, "z": 1.5}, "radiusTop": 0.15, "radiusBottom": 0.15, "radialSegments": 8}, {"type": "box", "color": 16737095, "depth": 3.5, "width": 3.5, "height": 0.2, "position": {"x": 0, "y": 2.6, "z": 0}}, {"type": "box", "color": 13789470, "depth": 2, "width": 3, "height": 0.2, "position": {"x": 0, "y": 1, "z": 0}}]}	2026-02-13 16:19:42.289874	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.893Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.894432
8	1	商店	shop	{"name": "商店", "components": [{"type": "box", "color": 16739179, "depth": 4, "width": 5, "height": 3.5, "position": {"x": 0, "y": 1.75, "z": 0}}, {"type": "box", "color": 9109504, "depth": 4.5, "width": 5.5, "height": 0.3, "position": {"x": 0, "y": 3.65, "z": 0}}, {"type": "box", "color": 16766720, "depth": 0.2, "width": 3, "height": 0.8, "position": {"x": 0, "y": 4.3, "z": 0}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 2, "height": 2.5, "position": {"x": 0, "y": 1.25, "z": 2.1}}]}	2026-02-14 14:58:12.318186	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-02-25T06:59:02.897Z", "generated_by": "auto_tag_service"}	2026-02-25 14:59:02.898497
13	1	湖泊	lake	{"name": "湖泊", "components": [{"type": "box", "color": 1981066, "depth": 10, "width": 15, "height": 0.5, "position": {"x": 0, "y": -0.25, "z": 0}}, {"type": "box", "color": 3900150, "depth": 10, "width": 15, "height": 0.1, "opacity": 0.7, "position": {"x": 0, "y": 0, "z": 0}, "transparent": true}, {"type": "box", "color": 2263842, "depth": 12, "width": 17, "height": 0.1, "position": {"x": 0, "y": 0.05, "z": 0}}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 7, "y": 0.3, "z": 0}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 4.949747468305833, "y": 0.3, "z": 2.9698484809834995}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 0.0000000000000004286263797015736, "y": 0.3, "z": 4.2}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -4.949747468305832, "y": 0.3, "z": 2.9698484809835}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -7, "y": 0.3, "z": 0.0000000000000005143516556418884}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -4.949747468305834, "y": 0.3, "z": -2.9698484809834995}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -0.0000000000000012858791391047208, "y": 0.3, "z": -4.2}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 4.949747468305832, "y": 0.3, "z": -2.9698484809835004}, "widthSegments": 6, "heightSegments": 6}]}	2026-03-04 10:15:28.398268	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-03-04T02:16:02.236Z", "generated_by": "auto_tag_service"}	2026-03-04 10:16:02.236334
12	1	现代住宅	modern_house	{"name": "现代住宅", "components": [{"type": "box", "color": 16777215, "depth": 5, "width": 6, "height": 4, "position": {"x": 0, "y": 2, "z": 0}}, {"type": "box", "color": 8421504, "depth": 5.5, "width": 6.5, "height": 0.3, "position": {"x": 0, "y": 4.15, "z": 0}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": -1.5, "y": 2.5, "z": 2.6}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 1.5, "height": 1.8, "position": {"x": 1.5, "y": 2.5, "z": 2.6}}, {"type": "box", "color": 9127187, "depth": 0.2, "width": 1.2, "height": 2.5, "position": {"x": 0, "y": 1.25, "z": 2.6}}]}	2026-03-04 09:59:58.423201	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-03-04T02:16:02.200Z", "generated_by": "auto_tag_service"}	2026-03-04 10:16:02.200904
14	1	水井	well	{"name": "水井", "components": [{"type": "cylinder", "color": 8421504, "height": 1.5, "position": {"x": 0, "y": 0.75, "z": 0}, "radiusTop": 1.2, "radiusBottom": 1.2, "radialSegments": 16}, {"tube": 0.2, "type": "torus", "color": 6908265, "radius": 1, "position": {"x": 0, "y": 1.5, "z": 0}, "rotation": {"x": 1.5707963267948966, "y": 0, "z": 0}, "radialSegments": 16, "tubularSegments": 32}, {"type": "cylinder", "color": 9127187, "height": 2, "position": {"x": -1, "y": 2.5, "z": 0}, "radiusTop": 0.1, "radiusBottom": 0.1, "radialSegments": 8}, {"type": "cylinder", "color": 9127187, "height": 2, "position": {"x": 1, "y": 2.5, "z": 0}, "radiusTop": 0.1, "radiusBottom": 0.1, "radialSegments": 8}, {"type": "cylinder", "color": 6636321, "height": 2.2, "position": {"x": 0, "y": 3.5, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 1.5707963267948966}, "radiusTop": 0.08, "radiusBottom": 0.08, "radialSegments": 8}]}	2026-03-04 10:15:39.973494	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-03-04T02:16:02.236Z", "generated_by": "auto_tag_service"}	2026-03-04 10:16:02.237195
15	1	湖泊	lake	{"name": "湖泊", "components": [{"type": "box", "color": 1981066, "depth": 10, "width": 15, "height": 0.5, "position": {"x": 0, "y": -0.25, "z": 0}}, {"type": "box", "color": 3900150, "depth": 10, "width": 15, "height": 0.1, "opacity": 0.7, "position": {"x": 0, "y": 0, "z": 0}, "transparent": true}, {"type": "box", "color": 2263842, "depth": 12, "width": 17, "height": 0.1, "position": {"x": 0, "y": 0.05, "z": 0}}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 7, "y": 0.3, "z": 0}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 4.949747468305833, "y": 0.3, "z": 2.9698484809834995}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 0.0000000000000004286263797015736, "y": 0.3, "z": 4.2}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -4.949747468305832, "y": 0.3, "z": 2.9698484809835}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -7, "y": 0.3, "z": 0.0000000000000005143516556418884}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -4.949747468305834, "y": 0.3, "z": -2.9698484809834995}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -0.0000000000000012858791391047208, "y": 0.3, "z": -4.2}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 4.949747468305832, "y": 0.3, "z": -2.9698484809835004}, "widthSegments": 6, "heightSegments": 6}]}	2026-03-04 15:07:43.66451	{装饰物,中型}	building	\N	{"method": "rule_based", "confidence": 0.9, "generated_at": "2026-03-04T08:22:57.320Z", "generated_by": "auto_tag_service"}	2026-03-04 16:22:57.320632
16	1	塔楼	tower	{"name": "塔楼", "components": [{"type": "cylinder", "color": 8421504, "height": 8, "position": {"x": 0, "y": 4, "z": 0}, "radiusTop": 2, "radiusBottom": 2.5, "radialSegments": 16}, {"type": "cone", "color": 9109504, "height": 3, "position": {"x": 0, "y": 9.5, "z": 0}, "radiusTop": 0.2, "radiusBottom": 2.5, "radialSegments": 16}, {"type": "box", "color": 16776960, "depth": 0.3, "width": 0.8, "height": 1.5, "position": {"x": 0, "y": 2.4, "z": 2.5}}, {"type": "box", "color": 16776960, "depth": 0.3, "width": 0.8, "height": 1.5, "position": {"x": 0, "y": 4.8, "z": 2.5}}]}	2026-03-04 16:35:49.270783	{}	building	\N	{}	2026-03-04 16:35:49.270783
17	1	湖泊	lake	{"name": "湖泊", "components": [{"type": "box", "color": 1981066, "depth": 10, "width": 15, "height": 0.5, "position": {"x": 0, "y": -0.25, "z": 0}}, {"type": "box", "color": 3900150, "depth": 10, "width": 15, "height": 0.1, "opacity": 0.7, "position": {"x": 0, "y": 0, "z": 0}, "transparent": true}, {"type": "box", "color": 2263842, "depth": 12, "width": 17, "height": 0.1, "position": {"x": 0, "y": 0.05, "z": 0}}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 7, "y": 0.3, "z": 0}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 4.949747468305833, "y": 0.3, "z": 2.9698484809834995}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 0.0000000000000004286263797015736, "y": 0.3, "z": 4.2}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -4.949747468305832, "y": 0.3, "z": 2.9698484809835}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -7, "y": 0.3, "z": 0.0000000000000005143516556418884}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -4.949747468305834, "y": 0.3, "z": -2.9698484809834995}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": -0.0000000000000012858791391047208, "y": 0.3, "z": -4.2}, "widthSegments": 6, "heightSegments": 6}, {"type": "sphere", "color": 6908265, "scale": {"x": 1, "y": 0.6, "z": 1.2}, "radius": 0.5, "position": {"x": 4.949747468305832, "y": 0.3, "z": -2.9698484809835004}, "widthSegments": 6, "heightSegments": 6}]}	2026-06-05 16:30:05.30652	{}	building	\N	{}	2026-06-05 16:30:05.30652
18	1	简易房屋1	simple_house	{"name": "简易房屋", "components": [{"type": "box", "color": 13935475, "depth": 4, "width": 4, "height": 3, "position": {"x": 0, "y": 1.5, "z": 0}}, {"type": "cone", "color": 9127187, "height": 2, "position": {"x": 0, "y": 4, "z": 0}, "rotation": {"x": 0, "y": 0.7853981633974483, "z": 0}, "radiusTop": 0.5, "radiusBottom": 3.5, "radialSegments": 4}, {"type": "box", "color": 6636321, "depth": 0.2, "width": 1, "height": 2, "position": {"x": 0, "y": 1, "z": 2.1}}, {"type": "box", "color": 8900331, "depth": 0.2, "width": 0.8, "height": 0.8, "position": {"x": -1.2, "y": 2, "z": 2.1}}]}	2026-06-05 17:40:57.817584	{}	building	\N	{}	2026-06-05 17:40:57.817584
20	1	简易房屋3	simple_house	{"name": "简易房屋 #38", "components": [{"type": "box", "color": 13868922, "depth": 3.4000059141392978, "width": 3.4000059141392978, "height": 2.5500044356044733, "position": {"x": -0.025029583487048732, "y": 1.492674458300489, "z": -0.0006319091394353349}}, {"type": "cone", "color": 8666911, "height": 1.970453696577301, "position": {"x": 0.021528095380894927, "y": 4.013619479801151, "z": 0.024328420389749503}, "rotation": {"x": 0, "y": 0.7853981633974483, "z": 0}, "radiusTop": 0.49261342414432524, "radiusBottom": 3.4482939690102765, "radialSegments": 4}, {"type": "box", "color": 6569245, "depth": 0.22464293021209814, "width": 1.1232146510604906, "height": 2.246429302120981, "position": {"x": -0.006271883357569468, "y": 1.0050740159182567, "z": 2.082449737527827}}, {"type": "box", "color": 9290738, "depth": 0.20654369230060252, "width": 0.8261747692024101, "height": 0.8261747692024101, "position": {"x": -1.2001959842519796, "y": 2.009046480125791, "z": 2.1566704048418166}}]}	2026-06-05 17:59:41.982903	{}	building	\N	{}	2026-06-05 17:59:41.982903
21	1	简易房屋4	simple_house	{"name": "简易房屋 #66", "components": [{"type": "box", "color": 13149303, "depth": 3.4000050274425546, "width": 3.4000050274425546, "height": 2.550003770581916, "position": {"x": -0.02577471909516675, "y": 1.5025779624203741, "z": -0.0269758001509974}}, {"type": "cone", "color": 8730910, "height": 2.096503754063833, "position": {"x": 0.013859614340355845, "y": 4.0111230068055574, "z": -0.006040941974520979}, "rotation": {"x": 0, "y": 0.7853981633974483, "z": 0}, "radiusTop": 0.5241259385159582, "radiusBottom": 3.668881569611708, "radialSegments": 4}, {"type": "box", "color": 7031839, "depth": 0.17991099741221558, "width": 0.8995549870610778, "height": 1.7991099741221557, "position": {"x": -0.01586610089929935, "y": 0.9870655266501008, "z": 2.150073276217855}}, {"type": "box", "color": 8440567, "depth": 0.19778416218517214, "width": 0.7911366487406886, "height": 0.7911366487406886, "position": {"x": -1.1779030820214509, "y": 2.003450287135635, "z": 2.075416008695016}}]}	2026-06-05 18:00:33.486932	{}	building	\N	{}	2026-06-05 18:00:33.486932
22	1	中世纪城堡	medieval_castle	{"name": "中世纪城堡", "components": [{"type": "box", "color": 6908265, "depth": 8, "width": 10, "height": 8, "position": {"x": 0, "y": 4, "z": 0}}, {"type": "cylinder", "color": 8421504, "height": 10, "position": {"x": -5, "y": 5, "z": -4}, "radiusTop": 1.5, "radiusBottom": 1.5, "radialSegments": 8}, {"type": "cone", "color": 9109504, "height": 3, "position": {"x": -5, "y": 11.5, "z": -4}, "radiusTop": 0.2, "radiusBottom": 2, "radialSegments": 8}, {"type": "cylinder", "color": 8421504, "height": 10, "position": {"x": 5, "y": 5, "z": -4}, "radiusTop": 1.5, "radiusBottom": 1.5, "radialSegments": 8}, {"type": "cone", "color": 9109504, "height": 3, "position": {"x": 5, "y": 11.5, "z": -4}, "radiusTop": 0.2, "radiusBottom": 2, "radialSegments": 8}, {"type": "cylinder", "color": 8421504, "height": 10, "position": {"x": -5, "y": 5, "z": 4}, "radiusTop": 1.5, "radiusBottom": 1.5, "radialSegments": 8}, {"type": "cone", "color": 9109504, "height": 3, "position": {"x": -5, "y": 11.5, "z": 4}, "radiusTop": 0.2, "radiusBottom": 2, "radialSegments": 8}, {"type": "cylinder", "color": 8421504, "height": 10, "position": {"x": 5, "y": 5, "z": 4}, "radiusTop": 1.5, "radiusBottom": 1.5, "radialSegments": 8}, {"type": "cone", "color": 9109504, "height": 3, "position": {"x": 5, "y": 11.5, "z": 4}, "radiusTop": 0.2, "radiusBottom": 2, "radialSegments": 8}, {"type": "box", "color": 6908265, "depth": 1, "width": 12, "height": 4, "position": {"x": 0, "y": 2, "z": -5}}, {"type": "box", "color": 6908265, "depth": 1, "width": 12, "height": 4, "position": {"x": 0, "y": 2, "z": 5}}, {"type": "box", "color": 6908265, "depth": 8, "width": 1, "height": 4, "position": {"x": -6, "y": 2, "z": 0}}, {"type": "box", "color": 6908265, "depth": 8, "width": 1, "height": 4, "position": {"x": 6, "y": 2, "z": 0}}]}	2026-06-30 18:22:22.019809	{}	building	\N	{}	2026-06-30 18:22:22.019809
23	1	未来塔楼	futuristic_tower	{"name": "未来塔楼", "components": [{"type": "cylinder", "color": 49151, "height": 15, "position": {"x": 0, "y": 7.5, "z": 0}, "radiusTop": 1.5, "radiusBottom": 2, "radialSegments": 16}, {"type": "cone", "color": 65535, "height": 3, "position": {"x": 0, "y": 16.5, "z": 0}, "radiusTop": 0.5, "radiusBottom": 2, "radialSegments": 16}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 1, "z": 2}}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 3, "z": 2}}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 5, "z": 2}}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 7, "z": 2}}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 9, "z": 2}}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 11, "z": 2}}, {"type": "box", "color": 16776960, "depth": 0.1, "width": 0.5, "height": 1, "position": {"x": 0, "y": 13, "z": 2}}]}	2026-06-30 18:24:27.798712	{}	building	\N	{}	2026-06-30 18:24:27.798712
25	1	长方体	box_primitive	{"name": "长方体", "components": [{"type": "box", "color": 8947848, "depth": 2, "width": 2, "height": 1, "position": {"x": 0, "y": 0.5, "z": 0}}]}	2026-07-07 15:56:39.822489	{}	building	\N	{}	2026-07-07 15:56:39.822489
26	1	长方体2	box_primitive	{"name": "长方体", "components": [{"type": "box", "color": 8947848, "depth": 1, "width": 2, "height": 1, "position": {"x": 0, "y": 0.5, "z": 0}}]}	2026-07-09 10:12:58.411051	{}	building	\N	{}	2026-07-09 10:12:58.411051
27	1	树木	tree	{"name": "树木", "components": [{"type": "cylinder", "color": 9127187, "height": 3, "position": {"x": 0, "y": 1.5, "z": 0}, "radiusTop": 0.3, "radiusBottom": 0.5, "radialSegments": 8}, {"type": "cone", "color": 2263842, "height": 2, "position": {"x": 0, "y": 4, "z": 0}, "radiusTop": 0, "radiusBottom": 2, "radialSegments": 8}, {"type": "cone", "color": 2263842, "height": 1.5, "position": {"x": 0, "y": 5, "z": 0}, "radiusTop": 0, "radiusBottom": 1.5, "radialSegments": 8}]}	2026-07-10 18:00:26.87324	{}	building	\N	{}	2026-07-10 18:00:26.87324
28	1	路灯	lamp	{"name": "路灯", "components": [{"type": "cylinder", "color": 3100495, "height": 4, "position": {"x": 0, "y": 2, "z": 0}, "radiusTop": 0.15, "radiusBottom": 0.2, "radialSegments": 8}, {"type": "cylinder", "color": 3100495, "height": 1, "position": {"x": 0.5, "y": 4, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 1.0471975511965976}, "radiusTop": 0.1, "radiusBottom": 0.1, "radialSegments": 6}, {"type": "sphere", "color": 16777184, "radius": 0.4, "emissive": 16776960, "position": {"x": 0.8, "y": 4.3, "z": 0}, "widthSegments": 16, "heightSegments": 16, "emissiveIntensity": 0.8}]}	2026-07-10 18:00:34.062862	{}	building	\N	{}	2026-07-10 18:00:34.062862
\.


--
-- Data for Name: maintenance_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.maintenance_logs (id, script_id, script_label, category, status, result_summary, result_detail, affected_rows, error_message, executed_by, started_at, finished_at) FROM stdin;
1	cleanup_invalid_model_path	清理无效 model_path	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:31:41.457145	2026-06-05 15:31:41.457145
2	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:31:44.291203	2026-06-05 15:31:44.291203
3	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:31:47.811376	2026-06-05 15:31:47.811376
4	cleanup_orphan_objects	清理孤立世界对象	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:31:49.544885	2026-06-05 15:31:49.544885
5	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-05 15:31:51.258989	2026-06-05 15:31:51.258989
6	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:31:53.350003	2026-06-05 15:31:53.350003
7	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-05 15:33:22.584792	2026-06-05 15:33:22.584792
8	cleanup_invalid_model_path	清理无效 model_path	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:34:08.584965	2026-06-05 15:34:08.584965
9	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:34:09.122275	2026-06-05 15:34:09.122275
10	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:34:09.221773	2026-06-05 15:34:09.221773
11	cleanup_orphan_objects	清理孤立世界对象	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:34:09.330137	2026-06-05 15:34:09.330137
12	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:34:09.541329	2026-06-05 15:34:09.541329
13	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:40:50.279537	2026-06-05 15:40:50.279537
14	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:40:50.369903	2026-06-05 15:40:50.369903
15	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:40:50.433391	2026-06-05 15:40:50.433391
16	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:40:50.492651	2026-06-05 15:40:50.492651
17	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:40:50.710504	2026-06-05 15:40:50.710504
18	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:41:27.313236	2026-06-05 15:41:27.313236
19	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:41:27.333035	2026-06-05 15:41:27.333035
20	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:41:27.350626	2026-06-05 15:41:27.350626
21	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:41:27.370654	2026-06-05 15:41:27.370654
22	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:41:27.384246	2026-06-05 15:41:27.384246
23	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:42:42.973194	2026-06-05 15:42:42.973194
24	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:42:43.038169	2026-06-05 15:42:43.038169
25	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:42:43.102042	2026-06-05 15:42:43.102042
26	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:42:43.16364	2026-06-05 15:42:43.16364
27	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:42:43.218967	2026-06-05 15:42:43.218967
28	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:48:33.987547	2026-06-05 15:48:33.987547
29	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:48:34.007731	2026-06-05 15:48:34.007731
30	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:48:34.026524	2026-06-05 15:48:34.026524
31	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:48:34.097537	2026-06-05 15:48:34.097537
32	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:48:34.175706	2026-06-05 15:48:34.175706
33	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:49:20.515437	2026-06-05 15:49:20.515437
34	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:49:20.596301	2026-06-05 15:49:20.596301
35	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:49:20.666576	2026-06-05 15:49:20.666576
36	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:49:20.743624	2026-06-05 15:49:20.743624
37	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:49:20.807506	2026-06-05 15:49:20.807506
38	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:51:29.132394	2026-06-05 15:51:29.132394
39	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-05 15:51:32.521066	2026-06-05 15:51:32.521066
40	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:52:03.063737	2026-06-05 15:52:03.063737
41	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-05 15:52:11.695834	2026-06-05 15:52:11.695834
42	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-05 15:52:15.348823	2026-06-05 15:52:15.348823
43	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-05 15:52:23.197639	2026-06-05 15:52:23.197639
44	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-05 15:52:36.976124	2026-06-05 15:52:36.976124
45	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-05 15:56:46.485203	2026-06-05 15:56:46.485203
46	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-05 16:20:08.763793	2026-06-05 16:20:08.763793
47	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-06-11 18:28:55.545883	2026-06-11 18:28:55.545883
48	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-06-11 18:28:58.223032	2026-06-11 18:28:58.223032
49	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-06-11 18:29:02.797408	2026-06-11 18:29:02.797408
50	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-11 18:29:08.493716	2026-06-11 18:29:08.493716
51	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-06-11 18:29:11.117157	2026-06-11 18:29:11.117157
52	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-06-11 18:29:13.229375	2026-06-11 18:29:13.229375
53	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-06-12 14:57:34.31175	2026-06-12 14:57:34.31175
54	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-07-10 17:04:04.952218	2026-07-10 17:04:04.952218
55	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-07-10 17:04:08.369275	2026-07-10 17:04:08.369275
56	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-07-10 17:04:11.05506	2026-07-10 17:04:11.05506
57	cleanup_orphan_objects	清理孤立世界对象引用	cleanup	running	\N	\N	0	\N	admin	2026-07-10 17:04:15.196498	2026-07-10 17:04:15.196498
58	refresh_geometry_buildings	重新初始化基础几何体建筑	repair	running	\N	\N	0	\N	admin	2026-07-10 17:04:17.737297	2026-07-10 17:04:17.737297
59	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-07-10 17:04:21.93546	2026-07-10 17:04:21.93546
60	cleanup_invalid_model_path	清理无效 model_url	cleanup	running	\N	\N	0	\N	admin	2026-07-28 17:29:04.00711	2026-07-28 17:29:04.00711
61	check_broken_references	检查文件引用完整性	check	running	\N	\N	0	\N	admin	2026-07-28 17:29:06.242688	2026-07-28 17:29:06.242688
62	cleanup_orphan_uploads	清理孤立上传文件	cleanup	running	\N	\N	0	\N	admin	2026-07-28 17:29:10.907261	2026-07-28 17:29:10.907261
63	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-07-28 17:29:13.82662	2026-07-28 17:29:13.82662
64	verify_db_schema	数据库完整性验证	check	running	\N	\N	0	\N	admin	2026-08-05 18:25:48.79736	2026-08-05 18:25:48.79736
\.


--
-- Data for Name: model_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.model_tags (id, name, category, description, parent_tag_id, usage_count, created_at) FROM stdin;
1	建筑物	type	各类建筑结构	\N	0	2026-02-13 15:21:24.286438
2	自然景观	type	山川、树木等自然元素	\N	0	2026-02-13 15:21:24.286438
3	交通工具	type	车辆、船只等	\N	0	2026-02-13 15:21:24.286438
4	装饰物	type	装饰性物品	\N	0	2026-02-13 15:21:24.286438
5	动物	type	各类动物模型	\N	0	2026-02-13 15:21:24.286438
6	植物	type	花草树木	\N	0	2026-02-13 15:21:24.286438
7	道具	type	游戏道具、物品	\N	0	2026-02-13 15:21:24.286438
8	家具	type	室内外家具	\N	0	2026-02-13 15:21:24.286438
9	现代	style	现代风格	\N	0	2026-02-13 15:21:24.286438
10	古典	style	古典传统风格	\N	0	2026-02-13 15:21:24.286438
11	科幻	style	科幻未来风格	\N	0	2026-02-13 15:21:24.286438
12	魔幻	style	魔幻奇幻风格	\N	0	2026-02-13 15:21:24.286438
13	中式	style	中国传统风格	\N	0	2026-02-13 15:21:24.286438
14	欧式	style	欧洲风格	\N	0	2026-02-13 15:21:24.286438
15	日式	style	日本风格	\N	0	2026-02-13 15:21:24.286438
16	卡通	style	卡通风格	\N	0	2026-02-13 15:21:24.286438
17	微型	size	非常小的物体	\N	0	2026-02-13 15:21:24.286438
18	小型	size	小型物体	\N	0	2026-02-13 15:21:24.286438
19	中型	size	中等大小	\N	0	2026-02-13 15:21:24.286438
20	大型	size	大型物体	\N	0	2026-02-13 15:21:24.286438
21	巨型	size	超大型物体	\N	0	2026-02-13 15:21:24.286438
22	城市	theme	城市场景相关	\N	0	2026-02-13 15:21:24.286438
23	乡村	theme	乡村场景相关	\N	0	2026-02-13 15:21:24.286438
24	森林	theme	森林场景	\N	0	2026-02-13 15:21:24.286438
25	沙漠	theme	沙漠场景	\N	0	2026-02-13 15:21:24.286438
26	雪地	theme	雪地冰川	\N	0	2026-02-13 15:21:24.286438
27	海洋	theme	海洋海滩	\N	0	2026-02-13 15:21:24.286438
28	太空	theme	太空场景	\N	0	2026-02-13 15:21:24.286438
29	地下城	theme	地下城场景	\N	0	2026-02-13 15:21:24.286438
30	废墟	theme	废弃场景	\N	0	2026-02-13 15:21:24.286438
31	住宅	function	居住类建筑	\N	0	2026-02-13 15:21:24.286438
32	商业	function	商业建筑	\N	0	2026-02-13 15:21:24.286438
33	工业	function	工业建筑	\N	0	2026-02-13 15:21:24.286438
34	娱乐	function	娱乐设施	\N	0	2026-02-13 15:21:24.286438
35	军事	function	军事设施	\N	0	2026-02-13 15:21:24.286438
36	宗教	function	宗教建筑	\N	0	2026-02-13 15:21:24.286438
37	交通	function	交通设施	\N	0	2026-02-13 15:21:24.286438
38	可交互	attribute	可以交互的物体	\N	0	2026-02-13 15:21:24.286438
39	动态	attribute	有动画的物体	\N	0	2026-02-13 15:21:24.286438
40	发光	attribute	自发光物体	\N	0	2026-02-13 15:21:24.286438
41	透明	attribute	透明或半透明	\N	0	2026-02-13 15:21:24.286438
42	高精度	attribute	高精度模型	\N	0	2026-02-13 15:21:24.286438
43	低多边形	attribute	低多边形风格	\N	0	2026-02-13 15:21:24.286438
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
69170498-0ac7-4f44-b037-fe84fa78d6b1	orc	{"x": 1, "y": 1, "z": 1}	0	50	8	20	0.30	f	2026-03-01 12:15:23.198988	2026-06-02 17:14:49.144569	goblin	#44ff88	2	1	2.7	10	1.5	60	120	2888b893-fc6e-4491-b3c6-638e230cdb6f	1	10	random	\N
b17e2256-0c48-4163-a3f0-9bbe636b08a1	巨血怪	{"x": 4, "y": 0, "z": 4}	99942	99999	8	10	0.30	t	2026-03-25 17:06:13.776547	2026-07-12 08:06:14.106448	spider	#44ff88	9999	1	2	10	1.5	60	120	\N	1	10	random	\N
c55dc31b-da65-4582-9329-47f45446cbed	巨血怪	{"x": 5, "y": 0, "z": 5}	4793	5000	800	10	0.30	t	2026-03-25 17:06:36.196408	2026-07-22 15:25:27.641952	boss	#44ff88	0	1	20	1000	1.5	60	120	\N	1	10	random	\N
c410eaaa-b8c0-4473-99cc-f630f1e73573	巨血怪	{"x": 3, "y": 0, "z": 3}	996251	999999999	8	10	0.30	t	2026-03-25 15:25:31.909266	2026-07-21 15:23:41.174955	slime	#44ff88	0	1	2	10	1.5	60	120	\N	1	10	random	\N
8b932f7a-90d5-4490-9876-b1032c39dcfc	小鬼子	{"x": 193, "y": 1, "z": 918}	19	50	8	10	1.00	t	2026-06-04 18:25:30.497468	2026-06-10 10:26:20.393335	slime	#44ff88	0	1	2	10	1.5	60	120	2888b893-fc6e-4491-b3c6-638e230cdb6f	1	10	random	\N
b551af31-71b3-4569-bd59-1c4367c9f398	222	{"x": 7, "y": 0, "z": 7}	3179	5000	8	10	0.30	t	2026-03-25 17:19:13.231818	2026-07-22 15:25:19.27748	boss	#44ff88	100	1	2	10	1.5	5	120	\N	1	10	random	\N
1ce07e9a-37cc-4b10-b308-201aae9c7aeb	巨血怪	{"x": 6, "y": 0, "z": 6}	19	50	8	10	0.30	t	2026-03-25 17:14:59.711183	2026-07-22 15:25:19.587531	slime	#186835	0	1	2	10	1.5	60	120	\N	1	10	random	\N
\.


--
-- Data for Name: npc_chat_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.npc_chat_history (id, npc_id, player_id, player_name, role, content, created_at) FROM stdin;
c0cc633e-537b-49ae-b0eb-42d1b24eaafa	94fb8909-0438-4fbe-9217-3a0eb2d258d1	local_player	旅行者	user	你好	2026-03-04 15:40:13.129262
1a485a25-500e-4b17-b647-8bd258910c15	94fb8909-0438-4fbe-9217-3a0eb2d258d1	local_player	旅行者	assistant	啊，旅行者，欢迎归来。山风捎来你的气息，像极了三十年前那个迷路的少年……要听溪边老槐树的故事吗？	2026-03-04 15:40:13.129262
2b3c8e77-01bf-4a69-bfad-2c4dc82743fb	94fb8909-0438-4fbe-9217-3a0eb2d258d1	local_player	旅行者	user	地方	2026-03-04 15:40:40.730336
6908c188-756c-4690-b0c9-f05141ce2edc	94fb8909-0438-4fbe-9217-3a0eb2d258d1	local_player	旅行者	assistant	这是青石岭，我守了六十三年。溪水绕过三块卧牛石，流向你来时的雾里……孩子，你脚上的尘，可是从山外带来的？	2026-03-04 15:40:40.730336
7c47baa9-f6f2-4acc-b961-cd361d1e1790	94fb8909-0438-4fbe-9217-3a0eb2d258d1	local_player	旅行者	user	你在这多久了	2026-03-04 15:42:32.420194
cfcd09e0-ce38-4037-bf5d-3bf7dc74b90d	94fb8909-0438-4fbe-9217-3a0eb2d258d1	local_player	旅行者	assistant	六十三载春秋。我种下的第一棵茶树，如今已亭亭如盖，年轮里刻着七场大雪、五次旱灾……你摸摸这树皮，还温着呢。	2026-03-04 15:42:32.420194
\.


--
-- Data for Name: npcs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.npcs (id, name, description, model_url, model_type, avatar_emoji, "position", rotation, scale, ai_provider, ai_model, system_prompt, personality, behavior, memory_config, is_active, created_at, updated_at, shape_code, shape_desc) FROM stdin;
013ab3ce-c880-47b3-b41c-7ca7c3b707f6	老兵	在虚拟战场征战多年的老兵，是虚拟世界的第一个NPC	\N	glb	🧑	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	1	qwen	\N	你是NPC，你是一位德高望重的长老，见证了这个地方数十年的变迁。你说话智慧、缓慢，喜欢用故事来传达道理。对玩家充满慈爱，乐于分享历史和传说。每次回复不超过60字。	{"tags": [], "greeting": "你好，{player_name}！"}	{"auto_greet": true, "patrol_points": [], "greet_cooldown": 30, "idle_animation": "idle", "patrol_enabled": false, "talk_animation": "talk", "walk_animation": "walk", "approach_player": true, "detection_radius": 8, "approach_distance": 2.5}	{"context_turns": 8, "remember_players": true}	t	2026-03-03 10:05:52.452689	2026-03-03 10:05:52.452689	\N	\N
94fb8909-0438-4fbe-9217-3a0eb2d258d1	长老	长老老者	\N	glb	🧑	{"x": 0, "y": 0, "z": 0}	{"x": 0, "y": 0, "z": 0}	1	qwen	\N	你是长老，你是一位德高望重的长老，见证了这个地方数十年的变迁。你说话智慧、缓慢，喜欢用故事来传达道理。对玩家充满慈爱，乐于分享历史和传说。每次回复不超过60字。	{"tags": [], "greeting": "你好"}	{"auto_greet": true, "patrol_points": [], "greet_cooldown": 30, "idle_animation": "idle", "patrol_enabled": false, "talk_animation": "talk", "walk_animation": "walk", "approach_player": true, "detection_radius": 8, "approach_distance": 2.5}	{"context_turns": 8, "remember_players": true}	t	2026-03-04 15:39:57.127356	2026-03-04 15:39:57.127356	function createNPC(THREE, scene) {\nvar group = new THREE.Group();\n\n// 身体主块\nvar torsoGeo = new THREE.BoxGeometry(0.3, 0.6, 0.3);\nvar torsoMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // 棕色\nvar torso = new THREE.Mesh(torsoGeo, torsoMat);\ntorso.position.y = 0.9;\ngroup.add(torso);\n\n// 头部 - 圆柱体型，顶部渐小\nvar headGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.25, 16);\nvar headMat = new THREE.MeshLambertMaterial({ color: 0xF5F5DC }); // 浅灰色\nvar head = new THREE.Mesh(headGeo, headMat);\nhead.position.set(0, 1.55, 0);\ngroup.add(head);\n\n// 手臂 - 直线型，末端有五个手指突起\nfor (let i = -1; i <= 1; i += 2) {\n    var armGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1);\n    var armMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });\n    var arm = new THREE.Mesh(armGeo, armMat);\n    arm.position.set(0.2 * i, 0.7, 0);\n    arm.rotation.z = Math.PI / 6 * i;\n    group.add(arm);\n\n    // 手指\n    for (let j = 0; j < 5; j++) {\n        var fingerGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05);\n        var finger = new THREE.Mesh(fingerGeo, armMat);\n        finger.position.set(0.2 * i + 0.05 * (j - 2), 0.65, 0.05 * (j % 2));\n        group.add(finger);\n    }\n}\n\n// 脚 - 方块型，稍粗壮\nvar footGeo = new THREE.BoxGeometry(0.25, 0.15, 0.25);\nvar footMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });\nvar leftFoot = new THREE.Mesh(footGeo, footMat);\nleftFoot.position.set(-0.125, 0, -0.125);\ngroup.add(leftFoot);\n\nvar rightFoot = new THREE.Mesh(footGeo, footMat);\nrightFoot.position.set(0.125, 0, 0.125);\ngroup.add(rightFoot);\n\nscene.add(group);\n}	长老
\.


--
-- Data for Name: object_transform_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.object_transform_overrides (object_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, object_name, created_at, updated_at) FROM stdin;
905793ad-5997-49d0-8051-1c2049e59776	19	0.8633314475297746	99	0	0	0	1	1	1	记忆空间	2026-06-13 17:25:23.192084	2026-06-15 14:58:56.598864
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (id, buyer_id, shop_item_id, quantity, total_price, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at) FROM stdin;
\.


--
-- Data for Name: player_inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.player_inventory (id, user_id, code_id, acquired_at, is_used, used_at) FROM stdin;
43f8c734-3845-40bb-b0b1-e58df45bbd5a	e0bc4767-f17e-4992-89ae-8feb0a633d03	38005d96-9dbe-4cb9-bff5-bf9327d7911a	2026-06-04 18:26:12.363365	f	\N
8fd749c4-70d9-41c0-a996-909c8e35c9fb	899b45d8-6d56-4903-b1f3-788a00f60064	0aa7a78a-2fa0-4d00-bcd5-42e9d7f6547b	2026-06-04 18:32:43.456005	f	\N
\.


--
-- Data for Name: plots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.plots (id, owner_id, "position", size, buildings, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000001	0c4dadd7-71f7-4074-974f-533a201aa382	{}	{}	[]	2026-06-05 15:49:20.812799	2026-06-05 15:49:20.812799
\.


--
-- Data for Name: portal_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portal_logs (id, portal_id, character_id, used_at) FROM stdin;
9c7624c1-2cd4-4b9d-8c05-3948cc189900	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-10 15:01:23.079272
1843c758-4daf-4df4-822a-51b8aa08d0f6	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:27:51.468061
626ecb73-147e-4195-ac9b-07d38dfb9528	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:27:58.828775
82d3713a-1d2a-48b9-bbee-479ca63c1088	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:28:04.57673
2b3cce82-bcdb-4912-a876-390e0c5488eb	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:28:09.345888
1cf791ae-8f0b-4672-b7ee-3c03d12c2048	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:28:13.614289
950e3c5d-32e2-4453-9aa9-d243e885f6dd	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:28:19.465976
f6ec18ff-8374-4bbc-9b97-98aff33d7e36	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:28:26.703195
af6d7dca-595f-42ca-9b8f-13991fcf0587	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:44:51.5511
99635203-e014-45f9-a0e3-41a533ef5917	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	c878ce00-000d-44b4-a998-fec6ad8641c5	2026-02-10 15:47:00.368113
c7905a94-626e-43b2-b8ad-060660eef0b6	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 15:47:06.94977
c5fcec09-4e87-4ca7-bc7d-da7de1087197	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-10 15:47:14.773896
79eddb57-34cd-4300-bbce-804f73bed068	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-10 15:47:46.130655
3d647cdf-620c-4c73-b4c1-7d2911d6e7cf	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:00:49.01287
41cf9dce-87c7-4a08-a197-ebf94c390b1c	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:06:21.817696
0b8875dc-6aed-484a-858d-203eef9001a3	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:11:04.916213
1e82797c-810a-4907-9cd4-c98153cc7a13	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:24:01.998096
a7c728b8-1f02-400b-bb7c-a85c03ecf84d	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:30:43.664143
1a08c126-8462-4cdf-a0a5-6e5bf5dccc7b	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:33:39.610236
e4fc6120-8d1b-429b-965c-10a824539d27	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-10 16:36:19.057501
a2dc053d-ee8d-4b47-942a-9a23c9c7701b	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:37:12.042846
b6d5f6fb-f257-4ade-85b9-d1c8d83cb939	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:41:04.596855
126ffe72-d371-443a-af28-05a0d3fdcc9a	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:42:15.314407
76e8e7eb-f2b5-485f-bad4-57871b40d981	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:42:35.148895
f93016ce-8bbc-4544-b000-e3f3accd1de0	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:47:20.297926
6a9ea6cc-177a-4626-bff7-954e8b8642b1	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	96de0d5b-4dcf-4cbf-8e61-302bbf2763a9	2026-02-10 16:50:29.411419
ce5732ee-c7de-4ac4-904c-cfaa353a7ca8	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-10 18:00:59.895573
155030c6-347d-4d68-a815-b7198c7e57f6	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-11 10:43:12.339168
57c5014d-7ea2-4bbe-bc40-c8c99e556e53	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-11 13:51:13.338864
c298653e-c197-48df-bca4-ed3aedf38208	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-11 14:15:51.864753
6402ea03-c634-4659-bf7a-5b7112f565d1	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-11 16:19:24.742079
75709623-87ce-4d18-a1e5-e471a64f120a	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-11 16:48:45.888225
ecb4c3d5-3a6a-460e-b21a-7a899b0df791	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-11 17:05:33.18905
784a1771-8c94-4fa7-aab5-e3d2387b4761	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-12 11:58:46.638186
8775ad01-6d57-4a01-ad14-de775d2b1c3d	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-12 14:42:34.966781
d500b868-d3f7-47bd-979e-0d4fcf5d3fad	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-12 15:29:52.836273
fc5e0275-c626-44ac-bbc5-a2159701a025	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-13 11:35:45.48898
9af88459-87f3-426d-93ec-f8ef6a5f92fe	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-14 14:13:55.279495
f16a67bf-70d5-4c25-9e3a-3a04898eb8b0	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-25 09:55:10.775295
d6aad413-deed-485b-8916-85993ee8d3eb	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-25 18:07:19.988229
8fc6f5b9-80f6-4de1-9075-acf987e40a90	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-02-26 10:51:15.329068
aa1803db-7e20-446a-960b-fb4dd804d244	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-02 09:39:41.508598
7c925132-1beb-4632-83b9-b5a7635e0cfe	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-02 14:09:18.997382
63de9896-dbaa-4d92-a3cb-b6bad977569f	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-03 09:25:37.462694
77e4f1c3-6d3d-4ad0-ba1e-2a723ddc8ea6	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-03 17:54:35.187608
ba50d433-ae3a-4005-92fd-a0c9ab717159	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-04 11:47:39.55975
8f651513-89f0-47d9-8c0f-fec7cef3b07b	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-05 08:31:19.652218
a8ffd265-57dd-48e3-80e5-9b16d745a90f	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-05 09:31:01.824138
13458f57-8665-4278-83b7-e3cd976aa044	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-05 10:43:26.796217
54d2a445-8bdb-4237-941f-f422c10d361c	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-05 10:43:34.592303
523d972b-becd-4796-ad00-eee7f9ac81de	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-05 10:43:47.308694
df0981ab-084e-4557-bfbe-393ae0d5614e	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-05 14:25:28.9701
0d9288db-e553-4916-be8c-f12c57f95d34	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-11 17:34:27.954786
4e7f2335-6af1-488a-9b38-1413ef9929a0	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-12 09:35:38.106369
6a6c95aa-1e4e-4681-9877-9c49703e2588	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-18 11:50:04.469604
f2659ee2-ff6e-4809-98b6-0df44b7cc7fd	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-18 14:37:41.298413
f3050870-ea95-4e25-a65d-4de3bb8018eb	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-30 10:00:39.549202
2abebb96-2b07-4d72-a3d9-e9e655e8f18f	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-03-30 14:53:22.809735
71c867bb-9d1c-49fd-910d-d74c6d03a1e1	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-05-11 11:21:34.595643
9a652c42-1562-4fbb-a510-cc523202601c	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-01 17:09:15.683934
ec85d0f3-436b-48ff-abef-fa87d97de882	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-02 10:29:59.612144
2d57d1c6-ff05-4960-a46d-3bb62d0f78b8	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-02 17:00:43.984248
ee34462f-2a75-4a19-a998-d6937e1eeefd	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 10:56:22.114818
7336c0e3-b9db-43cc-b49f-4546e7765c72	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 10:56:32.918475
dabd84be-f04b-402d-a4cf-2212423d8304	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 10:57:04.039702
60f1f7c3-1ce9-41e0-b2af-4881066f9123	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 10:57:11.651229
3c649ef3-22e3-48fc-b189-5b5db9aa4ada	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 10:57:11.685849
93995880-8b73-4efb-b747-2d9c32485a96	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 11:35:28.99449
edcbdf3f-07b5-457a-a077-93a00dd37c09	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 11:35:36.028782
713786fb-f9e2-4299-9333-262564bc577f	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 11:35:43.445827
74307886-0520-4bda-8601-c0554d12e2c2	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 11:35:49.225435
c66090b2-670e-4b43-9e87-05761797fce9	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 11:35:55.832938
0e4038da-bfda-4b6f-b007-7357bdd9ccdf	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 11:35:55.8636
5b8b2223-71bb-418b-a66f-7f3c7b9ca8c5	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 15:34:20.199453
35d78d79-ebef-4ebc-ac50-09b5fe585869	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:32.284367
09e89426-4155-4235-b5d1-8ccbde132495	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:37.406682
f6ad8e09-3353-4409-8c45-946c613818c8	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:37.444017
4be1e006-ffa3-4887-bb66-b0b01d888192	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:41.343873
e3b871f1-2e7f-492b-867f-0785b0ac80ae	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:41.372294
5850ed9d-a138-45d2-9e7f-ddfd1b021a61	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:43.912678
46a2b393-0693-4800-928c-d5f12bda409a	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:48.285499
4bd8659f-318d-44ae-a7b0-a4122e08de29	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:26:54.165797
08a59c76-db6a-4c9c-a919-f5661a3b3709	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:27:04.867112
20e2c7a7-9fed-4dde-a671-3397ce1b6edd	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 17:30:00.952262
2fec9c2d-237f-477b-bf82-e5d88c195d9f	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-04 18:26:06.926587
708f4134-118a-4b98-af2a-d192a999ffff	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:32:36.738469
cc2c54d8-bcb3-4d4d-b142-a50aa638e8c4	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:33:39.927466
1f13e087-d277-4248-99e3-3f0ae561af4d	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:33:50.717348
e0e6899e-5964-4ca9-9593-f650f2f3b112	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:33:56.963443
f5a1e586-2241-4472-a8ee-2e623320fb82	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:33:56.997047
666f1ae4-7ff3-4c1f-bf5c-fdc62da80598	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:34:26.208666
5f098350-5813-44ee-98af-0783d1d1abbf	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:35:06.952104
a839703a-de3c-4802-b95c-3397bc4d851b	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:35:35.149943
079d7623-773f-4ca2-a4fb-54cbdbfc7148	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:35:35.168935
ed22c031-b595-4700-b772-28697e51fbf8	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:45:27.115005
adf4aece-05c1-461e-ba43-9e399ed3f950	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:46:18.988795
98623298-4c16-410e-bf8b-f97764d20009	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-04 18:46:19.393657
cb7e4af3-0d54-4ee8-a0c3-3c250ca7fa68	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-05 09:34:29.164251
e86b891e-bbac-489a-88d9-f7ec43c0f895	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-05 09:35:02.935106
2fd625f4-504c-4808-91ad-2069be1f153a	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-05 09:35:17.877731
f094cb50-fc3a-4760-b00a-a166f10b17e7	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 10:12:21.396915
0f191900-99b4-48c6-b75e-a51631fe0ddc	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 10:12:30.892512
1378a1bb-cd2e-4c23-b836-62661bd46263	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 10:12:30.901193
3d7411d5-dce8-492e-9ff5-f036333b125e	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 10:12:36.551817
41b012a8-6e85-4791-a788-4e8e9b7ccff2	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 10:12:42.335256
b4212b25-1327-4a86-a0b5-6feb9a2d180b	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 10:12:59.773099
f77683d9-6c69-4a74-90f6-179d343bc398	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 16:21:02.869435
ab7aa4f4-01e3-454d-abb3-b935ed9db611	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-05 18:30:33.521027
b8ecdc1e-588d-4c02-beb5-d3148160b4e5	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 14:50:34.813857
63565bbe-269a-40bb-bb42-5c66965a8c08	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 14:50:55.66829
0a6bd28a-ff3b-402d-aacc-6c2cb35009e8	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 14:56:52.390108
be417e76-9a72-45c5-b264-adf99d0a028d	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 15:06:02.956429
f357ec1a-c514-451e-a226-6df36fb30834	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 15:06:24.218855
1c2d6a03-143a-410e-b9d9-59cb2af72eac	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 15:10:11.437226
0286658a-ec15-4b9d-a3b2-a7f9c9f83af5	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-07 15:15:57.978466
7e008b8c-b470-4f9c-95fc-8b0ec3d2f154	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 08:59:19.004126
89fb0493-ecbb-4e9e-af38-54a9dc7285b8	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 08:59:33.85019
c9f149c9-7991-4ca0-b4b6-1a0b2071bbe4	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:20:09.115536
d68efdec-f159-4da5-834f-7bb125a7bce8	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:22:46.123224
0fbc2983-a62c-4df5-85b7-debb030f3b20	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:23:18.593775
b9238b5f-edff-4d20-9432-6eb76c8d2aeb	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:42:45.614531
4630546e-0309-45ea-a545-30801a0301a4	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:43:19.819369
ad6b873e-7554-40ad-984c-d7c6f9ac7049	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:43:54.317517
3ff6d915-da7e-4163-94b5-d7a326f2fd06	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:44:08.87187
1a5a9a49-fbd7-4352-93c7-0321eef8ae54	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 09:54:33.985808
65f64644-ed4f-41a2-bbaf-6668696caf48	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 10:03:10.99546
4eee6c5f-47dd-47f1-b31d-3d84685d9cdd	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 10:20:44.337212
cdffc9db-3cdc-499d-8ad8-cbdfc08726d5	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 10:24:24.724878
9a9eb7cb-4d25-4303-85ad-0489a9f89862	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 10:54:41.195829
9070aedb-7e9a-4894-9987-08dfe99eea04	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:08:54.182177
db8b6f65-c74c-4169-8400-d5c6e6430823	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:09:10.00651
c90d9d54-e23d-40e4-8e59-fe88062fd98f	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:11:34.800458
19f06a60-399e-41a2-a763-0789aee89fa8	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:11:40.200276
f0873dbe-6c97-4c71-90f9-b353f0ed41b3	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:11:40.217768
f780bb90-a10e-4485-9c86-e440a7e3f0e0	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:12:01.410279
8dc12911-0510-467a-a9dc-30a286403309	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 11:23:49.958493
00cc3470-868d-435f-b83b-d2b3771d9e6a	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:12:33.225709
602eed9c-2a8c-44f4-bb6d-e5155654caee	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:13:50.947896
b8694238-6786-49e5-b796-ce6bd9b02d96	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:17:14.749063
69cabfaa-7dfd-4c7b-aec0-747eb3d59cb5	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:22:03.95188
5676765c-58ae-4b66-b7ca-43011f6e280b	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:29:06.050244
77ab24d2-bdfa-49d1-811f-fe16e633049e	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:39:16.688002
c467c020-a604-4799-8c24-c26be7c25e76	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:39:34.553549
b6f575b9-cfc2-49eb-b29d-4fb6606706a9	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:42:07.180303
98afb5b5-b3ce-416a-be09-230ac003c3ad	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 14:42:54.648863
74e8bac7-c2e0-4497-8f73-4f9d9b2b0d05	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 15:43:20.420608
49194e34-1dbc-462d-8177-3c2f31f3b5ec	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 16:54:39.785731
53085bad-1175-47f6-a947-aa026b9135d2	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 16:57:12.959418
e39cc7f9-d6a2-4b6c-a442-e09e40473719	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:15:44.29886
24c0e7da-5b53-48b0-8f17-5bbfe1d82a1c	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:17:22.009228
9025f1be-61d3-4193-9cba-c16723701e2b	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:18:07.663084
03334822-8932-4a3c-950f-c84ffab1739e	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:32:34.545233
ff532dca-2199-4a02-b99f-21b220adacad	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:39:39.085979
fc947603-8639-4012-bb50-365aab8e1c63	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:42:02.933738
394a7c90-0a21-4f23-b009-c05411fd031c	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:42:12.027495
82d2301b-8832-42b8-8e62-5d618711a5ca	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:48:43.359553
6ff22a3e-750a-4b5a-8cd3-57d13bd162ed	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:51:37.786826
45cda081-8796-4fe3-9e69-847133bad8fb	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:56:41.151516
ae03e49f-29ed-4b76-8354-13965f62812a	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:56:48.070513
e2ea083d-717d-4460-afae-dcda4147718b	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 17:59:00.410622
55e3fc3c-0e6e-43c9-b82e-2a697e7b82a8	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 18:07:40.708488
846d85a2-ea18-48fb-a93f-58a1426e7bdb	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-08 18:07:41.155967
9e14d2f4-8a10-47af-a1d1-3b4302dfbc2d	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-09 17:36:24.903522
477feae2-0654-4495-889f-b64f9298ad89	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-10 09:57:42.019021
e34bbe56-e286-4454-9ef1-3da9a58921f5	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-10 10:26:17.656079
df45d6bb-d43b-474b-847a-a31aac772d2c	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-11 09:45:47.432738
79d3fc81-3b60-4e97-8683-ec3d06258cb7	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-11 09:58:27.703403
85ba937c-6ff1-4ae7-95fd-68f04c6b5e1e	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-11 11:02:16.963833
2cc606e3-262d-4570-97e4-8d829e5f4b32	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-11 11:02:30.237073
506a4207-9dac-4b6c-b35e-f88716791ef7	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:07:27.475995
10acdf4f-54a7-4a3c-afd9-a5d5cf914091	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:07:30.190983
b92ef193-9c31-4d2c-a8e4-b88542d8d9c6	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:42:15.844116
51057620-35fd-495c-8b03-fa35f2d85b83	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:43:05.894304
34022978-c121-4bba-88ec-f64d9f4eaf46	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:43:07.829287
492a3e30-c9ee-4335-9884-130db43c43dc	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:45:44.129927
038cf090-7733-482b-9967-255d3abb1255	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:45:47.107559
47718035-8d9f-477a-b7a2-6818446127e2	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:45:47.126471
dbbe6689-4c95-461b-9498-cc5300eb5099	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:46:16.146258
6c6b2992-b6ed-41e6-8d56-47876e4c4b16	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:46:57.997944
4273d337-4793-4ece-a1f5-fb0bf5f533a7	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:47:04.094227
5c453c9f-fa6f-4e64-81c0-b3b4a069f650	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:47:04.10997
15379882-b554-4237-b6d1-bbb0c680de2d	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:47:14.177507
90e19d8d-b4ea-48c1-856a-92bc05fec366	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 15:47:28.045989
09bea209-f916-4490-b38d-1298b26606ed	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 16:03:46.53631
9f903477-f5d1-449e-a05d-d996cd8a3a67	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-12 16:40:53.303714
0c46035b-d7c2-4187-be26-1c9d82118091	905793ad-5997-49d0-8051-1c2049e59776	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-12 17:14:39.064854
85c9acce-d529-4d94-a737-2e47c747eb27	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-12 17:18:17.041622
ffce2987-f22c-4dfa-88bf-f30220ea7efc	f660be5a-4d30-4040-b492-f7265546367b	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-12 17:18:18.39059
f6c6fa82-bb2e-4c46-9e35-fcd3ab9c49d1	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	56294dad-9f9c-4e86-9d74-41efb5fe5138	2026-06-12 17:18:20.619985
dac6af75-7ddd-41f1-952b-115ecfffc24d	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-13 14:42:22.320538
b025192b-1cfa-4d68-baf7-5178bcd27077	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-13 14:42:22.411386
419774db-bc9d-4b07-b8b4-98bf169ca05c	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-13 14:42:26.647668
76c19f75-5824-4493-851c-9003ff4c9723	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-13 17:25:10.352156
b581519a-e7a3-4019-bb81-abe4b755eaf2	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-13 17:25:15.718877
48ebd2dd-1e6e-49c1-a732-b69f521b896e	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-13 17:25:16.019303
ac7e4074-6f50-48d2-b3bd-742568e7efd6	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:02:50.57899
713343e3-54f8-4592-ba48-a98ad606757f	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:28.038036
983869bb-c1a6-4f07-aeb8-03e2e040de3a	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:28.085713
e6ceabbb-3bcd-4ce3-a4b8-c4b371b74649	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:38.88781
cf9e1901-ebc4-4194-9b2f-df5ce2f2f079	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:39.815854
ba24bdb8-a887-4a27-89ba-4f6944ca28fd	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:40.554101
b30b5dea-d806-4078-a679-abf6d898ed46	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:41.836784
8197f9f3-2121-43f5-aaca-e810d673abe1	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:42.713636
12f03aac-df6c-40af-ac8d-ca496e64de52	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:53.791416
e00a10a3-7eb3-4d76-a957-74adeacba4b2	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:54.947568
8b5a0a16-ac0f-4643-bcf4-f34898eb962c	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:57.280716
845317e6-491f-49b4-a262-dfe6cd8c2f36	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-06-15 15:03:58.565974
8b9e3ce6-0be4-4a89-8cb4-3c3d04ee0159	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-08 17:32:29.705263
a8856f8a-4147-4270-8087-f773bf2520ae	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:16.988705
3b751430-79c6-434c-a253-794c05f72ee1	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:23.029388
716441e5-cb92-47ff-b25f-12a54d26c230	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:47.532755
7afaba4b-7250-4362-b187-9ce330b7fd32	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:47.548782
5dc37ea7-51f0-4a90-8c9e-9bc42e1b03f7	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:51.404586
897e661a-96f2-40c5-a1fe-fe1266ef97b0	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:51.435464
2b1d3f43-271f-4198-bc07-f1bac1458fc0	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:52.464038
25263454-31d2-4344-a0ab-d14c00de030a	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:29:58.112615
50017f49-5f96-41b6-ae6f-263e8fc938eb	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:30:04.24614
45723098-9dbb-49c2-9a95-01ad1138d73e	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:30:09.567053
9c359c4d-9a31-426f-b1d7-e8ca50d66dab	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:37:18.260009
20f88d09-715d-482a-8fa9-c4dace531488	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:37:18.734489
5d8c3576-3d34-4a64-95cc-4d8c7f3026ae	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:37:23.286332
ca86737a-fc13-4eb3-84ad-7e4fcfeb33f0	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:37:25.952182
0396864b-17ea-4b38-815b-b1a9105a4d81	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:37:25.966353
c6445853-c491-4c5b-9031-2a68118831a7	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-13 16:37:26.999858
b895b7d5-8179-4ead-bd8b-28989f78b701	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 13:48:09.929741
9b0f2738-043e-453f-8f21-b1981bbb3a5a	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 13:48:10.811564
889555f7-3a3e-463e-8ff5-b2f2e5206bfb	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 13:48:12.210657
b9ce1ece-6705-4481-b288-ca90f042c2f4	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 13:48:22.551308
14ff359d-85c3-4b5a-b383-c7b963e38ce7	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:08.058119
7afafe0b-b259-4caa-8308-db968742fbfc	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:16.369642
9e699616-6d4f-410c-9e7a-dda61981d346	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:24.671919
211f9a7b-4668-425a-88e2-70c315247cc7	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:31.956637
cb878825-f698-4a25-a461-e24d9fe1aa5b	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:31.982153
58ebc6d5-b994-44b1-9b42-02dc7d8e7124	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:36.306436
bee4a488-052a-48dd-9523-bb64b45e7b2c	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:36.314475
e4b0351d-d4a1-4799-9654-03264783d0f4	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:43.266213
bfeb7a3c-263c-4a1a-b4ea-af942007c8a4	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:24:43.299347
4edc7c53-f945-41d4-9c23-8e655afbe348	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:46:32.639946
87cf63f1-7c30-4b5e-8d42-a6cf8b6d98fa	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:46:40.740899
db1e9b03-c33d-4470-b9de-4a25796dabba	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:46:40.768339
1f53b645-d4ad-4085-a72f-b343c7f2ff95	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:46:46.470349
d6ab928d-8619-4050-9e70-5dde775c3ffc	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:46:46.494102
23d759c2-ae0f-4b30-aa06-a7f6afcff6d3	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:52:37.879839
bf84fe54-0b8c-48ec-a8d0-6d015561da1d	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:52:38.930775
803e43f6-0210-4b2f-ae77-42def7dc7120	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:52:43.944276
d38aa7e9-3747-41b0-b229-6680f3ed7f45	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-23 16:52:43.971165
c22977b4-3a94-4bbc-b520-c155b082e991	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-26 10:00:12.012915
aa644a2b-b46d-4f7b-ab74-34824bc99bff	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-26 10:00:37.89793
696f2308-9fee-4bf9-95a0-261921fec4b7	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-26 10:00:37.938726
ad8f6346-24d8-4406-9f43-9ac0ada6ecd9	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-26 10:01:27.028998
aae95651-8513-4c9d-a2bb-e3057b13a380	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-26 10:01:27.043483
0351889c-e5e6-43e7-ac8a-852256486f99	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-28 15:24:05.041993
8faf2392-fc14-462f-be0f-4f2c47315d67	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-28 15:24:39.071266
82652a61-c26a-43dc-95e1-262441d539aa	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-28 15:24:49.872966
017892ae-333d-462d-b3cf-d46b48248021	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-07-28 15:24:49.896755
7cce2cb0-4bee-4594-b711-7d543d33c3e5	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-05 17:51:42.753021
3cb19aa3-7553-4336-9a8c-eaebb28a78f4	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-06 17:12:51.477819
efda3a3c-b0ed-4417-9933-ec234510ce40	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-06 17:12:57.85685
06642940-a571-4e32-a94f-03059111cf93	905793ad-5997-49d0-8051-1c2049e59776	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-06 17:13:02.841903
04234ce0-9e00-4a84-80ff-c79c18eb9a97	f660be5a-4d30-4040-b492-f7265546367b	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-06 17:13:05.826838
410d688c-58b3-4f47-bfbe-6398dba10433	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-06 17:13:05.845254
4a0a6f41-1aab-47ce-88a4-ac308c7048d3	6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	2adb4c4c-b7ec-4366-83bf-423cd455a858	2026-08-06 17:13:27.107193
\.


--
-- Data for Name: portals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portals (id, name, description, source_position, target_position, target_world_url, portal_type, is_active, is_bidirectional, cooldown_seconds, required_level, created_by, created_at, updated_at) FROM stdin;
6291eb02-c425-41ac-b7f5-b9ea2b11fcdb	测试	测试	{"x": 21.3, "y": 2, "z": -16.4}	{"x": 60, "y": 60, "z": 60}	\N	local	t	t	1	1	\N	2026-02-10 15:01:13.312191	2026-02-10 15:01:13.312191
f660be5a-4d30-4040-b492-f7265546367b	测试 (返回)	测试	{"x": 60, "y": 60, "z": 60}	{"x": 21.3, "y": 2, "z": -16.4}	\N	local	t	t	1	1	\N	2026-02-10 15:01:13.3156	2026-02-10 15:01:13.3156
905793ad-5997-49d0-8051-1c2049e59776	记忆空间	勿忘国耻	{"x": 19, "y": 4.5, "z": 99}	{"x": 193, "y": 1, "z": 918}	\N	local	t	t	0	1	\N	2026-06-03 17:12:25.651613	2026-06-03 17:12:25.651613
\.


--
-- Data for Name: reward_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reward_codes (id, pool_id, code, reward_name, reward_desc, platform_url, is_claimed, claimed_by, claimed_at, expires_at, created_at) FROM stdin;
e10d9b2f-fd19-4391-ba84-0b48033d04a6	2888b893-fc6e-4491-b3c6-638e230cdb6f	欢迎体验【淘宝】https://e.tb.cn/h.ihELlxTz0eufzKI?tk=r17f5ZGanYp MF168 「双排波浪齿大齿卷发梳子宽齿不打结顺发女士长发烫发梳专用静电防」点击链接直接打开 或者 淘宝搜索直接打开3	淘宝优惠券	复制到淘宝即可	\N	f	\N	\N	\N	2026-03-24 18:27:42.881498
87708df8-9459-4549-bbca-9b0572846c79	2888b893-fc6e-4491-b3c6-638e230cdb6f	欢迎体验【淘宝】https://e.tb.cn/h.ihELlxTz0eufzKI?tk=r17f5ZGanYp MF168 「双排波浪齿大齿卷发梳子宽齿不打结顺发女士长发烫发梳专用静电防」点击链接直接打开 或者 淘宝搜索直接打开4	淘宝优惠券	复制到淘宝即可	\N	f	\N	\N	\N	2026-03-24 18:27:42.882109
708b9fa3-c948-41c6-ad99-76aaca1da6ee	2888b893-fc6e-4491-b3c6-638e230cdb6f	欢迎体验【淘宝】https://e.tb.cn/h.ihELlxTz0eufzKI?tk=r17f5ZGanYp MF168 「双排波浪齿大齿卷发梳子宽齿不打结顺发女士长发烫发梳专用静电防」点击链接直接打开 或者 淘宝搜索直接打开5	淘宝优惠券	复制到淘宝即可	\N	f	\N	\N	\N	2026-03-24 18:27:42.882561
18c4e44d-25e5-49ce-9918-6ae8cfd1162f	2888b893-fc6e-4491-b3c6-638e230cdb6f	欢迎体验【淘宝】https://e.tb.cn/h.ihELlxTz0eufzKI?tk=r17f5ZGanYp MF168 「双排波浪齿大齿卷发梳子宽齿不打结顺发女士长发烫发梳专用静电防」点击链接直接打开 或者 淘宝搜索直接打开6	淘宝优惠券	复制到淘宝即可	\N	f	\N	\N	\N	2026-03-24 18:27:42.882986
38005d96-9dbe-4cb9-bff5-bf9327d7911a	2888b893-fc6e-4491-b3c6-638e230cdb6f	欢迎体验【淘宝】https://e.tb.cn/h.ihELlxTz0eufzKI?tk=r17f5ZGanYp MF168 「双排波浪齿大齿卷发梳子宽齿不打结顺发女士长发烫发梳专用静电防」点击链接直接打开 或者 淘宝搜索直接打开1	淘宝优惠券	复制到淘宝即可	\N	t	e0bc4767-f17e-4992-89ae-8feb0a633d03	2026-06-04 18:26:12.362634	\N	2026-03-24 18:27:42.387603
0aa7a78a-2fa0-4d00-bcd5-42e9d7f6547b	2888b893-fc6e-4491-b3c6-638e230cdb6f	欢迎体验【淘宝】https://e.tb.cn/h.ihELlxTz0eufzKI?tk=r17f5ZGanYp MF168 「双排波浪齿大齿卷发梳子宽齿不打结顺发女士长发烫发梳专用静电防」点击链接直接打开 或者 淘宝搜索直接打开2	淘宝优惠券	复制到淘宝即可	\N	t	899b45d8-6d56-4903-b1f3-788a00f60064	2026-06-04 18:32:43.455064	\N	2026-03-24 18:27:42.815465
\.


--
-- Data for Name: reward_pools; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reward_pools (id, pool_name, description, created_at) FROM stdin;
2888b893-fc6e-4491-b3c6-638e230cdb6f	淘宝优惠券2222	22	2026-03-24 18:27:04.691068
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
1	你的出生日期	1	t	2026-06-16 16:15:15.927647	2026-06-16 16:15:15.927647
2	你的手机号	2	t	2026-06-16 16:15:15.927647	2026-06-16 16:15:15.927647
3	你的身份证号	3	t	2026-06-16 16:15:15.927647	2026-06-16 16:15:15.927647
4	你前女友的名字	4	t	2026-06-16 16:15:15.927647	2026-06-16 16:15:15.927647
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
167	seo_title	创世虚拟世界CRM系统 - 虚拟世界主界面	SEO标题（Title）	f	\N	2026-06-23 17:57:16.645091	2026-06-23 17:49:53.119825
1	TENCENT_SECRET_ID	AKIDW0JQL4bv41lIclieR4WmpgKn480f8QWQ	腾讯云 SecretId	t	1	2026-02-11 09:56:17.605647	2026-02-11 09:02:23.484269
2	TENCENT_SECRET_KEY	kIeol8ORM4ZsysZ3NVQBj5EBxYwBG9qL	腾讯云 SecretKey	t	1	2026-02-11 09:56:17.611956	2026-02-11 09:02:23.484269
3	TENCENT_REGION	ap-guangzhou	腾讯云地域	f	1	2026-02-11 09:56:17.614031	2026-02-11 09:02:23.484269
168	seo_description	基于Three.js的3D虚拟世界CRM系统，支持虚拟角色、3D建筑、联邦传送等功能	SEO描述（Description）	f	\N	2026-06-23 17:57:16.647437	2026-06-23 17:49:53.155687
169	seo_keywords	虚拟世界,3D游戏,Three.js,CRM系统,在线游戏	SEO关键词（Keywords）	f	\N	2026-06-23 17:57:16.647905	2026-06-23 17:49:53.156317
606	model_guard.max_file_size	10	\N	f	\N	2026-07-31 16:53:55.066323	2026-07-31 16:53:49.52416
607	model_guard.max_triangles	50000	\N	f	\N	2026-07-31 16:53:55.068202	2026-07-31 16:53:49.584292
608	model_guard.max_vertices	30000	\N	f	\N	2026-07-31 16:53:55.069475	2026-07-31 16:53:49.586161
609	model_guard.max_mesh_count	20	\N	f	\N	2026-07-31 16:53:55.070693	2026-07-31 16:53:49.587822
610	model_guard.enabled	false	\N	f	\N	2026-07-31 16:53:55.071995	2026-07-31 16:53:49.589367
611	model_guard.show_warning	false	\N	f	\N	2026-07-31 16:53:55.073268	2026-07-31 16:53:49.591154
612	model_guard.placeholder_style	stickman	\N	f	\N	2026-07-31 16:53:55.076236	2026-07-31 16:53:49.594627
613	model_guard.character_bundle_mode	retarget	\N	f	\N	2026-07-31 16:53:55.07859	2026-07-31 16:53:49.596798
614	model_guard.anim_guard_enabled	false	\N	f	\N	2026-07-31 16:53:55.080417	2026-07-31 16:53:49.598769
615	model_guard.anim_max_file_size	5	\N	f	\N	2026-07-31 16:53:55.081962	2026-07-31 16:53:49.600773
550	subscription_first_auth_cents	6000	首次授权费（分）	f	\N	2026-07-29 17:29:00.595804	2026-07-29 17:29:00.595804
551	subscription_first_auth_months	2	首次授权包含月数	f	\N	2026-07-29 17:29:00.595804	2026-07-29 17:29:00.595804
552	subscription_reauth_after_months	12	断订多少个月后需重新授权	f	\N	2026-07-29 17:29:00.595804	2026-07-29 17:29:00.595804
616	model_guard.anim_max_tracks	200	\N	f	\N	2026-07-31 16:53:55.083266	2026-07-31 16:53:49.602589
16	world_spawn_point	{"position":{"x":-22.44036611078438,"y":9.589744100695807,"z":2.740296999986139},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}	世界出生点位置和变换	f	\N	2026-06-18 16:58:41.346929	2026-02-12 17:11:16.952862
617	model_guard.anim_max_keyframes	20000	\N	f	\N	2026-07-31 16:53:55.084466	2026-07-31 16:53:49.604194
618	model_guard.anim_max_duration	30	\N	f	\N	2026-07-31 16:53:55.085665	2026-07-31 16:53:49.605715
619	model_guard.anim_max_meshes	10	\N	f	\N	2026-07-31 16:53:55.086861	2026-07-31 16:53:49.607266
620	model_guard.anim_total_max_size	30	\N	f	\N	2026-07-31 16:53:55.088064	2026-07-31 16:53:49.61042
147	world_id	550e8400-e29b-41d4-a716-446655440000	世界唯一标识	f	\N	2026-06-22 17:45:07.315001	2026-06-22 17:45:07.315001
148	first_deploy_date	2026-06-22	订阅系统配置	f	\N	2026-06-22 17:45:07.361378	2026-06-22 17:45:07.361378
149	subscription_price_cents	300	订阅系统配置	f	\N	2026-06-22 17:45:07.362862	2026-06-22 17:45:07.362862
150	billing_company	济宁米多信息科技有限公司	订阅系统配置	f	\N	2026-06-22 17:45:07.364258	2026-06-22 17:45:07.364258
151	cn_payment_methods	wechat,alipay	订阅系统配置	f	\N	2026-06-22 17:45:07.365558	2026-06-22 17:45:07.365558
152	en_payment_methods	paypal,crypto	订阅系统配置	f	\N	2026-06-22 17:45:07.366751	2026-06-22 17:45:07.366751
621	model_guard.anim_guard_remote_only	false	\N	f	\N	2026-07-31 16:53:55.089203	2026-07-31 16:53:49.613171
20	world_name	米多科技的世界	世界名称	f	\N	2026-07-12 10:51:20.271573	2026-04-08 16:27:13.46635
21	world_url	https://miduo100.com	世界访问URL（对外域名）	f	\N	2026-07-12 10:51:20.273572	2026-04-08 16:27:13.494513
22	world_description	基于Three.js的3D虚拟世界CRM系统，支持虚拟角色、3D建筑、联邦传送等功能	世界描述	f	\N	2026-07-12 10:51:20.274096	2026-04-08 16:27:13.495139
32	default_language	zh-CN	系统默认语言	f	\N	2026-08-07 17:03:52.309721	2026-06-10 09:55:36.84856
\.


--
-- Data for Name: template_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.template_skills (id, template_id, skill_name, trigger_text, skill_type, skill_scope, animation_clip, effect_type, effect_power, range_distance, effect_duration, cooldown, particle_effect, icon_emoji, sort_order, created_at, anim_glb_url, fx_preset, fx_color, fx_glow, fx_particle, fx_duration, fx_blade_color, fx_glow_intensity, fx_particle_type, fx_duration_legacy, fx_sound_url, fx_sound_volume) FROM stdin;
\.


--
-- Data for Name: threejs_code_blocks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.threejs_code_blocks (id, name, description, code, raw_code, clean_options, tags, thumbnail_url, created_at, updated_at, source_type, source_url, auto_fixes, import_status) FROM stdin;
2	动态发散飞线	动态	\n\n\nclass InitFly {\n    constructor({\n        texture\n    } = opt) {\n        this.flyId = 0; //id\n        this.flyArr = []; //存储所有飞线\n        this.baicSpeed = 1; //基础速度\n        this.texture = 0.0;\n        if (texture && !texture.isTexture) {\n            this.texture = new THREE.TextureLoader().load(texture)\n        } else {\n            this.texture = texture;\n        }\n        this.flyShader = {\n            vertexshader: ` \n                uniform float size; \n                uniform float time; \n                uniform float u_len; \n                attribute float u_index;\n                varying float u_opacitys;\n                void main() { \n                    if( u_index < time + u_len && u_index > time){\n                        float u_scale = 1.0 - (time + u_len - u_index) /u_len;\n                        u_opacitys = u_scale;\n                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n                        gl_Position = projectionMatrix * mvPosition;\n                        gl_PointSize = size * u_scale * 300.0 / (-mvPosition.z);\n                    } \n                }\n                `,\n            fragmentshader: ` \n                uniform sampler2D u_map;\n                uniform float u_opacity;\n                uniform vec3 color;\n                uniform float isTexture;\n                varying float u_opacitys;\n                void main() {\n                    vec4 u_color = vec4(color,u_opacity * u_opacitys);\n                    if( isTexture != 0.0 ){\n                        gl_FragColor = u_color * texture2D(u_map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));\n                    }else{\n                        gl_FragColor = u_color;\n                    }\n                }`\n        }\n    }\n    /**\n     * [addFly description]\n     *\n     * @param   {String}  opt.color  [颜色_透明度]\n     * @param   {Array}   opt.curve  [线的节点]\n     * @param   {Number}  opt.width  [宽度]\n     * @param   {Number}  opt.length [长度]\n     * @param   {Number}  opt.speed  [速度]\n     * @param   {Number}  opt.repeat [重复次数]\n     * @return  {Mesh}               [return 图层]\n     */\n    addFly({\n        color = "rgba(255,255,255,1)",\n        curve = [],\n        width = 1,\n        length = 10,\n        speed = 1,\n        repeat = 1,\n        texture = null,\n        callback\n    } = opt) {\n        let colorArr = this.getColorArr(color);\n        let geometry = new THREE.BufferGeometry();\n        let material = new THREE.ShaderMaterial({\n            uniforms: {\n                color: {\n                    value: colorArr[0],\n                    type: "v3"\n                },\n                size: {\n                    value: width,\n                    type: "f"\n                },\n                u_map: {\n                    value: texture ? texture : this.texture,\n                    type: "t2"\n                },\n                u_len: {\n                    value: length,\n                    type: "f"\n                },\n                u_opacity: {\n                    value: colorArr[1],\n                    type: "f"\n                },\n                time: {\n                    value: -length,\n                    type: "f"\n                },\n                isTexture: {\n                    value: 1.0,\n                    type: "f"\n                }\n            },\n            transparent: true,\n            depthTest: false,\n            vertexShader: this.flyShader.vertexshader,\n            fragmentShader: this.flyShader.fragmentshader\n        });\n        const [position, u_index] = [\n            [],\n            []\n        ];\n        curve.forEach(function (elem, index) {\n            position.push(elem.x, elem.y, elem.z);\n            u_index.push(index);\n        })\n        geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));\n        geometry.setAttribute("u_index", new THREE.Float32BufferAttribute(u_index, 1));\n        let mesh = new THREE.Points(geometry, material);\n        mesh.name = "fly";\n        mesh._flyId = this.flyId;\n        mesh._speed = speed;\n        mesh._repeat = repeat;\n        mesh._been = 0;\n        mesh._total = curve.length;\n        mesh._callback = callback;\n        this.flyId++;\n        this.flyArr.push(mesh);\n        return mesh\n    }\n    /**\n     * 根据线条组生成路径\n     * @param {*} arr 需要生成的线条组\n     * @param {*} dpi 密度\n     */\n    tranformPath(arr, dpi = 1) {\n        const vecs = [];\n        for (let i = 1; i < arr.length; i++) {\n            let src = arr[i - 1];\n            let dst = arr[i];\n            let s = new THREE.Vector3(src.x, src.y, src.z);\n            let d = new THREE.Vector3(dst.x, dst.y, dst.z);\n            let length = s.distanceTo(d) * dpi;\n            let len = parseInt(length);\n            for (let i = 0; i <= len; i++) {\n                vecs.push(s.clone().lerp(d, i / len))\n            }\n        }\n        return vecs;\n    }\n    /**\n     * [remove 删除]\n     * @param   {Object}  mesh  [当前飞线]\n     */\n    remove(mesh) {\n        mesh.material.dispose();\n        mesh.geometry.dispose();\n        this.flyArr = this.flyArr.filter(elem => elem._flyId != mesh._flyId);\n        mesh.parent.remove(mesh);\n        mesh = null;\n    }\n    /**\n     * [animation 动画] \n     * @param   {Number}  delta  [执行动画间隔时间] \n     */\n    animation(delta = 0.015) {\n        if (delta > 0.2) return;\n        this.flyArr.forEach(elem => {\n            if (!elem.parent) return;\n            if (elem._been > elem._repeat) {\n                elem.visible = false;\n                if (typeof elem._callback === 'function') {\n                    elem._callback(elem);\n                }\n                this.remove(elem)\n            } else {\n                let uniforms = elem.material.uniforms;\n                //完结一次\n                if (uniforms.time.value < elem._total) {\n                    uniforms.time.value += delta * (this.baicSpeed / delta) * elem._speed;\n                } else {\n                    elem._been += 1;\n                    uniforms.time.value = -uniforms.u_len.value;\n                }\n            }\n        })\n    }\n    color(c) {\n        return new THREE.Color(c);\n    }\n    getColorArr(str) {\n        if (Array.isArray(str)) return str; //error\n        var _arr = [];\n        str = str + '';\n        str = str.toLowerCase().replace(/\\s/g, "");\n        if (/^((?:rgba)?)\\(\\s*([^\\)]*)/.test(str)) {\n            var arr = str.replace(/rgba\\(|\\)/gi, '').split(',');\n            var hex = [\n                pad2(Math.round(arr[0] * 1 || 0).toString(16)),\n                pad2(Math.round(arr[1] * 1 || 0).toString(16)),\n                pad2(Math.round(arr[2] * 1 || 0).toString(16))\n            ];\n            _arr[0] = this.color('#' + hex.join(""));\n            _arr[1] = Math.max(0, Math.min(1, (arr[3] * 1 || 0)));\n        } else if ('transparent' === str) {\n            _arr[0] = this.color();\n            _arr[1] = 0;\n        } else {\n            _arr[0] = this.color(str);\n            _arr[1] = 1;\n        }\n\n        function pad2(c) {\n            return c.length == 1 ? '0' + c : '' + c;\n        }\n        return _arr;\n    }\n}\n\nfunction Initialize(opt) {\n    var camera, controls, scene, renderer;\n    var clock = new THREE.Clock();\n    var thm = this;\n    var df_Mouse, df_Raycaster;\n    var df_Width, df_Height; //当前盒子的高宽\n    var df_canvas;\n\n    var stats\n\n    function init() {\n        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 10000);\n        camera.position.set(0, 400, 400);\n        camera.lookAt(new THREE.Vector3(0, 0, 0))\n        scene = new THREE.Scene()\n\n        renderer = new THREE.WebGLRenderer({ antialias: true });\n        renderer.setPixelRatio(window.devicePixelRatio * 1.3);\n        renderer.setSize(window.innerWidth, window.innerHeight);\n\n        document.querySelector(opt.id).appendChild(renderer.domElement);\n        df_canvas = renderer.domElement\n        controls = new OrbitControls(camera, renderer.domElement);\n        window.addEventListener('resize', onWindowResize, false);\n        renderer.domElement.addEventListener('mouseup', onDocumentMouseUp, false);\n        df_Width = window.innerWidth;\n        df_Height = window.innerHeight;\n        df_Mouse = new THREE.Vector2();\n        df_Raycaster = new THREE.Raycaster();\n        // onload \n        if (opt.load) {\n            opt.load({\n                camera, controls, scene, renderer\n            })\n        }\n        if (Stats) {\n            stats = new Stats();\n            document.querySelector(opt.id).appendChild(stats.dom);\n        }\n    }\n\n    function onDocumentMouse(event) {\n        event.preventDefault();\n        df_Mouse.x = ((event.clientX - df_canvas.getBoundingClientRect().left) / df_canvas.offsetWidth) * 2 - 1;\n        df_Mouse.y = -((event.clientY - df_canvas.getBoundingClientRect().top) / df_canvas.offsetHeight) * 2 + 1;\n        df_Raycaster.setFromCamera(df_Mouse, camera);\n        return {\n            mouse: df_Mouse,\n            event: event,\n            raycaster: df_Raycaster\n        }\n    }\n    function onWindowResize() {\n        camera.aspect = window.innerWidth / window.innerHeight;\n        camera.updateProjectionMatrix();\n        renderer.setSize(window.innerWidth, window.innerHeight);\n    }\n    function onDocumentMouseUp(event) {\n        if (typeof opt.mouseUp === 'function') {\n            opt.mouseUp(onDocumentMouse(event))\n        }\n    }\n    function animate() {\n        requestAnimationFrame(animate);\n        var delta = clock.getDelta();\n        renderer.render(scene, camera);\n        if (opt.animation) opt.animation(delta);\n        if (stats) stats.update();\n    }\n    init();\n    animate();\n}\n\nvar _Fly;\nvar GL = new Initialize({\n    id: "#box",\n    animation: function (dalte) {\n        if (_Fly) {\n            // 更新线 必须\n            _Fly.animation(dalte);\n        }\n    },\n    load({ scene, camera }) {\n        _Fly = new InitFly({\n            texture: `https://z2586300277.github.io/3d-file-server/` + "threeExamples/application/flyLine/point.png"\n        });\n        let index = 0;\n        var time = setInterval(() => {\n            if (index >= 4000) {\n                clearInterval(time)\n            }\n            var x = 0;\n            var z = 0;\n            var x1 = THREE.MathUtils.randFloat(-200, 200);\n            var z1 = THREE.MathUtils.randFloat(-200, 200);\n            var curve = new THREE.QuadraticBezierCurve3(\n                new THREE.Vector3(x, 0, z),\n                new THREE.Vector3((x + x1) / 2, THREE.MathUtils.randInt(200, 420), (z1 + z) / 2),\n                new THREE.Vector3(x1, 0, z1)\n            );\n            var points = curve.getPoints(500);\n            var flyMesh = _Fly.addFly({\n                color: `rgba(${THREE.MathUtils.randInt(0, 255)},${THREE.MathUtils.randInt(0, 255)},${THREE.MathUtils.randInt(0, 255)},1)`,\n                curve: points,\n                width: 9,\n                length: 150,\n                speed: 1,\n                repeat: Infinity\n            })\n            scene.add(flyMesh);\n            index++;\n        })\n    }\n})\n\n/**\n * 名称: 发散飞线\n * 作者: stonerao https://github.com/stonerao\n */\n	import * as THREE from "three";\nimport { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";\nimport Stats from 'three/examples/jsm/libs/stats.module.js';\n\nclass InitFly {\n    constructor({\n        texture\n    } = opt) {\n        this.flyId = 0; //id\n        this.flyArr = []; //存储所有飞线\n        this.baicSpeed = 1; //基础速度\n        this.texture = 0.0;\n        if (texture && !texture.isTexture) {\n            this.texture = new THREE.TextureLoader().load(texture)\n        } else {\n            this.texture = texture;\n        }\n        this.flyShader = {\n            vertexshader: ` \n                uniform float size; \n                uniform float time; \n                uniform float u_len; \n                attribute float u_index;\n                varying float u_opacitys;\n                void main() { \n                    if( u_index < time + u_len && u_index > time){\n                        float u_scale = 1.0 - (time + u_len - u_index) /u_len;\n                        u_opacitys = u_scale;\n                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n                        gl_Position = projectionMatrix * mvPosition;\n                        gl_PointSize = size * u_scale * 300.0 / (-mvPosition.z);\n                    } \n                }\n                `,\n            fragmentshader: ` \n                uniform sampler2D u_map;\n                uniform float u_opacity;\n                uniform vec3 color;\n                uniform float isTexture;\n                varying float u_opacitys;\n                void main() {\n                    vec4 u_color = vec4(color,u_opacity * u_opacitys);\n                    if( isTexture != 0.0 ){\n                        gl_FragColor = u_color * texture2D(u_map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));\n                    }else{\n                        gl_FragColor = u_color;\n                    }\n                }`\n        }\n    }\n    /**\n     * [addFly description]\n     *\n     * @param   {String}  opt.color  [颜色_透明度]\n     * @param   {Array}   opt.curve  [线的节点]\n     * @param   {Number}  opt.width  [宽度]\n     * @param   {Number}  opt.length [长度]\n     * @param   {Number}  opt.speed  [速度]\n     * @param   {Number}  opt.repeat [重复次数]\n     * @return  {Mesh}               [return 图层]\n     */\n    addFly({\n        color = "rgba(255,255,255,1)",\n        curve = [],\n        width = 1,\n        length = 10,\n        speed = 1,\n        repeat = 1,\n        texture = null,\n        callback\n    } = opt) {\n        let colorArr = this.getColorArr(color);\n        let geometry = new THREE.BufferGeometry();\n        let material = new THREE.ShaderMaterial({\n            uniforms: {\n                color: {\n                    value: colorArr[0],\n                    type: "v3"\n                },\n                size: {\n                    value: width,\n                    type: "f"\n                },\n                u_map: {\n                    value: texture ? texture : this.texture,\n                    type: "t2"\n                },\n                u_len: {\n                    value: length,\n                    type: "f"\n                },\n                u_opacity: {\n                    value: colorArr[1],\n                    type: "f"\n                },\n                time: {\n                    value: -length,\n                    type: "f"\n                },\n                isTexture: {\n                    value: 1.0,\n                    type: "f"\n                }\n            },\n            transparent: true,\n            depthTest: false,\n            vertexShader: this.flyShader.vertexshader,\n            fragmentShader: this.flyShader.fragmentshader\n        });\n        const [position, u_index] = [\n            [],\n            []\n        ];\n        curve.forEach(function (elem, index) {\n            position.push(elem.x, elem.y, elem.z);\n            u_index.push(index);\n        })\n        geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));\n        geometry.setAttribute("u_index", new THREE.Float32BufferAttribute(u_index, 1));\n        let mesh = new THREE.Points(geometry, material);\n        mesh.name = "fly";\n        mesh._flyId = this.flyId;\n        mesh._speed = speed;\n        mesh._repeat = repeat;\n        mesh._been = 0;\n        mesh._total = curve.length;\n        mesh._callback = callback;\n        this.flyId++;\n        this.flyArr.push(mesh);\n        return mesh\n    }\n    /**\n     * 根据线条组生成路径\n     * @param {*} arr 需要生成的线条组\n     * @param {*} dpi 密度\n     */\n    tranformPath(arr, dpi = 1) {\n        const vecs = [];\n        for (let i = 1; i < arr.length; i++) {\n            let src = arr[i - 1];\n            let dst = arr[i];\n            let s = new THREE.Vector3(src.x, src.y, src.z);\n            let d = new THREE.Vector3(dst.x, dst.y, dst.z);\n            let length = s.distanceTo(d) * dpi;\n            let len = parseInt(length);\n            for (let i = 0; i <= len; i++) {\n                vecs.push(s.clone().lerp(d, i / len))\n            }\n        }\n        return vecs;\n    }\n    /**\n     * [remove 删除]\n     * @param   {Object}  mesh  [当前飞线]\n     */\n    remove(mesh) {\n        mesh.material.dispose();\n        mesh.geometry.dispose();\n        this.flyArr = this.flyArr.filter(elem => elem._flyId != mesh._flyId);\n        mesh.parent.remove(mesh);\n        mesh = null;\n    }\n    /**\n     * [animation 动画] \n     * @param   {Number}  delta  [执行动画间隔时间] \n     */\n    animation(delta = 0.015) {\n        if (delta > 0.2) return;\n        this.flyArr.forEach(elem => {\n            if (!elem.parent) return;\n            if (elem._been > elem._repeat) {\n                elem.visible = false;\n                if (typeof elem._callback === 'function') {\n                    elem._callback(elem);\n                }\n                this.remove(elem)\n            } else {\n                let uniforms = elem.material.uniforms;\n                //完结一次\n                if (uniforms.time.value < elem._total) {\n                    uniforms.time.value += delta * (this.baicSpeed / delta) * elem._speed;\n                } else {\n                    elem._been += 1;\n                    uniforms.time.value = -uniforms.u_len.value;\n                }\n            }\n        })\n    }\n    color(c) {\n        return new THREE.Color(c);\n    }\n    getColorArr(str) {\n        if (Array.isArray(str)) return str; //error\n        var _arr = [];\n        str = str + '';\n        str = str.toLowerCase().replace(/\\s/g, "");\n        if (/^((?:rgba)?)\\(\\s*([^\\)]*)/.test(str)) {\n            var arr = str.replace(/rgba\\(|\\)/gi, '').split(',');\n            var hex = [\n                pad2(Math.round(arr[0] * 1 || 0).toString(16)),\n                pad2(Math.round(arr[1] * 1 || 0).toString(16)),\n                pad2(Math.round(arr[2] * 1 || 0).toString(16))\n            ];\n            _arr[0] = this.color('#' + hex.join(""));\n            _arr[1] = Math.max(0, Math.min(1, (arr[3] * 1 || 0)));\n        } else if ('transparent' === str) {\n            _arr[0] = this.color();\n            _arr[1] = 0;\n        } else {\n            _arr[0] = this.color(str);\n            _arr[1] = 1;\n        }\n\n        function pad2(c) {\n            return c.length == 1 ? '0' + c : '' + c;\n        }\n        return _arr;\n    }\n}\n\nfunction Initialize(opt) {\n    var camera, controls, scene, renderer;\n    var clock = new THREE.Clock();\n    var thm = this;\n    var df_Mouse, df_Raycaster;\n    var df_Width, df_Height; //当前盒子的高宽\n    var df_canvas;\n\n    var stats\n\n    function init() {\n        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 10000);\n        camera.position.set(0, 400, 400);\n        camera.lookAt(new THREE.Vector3(0, 0, 0))\n        scene = new THREE.Scene()\n\n        renderer = new THREE.WebGLRenderer({ antialias: true });\n        renderer.setPixelRatio(window.devicePixelRatio * 1.3);\n        renderer.setSize(window.innerWidth, window.innerHeight);\n\n        document.querySelector(opt.id).appendChild(renderer.domElement);\n        df_canvas = renderer.domElement\n        controls = new OrbitControls(camera, renderer.domElement);\n        window.addEventListener('resize', onWindowResize, false);\n        renderer.domElement.addEventListener('mouseup', onDocumentMouseUp, false);\n        df_Width = window.innerWidth;\n        df_Height = window.innerHeight;\n        df_Mouse = new THREE.Vector2();\n        df_Raycaster = new THREE.Raycaster();\n        // onload \n        if (opt.load) {\n            opt.load({\n                camera, controls, scene, renderer\n            })\n        }\n        if (Stats) {\n            stats = new Stats();\n            document.querySelector(opt.id).appendChild(stats.dom);\n        }\n    }\n\n    function onDocumentMouse(event) {\n        event.preventDefault();\n        df_Mouse.x = ((event.clientX - df_canvas.getBoundingClientRect().left) / df_canvas.offsetWidth) * 2 - 1;\n        df_Mouse.y = -((event.clientY - df_canvas.getBoundingClientRect().top) / df_canvas.offsetHeight) * 2 + 1;\n        df_Raycaster.setFromCamera(df_Mouse, camera);\n        return {\n            mouse: df_Mouse,\n            event: event,\n            raycaster: df_Raycaster\n        }\n    }\n    function onWindowResize() {\n        camera.aspect = window.innerWidth / window.innerHeight;\n        camera.updateProjectionMatrix();\n        renderer.setSize(window.innerWidth, window.innerHeight);\n    }\n    function onDocumentMouseUp(event) {\n        if (typeof opt.mouseUp === 'function') {\n            opt.mouseUp(onDocumentMouse(event))\n        }\n    }\n    function animate() {\n        requestAnimationFrame(animate);\n        var delta = clock.getDelta();\n        renderer.render(scene, camera);\n        if (opt.animation) opt.animation(delta);\n        if (stats) stats.update();\n    }\n    init();\n    animate();\n}\n\nvar _Fly;\nvar GL = new Initialize({\n    id: "#box",\n    animation: function (dalte) {\n        if (_Fly) {\n            // 更新线 必须\n            _Fly.animation(dalte);\n        }\n    },\n    load({ scene, camera }) {\n        _Fly = new InitFly({\n            texture: `https://z2586300277.github.io/3d-file-server/` + "threeExamples/application/flyLine/point.png"\n        });\n        let index = 0;\n        var time = setInterval(() => {\n            if (index >= 4000) {\n                clearInterval(time)\n            }\n            var x = 0;\n            var z = 0;\n            var x1 = THREE.MathUtils.randFloat(-200, 200);\n            var z1 = THREE.MathUtils.randFloat(-200, 200);\n            var curve = new THREE.QuadraticBezierCurve3(\n                new THREE.Vector3(x, 0, z),\n                new THREE.Vector3((x + x1) / 2, THREE.MathUtils.randInt(200, 420), (z1 + z) / 2),\n                new THREE.Vector3(x1, 0, z1)\n            );\n            var points = curve.getPoints(500);\n            var flyMesh = _Fly.addFly({\n                color: `rgba(${THREE.MathUtils.randInt(0, 255)},${THREE.MathUtils.randInt(0, 255)},${THREE.MathUtils.randInt(0, 255)},1)`,\n                curve: points,\n                width: 9,\n                length: 150,\n                speed: 1,\n                repeat: Infinity\n            })\n            scene.add(flyMesh);\n            index++;\n        })\n    }\n})\n\n/**\n * 名称: 发散飞线\n * 作者: stonerao https://github.com/stonerao\n */\n	{"stripLog": false, "stripDOMBox": false, "stripImport": true, "stripControls": false, "stripRenderer": false}	{几何图形}	\N	2026-07-08 16:39:05.119992	2026-07-08 16:39:05.119992	paste	\N	[]	ok
3	狐狸思考	动态	\n\n\n\n\nconst box = document.getElementById('box')\n\nconst scene = new THREE.Scene()\n\nconst camera = new THREE.PerspectiveCamera(50, box.clientWidth / box.clientHeight, 0.1, 1000)\n\ncamera.position.set(0, 200, 200)\n\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true })\n\nrenderer.setClearColor(0x000000, 1)\n\nrenderer.setSize(box.clientWidth, box.clientHeight)\n\nbox.appendChild(renderer.domElement)\n\nscene.add(new THREE.AmbientLight(0xffffff, 0.3))\n\nconst directionalLight = new THREE.DirectionalLight(0xffffff, 1.5)\n\ndirectionalLight.position.set(0, 200, 200)\n\nscene.add(directionalLight)\n\nnew GLTFLoader().load(`https://z2586300277.github.io/3d-file-server/` + "files/model/Fox.glb", (gltf) => scene.add(gltf.scene))\n\nconst controls = new OrbitControls(camera, renderer.domElement)\n\ncontrols.enableDamping = true\n\nconst { DepthFormat, DepthTexture, LinearFilter, Matrix4, MeshStandardMaterial, PerspectiveCamera, Plane, UnsignedShortType, Vector3, Vector4, WebGLRenderTarget } = THREE\n\nclass MeshReflectorMaterial extends MeshStandardMaterial {\n    constructor(renderer, camera, scene, object, {\n        mixBlur = 0,\n        mixStrength = 1,\n        resolution = 256,\n        blur = [0, 0],\n        minDepthThreshold = 0.9,\n        maxDepthThreshold = 1,\n        depthScale = 0,\n        depthToBlurRatioBias = 0.25,\n        mirror = 0,\n        distortion = 1,\n        mixContrast = 1,\n        distortionMap,\n        reflectorOffset = 0,\n        bufferSamples = 8,\n        planeNormal = new Vector3(0, 0, 1),\n        parameters = {}\n    } = {}) {\n        super(parameters);\n\n        this.gl = renderer\n        this.camera = camera\n        this.scene = scene\n        this.parent = object\n\n        this.hasBlur = blur[0] + blur[1] > 0\n        this.reflectorPlane = new Plane()\n        this.normal = new Vector3()\n        this.reflectorWorldPosition = new Vector3()\n        this.cameraWorldPosition = new Vector3()\n        this.rotationMatrix = new Matrix4()\n        this.lookAtPosition = new Vector3(0, -1, 0)\n        this.clipPlane = new Vector4()\n        this.view = new Vector3()\n        this.target = new Vector3()\n        this.q = new Vector4()\n        this.textureMatrix = new Matrix4()\n        this.virtualCamera = new PerspectiveCamera()\n        this.reflectorOffset = reflectorOffset;\n        this.planeNormal = planeNormal\n\n        this.setupBuffers(resolution, blur, bufferSamples);\n\n        this.reflectorProps = {\n            mirror,\n            textureMatrix: this.textureMatrix,\n            mixBlur,\n            tDiffuse: this.fbo1.texture,\n            tDepth: this.fbo1.depthTexture,\n            tDiffuseBlur: this.fbo2.texture,\n            hasBlur: this.hasBlur,\n            mixStrength,\n            minDepthThreshold,\n            maxDepthThreshold,\n            depthScale,\n            depthToBlurRatioBias,\n            distortion,\n            distortionMap,\n            mixContrast,\n            'defines-USE_BLUR': this.hasBlur ? '' : undefined,\n            'defines-USE_DEPTH': depthScale > 0 ? '' : undefined,\n            'defines-USE_DISTORTION': distortionMap ? '' : undefined,\n        }\n    }\n\n    setupBuffers(resolution, blur, bufferSamples) {\n        const parameters = {\n            minFilter: LinearFilter,\n            magFilter: LinearFilter,\n            encoding: this.gl.outputEncoding,\n        }\n\n        const fbo1 = new WebGLRenderTarget(resolution, resolution, parameters)\n        fbo1.depthBuffer = true\n        fbo1.depthTexture = new DepthTexture(resolution, resolution)\n        fbo1.depthTexture.format = DepthFormat\n        fbo1.depthTexture.type = UnsignedShortType\n\n        const fbo2 = new WebGLRenderTarget(resolution, resolution, parameters)\n\n        if (this.gl.capabilities.isWebGL2) {\n            fbo1.samples = bufferSamples\n        }\n\n        this.fbo1 = fbo1;\n        this.fbo2 = fbo2;\n\n        this.kawaseBlurPass = new KawaseBlurPass()\n        this.kawaseBlurPass.setSize(blur[0], blur[1])\n    }\n\n    beforeRender() {\n        if (!this.parent) return\n\n        this.reflectorWorldPosition.setFromMatrixPosition(this.parent.matrixWorld)\n        this.cameraWorldPosition.setFromMatrixPosition(this.camera.matrixWorld)\n        this.rotationMatrix.extractRotation(this.parent.matrixWorld)\n\n        // was changed from this.normal.set(0, 0, 1)\n        this.normal.copy(this.planeNormal)\n        this.normal.applyMatrix4(this.rotationMatrix)\n        this.reflectorWorldPosition.addScaledVector(this.normal, this.reflectorOffset)\n        this.view.subVectors(this.reflectorWorldPosition, this.cameraWorldPosition)\n        // Avoid rendering when reflector is facing away\n        if (this.view.dot(this.normal) > 0) return\n        this.view.reflect(this.normal).negate()\n        this.view.add(this.reflectorWorldPosition)\n        this.rotationMatrix.extractRotation(this.camera.matrixWorld)\n        this.lookAtPosition.set(0, 0, -1)\n        this.lookAtPosition.applyMatrix4(this.rotationMatrix)\n        this.lookAtPosition.add(this.cameraWorldPosition)\n        this.target.subVectors(this.reflectorWorldPosition, this.lookAtPosition)\n        this.target.reflect(this.normal).negate()\n        this.target.add(this.reflectorWorldPosition)\n        this.virtualCamera.position.copy(this.view)\n        this.virtualCamera.up.set(0, 1, 0)\n        this.virtualCamera.up.applyMatrix4(this.rotationMatrix)\n        this.virtualCamera.up.reflect(this.normal)\n        this.virtualCamera.lookAt(this.target)\n        this.virtualCamera.far = this.camera.far // Used in WebGLBackground\n        this.virtualCamera.updateMatrixWorld()\n        this.virtualCamera.projectionMatrix.copy(this.camera.projectionMatrix)\n\n        // Update the texture matrix\n        this.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0)\n        this.textureMatrix.multiply(this.virtualCamera.projectionMatrix)\n        this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse)\n        this.textureMatrix.multiply(this.parent.matrixWorld)\n\n        this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPosition)\n        this.reflectorPlane.applyMatrix4(this.virtualCamera.matrixWorldInverse)\n        this.clipPlane.set(this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant)\n        const projectionMatrix = this.virtualCamera.projectionMatrix\n        this.q.x = (Math.sign(this.clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0]\n        this.q.y = (Math.sign(this.clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5]\n        this.q.z = -1.0\n        this.q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14]\n        // Calculate the scaled plane vector\n        this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q))\n\n        // Replacing the third row of the projection matrix\n        projectionMatrix.elements[2] = this.clipPlane.x\n        projectionMatrix.elements[6] = this.clipPlane.y\n        projectionMatrix.elements[10] = this.clipPlane.z + 1.0\n        projectionMatrix.elements[14] = this.clipPlane.w\n    }\n\n    update() {\n        if (this.parent.material !== this) return;\n\n        this.parent.visible = false\n        const currentXrEnabled = this.gl.xr.enabled\n        const currentShadowAutoUpdate = this.gl.shadowMap.autoUpdate\n\n        this.beforeRender()\n        this.gl.xr.enabled = false\n        this.gl.shadowMap.autoUpdate = false\n        this.gl.setRenderTarget(this.fbo1)\n        this.gl.state.buffers.depth.setMask(true)\n        if (!this.gl.autoClear) this.gl.clear()\n\n        this.gl.render(this.scene, this.virtualCamera)\n\n        if (this.hasBlur) {\n            this.kawaseBlurPass.render(this.gl, this.fbo1, this.fbo2);\n        }\n\n        this.gl.xr.enabled = currentXrEnabled\n        this.gl.shadowMap.autoUpdate = currentShadowAutoUpdate\n        this.parent.visible = true\n        this.gl.setRenderTarget(null)\n    }\n\n    onBeforeCompile(shader, ...args) {\n        super.onBeforeCompile(shader, ...args);\n\n        if (this.defines === undefined) this.defines = {}\n\n        if (!this.defines.USE_UV) {\n            this.defines.USE_UV = ''\n        }\n\n        if (this.reflectorProps["defines-USE_BLUR"] !== undefined) this.defines.USE_BLUR = ""\n        if (this.reflectorProps["defines-USE_DEPTH"] !== undefined) this.defines.USE_DEPTH = ""\n        if (this.reflectorProps["defines-USE_DISTORTION"] !== undefined) this.defines.USE_DISTORTION = ""\n\n        let props = this.reflectorProps;\n\n        for (let prop in props) {\n            shader.uniforms[prop] = {\n                get value() {\n                    return props[prop]\n                }\n            }\n        }\n\n        shader.vertexShader = `\n              uniform mat4 textureMatrix;\n              varying vec4 my_vUv;     \n            ${shader.vertexShader}`\n\n        shader.vertexShader = shader.vertexShader.replace(\n            '#include <project_vertex>',\n            /* glsl */`\n            #include <project_vertex>\n            my_vUv = textureMatrix * vec4( position, 1.0 );\n            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n            `\n        )\n\n        shader.fragmentShader = /* glsl */`\n              uniform sampler2D tDiffuse;\n              uniform sampler2D tDiffuseBlur;\n              uniform sampler2D tDepth;\n              uniform sampler2D distortionMap;\n              uniform float distortion;\n              uniform float cameraNear;\n              uniform float cameraFar;\n              uniform bool hasBlur;\n              uniform float mixBlur;\n              uniform float mirror;\n              uniform float mixStrength;\n              uniform float minDepthThreshold;\n              uniform float maxDepthThreshold;\n              uniform float mixContrast;\n              uniform float depthScale;\n              uniform float depthToBlurRatioBias;\n              varying vec4 my_vUv;        \n              ${shader.fragmentShader}`\n\n        shader.fragmentShader = shader.fragmentShader.replace(\n            '#include <emissivemap_fragment>',\n            /* glsl */`\n            #include <emissivemap_fragment>\n          \n            float distortionFactor = 0.0;\n            #ifdef USE_DISTORTION\n              distortionFactor = texture2D(distortionMap, vUv).r * distortion;\n            #endif\n      \n            vec4 new_vUv = my_vUv;\n            new_vUv.x += distortionFactor;\n            new_vUv.y += distortionFactor;\n      \n            vec4 base = texture2DProj(tDiffuse, new_vUv);\n            vec4 blur = texture2DProj(tDiffuseBlur, new_vUv);\n            \n            vec4 merge = base;\n            \n            #ifdef USE_NORMALMAP\n              vec2 normal_uv = vec2(0.0);\n              vec4 normalColor = texture2D(normalMap, vUv);\n              vec3 my_normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );\n              vec3 coord = new_vUv.xyz / new_vUv.w;\n              normal_uv = coord.xy + coord.z * my_normal.xz * 0.05 * normalScale;\n              vec4 base_normal = texture2D(tDiffuse, normal_uv);\n              vec4 blur_normal = texture2D(tDiffuseBlur, normal_uv);\n              merge = base_normal;\n              blur = blur_normal;\n            #endif\n      \n            float depthFactor = 0.0001;\n            float blurFactor = 0.0;\n      \n            #ifdef USE_DEPTH\n              vec4 depth = texture2DProj(tDepth, new_vUv);\n              depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));\n              depthFactor *= depthScale;\n              depthFactor = max(0.0001, min(1.0, depthFactor));\n      \n              #ifdef USE_BLUR\n                blur = blur * min(1.0, depthFactor + depthToBlurRatioBias);\n                merge = merge * min(1.0, depthFactor + 0.5);\n              #else\n                merge = merge * depthFactor;\n              #endif\n        \n            #endif\n      \n            float reflectorRoughnessFactor = roughness;\n            #ifdef USE_ROUGHNESSMAP\n              vec4 reflectorTexelRoughness = texture2D( roughnessMap, vUv );\n              \n              reflectorRoughnessFactor *= reflectorTexelRoughness.g;\n            #endif\n            \n            #ifdef USE_BLUR\n              blurFactor = min(1.0, mixBlur * reflectorRoughnessFactor);\n              merge = mix(merge, blur, blurFactor);\n            #endif\n      \n            vec4 newMerge = vec4(0.0, 0.0, 0.0, 1.0);\n            newMerge.r = (merge.r - 0.5) * mixContrast + 0.5;\n            newMerge.g = (merge.g - 0.5) * mixContrast + 0.5;\n            newMerge.b = (merge.b - 0.5) * mixContrast + 0.5;\n            \n            diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);\n            `\n        )\n    }\n}\n\nconst tunnel = new THREE.Mesh(new THREE.TorusKnotGeometry(20, 2, 100, 16), new THREE.MeshStandardMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 }))\ntunnel.position.set(0, 80, 50)\nscene.add(tunnel)\n\nconst material = new MeshReflectorMaterial(renderer, camera, scene, {}, {\n    resolution: 1024,\n    blur: [512, 128],\n    mixBlur: 5,\n    mixStrength: 5,\n    mixContrast: 1,\n    mirror: 1,\n    parameters:{\n        roughnessMap: new THREE.TextureLoader().load(`https://z2586300277.github.io/3d-file-server/` + "images/drei/roughness.jpg"),\n        normalMap: new THREE.TextureLoader().load(`https://z2586300277.github.io/3d-file-server/` + "images/drei/normal.jpg"),\n        normalScale: new THREE.Vector2(1, 1)\n    }\n})\nconst plane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),material)\nplane.position.y = -1\nplane.rotation.x = -Math.PI / 2\nmaterial.parent = plane\nscene.add(plane)\n\nconst { reflectorProps } = material\n\nanimate()\nfunction animate() {\n    requestAnimationFrame(animate)\n    tunnel.rotation.z += 0.02\n    tunnel.rotation.x += 0.02\n    material.update()\n    controls.update()\n    renderer.render(scene, camera)\n}\n\nconst pane = new Pane();\npane.addBinding(reflectorProps, 'mixBlur', { min: 0, max: 20 });\npane.addBinding(reflectorProps, 'mixStrength', { min: 0, max: 20 });\npane.addBinding(reflectorProps, 'mirror', { min: 0, max: 1 });\npane.addBinding(reflectorProps, 'mixContrast', { min: 0, max: 5 });\n\n\n/**\n * 名称: 模糊反射(drei转原生)\n * 作者: 优雅永不过时 https://z2586300277.github.io/\n * 参考: https://codesandbox.io/p/sandbox/bfplr \n */\n	\n\n\n\n\nconst box = document.getElementById('box')\n\nconst scene = new THREE.Scene()\n\nconst camera = new THREE.PerspectiveCamera(50, box.clientWidth / box.clientHeight, 0.1, 1000)\n\ncamera.position.set(0, 200, 200)\n\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true })\n\nrenderer.setClearColor(0x000000, 1)\n\nrenderer.setSize(box.clientWidth, box.clientHeight)\n\nbox.appendChild(renderer.domElement)\n\nscene.add(new THREE.AmbientLight(0xffffff, 0.3))\n\nconst directionalLight = new THREE.DirectionalLight(0xffffff, 1.5)\n\ndirectionalLight.position.set(0, 200, 200)\n\nscene.add(directionalLight)\n\nnew GLTFLoader().load(`https://z2586300277.github.io/3d-file-server/` + "files/model/Fox.glb", (gltf) => scene.add(gltf.scene))\n\nconst controls = new OrbitControls(camera, renderer.domElement)\n\ncontrols.enableDamping = true\n\nconst { DepthFormat, DepthTexture, LinearFilter, Matrix4, MeshStandardMaterial, PerspectiveCamera, Plane, UnsignedShortType, Vector3, Vector4, WebGLRenderTarget } = THREE\n\nclass MeshReflectorMaterial extends MeshStandardMaterial {\n    constructor(renderer, camera, scene, object, {\n        mixBlur = 0,\n        mixStrength = 1,\n        resolution = 256,\n        blur = [0, 0],\n        minDepthThreshold = 0.9,\n        maxDepthThreshold = 1,\n        depthScale = 0,\n        depthToBlurRatioBias = 0.25,\n        mirror = 0,\n        distortion = 1,\n        mixContrast = 1,\n        distortionMap,\n        reflectorOffset = 0,\n        bufferSamples = 8,\n        planeNormal = new Vector3(0, 0, 1),\n        parameters = {}\n    } = {}) {\n        super(parameters);\n\n        this.gl = renderer\n        this.camera = camera\n        this.scene = scene\n        this.parent = object\n\n        this.hasBlur = blur[0] + blur[1] > 0\n        this.reflectorPlane = new Plane()\n        this.normal = new Vector3()\n        this.reflectorWorldPosition = new Vector3()\n        this.cameraWorldPosition = new Vector3()\n        this.rotationMatrix = new Matrix4()\n        this.lookAtPosition = new Vector3(0, -1, 0)\n        this.clipPlane = new Vector4()\n        this.view = new Vector3()\n        this.target = new Vector3()\n        this.q = new Vector4()\n        this.textureMatrix = new Matrix4()\n        this.virtualCamera = new PerspectiveCamera()\n        this.reflectorOffset = reflectorOffset;\n        this.planeNormal = planeNormal\n\n        this.setupBuffers(resolution, blur, bufferSamples);\n\n        this.reflectorProps = {\n            mirror,\n            textureMatrix: this.textureMatrix,\n            mixBlur,\n            tDiffuse: this.fbo1.texture,\n            tDepth: this.fbo1.depthTexture,\n            tDiffuseBlur: this.fbo2.texture,\n            hasBlur: this.hasBlur,\n            mixStrength,\n            minDepthThreshold,\n            maxDepthThreshold,\n            depthScale,\n            depthToBlurRatioBias,\n            distortion,\n            distortionMap,\n            mixContrast,\n            'defines-USE_BLUR': this.hasBlur ? '' : undefined,\n            'defines-USE_DEPTH': depthScale > 0 ? '' : undefined,\n            'defines-USE_DISTORTION': distortionMap ? '' : undefined,\n        }\n    }\n\n    setupBuffers(resolution, blur, bufferSamples) {\n        const parameters = {\n            minFilter: LinearFilter,\n            magFilter: LinearFilter,\n            encoding: this.gl.outputEncoding,\n        }\n\n        const fbo1 = new WebGLRenderTarget(resolution, resolution, parameters)\n        fbo1.depthBuffer = true\n        fbo1.depthTexture = new DepthTexture(resolution, resolution)\n        fbo1.depthTexture.format = DepthFormat\n        fbo1.depthTexture.type = UnsignedShortType\n\n        const fbo2 = new WebGLRenderTarget(resolution, resolution, parameters)\n\n        if (this.gl.capabilities.isWebGL2) {\n            fbo1.samples = bufferSamples\n        }\n\n        this.fbo1 = fbo1;\n        this.fbo2 = fbo2;\n\n        this.kawaseBlurPass = new KawaseBlurPass()\n        this.kawaseBlurPass.setSize(blur[0], blur[1])\n    }\n\n    beforeRender() {\n        if (!this.parent) return\n\n        this.reflectorWorldPosition.setFromMatrixPosition(this.parent.matrixWorld)\n        this.cameraWorldPosition.setFromMatrixPosition(this.camera.matrixWorld)\n        this.rotationMatrix.extractRotation(this.parent.matrixWorld)\n\n        // was changed from this.normal.set(0, 0, 1)\n        this.normal.copy(this.planeNormal)\n        this.normal.applyMatrix4(this.rotationMatrix)\n        this.reflectorWorldPosition.addScaledVector(this.normal, this.reflectorOffset)\n        this.view.subVectors(this.reflectorWorldPosition, this.cameraWorldPosition)\n        // Avoid rendering when reflector is facing away\n        if (this.view.dot(this.normal) > 0) return\n        this.view.reflect(this.normal).negate()\n        this.view.add(this.reflectorWorldPosition)\n        this.rotationMatrix.extractRotation(this.camera.matrixWorld)\n        this.lookAtPosition.set(0, 0, -1)\n        this.lookAtPosition.applyMatrix4(this.rotationMatrix)\n        this.lookAtPosition.add(this.cameraWorldPosition)\n        this.target.subVectors(this.reflectorWorldPosition, this.lookAtPosition)\n        this.target.reflect(this.normal).negate()\n        this.target.add(this.reflectorWorldPosition)\n        this.virtualCamera.position.copy(this.view)\n        this.virtualCamera.up.set(0, 1, 0)\n        this.virtualCamera.up.applyMatrix4(this.rotationMatrix)\n        this.virtualCamera.up.reflect(this.normal)\n        this.virtualCamera.lookAt(this.target)\n        this.virtualCamera.far = this.camera.far // Used in WebGLBackground\n        this.virtualCamera.updateMatrixWorld()\n        this.virtualCamera.projectionMatrix.copy(this.camera.projectionMatrix)\n\n        // Update the texture matrix\n        this.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0)\n        this.textureMatrix.multiply(this.virtualCamera.projectionMatrix)\n        this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse)\n        this.textureMatrix.multiply(this.parent.matrixWorld)\n\n        this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPosition)\n        this.reflectorPlane.applyMatrix4(this.virtualCamera.matrixWorldInverse)\n        this.clipPlane.set(this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant)\n        const projectionMatrix = this.virtualCamera.projectionMatrix\n        this.q.x = (Math.sign(this.clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0]\n        this.q.y = (Math.sign(this.clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5]\n        this.q.z = -1.0\n        this.q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14]\n        // Calculate the scaled plane vector\n        this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q))\n\n        // Replacing the third row of the projection matrix\n        projectionMatrix.elements[2] = this.clipPlane.x\n        projectionMatrix.elements[6] = this.clipPlane.y\n        projectionMatrix.elements[10] = this.clipPlane.z + 1.0\n        projectionMatrix.elements[14] = this.clipPlane.w\n    }\n\n    update() {\n        if (this.parent.material !== this) return;\n\n        this.parent.visible = false\n        const currentXrEnabled = this.gl.xr.enabled\n        const currentShadowAutoUpdate = this.gl.shadowMap.autoUpdate\n\n        this.beforeRender()\n        this.gl.xr.enabled = false\n        this.gl.shadowMap.autoUpdate = false\n        this.gl.setRenderTarget(this.fbo1)\n        this.gl.state.buffers.depth.setMask(true)\n        if (!this.gl.autoClear) this.gl.clear()\n\n        this.gl.render(this.scene, this.virtualCamera)\n\n        if (this.hasBlur) {\n            this.kawaseBlurPass.render(this.gl, this.fbo1, this.fbo2);\n        }\n\n        this.gl.xr.enabled = currentXrEnabled\n        this.gl.shadowMap.autoUpdate = currentShadowAutoUpdate\n        this.parent.visible = true\n        this.gl.setRenderTarget(null)\n    }\n\n    onBeforeCompile(shader, ...args) {\n        super.onBeforeCompile(shader, ...args);\n\n        if (this.defines === undefined) this.defines = {}\n\n        if (!this.defines.USE_UV) {\n            this.defines.USE_UV = ''\n        }\n\n        if (this.reflectorProps["defines-USE_BLUR"] !== undefined) this.defines.USE_BLUR = ""\n        if (this.reflectorProps["defines-USE_DEPTH"] !== undefined) this.defines.USE_DEPTH = ""\n        if (this.reflectorProps["defines-USE_DISTORTION"] !== undefined) this.defines.USE_DISTORTION = ""\n\n        let props = this.reflectorProps;\n\n        for (let prop in props) {\n            shader.uniforms[prop] = {\n                get value() {\n                    return props[prop]\n                }\n            }\n        }\n\n        shader.vertexShader = `\n              uniform mat4 textureMatrix;\n              varying vec4 my_vUv;     \n            ${shader.vertexShader}`\n\n        shader.vertexShader = shader.vertexShader.replace(\n            '#include <project_vertex>',\n            /* glsl */`\n            #include <project_vertex>\n            my_vUv = textureMatrix * vec4( position, 1.0 );\n            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n            `\n        )\n\n        shader.fragmentShader = /* glsl */`\n              uniform sampler2D tDiffuse;\n              uniform sampler2D tDiffuseBlur;\n              uniform sampler2D tDepth;\n              uniform sampler2D distortionMap;\n              uniform float distortion;\n              uniform float cameraNear;\n              uniform float cameraFar;\n              uniform bool hasBlur;\n              uniform float mixBlur;\n              uniform float mirror;\n              uniform float mixStrength;\n              uniform float minDepthThreshold;\n              uniform float maxDepthThreshold;\n              uniform float mixContrast;\n              uniform float depthScale;\n              uniform float depthToBlurRatioBias;\n              varying vec4 my_vUv;        \n              ${shader.fragmentShader}`\n\n        shader.fragmentShader = shader.fragmentShader.replace(\n            '#include <emissivemap_fragment>',\n            /* glsl */`\n            #include <emissivemap_fragment>\n          \n            float distortionFactor = 0.0;\n            #ifdef USE_DISTORTION\n              distortionFactor = texture2D(distortionMap, vUv).r * distortion;\n            #endif\n      \n            vec4 new_vUv = my_vUv;\n            new_vUv.x += distortionFactor;\n            new_vUv.y += distortionFactor;\n      \n            vec4 base = texture2DProj(tDiffuse, new_vUv);\n            vec4 blur = texture2DProj(tDiffuseBlur, new_vUv);\n            \n            vec4 merge = base;\n            \n            #ifdef USE_NORMALMAP\n              vec2 normal_uv = vec2(0.0);\n              vec4 normalColor = texture2D(normalMap, vUv);\n              vec3 my_normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );\n              vec3 coord = new_vUv.xyz / new_vUv.w;\n              normal_uv = coord.xy + coord.z * my_normal.xz * 0.05 * normalScale;\n              vec4 base_normal = texture2D(tDiffuse, normal_uv);\n              vec4 blur_normal = texture2D(tDiffuseBlur, normal_uv);\n              merge = base_normal;\n              blur = blur_normal;\n            #endif\n      \n            float depthFactor = 0.0001;\n            float blurFactor = 0.0;\n      \n            #ifdef USE_DEPTH\n              vec4 depth = texture2DProj(tDepth, new_vUv);\n              depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));\n              depthFactor *= depthScale;\n              depthFactor = max(0.0001, min(1.0, depthFactor));\n      \n              #ifdef USE_BLUR\n                blur = blur * min(1.0, depthFactor + depthToBlurRatioBias);\n                merge = merge * min(1.0, depthFactor + 0.5);\n              #else\n                merge = merge * depthFactor;\n              #endif\n        \n            #endif\n      \n            float reflectorRoughnessFactor = roughness;\n            #ifdef USE_ROUGHNESSMAP\n              vec4 reflectorTexelRoughness = texture2D( roughnessMap, vUv );\n              \n              reflectorRoughnessFactor *= reflectorTexelRoughness.g;\n            #endif\n            \n            #ifdef USE_BLUR\n              blurFactor = min(1.0, mixBlur * reflectorRoughnessFactor);\n              merge = mix(merge, blur, blurFactor);\n            #endif\n      \n            vec4 newMerge = vec4(0.0, 0.0, 0.0, 1.0);\n            newMerge.r = (merge.r - 0.5) * mixContrast + 0.5;\n            newMerge.g = (merge.g - 0.5) * mixContrast + 0.5;\n            newMerge.b = (merge.b - 0.5) * mixContrast + 0.5;\n            \n            diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);\n            `\n        )\n    }\n}\n\nconst tunnel = new THREE.Mesh(new THREE.TorusKnotGeometry(20, 2, 100, 16), new THREE.MeshStandardMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 }))\ntunnel.position.set(0, 80, 50)\nscene.add(tunnel)\n\nconst material = new MeshReflectorMaterial(renderer, camera, scene, {}, {\n    resolution: 1024,\n    blur: [512, 128],\n    mixBlur: 5,\n    mixStrength: 5,\n    mixContrast: 1,\n    mirror: 1,\n    parameters:{\n        roughnessMap: new THREE.TextureLoader().load(`https://z2586300277.github.io/3d-file-server/` + "images/drei/roughness.jpg"),\n        normalMap: new THREE.TextureLoader().load(`https://z2586300277.github.io/3d-file-server/` + "images/drei/normal.jpg"),\n        normalScale: new THREE.Vector2(1, 1)\n    }\n})\nconst plane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),material)\nplane.position.y = -1\nplane.rotation.x = -Math.PI / 2\nmaterial.parent = plane\nscene.add(plane)\n\nconst { reflectorProps } = material\n\nanimate()\nfunction animate() {\n    requestAnimationFrame(animate)\n    tunnel.rotation.z += 0.02\n    tunnel.rotation.x += 0.02\n    material.update()\n    controls.update()\n    renderer.render(scene, camera)\n}\n\nconst pane = new Pane();\npane.addBinding(reflectorProps, 'mixBlur', { min: 0, max: 20 });\npane.addBinding(reflectorProps, 'mixStrength', { min: 0, max: 20 });\npane.addBinding(reflectorProps, 'mirror', { min: 0, max: 1 });\npane.addBinding(reflectorProps, 'mixContrast', { min: 0, max: 5 });\n\n\n/**\n * 名称: 模糊反射(drei转原生)\n * 作者: 优雅永不过时 https://z2586300277.github.io/\n * 参考: https://codesandbox.io/p/sandbox/bfplr \n */\n	{"stripLog": false, "stripDOMBox": false, "stripImport": true, "stripControls": false, "stripRenderer": false}	{几何图形}	\N	2026-07-08 17:14:21.215181	2026-07-08 18:17:46.386866	paste	\N	[]	ok
4	Three.js 云端仙气城堡粒子效果		// 等待页面加载完成\n        document.addEventListener('DOMContentLoaded', () => {\n            // 初始化变量\n            let scene, camera, renderer, controls;\n            let castle, clouds = [], stars = [], flowParticles = [];\n            let cloudSystem, starSystem, flowSystem;\n            let clock = new THREE.Clock();\n            let particleCount = 0;\n            \n            // 效果开关\n            let cloudsEnabled = true;\n            let starsEnabled = true;\n            let flowEnabled = true;\n            \n            // 初始化Three.js场景\n            function init() {\n                // 创建场景\n                scene = new THREE.Scene();\n                scene.fog = new THREE.FogExp2(0x0a1a2a, 0.002);\n                \n                // 创建相机\n                camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);\n                camera.position.set(30, 25, 50);\n                \n                // 创建渲染器\n                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\n                renderer.setSize(window.innerWidth, window.innerHeight);\n                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));\n                renderer.shadowMap.enabled = true;\n                renderer.shadowMap.type = THREE.PCFSoftShadowMap;\n                document.getElementById('canvas-container').appendChild(renderer.domElement);\n                \n                // 添加轨道控制器\n                controls = new THREE.OrbitControls(camera, renderer.domElement);\n                controls.enableDamping = true;\n                controls.dampingFactor = 0.05;\n                controls.maxPolarAngle = Math.PI / 2 - 0.1;\n                controls.minDistance = 20;\n                controls.maxDistance = 150;\n                \n                // 添加光源\n                addLights();\n                \n                // 创建城堡\n                createCastle();\n                \n                // 创建粒子系统\n                createCloudSystem();\n                createStarSystem();\n                createFlowSystem();\n                \n                // 隐藏加载界面\n                setTimeout(() => {\n                    document.querySelector('.loading').style.opacity = '0';\n                    setTimeout(() => {\n                        document.querySelector('.loading').style.display = 'none';\n                    }, 1000);\n                }, 1500);\n                \n                // 更新粒子计数显示\n                updateParticleCount();\n                \n                // 窗口大小调整事件\n                window.addEventListener('resize', onWindowResize);\n                \n                // 绑定控制按钮事件\n                document.getElementById('toggleClouds').addEventListener('click', toggleClouds);\n                document.getElementById('toggleStars').addEventListener('click', toggleStars);\n                document.getElementById('toggleFlow').addEventListener('click', toggleFlow);\n                document.getElementById('resetView').addEventListener('click', resetView);\n            }\n            \n            // 添加光源\n            function addLights() {\n                // 环境光\n                const ambientLight = new THREE.AmbientLight(0x334455, 0.4);\n                scene.add(ambientLight);\n                \n                // 主方向光（模拟月光）\n                const moonLight = new THREE.DirectionalLight(0xcceeff, 0.8);\n                moonLight.position.set(50, 80, 30);\n                moonLight.castShadow = true;\n                moonLight.shadow.mapSize.width = 2048;\n                moonLight.shadow.mapSize.height = 2048;\n                moonLight.shadow.camera.left = -100;\n                moonLight.shadow.camera.right = 100;\n                moonLight.shadow.camera.top = 100;\n                moonLight.shadow.camera.bottom = -100;\n                scene.add(moonLight);\n                \n                // 辅助光（从下方）\n                const bottomLight = new THREE.DirectionalLight(0x6688aa, 0.3);\n                bottomLight.position.set(0, -50, 0);\n                scene.add(bottomLight);\n                \n                // 点光源（城堡中心发光）\n                const pointLight = new THREE.PointLight(0xaaddff, 1, 100);\n                pointLight.position.set(0, 15, 0);\n                scene.add(pointLight);\n                \n                // 半球光（天空到地面渐变）\n                const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x223344, 0.3);\n                scene.add(hemiLight);\n            }\n            \n            // 创建城堡\n            function createCastle() {\n                castle = new THREE.Group();\n                \n                // 城堡基座（浮空岛）\n                const islandGeometry = new THREE.CylinderGeometry(18, 22, 4, 32);\n                const islandMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x445566,\n                    roughness: 0.9,\n                    metalness: 0.1\n                });\n                const island = new THREE.Mesh(islandGeometry, islandMaterial);\n                island.castShadow = true;\n                island.receiveShadow = true;\n                island.position.y = -2;\n                castle.add(island);\n                \n                // 岛屿顶部草地\n                const grassGeometry = new THREE.CylinderGeometry(17.5, 17.5, 0.5, 32);\n                const grassMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x44aa66,\n                    roughness: 0.9\n                });\n                const grass = new THREE.Mesh(grassGeometry, grassMaterial);\n                grass.position.y = 0.25;\n                grass.castShadow = true;\n                grass.receiveShadow = true;\n                castle.add(grass);\n                \n                // 主城堡建筑\n                const mainTowerGeometry = new THREE.BoxGeometry(10, 12, 10);\n                const mainTowerMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xddeeff,\n                    roughness: 0.3,\n                    metalness: 0.7\n                });\n                const mainTower = new THREE.Mesh(mainTowerGeometry, mainTowerMaterial);\n                mainTower.position.y = 8;\n                mainTower.castShadow = true;\n                mainTower.receiveShadow = true;\n                castle.add(mainTower);\n                \n                // 城堡屋顶\n                const roofGeometry = new THREE.ConeGeometry(8, 5, 4);\n                const roofMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x88aadd,\n                    roughness: 0.2,\n                    metalness: 0.8\n                });\n                const roof = new THREE.Mesh(roofGeometry, roofMaterial);\n                roof.position.y = 14.5;\n                roof.rotation.y = Math.PI / 4;\n                roof.castShadow = true;\n                castle.add(roof);\n                \n                // 添加塔楼\n                const towerPositions = [\n                    { x: 8, y: 5, z: 8 },\n                    { x: -8, y: 5, z: 8 },\n                    { x: 8, y: 5, z: -8 },\n                    { x: -8, y: 5, z: -8 }\n                ];\n                \n                towerPositions.forEach(pos => {\n                    const towerGeometry = new THREE.CylinderGeometry(1.5, 2, 8, 8);\n                    const tower = new THREE.Mesh(towerGeometry, mainTowerMaterial);\n                    tower.position.set(pos.x, pos.y, pos.z);\n                    tower.castShadow = true;\n                    tower.receiveShadow = true;\n                    castle.add(tower);\n                    \n                    // 塔顶\n                    const towerRoofGeometry = new THREE.ConeGeometry(2, 3, 8);\n                    const towerRoof = new THREE.Mesh(towerRoofGeometry, roofMaterial);\n                    towerRoof.position.set(pos.x, pos.y + 5.5, pos.z);\n                    towerRoof.castShadow = true;\n                    castle.add(towerRoof);\n                });\n                \n                // 添加桥梁\n                const bridgeGeometry = new THREE.BoxGeometry(20, 0.5, 2);\n                const bridgeMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xccddff,\n                    roughness: 0.3,\n                    metalness: 0.6,\n                    emissive: 0x224466,\n                    emissiveIntensity: 0.2\n                });\n                \n                const bridge1 = new THREE.Mesh(bridgeGeometry, bridgeMaterial);\n                bridge1.position.set(0, 3, 12);\n                bridge1.castShadow = true;\n                castle.add(bridge1);\n                \n                const bridge2 = new THREE.Mesh(bridgeGeometry, bridgeMaterial);\n                bridge2.position.set(12, 3, 0);\n                bridge2.rotation.y = Math.PI / 2;\n                bridge2.castShadow = true;\n                castle.add(bridge2);\n                \n                // 添加发光水晶\n                const crystalGeometry = new THREE.OctahedronGeometry(1.5, 0);\n                const crystalMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xaaddff,\n                    roughness: 0.1,\n                    metalness: 0.9,\n                    emissive: 0x88bbff,\n                    emissiveIntensity: 0.5\n                });\n                \n                const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);\n                crystal.position.set(0, 16, 0);\n                crystal.castShadow = true;\n                castle.add(crystal);\n                \n                // 添加栏杆\n                for (let i = 0; i < 12; i++) {\n                    const angle = (i / 12) * Math.PI * 2;\n                    const railingGeometry = new THREE.BoxGeometry(0.3, 1.5, 0.3);\n                    const railing = new THREE.Mesh(railingGeometry, roofMaterial);\n                    railing.position.set(\n                        Math.cos(angle) * 15,\n                        1.5,\n                        Math.sin(angle) * 15\n                    );\n                    railing.castShadow = true;\n                    castle.add(railing);\n                }\n                \n                scene.add(castle);\n            }\n            \n            // 创建云雾系统\n            function createCloudSystem() {\n                const cloudGroup = new THREE.Group();\n                const cloudGeometry = new THREE.SphereGeometry(1, 8, 8);\n                const cloudMaterial = new THREE.MeshStandardMaterial({\n                    color: 0xffffff,\n                    transparent: true,\n                    opacity: 0.6,\n                    fog: true\n                });\n                \n                // 创建多个云朵\n                for (let i = 0; i < 25; i++) {\n                    const cloud = new THREE.Group();\n                    \n                    // 每朵云由多个球体组成\n                    const cloudParts = Math.floor(Math.random() * 4) + 3;\n                    for (let j = 0; j < cloudParts; j++) {\n                        const part = new THREE.Mesh(cloudGeometry, cloudMaterial);\n                        part.scale.set(\n                            Math.random() * 2 + 1,\n                            Math.random() * 1.5 + 0.5,\n                            Math.random() * 2 + 1\n                        );\n                        part.position.set(\n                            (Math.random() - 0.5) * 6,\n                            (Math.random() - 0.5) * 2,\n                            (Math.random() - 0.5) * 6\n                        );\n                        cloud.add(part);\n                    }\n                    \n                    // 随机位置\n                    cloud.position.set(\n                        (Math.random() - 0.5) * 120,\n                        Math.random() * 20 - 10,\n                        (Math.random() - 0.5) * 120\n                    );\n                    \n                    // 随机大小\n                    const scale = Math.random() * 1.5 + 0.8;\n                    cloud.scale.set(scale, scale, scale);\n                    \n                    cloud.userData = {\n                        speedX: (Math.random() - 0.5) * 0.02,\n                        speedZ: (Math.random() - 0.5) * 0.02,\n                        floatSpeed: Math.random() * 0.01 + 0.005,\n                        initialY: cloud.position.y\n                    };\n                    \n                    cloudGroup.add(cloud);\n                    clouds.push(cloud);\n                    particleCount += cloudParts;\n                }\n                \n                cloudSystem = cloudGroup;\n                scene.add(cloudSystem);\n            }\n            \n            // 创建星空系统\n            function createStarSystem() {\n                const starGroup = new THREE.Group();\n                const starGeometry = new THREE.BufferGeometry();\n                const starCount = 2000;\n                \n                const positions = new Float32Array(starCount * 3);\n                const colors = new Float32Array(starCount * 3);\n                const sizes = new Float32Array(starCount);\n                \n                // 创建星星位置和属性\n                for (let i = 0; i < starCount; i++) {\n                    const i3 = i * 3;\n                    \n                    // 随机位置（球形分布）\n                    const radius = 150 + Math.random() * 100;\n                    const theta = Math.random() * Math.PI * 2;\n                    const phi = Math.acos(2 * Math.random() - 1);\n                    \n                    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);\n                    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);\n                    positions[i3 + 2] = radius * Math.cos(phi);\n                    \n                    // 随机颜色（偏蓝白）\n                    const colorIntensity = 0.7 + Math.random() * 0.3;\n                    colors[i3] = 0.8 * colorIntensity;\n                    colors[i3 + 1] = 0.9 * colorIntensity;\n                    colors[i3 + 2] = 1.0 * colorIntensity;\n                    \n                    // 随机大小\n                    sizes[i] = Math.random() * 1.5 + 0.5;\n                }\n                \n                starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));\n                starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));\n                starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));\n                \n                // 星星材质\n                const starMaterial = new THREE.PointsMaterial({\n                    size: 1.5,\n                    vertexColors: true,\n                    transparent: true,\n                    opacity: 0.8,\n                    blending: THREE.AdditiveBlending\n                });\n                \n                const stars = new THREE.Points(starGeometry, starMaterial);\n                starGroup.add(stars);\n                starSystem = starGroup;\n                scene.add(starSystem);\n                \n                particleCount += starCount;\n            }\n            \n            // 创建流光系统\n            function createFlowSystem() {\n                const flowGroup = new THREE.Group();\n                const flowCount = 300;\n                const flowGeometry = new THREE.BufferGeometry();\n                \n                const positions = new Float32Array(flowCount * 3);\n                const colors = new Float32Array(flowCount * 3);\n                const sizes = new Float32Array(flowCount);\n                \n                // 创建流光粒子\n                for (let i = 0; i < flowCount; i++) {\n                    const i3 = i * 3;\n                    \n                    // 初始位置在城堡周围\n                    const radius = 20 + Math.random() * 40;\n                    const angle = Math.random() * Math.PI * 2;\n                    const height = Math.random() * 30;\n                    \n                    positions[i3] = Math.cos(angle) * radius;\n                    positions[i3 + 1] = height;\n                    positions[i3 + 2] = Math.sin(angle) * radius;\n                    \n                    // 流光颜色（蓝紫色调）\n                    colors[i3] = 0.5 + Math.random() * 0.5; // R\n                    colors[i3 + 1] = 0.6 + Math.random() * 0.4; // G\n                    colors[i3 + 2] = 0.9 + Math.random() * 0.1; // B\n                    \n                    // 粒子大小\n                    sizes[i] = Math.random() * 2 + 0.5;\n                    \n                    // 存储粒子数据\n                    flowParticles.push({\n                        angle: angle,\n                        radius: radius,\n                        height: height,\n                        speed: 0.01 + Math.random() * 0.03,\n                        verticalSpeed: (Math.random() - 0.5) * 0.02,\n                        colorOffset: Math.random() * Math.PI * 2\n                    });\n                }\n                \n                flowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));\n                flowGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));\n                flowGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));\n                \n                // 流光材质\n                const flowMaterial = new THREE.PointsMaterial({\n                    size: 2,\n                    vertexColors: true,\n                    transparent: true,\n                    opacity: 0.7,\n                    blending: THREE.AdditiveBlending\n                });\n                \n                const flows = new THREE.Points(flowGeometry, flowMaterial);\n                flowGroup.add(flows);\n                flowSystem = flowGroup;\n                scene.add(flowSystem);\n                \n                particleCount += flowCount;\n            }\n            \n            // 更新粒子计数显示\n            function updateParticleCount() {\n                document.getElementById('particleCount').textContent = particleCount.toLocaleString();\n            }\n            \n            // 切换云雾显示\n            function toggleClouds() {\n                cloudsEnabled = !cloudsEnabled;\n                cloudSystem.visible = cloudsEnabled;\n                document.getElementById('toggleClouds').textContent = \n                    cloudsEnabled ? '云雾开关' : '云雾开启';\n            }\n            \n            // 切换星光显示\n            function toggleStars() {\n                starsEnabled = !starsEnabled;\n                starSystem.visible = starsEnabled;\n                document.getElementById('toggleStars').textContent = \n                    starsEnabled ? '星光开关' : '星光开启';\n            }\n            \n            // 切换流光显示\n            function toggleFlow() {\n                flowEnabled = !flowEnabled;\n                flowSystem.visible = flowEnabled;\n                document.getElementById('toggleFlow').textContent = \n                    flowEnabled ? '流光开关' : '流光开启';\n            }\n            \n            // 重置视角\n            function resetView() {\n                controls.reset();\n            }\n            \n            // 窗口大小调整处理\n            function onWindowResize() {\n                camera.aspect = window.innerWidth / window.innerHeight;\n                camera.updateProjectionMatrix();\n                renderer.setSize(window.innerWidth, window.innerHeight);\n            }\n            \n            // 动画循环\n            function animate() {\n                requestAnimationFrame(animate);\n                \n                const delta = clock.getDelta();\n                const time = clock.getElapsedTime();\n                \n                // 更新控制器\n                controls.update();\n                \n                // 城堡轻微浮动\n                castle.position.y = Math.sin(time * 0.3) * 0.3;\n                castle.rotation.y += 0.001;\n                \n                // 更新云雾\n                if (cloudsEnabled) {\n                    clouds.forEach(cloud => {\n                        const data = cloud.userData;\n                        \n                        // 水平移动\n                        cloud.position.x += data.speedX;\n                        cloud.position.z += data.speedZ;\n                        \n                        // 垂直浮动\n                        cloud.position.y = data.initialY + Math.sin(time * data.floatSpeed) * 2;\n                        \n                        // 边界检查，让云朵循环移动\n                        if (cloud.position.x > 70) cloud.position.x = -70;\n                        if (cloud.position.x < -70) cloud.position.x = 70;\n                        if (cloud.position.z > 70) cloud.position.z = -70;\n                        if (cloud.position.z < -70) cloud.position.z = 70;\n                    });\n                }\n                \n                // 更新流光\n                if (flowEnabled && flowSystem) {\n                    const positions = flowSystem.children[0].geometry.attributes.position.array;\n                    const colors = flowSystem.children[0].geometry.attributes.color.array;\n                    \n                    for (let i = 0; i < flowParticles.length; i++) {\n                        const particle = flowParticles[i];\n                        const i3 = i * 3;\n                        \n                        // 更新角度（旋转运动）\n                        particle.angle += particle.speed;\n                        \n                        // 更新高度（上下浮动）\n                        particle.height += particle.verticalSpeed;\n                        \n                        // 边界检查，重置高度\n                        if (particle.height > 35) particle.verticalSpeed = -Math.abs(particle.verticalSpeed);\n                        if (particle.height < 0) particle.verticalSpeed = Math.abs(particle.verticalSpeed);\n                        \n                        // 更新位置\n                        positions[i3] = Math.cos(particle.angle) * particle.radius;\n                        positions[i3 + 1] = particle.height;\n                        positions[i3 + 2] = Math.sin(particle.angle) * particle.radius;\n                        \n                        // 更新颜色（随时间变化）\n                        const colorVariation = Math.sin(time * 0.5 + particle.colorOffset) * 0.2;\n                        colors[i3] = 0.5 + colorVariation; // R\n                        colors[i3 + 1] = 0.6 + colorVariation * 0.5; // G\n                        colors[i3 + 2] = 0.9 + colorVariation; // B\n                    }\n                    \n                    flowSystem.children[0].geometry.attributes.position.needsUpdate = true;\n                    flowSystem.children[0].geometry.attributes.color.needsUpdate = true;\n                }\n                \n                // 渲染场景\n                renderer.render(scene, camera);\n            }\n            \n            // 启动应用\n            init();\n            animate();\n        });	<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>云端仙人城堡 | Three.js</title>\n    <style>\n        * {\n            margin: 0;\n            padding: 0;\n            box-sizing: border-box;\n        }\n        \n        body {\n            overflow: hidden;\n            background: #000;\n            font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;\n            color: #fff;\n        }\n        \n        #canvas-container {\n            position: fixed;\n            top: 0;\n            left: 0;\n            width: 100%;\n            height: 100%;\n            z-index: 1;\n        }\n        \n        .header {\n            position: absolute;\n            top: 20px;\n            left: 0;\n            width: 100%;\n            text-align: center;\n            z-index: 10;\n            pointer-events: none;\n        }\n        \n        h1 {\n            font-size: 2.8rem;\n            font-weight: 300;\n            letter-spacing: 8px;\n            text-transform: uppercase;\n            margin-bottom: 10px;\n            text-shadow: 0 0 15px rgba(135, 206, 250, 0.8);\n            background: linear-gradient(to bottom, #e0f7ff, #a8d8ff);\n            -webkit-background-clip: text;\n            -webkit-text-fill-color: transparent;\n        }\n        \n        .subtitle {\n            font-size: 1.1rem;\n            opacity: 0.9;\n            letter-spacing: 3px;\n            font-weight: 300;\n            text-shadow: 0 0 10px rgba(173, 216, 230, 0.7);\n        }\n        \n        .controls {\n            position: absolute;\n            bottom: 30px;\n            left: 0;\n            width: 100%;\n            display: flex;\n            justify-content: center;\n            z-index: 10;\n            gap: 15px;\n        }\n        \n        button {\n            background: rgba(255, 255, 255, 0.1);\n            border: 1px solid rgba(173, 216, 230, 0.4);\n            color: #e0f7ff;\n            padding: 12px 25px;\n            border-radius: 30px;\n            cursor: pointer;\n            font-size: 0.95rem;\n            letter-spacing: 2px;\n            backdrop-filter: blur(5px);\n            transition: all 0.3s ease;\n            pointer-events: auto;\n        }\n        \n        button:hover {\n            background: rgba(173, 216, 230, 0.2);\n            transform: translateY(-2px);\n            box-shadow: 0 5px 15px rgba(135, 206, 250, 0.3);\n        }\n        \n        .info-panel {\n            position: absolute;\n            top: 30px;\n            right: 30px;\n            background: rgba(0, 10, 20, 0.6);\n            border: 1px solid rgba(135, 206, 250, 0.3);\n            border-radius: 15px;\n            padding: 20px;\n            max-width: 280px;\n            backdrop-filter: blur(10px);\n            z-index: 10;\n            pointer-events: auto;\n        }\n        \n        .info-panel h3 {\n            font-weight: 400;\n            margin-bottom: 15px;\n            color: #a8d8ff;\n            letter-spacing: 2px;\n            border-bottom: 1px solid rgba(135, 206, 250, 0.3);\n            padding-bottom: 8px;\n        }\n        \n        .info-panel p {\n            font-size: 0.9rem;\n            line-height: 1.6;\n            opacity: 0.85;\n            margin-bottom: 10px;\n        }\n        \n        .loading {\n            position: fixed;\n            top: 0;\n            left: 0;\n            width: 100%;\n            height: 100%;\n            background: #000;\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            z-index: 100;\n            transition: opacity 1s ease;\n        }\n        \n        .loading-text {\n            font-size: 1.5rem;\n            letter-spacing: 5px;\n            color: #a8d8ff;\n        }\n        \n        .particle-count {\n            position: absolute;\n            bottom: 30px;\n            right: 30px;\n            font-size: 0.9rem;\n            opacity: 0.7;\n            z-index: 10;\n        }\n        \n        @media (max-width: 768px) {\n            h1 {\n                font-size: 1.8rem;\n                letter-spacing: 4px;\n            }\n            \n            .info-panel {\n                top: 15px;\n                right: 15px;\n                left: 15px;\n                max-width: none;\n            }\n            \n            .controls {\n                flex-wrap: wrap;\n                padding: 0 15px;\n            }\n        }\n    </style>\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.min.js"></script>\n</head>\n<body>\n    <div class="loading">\n        <div class="loading-text">仙境加载中...</div>\n    </div>\n    \n    <div id="canvas-container"></div>\n    \n    <div class="header">\n        <h1>云端仙人城堡</h1>\n        <div class="subtitle">悬浮于九天之上的缥缈仙境</div>\n    </div>\n    \n    <div class="info-panel">\n        <h3>仙宫秘境</h3>\n        <p>此乃悬浮于云海之上的仙人城堡，由千年灵玉筑成，终年沐浴星辉。</p>\n        <p>云雾缭绕间可见流光穿梭，星辰点缀天际，恍若梦境。</p>\n        <p>拖动鼠标可旋转视角，滚轮可缩放，体验仙境之美。</p>\n    </div>\n    \n    <div class="controls">\n        <button id="toggleClouds">云雾开关</button>\n        <button id="toggleStars">星光开关</button>\n        <button id="toggleFlow">流光开关</button>\n        <button id="resetView">重置视角</button>\n    </div>\n    \n    <div class="particle-count">粒子数量: <span id="particleCount">0</span></div>\n\n    <script>\n        // 等待页面加载完成\n        document.addEventListener('DOMContentLoaded', () => {\n            // 初始化变量\n            let scene, camera, renderer, controls;\n            let castle, clouds = [], stars = [], flowParticles = [];\n            let cloudSystem, starSystem, flowSystem;\n            let clock = new THREE.Clock();\n            let particleCount = 0;\n            \n            // 效果开关\n            let cloudsEnabled = true;\n            let starsEnabled = true;\n            let flowEnabled = true;\n            \n            // 初始化Three.js场景\n            function init() {\n                // 创建场景\n                scene = new THREE.Scene();\n                scene.fog = new THREE.FogExp2(0x0a1a2a, 0.002);\n                \n                // 创建相机\n                camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);\n                camera.position.set(30, 25, 50);\n                \n                // 创建渲染器\n                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\n                renderer.setSize(window.innerWidth, window.innerHeight);\n                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));\n                renderer.shadowMap.enabled = true;\n                renderer.shadowMap.type = THREE.PCFSoftShadowMap;\n                document.getElementById('canvas-container').appendChild(renderer.domElement);\n                \n                // 添加轨道控制器\n                controls = new THREE.OrbitControls(camera, renderer.domElement);\n                controls.enableDamping = true;\n                controls.dampingFactor = 0.05;\n                controls.maxPolarAngle = Math.PI / 2 - 0.1;\n                controls.minDistance = 20;\n                controls.maxDistance = 150;\n                \n                // 添加光源\n                addLights();\n                \n                // 创建城堡\n                createCastle();\n                \n                // 创建粒子系统\n                createCloudSystem();\n                createStarSystem();\n                createFlowSystem();\n                \n                // 隐藏加载界面\n                setTimeout(() => {\n                    document.querySelector('.loading').style.opacity = '0';\n                    setTimeout(() => {\n                        document.querySelector('.loading').style.display = 'none';\n                    }, 1000);\n                }, 1500);\n                \n                // 更新粒子计数显示\n                updateParticleCount();\n                \n                // 窗口大小调整事件\n                window.addEventListener('resize', onWindowResize);\n                \n                // 绑定控制按钮事件\n                document.getElementById('toggleClouds').addEventListener('click', toggleClouds);\n                document.getElementById('toggleStars').addEventListener('click', toggleStars);\n                document.getElementById('toggleFlow').addEventListener('click', toggleFlow);\n                document.getElementById('resetView').addEventListener('click', resetView);\n            }\n            \n            // 添加光源\n            function addLights() {\n                // 环境光\n                const ambientLight = new THREE.AmbientLight(0x334455, 0.4);\n                scene.add(ambientLight);\n                \n                // 主方向光（模拟月光）\n                const moonLight = new THREE.DirectionalLight(0xcceeff, 0.8);\n                moonLight.position.set(50, 80, 30);\n                moonLight.castShadow = true;\n                moonLight.shadow.mapSize.width = 2048;\n                moonLight.shadow.mapSize.height = 2048;\n                moonLight.shadow.camera.left = -100;\n                moonLight.shadow.camera.right = 100;\n                moonLight.shadow.camera.top = 100;\n                moonLight.shadow.camera.bottom = -100;\n                scene.add(moonLight);\n                \n                // 辅助光（从下方）\n                const bottomLight = new THREE.DirectionalLight(0x6688aa, 0.3);\n                bottomLight.position.set(0, -50, 0);\n                scene.add(bottomLight);\n                \n                // 点光源（城堡中心发光）\n                const pointLight = new THREE.PointLight(0xaaddff, 1, 100);\n                pointLight.position.set(0, 15, 0);\n                scene.add(pointLight);\n                \n                // 半球光（天空到地面渐变）\n                const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x223344, 0.3);\n                scene.add(hemiLight);\n            }\n            \n            // 创建城堡\n            function createCastle() {\n                castle = new THREE.Group();\n                \n                // 城堡基座（浮空岛）\n                const islandGeometry = new THREE.CylinderGeometry(18, 22, 4, 32);\n                const islandMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x445566,\n                    roughness: 0.9,\n                    metalness: 0.1\n                });\n                const island = new THREE.Mesh(islandGeometry, islandMaterial);\n                island.castShadow = true;\n                island.receiveShadow = true;\n                island.position.y = -2;\n                castle.add(island);\n                \n                // 岛屿顶部草地\n                const grassGeometry = new THREE.CylinderGeometry(17.5, 17.5, 0.5, 32);\n                const grassMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x44aa66,\n                    roughness: 0.9\n                });\n                const grass = new THREE.Mesh(grassGeometry, grassMaterial);\n                grass.position.y = 0.25;\n                grass.castShadow = true;\n                grass.receiveShadow = true;\n                castle.add(grass);\n                \n                // 主城堡建筑\n                const mainTowerGeometry = new THREE.BoxGeometry(10, 12, 10);\n                const mainTowerMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xddeeff,\n                    roughness: 0.3,\n                    metalness: 0.7\n                });\n                const mainTower = new THREE.Mesh(mainTowerGeometry, mainTowerMaterial);\n                mainTower.position.y = 8;\n                mainTower.castShadow = true;\n                mainTower.receiveShadow = true;\n                castle.add(mainTower);\n                \n                // 城堡屋顶\n                const roofGeometry = new THREE.ConeGeometry(8, 5, 4);\n                const roofMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x88aadd,\n                    roughness: 0.2,\n                    metalness: 0.8\n                });\n                const roof = new THREE.Mesh(roofGeometry, roofMaterial);\n                roof.position.y = 14.5;\n                roof.rotation.y = Math.PI / 4;\n                roof.castShadow = true;\n                castle.add(roof);\n                \n                // 添加塔楼\n                const towerPositions = [\n                    { x: 8, y: 5, z: 8 },\n                    { x: -8, y: 5, z: 8 },\n                    { x: 8, y: 5, z: -8 },\n                    { x: -8, y: 5, z: -8 }\n                ];\n                \n                towerPositions.forEach(pos => {\n                    const towerGeometry = new THREE.CylinderGeometry(1.5, 2, 8, 8);\n                    const tower = new THREE.Mesh(towerGeometry, mainTowerMaterial);\n                    tower.position.set(pos.x, pos.y, pos.z);\n                    tower.castShadow = true;\n                    tower.receiveShadow = true;\n                    castle.add(tower);\n                    \n                    // 塔顶\n                    const towerRoofGeometry = new THREE.ConeGeometry(2, 3, 8);\n                    const towerRoof = new THREE.Mesh(towerRoofGeometry, roofMaterial);\n                    towerRoof.position.set(pos.x, pos.y + 5.5, pos.z);\n                    towerRoof.castShadow = true;\n                    castle.add(towerRoof);\n                });\n                \n                // 添加桥梁\n                const bridgeGeometry = new THREE.BoxGeometry(20, 0.5, 2);\n                const bridgeMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xccddff,\n                    roughness: 0.3,\n                    metalness: 0.6,\n                    emissive: 0x224466,\n                    emissiveIntensity: 0.2\n                });\n                \n                const bridge1 = new THREE.Mesh(bridgeGeometry, bridgeMaterial);\n                bridge1.position.set(0, 3, 12);\n                bridge1.castShadow = true;\n                castle.add(bridge1);\n                \n                const bridge2 = new THREE.Mesh(bridgeGeometry, bridgeMaterial);\n                bridge2.position.set(12, 3, 0);\n                bridge2.rotation.y = Math.PI / 2;\n                bridge2.castShadow = true;\n                castle.add(bridge2);\n                \n                // 添加发光水晶\n                const crystalGeometry = new THREE.OctahedronGeometry(1.5, 0);\n                const crystalMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xaaddff,\n                    roughness: 0.1,\n                    metalness: 0.9,\n                    emissive: 0x88bbff,\n                    emissiveIntensity: 0.5\n                });\n                \n                const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);\n                crystal.position.set(0, 16, 0);\n                crystal.castShadow = true;\n                castle.add(crystal);\n                \n                // 添加栏杆\n                for (let i = 0; i < 12; i++) {\n                    const angle = (i / 12) * Math.PI * 2;\n                    const railingGeometry = new THREE.BoxGeometry(0.3, 1.5, 0.3);\n                    const railing = new THREE.Mesh(railingGeometry, roofMaterial);\n                    railing.position.set(\n                        Math.cos(angle) * 15,\n                        1.5,\n                        Math.sin(angle) * 15\n                    );\n                    railing.castShadow = true;\n                    castle.add(railing);\n                }\n                \n                scene.add(castle);\n            }\n            \n            // 创建云雾系统\n            function createCloudSystem() {\n                const cloudGroup = new THREE.Group();\n                const cloudGeometry = new THREE.SphereGeometry(1, 8, 8);\n                const cloudMaterial = new THREE.MeshStandardMaterial({\n                    color: 0xffffff,\n                    transparent: true,\n                    opacity: 0.6,\n                    fog: true\n                });\n                \n                // 创建多个云朵\n                for (let i = 0; i < 25; i++) {\n                    const cloud = new THREE.Group();\n                    \n                    // 每朵云由多个球体组成\n                    const cloudParts = Math.floor(Math.random() * 4) + 3;\n                    for (let j = 0; j < cloudParts; j++) {\n                        const part = new THREE.Mesh(cloudGeometry, cloudMaterial);\n                        part.scale.set(\n                            Math.random() * 2 + 1,\n                            Math.random() * 1.5 + 0.5,\n                            Math.random() * 2 + 1\n                        );\n                        part.position.set(\n                            (Math.random() - 0.5) * 6,\n                            (Math.random() - 0.5) * 2,\n                            (Math.random() - 0.5) * 6\n                        );\n                        cloud.add(part);\n                    }\n                    \n                    // 随机位置\n                    cloud.position.set(\n                        (Math.random() - 0.5) * 120,\n                        Math.random() * 20 - 10,\n                        (Math.random() - 0.5) * 120\n                    );\n                    \n                    // 随机大小\n                    const scale = Math.random() * 1.5 + 0.8;\n                    cloud.scale.set(scale, scale, scale);\n                    \n                    cloud.userData = {\n                        speedX: (Math.random() - 0.5) * 0.02,\n                        speedZ: (Math.random() - 0.5) * 0.02,\n                        floatSpeed: Math.random() * 0.01 + 0.005,\n                        initialY: cloud.position.y\n                    };\n                    \n                    cloudGroup.add(cloud);\n                    clouds.push(cloud);\n                    particleCount += cloudParts;\n                }\n                \n                cloudSystem = cloudGroup;\n                scene.add(cloudSystem);\n            }\n            \n            // 创建星空系统\n            function createStarSystem() {\n                const starGroup = new THREE.Group();\n                const starGeometry = new THREE.BufferGeometry();\n                const starCount = 2000;\n                \n                const positions = new Float32Array(starCount * 3);\n                const colors = new Float32Array(starCount * 3);\n                const sizes = new Float32Array(starCount);\n                \n                // 创建星星位置和属性\n                for (let i = 0; i < starCount; i++) {\n                    const i3 = i * 3;\n                    \n                    // 随机位置（球形分布）\n                    const radius = 150 + Math.random() * 100;\n                    const theta = Math.random() * Math.PI * 2;\n                    const phi = Math.acos(2 * Math.random() - 1);\n                    \n                    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);\n                    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);\n                    positions[i3 + 2] = radius * Math.cos(phi);\n                    \n                    // 随机颜色（偏蓝白）\n                    const colorIntensity = 0.7 + Math.random() * 0.3;\n                    colors[i3] = 0.8 * colorIntensity;\n                    colors[i3 + 1] = 0.9 * colorIntensity;\n                    colors[i3 + 2] = 1.0 * colorIntensity;\n                    \n                    // 随机大小\n                    sizes[i] = Math.random() * 1.5 + 0.5;\n                }\n                \n                starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));\n                starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));\n                starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));\n                \n                // 星星材质\n                const starMaterial = new THREE.PointsMaterial({\n                    size: 1.5,\n                    vertexColors: true,\n                    transparent: true,\n                    opacity: 0.8,\n                    blending: THREE.AdditiveBlending\n                });\n                \n                const stars = new THREE.Points(starGeometry, starMaterial);\n                starGroup.add(stars);\n                starSystem = starGroup;\n                scene.add(starSystem);\n                \n                particleCount += starCount;\n            }\n            \n            // 创建流光系统\n            function createFlowSystem() {\n                const flowGroup = new THREE.Group();\n                const flowCount = 300;\n                const flowGeometry = new THREE.BufferGeometry();\n                \n                const positions = new Float32Array(flowCount * 3);\n                const colors = new Float32Array(flowCount * 3);\n                const sizes = new Float32Array(flowCount);\n                \n                // 创建流光粒子\n                for (let i = 0; i < flowCount; i++) {\n                    const i3 = i * 3;\n                    \n                    // 初始位置在城堡周围\n                    const radius = 20 + Math.random() * 40;\n                    const angle = Math.random() * Math.PI * 2;\n                    const height = Math.random() * 30;\n                    \n                    positions[i3] = Math.cos(angle) * radius;\n                    positions[i3 + 1] = height;\n                    positions[i3 + 2] = Math.sin(angle) * radius;\n                    \n                    // 流光颜色（蓝紫色调）\n                    colors[i3] = 0.5 + Math.random() * 0.5; // R\n                    colors[i3 + 1] = 0.6 + Math.random() * 0.4; // G\n                    colors[i3 + 2] = 0.9 + Math.random() * 0.1; // B\n                    \n                    // 粒子大小\n                    sizes[i] = Math.random() * 2 + 0.5;\n                    \n                    // 存储粒子数据\n                    flowParticles.push({\n                        angle: angle,\n                        radius: radius,\n                        height: height,\n                        speed: 0.01 + Math.random() * 0.03,\n                        verticalSpeed: (Math.random() - 0.5) * 0.02,\n                        colorOffset: Math.random() * Math.PI * 2\n                    });\n                }\n                \n                flowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));\n                flowGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));\n                flowGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));\n                \n                // 流光材质\n                const flowMaterial = new THREE.PointsMaterial({\n                    size: 2,\n                    vertexColors: true,\n                    transparent: true,\n                    opacity: 0.7,\n                    blending: THREE.AdditiveBlending\n                });\n                \n                const flows = new THREE.Points(flowGeometry, flowMaterial);\n                flowGroup.add(flows);\n                flowSystem = flowGroup;\n                scene.add(flowSystem);\n                \n                particleCount += flowCount;\n            }\n            \n            // 更新粒子计数显示\n            function updateParticleCount() {\n                document.getElementById('particleCount').textContent = particleCount.toLocaleString();\n            }\n            \n            // 切换云雾显示\n            function toggleClouds() {\n                cloudsEnabled = !cloudsEnabled;\n                cloudSystem.visible = cloudsEnabled;\n                document.getElementById('toggleClouds').textContent = \n                    cloudsEnabled ? '云雾开关' : '云雾开启';\n            }\n            \n            // 切换星光显示\n            function toggleStars() {\n                starsEnabled = !starsEnabled;\n                starSystem.visible = starsEnabled;\n                document.getElementById('toggleStars').textContent = \n                    starsEnabled ? '星光开关' : '星光开启';\n            }\n            \n            // 切换流光显示\n            function toggleFlow() {\n                flowEnabled = !flowEnabled;\n                flowSystem.visible = flowEnabled;\n                document.getElementById('toggleFlow').textContent = \n                    flowEnabled ? '流光开关' : '流光开启';\n            }\n            \n            // 重置视角\n            function resetView() {\n                controls.reset();\n            }\n            \n            // 窗口大小调整处理\n            function onWindowResize() {\n                camera.aspect = window.innerWidth / window.innerHeight;\n                camera.updateProjectionMatrix();\n                renderer.setSize(window.innerWidth, window.innerHeight);\n            }\n            \n            // 动画循环\n            function animate() {\n                requestAnimationFrame(animate);\n                \n                const delta = clock.getDelta();\n                const time = clock.getElapsedTime();\n                \n                // 更新控制器\n                controls.update();\n                \n                // 城堡轻微浮动\n                castle.position.y = Math.sin(time * 0.3) * 0.3;\n                castle.rotation.y += 0.001;\n                \n                // 更新云雾\n                if (cloudsEnabled) {\n                    clouds.forEach(cloud => {\n                        const data = cloud.userData;\n                        \n                        // 水平移动\n                        cloud.position.x += data.speedX;\n                        cloud.position.z += data.speedZ;\n                        \n                        // 垂直浮动\n                        cloud.position.y = data.initialY + Math.sin(time * data.floatSpeed) * 2;\n                        \n                        // 边界检查，让云朵循环移动\n                        if (cloud.position.x > 70) cloud.position.x = -70;\n                        if (cloud.position.x < -70) cloud.position.x = 70;\n                        if (cloud.position.z > 70) cloud.position.z = -70;\n                        if (cloud.position.z < -70) cloud.position.z = 70;\n                    });\n                }\n                \n                // 更新流光\n                if (flowEnabled && flowSystem) {\n                    const positions = flowSystem.children[0].geometry.attributes.position.array;\n                    const colors = flowSystem.children[0].geometry.attributes.color.array;\n                    \n                    for (let i = 0; i < flowParticles.length; i++) {\n                        const particle = flowParticles[i];\n                        const i3 = i * 3;\n                        \n                        // 更新角度（旋转运动）\n                        particle.angle += particle.speed;\n                        \n                        // 更新高度（上下浮动）\n                        particle.height += particle.verticalSpeed;\n                        \n                        // 边界检查，重置高度\n                        if (particle.height > 35) particle.verticalSpeed = -Math.abs(particle.verticalSpeed);\n                        if (particle.height < 0) particle.verticalSpeed = Math.abs(particle.verticalSpeed);\n                        \n                        // 更新位置\n                        positions[i3] = Math.cos(particle.angle) * particle.radius;\n                        positions[i3 + 1] = particle.height;\n                        positions[i3 + 2] = Math.sin(particle.angle) * particle.radius;\n                        \n                        // 更新颜色（随时间变化）\n                        const colorVariation = Math.sin(time * 0.5 + particle.colorOffset) * 0.2;\n                        colors[i3] = 0.5 + colorVariation; // R\n                        colors[i3 + 1] = 0.6 + colorVariation * 0.5; // G\n                        colors[i3 + 2] = 0.9 + colorVariation; // B\n                    }\n                    \n                    flowSystem.children[0].geometry.attributes.position.needsUpdate = true;\n                    flowSystem.children[0].geometry.attributes.color.needsUpdate = true;\n                }\n                \n                // 渲染场景\n                renderer.render(scene, camera);\n            }\n            \n            // 启动应用\n            init();\n            animate();\n        });\n    </script>\n</body>\n</html>	{"stripLog": false, "stripDOMBox": false, "stripImport": true, "stripControls": false, "stripRenderer": false}	{}	\N	2026-07-24 18:14:36.38956	2026-07-24 18:14:36.38956	html	\N	[]	ok
5	粉色宫殿		/* 自动声明的导入变量（运行器已提供常见类，其余从 THREE 命名空间兜底） */\nvar OrbitControls = (typeof OrbitControls !== 'undefined') ? OrbitControls : (THREE.OrbitControls || function(){});\n\n\n// ============================================================\n// 场景\n// ============================================================\nconst app = document.getElementById('app');\nconst scene = new THREE.Scene();\n\n// 深邃星空背景\nconst starfieldCanvas = document.createElement('canvas');\nstarfieldCanvas.width = 512; starfieldCanvas.height = 512;\nconst sCtx = starfieldCanvas.getContext('2d');\nconst sg = sCtx.createRadialGradient(256, 256, 0, 256, 256, 256);\nsg.addColorStop(0, '#1a0a30');\nsg.addColorStop(0.4, '#0e0820');\nsg.addColorStop(1, '#050210');\nsCtx.fillStyle = sg; sCtx.fillRect(0, 0, 512, 512);\nfor (let i = 0; i < 400; i++) {\n  const b = 100 + Math.random() * 155;\n  sCtx.fillStyle = `rgb(${b},${b},${b + Math.random() * 100})`;\n  sCtx.beginPath();\n  sCtx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 2 + 0.3, 0, Math.PI * 2);\n  sCtx.fill();\n}\nconst starTex = new THREE.CanvasTexture(starfieldCanvas);\nstarTex.encoding = THREE.sRGBEncoding;\nscene.background = starTex;\n\nconst camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);\ncamera.position.set(6, 4, 8);\n\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\nrenderer.setSize(window.innerWidth, window.innerHeight);\nrenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));\nrenderer.toneMapping = THREE.ACESFilmicToneMapping;\nrenderer.toneMappingExposure = 1.2;\nrenderer.outputEncoding = THREE.sRGBEncoding;\nrenderer.shadowMap.enabled = true;\nrenderer.shadowMap.type = THREE.PCFSoftShadowMap;\napp.appendChild(renderer.domElement);\n\nconst controls = new OrbitControls(camera, renderer.domElement);\ncontrols.target.set(0, 1.5, 0);\ncontrols.enableDamping = true;\ncontrols.dampingFactor = 0.06;\ncontrols.minDistance = 3;\ncontrols.maxDistance = 20;\ncontrols.autoRotate = true;\ncontrols.autoRotateSpeed = 0.8;\n\n// ============================================================\n// 灯光 — 仙幻色调\n// ============================================================\nconst moonLight = new THREE.DirectionalLight(0xA080FF, 2.5);\nmoonLight.position.set(-5, 10, -3);\nmoonLight.castShadow = true;\nmoonLight.shadow.mapSize.width = 512;\nmoonLight.shadow.mapSize.height = 512;\nscene.add(moonLight);\n\nconst warmLight = new THREE.DirectionalLight(0xFFC080, 0.8);\nwarmLight.position.set(4, 3, 2);\nscene.add(warmLight);\n\nconst rimLight = new THREE.DirectionalLight(0x6080FF, 0.6);\nrimLight.position.set(-3, -2, -6);\nscene.add(rimLight);\n\nconst ambColor = new THREE.Color(0x201030);\nconst ambient = new THREE.AmbientLight(ambColor, 0.4);\nscene.add(ambient);\n\n// ============================================================\n// 材质\n// ============================================================\nconst wallMat = new THREE.MeshStandardMaterial({\n  color: 0xD4C8E8, roughness: 0.5, metalness: 0.0, emissive: 0x100820, emissiveIntensity: 0.05,\n});\nconst roofMat = new THREE.MeshStandardMaterial({\n  color: 0xCC3388, roughness: 0.4, metalness: 0.1, emissive: 0x440022, emissiveIntensity: 0.08,\n});\nconst pillarMat = new THREE.MeshStandardMaterial({\n  color: 0xCC4466, roughness: 0.3, metalness: 0.05,\n});\nconst goldMat = new THREE.MeshStandardMaterial({\n  color: 0xFFD080, roughness: 0.25, metalness: 0.3,\n});\nconst glowMat = new THREE.MeshStandardMaterial({\n  color: 0xFF88CC, roughness: 0.2, metalness: 0,\n  emissive: 0xFF66AA, emissiveIntensity: 0.6,\n});\nconst cloudMat = new THREE.MeshPhysicalMaterial({\n  color: 0xE0D0FF, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.25,\n});\nconst lanternMat = new THREE.MeshStandardMaterial({\n  color: 0xFF6644, roughness: 0.3, metalness: 0,\n  emissive: 0xFF4400, emissiveIntensity: 2.0,\n});\nconst bridgeMat = new THREE.MeshStandardMaterial({\n  color: 0xC8B898, roughness: 0.6, metalness: 0.02,\n});\n\n// ============================================================\n// 主建筑 Group\n// ============================================================\nconst house = new THREE.Group();\nhouse.position.y = 0;\nscene.add(house);\n\n// ---------- 云雾底座 ----------\nconst baseCloud = new THREE.Mesh(new THREE.SphereGeometry(2.8, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), cloudMat);\nbaseCloud.position.y = -0.3;\nbaseCloud.scale.set(1, 0.3, 1.2);\nhouse.add(baseCloud);\n\n// 几个副云团\nfor (let i = 0; i < 8; i++) {\n  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random() * 0.6, 12, 8), cloudMat);\n  const a = Math.random() * Math.PI * 2;\n  const r = 1.8 + Math.random() * 1.2;\n  puff.position.set(Math.cos(a) * r, -0.35 + Math.random() * 0.15, Math.sin(a) * r);\n  puff.scale.set(1, 0.3 + Math.random() * 0.2, 0.8 + Math.random() * 0.4);\n  house.add(puff);\n}\n\n// ---------- 基台 ----------\nconst base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.3, 16), wallMat);\nbase.position.y = 0.15;\nhouse.add(base);\n\n// 基台金边\nconst baseGold = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.04, 8, 32), goldMat);\nbaseGold.position.y = 0.3;\nbaseGold.rotation.x = Math.PI / 2;\nhouse.add(baseGold);\n\n// ---------- 主楼（两层楼阁）----------\n// 一层\nconst floor1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.8, 16), wallMat);\nfloor1.position.y = 0.7;\nhouse.add(floor1);\n\n// 一层柱子\nfor (let i = 0; i < 8; i++) {\n  const a = (i / 8) * Math.PI * 2;\n  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), pillarMat);\n  pillar.position.set(Math.cos(a) * 1.1, 0.7, Math.sin(a) * 1.1);\n  house.add(pillar);\n}\n\n// 一层屋檐（翘角飞檐）\nfunction makeEaveLayer(radiusY, yPos, segments, scaleZ) {\n  const eave = new THREE.Mesh(new THREE.TorusGeometry(radiusY, 0.06, 12, segments), roofMat);\n  eave.position.y = yPos;\n  eave.rotation.x = Math.PI / 2;\n  eave.scale.z = scaleZ || 1;\n  house.add(eave);\n\n  // 翘角装饰（四个角）\n  for (let i = 0; i < 4; i++) {\n    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;\n    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 6), goldMat);\n    const tr = radiusY;\n    tip.position.set(Math.cos(a) * tr, yPos + 0.05, Math.sin(a) * tr);\n    tip.rotation.x = Math.PI / 2;\n    tip.rotation.z = -a;\n    house.add(tip);\n\n    // 翘角挂铃\n    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), goldMat);\n    bell.position.set(Math.cos(a) * (tr + 0.08), yPos - 0.1, Math.sin(a) * (tr + 0.08));\n    house.add(bell);\n  }\n}\nmakeEaveLayer(1.35, 1.1, 24);\n\n// ---------- 二层 ----------\nconst floor2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.7, 16), wallMat);\nfloor2.position.y = 1.5;\nhouse.add(floor2);\n\n// 二层柱子\nfor (let i = 0; i < 6; i++) {\n  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;\n  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 8), pillarMat);\n  pillar.position.set(Math.cos(a) * 0.75, 1.5, Math.sin(a) * 0.75);\n  house.add(pillar);\n}\n\n// 二层栏杆\nconst railMat = new THREE.MeshStandardMaterial({ color: 0xCCAACC, roughness: 0.4 });\nfor (let i = 0; i < 20; i++) {\n  const a = (i / 20) * Math.PI * 2;\n  const post = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.15, 0.015), railMat);\n  post.position.set(Math.cos(a) * 0.82, 1.28, Math.sin(a) * 0.82);\n  house.add(post);\n}\n\nmakeEaveLayer(0.95, 1.85, 20);\n\n// ---------- 主顶（华丽大屋顶）----------\nconst mainRoof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.8, 16), roofMat);\nmainRoof.position.y = 2.3;\nhouse.add(mainRoof);\n\n// 屋顶金顶\nconst spireBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.1, 8), goldMat);\nspireBase.position.y = 2.7;\nhouse.add(spireBase);\nconst spire = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 8), goldMat);\nspire.position.y = 2.85;\nhouse.add(spire);\n\n// 屋顶四条垂脊翘角\nfor (let i = 0; i < 4; i++) {\n  const a = (i / 4) * Math.PI * 2 + Math.PI / 4;\n  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 6), goldMat);\n  tip.position.set(Math.cos(a) * 0.6, 2.5, Math.sin(a) * 0.6);\n  tip.rotation.x = Math.PI / 3.5;\n  tip.rotation.z = -a;\n  house.add(tip);\n}\n\n// ---------- 悬浮的走廊/桥 ----------\nfor (let side of [-1, 1]) {\n  const bridgeGrp = new THREE.Group();\n  const bridgePlank = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.2), bridgeMat);\n  bridgeGrp.add(bridgePlank);\n  for (let j = 0; j < 3; j++) {\n    const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), railMat);\n    baluster.position.set(-0.4 + j * 0.4, 0.07, 0.1);\n    bridgeGrp.add(baluster);\n  }\n  bridgeGrp.position.set(side * 1.4, 0.6, 0.6);\n  bridgeGrp.rotation.y = side * 0.8;\n  house.add(bridgeGrp);\n}\n\n// ---------- 悬浮的亭子（两侧副楼）----------\nfunction makePavilion(x, z, rotY) {\n  const pav = new THREE.Group();\n\n  const pavFloor = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.15, 12), wallMat);\n  pavFloor.position.y = 0.08;\n  pav.add(pavFloor);\n\n  for (let i = 0; i < 4; i++) {\n    const a = (i / 4) * Math.PI * 2;\n    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6), pillarMat);\n    p.position.set(Math.cos(a) * 0.28, 0.28, Math.sin(a) * 0.28);\n    pav.add(p);\n  }\n\n  const pavRoof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.25, 12), roofMat);\n  pavRoof.position.y = 0.45;\n  pav.add(pavRoof);\n\n  const pavTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), goldMat);\n  pavTip.position.y = 0.6;\n  pav.add(pavTip);\n\n  pav.position.set(x, 0.8, z);\n  if (rotY) pav.rotation.y = rotY;\n  return pav;\n}\nhouse.add(makePavilion(2.0, 0, -0.5));\nhouse.add(makePavilion(-2.0, 0, 0.5));\n\n// ============================================================\n// 悬浮的小岛/岩石\n// ============================================================\nfunction makeFloatingIsland(x, z, y, scale) {\n  const grp = new THREE.Group();\n  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale * 0.5, 0),\n    new THREE.MeshStandardMaterial({ color: 0x4A3868, roughness: 0.8, emissive: 0x100820, emissiveIntensity: 0.05 }));\n  rock.scale.set(1, 0.4, 1);\n  grp.add(rock);\n\n  const cloudRing = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.6, scale * 0.08, 8, 24), cloudMat);\n  cloudRing.position.y = -scale * 0.1;\n  cloudRing.rotation.x = Math.PI / 2;\n  grp.add(cloudRing);\n\n  // 小光点\n  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), glowMat);\n  dot.position.y = scale * 0.3;\n  grp.add(dot);\n\n  grp.position.set(x, y, z);\n  return grp;\n}\nscene.add(makeFloatingIsland(3.5, 1.5, 1.2, 0.8));\nscene.add(makeFloatingIsland(-3.0, 2.0, 1.8, 0.6));\nscene.add(makeFloatingIsland(2.5, -2.0, 2.2, 0.7));\nscene.add(makeFloatingIsland(-3.5, -1.5, 1.0, 0.5));\n\n// ============================================================\n// 悬浮灯笼（动态旋转）\n// ============================================================\nconst lanterns = [];\nfunction makeLantern(x, y, z, color) {\n  const grp = new THREE.Group();\n\n  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), new THREE.MeshStandardMaterial({\n    color, roughness: 0.3, emissive: color, emissiveIntensity: 1.5,\n  }));\n  grp.add(body);\n\n  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12), goldMat);\n  topRing.position.y = 0.07;\n  grp.add(topRing);\n\n  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({\n    color, transparent: true, opacity: 0.08,\n  }));\n  grp.add(glow);\n\n  grp.position.set(x, y, z);\n  scene.add(grp);\n  lanterns.push(grp);\n  return grp;\n}\nconst lanternColors = [0xFF6644, 0xFFAA44, 0xFF4488, 0xAA66FF, 0x44CCFF];\nfor (let i = 0; i < 12; i++) {\n  const a = Math.random() * Math.PI * 2;\n  const r = 1.8 + Math.random() * 1.5;\n  const clr = lanternColors[i % lanternColors.length];\n  makeLantern(Math.cos(a) * r, 1.0 + Math.random() * 2.5, Math.sin(a) * r, clr);\n}\n\n// ============================================================\n// 粒子系统 1 — 星光粒子（缓慢上升飘散）\n// ============================================================\nconst starParticleCount = 800;\nconst starGeo = new THREE.BufferGeometry();\nconst starPos = new Float32Array(starParticleCount * 3);\nconst starSizes = new Float32Array(starParticleCount);\nconst starSpeeds = new Float32Array(starParticleCount);\nconst starDrifts = new Float32Array(starParticleCount * 3);\n\nfor (let i = 0; i < starParticleCount; i++) {\n  const a = Math.random() * Math.PI * 2;\n  const r = 0.5 + Math.random() * 5;\n  starPos[i * 3] = Math.cos(a) * r * (0.5 + Math.random() * 0.8);\n  starPos[i * 3 + 1] = Math.random() * 4 + 0.2;\n  starPos[i * 3 + 2] = Math.sin(a) * r * (0.5 + Math.random() * 0.8);\n  starSizes[i] = 0.02 + Math.random() * 0.06;\n  starSpeeds[i] = 0.1 + Math.random() * 0.3;\n  starDrifts[i * 3] = (Math.random() - 0.5) * 0.02;\n  starDrifts[i * 3 + 1] = 0.005 + Math.random() * 0.015;\n  starDrifts[i * 3 + 2] = (Math.random() - 0.5) * 0.02;\n}\nstarGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));\nstarGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));\n\nconst starMatP = new THREE.PointsMaterial({\n  color: 0xCCAAFF, size: 0.04, transparent: true, opacity: 0.8,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst starParticles = new THREE.Points(starGeo, starMatP);\nscene.add(starParticles);\n\n// ============================================================\n// 粒子系统 2 — 仙气/流光粒子（环绕建筑流动）\n// ============================================================\nconst flowCount = 400;\nconst flowGeo = new THREE.BufferGeometry();\nconst flowPos = new Float32Array(flowCount * 3);\nconst flowAngles = new Float32Array(flowCount);\nconst flowHeights = new Float32Array(flowCount);\nconst flowRadii = new Float32Array(flowCount);\nconst flowSpeedsArr = new Float32Array(flowCount);\n\nfor (let i = 0; i < flowCount; i++) {\n  flowAngles[i] = Math.random() * Math.PI * 2;\n  flowRadii[i] = 0.3 + Math.random() * 2.5;\n  flowHeights[i] = Math.random() * 3.5;\n  flowSpeedsArr[i] = 0.2 + Math.random() * 0.5;\n  flowPos[i * 3] = Math.cos(flowAngles[i]) * flowRadii[i];\n  flowPos[i * 3 + 1] = flowHeights[i];\n  flowPos[i * 3 + 2] = Math.sin(flowAngles[i]) * flowRadii[i];\n}\nflowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));\n\nconst flowMatP = new THREE.PointsMaterial({\n  color: 0xFF88CC, size: 0.035, transparent: true, opacity: 0.6,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst flowParticles = new THREE.Points(flowGeo, flowMatP);\nscene.add(flowParticles);\n\n// ============================================================\n// 粒子系统 3 — 飘落的发光花瓣/光羽\n// ============================================================\nconst petalCount = 150;\nconst petalGeo = new THREE.BufferGeometry();\nconst petalPos = new Float32Array(petalCount * 3);\nconst petalVel = new Float32Array(petalCount * 3);\nconst petalSizes = new Float32Array(petalCount);\nconst petalSeed = new Float32Array(petalCount);\n\nfor (let i = 0; i < petalCount; i++) {\n  petalPos[i * 3] = (Math.random() - 0.5) * 10;\n  petalPos[i * 3 + 1] = Math.random() * 6;\n  petalPos[i * 3 + 2] = (Math.random() - 0.5) * 10;\n  petalVel[i * 3] = (Math.random() - 0.5) * 0.008;\n  petalVel[i * 3 + 1] = -0.005 - Math.random() * 0.015;\n  petalVel[i * 3 + 2] = (Math.random() - 0.5) * 0.008;\n  petalSizes[i] = 0.03 + Math.random() * 0.05;\n  petalSeed[i] = Math.random() * Math.PI * 2;\n}\npetalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));\npetalGeo.setAttribute('size', new THREE.BufferAttribute(petalSizes, 1));\n\nconst petalMat = new THREE.PointsMaterial({\n  color: 0xFF99CC, size: 0.05, transparent: true, opacity: 0.5,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst petalParticles = new THREE.Points(petalGeo, petalMat);\nscene.add(petalParticles);\n\n// ============================================================\n// 环绕光晕环（动态旋转的大光环）\n// ============================================================\nconst ringMat = new THREE.MeshBasicMaterial({\n  color: 0x8844FF, transparent: true, opacity: 0.08, side: THREE.DoubleSide,\n});\nconst glowRing = new THREE.Mesh(new THREE.RingGeometry(2.8, 3.0, 64), ringMat);\nglowRing.rotation.x = Math.PI / 2.5;\nglowRing.position.y = 1.2;\nscene.add(glowRing);\n\nconst glowRing2 = new THREE.Mesh(new THREE.RingGeometry(3.8, 3.95, 64), new THREE.MeshBasicMaterial({\n  color: 0xFF66AA, transparent: true, opacity: 0.05, side: THREE.DoubleSide,\n}));\nglowRing2.rotation.x = Math.PI / 2.5 + 0.2;\nglowRing2.position.y = 1.8;\nscene.add(glowRing2);\n\n// ============================================================\n// 动画循环\n// ============================================================\ndocument.getElementById('loading').style.display = 'none';\n\nlet time = 0;\n\nfunction animate() {\n  requestAnimationFrame(animate);\n  time += 0.01;\n\n  controls.update();\n\n  // ---- 粒子1: 星光飘散 ----\n  const sp = starParticles.geometry.attributes.position.array;\n  for (let i = 0; i < starParticleCount; i++) {\n    sp[i * 3] += starDrifts[i * 3];\n    sp[i * 3 + 1] += starDrifts[i * 3 + 1];\n    sp[i * 3 + 2] += starDrifts[i * 3 + 2];\n    // 重置到底部\n    if (sp[i * 3 + 1] > 4.5) {\n      const a = Math.random() * Math.PI * 2;\n      const r = 0.5 + Math.random() * 5;\n      sp[i * 3] = Math.cos(a) * r * (0.5 + Math.random() * 0.8);\n      sp[i * 3 + 1] = 0;\n      sp[i * 3 + 2] = Math.sin(a) * r * (0.5 + Math.random() * 0.8);\n    }\n  }\n  starParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 粒子2: 环绕流光 ----\n  const fp = flowParticles.geometry.attributes.position.array;\n  for (let i = 0; i < flowCount; i++) {\n    flowAngles[i] += flowSpeedsArr[i] * 0.01;\n    fp[i * 3] = Math.cos(flowAngles[i]) * flowRadii[i];\n    fp[i * 3 + 2] = Math.sin(flowAngles[i]) * flowRadii[i];\n    // 轻微上下浮动\n    fp[i * 3 + 1] = flowHeights[i] + Math.sin(time * 0.5 + i) * 0.15;\n  }\n  flowParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 粒子3: 飘落花瓣 ----\n  const pp = petalParticles.geometry.attributes.position.array;\n  for (let i = 0; i < petalCount; i++) {\n    pp[i * 3] += petalVel[i * 3] + Math.sin(time + petalSeed[i]) * 0.002;\n    pp[i * 3 + 1] += petalVel[i * 3 + 1];\n    pp[i * 3 + 2] += petalVel[i * 3 + 2] + Math.cos(time + petalSeed[i]) * 0.002;\n    if (pp[i * 3 + 1] < -0.5) {\n      pp[i * 3] = (Math.random() - 0.5) * 10;\n      pp[i * 3 + 1] = 5 + Math.random() * 1;\n      pp[i * 3 + 2] = (Math.random() - 0.5) * 10;\n    }\n  }\n  petalParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 灯笼旋转 ----\n  lanterns.forEach((l, i) => {\n    l.rotation.y += 0.005 * (i % 2 === 0 ? 1 : -1);\n    l.position.y += Math.sin(time * 0.5 + i * 1.7) * 0.0005;\n  });\n\n  // ---- 光环旋转 ----\n  glowRing.rotation.y += 0.003;\n  glowRing2.rotation.y -= 0.004;\n\n  // ---- 光晕脉冲 ----\n  const pulse = 0.6 + Math.sin(time * 1.5) * 0.4;\n  glowMat.emissiveIntensity = pulse;\n  lanternMat.emissiveIntensity = 1.5 + Math.sin(time * 1.2) * 0.8;\n\n  renderer.render(scene, camera);\n}\nanimate();\n\nwindow.addEventListener('resize', () => {\n  camera.aspect = window.innerWidth / window.innerHeight;\n  camera.updateProjectionMatrix();\n  renderer.setSize(window.innerWidth, window.innerHeight);\n});	<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<title>仙人居 · 玄幻仙居</title>\n<style>\n  * { margin: 0; padding: 0; box-sizing: border-box; }\n  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0515; }\n  #app { width: 100vw; height: 100vh; }\n  #info {\n    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10;\n    color: #c8a8e0; font-family: "Microsoft YaHei", "KaiTi", serif;\n    font-size: 16px; background: rgba(10,5,21,0.5); padding: 10px 24px;\n    border-radius: 30px; border: 1px solid rgba(200,168,224,0.15);\n    backdrop-filter: blur(6px); text-align: center; pointer-events: none;\n    letter-spacing: 2px;\n  }\n  #info span { color: #e8c0ff; }\n  #loading {\n    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;\n    color: #c8a8e0; font-family: "Microsoft YaHei", sans-serif; font-size: 20px; z-index: 20;\n    background: #0a0515; letter-spacing: 3px;\n  }\n</style>\n</head>\n<body>\n<div id="app"></div>\n<div id="info">✦ 仙人居 · <span>缥缈幻境</span> ✦ 拖拽旋转 / 滚轮缩放</div>\n<div id="loading">仙气凝聚中…</div>\n\n<script type="importmap">\n{\n  "imports": {\n    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",\n    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"\n  }\n}\n</script>\n\n<script type="module">\nimport * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n\n// ============================================================\n// 场景\n// ============================================================\nconst app = document.getElementById('app');\nconst scene = new THREE.Scene();\n\n// 深邃星空背景\nconst starfieldCanvas = document.createElement('canvas');\nstarfieldCanvas.width = 512; starfieldCanvas.height = 512;\nconst sCtx = starfieldCanvas.getContext('2d');\nconst sg = sCtx.createRadialGradient(256, 256, 0, 256, 256, 256);\nsg.addColorStop(0, '#1a0a30');\nsg.addColorStop(0.4, '#0e0820');\nsg.addColorStop(1, '#050210');\nsCtx.fillStyle = sg; sCtx.fillRect(0, 0, 512, 512);\nfor (let i = 0; i < 400; i++) {\n  const b = 100 + Math.random() * 155;\n  sCtx.fillStyle = `rgb(${b},${b},${b + Math.random() * 100})`;\n  sCtx.beginPath();\n  sCtx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 2 + 0.3, 0, Math.PI * 2);\n  sCtx.fill();\n}\nconst starTex = new THREE.CanvasTexture(starfieldCanvas);\nstarTex.colorSpace = THREE.SRGBColorSpace;\nscene.background = starTex;\n\nconst camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);\ncamera.position.set(6, 4, 8);\n\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\nrenderer.setSize(window.innerWidth, window.innerHeight);\nrenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));\nrenderer.toneMapping = THREE.ACESFilmicToneMapping;\nrenderer.toneMappingExposure = 1.2;\nrenderer.outputColorSpace = THREE.SRGBColorSpace;\nrenderer.shadowMap.enabled = true;\nrenderer.shadowMap.type = THREE.PCFSoftShadowMap;\napp.appendChild(renderer.domElement);\n\nconst controls = new OrbitControls(camera, renderer.domElement);\ncontrols.target.set(0, 1.5, 0);\ncontrols.enableDamping = true;\ncontrols.dampingFactor = 0.06;\ncontrols.minDistance = 3;\ncontrols.maxDistance = 20;\ncontrols.autoRotate = true;\ncontrols.autoRotateSpeed = 0.8;\n\n// ============================================================\n// 灯光 — 仙幻色调\n// ============================================================\nconst moonLight = new THREE.DirectionalLight(0xA080FF, 2.5);\nmoonLight.position.set(-5, 10, -3);\nmoonLight.castShadow = true;\nmoonLight.shadow.mapSize.width = 512;\nmoonLight.shadow.mapSize.height = 512;\nscene.add(moonLight);\n\nconst warmLight = new THREE.DirectionalLight(0xFFC080, 0.8);\nwarmLight.position.set(4, 3, 2);\nscene.add(warmLight);\n\nconst rimLight = new THREE.DirectionalLight(0x6080FF, 0.6);\nrimLight.position.set(-3, -2, -6);\nscene.add(rimLight);\n\nconst ambColor = new THREE.Color(0x201030);\nconst ambient = new THREE.AmbientLight(ambColor, 0.4);\nscene.add(ambient);\n\n// ============================================================\n// 材质\n// ============================================================\nconst wallMat = new THREE.MeshStandardMaterial({\n  color: 0xD4C8E8, roughness: 0.5, metalness: 0.0, emissive: 0x100820, emissiveIntensity: 0.05,\n});\nconst roofMat = new THREE.MeshStandardMaterial({\n  color: 0xCC3388, roughness: 0.4, metalness: 0.1, emissive: 0x440022, emissiveIntensity: 0.08,\n});\nconst pillarMat = new THREE.MeshStandardMaterial({\n  color: 0xCC4466, roughness: 0.3, metalness: 0.05,\n});\nconst goldMat = new THREE.MeshStandardMaterial({\n  color: 0xFFD080, roughness: 0.25, metalness: 0.3,\n});\nconst glowMat = new THREE.MeshStandardMaterial({\n  color: 0xFF88CC, roughness: 0.2, metalness: 0,\n  emissive: 0xFF66AA, emissiveIntensity: 0.6,\n});\nconst cloudMat = new THREE.MeshPhysicalMaterial({\n  color: 0xE0D0FF, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.25,\n});\nconst lanternMat = new THREE.MeshStandardMaterial({\n  color: 0xFF6644, roughness: 0.3, metalness: 0,\n  emissive: 0xFF4400, emissiveIntensity: 2.0,\n});\nconst bridgeMat = new THREE.MeshStandardMaterial({\n  color: 0xC8B898, roughness: 0.6, metalness: 0.02,\n});\n\n// ============================================================\n// 主建筑 Group\n// ============================================================\nconst house = new THREE.Group();\nhouse.position.y = 0;\nscene.add(house);\n\n// ---------- 云雾底座 ----------\nconst baseCloud = new THREE.Mesh(new THREE.SphereGeometry(2.8, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), cloudMat);\nbaseCloud.position.y = -0.3;\nbaseCloud.scale.set(1, 0.3, 1.2);\nhouse.add(baseCloud);\n\n// 几个副云团\nfor (let i = 0; i < 8; i++) {\n  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random() * 0.6, 12, 8), cloudMat);\n  const a = Math.random() * Math.PI * 2;\n  const r = 1.8 + Math.random() * 1.2;\n  puff.position.set(Math.cos(a) * r, -0.35 + Math.random() * 0.15, Math.sin(a) * r);\n  puff.scale.set(1, 0.3 + Math.random() * 0.2, 0.8 + Math.random() * 0.4);\n  house.add(puff);\n}\n\n// ---------- 基台 ----------\nconst base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.3, 16), wallMat);\nbase.position.y = 0.15;\nhouse.add(base);\n\n// 基台金边\nconst baseGold = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.04, 8, 32), goldMat);\nbaseGold.position.y = 0.3;\nbaseGold.rotation.x = Math.PI / 2;\nhouse.add(baseGold);\n\n// ---------- 主楼（两层楼阁）----------\n// 一层\nconst floor1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.8, 16), wallMat);\nfloor1.position.y = 0.7;\nhouse.add(floor1);\n\n// 一层柱子\nfor (let i = 0; i < 8; i++) {\n  const a = (i / 8) * Math.PI * 2;\n  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), pillarMat);\n  pillar.position.set(Math.cos(a) * 1.1, 0.7, Math.sin(a) * 1.1);\n  house.add(pillar);\n}\n\n// 一层屋檐（翘角飞檐）\nfunction makeEaveLayer(radiusY, yPos, segments, scaleZ) {\n  const eave = new THREE.Mesh(new THREE.TorusGeometry(radiusY, 0.06, 12, segments), roofMat);\n  eave.position.y = yPos;\n  eave.rotation.x = Math.PI / 2;\n  eave.scale.z = scaleZ || 1;\n  house.add(eave);\n\n  // 翘角装饰（四个角）\n  for (let i = 0; i < 4; i++) {\n    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;\n    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 6), goldMat);\n    const tr = radiusY;\n    tip.position.set(Math.cos(a) * tr, yPos + 0.05, Math.sin(a) * tr);\n    tip.rotation.x = Math.PI / 2;\n    tip.rotation.z = -a;\n    house.add(tip);\n\n    // 翘角挂铃\n    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), goldMat);\n    bell.position.set(Math.cos(a) * (tr + 0.08), yPos - 0.1, Math.sin(a) * (tr + 0.08));\n    house.add(bell);\n  }\n}\nmakeEaveLayer(1.35, 1.1, 24);\n\n// ---------- 二层 ----------\nconst floor2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.7, 16), wallMat);\nfloor2.position.y = 1.5;\nhouse.add(floor2);\n\n// 二层柱子\nfor (let i = 0; i < 6; i++) {\n  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;\n  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 8), pillarMat);\n  pillar.position.set(Math.cos(a) * 0.75, 1.5, Math.sin(a) * 0.75);\n  house.add(pillar);\n}\n\n// 二层栏杆\nconst railMat = new THREE.MeshStandardMaterial({ color: 0xCCAACC, roughness: 0.4 });\nfor (let i = 0; i < 20; i++) {\n  const a = (i / 20) * Math.PI * 2;\n  const post = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.15, 0.015), railMat);\n  post.position.set(Math.cos(a) * 0.82, 1.28, Math.sin(a) * 0.82);\n  house.add(post);\n}\n\nmakeEaveLayer(0.95, 1.85, 20);\n\n// ---------- 主顶（华丽大屋顶）----------\nconst mainRoof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.8, 16), roofMat);\nmainRoof.position.y = 2.3;\nhouse.add(mainRoof);\n\n// 屋顶金顶\nconst spireBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.1, 8), goldMat);\nspireBase.position.y = 2.7;\nhouse.add(spireBase);\nconst spire = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 8), goldMat);\nspire.position.y = 2.85;\nhouse.add(spire);\n\n// 屋顶四条垂脊翘角\nfor (let i = 0; i < 4; i++) {\n  const a = (i / 4) * Math.PI * 2 + Math.PI / 4;\n  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 6), goldMat);\n  tip.position.set(Math.cos(a) * 0.6, 2.5, Math.sin(a) * 0.6);\n  tip.rotation.x = Math.PI / 3.5;\n  tip.rotation.z = -a;\n  house.add(tip);\n}\n\n// ---------- 悬浮的走廊/桥 ----------\nfor (let side of [-1, 1]) {\n  const bridgeGrp = new THREE.Group();\n  const bridgePlank = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.2), bridgeMat);\n  bridgeGrp.add(bridgePlank);\n  for (let j = 0; j < 3; j++) {\n    const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), railMat);\n    baluster.position.set(-0.4 + j * 0.4, 0.07, 0.1);\n    bridgeGrp.add(baluster);\n  }\n  bridgeGrp.position.set(side * 1.4, 0.6, 0.6);\n  bridgeGrp.rotation.y = side * 0.8;\n  house.add(bridgeGrp);\n}\n\n// ---------- 悬浮的亭子（两侧副楼）----------\nfunction makePavilion(x, z, rotY) {\n  const pav = new THREE.Group();\n\n  const pavFloor = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.15, 12), wallMat);\n  pavFloor.position.y = 0.08;\n  pav.add(pavFloor);\n\n  for (let i = 0; i < 4; i++) {\n    const a = (i / 4) * Math.PI * 2;\n    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6), pillarMat);\n    p.position.set(Math.cos(a) * 0.28, 0.28, Math.sin(a) * 0.28);\n    pav.add(p);\n  }\n\n  const pavRoof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.25, 12), roofMat);\n  pavRoof.position.y = 0.45;\n  pav.add(pavRoof);\n\n  const pavTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), goldMat);\n  pavTip.position.y = 0.6;\n  pav.add(pavTip);\n\n  pav.position.set(x, 0.8, z);\n  if (rotY) pav.rotation.y = rotY;\n  return pav;\n}\nhouse.add(makePavilion(2.0, 0, -0.5));\nhouse.add(makePavilion(-2.0, 0, 0.5));\n\n// ============================================================\n// 悬浮的小岛/岩石\n// ============================================================\nfunction makeFloatingIsland(x, z, y, scale) {\n  const grp = new THREE.Group();\n  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale * 0.5, 0),\n    new THREE.MeshStandardMaterial({ color: 0x4A3868, roughness: 0.8, emissive: 0x100820, emissiveIntensity: 0.05 }));\n  rock.scale.set(1, 0.4, 1);\n  grp.add(rock);\n\n  const cloudRing = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.6, scale * 0.08, 8, 24), cloudMat);\n  cloudRing.position.y = -scale * 0.1;\n  cloudRing.rotation.x = Math.PI / 2;\n  grp.add(cloudRing);\n\n  // 小光点\n  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), glowMat);\n  dot.position.y = scale * 0.3;\n  grp.add(dot);\n\n  grp.position.set(x, y, z);\n  return grp;\n}\nscene.add(makeFloatingIsland(3.5, 1.5, 1.2, 0.8));\nscene.add(makeFloatingIsland(-3.0, 2.0, 1.8, 0.6));\nscene.add(makeFloatingIsland(2.5, -2.0, 2.2, 0.7));\nscene.add(makeFloatingIsland(-3.5, -1.5, 1.0, 0.5));\n\n// ============================================================\n// 悬浮灯笼（动态旋转）\n// ============================================================\nconst lanterns = [];\nfunction makeLantern(x, y, z, color) {\n  const grp = new THREE.Group();\n\n  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), new THREE.MeshStandardMaterial({\n    color, roughness: 0.3, emissive: color, emissiveIntensity: 1.5,\n  }));\n  grp.add(body);\n\n  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12), goldMat);\n  topRing.position.y = 0.07;\n  grp.add(topRing);\n\n  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({\n    color, transparent: true, opacity: 0.08,\n  }));\n  grp.add(glow);\n\n  grp.position.set(x, y, z);\n  scene.add(grp);\n  lanterns.push(grp);\n  return grp;\n}\nconst lanternColors = [0xFF6644, 0xFFAA44, 0xFF4488, 0xAA66FF, 0x44CCFF];\nfor (let i = 0; i < 12; i++) {\n  const a = Math.random() * Math.PI * 2;\n  const r = 1.8 + Math.random() * 1.5;\n  const clr = lanternColors[i % lanternColors.length];\n  makeLantern(Math.cos(a) * r, 1.0 + Math.random() * 2.5, Math.sin(a) * r, clr);\n}\n\n// ============================================================\n// 粒子系统 1 — 星光粒子（缓慢上升飘散）\n// ============================================================\nconst starParticleCount = 800;\nconst starGeo = new THREE.BufferGeometry();\nconst starPos = new Float32Array(starParticleCount * 3);\nconst starSizes = new Float32Array(starParticleCount);\nconst starSpeeds = new Float32Array(starParticleCount);\nconst starDrifts = new Float32Array(starParticleCount * 3);\n\nfor (let i = 0; i < starParticleCount; i++) {\n  const a = Math.random() * Math.PI * 2;\n  const r = 0.5 + Math.random() * 5;\n  starPos[i * 3] = Math.cos(a) * r * (0.5 + Math.random() * 0.8);\n  starPos[i * 3 + 1] = Math.random() * 4 + 0.2;\n  starPos[i * 3 + 2] = Math.sin(a) * r * (0.5 + Math.random() * 0.8);\n  starSizes[i] = 0.02 + Math.random() * 0.06;\n  starSpeeds[i] = 0.1 + Math.random() * 0.3;\n  starDrifts[i * 3] = (Math.random() - 0.5) * 0.02;\n  starDrifts[i * 3 + 1] = 0.005 + Math.random() * 0.015;\n  starDrifts[i * 3 + 2] = (Math.random() - 0.5) * 0.02;\n}\nstarGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));\nstarGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));\n\nconst starMatP = new THREE.PointsMaterial({\n  color: 0xCCAAFF, size: 0.04, transparent: true, opacity: 0.8,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst starParticles = new THREE.Points(starGeo, starMatP);\nscene.add(starParticles);\n\n// ============================================================\n// 粒子系统 2 — 仙气/流光粒子（环绕建筑流动）\n// ============================================================\nconst flowCount = 400;\nconst flowGeo = new THREE.BufferGeometry();\nconst flowPos = new Float32Array(flowCount * 3);\nconst flowAngles = new Float32Array(flowCount);\nconst flowHeights = new Float32Array(flowCount);\nconst flowRadii = new Float32Array(flowCount);\nconst flowSpeedsArr = new Float32Array(flowCount);\n\nfor (let i = 0; i < flowCount; i++) {\n  flowAngles[i] = Math.random() * Math.PI * 2;\n  flowRadii[i] = 0.3 + Math.random() * 2.5;\n  flowHeights[i] = Math.random() * 3.5;\n  flowSpeedsArr[i] = 0.2 + Math.random() * 0.5;\n  flowPos[i * 3] = Math.cos(flowAngles[i]) * flowRadii[i];\n  flowPos[i * 3 + 1] = flowHeights[i];\n  flowPos[i * 3 + 2] = Math.sin(flowAngles[i]) * flowRadii[i];\n}\nflowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));\n\nconst flowMatP = new THREE.PointsMaterial({\n  color: 0xFF88CC, size: 0.035, transparent: true, opacity: 0.6,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst flowParticles = new THREE.Points(flowGeo, flowMatP);\nscene.add(flowParticles);\n\n// ============================================================\n// 粒子系统 3 — 飘落的发光花瓣/光羽\n// ============================================================\nconst petalCount = 150;\nconst petalGeo = new THREE.BufferGeometry();\nconst petalPos = new Float32Array(petalCount * 3);\nconst petalVel = new Float32Array(petalCount * 3);\nconst petalSizes = new Float32Array(petalCount);\nconst petalSeed = new Float32Array(petalCount);\n\nfor (let i = 0; i < petalCount; i++) {\n  petalPos[i * 3] = (Math.random() - 0.5) * 10;\n  petalPos[i * 3 + 1] = Math.random() * 6;\n  petalPos[i * 3 + 2] = (Math.random() - 0.5) * 10;\n  petalVel[i * 3] = (Math.random() - 0.5) * 0.008;\n  petalVel[i * 3 + 1] = -0.005 - Math.random() * 0.015;\n  petalVel[i * 3 + 2] = (Math.random() - 0.5) * 0.008;\n  petalSizes[i] = 0.03 + Math.random() * 0.05;\n  petalSeed[i] = Math.random() * Math.PI * 2;\n}\npetalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));\npetalGeo.setAttribute('size', new THREE.BufferAttribute(petalSizes, 1));\n\nconst petalMat = new THREE.PointsMaterial({\n  color: 0xFF99CC, size: 0.05, transparent: true, opacity: 0.5,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst petalParticles = new THREE.Points(petalGeo, petalMat);\nscene.add(petalParticles);\n\n// ============================================================\n// 环绕光晕环（动态旋转的大光环）\n// ============================================================\nconst ringMat = new THREE.MeshBasicMaterial({\n  color: 0x8844FF, transparent: true, opacity: 0.08, side: THREE.DoubleSide,\n});\nconst glowRing = new THREE.Mesh(new THREE.RingGeometry(2.8, 3.0, 64), ringMat);\nglowRing.rotation.x = Math.PI / 2.5;\nglowRing.position.y = 1.2;\nscene.add(glowRing);\n\nconst glowRing2 = new THREE.Mesh(new THREE.RingGeometry(3.8, 3.95, 64), new THREE.MeshBasicMaterial({\n  color: 0xFF66AA, transparent: true, opacity: 0.05, side: THREE.DoubleSide,\n}));\nglowRing2.rotation.x = Math.PI / 2.5 + 0.2;\nglowRing2.position.y = 1.8;\nscene.add(glowRing2);\n\n// ============================================================\n// 动画循环\n// ============================================================\ndocument.getElementById('loading').style.display = 'none';\n\nlet time = 0;\n\nfunction animate() {\n  requestAnimationFrame(animate);\n  time += 0.01;\n\n  controls.update();\n\n  // ---- 粒子1: 星光飘散 ----\n  const sp = starParticles.geometry.attributes.position.array;\n  for (let i = 0; i < starParticleCount; i++) {\n    sp[i * 3] += starDrifts[i * 3];\n    sp[i * 3 + 1] += starDrifts[i * 3 + 1];\n    sp[i * 3 + 2] += starDrifts[i * 3 + 2];\n    // 重置到底部\n    if (sp[i * 3 + 1] > 4.5) {\n      const a = Math.random() * Math.PI * 2;\n      const r = 0.5 + Math.random() * 5;\n      sp[i * 3] = Math.cos(a) * r * (0.5 + Math.random() * 0.8);\n      sp[i * 3 + 1] = 0;\n      sp[i * 3 + 2] = Math.sin(a) * r * (0.5 + Math.random() * 0.8);\n    }\n  }\n  starParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 粒子2: 环绕流光 ----\n  const fp = flowParticles.geometry.attributes.position.array;\n  for (let i = 0; i < flowCount; i++) {\n    flowAngles[i] += flowSpeedsArr[i] * 0.01;\n    fp[i * 3] = Math.cos(flowAngles[i]) * flowRadii[i];\n    fp[i * 3 + 2] = Math.sin(flowAngles[i]) * flowRadii[i];\n    // 轻微上下浮动\n    fp[i * 3 + 1] = flowHeights[i] + Math.sin(time * 0.5 + i) * 0.15;\n  }\n  flowParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 粒子3: 飘落花瓣 ----\n  const pp = petalParticles.geometry.attributes.position.array;\n  for (let i = 0; i < petalCount; i++) {\n    pp[i * 3] += petalVel[i * 3] + Math.sin(time + petalSeed[i]) * 0.002;\n    pp[i * 3 + 1] += petalVel[i * 3 + 1];\n    pp[i * 3 + 2] += petalVel[i * 3 + 2] + Math.cos(time + petalSeed[i]) * 0.002;\n    if (pp[i * 3 + 1] < -0.5) {\n      pp[i * 3] = (Math.random() - 0.5) * 10;\n      pp[i * 3 + 1] = 5 + Math.random() * 1;\n      pp[i * 3 + 2] = (Math.random() - 0.5) * 10;\n    }\n  }\n  petalParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 灯笼旋转 ----\n  lanterns.forEach((l, i) => {\n    l.rotation.y += 0.005 * (i % 2 === 0 ? 1 : -1);\n    l.position.y += Math.sin(time * 0.5 + i * 1.7) * 0.0005;\n  });\n\n  // ---- 光环旋转 ----\n  glowRing.rotation.y += 0.003;\n  glowRing2.rotation.y -= 0.004;\n\n  // ---- 光晕脉冲 ----\n  const pulse = 0.6 + Math.sin(time * 1.5) * 0.4;\n  glowMat.emissiveIntensity = pulse;\n  lanternMat.emissiveIntensity = 1.5 + Math.sin(time * 1.2) * 0.8;\n\n  renderer.render(scene, camera);\n}\nanimate();\n\nwindow.addEventListener('resize', () => {\n  camera.aspect = window.innerWidth / window.innerHeight;\n  camera.updateProjectionMatrix();\n  renderer.setSize(window.innerWidth, window.innerHeight);\n});\n</script>\n</body>\n</html>\n	{"stripLog": false, "stripDOMBox": false, "stripImport": true, "stripControls": false, "stripRenderer": false}	{}	\N	2026-07-26 10:03:37.462323	2026-07-26 10:03:37.462323	html	\N	[{"rule": "legacy_api", "count": 4, "details": [{"api": "/\\\\boutputColorSpace\\\\b/g", "count": 1}, {"api": "/\\\\bcolorSpace\\\\b/g", "count": 1}, {"api": "/\\\\bTHREE\\\\.SRGBColorSpace\\\\b/g", "count": 2}], "description": "老版 Three.js API 桥接 ×4"}, {"rule": "strip_imports", "count": 1, "description": "剥离 import 语句 并自动声明 1 个变量"}]	ok
6	自行车		/* 自动声明的导入变量（运行器已提供常见类，其余从 THREE 命名空间兜底） */\nvar RectAreaLightUniformsLib = (typeof RectAreaLightUniformsLib !== 'undefined') ? RectAreaLightUniformsLib : (THREE.RectAreaLightUniformsLib || function(){});\n\n\n/**\n * BMX "Endurance" bike — hand-authored procedural reconstruction (img2threejs v1.3).\n *\n * Rebuilt in code from a 12-view reference set (3/4 front, side, drivetrain, U-brake,\n * grip, hub/peg, BB welds, saddle, pedal, head-tube decal, wireframe). This replaces the\n * earlier generated "every-part-is-a-cylinder" placeholder with real geometry:\n *   - 5-spoke solid aero MAG wheels (extruded disc + deep-dish barrel + orange rim lip)\n *   - all-black block-tread tyres with orange "TERRAIN MONSTER / SHARP / 2022" sidewall text\n *   - glossy clear-coat orange frame with fish-scale TIG weld beads at the joints\n *   - ribbed orange grips with inner flange, elongated PU-leather saddle\n *   - platform pedals with amber reflectors, 8-arm sunburst orange sprocket + roller chain\n *   - rear U-brake with straddle cable + barrel adjuster, knurled anodized pegs (4)\n *   - "BMX" / "Endurance" frame decals (no head-tube logo)\n *\n * Coordinate frame (root-local, matches the demo camera + drivetrain rig in registry.ts):\n *   +x = rear, -x = front · +y = up · z = axle/width.  Wheel centres: front (-0.62,-0.28),\n *   rear (0.62,-0.28). Bottom-bracket (-0.02,-0.24). Wheels/cranks spin about local z.\n *\n * Action-ready: root.userData.sculptRuntime.nodes exposes frontTire/frontRim/frontHub,\n * rearTire/rearRim/rearHub, crankArmL/crankArmR/chainring, pedalL/pedalR — each a Group\n * centred on its own pivot so the host rig can reparent + rotate it directly.\n */\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n// ---------------------------------------------------------------------------\n// Palette (post-ACES tone-mapping targets, tuned against the reference render)\n// ---------------------------------------------------------------------------\nconst COL = {\n  frame: '#f57c00', // signal orange, glossy clear-coat (rich amber, spec §3)\n  rimLip: '#ff9a1c', // painted orange rim edge\n  gripOrange: '#f98a08',\n  magBlack: '#0c0c0e', // gloss-black mag wheel / sprocket\n  glossBlack: '#161616', // handlebar / stem / seatpost / levers\n  rubber: '#121212', // tyre\n  leather: '#191919', // saddle\n  amber: '#ff8c12', // pedal reflector\n  peg: '#1b1b1d', // anodized black peg\n  chrome: '#c7ccd2', // cable barrel / bolts / seat rails\n  chain: '#3a3a3e', // roller chain\n  pedalBody: '#161618'\n};\n\nconst HAS_DOC = typeof document !== 'undefined';\n\n// ---------------------------------------------------------------------------\n// Canvas-texture helpers (all procedural — no external art)\n// ---------------------------------------------------------------------------\nfunction makeCanvas(w, h) {\n  const canvas = document.createElement('canvas');\n  canvas.width = w;\n  canvas.height = h;\n  return { canvas, ctx: canvas.getContext('2d') };\n}\n\nfunction canvasTexture(\nw,\nh,\ndraw,\nopts = {})\n{\n  if (!HAS_DOC) return null;\n  const { canvas, ctx } = makeCanvas(w, h);\n  draw(ctx, w, h);\n  const tex = new THREE.CanvasTexture(canvas);\n  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;\n  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);\n  tex.anisotropy = opts.aniso ?? 8;\n  tex.encoding = opts.srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;\n  tex.needsUpdate = true;\n  return tex;\n}\n\nfunction roundRect(ctx, x, y, w, h, r) {\n  ctx.beginPath();\n  ctx.moveTo(x + r, y);\n  ctx.arcTo(x + w, y, x + w, y + h, r);\n  ctx.arcTo(x + w, y + h, x, y + h, r);\n  ctx.arcTo(x, y + h, x, y, r);\n  ctx.arcTo(x, y, x + w, y, r);\n  ctx.closePath();\n}\n\n/** Fish-scale TIG weld bead — a bump map of stacked overlapping arcs. */\nfunction weldBumpTexture() {\n  return canvasTexture(256, 64, (ctx, w, h) => {\n    ctx.fillStyle = '#808080';\n    ctx.fillRect(0, 0, w, h);\n    const step = 13;\n    for (let i = -1; i < w / step + 1; i++) {\n      ctx.strokeStyle = '#f2f2f2';\n      ctx.lineWidth = 3;\n      ctx.beginPath();\n      ctx.arc(i * step, h * 0.5, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);\n      ctx.stroke();\n      ctx.strokeStyle = '#4a4a4a';\n      ctx.beginPath();\n      ctx.arc(i * step, h * 0.5 + 2, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);\n      ctx.stroke();\n    }\n  }, { repeat: [1, 1] });\n}\n\n/** Ribbed rubber grip — horizontal ring grooves as a bump map. */\nfunction gripBumpTexture() {\n  return canvasTexture(64, 256, (ctx, w, h) => {\n    const rings = 22;\n    for (let i = 0; i < rings; i++) {\n      const y = i / rings * h;\n      const g = ctx.createLinearGradient(0, y, 0, y + h / rings);\n      g.addColorStop(0, '#3a3a3a');\n      g.addColorStop(0.5, '#ffffff');\n      g.addColorStop(1, '#3a3a3a');\n      ctx.fillStyle = g;\n      ctx.fillRect(0, y, w, h / rings - 1);\n    }\n  }, { repeat: [1, 1] });\n}\n\n/** Diamond knurl for pegs — a fine cross-hatch bump. */\nfunction knurlBumpTexture() {\n  return canvasTexture(128, 128, (ctx, w, h) => {\n    ctx.fillStyle = '#7a7a7a';\n    ctx.fillRect(0, 0, w, h);\n    ctx.strokeStyle = '#e8e8e8';\n    ctx.lineWidth = 1.4;\n    const s = 9;\n    for (let i = -w; i < w; i += s) {\n      ctx.beginPath();ctx.moveTo(i, 0);ctx.lineTo(i + h, h);ctx.stroke();\n      ctx.beginPath();ctx.moveTo(i + h, 0);ctx.lineTo(i, h);ctx.stroke();\n    }\n  }, { repeat: [6, 3] });\n}\n\n/** PU-leather grain — soft mottled bump for the saddle (deterministic noise). */\nfunction leatherBumpTexture() {\n  let seed = 1337;\n  const rnd = () => {seed = seed * 16807 % 2147483647;return seed / 2147483647;};\n  return canvasTexture(256, 256, (ctx, w, h) => {\n    ctx.fillStyle = '#8a8a8a';\n    ctx.fillRect(0, 0, w, h);\n    for (let i = 0; i < 2600; i++) {\n      const x = rnd() * w;\n      const y = rnd() * h;\n      const r = 1 + rnd() * 2.5;\n      const c = 90 + Math.floor(rnd() * 90);\n      ctx.fillStyle = `rgb(${c},${c},${c})`;\n      ctx.beginPath();\n      ctx.arc(x, y, r, 0, Math.PI * 2);\n      ctx.fill();\n    }\n  }, { repeat: [3, 2] });\n}\n\n/** Prismatic reflector — small diamond cells for the amber pedal reflector. */\nfunction reflectorBumpTexture() {\n  return canvasTexture(128, 128, (ctx, w, h) => {\n    ctx.fillStyle = '#808080';\n    ctx.fillRect(0, 0, w, h);\n    const s = 16;\n    for (let x = 0; x < w; x += s) {\n      for (let y = 0; y < h; y += s) {\n        const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.7);\n        g.addColorStop(0, '#ffffff');\n        g.addColorStop(1, '#2a2a2a');\n        ctx.fillStyle = g;\n        ctx.fillRect(x, y, s - 1, s - 1);\n      }\n    }\n  }, { repeat: [3, 1] });\n}\n\n/**\n * Tyre wrap: colour + bump for a TorusGeometry. Cross-section (v, vertical here)\n * runs around the tube: mid-band = crown (block tread), quarter-bands = sidewalls\n * (orange text + bead line). u (horizontal) runs around the wheel.\n */\nfunction tyreTextures() {\n  const W = 2048;\n  const H = 512;\n  const map = canvasTexture(W, H, (ctx, w, h) => {\n    ctx.fillStyle = COL.rubber; // all-black rubber; orange lives only on the rim lip\n    ctx.fillRect(0, 0, w, h);\n    // Sidewall lettering. LOWER sidewall (near the bead) = large repeated "SHARP";\n    // UPPER sidewall (near the tread shoulder) = small "TERRAIN MONSTER" + "2022".\n    // The two faces are vertically mirrored so each reads upright on its outward side.\n    ctx.fillStyle = '#f2a01c';\n    ctx.textBaseline = 'middle';\n    ctx.textAlign = 'left';\n    for (const [y, flip] of [[h * 0.13, 1], [h * 0.87, -1]]) {\n      ctx.font = `bold ${Math.round(h * 0.11)}px Arial, sans-serif`;\n      for (let i = 0; i < 4; i++) {\n        ctx.save();\n        ctx.translate(i / 4 * w + w * 0.03, y);\n        if (flip < 0) ctx.scale(1, -1);\n        ctx.fillText('SHARP', 0, 0);\n        ctx.restore();\n      }\n    }\n    const small = ['TERRAIN MONSTER', '2022'];\n    for (const [y, flip] of [[h * 0.29, 1], [h * 0.71, -1]]) {\n      ctx.font = `bold ${Math.round(h * 0.045)}px Arial, sans-serif`;\n      for (let i = 0; i < 6; i++) {\n        ctx.save();\n        ctx.translate(i / 6 * w + w * 0.02, y);\n        if (flip < 0) ctx.scale(1, -1);\n        ctx.fillText(small[i % 2], 0, 0);\n        ctx.restore();\n      }\n    }\n  }, { repeat: [-1, 1], srgb: true }); // negative U flips the sidewall text to read correctly\n\n  const bump = canvasTexture(W, H, (ctx, w, h) => {\n    ctx.fillStyle = '#2a2a2a'; // deep grooves between knobs\n    ctx.fillRect(0, 0, w, h);\n    // crown block tread: fine, closely-spaced knobs (v 0.28..0.72)\n    const rows = 3;\n    const cols = 52;\n    const bw = w / cols;\n    const crownTop = h * 0.28;\n    const crownH = h * 0.44;\n    for (let r = 0; r < rows; r++) {\n      for (let c = 0; c < cols; c++) {\n        const x = c * bw + r % 2 * bw * 0.5;\n        const y = crownTop + r / rows * crownH;\n        // raised knob with a bright top and mid-grey shoulder for a beveled block\n        ctx.fillStyle = '#6a6a6a';\n        roundRect(ctx, x + bw * 0.08, y + crownH * 0.03, bw * 0.84, crownH / rows * 0.9, 6);\n        ctx.fill();\n        ctx.fillStyle = '#ffffff';\n        roundRect(ctx, x + bw * 0.2, y + crownH * 0.08, bw * 0.6, crownH / rows * 0.7, 4);\n        ctx.fill();\n      }\n    }\n    // side lug rows just outboard of the crown\n    ctx.fillStyle = '#c8c8c8';\n    for (const yb of [h * 0.24, h * 0.76]) {\n      for (let c = 0; c < cols; c++) {\n        const x = c * bw + c % 2 * bw * 0.4;\n        roundRect(ctx, x + bw * 0.15, yb, bw * 0.5, h * 0.04, 3);\n        ctx.fill();\n      }\n    }\n  }, { repeat: [1, 1] });\n\n  return { map, bump };\n}\n\n/** Transparent decal canvas → texture (sRGB). Drawn upright; the caller orients the\n *  quad along the tube's reading direction so the text stays right-way-up. */\nfunction decalTexture(\nw,\nh,\ndraw)\n{\n  return canvasTexture(w, h, (ctx, cw, ch) => {\n    ctx.clearRect(0, 0, cw, ch);\n    draw(ctx, cw, ch);\n  }, { repeat: [1, 1], srgb: true });\n}\n\n// ---------------------------------------------------------------------------\n// Materials — PBR per the supplied specification\n// ---------------------------------------------------------------------------\nfunction buildMaterials() {\n  const env = 1.0;\n  const frame = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.frame),\n    roughness: 0.15, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: env * 1.1\n  });\n\n  const weld = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.frame),\n    roughness: 0.38, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.28,\n    bumpMap: weldBumpTexture(), bumpScale: 3.0, envMapIntensity: env\n  });\n\n  const magBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.magBlack),\n    roughness: 0.1, metalness: 0.9, clearcoat: 0.9, clearcoatRoughness: 0.05, envMapIntensity: env * 1.3\n  });\n\n  const rimOrange = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.rimLip),\n    roughness: 0.22, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: env\n  });\n\n  const glossBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.glossBlack),\n    roughness: 0.3, metalness: 0.65, clearcoat: 0.45, clearcoatRoughness: 0.15, envMapIntensity: env\n  });\n\n  const tyreTex = tyreTextures();\n  const tyre = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color('#ffffff'), map: tyreTex.map, bumpMap: tyreTex.bump, bumpScale: 5.0,\n    roughness: 0.85, metalness: 0.0, envMapIntensity: env * 0.45\n  });\n  if (!tyreTex.map) tyre.color.set(COL.rubber);\n\n  const grip = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.gripOrange),\n    roughness: 0.85, metalness: 0.0, bumpMap: gripBumpTexture(), bumpScale: 1.1, envMapIntensity: env * 0.7\n  });\n\n  const leather = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.leather),\n    roughness: 0.62, metalness: 0.0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#2a2a2a'),\n    bumpMap: leatherBumpTexture(), bumpScale: 0.6, envMapIntensity: env * 0.8\n  });\n\n  const amber = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.amber),\n    roughness: 0.18, metalness: 0.0, transmission: 0.28, ior: 1.5, thickness: 0.02, clearcoat: 0.6,\n    emissive: new THREE.Color(COL.amber), emissiveIntensity: 0.12,\n    bumpMap: reflectorBumpTexture(), bumpScale: 1.2, envMapIntensity: env\n  });\n\n  const peg = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.peg),\n    roughness: 0.55, metalness: 0.7, bumpMap: knurlBumpTexture(), bumpScale: 0.8, envMapIntensity: env\n  });\n\n  const chrome = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.chrome), roughness: 0.22, metalness: 1.0, envMapIntensity: env * 1.2\n  });\n\n  const chain = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.chain), roughness: 0.5, metalness: 0.9, envMapIntensity: env\n  });\n\n  const pedalBody = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.pedalBody), roughness: 0.5, metalness: 0.35, envMapIntensity: env\n  });\n\n  // smooth matte black (front peg) — no knurl, low sheen\n  const matteBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color('#141416'), roughness: 0.7, metalness: 0.2, clearcoat: 0.1, envMapIntensity: env * 0.6\n  });\n\n  return { frame, weld, magBlack, rimOrange, glossBlack, tyre, grip, leather, amber, peg, chrome, chain, pedalBody, matteBlack };\n}\n\n// ---------------------------------------------------------------------------\n// Geometry helpers\n// ---------------------------------------------------------------------------\nconst UP = new THREE.Vector3(0, 1, 0);\n\nfunction v(x, y, z = 0) {\n  return new THREE.Vector3(x, y, z);\n}\n\n/** A cylinder spanning a→b (local points), radius r1 at a, r2 at b. */\nfunction tube(\na,\nb,\nr1,\nr2,\nmat,\nradial = 20)\n{\n  const dir = new THREE.Vector3().subVectors(b, a);\n  const len = dir.length();\n  const geo = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false);\n  const mesh = new THREE.Mesh(geo, mat);\n  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());\n  mesh.position.copy(a).addScaledVector(dir, 0.5);\n  return mesh;\n}\n\n/** A smooth cable/hose swept along a Catmull-Rom (bezier-like) curve through `pts`. */\nfunction cable(pts, r, mat, seg = 40) {\n  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);\n  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8, false), mat);\n}\n\n/** Weld bead ring wrapping a tube of radius `tubeR` at `at`, with `dir` = tube axis. */\nfunction weldRing(at, dir, tubeR, mat) {\n  const geo = new THREE.TorusGeometry(tubeR * 1.06, tubeR * 0.26, 10, 32);\n  const mesh = new THREE.Mesh(geo, mat);\n  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());\n  mesh.position.copy(at);\n  return mesh;\n}\n\nfunction applyShadow(obj, opts) {\n  obj.traverse((o) => {\n    const m = o;\n    if (m.isMesh) {\n      m.castShadow = opts.castShadow ?? true;\n      m.receiveShadow = opts.receiveShadow ?? true;\n      if (opts.wireframe) {\n        const mat = m.material;\n        if (mat && 'wireframe' in mat) mat.wireframe = true;\n      }\n    }\n  });\n}\n\n// ---------------------------------------------------------------------------\n// Wheel — OPEN 5-spoke MAG (slim spokes with see-through gaps)\n// ---------------------------------------------------------------------------\nconst TIRE_MAJOR = 0.32; // tyre centreline radius\nconst TIRE_TUBE = 0.05; // tyre cross-section radius → outer 0.37, inner bead ≈ 0.27\nconst WHEEL_WIDTH = 0.085; // hub / peg reference width\n\nconst HUB_R = 0.055;\nconst SPOKE_IN = 0.05;\nconst SPOKE_OUT = 0.244;\nconst RIM_RING_R = 0.244; // black structural rim the spokes meet (inboard of the lip)\nconst LIP_R = 0.268; // orange rim lip ring, sits at the tyre bead just outboard of the ring\nconst MAG_DEPTH = 0.03; // slim spoke / face thickness\n\n/**\n * Open 5-spoke mag face: centre hub + 5 slim beveled spokes + a black rim ring, plus\n * the thin orange rim lip. The gaps between spokes are true voids — you can see through\n * to the far side of the wheel; there is NO solid disc.\n */\nfunction magFace(mats) {\n  const g = new THREE.Group();\n\n  const hub = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, MAG_DEPTH * 1.5, 28), mats.magBlack);\n  hub.rotation.x = Math.PI / 2;\n  g.add(hub);\n\n  // five slim aero spokes — wider at the hub, tapering to the rim, beveled edges\n  for (let i = 0; i < 5; i++) {\n    const shape = new THREE.Shape();\n    const wB = 0.05; // width at hub\n    const wT = 0.03; // width at rim\n    shape.moveTo(-wB / 2, SPOKE_IN);\n    shape.lineTo(wB / 2, SPOKE_IN);\n    shape.lineTo(wT / 2, SPOKE_OUT);\n    shape.lineTo(-wT / 2, SPOKE_OUT);\n    shape.closePath();\n    const geo = new THREE.ExtrudeGeometry(shape, {\n      depth: MAG_DEPTH, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, steps: 1\n    });\n    geo.translate(0, 0, -MAG_DEPTH / 2);\n    const spoke = new THREE.Mesh(geo, mats.magBlack);\n    spoke.rotation.z = i / 5 * Math.PI * 2;\n    g.add(spoke);\n  }\n\n  // black structural rim ring the spoke tips meet (kept inboard of the orange lip)\n  const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_RING_R, 0.013, 18, 96), mats.magBlack);\n  g.add(ring);\n\n  // ORANGE rim lip — glossy burnt-orange painted edge sitting just OUTSIDE the black\n  // ring, at the boundary with the tyre bead (visible band ≈ LIP_R−0.013 … tyre inner)\n  const lip = new THREE.Mesh(new THREE.TorusGeometry(LIP_R, 0.013, 16, 110), mats.rimOrange);\n  g.add(lip);\n\n  return g;\n}\n\n/** Wheel parts returned as three sibling groups (each centred at local origin). */\nfunction buildWheel(mats)\n\n{\n  // rim group = the open mag face (spokes + rim ring + orange lip). No solid disc.\n  const rim = magFace(mats);\n\n  // tyre — all-black rubber torus (decals live in the material's map)\n  const tire = new THREE.Group();\n  tire.add(new THREE.Mesh(new THREE.TorusGeometry(TIRE_MAJOR, TIRE_TUBE, 30, 140), mats.tyre));\n\n  // hub — compact all-black shell (no bright chrome caps)\n  const hub = new THREE.Group();\n  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, WHEEL_WIDTH, 24), mats.magBlack);\n  shell.rotation.x = Math.PI / 2;\n  hub.add(shell);\n  for (const zside of [-1, 1]) {\n    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.01, 16), mats.magBlack);\n    cap.rotation.x = Math.PI / 2;\n    cap.position.z = zside * WHEEL_WIDTH * 0.5;\n    hub.add(cap);\n  }\n\n  return { tire, rim, hub };\n}\n\n// ---------------------------------------------------------------------------\n// Small parts\n// ---------------------------------------------------------------------------\nfunction buildGrip(mats) {\n  // built with the grip axis along local x; positioned/oriented by the caller\n  const g = new THREE.Group();\n  const L = 0.115;\n  const r = 0.026;\n  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 24), mats.grip);\n  body.rotation.z = Math.PI / 2;\n  g.add(body);\n  const flange = new THREE.Mesh(new THREE.TorusGeometry(r + 0.006, 0.006, 8, 24), mats.grip);\n  flange.rotation.y = Math.PI / 2;\n  flange.position.x = -L / 2 + 0.006;\n  g.add(flange);\n  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.glossBlack);\n  cap.rotation.z = -Math.PI / 2;\n  cap.position.x = L / 2;\n  g.add(cap);\n  return g;\n}\n\nfunction buildSaddle(mats) {\n  // Railed BMX seat: pointed, slightly upturned nose (−x = front) · scooped middle ·\n  // fat rounded tail · puffy cushion. Long axis = local x (caller keeps it ~horizontal).\n  const g = new THREE.Group();\n  // Proportions from NotebookLM research (BMX/jump saddles ≈ 235mm long × 127mm rear\n  // width → shorter than road saddles, ~1.9:1 length:width, nose clearly narrower).\n  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 56, 34), mats.leather);\n  shell.scale.set(0.32, 0.1, 0.15); // length · cushion thickness · rear width\n  const pos = shell.geometry.attributes.position;\n  for (let i = 0; i < pos.count; i++) {\n    const x = pos.getX(i);\n    const y = pos.getY(i);\n    const z = pos.getZ(i);\n    const t = THREE.MathUtils.clamp(x / 0.5, -1, 1); // nose −1 … tail +1\n    // width: narrow pointed nose → full rounded tail\n    const wf = 0.4 + 0.6 * THREE.MathUtils.smoothstep((t + 1) / 2, 0, 1);\n    pos.setZ(i, z * wf);\n    // Longitudinal profile (BMX railed/pivotal seat, per web research): a gentle upward\n    // sweep — the middle sits slightly low, the NOSE kicks up (waterfall) and the TAIL\n    // rises into a rounded rear bumper, so the top line arcs upward toward both ends.\n    // Research: BMX seats sit nose-up with a longitudinal dip + raised rear. Make the\n    // top line clearly sweep UP toward both ends (bigger tail bumper, upturned nose).\n    const scoop = -0.022 * (1 - t * t); // seating dip\n    const tail = 0.09 * Math.pow(Math.max(0, t), 1.3); // raised rounded rear bumper\n    const nose = 0.07 * Math.pow(Math.max(0, -t), 1.4); // upturned nose (waterfall)\n    const domeTop = y > 0 ? 0.01 * (1 - t * t) : 0; // slight cushion crown\n    pos.setY(i, y + scoop + tail + nose + domeTop);\n  }\n  pos.needsUpdate = true;\n  shell.geometry.computeVertexNormals();\n  g.add(shell);\n  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.045), mats.glossBlack);\n  clamp.position.y = -0.05;\n  g.add(clamp);\n  for (const zside of [-1, 1]) {\n    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 8), mats.chrome);\n    rail.rotation.z = Math.PI / 2;\n    rail.position.set(0, -0.045, zside * 0.025);\n    g.add(rail);\n  }\n  return g;\n}\n\nfunction buildPedal(mats) {\n  const g = new THREE.Group();\n  // spindle runs inboard to meet the crank arm (pedal sits outboard at z≈0.155)\n  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 12), mats.chrome);\n  spindle.rotation.x = Math.PI / 2;\n  spindle.position.z = -0.02;\n  g.add(spindle);\n  const plat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.075), mats.pedalBody);\n  plat.position.z = 0.05;\n  g.add(plat);\n  for (let ix = 0; ix < 4; ix++) {\n    for (const yside of [-1, 1]) {\n      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.07), mats.pedalBody);\n      pin.position.set(-0.04 + ix * 0.026, yside * 0.014, 0.05);\n      g.add(pin);\n    }\n  }\n  for (const xside of [-1, 1]) {\n    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.05), mats.amber);\n    refl.position.set(xside * 0.056, 0, 0.05);\n    g.add(refl);\n  }\n  return g;\n}\n\n/** 8-arm sunburst orange sprocket (chainring), in XY plane, axle z. */\nfunction buildSprocket(mats) {\n  const g = new THREE.Group();\n  const R = 0.11;\n  const shape = new THREE.Shape();\n  const teeth = 34;\n  for (let i = 0; i <= teeth; i++) {\n    const a = i / teeth * Math.PI * 2;\n    const rr = R + (i % 2 === 0 ? 0.006 : 0.0);\n    const x = Math.cos(a) * rr;\n    const y = Math.sin(a) * rr;\n    if (i === 0) shape.moveTo(x, y);else shape.lineTo(x, y);\n  }\n  const arms = 8;\n  for (let i = 0; i < arms; i++) {\n    const a = i / arms * Math.PI * 2 + Math.PI / arms;\n    const hole = new THREE.Path();\n    const ri = 0.028;\n    const ro = R - 0.02;\n    const aw = 0.22;\n    hole.moveTo(Math.cos(a - aw * 0.4) * ri, Math.sin(a - aw * 0.4) * ri);\n    for (let s = 0; s <= 8; s++) {\n      const t = -aw + 2 * aw * s / 8;\n      hole.lineTo(Math.cos(a + t) * ro, Math.sin(a + t) * ro);\n    }\n    hole.lineTo(Math.cos(a + aw * 0.4) * ri, Math.sin(a + aw * 0.4) * ri);\n    hole.closePath();\n    shape.holes.push(hole);\n  }\n  const geo = new THREE.ExtrudeGeometry(shape, {\n    depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8\n  });\n  geo.center();\n  g.add(new THREE.Mesh(geo, mats.rimOrange));\n  // central spider boss so the ring reads as mounted, not a floating plate\n  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 20), mats.magBlack);\n  boss.rotation.x = Math.PI / 2;\n  g.add(boss);\n  return g;\n}\n\n/**\n * Roller chain as an array of alternating link plates wrapping the chainring + rear cog.\n * Path = upper external run → wrap the rear (+x) of the cog → lower run → wrap the front\n * (−x) of the chainring. Links are placed tangent to the path (not two flat strips).\n */\nfunction buildChain(\nc1, r1, // chainring\nc2, r2, // rear cog\nz,\nmats)\n{\n  const g = new THREE.Group();\n  const pts = [];\n  const arc = (c, r, a0, a1, n) => {\n    for (let i = 0; i <= n; i++) {\n      const a = a0 + (a1 - a0) * i / n;\n      pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));\n    }\n  };\n  // top run start (top of chainring) → top of cog, then wrap cog rear, bottom run, wrap chainring front\n  pts.push(new THREE.Vector2(c1.x, c1.y + r1));\n  pts.push(new THREE.Vector2(c2.x, c2.y + r2));\n  arc(c2, r2, Math.PI / 2, -Math.PI / 2, 10); // around the +x side of the cog\n  pts.push(new THREE.Vector2(c1.x, c1.y - r1));\n  arc(c1, r1, -Math.PI / 2, -Math.PI * 1.5, 16); // around the −x side of the chainring\n\n  // resample at uniform spacing and drop an alternating link at each step\n  const spacing = 0.016;\n  let carry = 0;\n  const linkOuter = new THREE.BoxGeometry(0.022, 0.012, 0.016);\n  const linkInner = new THREE.BoxGeometry(0.02, 0.008, 0.01);\n  let toggle = false;\n  for (let i = 0; i < pts.length - 1; i++) {\n    const a = pts[i];\n    const b = pts[i + 1];\n    const seg = b.clone().sub(a);\n    let segLen = seg.length();\n    const dir = seg.clone().normalize();\n    let t = carry;\n    while (t < segLen) {\n      const p = a.clone().addScaledVector(dir, t);\n      const link = new THREE.Mesh(toggle ? linkInner : linkOuter, mats.chain);\n      link.position.set(p.x, p.y, z);\n      link.rotation.z = Math.atan2(dir.y, dir.x);\n      g.add(link);\n      toggle = !toggle;\n      t += spacing;\n    }\n    carry = t - segLen;\n  }\n  return g;\n}\n\n/** Rear U-brake: two arms hugging the tyre + straddle cable + barrel adjuster. */\nfunction buildUBrake(mats) {\n  const g = new THREE.Group();\n  for (const zside of [-1, 1]) {\n    g.add(tube(v(0, 0, zside * 0.05), v(-0.02, 0.11, zside * 0.03), 0.01, 0.008, mats.glossBlack, 10));\n    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.02), mats.glossBlack);\n    pad.position.set(0, 0, zside * 0.055);\n    g.add(pad);\n    const boltHead = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), mats.chrome);\n    boltHead.rotation.x = Math.PI / 2;\n    boltHead.position.set(-0.02, 0.11, zside * 0.03);\n    g.add(boltHead);\n  }\n  const yoke = v(0, 0.12, 0);\n  g.add(tube(v(-0.02, 0.11, -0.03), yoke, 0.003, 0.003, mats.chrome, 6));\n  g.add(tube(v(-0.02, 0.11, 0.03), yoke, 0.003, 0.003, mats.chrome, 6));\n  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10), mats.chrome);\n  barrel.position.copy(yoke).add(v(0, 0.02, 0));\n  g.add(barrel);\n  // housing hugs forward along the seat stay toward the frame (local −x), not skyward\n  g.add(cable([\n  yoke.clone().add(v(0, 0.03, 0)),\n  v(-0.12, 0.14, 0.01),\n  v(-0.28, 0.11, 0),\n  v(-0.4, 0.08, 0)],\n  0.004, mats.glossBlack));\n  return g;\n}\n\n/** A flat decal quad carrying a transparent canvas texture. */\nfunction decalQuad(tex, w, h, fallbackColor = COL.frame) {\n  const mat = new THREE.MeshPhysicalMaterial({\n    map: tex ?? undefined,\n    color: tex ? new THREE.Color('#ffffff') : new THREE.Color(fallbackColor),\n    transparent: true, roughness: 0.25, clearcoat: 0.6,\n    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.6\n  });\n  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);\n}\n\n// ---------------------------------------------------------------------------\n// Main factory\n// ---------------------------------------------------------------------------\nfunction createBMXEnduranceBikeModel(options = {}) {\n  const root = new THREE.Group();\n  root.name = 'BMX Endurance Bike';\n  const M = buildMaterials();\n\n  const nodes = { root };\n  const meshes = {};\n  const sockets = {};\n  const colliders = {};\n  const destructionGroups = {};\n\n  const addNode = (id, obj, group, parent = root) => {\n    parent.add(obj);\n    nodes[id] = obj;\n    (destructionGroups[group] ??= []).push(obj);\n  };\n\n  // ---- Frame skeleton (joint coordinates) ----\n  // BB, front & rear axles are FIXED (the registry drivetrain rig pivots on them).\n  // Everything else is shaped for a low, stubby BMX freestyle stance.\n  // Front axle pushed forward + rear axle pulled in (~16% shorter rear) for a compact\n  // BMX wheelbase with a clean 3-4cm tyre↔down-tube gap. These MUST match registry.ts.\n  const BB = v(-0.02, -0.24);\n  const seatCluster = v(0.1, 0.04); // short seat tube → low, stubby stance\n  const headTop = v(-0.47, 0.26); // head tube forward/up so the front tyre clears the down tube\n  const headBot = v(-0.51, 0.12);\n  const frontAxle = v(-0.66, -0.28); // pushed forward → ~4cm gap to the down tube\n  const rearAxle = v(0.52, -0.28); // pulled in ~16% → tighter BMX rear end\n  const barBase = v(-0.46, 0.35);\n\n  const frameGroup = new THREE.Group();\n  frameGroup.name = 'frame';\n  root.add(frameGroup);\n  destructionGroups['frame'] = [frameGroup];\n  const addFrame = (mesh) => {frameGroup.add(mesh);};\n\n  addFrame(tube(BB, seatCluster, 0.023, 0.021, M.frame)); // seat tube (short)\n  addFrame(tube(BB, headBot, 0.034, 0.03, M.frame)); // down tube — fattest tube, steep\n  addFrame(tube(seatCluster, headTop, 0.02, 0.019, M.frame)); // top tube — slimmer than down tube\n  // Seat + chain stays bow OUTBOARD around the rear tyre (half-width ≈ 0.05) so they\n  // clear it, then converge to the dropouts. Curved tubes, not straight (which pierced).\n  for (const zs of [-1, 1]) {\n    addFrame(cable([\n    seatCluster.clone().setZ(0.02 * zs),\n    v(0.28, -0.11, 0.092 * zs),\n    rearAxle.clone().setZ(0.066 * zs)],\n    0.011, M.frame)); // seat stay\n    addFrame(cable([\n    BB.clone().setZ(0.045 * zs),\n    v(0.24, -0.3, 0.098 * zs),\n    rearAxle.clone().setZ(0.066 * zs)],\n    0.013, M.frame)); // chain stay\n  }\n  addFrame(tube(headTop, headBot, 0.034, 0.034, M.frame)); // head tube (beefy)\n\n  const bbShell = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 24), M.frame);\n  bbShell.rotation.x = Math.PI / 2;\n  bbShell.position.copy(BB);\n  addFrame(bbShell);\n\n  // Fork (orange): steerer stub + crown + long legs (spread wider than the tyre) + dropouts.\n  const forkCrownPos = v(-0.51, 0.07);\n  addFrame(tube(headBot, forkCrownPos, 0.022, 0.024, M.frame)); // lower steerer into crown\n  const forkCrown = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.14), M.frame);\n  forkCrown.position.copy(forkCrownPos);\n  addFrame(forkCrown);\n  const forkZ = 0.065; // outboard of the tyre half-width (0.05)\n  for (const zs of [-1, 1]) {\n    // long raked leg, tapering down from a thicker crown to a slim dropout\n    addFrame(tube(forkCrownPos.clone().setZ(forkZ * zs), frontAxle.clone().setZ(forkZ * zs), 0.019, 0.009, M.frame));\n    // flat drilled dropout plate around the axle (thin box + hole ring)\n    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.012), M.frame);\n    plate.position.copy(frontAxle).setZ(forkZ * zs);\n    addFrame(plate);\n    const hole = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.006, 8, 16), M.glossBlack);\n    hole.position.copy(frontAxle).setZ(forkZ * zs + 0.007 * zs);\n    addFrame(hole);\n  }\n\n  // ---- TIG weld beads at the joints (fish-scale) ----\n  const welds = new THREE.Group();\n  welds.name = 'welds';\n  root.add(welds);\n  welds.add(weldRing(BB.clone().add(v(0.03, 0.06, 0)), new THREE.Vector3().subVectors(seatCluster, BB), 0.024, M.weld));\n  welds.add(weldRing(BB.clone().add(v(-0.06, 0.03, 0)), new THREE.Vector3().subVectors(headBot, BB), 0.03, M.weld));\n  welds.add(weldRing(headBot.clone().add(v(0.03, 0.02, 0)), new THREE.Vector3().subVectors(BB, headBot), 0.03, M.weld));\n  welds.add(weldRing(headTop.clone().add(v(0.03, -0.02, 0)), new THREE.Vector3().subVectors(seatCluster, headTop), 0.024, M.weld));\n  welds.add(weldRing(seatCluster.clone().add(v(-0.03, -0.02, 0)), new THREE.Vector3().subVectors(headTop, seatCluster), 0.023, M.weld));\n\n  // ---- Seatpost + clamp + saddle: post slammed low, saddle near-horizontal ----\n  const seatTop = v(0.11, 0.12); // very short post, tucked down near the frame\n  addFrame(tube(seatCluster, seatTop, 0.015, 0.015, M.glossBlack));\n  const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 20), M.glossBlack);\n  clamp.rotation.x = Math.PI / 2;\n  clamp.position.set(seatCluster.x, seatCluster.y + 0.02, 0);\n  addFrame(clamp);\n  const saddle = buildSaddle(M); // long axis already along x (nose −x = front)\n  saddle.position.set(0.14, seatTop.y + 0.06, 0);\n  saddle.rotation.z = -0.11; // ~6° nose-up, BMX-standard (research: BMX seats tilt up)\n  addNode('saddle', saddle, 'seat');\n\n  // ---- Cockpit: stem, tall riser bar, crossbar, grips, lever ----\n  addFrame(tube(headTop, barBase, 0.02, 0.02, M.glossBlack)); // steerer riser\n  const stemBlock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), M.glossBlack);\n  stemBlock.position.copy(barBase);\n  addFrame(stemBlock);\n\n  const bx = barBase.x;\n  const by = barBase.y;\n  const bars = new THREE.Group();\n  bars.name = 'handlebar';\n  root.add(bars);\n  bars.add(tube(v(bx, by, -0.12), v(bx, by, 0.12), 0.016, 0.016, M.glossBlack)); // bottom span\n  for (const zs of [-1, 1]) {\n    bars.add(tube(v(bx, by, 0.12 * zs), v(bx + 0.02, by + 0.16, 0.2 * zs), 0.015, 0.015, M.glossBlack)); // uprights\n    bars.add(tube(v(bx + 0.02, by + 0.16, 0.2 * zs), v(bx + 0.03, by + 0.2, 0.28 * zs), 0.015, 0.015, M.glossBlack)); // bend to grip\n  }\n  bars.add(tube(v(bx + 0.015, by + 0.15, -0.19), v(bx + 0.015, by + 0.15, 0.19), 0.013, 0.013, M.glossBlack)); // crossbar\n\n  const gripY = by + 0.2;\n  for (const [id, zs] of [['gripL', -1], ['gripR', 1]]) {\n    const grip = buildGrip(M);\n    grip.position.set(bx + 0.035, gripY, 0.34 * zs);\n    grip.rotation.y = Math.PI / 2; // grip axis → z (outboard)\n    addNode(id, grip, 'cockpit');\n  }\n  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.02), M.glossBlack);\n  lever.position.set(bx + 0.04, gripY - 0.015, 0.26);\n  lever.rotation.z = 0.2;\n  bars.add(lever);\n  // brake cable as a smooth curve from the lever down to the head-tube/frame\n  bars.add(cable([\n  v(bx + 0.06, gripY, 0.25),\n  v(bx + 0.12, by + 0.06, 0.12),\n  v(headTop.x + 0.03, headTop.y + 0.03, 0.04),\n  v(headTop.x + 0.01, headTop.y - 0.06, 0.02)],\n  0.0035, M.glossBlack));\n\n  // ---- Wheels ----\n  const placeWheel = (prefix, center) => {\n    const parts = buildWheel(M);\n    for (const [k, obj] of Object.entries(parts)) {\n      obj.position.copy(center);\n      const id = `${prefix}${k.charAt(0).toUpperCase()}${k.slice(1)}`; // frontTire/frontRim/frontHub\n      addNode(id, obj, 'wheel');\n    }\n  };\n  placeWheel('front', frontAxle);\n  placeWheel('rear', rearAxle);\n\n  // ---- Pegs (4: front + rear, both sides) — static ----\n  const pegs = new THREE.Group();\n  pegs.name = 'pegs';\n  root.add(pegs);\n  // Front axle: ONE slim, smooth matte-black peg (drive side).\n  const frontPeg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 20), M.matteBlack);\n  frontPeg.rotation.x = Math.PI / 2;\n  frontPeg.position.copy(frontAxle).setZ(WHEEL_WIDTH * 0.5 + 0.085);\n  pegs.add(frontPeg);\n  // Rear axle: knurled anodized pegs on both sides.\n  for (const zs of [-1, 1]) {\n    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 20), M.peg);\n    peg.rotation.x = Math.PI / 2;\n    peg.position.copy(rearAxle).setZ(zs * (WHEEL_WIDTH * 0.5 + 0.08));\n    pegs.add(peg);\n  }\n\n  // ---- Drivetrain: BB spindle, bolted cranks, sprocket, pedals, roller chain, cog ----\n  // static BB spindle through the shell — widened so the cranks sit outboard of the\n  // chainstays and the pedals swing free (no frame collision at any crank angle).\n  const CRANK_Z = 0.1;\n  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, CRANK_Z * 2 + 0.04, 16), M.chrome);\n  spindle.rotation.x = Math.PI / 2;\n  spindle.position.set(BB.x, BB.y, 0);\n  addFrame(spindle);\n\n  const crankBolt = (zoff) => {\n    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.014, 12), M.chrome);\n    b.rotation.x = Math.PI / 2;\n    b.position.z = zoff;\n    return b;\n  };\n\n  const crankL = new THREE.Group();\n  crankL.position.set(BB.x, BB.y, CRANK_Z);\n  crankL.add(tube(v(0, 0, 0), v(0, -0.11, 0), 0.016, 0.013, M.glossBlack));\n  crankL.add(crankBolt(0.014)); // nut fixing the arm to the spindle\n  addNode('crankArmL', crankL, 'drivetrain');\n\n  const crankR = new THREE.Group();\n  crankR.position.set(BB.x, BB.y, -CRANK_Z);\n  crankR.add(tube(v(0, 0, 0), v(0, 0.11, 0), 0.016, 0.013, M.glossBlack));\n  crankR.add(crankBolt(-0.014));\n  addNode('crankArmR', crankR, 'drivetrain');\n\n  // sprocket + cog + chain share the SAME z-plane so the chain seats on both\n  const DRIVE_Z = 0.058;\n  const chainring = buildSprocket(M);\n  chainring.position.set(BB.x, BB.y, DRIVE_Z);\n  addNode('chainring', chainring, 'drivetrain');\n\n  const cogR = 0.05;\n  const cog = new THREE.Mesh(new THREE.CylinderGeometry(cogR, cogR, 0.016, 24), M.magBlack);\n  cog.rotation.x = Math.PI / 2;\n  cog.position.set(rearAxle.x, rearAxle.y, DRIVE_Z);\n  root.add(cog);\n\n  const pedalL = buildPedal(M);\n  pedalL.position.set(BB.x, BB.y - 0.11, 0.155); // outboard of the crank + chainstay\n  addNode('pedalL', pedalL, 'drivetrain');\n  const pedalR = buildPedal(M);\n  pedalR.position.set(BB.x, BB.y + 0.11, -0.155);\n  addNode('pedalR', pedalR, 'drivetrain');\n\n  // roller chain — array of alternating links wrapping sprocket teeth + rear cog\n  root.add(buildChain(\n    new THREE.Vector2(BB.x, BB.y), 0.116, // rides on the ~0.11 sprocket teeth\n    new THREE.Vector2(rearAxle.x, rearAxle.y), cogR + 0.006,\n    DRIVE_Z, M\n  ));\n\n  // ---- Rear U-brake (above the rear tyre, mounted on the seat stays) ----\n  const ubrake = buildUBrake(M);\n  ubrake.position.set(rearAxle.x - 0.12, -0.02, 0);\n  root.add(ubrake);\n\n  // ---- Decals: BMX (top tube), Endurance (down tube), lightning (head tube) ----\n  const bmxTex = decalTexture(512, 160, (ctx, _w, h) => {\n    ctx.fillStyle = '#1a1a1a';\n    for (let i = 0; i < 3; i++) ctx.fillRect(10 + i * 20, h * 0.2, 10, h * 0.6);\n    ctx.font = `900 ${Math.round(h * 0.7)}px Arial, sans-serif`;\n    ctx.textBaseline = 'middle';\n    ctx.fillText('BMX', 80, h * 0.5);\n    ctx.fillStyle = '#f39a1b';\n    for (let i = 0; i < 3; i++) {\n      ctx.beginPath();\n      ctx.moveTo(360 + i * 26, h * 0.2);\n      ctx.lineTo(380 + i * 26, h * 0.2);\n      ctx.lineTo(360 + i * 26, h * 0.8);\n      ctx.lineTo(340 + i * 26, h * 0.8);\n      ctx.closePath();\n      ctx.fill();\n    }\n  });\n  const enduranceTex = decalTexture(512, 96, (ctx, _w, h) => {\n    ctx.fillStyle = '#141414';\n    ctx.font = `italic 800 ${Math.round(h * 0.72)}px Georgia, serif`;\n    ctx.textBaseline = 'middle';\n    ctx.fillText('Endurance', 8, h * 0.55);\n  });\n  const decals = new THREE.Group();\n  decals.name = 'decals';\n  root.add(decals);\n  const topMid = seatCluster.clone().lerp(headTop, 0.52);\n  // Reading direction runs front→back (−x → +x = screen left→right) so the text is\n  // upright; using the front-pointing tube direction would spin it ~180°.\n  const topAngle = Math.atan2(seatCluster.y - headTop.y, seatCluster.x - headTop.x);\n  const downMid = BB.clone().lerp(headBot, 0.5);\n  const downAngle = Math.atan2(BB.y - headBot.y, BB.x - headBot.x);\n  // Decals are applied to the drive side (+z, the side the studio camera faces). A\n  // single quad per graphic avoids the far-side mirror bleed-through a thin tube can't\n  // occlude. Text reads left-to-right for a +z-facing viewer. (No head-tube logo.)\n  {\n    const bmx = decalQuad(bmxTex, 0.26, 0.055); // long, fills the top-tube width\n    bmx.position.copy(topMid).setZ(0.021);\n    bmx.rotation.set(0, 0, topAngle);\n    decals.add(bmx);\n\n    const end = decalQuad(enduranceTex, 0.2, 0.04); // bigger, up on the down tube\n    end.position.copy(downMid).setZ(0.036);\n    end.rotation.set(0, 0, downAngle);\n    decals.add(end);\n  }\n\n  applyShadow(root, options);\n\n  root.traverse((o) => {\n    const m = o;\n    if (m.isMesh) meshes[o.name || `mesh_${Object.keys(meshes).length}`] = m;\n  });\n\n  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups };\n  root.userData.actionReadiness = {\n    note: 'root.userData.sculptRuntime.nodes exposes wheels (frontTire/frontRim/frontHub, rear…), crankArmL/R, chainring, pedalL/R for the drivetrain rig.'\n  };\n  return root;\n}\n\n// ---------------------------------------------------------------------------\n// Studio look-dev rig (per the supplied lighting spec)\n// ---------------------------------------------------------------------------\nfunction createBMXEnduranceBikeLookDevLights(\nmode = 'neutral')\n{\n  const lights = new THREE.Group();\n  lights.name = 'BMX Endurance Bike look-dev lights';\n\n  // Key — warm, high right, sharp shadow\n  const key = new THREE.DirectionalLight(0xfff8f0, mode === 'grazing' ? 2.6 : 1.9);\n  key.position.set(5, 8, 5);\n  key.castShadow = true;\n  key.shadow.mapSize.set(2048, 2048);\n  key.shadow.bias = -0.0003;\n  key.shadow.normalBias = 0.02;\n  key.shadow.radius = 6;\n  key.shadow.camera.near = 0.5;\n  key.shadow.camera.far = 30;\n  key.shadow.camera.left = -2.2;\n  key.shadow.camera.right = 2.2;\n  key.shadow.camera.top = 2.2;\n  key.shadow.camera.bottom = -2.2;\n  key.shadow.camera.updateProjectionMatrix();\n  lights.add(key);\n\n  // Fill — warm + soft, front-left; catches bevels without desaturating the orange\n  const fill = new THREE.DirectionalLight(0xffe7cc, 0.45);\n  fill.position.set(-6, 3, 4);\n  lights.add(fill);\n\n  // Rim — behind, separates black parts from the dark stage\n  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 3.0 : 1.9);\n  rim.position.set(0, 6, -6);\n  lights.add(rim);\n\n  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x14161c, 0.3);\n  lights.add(hemi);\n\n  // Softbox panels — large area lights that paint the long, curved specular streaks\n  // the reference shows running down the glossy frame + mag wheels. Kept modest so\n  // they add streaks without flooding the scene and desaturating the orange.\n  RectAreaLightUniformsLib.init();\n  const softTop = new THREE.RectAreaLight(0xffffff, 2.2, 2.4, 0.5);\n  softTop.position.set(0, 2.4, 1.2);\n  softTop.lookAt(0, -0.2, 0);\n  lights.add(softTop);\n\n  const softSide = new THREE.RectAreaLight(0xfff2df, 1.5, 0.5, 2.0);\n  softSide.position.set(1.6, 0.4, 2.2);\n  softSide.lookAt(0, -0.1, 0);\n  lights.add(softSide);\n\n  lights.userData.reviewMode = mode;\n  return lights;\n}\nvar __export_entries = ["createBMXEnduranceBikeModel","createBMXEnduranceBikeLookDevLights"];	import * as THREE from 'three';\nimport { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';\n\n/**\n * BMX "Endurance" bike — hand-authored procedural reconstruction (img2threejs v1.3).\n *\n * Rebuilt in code from a 12-view reference set (3/4 front, side, drivetrain, U-brake,\n * grip, hub/peg, BB welds, saddle, pedal, head-tube decal, wireframe). This replaces the\n * earlier generated "every-part-is-a-cylinder" placeholder with real geometry:\n *   - 5-spoke solid aero MAG wheels (extruded disc + deep-dish barrel + orange rim lip)\n *   - all-black block-tread tyres with orange "TERRAIN MONSTER / SHARP / 2022" sidewall text\n *   - glossy clear-coat orange frame with fish-scale TIG weld beads at the joints\n *   - ribbed orange grips with inner flange, elongated PU-leather saddle\n *   - platform pedals with amber reflectors, 8-arm sunburst orange sprocket + roller chain\n *   - rear U-brake with straddle cable + barrel adjuster, knurled anodized pegs (4)\n *   - "BMX" / "Endurance" frame decals (no head-tube logo)\n *\n * Coordinate frame (root-local, matches the demo camera + drivetrain rig in registry.ts):\n *   +x = rear, -x = front · +y = up · z = axle/width.  Wheel centres: front (-0.62,-0.28),\n *   rear (0.62,-0.28). Bottom-bracket (-0.02,-0.24). Wheels/cranks spin about local z.\n *\n * Action-ready: root.userData.sculptRuntime.nodes exposes frontTire/frontRim/frontHub,\n * rearTire/rearRim/rearHub, crankArmL/crankArmR/chainring, pedalL/pedalR — each a Group\n * centred on its own pivot so the host rig can reparent + rotate it directly.\n */\n\nexport type ProceduralModelOptions = {\n  castShadow?: boolean;\n  receiveShadow?: boolean;\n  wireframe?: boolean;\n};\n\nexport type ProceduralModelRuntime = {\n  nodes: Record<string, THREE.Object3D>;\n  meshes: Record<string, THREE.Mesh>;\n  sockets: Record<string, THREE.Object3D>;\n  colliders: Record<string, unknown>;\n  destructionGroups: Record<string, THREE.Object3D[]>;\n};\n\n// ---------------------------------------------------------------------------\n// Palette (post-ACES tone-mapping targets, tuned against the reference render)\n// ---------------------------------------------------------------------------\nconst COL = {\n  frame: '#f57c00', // signal orange, glossy clear-coat (rich amber, spec §3)\n  rimLip: '#ff9a1c', // painted orange rim edge\n  gripOrange: '#f98a08',\n  magBlack: '#0c0c0e', // gloss-black mag wheel / sprocket\n  glossBlack: '#161616', // handlebar / stem / seatpost / levers\n  rubber: '#121212', // tyre\n  leather: '#191919', // saddle\n  amber: '#ff8c12', // pedal reflector\n  peg: '#1b1b1d', // anodized black peg\n  chrome: '#c7ccd2', // cable barrel / bolts / seat rails\n  chain: '#3a3a3e', // roller chain\n  pedalBody: '#161618',\n} as const;\n\nconst HAS_DOC = typeof document !== 'undefined';\n\n// ---------------------------------------------------------------------------\n// Canvas-texture helpers (all procedural — no external art)\n// ---------------------------------------------------------------------------\nfunction makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {\n  const canvas = document.createElement('canvas');\n  canvas.width = w;\n  canvas.height = h;\n  return { canvas, ctx: canvas.getContext('2d')! };\n}\n\nfunction canvasTexture(\n  w: number,\n  h: number,\n  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,\n  opts: { repeat?: [number, number]; srgb?: boolean; aniso?: number } = {},\n): THREE.CanvasTexture | null {\n  if (!HAS_DOC) return null;\n  const { canvas, ctx } = makeCanvas(w, h);\n  draw(ctx, w, h);\n  const tex = new THREE.CanvasTexture(canvas);\n  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;\n  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);\n  tex.anisotropy = opts.aniso ?? 8;\n  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;\n  tex.needsUpdate = true;\n  return tex;\n}\n\nfunction roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {\n  ctx.beginPath();\n  ctx.moveTo(x + r, y);\n  ctx.arcTo(x + w, y, x + w, y + h, r);\n  ctx.arcTo(x + w, y + h, x, y + h, r);\n  ctx.arcTo(x, y + h, x, y, r);\n  ctx.arcTo(x, y, x + w, y, r);\n  ctx.closePath();\n}\n\n/** Fish-scale TIG weld bead — a bump map of stacked overlapping arcs. */\nfunction weldBumpTexture(): THREE.CanvasTexture | null {\n  return canvasTexture(256, 64, (ctx, w, h) => {\n    ctx.fillStyle = '#808080';\n    ctx.fillRect(0, 0, w, h);\n    const step = 13;\n    for (let i = -1; i < w / step + 1; i++) {\n      ctx.strokeStyle = '#f2f2f2';\n      ctx.lineWidth = 3;\n      ctx.beginPath();\n      ctx.arc(i * step, h * 0.5, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);\n      ctx.stroke();\n      ctx.strokeStyle = '#4a4a4a';\n      ctx.beginPath();\n      ctx.arc(i * step, h * 0.5 + 2, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);\n      ctx.stroke();\n    }\n  }, { repeat: [1, 1] });\n}\n\n/** Ribbed rubber grip — horizontal ring grooves as a bump map. */\nfunction gripBumpTexture(): THREE.CanvasTexture | null {\n  return canvasTexture(64, 256, (ctx, w, h) => {\n    const rings = 22;\n    for (let i = 0; i < rings; i++) {\n      const y = (i / rings) * h;\n      const g = ctx.createLinearGradient(0, y, 0, y + h / rings);\n      g.addColorStop(0, '#3a3a3a');\n      g.addColorStop(0.5, '#ffffff');\n      g.addColorStop(1, '#3a3a3a');\n      ctx.fillStyle = g;\n      ctx.fillRect(0, y, w, h / rings - 1);\n    }\n  }, { repeat: [1, 1] });\n}\n\n/** Diamond knurl for pegs — a fine cross-hatch bump. */\nfunction knurlBumpTexture(): THREE.CanvasTexture | null {\n  return canvasTexture(128, 128, (ctx, w, h) => {\n    ctx.fillStyle = '#7a7a7a';\n    ctx.fillRect(0, 0, w, h);\n    ctx.strokeStyle = '#e8e8e8';\n    ctx.lineWidth = 1.4;\n    const s = 9;\n    for (let i = -w; i < w; i += s) {\n      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();\n      ctx.beginPath(); ctx.moveTo(i + h, 0); ctx.lineTo(i, h); ctx.stroke();\n    }\n  }, { repeat: [6, 3] });\n}\n\n/** PU-leather grain — soft mottled bump for the saddle (deterministic noise). */\nfunction leatherBumpTexture(): THREE.CanvasTexture | null {\n  let seed = 1337;\n  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };\n  return canvasTexture(256, 256, (ctx, w, h) => {\n    ctx.fillStyle = '#8a8a8a';\n    ctx.fillRect(0, 0, w, h);\n    for (let i = 0; i < 2600; i++) {\n      const x = rnd() * w;\n      const y = rnd() * h;\n      const r = 1 + rnd() * 2.5;\n      const c = 90 + Math.floor(rnd() * 90);\n      ctx.fillStyle = `rgb(${c},${c},${c})`;\n      ctx.beginPath();\n      ctx.arc(x, y, r, 0, Math.PI * 2);\n      ctx.fill();\n    }\n  }, { repeat: [3, 2] });\n}\n\n/** Prismatic reflector — small diamond cells for the amber pedal reflector. */\nfunction reflectorBumpTexture(): THREE.CanvasTexture | null {\n  return canvasTexture(128, 128, (ctx, w, h) => {\n    ctx.fillStyle = '#808080';\n    ctx.fillRect(0, 0, w, h);\n    const s = 16;\n    for (let x = 0; x < w; x += s) {\n      for (let y = 0; y < h; y += s) {\n        const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.7);\n        g.addColorStop(0, '#ffffff');\n        g.addColorStop(1, '#2a2a2a');\n        ctx.fillStyle = g;\n        ctx.fillRect(x, y, s - 1, s - 1);\n      }\n    }\n  }, { repeat: [3, 1] });\n}\n\n/**\n * Tyre wrap: colour + bump for a TorusGeometry. Cross-section (v, vertical here)\n * runs around the tube: mid-band = crown (block tread), quarter-bands = sidewalls\n * (orange text + bead line). u (horizontal) runs around the wheel.\n */\nfunction tyreTextures(): { map: THREE.CanvasTexture | null; bump: THREE.CanvasTexture | null } {\n  const W = 2048;\n  const H = 512;\n  const map = canvasTexture(W, H, (ctx, w, h) => {\n    ctx.fillStyle = COL.rubber; // all-black rubber; orange lives only on the rim lip\n    ctx.fillRect(0, 0, w, h);\n    // Sidewall lettering. LOWER sidewall (near the bead) = large repeated "SHARP";\n    // UPPER sidewall (near the tread shoulder) = small "TERRAIN MONSTER" + "2022".\n    // The two faces are vertically mirrored so each reads upright on its outward side.\n    ctx.fillStyle = '#f2a01c';\n    ctx.textBaseline = 'middle';\n    ctx.textAlign = 'left';\n    for (const [y, flip] of [[h * 0.13, 1], [h * 0.87, -1]]) {\n      ctx.font = `bold ${Math.round(h * 0.11)}px Arial, sans-serif`;\n      for (let i = 0; i < 4; i++) {\n        ctx.save();\n        ctx.translate((i / 4) * w + w * 0.03, y);\n        if (flip < 0) ctx.scale(1, -1);\n        ctx.fillText('SHARP', 0, 0);\n        ctx.restore();\n      }\n    }\n    const small = ['TERRAIN MONSTER', '2022'];\n    for (const [y, flip] of [[h * 0.29, 1], [h * 0.71, -1]]) {\n      ctx.font = `bold ${Math.round(h * 0.045)}px Arial, sans-serif`;\n      for (let i = 0; i < 6; i++) {\n        ctx.save();\n        ctx.translate((i / 6) * w + w * 0.02, y);\n        if (flip < 0) ctx.scale(1, -1);\n        ctx.fillText(small[i % 2], 0, 0);\n        ctx.restore();\n      }\n    }\n  }, { repeat: [-1, 1], srgb: true }); // negative U flips the sidewall text to read correctly\n\n  const bump = canvasTexture(W, H, (ctx, w, h) => {\n    ctx.fillStyle = '#2a2a2a'; // deep grooves between knobs\n    ctx.fillRect(0, 0, w, h);\n    // crown block tread: fine, closely-spaced knobs (v 0.28..0.72)\n    const rows = 3;\n    const cols = 52;\n    const bw = w / cols;\n    const crownTop = h * 0.28;\n    const crownH = h * 0.44;\n    for (let r = 0; r < rows; r++) {\n      for (let c = 0; c < cols; c++) {\n        const x = c * bw + (r % 2) * bw * 0.5;\n        const y = crownTop + (r / rows) * crownH;\n        // raised knob with a bright top and mid-grey shoulder for a beveled block\n        ctx.fillStyle = '#6a6a6a';\n        roundRect(ctx, x + bw * 0.08, y + crownH * 0.03, bw * 0.84, (crownH / rows) * 0.9, 6);\n        ctx.fill();\n        ctx.fillStyle = '#ffffff';\n        roundRect(ctx, x + bw * 0.2, y + crownH * 0.08, bw * 0.6, (crownH / rows) * 0.7, 4);\n        ctx.fill();\n      }\n    }\n    // side lug rows just outboard of the crown\n    ctx.fillStyle = '#c8c8c8';\n    for (const yb of [h * 0.24, h * 0.76]) {\n      for (let c = 0; c < cols; c++) {\n        const x = c * bw + (c % 2) * bw * 0.4;\n        roundRect(ctx, x + bw * 0.15, yb, bw * 0.5, h * 0.04, 3);\n        ctx.fill();\n      }\n    }\n  }, { repeat: [1, 1] });\n\n  return { map, bump };\n}\n\n/** Transparent decal canvas → texture (sRGB). Drawn upright; the caller orients the\n *  quad along the tube's reading direction so the text stays right-way-up. */\nfunction decalTexture(\n  w: number,\n  h: number,\n  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,\n): THREE.CanvasTexture | null {\n  return canvasTexture(w, h, (ctx, cw, ch) => {\n    ctx.clearRect(0, 0, cw, ch);\n    draw(ctx, cw, ch);\n  }, { repeat: [1, 1], srgb: true });\n}\n\n// ---------------------------------------------------------------------------\n// Materials — PBR per the supplied specification\n// ---------------------------------------------------------------------------\nfunction buildMaterials(): Record<string, THREE.MeshPhysicalMaterial> {\n  const env = 1.0;\n  const frame = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.frame),\n    roughness: 0.15, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: env * 1.1,\n  });\n\n  const weld = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.frame),\n    roughness: 0.38, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.28,\n    bumpMap: weldBumpTexture(), bumpScale: 3.0, envMapIntensity: env,\n  });\n\n  const magBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.magBlack),\n    roughness: 0.1, metalness: 0.9, clearcoat: 0.9, clearcoatRoughness: 0.05, envMapIntensity: env * 1.3,\n  });\n\n  const rimOrange = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.rimLip),\n    roughness: 0.22, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: env,\n  });\n\n  const glossBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.glossBlack),\n    roughness: 0.3, metalness: 0.65, clearcoat: 0.45, clearcoatRoughness: 0.15, envMapIntensity: env,\n  });\n\n  const tyreTex = tyreTextures();\n  const tyre = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color('#ffffff'), map: tyreTex.map, bumpMap: tyreTex.bump, bumpScale: 5.0,\n    roughness: 0.85, metalness: 0.0, envMapIntensity: env * 0.45,\n  });\n  if (!tyreTex.map) tyre.color.set(COL.rubber);\n\n  const grip = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.gripOrange),\n    roughness: 0.85, metalness: 0.0, bumpMap: gripBumpTexture(), bumpScale: 1.1, envMapIntensity: env * 0.7,\n  });\n\n  const leather = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.leather),\n    roughness: 0.62, metalness: 0.0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#2a2a2a'),\n    bumpMap: leatherBumpTexture(), bumpScale: 0.6, envMapIntensity: env * 0.8,\n  });\n\n  const amber = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.amber),\n    roughness: 0.18, metalness: 0.0, transmission: 0.28, ior: 1.5, thickness: 0.02, clearcoat: 0.6,\n    emissive: new THREE.Color(COL.amber), emissiveIntensity: 0.12,\n    bumpMap: reflectorBumpTexture(), bumpScale: 1.2, envMapIntensity: env,\n  });\n\n  const peg = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.peg),\n    roughness: 0.55, metalness: 0.7, bumpMap: knurlBumpTexture(), bumpScale: 0.8, envMapIntensity: env,\n  });\n\n  const chrome = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.chrome), roughness: 0.22, metalness: 1.0, envMapIntensity: env * 1.2,\n  });\n\n  const chain = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.chain), roughness: 0.5, metalness: 0.9, envMapIntensity: env,\n  });\n\n  const pedalBody = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.pedalBody), roughness: 0.5, metalness: 0.35, envMapIntensity: env,\n  });\n\n  // smooth matte black (front peg) — no knurl, low sheen\n  const matteBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color('#141416'), roughness: 0.7, metalness: 0.2, clearcoat: 0.1, envMapIntensity: env * 0.6,\n  });\n\n  return { frame, weld, magBlack, rimOrange, glossBlack, tyre, grip, leather, amber, peg, chrome, chain, pedalBody, matteBlack };\n}\n\n// ---------------------------------------------------------------------------\n// Geometry helpers\n// ---------------------------------------------------------------------------\nconst UP = new THREE.Vector3(0, 1, 0);\n\nfunction v(x: number, y: number, z = 0): THREE.Vector3 {\n  return new THREE.Vector3(x, y, z);\n}\n\n/** A cylinder spanning a→b (local points), radius r1 at a, r2 at b. */\nfunction tube(\n  a: THREE.Vector3,\n  b: THREE.Vector3,\n  r1: number,\n  r2: number,\n  mat: THREE.Material,\n  radial = 20,\n): THREE.Mesh {\n  const dir = new THREE.Vector3().subVectors(b, a);\n  const len = dir.length();\n  const geo = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false);\n  const mesh = new THREE.Mesh(geo, mat);\n  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());\n  mesh.position.copy(a).addScaledVector(dir, 0.5);\n  return mesh;\n}\n\n/** A smooth cable/hose swept along a Catmull-Rom (bezier-like) curve through `pts`. */\nfunction cable(pts: THREE.Vector3[], r: number, mat: THREE.Material, seg = 40): THREE.Mesh {\n  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);\n  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8, false), mat);\n}\n\n/** Weld bead ring wrapping a tube of radius `tubeR` at `at`, with `dir` = tube axis. */\nfunction weldRing(at: THREE.Vector3, dir: THREE.Vector3, tubeR: number, mat: THREE.Material): THREE.Mesh {\n  const geo = new THREE.TorusGeometry(tubeR * 1.06, tubeR * 0.26, 10, 32);\n  const mesh = new THREE.Mesh(geo, mat);\n  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());\n  mesh.position.copy(at);\n  return mesh;\n}\n\nfunction applyShadow(obj: THREE.Object3D, opts: ProceduralModelOptions): void {\n  obj.traverse((o) => {\n    const m = o as THREE.Mesh;\n    if (m.isMesh) {\n      m.castShadow = opts.castShadow ?? true;\n      m.receiveShadow = opts.receiveShadow ?? true;\n      if (opts.wireframe) {\n        const mat = m.material as THREE.MeshStandardMaterial;\n        if (mat && 'wireframe' in mat) mat.wireframe = true;\n      }\n    }\n  });\n}\n\n// ---------------------------------------------------------------------------\n// Wheel — OPEN 5-spoke MAG (slim spokes with see-through gaps)\n// ---------------------------------------------------------------------------\nconst TIRE_MAJOR = 0.32; // tyre centreline radius\nconst TIRE_TUBE = 0.05; // tyre cross-section radius → outer 0.37, inner bead ≈ 0.27\nconst WHEEL_WIDTH = 0.085; // hub / peg reference width\n\nconst HUB_R = 0.055;\nconst SPOKE_IN = 0.05;\nconst SPOKE_OUT = 0.244;\nconst RIM_RING_R = 0.244; // black structural rim the spokes meet (inboard of the lip)\nconst LIP_R = 0.268; // orange rim lip ring, sits at the tyre bead just outboard of the ring\nconst MAG_DEPTH = 0.03; // slim spoke / face thickness\n\n/**\n * Open 5-spoke mag face: centre hub + 5 slim beveled spokes + a black rim ring, plus\n * the thin orange rim lip. The gaps between spokes are true voids — you can see through\n * to the far side of the wheel; there is NO solid disc.\n */\nfunction magFace(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {\n  const g = new THREE.Group();\n\n  const hub = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, MAG_DEPTH * 1.5, 28), mats.magBlack);\n  hub.rotation.x = Math.PI / 2;\n  g.add(hub);\n\n  // five slim aero spokes — wider at the hub, tapering to the rim, beveled edges\n  for (let i = 0; i < 5; i++) {\n    const shape = new THREE.Shape();\n    const wB = 0.05; // width at hub\n    const wT = 0.03; // width at rim\n    shape.moveTo(-wB / 2, SPOKE_IN);\n    shape.lineTo(wB / 2, SPOKE_IN);\n    shape.lineTo(wT / 2, SPOKE_OUT);\n    shape.lineTo(-wT / 2, SPOKE_OUT);\n    shape.closePath();\n    const geo = new THREE.ExtrudeGeometry(shape, {\n      depth: MAG_DEPTH, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, steps: 1,\n    });\n    geo.translate(0, 0, -MAG_DEPTH / 2);\n    const spoke = new THREE.Mesh(geo, mats.magBlack);\n    spoke.rotation.z = (i / 5) * Math.PI * 2;\n    g.add(spoke);\n  }\n\n  // black structural rim ring the spoke tips meet (kept inboard of the orange lip)\n  const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_RING_R, 0.013, 18, 96), mats.magBlack);\n  g.add(ring);\n\n  // ORANGE rim lip — glossy burnt-orange painted edge sitting just OUTSIDE the black\n  // ring, at the boundary with the tyre bead (visible band ≈ LIP_R−0.013 … tyre inner)\n  const lip = new THREE.Mesh(new THREE.TorusGeometry(LIP_R, 0.013, 16, 110), mats.rimOrange);\n  g.add(lip);\n\n  return g;\n}\n\n/** Wheel parts returned as three sibling groups (each centred at local origin). */\nfunction buildWheel(mats: Record<string, THREE.MeshPhysicalMaterial>): {\n  tire: THREE.Group; rim: THREE.Group; hub: THREE.Group;\n} {\n  // rim group = the open mag face (spokes + rim ring + orange lip). No solid disc.\n  const rim = magFace(mats);\n\n  // tyre — all-black rubber torus (decals live in the material's map)\n  const tire = new THREE.Group();\n  tire.add(new THREE.Mesh(new THREE.TorusGeometry(TIRE_MAJOR, TIRE_TUBE, 30, 140), mats.tyre));\n\n  // hub — compact all-black shell (no bright chrome caps)\n  const hub = new THREE.Group();\n  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, WHEEL_WIDTH, 24), mats.magBlack);\n  shell.rotation.x = Math.PI / 2;\n  hub.add(shell);\n  for (const zside of [-1, 1]) {\n    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.01, 16), mats.magBlack);\n    cap.rotation.x = Math.PI / 2;\n    cap.position.z = zside * WHEEL_WIDTH * 0.5;\n    hub.add(cap);\n  }\n\n  return { tire, rim, hub };\n}\n\n// ---------------------------------------------------------------------------\n// Small parts\n// ---------------------------------------------------------------------------\nfunction buildGrip(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {\n  // built with the grip axis along local x; positioned/oriented by the caller\n  const g = new THREE.Group();\n  const L = 0.115;\n  const r = 0.026;\n  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 24), mats.grip);\n  body.rotation.z = Math.PI / 2;\n  g.add(body);\n  const flange = new THREE.Mesh(new THREE.TorusGeometry(r + 0.006, 0.006, 8, 24), mats.grip);\n  flange.rotation.y = Math.PI / 2;\n  flange.position.x = -L / 2 + 0.006;\n  g.add(flange);\n  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.glossBlack);\n  cap.rotation.z = -Math.PI / 2;\n  cap.position.x = L / 2;\n  g.add(cap);\n  return g;\n}\n\nfunction buildSaddle(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {\n  // Railed BMX seat: pointed, slightly upturned nose (−x = front) · scooped middle ·\n  // fat rounded tail · puffy cushion. Long axis = local x (caller keeps it ~horizontal).\n  const g = new THREE.Group();\n  // Proportions from NotebookLM research (BMX/jump saddles ≈ 235mm long × 127mm rear\n  // width → shorter than road saddles, ~1.9:1 length:width, nose clearly narrower).\n  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 56, 34), mats.leather);\n  shell.scale.set(0.32, 0.1, 0.15); // length · cushion thickness · rear width\n  const pos = shell.geometry.attributes.position as THREE.BufferAttribute;\n  for (let i = 0; i < pos.count; i++) {\n    const x = pos.getX(i);\n    const y = pos.getY(i);\n    const z = pos.getZ(i);\n    const t = THREE.MathUtils.clamp(x / 0.5, -1, 1); // nose −1 … tail +1\n    // width: narrow pointed nose → full rounded tail\n    const wf = 0.4 + 0.6 * THREE.MathUtils.smoothstep((t + 1) / 2, 0, 1);\n    pos.setZ(i, z * wf);\n    // Longitudinal profile (BMX railed/pivotal seat, per web research): a gentle upward\n    // sweep — the middle sits slightly low, the NOSE kicks up (waterfall) and the TAIL\n    // rises into a rounded rear bumper, so the top line arcs upward toward both ends.\n    // Research: BMX seats sit nose-up with a longitudinal dip + raised rear. Make the\n    // top line clearly sweep UP toward both ends (bigger tail bumper, upturned nose).\n    const scoop = -0.022 * (1 - t * t); // seating dip\n    const tail = 0.09 * Math.pow(Math.max(0, t), 1.3); // raised rounded rear bumper\n    const nose = 0.07 * Math.pow(Math.max(0, -t), 1.4); // upturned nose (waterfall)\n    const domeTop = y > 0 ? 0.01 * (1 - t * t) : 0; // slight cushion crown\n    pos.setY(i, y + scoop + tail + nose + domeTop);\n  }\n  pos.needsUpdate = true;\n  shell.geometry.computeVertexNormals();\n  g.add(shell);\n  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.045), mats.glossBlack);\n  clamp.position.y = -0.05;\n  g.add(clamp);\n  for (const zside of [-1, 1]) {\n    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 8), mats.chrome);\n    rail.rotation.z = Math.PI / 2;\n    rail.position.set(0, -0.045, zside * 0.025);\n    g.add(rail);\n  }\n  return g;\n}\n\nfunction buildPedal(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {\n  const g = new THREE.Group();\n  // spindle runs inboard to meet the crank arm (pedal sits outboard at z≈0.155)\n  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 12), mats.chrome);\n  spindle.rotation.x = Math.PI / 2;\n  spindle.position.z = -0.02;\n  g.add(spindle);\n  const plat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.075), mats.pedalBody);\n  plat.position.z = 0.05;\n  g.add(plat);\n  for (let ix = 0; ix < 4; ix++) {\n    for (const yside of [-1, 1]) {\n      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.07), mats.pedalBody);\n      pin.position.set(-0.04 + ix * 0.026, yside * 0.014, 0.05);\n      g.add(pin);\n    }\n  }\n  for (const xside of [-1, 1]) {\n    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.05), mats.amber);\n    refl.position.set(xside * 0.056, 0, 0.05);\n    g.add(refl);\n  }\n  return g;\n}\n\n/** 8-arm sunburst orange sprocket (chainring), in XY plane, axle z. */\nfunction buildSprocket(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {\n  const g = new THREE.Group();\n  const R = 0.11;\n  const shape = new THREE.Shape();\n  const teeth = 34;\n  for (let i = 0; i <= teeth; i++) {\n    const a = (i / teeth) * Math.PI * 2;\n    const rr = R + (i % 2 === 0 ? 0.006 : 0.0);\n    const x = Math.cos(a) * rr;\n    const y = Math.sin(a) * rr;\n    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);\n  }\n  const arms = 8;\n  for (let i = 0; i < arms; i++) {\n    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;\n    const hole = new THREE.Path();\n    const ri = 0.028;\n    const ro = R - 0.02;\n    const aw = 0.22;\n    hole.moveTo(Math.cos(a - aw * 0.4) * ri, Math.sin(a - aw * 0.4) * ri);\n    for (let s = 0; s <= 8; s++) {\n      const t = -aw + (2 * aw * s) / 8;\n      hole.lineTo(Math.cos(a + t) * ro, Math.sin(a + t) * ro);\n    }\n    hole.lineTo(Math.cos(a + aw * 0.4) * ri, Math.sin(a + aw * 0.4) * ri);\n    hole.closePath();\n    shape.holes.push(hole);\n  }\n  const geo = new THREE.ExtrudeGeometry(shape, {\n    depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8,\n  });\n  geo.center();\n  g.add(new THREE.Mesh(geo, mats.rimOrange));\n  // central spider boss so the ring reads as mounted, not a floating plate\n  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 20), mats.magBlack);\n  boss.rotation.x = Math.PI / 2;\n  g.add(boss);\n  return g;\n}\n\n/**\n * Roller chain as an array of alternating link plates wrapping the chainring + rear cog.\n * Path = upper external run → wrap the rear (+x) of the cog → lower run → wrap the front\n * (−x) of the chainring. Links are placed tangent to the path (not two flat strips).\n */\nfunction buildChain(\n  c1: THREE.Vector2, r1: number, // chainring\n  c2: THREE.Vector2, r2: number, // rear cog\n  z: number,\n  mats: Record<string, THREE.MeshPhysicalMaterial>,\n): THREE.Group {\n  const g = new THREE.Group();\n  const pts: THREE.Vector2[] = [];\n  const arc = (c: THREE.Vector2, r: number, a0: number, a1: number, n: number): void => {\n    for (let i = 0; i <= n; i++) {\n      const a = a0 + ((a1 - a0) * i) / n;\n      pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));\n    }\n  };\n  // top run start (top of chainring) → top of cog, then wrap cog rear, bottom run, wrap chainring front\n  pts.push(new THREE.Vector2(c1.x, c1.y + r1));\n  pts.push(new THREE.Vector2(c2.x, c2.y + r2));\n  arc(c2, r2, Math.PI / 2, -Math.PI / 2, 10); // around the +x side of the cog\n  pts.push(new THREE.Vector2(c1.x, c1.y - r1));\n  arc(c1, r1, -Math.PI / 2, -Math.PI * 1.5, 16); // around the −x side of the chainring\n\n  // resample at uniform spacing and drop an alternating link at each step\n  const spacing = 0.016;\n  let carry = 0;\n  const linkOuter = new THREE.BoxGeometry(0.022, 0.012, 0.016);\n  const linkInner = new THREE.BoxGeometry(0.02, 0.008, 0.01);\n  let toggle = false;\n  for (let i = 0; i < pts.length - 1; i++) {\n    const a = pts[i];\n    const b = pts[i + 1];\n    const seg = b.clone().sub(a);\n    let segLen = seg.length();\n    const dir = seg.clone().normalize();\n    let t = carry;\n    while (t < segLen) {\n      const p = a.clone().addScaledVector(dir, t);\n      const link = new THREE.Mesh(toggle ? linkInner : linkOuter, mats.chain);\n      link.position.set(p.x, p.y, z);\n      link.rotation.z = Math.atan2(dir.y, dir.x);\n      g.add(link);\n      toggle = !toggle;\n      t += spacing;\n    }\n    carry = t - segLen;\n  }\n  return g;\n}\n\n/** Rear U-brake: two arms hugging the tyre + straddle cable + barrel adjuster. */\nfunction buildUBrake(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {\n  const g = new THREE.Group();\n  for (const zside of [-1, 1]) {\n    g.add(tube(v(0, 0, zside * 0.05), v(-0.02, 0.11, zside * 0.03), 0.01, 0.008, mats.glossBlack, 10));\n    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.02), mats.glossBlack);\n    pad.position.set(0, 0, zside * 0.055);\n    g.add(pad);\n    const boltHead = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), mats.chrome);\n    boltHead.rotation.x = Math.PI / 2;\n    boltHead.position.set(-0.02, 0.11, zside * 0.03);\n    g.add(boltHead);\n  }\n  const yoke = v(0, 0.12, 0);\n  g.add(tube(v(-0.02, 0.11, -0.03), yoke, 0.003, 0.003, mats.chrome, 6));\n  g.add(tube(v(-0.02, 0.11, 0.03), yoke, 0.003, 0.003, mats.chrome, 6));\n  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10), mats.chrome);\n  barrel.position.copy(yoke).add(v(0, 0.02, 0));\n  g.add(barrel);\n  // housing hugs forward along the seat stay toward the frame (local −x), not skyward\n  g.add(cable([\n    yoke.clone().add(v(0, 0.03, 0)),\n    v(-0.12, 0.14, 0.01),\n    v(-0.28, 0.11, 0),\n    v(-0.4, 0.08, 0),\n  ], 0.004, mats.glossBlack));\n  return g;\n}\n\n/** A flat decal quad carrying a transparent canvas texture. */\nfunction decalQuad(tex: THREE.CanvasTexture | null, w: number, h: number, fallbackColor = COL.frame): THREE.Mesh {\n  const mat = new THREE.MeshPhysicalMaterial({\n    map: tex ?? undefined,\n    color: tex ? new THREE.Color('#ffffff') : new THREE.Color(fallbackColor),\n    transparent: true, roughness: 0.25, clearcoat: 0.6,\n    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.6,\n  });\n  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);\n}\n\n// ---------------------------------------------------------------------------\n// Main factory\n// ---------------------------------------------------------------------------\nexport function createBMXEnduranceBikeModel(options: ProceduralModelOptions = {}): THREE.Group {\n  const root = new THREE.Group();\n  root.name = 'BMX Endurance Bike';\n  const M = buildMaterials();\n\n  const nodes: Record<string, THREE.Object3D> = { root };\n  const meshes: Record<string, THREE.Mesh> = {};\n  const sockets: Record<string, THREE.Object3D> = {};\n  const colliders: Record<string, unknown> = {};\n  const destructionGroups: Record<string, THREE.Object3D[]> = {};\n\n  const addNode = (id: string, obj: THREE.Object3D, group: string, parent: THREE.Object3D = root): void => {\n    parent.add(obj);\n    nodes[id] = obj;\n    (destructionGroups[group] ??= []).push(obj);\n  };\n\n  // ---- Frame skeleton (joint coordinates) ----\n  // BB, front & rear axles are FIXED (the registry drivetrain rig pivots on them).\n  // Everything else is shaped for a low, stubby BMX freestyle stance.\n  // Front axle pushed forward + rear axle pulled in (~16% shorter rear) for a compact\n  // BMX wheelbase with a clean 3-4cm tyre↔down-tube gap. These MUST match registry.ts.\n  const BB = v(-0.02, -0.24);\n  const seatCluster = v(0.1, 0.04); // short seat tube → low, stubby stance\n  const headTop = v(-0.47, 0.26); // head tube forward/up so the front tyre clears the down tube\n  const headBot = v(-0.51, 0.12);\n  const frontAxle = v(-0.66, -0.28); // pushed forward → ~4cm gap to the down tube\n  const rearAxle = v(0.52, -0.28); // pulled in ~16% → tighter BMX rear end\n  const barBase = v(-0.46, 0.35);\n\n  const frameGroup = new THREE.Group();\n  frameGroup.name = 'frame';\n  root.add(frameGroup);\n  destructionGroups['frame'] = [frameGroup];\n  const addFrame = (mesh: THREE.Mesh): void => { frameGroup.add(mesh); };\n\n  addFrame(tube(BB, seatCluster, 0.023, 0.021, M.frame)); // seat tube (short)\n  addFrame(tube(BB, headBot, 0.034, 0.03, M.frame)); // down tube — fattest tube, steep\n  addFrame(tube(seatCluster, headTop, 0.02, 0.019, M.frame)); // top tube — slimmer than down tube\n  // Seat + chain stays bow OUTBOARD around the rear tyre (half-width ≈ 0.05) so they\n  // clear it, then converge to the dropouts. Curved tubes, not straight (which pierced).\n  for (const zs of [-1, 1]) {\n    addFrame(cable([\n      seatCluster.clone().setZ(0.02 * zs),\n      v(0.28, -0.11, 0.092 * zs),\n      rearAxle.clone().setZ(0.066 * zs),\n    ], 0.011, M.frame)); // seat stay\n    addFrame(cable([\n      BB.clone().setZ(0.045 * zs),\n      v(0.24, -0.3, 0.098 * zs),\n      rearAxle.clone().setZ(0.066 * zs),\n    ], 0.013, M.frame)); // chain stay\n  }\n  addFrame(tube(headTop, headBot, 0.034, 0.034, M.frame)); // head tube (beefy)\n\n  const bbShell = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 24), M.frame);\n  bbShell.rotation.x = Math.PI / 2;\n  bbShell.position.copy(BB);\n  addFrame(bbShell);\n\n  // Fork (orange): steerer stub + crown + long legs (spread wider than the tyre) + dropouts.\n  const forkCrownPos = v(-0.51, 0.07);\n  addFrame(tube(headBot, forkCrownPos, 0.022, 0.024, M.frame)); // lower steerer into crown\n  const forkCrown = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.14), M.frame);\n  forkCrown.position.copy(forkCrownPos);\n  addFrame(forkCrown);\n  const forkZ = 0.065; // outboard of the tyre half-width (0.05)\n  for (const zs of [-1, 1]) {\n    // long raked leg, tapering down from a thicker crown to a slim dropout\n    addFrame(tube(forkCrownPos.clone().setZ(forkZ * zs), frontAxle.clone().setZ(forkZ * zs), 0.019, 0.009, M.frame));\n    // flat drilled dropout plate around the axle (thin box + hole ring)\n    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.012), M.frame);\n    plate.position.copy(frontAxle).setZ(forkZ * zs);\n    addFrame(plate);\n    const hole = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.006, 8, 16), M.glossBlack);\n    hole.position.copy(frontAxle).setZ(forkZ * zs + 0.007 * zs);\n    addFrame(hole);\n  }\n\n  // ---- TIG weld beads at the joints (fish-scale) ----\n  const welds = new THREE.Group();\n  welds.name = 'welds';\n  root.add(welds);\n  welds.add(weldRing(BB.clone().add(v(0.03, 0.06, 0)), new THREE.Vector3().subVectors(seatCluster, BB), 0.024, M.weld));\n  welds.add(weldRing(BB.clone().add(v(-0.06, 0.03, 0)), new THREE.Vector3().subVectors(headBot, BB), 0.03, M.weld));\n  welds.add(weldRing(headBot.clone().add(v(0.03, 0.02, 0)), new THREE.Vector3().subVectors(BB, headBot), 0.03, M.weld));\n  welds.add(weldRing(headTop.clone().add(v(0.03, -0.02, 0)), new THREE.Vector3().subVectors(seatCluster, headTop), 0.024, M.weld));\n  welds.add(weldRing(seatCluster.clone().add(v(-0.03, -0.02, 0)), new THREE.Vector3().subVectors(headTop, seatCluster), 0.023, M.weld));\n\n  // ---- Seatpost + clamp + saddle: post slammed low, saddle near-horizontal ----\n  const seatTop = v(0.11, 0.12); // very short post, tucked down near the frame\n  addFrame(tube(seatCluster, seatTop, 0.015, 0.015, M.glossBlack));\n  const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 20), M.glossBlack);\n  clamp.rotation.x = Math.PI / 2;\n  clamp.position.set(seatCluster.x, seatCluster.y + 0.02, 0);\n  addFrame(clamp);\n  const saddle = buildSaddle(M); // long axis already along x (nose −x = front)\n  saddle.position.set(0.14, seatTop.y + 0.06, 0);\n  saddle.rotation.z = -0.11; // ~6° nose-up, BMX-standard (research: BMX seats tilt up)\n  addNode('saddle', saddle, 'seat');\n\n  // ---- Cockpit: stem, tall riser bar, crossbar, grips, lever ----\n  addFrame(tube(headTop, barBase, 0.02, 0.02, M.glossBlack)); // steerer riser\n  const stemBlock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), M.glossBlack);\n  stemBlock.position.copy(barBase);\n  addFrame(stemBlock);\n\n  const bx = barBase.x;\n  const by = barBase.y;\n  const bars = new THREE.Group();\n  bars.name = 'handlebar';\n  root.add(bars);\n  bars.add(tube(v(bx, by, -0.12), v(bx, by, 0.12), 0.016, 0.016, M.glossBlack)); // bottom span\n  for (const zs of [-1, 1]) {\n    bars.add(tube(v(bx, by, 0.12 * zs), v(bx + 0.02, by + 0.16, 0.2 * zs), 0.015, 0.015, M.glossBlack)); // uprights\n    bars.add(tube(v(bx + 0.02, by + 0.16, 0.2 * zs), v(bx + 0.03, by + 0.2, 0.28 * zs), 0.015, 0.015, M.glossBlack)); // bend to grip\n  }\n  bars.add(tube(v(bx + 0.015, by + 0.15, -0.19), v(bx + 0.015, by + 0.15, 0.19), 0.013, 0.013, M.glossBlack)); // crossbar\n\n  const gripY = by + 0.2;\n  for (const [id, zs] of [['gripL', -1], ['gripR', 1]] as const) {\n    const grip = buildGrip(M);\n    grip.position.set(bx + 0.035, gripY, 0.34 * zs);\n    grip.rotation.y = Math.PI / 2; // grip axis → z (outboard)\n    addNode(id, grip, 'cockpit');\n  }\n  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.02), M.glossBlack);\n  lever.position.set(bx + 0.04, gripY - 0.015, 0.26);\n  lever.rotation.z = 0.2;\n  bars.add(lever);\n  // brake cable as a smooth curve from the lever down to the head-tube/frame\n  bars.add(cable([\n    v(bx + 0.06, gripY, 0.25),\n    v(bx + 0.12, by + 0.06, 0.12),\n    v(headTop.x + 0.03, headTop.y + 0.03, 0.04),\n    v(headTop.x + 0.01, headTop.y - 0.06, 0.02),\n  ], 0.0035, M.glossBlack));\n\n  // ---- Wheels ----\n  const placeWheel = (prefix: 'front' | 'rear', center: THREE.Vector3): void => {\n    const parts = buildWheel(M);\n    for (const [k, obj] of Object.entries(parts)) {\n      obj.position.copy(center);\n      const id = `${prefix}${k.charAt(0).toUpperCase()}${k.slice(1)}`; // frontTire/frontRim/frontHub\n      addNode(id, obj, 'wheel');\n    }\n  };\n  placeWheel('front', frontAxle);\n  placeWheel('rear', rearAxle);\n\n  // ---- Pegs (4: front + rear, both sides) — static ----\n  const pegs = new THREE.Group();\n  pegs.name = 'pegs';\n  root.add(pegs);\n  // Front axle: ONE slim, smooth matte-black peg (drive side).\n  const frontPeg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 20), M.matteBlack);\n  frontPeg.rotation.x = Math.PI / 2;\n  frontPeg.position.copy(frontAxle).setZ(WHEEL_WIDTH * 0.5 + 0.085);\n  pegs.add(frontPeg);\n  // Rear axle: knurled anodized pegs on both sides.\n  for (const zs of [-1, 1]) {\n    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 20), M.peg);\n    peg.rotation.x = Math.PI / 2;\n    peg.position.copy(rearAxle).setZ(zs * (WHEEL_WIDTH * 0.5 + 0.08));\n    pegs.add(peg);\n  }\n\n  // ---- Drivetrain: BB spindle, bolted cranks, sprocket, pedals, roller chain, cog ----\n  // static BB spindle through the shell — widened so the cranks sit outboard of the\n  // chainstays and the pedals swing free (no frame collision at any crank angle).\n  const CRANK_Z = 0.1;\n  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, CRANK_Z * 2 + 0.04, 16), M.chrome);\n  spindle.rotation.x = Math.PI / 2;\n  spindle.position.set(BB.x, BB.y, 0);\n  addFrame(spindle);\n\n  const crankBolt = (zoff: number): THREE.Mesh => {\n    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.014, 12), M.chrome);\n    b.rotation.x = Math.PI / 2;\n    b.position.z = zoff;\n    return b;\n  };\n\n  const crankL = new THREE.Group();\n  crankL.position.set(BB.x, BB.y, CRANK_Z);\n  crankL.add(tube(v(0, 0, 0), v(0, -0.11, 0), 0.016, 0.013, M.glossBlack));\n  crankL.add(crankBolt(0.014)); // nut fixing the arm to the spindle\n  addNode('crankArmL', crankL, 'drivetrain');\n\n  const crankR = new THREE.Group();\n  crankR.position.set(BB.x, BB.y, -CRANK_Z);\n  crankR.add(tube(v(0, 0, 0), v(0, 0.11, 0), 0.016, 0.013, M.glossBlack));\n  crankR.add(crankBolt(-0.014));\n  addNode('crankArmR', crankR, 'drivetrain');\n\n  // sprocket + cog + chain share the SAME z-plane so the chain seats on both\n  const DRIVE_Z = 0.058;\n  const chainring = buildSprocket(M);\n  chainring.position.set(BB.x, BB.y, DRIVE_Z);\n  addNode('chainring', chainring, 'drivetrain');\n\n  const cogR = 0.05;\n  const cog = new THREE.Mesh(new THREE.CylinderGeometry(cogR, cogR, 0.016, 24), M.magBlack);\n  cog.rotation.x = Math.PI / 2;\n  cog.position.set(rearAxle.x, rearAxle.y, DRIVE_Z);\n  root.add(cog);\n\n  const pedalL = buildPedal(M);\n  pedalL.position.set(BB.x, BB.y - 0.11, 0.155); // outboard of the crank + chainstay\n  addNode('pedalL', pedalL, 'drivetrain');\n  const pedalR = buildPedal(M);\n  pedalR.position.set(BB.x, BB.y + 0.11, -0.155);\n  addNode('pedalR', pedalR, 'drivetrain');\n\n  // roller chain — array of alternating links wrapping sprocket teeth + rear cog\n  root.add(buildChain(\n    new THREE.Vector2(BB.x, BB.y), 0.116, // rides on the ~0.11 sprocket teeth\n    new THREE.Vector2(rearAxle.x, rearAxle.y), cogR + 0.006,\n    DRIVE_Z, M,\n  ));\n\n  // ---- Rear U-brake (above the rear tyre, mounted on the seat stays) ----\n  const ubrake = buildUBrake(M);\n  ubrake.position.set(rearAxle.x - 0.12, -0.02, 0);\n  root.add(ubrake);\n\n  // ---- Decals: BMX (top tube), Endurance (down tube), lightning (head tube) ----\n  const bmxTex = decalTexture(512, 160, (ctx, _w, h) => {\n    ctx.fillStyle = '#1a1a1a';\n    for (let i = 0; i < 3; i++) ctx.fillRect(10 + i * 20, h * 0.2, 10, h * 0.6);\n    ctx.font = `900 ${Math.round(h * 0.7)}px Arial, sans-serif`;\n    ctx.textBaseline = 'middle';\n    ctx.fillText('BMX', 80, h * 0.5);\n    ctx.fillStyle = '#f39a1b';\n    for (let i = 0; i < 3; i++) {\n      ctx.beginPath();\n      ctx.moveTo(360 + i * 26, h * 0.2);\n      ctx.lineTo(380 + i * 26, h * 0.2);\n      ctx.lineTo(360 + i * 26, h * 0.8);\n      ctx.lineTo(340 + i * 26, h * 0.8);\n      ctx.closePath();\n      ctx.fill();\n    }\n  });\n  const enduranceTex = decalTexture(512, 96, (ctx, _w, h) => {\n    ctx.fillStyle = '#141414';\n    ctx.font = `italic 800 ${Math.round(h * 0.72)}px Georgia, serif`;\n    ctx.textBaseline = 'middle';\n    ctx.fillText('Endurance', 8, h * 0.55);\n  });\n  const decals = new THREE.Group();\n  decals.name = 'decals';\n  root.add(decals);\n  const topMid = seatCluster.clone().lerp(headTop, 0.52);\n  // Reading direction runs front→back (−x → +x = screen left→right) so the text is\n  // upright; using the front-pointing tube direction would spin it ~180°.\n  const topAngle = Math.atan2(seatCluster.y - headTop.y, seatCluster.x - headTop.x);\n  const downMid = BB.clone().lerp(headBot, 0.5);\n  const downAngle = Math.atan2(BB.y - headBot.y, BB.x - headBot.x);\n  // Decals are applied to the drive side (+z, the side the studio camera faces). A\n  // single quad per graphic avoids the far-side mirror bleed-through a thin tube can't\n  // occlude. Text reads left-to-right for a +z-facing viewer. (No head-tube logo.)\n  {\n    const bmx = decalQuad(bmxTex, 0.26, 0.055); // long, fills the top-tube width\n    bmx.position.copy(topMid).setZ(0.021);\n    bmx.rotation.set(0, 0, topAngle);\n    decals.add(bmx);\n\n    const end = decalQuad(enduranceTex, 0.2, 0.04); // bigger, up on the down tube\n    end.position.copy(downMid).setZ(0.036);\n    end.rotation.set(0, 0, downAngle);\n    decals.add(end);\n  }\n\n  applyShadow(root, options);\n\n  root.traverse((o) => {\n    const m = o as THREE.Mesh;\n    if (m.isMesh) meshes[o.name || `mesh_${Object.keys(meshes).length}`] = m;\n  });\n\n  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;\n  root.userData.actionReadiness = {\n    note: 'root.userData.sculptRuntime.nodes exposes wheels (frontTire/frontRim/frontHub, rear…), crankArmL/R, chainring, pedalL/R for the drivetrain rig.',\n  };\n  return root;\n}\n\n// ---------------------------------------------------------------------------\n// Studio look-dev rig (per the supplied lighting spec)\n// ---------------------------------------------------------------------------\nexport function createBMXEnduranceBikeLookDevLights(\n  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',\n): THREE.Group {\n  const lights = new THREE.Group();\n  lights.name = 'BMX Endurance Bike look-dev lights';\n\n  // Key — warm, high right, sharp shadow\n  const key = new THREE.DirectionalLight(0xfff8f0, mode === 'grazing' ? 2.6 : 1.9);\n  key.position.set(5, 8, 5);\n  key.castShadow = true;\n  key.shadow.mapSize.set(2048, 2048);\n  key.shadow.bias = -0.0003;\n  key.shadow.normalBias = 0.02;\n  key.shadow.radius = 6;\n  key.shadow.camera.near = 0.5;\n  key.shadow.camera.far = 30;\n  key.shadow.camera.left = -2.2;\n  key.shadow.camera.right = 2.2;\n  key.shadow.camera.top = 2.2;\n  key.shadow.camera.bottom = -2.2;\n  key.shadow.camera.updateProjectionMatrix();\n  lights.add(key);\n\n  // Fill — warm + soft, front-left; catches bevels without desaturating the orange\n  const fill = new THREE.DirectionalLight(0xffe7cc, 0.45);\n  fill.position.set(-6, 3, 4);\n  lights.add(fill);\n\n  // Rim — behind, separates black parts from the dark stage\n  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 3.0 : 1.9);\n  rim.position.set(0, 6, -6);\n  lights.add(rim);\n\n  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x14161c, 0.3);\n  lights.add(hemi);\n\n  // Softbox panels — large area lights that paint the long, curved specular streaks\n  // the reference shows running down the glossy frame + mag wheels. Kept modest so\n  // they add streaks without flooding the scene and desaturating the orange.\n  RectAreaLightUniformsLib.init();\n  const softTop = new THREE.RectAreaLight(0xffffff, 2.2, 2.4, 0.5);\n  softTop.position.set(0, 2.4, 1.2);\n  softTop.lookAt(0, -0.2, 0);\n  lights.add(softTop);\n\n  const softSide = new THREE.RectAreaLight(0xfff2df, 1.5, 0.5, 2.0);\n  softSide.position.set(1.6, 0.4, 2.2);\n  softSide.lookAt(0, -0.1, 0);\n  lights.add(softSide);\n\n  lights.userData.reviewMode = mode;\n  return lights;\n}	{"stripLog": false, "stripDOMBox": false, "stripImport": true, "stripControls": false, "stripRenderer": false}	{img2threejs.}	\N	2026-08-02 07:43:09.570842	2026-08-02 07:43:09.570842	js	\N	[{"rule": "legacy_api", "count": 3, "details": [{"api": "/\\\\bcolorSpace\\\\b/g", "count": 1}, {"api": "/\\\\bTHREE\\\\.SRGBColorSpace\\\\b/g", "count": 1}, {"api": "/\\\\bTHREE\\\\.NoColorSpace\\\\b/g", "count": 1}], "description": "老版 Three.js API 桥接 ×3"}, {"rule": "strip_typescript", "count": 1, "description": "TypeScript → JavaScript 转译 (babel)"}, {"rule": "strip_exports", "count": 2, "description": "剥离 export 语句 ×2"}, {"rule": "strip_imports", "count": 1, "description": "剥离 import 语句 并自动声明 1 个变量"}]	ok
\.


--
-- Data for Name: ui_controls; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ui_controls (id, control_id, control_name, control_type, category, position_x, position_y, width, height, position_type, mobile_position_x, mobile_position_y, mobile_width, mobile_height, style_config, is_visible, is_enabled, z_index, related_module, description, created_at, updated_at, created_by, updated_by, h_align, v_align, landscape_position_x, landscape_position_y, landscape_width, landscape_height) FROM stdin;
3	mobile_sprint_btn	冲刺按钮	button	mobile	auto	24px	60px	60px	fixed	5%	0%	57px	57px	{}	t	t	1000	mobileControls.js	冲刺/加速按钮	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.044993	\N	1	right	bottom	5%	0%	55px	55px
1719	mobile_turn_right_btn	右转按钮	button	mobile	auto	180px	50px	50px	fixed	8%	12%	50px	50px	{}	t	t	1000	mobileControls.js	按住向右转向（等效桌面端E键）	2026-07-22 15:45:39.776259	2026-07-23 10:38:51.048126	\N	1	right	bottom	5%	16%	50px	50px
1718	mobile_turn_left_btn	左转按钮	button	mobile	auto	180px	50px	50px	fixed	23%	12%	50px	50px	{}	t	t	1000	mobileControls.js	按住向左转向（等效桌面端Q键）	2026-07-22 15:45:39.773824	2026-07-23 10:38:51.050529	\N	1	right	bottom	13%	16%	50px	50px
1	mobile_joystick	移动摇杆	joystick	mobile	24px	auto	150px	150px	fixed	2%	3%	150px	150px	{}	t	t	1000	mobileControls.js	左下角虚拟摇杆，控制角色移动	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.052544	\N	1	left	bottom	2%	3%	150px	150px
4	mobile_camera_toggle_btn	视角切换按钮	button	mobile	auto	24px	60px	60px	fixed	2%	25%	45px	46px	{}	t	t	1000	mobileControls.js	第一/第三人称视角切换	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.062849	\N	1	right	bottom	30%	4%	44px	44px
92	portal_btn	世界传送门按钮	button	general	0%	16%	158px	36px	fixed	0%	15%	145px	35px	{}	t	t	1000	portalManager.js	打开传送门界面	2026-06-18 15:34:26.47102	2026-07-23 10:38:51.008618	\N	1	right	top	0%	22%	156px	35px
16	btn_profile	个人资料	button	general	0%	0%	48px	48px	fixed	0%	0%	48px	48px	{}	t	t	1000	ui.js	右上角个人资料按钮	2026-03-08 08:45:38.853341	2026-07-23 10:38:51.015295	\N	1	left	top	0%	0%	48px	48px
2	mobile_jump_btn	跳跃按钮	button	mobile	auto	24px	70px	70px	fixed	22%	0%	57px	59px	{}	t	t	1000	mobileControls.js	右下角跳跃按钮	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.068952	\N	1	right	bottom	13%	0%	53px	52px
39	debug_panel	坐标调试面板	panel	general	15%	0%	281px	30px	fixed	38%	0%	63px	92px	{}	t	t	1000	main.js	显示当前坐标、FPS、相机模式等调试信息	2026-06-02 14:49:05.160948	2026-07-23 10:38:51.018178	\N	1	right	top	23%	0%	275px	30px
35	minimap	小地图	minimap	general	0%	0%	112px	74px	fixed	0%	1%	136px	76px	{}	t	t	1000	ui.js	右上角小地图	2026-06-02 14:49:05.155127	2026-07-23 10:38:51.020558	\N	1	right	top	0%	0%	136px	76px
95	performance_monitor	性能监控面板	panel	general	14%	10%	200px	120px	fixed	auto	auto	150px	100px	{}	f	t	1000	performance-optimization.js	显示FPS和性能指标	2026-06-18 15:34:26.474001	2026-07-23 10:38:51.026586	\N	1	right	bottom	auto	auto	150px	100px
5	skill_hud	技能栏	panel	general	35%	94%	283px	30px	absolute	42%	82%	auto	58px	{}	f	t	1000	skillHUD.js	屏幕底部技能栏	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.02975	\N	1	left	bottom	42%	82%	auto	58px
17	btn_inventory	物品管理	button	general	6%	0%	48px	48px	fixed	13%	0%	48px	48px	{}	t	t	1000	ui.js	右上角物品管理按钮	2026-03-08 08:45:38.853341	2026-07-23 10:38:51.032587	\N	1	left	top	8%	0%	48px	48px
1525	federation_portal_btn	联邦传送门按钮	button	general	20px	200px	auto	auto	fixed	10px	100px	auto	auto	{}	t	t	1000	federationUI.js	打开联邦世界传送界面	2026-07-16 15:26:10.712132	2026-07-23 10:38:51.034572	\N	1	left	top	10px	100px	auto	auto
7	health_bar	血条	healthbar	general	13%	1%	50px	31px	fixed	26%	1%	70px	30px	{}	t	t	1000	ui.js	左上角生命值显示	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.036553	\N	1	left	top	19%	2%	70px	30px
6	skill_voice_btn	语音按钮	button	general	0%	33%	54px	48px	fixed	0%	35%	58px	58px	{}	t	t	1000	skillHUD.js	语音输入按钮	2026-03-08 08:11:01.849169	2026-07-23 10:38:51.042483	\N	1	left	bottom	0%	35%	58px	58px
\.


--
-- Data for Name: uploaded_models; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.uploaded_models (id, file_name, saved_file_name, path, file_type, file_size, created_at, tags, category, description, auto_tags, thumbnail_path, updated_at, display_name) FROM stdin;
1	6f66fa55-49df-4b8e-9838-4c4e46fff939_0.zip	model-1770882210680-108958276.zip	/models/uploaded/model-1770882210680-108958276/0bc2588c9c0adb0b9812c68902bb3768.obj	zip	7570824	2026-02-12 15:43:30.81734	{}	uploaded	\N	{}	\N	2026-02-13 15:21:24.270724	\N
2	after_moved.glb	model-1772073845040-80818868.glb	/models/uploaded/model-1772073845040-80818868.glb	glb	25553440	2026-02-26 10:44:05.608908	{}	uploaded	\N	{}	\N	2026-02-26 10:44:05.608908	\N
3	after_moved.glb	model-1772073882670-685802444.glb	/models/uploaded/model-1772073882670-685802444.glb	glb	25553440	2026-02-26 10:44:42.750417	{}	uploaded	\N	{}	\N	2026-02-26 10:44:42.750417	\N
8	2026_4_26 07-39-10.glb	model-1777160361995-170011383.glb	/models/uploaded/model-1777160361995-170011383.glb	glb	4276668	2026-04-26 07:39:22.522198	{}	uploaded	\N	{}	\N	2026-04-26 07:39:22.522198	\N
14	LittlestTokyo.glb	model-1783481710732-936486373.glb	/models/uploaded/model-1783481710732-936486373.glb	glb	4133072	2026-07-08 11:35:10.817587	{}	uploaded	\N	{}	\N	2026-07-08 11:35:10.817587	20260708
\.


--
-- Data for Name: user_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_subscriptions (id, user_id, months, amount_cents, payment_method, proof_image_url, note, started_at, expires_at, created_at, txn_no, order_no, world_id) FROM stdin;
0cb8c8c8-e148-4ef3-86e9-03db5647929c	1	1	0	free_trial	\N	首次部署赠送一个月	2026-02-11 00:00:00	2026-03-11 00:00:00	2026-07-29 15:35:04.038771	\N	\N	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, email, password_hash, created_at, updated_at, role, federation_user, security_question_id, security_answer) FROM stdin;
0c4dadd7-71f7-4074-974f-533a201aa382	大志哥	857035247@qq.com	$2a$10$q/EeE6bRrlynZhiDkD76ue3FvaRhQkHUYf9RjV3PTjXFmeqg/ML4S	2026-02-10 11:40:31.051267	2026-02-10 11:40:31.051267	user	f	\N	\N
c0ebeb63-5709-4cfc-a27a-ac179e48b0f2	大侠w	999@qq.com	$2a$10$PuCeO4uoKuzkNjHIduBdkOovKV350jsoZdLdzJihk1yuDj41tHbl6	2026-02-10 13:31:37.671539	2026-02-10 13:31:37.671539	user	f	\N	\N
1b6da92b-2a69-41c4-a6c2-a221799c9438	miduo200	8547@qq.com	$2a$10$bcsmYcxQweOVGdnr/QwRYu.Trscxf02wJcmvgJ9LCKzv19fiNwL2y	2026-02-10 17:46:29.739088	2026-02-10 17:46:29.739088	user	f	\N	\N
e0bc4767-f17e-4992-89ae-8feb0a633d03	miduo300	328422701@qq.com	$2b$10$zXBJJ7lQrQdmxroGKU7r/eRgx2DkdkJry25HbUsV8VQ.gO0gKvHOG	2026-03-19 12:11:16.610546	2026-06-01 18:44:55.951638	user	f	\N	\N
899b45d8-6d56-4903-b1f3-788a00f60064	miduo100	888@qq.com	$2a$10$EiS2qU5f3pnOgEcnQUNR2uI7oNus8Z83QgChIUlCyHKcK5vcT0Yn2	2026-02-10 11:44:46.031888	2026-07-23 11:26:13.973696	user	f	\N	\N
\.


--
-- Data for Name: weapon_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.weapon_skills (id, weapon_id, skill_name, effect_type, trigger_type, duration, sound_url, sort_order, is_confirmed, created_at, updated_at) FROM stdin;
1fa5732a-46a6-4ba4-829e-5eeadf59b790	7484376f-41f6-404a-befe-4acbcbca7e2a	技能 1	lightning	manual	3000	\N	0	t	2026-03-24 17:01:50.896167	2026-03-24 17:01:50.896167
dc7af823-9f72-4490-a999-b9e9fb1a0add	634f61eb-c535-45ae-848d-9de77305a094	技能 1	none	manual	3000	\N	0	t	2026-03-24 18:09:36.829476	2026-03-24 18:09:36.829476
c0108128-acda-44de-ab0a-76bec8d0a43b	634f61eb-c535-45ae-848d-9de77305a094	技能 2	none	manual	3000	\N	1	t	2026-03-24 18:09:36.830432	2026-03-24 18:09:36.830432
\.


--
-- Data for Name: weapons; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.weapons (id, name, weapon_type, glb_url, config, is_active, sort_order, created_by_admin_id, created_by_name, created_at, updated_at, default_effect) FROM stdin;
7484376f-41f6-404a-befe-4acbcbca7e2a	红色星火光剑	builtin_lightsaber	\N	{"hilt_color": "#7b7474", "blade_color": "#ff00ff", "blade_length": 1.9, "particle_type": "dark", "glow_intensity": 1.6, "point_light_intensity": 1.1}	t	0	1	admin	2026-03-20 17:07:13.884505	2026-03-24 17:01:50.894415	dark
634f61eb-c535-45ae-848d-9de77305a094	初始光剑	builtin_lightsaber	\N	{"hilt_color": "#222222", "blade_color": "#00ffff", "blade_length": 0.8, "glow_intensity": 2.1, "point_light_intensity": 1.6}	t	0	1	admin	2026-03-03 10:35:21.046759	2026-03-24 18:09:36.827901	none
\.


--
-- Data for Name: world_drops; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_drops (id, code_id, monster_id, "position", dropped_at, expires_at, is_picked, picked_by, picked_at) FROM stdin;
2cd3f942-5310-443e-93ab-55c83f6252b3	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 15:16:01.97016	2026-03-25 15:18:01.969	f	\N	\N
cd10d58c-f4fc-4476-993d-a337a84e4938	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 15:23:54.358082	2026-03-25 15:25:54.357	f	\N	\N
be7e61c9-3e0a-48ec-acb4-6ff589f92023	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 15:23:55.157131	2026-03-25 15:25:55.156	f	\N	\N
4baa7c6c-a83f-4c1a-8785-5028412df7b2	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 15:26:50.55537	2026-03-25 15:28:50.554	f	\N	\N
c381794d-257f-46fe-9d94-67d8e52910d1	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 16:08:20.522015	2026-03-25 16:10:20.521	f	\N	\N
bfd00029-a1a8-413c-abcf-66df8536cb62	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 16:52:08.747537	2026-03-25 16:54:08.746	f	\N	\N
90513b5e-c96f-46e1-9927-90e8e32d5d6e	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 17:05:18.904014	2026-03-25 17:07:18.903	f	\N	\N
551e9c07-3648-4c93-896e-1a773f8a2358	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 17:10:26.673971	2026-03-25 17:12:26.673	f	\N	\N
9e93dd12-b852-420e-9898-f7a01b04ac34	38005d96-9dbe-4cb9-bff5-bf9327d7911a	69170498-0ac7-4f44-b037-fe84fa78d6b1	{"x": 1, "y": 1, "z": 1}	2026-03-25 17:18:03.813618	2026-03-25 17:20:03.812	f	\N	\N
eea77e76-b11b-42a8-83d0-533049f42033	38005d96-9dbe-4cb9-bff5-bf9327d7911a	8b932f7a-90d5-4490-9876-b1032c39dcfc	{"x": 193, "y": 1, "z": 918}	2026-06-04 18:26:12.352727	2026-06-04 18:28:12.358	t	e0bc4767-f17e-4992-89ae-8feb0a633d03	2026-06-04 18:26:12.36194
08eb1315-fcc1-49c1-9ca5-33b37c022ad0	0aa7a78a-2fa0-4d00-bcd5-42e9d7f6547b	8b932f7a-90d5-4490-9876-b1032c39dcfc	{"x": 193, "y": 1, "z": 918}	2026-06-04 18:32:43.440346	2026-06-04 18:34:43.44	t	899b45d8-6d56-4903-b1f3-788a00f60064	2026-06-04 18:32:43.446154
\.


--
-- Data for Name: world_objects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_objects (id, type, name, model_path, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, building_id, created_at, updated_at, model_type, threejs_code, world_id, video_props, has_collision, custom_config) FROM stdin;
18	geometry_building	village_场景_1770866283752_cottage_8	geometry:cottage	-32.03512156377808	0	5.943259297759987	0	6.116993651678322	0	0.945358093956508	0.945358093956508	0.945358093956508	\N	2026-02-12 11:20:46.092684	2026-06-10 15:59:47.4545	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
17	geometry_building	village_场景_1770866283752_cottage_7	geometry:cottage	0.7298867809268528	0	-24.00167110858869	0	2.1927898287438516	0	0.7448165162239695	0.7448165162239695	0.7448165162239695	\N	2026-02-12 11:20:46.09214	2026-06-10 15:59:52.045226	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
21	geometry_nature	village_场景_1770866283752_tree_11	geometry:tree	0.91	0	13.68	0	5.534788123924418	0	1.29	1.29	1.29	\N	2026-02-12 11:20:46.094164	2026-07-10 16:37:44.715524	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
15	geometry_building	village_场景_1770866283752_cottage_5	geometry:cottage	1.87	0	23.03	0	1.8332938462948438	0	0.91	0.91	0.91	\N	2026-02-12 11:20:46.090897	2026-07-07 17:38:23.535252	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
493	media_image	æ¬¢è¿æ¥å°ä½ çä¸ç_å¼ å¾·å¿.jpg	/uploads/media/images/img-1785915006276-246803648.jpg	-23.319104683143618	11.554636976537525	14.87950237213294	-3.141592653589793	0.08379118458797982	-3.141592653589793	15.840569355571517	8.910320262508979	1.9800711694464397	\N	2026-08-05 15:30:20.780758	2026-08-05 15:33:12.952176	image	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
101	geometry_nature	village_1770877975255_tree_18	geometry:tree	-23.82465733509143	0.8344378915146944	25.145636802043885	0	3.0383565534113965	0	10.82786429304197	10.82786429304197	10.82786429304197	\N	2026-02-12 14:32:55.923436	2026-08-05 15:33:20.267278	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
115	geometry_building	city_1770879830289_skyscraper_3	geometry:skyscraper	54.05	0	-16	0	1.8601719167755564	0	1.29	1.29	1.29	\N	2026-02-12 15:03:50.966849	2026-07-13 16:26:58.032974	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
490	threejs_code	粉色宫殿	\N	37.69	26.71	42.03	0	0	0	1.9	1.9	1.9	\N	2026-07-26 10:03:57.826685	2026-07-27 18:11:30.88931	\N	/* 自动声明的导入变量（运行器已提供常见类，其余从 THREE 命名空间兜底） */\nvar OrbitControls = (typeof OrbitControls !== 'undefined') ? OrbitControls : (THREE.OrbitControls || function(){});\n\n\n// ============================================================\n// 场景\n// ============================================================\nconst app = document.getElementById('app');\nconst scene = new THREE.Scene();\n\n// 深邃星空背景\nconst starfieldCanvas = document.createElement('canvas');\nstarfieldCanvas.width = 512; starfieldCanvas.height = 512;\nconst sCtx = starfieldCanvas.getContext('2d');\nconst sg = sCtx.createRadialGradient(256, 256, 0, 256, 256, 256);\nsg.addColorStop(0, '#1a0a30');\nsg.addColorStop(0.4, '#0e0820');\nsg.addColorStop(1, '#050210');\nsCtx.fillStyle = sg; sCtx.fillRect(0, 0, 512, 512);\nfor (let i = 0; i < 400; i++) {\n  const b = 100 + Math.random() * 155;\n  sCtx.fillStyle = `rgb(${b},${b},${b + Math.random() * 100})`;\n  sCtx.beginPath();\n  sCtx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 2 + 0.3, 0, Math.PI * 2);\n  sCtx.fill();\n}\nconst starTex = new THREE.CanvasTexture(starfieldCanvas);\nstarTex.encoding = THREE.sRGBEncoding;\nscene.background = starTex;\n\nconst camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);\ncamera.position.set(6, 4, 8);\n\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\nrenderer.setSize(window.innerWidth, window.innerHeight);\nrenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));\nrenderer.toneMapping = THREE.ACESFilmicToneMapping;\nrenderer.toneMappingExposure = 1.2;\nrenderer.outputEncoding = THREE.sRGBEncoding;\nrenderer.shadowMap.enabled = true;\nrenderer.shadowMap.type = THREE.PCFSoftShadowMap;\napp.appendChild(renderer.domElement);\n\nconst controls = new OrbitControls(camera, renderer.domElement);\ncontrols.target.set(0, 1.5, 0);\ncontrols.enableDamping = true;\ncontrols.dampingFactor = 0.06;\ncontrols.minDistance = 3;\ncontrols.maxDistance = 20;\ncontrols.autoRotate = true;\ncontrols.autoRotateSpeed = 0.8;\n\n// ============================================================\n// 灯光 — 仙幻色调\n// ============================================================\nconst moonLight = new THREE.DirectionalLight(0xA080FF, 2.5);\nmoonLight.position.set(-5, 10, -3);\nmoonLight.castShadow = true;\nmoonLight.shadow.mapSize.width = 512;\nmoonLight.shadow.mapSize.height = 512;\nscene.add(moonLight);\n\nconst warmLight = new THREE.DirectionalLight(0xFFC080, 0.8);\nwarmLight.position.set(4, 3, 2);\nscene.add(warmLight);\n\nconst rimLight = new THREE.DirectionalLight(0x6080FF, 0.6);\nrimLight.position.set(-3, -2, -6);\nscene.add(rimLight);\n\nconst ambColor = new THREE.Color(0x201030);\nconst ambient = new THREE.AmbientLight(ambColor, 0.4);\nscene.add(ambient);\n\n// ============================================================\n// 材质\n// ============================================================\nconst wallMat = new THREE.MeshStandardMaterial({\n  color: 0xD4C8E8, roughness: 0.5, metalness: 0.0, emissive: 0x100820, emissiveIntensity: 0.05,\n});\nconst roofMat = new THREE.MeshStandardMaterial({\n  color: 0xCC3388, roughness: 0.4, metalness: 0.1, emissive: 0x440022, emissiveIntensity: 0.08,\n});\nconst pillarMat = new THREE.MeshStandardMaterial({\n  color: 0xCC4466, roughness: 0.3, metalness: 0.05,\n});\nconst goldMat = new THREE.MeshStandardMaterial({\n  color: 0xFFD080, roughness: 0.25, metalness: 0.3,\n});\nconst glowMat = new THREE.MeshStandardMaterial({\n  color: 0xFF88CC, roughness: 0.2, metalness: 0,\n  emissive: 0xFF66AA, emissiveIntensity: 0.6,\n});\nconst cloudMat = new THREE.MeshPhysicalMaterial({\n  color: 0xE0D0FF, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.25,\n});\nconst lanternMat = new THREE.MeshStandardMaterial({\n  color: 0xFF6644, roughness: 0.3, metalness: 0,\n  emissive: 0xFF4400, emissiveIntensity: 2.0,\n});\nconst bridgeMat = new THREE.MeshStandardMaterial({\n  color: 0xC8B898, roughness: 0.6, metalness: 0.02,\n});\n\n// ============================================================\n// 主建筑 Group\n// ============================================================\nconst house = new THREE.Group();\nhouse.position.y = 0;\nscene.add(house);\n\n// ---------- 云雾底座 ----------\nconst baseCloud = new THREE.Mesh(new THREE.SphereGeometry(2.8, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), cloudMat);\nbaseCloud.position.y = -0.3;\nbaseCloud.scale.set(1, 0.3, 1.2);\nhouse.add(baseCloud);\n\n// 几个副云团\nfor (let i = 0; i < 8; i++) {\n  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random() * 0.6, 12, 8), cloudMat);\n  const a = Math.random() * Math.PI * 2;\n  const r = 1.8 + Math.random() * 1.2;\n  puff.position.set(Math.cos(a) * r, -0.35 + Math.random() * 0.15, Math.sin(a) * r);\n  puff.scale.set(1, 0.3 + Math.random() * 0.2, 0.8 + Math.random() * 0.4);\n  house.add(puff);\n}\n\n// ---------- 基台 ----------\nconst base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.3, 16), wallMat);\nbase.position.y = 0.15;\nhouse.add(base);\n\n// 基台金边\nconst baseGold = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.04, 8, 32), goldMat);\nbaseGold.position.y = 0.3;\nbaseGold.rotation.x = Math.PI / 2;\nhouse.add(baseGold);\n\n// ---------- 主楼（两层楼阁）----------\n// 一层\nconst floor1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.8, 16), wallMat);\nfloor1.position.y = 0.7;\nhouse.add(floor1);\n\n// 一层柱子\nfor (let i = 0; i < 8; i++) {\n  const a = (i / 8) * Math.PI * 2;\n  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), pillarMat);\n  pillar.position.set(Math.cos(a) * 1.1, 0.7, Math.sin(a) * 1.1);\n  house.add(pillar);\n}\n\n// 一层屋檐（翘角飞檐）\nfunction makeEaveLayer(radiusY, yPos, segments, scaleZ) {\n  const eave = new THREE.Mesh(new THREE.TorusGeometry(radiusY, 0.06, 12, segments), roofMat);\n  eave.position.y = yPos;\n  eave.rotation.x = Math.PI / 2;\n  eave.scale.z = scaleZ || 1;\n  house.add(eave);\n\n  // 翘角装饰（四个角）\n  for (let i = 0; i < 4; i++) {\n    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;\n    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 6), goldMat);\n    const tr = radiusY;\n    tip.position.set(Math.cos(a) * tr, yPos + 0.05, Math.sin(a) * tr);\n    tip.rotation.x = Math.PI / 2;\n    tip.rotation.z = -a;\n    house.add(tip);\n\n    // 翘角挂铃\n    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), goldMat);\n    bell.position.set(Math.cos(a) * (tr + 0.08), yPos - 0.1, Math.sin(a) * (tr + 0.08));\n    house.add(bell);\n  }\n}\nmakeEaveLayer(1.35, 1.1, 24);\n\n// ---------- 二层 ----------\nconst floor2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.7, 16), wallMat);\nfloor2.position.y = 1.5;\nhouse.add(floor2);\n\n// 二层柱子\nfor (let i = 0; i < 6; i++) {\n  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;\n  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 8), pillarMat);\n  pillar.position.set(Math.cos(a) * 0.75, 1.5, Math.sin(a) * 0.75);\n  house.add(pillar);\n}\n\n// 二层栏杆\nconst railMat = new THREE.MeshStandardMaterial({ color: 0xCCAACC, roughness: 0.4 });\nfor (let i = 0; i < 20; i++) {\n  const a = (i / 20) * Math.PI * 2;\n  const post = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.15, 0.015), railMat);\n  post.position.set(Math.cos(a) * 0.82, 1.28, Math.sin(a) * 0.82);\n  house.add(post);\n}\n\nmakeEaveLayer(0.95, 1.85, 20);\n\n// ---------- 主顶（华丽大屋顶）----------\nconst mainRoof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.8, 16), roofMat);\nmainRoof.position.y = 2.3;\nhouse.add(mainRoof);\n\n// 屋顶金顶\nconst spireBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.1, 8), goldMat);\nspireBase.position.y = 2.7;\nhouse.add(spireBase);\nconst spire = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 8), goldMat);\nspire.position.y = 2.85;\nhouse.add(spire);\n\n// 屋顶四条垂脊翘角\nfor (let i = 0; i < 4; i++) {\n  const a = (i / 4) * Math.PI * 2 + Math.PI / 4;\n  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 6), goldMat);\n  tip.position.set(Math.cos(a) * 0.6, 2.5, Math.sin(a) * 0.6);\n  tip.rotation.x = Math.PI / 3.5;\n  tip.rotation.z = -a;\n  house.add(tip);\n}\n\n// ---------- 悬浮的走廊/桥 ----------\nfor (let side of [-1, 1]) {\n  const bridgeGrp = new THREE.Group();\n  const bridgePlank = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.2), bridgeMat);\n  bridgeGrp.add(bridgePlank);\n  for (let j = 0; j < 3; j++) {\n    const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), railMat);\n    baluster.position.set(-0.4 + j * 0.4, 0.07, 0.1);\n    bridgeGrp.add(baluster);\n  }\n  bridgeGrp.position.set(side * 1.4, 0.6, 0.6);\n  bridgeGrp.rotation.y = side * 0.8;\n  house.add(bridgeGrp);\n}\n\n// ---------- 悬浮的亭子（两侧副楼）----------\nfunction makePavilion(x, z, rotY) {\n  const pav = new THREE.Group();\n\n  const pavFloor = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.15, 12), wallMat);\n  pavFloor.position.y = 0.08;\n  pav.add(pavFloor);\n\n  for (let i = 0; i < 4; i++) {\n    const a = (i / 4) * Math.PI * 2;\n    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6), pillarMat);\n    p.position.set(Math.cos(a) * 0.28, 0.28, Math.sin(a) * 0.28);\n    pav.add(p);\n  }\n\n  const pavRoof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.25, 12), roofMat);\n  pavRoof.position.y = 0.45;\n  pav.add(pavRoof);\n\n  const pavTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), goldMat);\n  pavTip.position.y = 0.6;\n  pav.add(pavTip);\n\n  pav.position.set(x, 0.8, z);\n  if (rotY) pav.rotation.y = rotY;\n  return pav;\n}\nhouse.add(makePavilion(2.0, 0, -0.5));\nhouse.add(makePavilion(-2.0, 0, 0.5));\n\n// ============================================================\n// 悬浮的小岛/岩石\n// ============================================================\nfunction makeFloatingIsland(x, z, y, scale) {\n  const grp = new THREE.Group();\n  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale * 0.5, 0),\n    new THREE.MeshStandardMaterial({ color: 0x4A3868, roughness: 0.8, emissive: 0x100820, emissiveIntensity: 0.05 }));\n  rock.scale.set(1, 0.4, 1);\n  grp.add(rock);\n\n  const cloudRing = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.6, scale * 0.08, 8, 24), cloudMat);\n  cloudRing.position.y = -scale * 0.1;\n  cloudRing.rotation.x = Math.PI / 2;\n  grp.add(cloudRing);\n\n  // 小光点\n  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), glowMat);\n  dot.position.y = scale * 0.3;\n  grp.add(dot);\n\n  grp.position.set(x, y, z);\n  return grp;\n}\nscene.add(makeFloatingIsland(3.5, 1.5, 1.2, 0.8));\nscene.add(makeFloatingIsland(-3.0, 2.0, 1.8, 0.6));\nscene.add(makeFloatingIsland(2.5, -2.0, 2.2, 0.7));\nscene.add(makeFloatingIsland(-3.5, -1.5, 1.0, 0.5));\n\n// ============================================================\n// 悬浮灯笼（动态旋转）\n// ============================================================\nconst lanterns = [];\nfunction makeLantern(x, y, z, color) {\n  const grp = new THREE.Group();\n\n  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), new THREE.MeshStandardMaterial({\n    color, roughness: 0.3, emissive: color, emissiveIntensity: 1.5,\n  }));\n  grp.add(body);\n\n  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12), goldMat);\n  topRing.position.y = 0.07;\n  grp.add(topRing);\n\n  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({\n    color, transparent: true, opacity: 0.08,\n  }));\n  grp.add(glow);\n\n  grp.position.set(x, y, z);\n  scene.add(grp);\n  lanterns.push(grp);\n  return grp;\n}\nconst lanternColors = [0xFF6644, 0xFFAA44, 0xFF4488, 0xAA66FF, 0x44CCFF];\nfor (let i = 0; i < 12; i++) {\n  const a = Math.random() * Math.PI * 2;\n  const r = 1.8 + Math.random() * 1.5;\n  const clr = lanternColors[i % lanternColors.length];\n  makeLantern(Math.cos(a) * r, 1.0 + Math.random() * 2.5, Math.sin(a) * r, clr);\n}\n\n// ============================================================\n// 粒子系统 1 — 星光粒子（缓慢上升飘散）\n// ============================================================\nconst starParticleCount = 800;\nconst starGeo = new THREE.BufferGeometry();\nconst starPos = new Float32Array(starParticleCount * 3);\nconst starSizes = new Float32Array(starParticleCount);\nconst starSpeeds = new Float32Array(starParticleCount);\nconst starDrifts = new Float32Array(starParticleCount * 3);\n\nfor (let i = 0; i < starParticleCount; i++) {\n  const a = Math.random() * Math.PI * 2;\n  const r = 0.5 + Math.random() * 5;\n  starPos[i * 3] = Math.cos(a) * r * (0.5 + Math.random() * 0.8);\n  starPos[i * 3 + 1] = Math.random() * 4 + 0.2;\n  starPos[i * 3 + 2] = Math.sin(a) * r * (0.5 + Math.random() * 0.8);\n  starSizes[i] = 0.02 + Math.random() * 0.06;\n  starSpeeds[i] = 0.1 + Math.random() * 0.3;\n  starDrifts[i * 3] = (Math.random() - 0.5) * 0.02;\n  starDrifts[i * 3 + 1] = 0.005 + Math.random() * 0.015;\n  starDrifts[i * 3 + 2] = (Math.random() - 0.5) * 0.02;\n}\nstarGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));\nstarGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));\n\nconst starMatP = new THREE.PointsMaterial({\n  color: 0xCCAAFF, size: 0.04, transparent: true, opacity: 0.8,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst starParticles = new THREE.Points(starGeo, starMatP);\nscene.add(starParticles);\n\n// ============================================================\n// 粒子系统 2 — 仙气/流光粒子（环绕建筑流动）\n// ============================================================\nconst flowCount = 400;\nconst flowGeo = new THREE.BufferGeometry();\nconst flowPos = new Float32Array(flowCount * 3);\nconst flowAngles = new Float32Array(flowCount);\nconst flowHeights = new Float32Array(flowCount);\nconst flowRadii = new Float32Array(flowCount);\nconst flowSpeedsArr = new Float32Array(flowCount);\n\nfor (let i = 0; i < flowCount; i++) {\n  flowAngles[i] = Math.random() * Math.PI * 2;\n  flowRadii[i] = 0.3 + Math.random() * 2.5;\n  flowHeights[i] = Math.random() * 3.5;\n  flowSpeedsArr[i] = 0.2 + Math.random() * 0.5;\n  flowPos[i * 3] = Math.cos(flowAngles[i]) * flowRadii[i];\n  flowPos[i * 3 + 1] = flowHeights[i];\n  flowPos[i * 3 + 2] = Math.sin(flowAngles[i]) * flowRadii[i];\n}\nflowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));\n\nconst flowMatP = new THREE.PointsMaterial({\n  color: 0xFF88CC, size: 0.035, transparent: true, opacity: 0.6,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst flowParticles = new THREE.Points(flowGeo, flowMatP);\nscene.add(flowParticles);\n\n// ============================================================\n// 粒子系统 3 — 飘落的发光花瓣/光羽\n// ============================================================\nconst petalCount = 150;\nconst petalGeo = new THREE.BufferGeometry();\nconst petalPos = new Float32Array(petalCount * 3);\nconst petalVel = new Float32Array(petalCount * 3);\nconst petalSizes = new Float32Array(petalCount);\nconst petalSeed = new Float32Array(petalCount);\n\nfor (let i = 0; i < petalCount; i++) {\n  petalPos[i * 3] = (Math.random() - 0.5) * 10;\n  petalPos[i * 3 + 1] = Math.random() * 6;\n  petalPos[i * 3 + 2] = (Math.random() - 0.5) * 10;\n  petalVel[i * 3] = (Math.random() - 0.5) * 0.008;\n  petalVel[i * 3 + 1] = -0.005 - Math.random() * 0.015;\n  petalVel[i * 3 + 2] = (Math.random() - 0.5) * 0.008;\n  petalSizes[i] = 0.03 + Math.random() * 0.05;\n  petalSeed[i] = Math.random() * Math.PI * 2;\n}\npetalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));\npetalGeo.setAttribute('size', new THREE.BufferAttribute(petalSizes, 1));\n\nconst petalMat = new THREE.PointsMaterial({\n  color: 0xFF99CC, size: 0.05, transparent: true, opacity: 0.5,\n  blending: THREE.AdditiveBlending, depthWrite: false,\n  sizeAttenuation: true,\n});\nconst petalParticles = new THREE.Points(petalGeo, petalMat);\nscene.add(petalParticles);\n\n// ============================================================\n// 环绕光晕环（动态旋转的大光环）\n// ============================================================\nconst ringMat = new THREE.MeshBasicMaterial({\n  color: 0x8844FF, transparent: true, opacity: 0.08, side: THREE.DoubleSide,\n});\nconst glowRing = new THREE.Mesh(new THREE.RingGeometry(2.8, 3.0, 64), ringMat);\nglowRing.rotation.x = Math.PI / 2.5;\nglowRing.position.y = 1.2;\nscene.add(glowRing);\n\nconst glowRing2 = new THREE.Mesh(new THREE.RingGeometry(3.8, 3.95, 64), new THREE.MeshBasicMaterial({\n  color: 0xFF66AA, transparent: true, opacity: 0.05, side: THREE.DoubleSide,\n}));\nglowRing2.rotation.x = Math.PI / 2.5 + 0.2;\nglowRing2.position.y = 1.8;\nscene.add(glowRing2);\n\n// ============================================================\n// 动画循环\n// ============================================================\ndocument.getElementById('loading').style.display = 'none';\n\nlet time = 0;\n\nfunction animate() {\n  requestAnimationFrame(animate);\n  time += 0.01;\n\n  controls.update();\n\n  // ---- 粒子1: 星光飘散 ----\n  const sp = starParticles.geometry.attributes.position.array;\n  for (let i = 0; i < starParticleCount; i++) {\n    sp[i * 3] += starDrifts[i * 3];\n    sp[i * 3 + 1] += starDrifts[i * 3 + 1];\n    sp[i * 3 + 2] += starDrifts[i * 3 + 2];\n    // 重置到底部\n    if (sp[i * 3 + 1] > 4.5) {\n      const a = Math.random() * Math.PI * 2;\n      const r = 0.5 + Math.random() * 5;\n      sp[i * 3] = Math.cos(a) * r * (0.5 + Math.random() * 0.8);\n      sp[i * 3 + 1] = 0;\n      sp[i * 3 + 2] = Math.sin(a) * r * (0.5 + Math.random() * 0.8);\n    }\n  }\n  starParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 粒子2: 环绕流光 ----\n  const fp = flowParticles.geometry.attributes.position.array;\n  for (let i = 0; i < flowCount; i++) {\n    flowAngles[i] += flowSpeedsArr[i] * 0.01;\n    fp[i * 3] = Math.cos(flowAngles[i]) * flowRadii[i];\n    fp[i * 3 + 2] = Math.sin(flowAngles[i]) * flowRadii[i];\n    // 轻微上下浮动\n    fp[i * 3 + 1] = flowHeights[i] + Math.sin(time * 0.5 + i) * 0.15;\n  }\n  flowParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 粒子3: 飘落花瓣 ----\n  const pp = petalParticles.geometry.attributes.position.array;\n  for (let i = 0; i < petalCount; i++) {\n    pp[i * 3] += petalVel[i * 3] + Math.sin(time + petalSeed[i]) * 0.002;\n    pp[i * 3 + 1] += petalVel[i * 3 + 1];\n    pp[i * 3 + 2] += petalVel[i * 3 + 2] + Math.cos(time + petalSeed[i]) * 0.002;\n    if (pp[i * 3 + 1] < -0.5) {\n      pp[i * 3] = (Math.random() - 0.5) * 10;\n      pp[i * 3 + 1] = 5 + Math.random() * 1;\n      pp[i * 3 + 2] = (Math.random() - 0.5) * 10;\n    }\n  }\n  petalParticles.geometry.attributes.position.needsUpdate = true;\n\n  // ---- 灯笼旋转 ----\n  lanterns.forEach((l, i) => {\n    l.rotation.y += 0.005 * (i % 2 === 0 ? 1 : -1);\n    l.position.y += Math.sin(time * 0.5 + i * 1.7) * 0.0005;\n  });\n\n  // ---- 光环旋转 ----\n  glowRing.rotation.y += 0.003;\n  glowRing2.rotation.y -= 0.004;\n\n  // ---- 光晕脉冲 ----\n  const pulse = 0.6 + Math.sin(time * 1.5) * 0.4;\n  glowMat.emissiveIntensity = pulse;\n  lanternMat.emissiveIntensity = 1.5 + Math.sin(time * 1.2) * 0.8;\n\n  renderer.render(scene, camera);\n}\nanimate();\n\nwindow.addEventListener('resize', () => {\n  camera.aspect = window.innerWidth / window.innerHeight;\n  camera.updateProjectionMatrix();\n  renderer.setSize(window.innerWidth, window.innerHeight);\n});	1	{"loop": false, "muted": true, "autoplay": false}	t	null
489	threejs_code	Three.js 云端仙气城堡粒子效果	\N	29.31	27.649963392599275	-6.17	0	0	0	0.75	0.75	0.75	\N	2026-07-24 18:14:50.733337	2026-07-28 16:49:09.200331	\N	// 等待页面加载完成\n        document.addEventListener('DOMContentLoaded', () => {\n            // 初始化变量\n            let scene, camera, renderer, controls;\n            let castle, clouds = [], stars = [], flowParticles = [];\n            let cloudSystem, starSystem, flowSystem;\n            let clock = new THREE.Clock();\n            let particleCount = 0;\n            \n            // 效果开关\n            let cloudsEnabled = true;\n            let starsEnabled = true;\n            let flowEnabled = true;\n            \n            // 初始化Three.js场景\n            function init() {\n                // 创建场景\n                scene = new THREE.Scene();\n                scene.fog = new THREE.FogExp2(0x0a1a2a, 0.002);\n                \n                // 创建相机\n                camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);\n                camera.position.set(30, 25, 50);\n                \n                // 创建渲染器\n                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\n                renderer.setSize(window.innerWidth, window.innerHeight);\n                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));\n                renderer.shadowMap.enabled = true;\n                renderer.shadowMap.type = THREE.PCFSoftShadowMap;\n                document.getElementById('canvas-container').appendChild(renderer.domElement);\n                \n                // 添加轨道控制器\n                controls = new THREE.OrbitControls(camera, renderer.domElement);\n                controls.enableDamping = true;\n                controls.dampingFactor = 0.05;\n                controls.maxPolarAngle = Math.PI / 2 - 0.1;\n                controls.minDistance = 20;\n                controls.maxDistance = 150;\n                \n                // 添加光源\n                addLights();\n                \n                // 创建城堡\n                createCastle();\n                \n                // 创建粒子系统\n                createCloudSystem();\n                createStarSystem();\n                createFlowSystem();\n                \n                // 隐藏加载界面\n                setTimeout(() => {\n                    document.querySelector('.loading').style.opacity = '0';\n                    setTimeout(() => {\n                        document.querySelector('.loading').style.display = 'none';\n                    }, 1000);\n                }, 1500);\n                \n                // 更新粒子计数显示\n                updateParticleCount();\n                \n                // 窗口大小调整事件\n                window.addEventListener('resize', onWindowResize);\n                \n                // 绑定控制按钮事件\n                document.getElementById('toggleClouds').addEventListener('click', toggleClouds);\n                document.getElementById('toggleStars').addEventListener('click', toggleStars);\n                document.getElementById('toggleFlow').addEventListener('click', toggleFlow);\n                document.getElementById('resetView').addEventListener('click', resetView);\n            }\n            \n            // 添加光源\n            function addLights() {\n                // 环境光\n                const ambientLight = new THREE.AmbientLight(0x334455, 0.4);\n                scene.add(ambientLight);\n                \n                // 主方向光（模拟月光）\n                const moonLight = new THREE.DirectionalLight(0xcceeff, 0.8);\n                moonLight.position.set(50, 80, 30);\n                moonLight.castShadow = true;\n                moonLight.shadow.mapSize.width = 2048;\n                moonLight.shadow.mapSize.height = 2048;\n                moonLight.shadow.camera.left = -100;\n                moonLight.shadow.camera.right = 100;\n                moonLight.shadow.camera.top = 100;\n                moonLight.shadow.camera.bottom = -100;\n                scene.add(moonLight);\n                \n                // 辅助光（从下方）\n                const bottomLight = new THREE.DirectionalLight(0x6688aa, 0.3);\n                bottomLight.position.set(0, -50, 0);\n                scene.add(bottomLight);\n                \n                // 点光源（城堡中心发光）\n                const pointLight = new THREE.PointLight(0xaaddff, 1, 100);\n                pointLight.position.set(0, 15, 0);\n                scene.add(pointLight);\n                \n                // 半球光（天空到地面渐变）\n                const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x223344, 0.3);\n                scene.add(hemiLight);\n            }\n            \n            // 创建城堡\n            function createCastle() {\n                castle = new THREE.Group();\n                \n                // 城堡基座（浮空岛）\n                const islandGeometry = new THREE.CylinderGeometry(18, 22, 4, 32);\n                const islandMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x445566,\n                    roughness: 0.9,\n                    metalness: 0.1\n                });\n                const island = new THREE.Mesh(islandGeometry, islandMaterial);\n                island.castShadow = true;\n                island.receiveShadow = true;\n                island.position.y = -2;\n                castle.add(island);\n                \n                // 岛屿顶部草地\n                const grassGeometry = new THREE.CylinderGeometry(17.5, 17.5, 0.5, 32);\n                const grassMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x44aa66,\n                    roughness: 0.9\n                });\n                const grass = new THREE.Mesh(grassGeometry, grassMaterial);\n                grass.position.y = 0.25;\n                grass.castShadow = true;\n                grass.receiveShadow = true;\n                castle.add(grass);\n                \n                // 主城堡建筑\n                const mainTowerGeometry = new THREE.BoxGeometry(10, 12, 10);\n                const mainTowerMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xddeeff,\n                    roughness: 0.3,\n                    metalness: 0.7\n                });\n                const mainTower = new THREE.Mesh(mainTowerGeometry, mainTowerMaterial);\n                mainTower.position.y = 8;\n                mainTower.castShadow = true;\n                mainTower.receiveShadow = true;\n                castle.add(mainTower);\n                \n                // 城堡屋顶\n                const roofGeometry = new THREE.ConeGeometry(8, 5, 4);\n                const roofMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0x88aadd,\n                    roughness: 0.2,\n                    metalness: 0.8\n                });\n                const roof = new THREE.Mesh(roofGeometry, roofMaterial);\n                roof.position.y = 14.5;\n                roof.rotation.y = Math.PI / 4;\n                roof.castShadow = true;\n                castle.add(roof);\n                \n                // 添加塔楼\n                const towerPositions = [\n                    { x: 8, y: 5, z: 8 },\n                    { x: -8, y: 5, z: 8 },\n                    { x: 8, y: 5, z: -8 },\n                    { x: -8, y: 5, z: -8 }\n                ];\n                \n                towerPositions.forEach(pos => {\n                    const towerGeometry = new THREE.CylinderGeometry(1.5, 2, 8, 8);\n                    const tower = new THREE.Mesh(towerGeometry, mainTowerMaterial);\n                    tower.position.set(pos.x, pos.y, pos.z);\n                    tower.castShadow = true;\n                    tower.receiveShadow = true;\n                    castle.add(tower);\n                    \n                    // 塔顶\n                    const towerRoofGeometry = new THREE.ConeGeometry(2, 3, 8);\n                    const towerRoof = new THREE.Mesh(towerRoofGeometry, roofMaterial);\n                    towerRoof.position.set(pos.x, pos.y + 5.5, pos.z);\n                    towerRoof.castShadow = true;\n                    castle.add(towerRoof);\n                });\n                \n                // 添加桥梁\n                const bridgeGeometry = new THREE.BoxGeometry(20, 0.5, 2);\n                const bridgeMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xccddff,\n                    roughness: 0.3,\n                    metalness: 0.6,\n                    emissive: 0x224466,\n                    emissiveIntensity: 0.2\n                });\n                \n                const bridge1 = new THREE.Mesh(bridgeGeometry, bridgeMaterial);\n                bridge1.position.set(0, 3, 12);\n                bridge1.castShadow = true;\n                castle.add(bridge1);\n                \n                const bridge2 = new THREE.Mesh(bridgeGeometry, bridgeMaterial);\n                bridge2.position.set(12, 3, 0);\n                bridge2.rotation.y = Math.PI / 2;\n                bridge2.castShadow = true;\n                castle.add(bridge2);\n                \n                // 添加发光水晶\n                const crystalGeometry = new THREE.OctahedronGeometry(1.5, 0);\n                const crystalMaterial = new THREE.MeshStandardMaterial({ \n                    color: 0xaaddff,\n                    roughness: 0.1,\n                    metalness: 0.9,\n                    emissive: 0x88bbff,\n                    emissiveIntensity: 0.5\n                });\n                \n                const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);\n                crystal.position.set(0, 16, 0);\n                crystal.castShadow = true;\n                castle.add(crystal);\n                \n                // 添加栏杆\n                for (let i = 0; i < 12; i++) {\n                    const angle = (i / 12) * Math.PI * 2;\n                    const railingGeometry = new THREE.BoxGeometry(0.3, 1.5, 0.3);\n                    const railing = new THREE.Mesh(railingGeometry, roofMaterial);\n                    railing.position.set(\n                        Math.cos(angle) * 15,\n                        1.5,\n                        Math.sin(angle) * 15\n                    );\n                    railing.castShadow = true;\n                    castle.add(railing);\n                }\n                \n                scene.add(castle);\n            }\n            \n            // 创建云雾系统\n            function createCloudSystem() {\n                const cloudGroup = new THREE.Group();\n                const cloudGeometry = new THREE.SphereGeometry(1, 8, 8);\n                const cloudMaterial = new THREE.MeshStandardMaterial({\n                    color: 0xffffff,\n                    transparent: true,\n                    opacity: 0.6,\n                    fog: true\n                });\n                \n                // 创建多个云朵\n                for (let i = 0; i < 25; i++) {\n                    const cloud = new THREE.Group();\n                    \n                    // 每朵云由多个球体组成\n                    const cloudParts = Math.floor(Math.random() * 4) + 3;\n                    for (let j = 0; j < cloudParts; j++) {\n                        const part = new THREE.Mesh(cloudGeometry, cloudMaterial);\n                        part.scale.set(\n                            Math.random() * 2 + 1,\n                            Math.random() * 1.5 + 0.5,\n                            Math.random() * 2 + 1\n                        );\n                        part.position.set(\n                            (Math.random() - 0.5) * 6,\n                            (Math.random() - 0.5) * 2,\n                            (Math.random() - 0.5) * 6\n                        );\n                        cloud.add(part);\n                    }\n                    \n                    // 随机位置\n                    cloud.position.set(\n                        (Math.random() - 0.5) * 120,\n                        Math.random() * 20 - 10,\n                        (Math.random() - 0.5) * 120\n                    );\n                    \n                    // 随机大小\n                    const scale = Math.random() * 1.5 + 0.8;\n                    cloud.scale.set(scale, scale, scale);\n                    \n                    cloud.userData = {\n                        speedX: (Math.random() - 0.5) * 0.02,\n                        speedZ: (Math.random() - 0.5) * 0.02,\n                        floatSpeed: Math.random() * 0.01 + 0.005,\n                        initialY: cloud.position.y\n                    };\n                    \n                    cloudGroup.add(cloud);\n                    clouds.push(cloud);\n                    particleCount += cloudParts;\n                }\n                \n                cloudSystem = cloudGroup;\n                scene.add(cloudSystem);\n            }\n            \n            // 创建星空系统\n            function createStarSystem() {\n                const starGroup = new THREE.Group();\n                const starGeometry = new THREE.BufferGeometry();\n                const starCount = 2000;\n                \n                const positions = new Float32Array(starCount * 3);\n                const colors = new Float32Array(starCount * 3);\n                const sizes = new Float32Array(starCount);\n                \n                // 创建星星位置和属性\n                for (let i = 0; i < starCount; i++) {\n                    const i3 = i * 3;\n                    \n                    // 随机位置（球形分布）\n                    const radius = 150 + Math.random() * 100;\n                    const theta = Math.random() * Math.PI * 2;\n                    const phi = Math.acos(2 * Math.random() - 1);\n                    \n                    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);\n                    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);\n                    positions[i3 + 2] = radius * Math.cos(phi);\n                    \n                    // 随机颜色（偏蓝白）\n                    const colorIntensity = 0.7 + Math.random() * 0.3;\n                    colors[i3] = 0.8 * colorIntensity;\n                    colors[i3 + 1] = 0.9 * colorIntensity;\n                    colors[i3 + 2] = 1.0 * colorIntensity;\n                    \n                    // 随机大小\n                    sizes[i] = Math.random() * 1.5 + 0.5;\n                }\n                \n                starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));\n                starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));\n                starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));\n                \n                // 星星材质\n                const starMaterial = new THREE.PointsMaterial({\n                    size: 1.5,\n                    vertexColors: true,\n                    transparent: true,\n                    opacity: 0.8,\n                    blending: THREE.AdditiveBlending\n                });\n                \n                const stars = new THREE.Points(starGeometry, starMaterial);\n                starGroup.add(stars);\n                starSystem = starGroup;\n                scene.add(starSystem);\n                \n                particleCount += starCount;\n            }\n            \n            // 创建流光系统\n            function createFlowSystem() {\n                const flowGroup = new THREE.Group();\n                const flowCount = 300;\n                const flowGeometry = new THREE.BufferGeometry();\n                \n                const positions = new Float32Array(flowCount * 3);\n                const colors = new Float32Array(flowCount * 3);\n                const sizes = new Float32Array(flowCount);\n                \n                // 创建流光粒子\n                for (let i = 0; i < flowCount; i++) {\n                    const i3 = i * 3;\n                    \n                    // 初始位置在城堡周围\n                    const radius = 20 + Math.random() * 40;\n                    const angle = Math.random() * Math.PI * 2;\n                    const height = Math.random() * 30;\n                    \n                    positions[i3] = Math.cos(angle) * radius;\n                    positions[i3 + 1] = height;\n                    positions[i3 + 2] = Math.sin(angle) * radius;\n                    \n                    // 流光颜色（蓝紫色调）\n                    colors[i3] = 0.5 + Math.random() * 0.5; // R\n                    colors[i3 + 1] = 0.6 + Math.random() * 0.4; // G\n                    colors[i3 + 2] = 0.9 + Math.random() * 0.1; // B\n                    \n                    // 粒子大小\n                    sizes[i] = Math.random() * 2 + 0.5;\n                    \n                    // 存储粒子数据\n                    flowParticles.push({\n                        angle: angle,\n                        radius: radius,\n                        height: height,\n                        speed: 0.01 + Math.random() * 0.03,\n                        verticalSpeed: (Math.random() - 0.5) * 0.02,\n                        colorOffset: Math.random() * Math.PI * 2\n                    });\n                }\n                \n                flowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));\n                flowGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));\n                flowGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));\n                \n                // 流光材质\n                const flowMaterial = new THREE.PointsMaterial({\n                    size: 2,\n                    vertexColors: true,\n                    transparent: true,\n                    opacity: 0.7,\n                    blending: THREE.AdditiveBlending\n                });\n                \n                const flows = new THREE.Points(flowGeometry, flowMaterial);\n                flowGroup.add(flows);\n                flowSystem = flowGroup;\n                scene.add(flowSystem);\n                \n                particleCount += flowCount;\n            }\n            \n            // 更新粒子计数显示\n            function updateParticleCount() {\n                document.getElementById('particleCount').textContent = particleCount.toLocaleString();\n            }\n            \n            // 切换云雾显示\n            function toggleClouds() {\n                cloudsEnabled = !cloudsEnabled;\n                cloudSystem.visible = cloudsEnabled;\n                document.getElementById('toggleClouds').textContent = \n                    cloudsEnabled ? '云雾开关' : '云雾开启';\n            }\n            \n            // 切换星光显示\n            function toggleStars() {\n                starsEnabled = !starsEnabled;\n                starSystem.visible = starsEnabled;\n                document.getElementById('toggleStars').textContent = \n                    starsEnabled ? '星光开关' : '星光开启';\n            }\n            \n            // 切换流光显示\n            function toggleFlow() {\n                flowEnabled = !flowEnabled;\n                flowSystem.visible = flowEnabled;\n                document.getElementById('toggleFlow').textContent = \n                    flowEnabled ? '流光开关' : '流光开启';\n            }\n            \n            // 重置视角\n            function resetView() {\n                controls.reset();\n            }\n            \n            // 窗口大小调整处理\n            function onWindowResize() {\n                camera.aspect = window.innerWidth / window.innerHeight;\n                camera.updateProjectionMatrix();\n                renderer.setSize(window.innerWidth, window.innerHeight);\n            }\n            \n            // 动画循环\n            function animate() {\n                requestAnimationFrame(animate);\n                \n                const delta = clock.getDelta();\n                const time = clock.getElapsedTime();\n                \n                // 更新控制器\n                controls.update();\n                \n                // 城堡轻微浮动\n                castle.position.y = Math.sin(time * 0.3) * 0.3;\n                castle.rotation.y += 0.001;\n                \n                // 更新云雾\n                if (cloudsEnabled) {\n                    clouds.forEach(cloud => {\n                        const data = cloud.userData;\n                        \n                        // 水平移动\n                        cloud.position.x += data.speedX;\n                        cloud.position.z += data.speedZ;\n                        \n                        // 垂直浮动\n                        cloud.position.y = data.initialY + Math.sin(time * data.floatSpeed) * 2;\n                        \n                        // 边界检查，让云朵循环移动\n                        if (cloud.position.x > 70) cloud.position.x = -70;\n                        if (cloud.position.x < -70) cloud.position.x = 70;\n                        if (cloud.position.z > 70) cloud.position.z = -70;\n                        if (cloud.position.z < -70) cloud.position.z = 70;\n                    });\n                }\n                \n                // 更新流光\n                if (flowEnabled && flowSystem) {\n                    const positions = flowSystem.children[0].geometry.attributes.position.array;\n                    const colors = flowSystem.children[0].geometry.attributes.color.array;\n                    \n                    for (let i = 0; i < flowParticles.length; i++) {\n                        const particle = flowParticles[i];\n                        const i3 = i * 3;\n                        \n                        // 更新角度（旋转运动）\n                        particle.angle += particle.speed;\n                        \n                        // 更新高度（上下浮动）\n                        particle.height += particle.verticalSpeed;\n                        \n                        // 边界检查，重置高度\n                        if (particle.height > 35) particle.verticalSpeed = -Math.abs(particle.verticalSpeed);\n                        if (particle.height < 0) particle.verticalSpeed = Math.abs(particle.verticalSpeed);\n                        \n                        // 更新位置\n                        positions[i3] = Math.cos(particle.angle) * particle.radius;\n                        positions[i3 + 1] = particle.height;\n                        positions[i3 + 2] = Math.sin(particle.angle) * particle.radius;\n                        \n                        // 更新颜色（随时间变化）\n                        const colorVariation = Math.sin(time * 0.5 + particle.colorOffset) * 0.2;\n                        colors[i3] = 0.5 + colorVariation; // R\n                        colors[i3 + 1] = 0.6 + colorVariation * 0.5; // G\n                        colors[i3 + 2] = 0.9 + colorVariation; // B\n                    }\n                    \n                    flowSystem.children[0].geometry.attributes.position.needsUpdate = true;\n                    flowSystem.children[0].geometry.attributes.color.needsUpdate = true;\n                }\n                \n                // 渲染场景\n                renderer.render(scene, camera);\n            }\n            \n            // 启动应用\n            init();\n            animate();\n        });	1	{"loop": false, "muted": true, "autoplay": false}	t	null
16	geometry_building	village_场景_1770866283752_cottage_6	geometry:cottage	4.624348100384106	0	-4.742789925511639	0	0.39508847992008517	0	0.902403222208512	0.902403222208512	0.902403222208512	\N	2026-02-12 11:20:46.091596	2026-02-14 14:04:47.247036	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
482	uploaded_model	20260708	/models/uploaded/model-1783481710732-936486373.glb	67.11910710906156	11.725292292417919	33.54424764080623	0	0	0	0.058259813345299546	0.058259813345299546	0.058259813345299546	\N	2026-07-09 14:24:04.952409	2026-07-28 17:30:13.728023	gltf	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
12	geometry_terrain	village_场景_1770866283752_mountain_2	geometry:mountain	22.404215772665424	0	-44.11286529517605	0	5.365274543170969	0	1	1	1	\N	2026-02-12 11:20:46.089112	2026-02-12 11:20:46.089112	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
20	geometry_nature	village_场景_1770866283752_tree_10	geometry:tree	19.738088179812117	0	8.589329325070384	0	4.75514609990456	0	0.9348083812578469	0.9348083812578469	0.9348083812578469	\N	2026-02-12 11:20:46.093731	2026-02-12 11:20:46.093731	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
13	geometry_terrain	village_场景_1770866283752_mountain_3	geometry:mountain	24.708965539019424	0	-33.72110372768181	0	4.138418380732855	0	1	1	1	\N	2026-02-12 11:20:46.089759	2026-02-26 17:38:55.716935	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
11	geometry_terrain	village_场景_1770866283752_mountain_1	geometry:mountain	-24.72932053784593	0	-38.36586398428426	0	1.2868485368789193	0	1	1	1	\N	2026-02-12 11:20:46.059493	2026-03-02 11:20:45.503669	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
22	geometry_nature	village_场景_1770866283752_tree_12	geometry:tree	0.08844699283411828	0	18.46437832806177	0	4.810613708688834	0	1.2002450094578494	1.2002450094578494	1.2002450094578494	\N	2026-02-12 11:20:46.094589	2026-03-17 16:30:41.56192	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
19	geometry_nature	village_场景_1770866283752_tree_9	geometry:tree	1.4567993803632104	0	-14.448611964886114	0	5.449704676900236	0	1.2077199224302344	1.2077199224302344	1.2077199224302344	\N	2026-02-12 11:20:46.093281	2026-04-25 16:59:29.445533	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
26	geometry_nature	village_场景_1770866283752_tree_16	geometry:tree	9.393802441514243	0	-13.291589042678238	0	1.2694639613491006	0	1.2419331792718897	1.2419331792718897	1.2419331792718897	\N	2026-02-12 11:20:46.097371	2026-02-12 11:20:46.097371	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
27	geometry_nature	village_场景_1770866283752_tree_17	geometry:tree	-7.2627530052410005	0	11.72494515585813	0	5.401348045526824	0	0.7663464299686128	0.7663464299686128	0.7663464299686128	\N	2026-02-12 11:20:46.097771	2026-02-12 11:20:46.097771	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
29	geometry_decoration	village_场景_1770866283752_fence_19	geometry:fence	9.376322456381649	0	0	0	3.564593655194794	0	0.9925050799578455	0.9925050799578455	0.9925050799578455	\N	2026-02-12 11:20:46.09857	2026-02-12 11:20:46.09857	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
30	geometry_decoration	village_场景_1770866283752_fence_20	geometry:fence	6.660096771729164	0	6.660096771729163	0	1.6404626677855025	0	0.9775196590851596	0.9775196590851596	0.9775196590851596	\N	2026-02-12 11:20:46.098979	2026-02-12 11:20:46.098979	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
31	geometry_decoration	village_场景_1770866283752_fence_21	geometry:fence	5.757695483321282e-16	0	9.403030306093175	0	1.8409652867792958	0	0.8350285725223427	0.8350285725223427	0.8350285725223427	\N	2026-02-12 11:20:46.099395	2026-02-12 11:20:46.099395	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
32	geometry_decoration	village_场景_1770866283752_fence_22	geometry:fence	-5.786402906978163	0	5.7864029069781635	0	0.40633458738093653	0	0.8184023399307201	0.8184023399307201	0.8184023399307201	\N	2026-02-12 11:20:46.099805	2026-02-12 11:20:46.099805	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
33	geometry_decoration	village_场景_1770866283752_fence_23	geometry:fence	-9.523014884132841	0	1.1662329696085888e-15	0	3.6914462996171458	0	0.8639339997615809	0.8639339997615809	0.8639339997615809	\N	2026-02-12 11:20:46.100225	2026-02-12 11:20:46.100225	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
34	geometry_decoration	village_场景_1770866283752_fence_24	geometry:fence	-6.795409088705915	0	-6.795409088705912	0	0.49039978347853685	0	0.8718500724920506	0.8718500724920506	0.8718500724920506	\N	2026-02-12 11:20:46.100627	2026-02-12 11:20:46.100627	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
35	geometry_decoration	village_场景_1770866283752_fence_25	geometry:fence	-1.4766368114784918e-15	0	-8.03843640199816	0	0.36181713935640314	0	0.8051852700645546	0.8051852700645546	0.8051852700645546	\N	2026-02-12 11:20:46.101261	2026-02-12 11:20:46.101261	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
36	geometry_decoration	village_场景_1770866283752_fence_26	geometry:fence	5.88300026191655	0	-5.8830002619165525	0	1.568594135165414	0	0.8267075710603049	0.8267075710603049	0.8267075710603049	\N	2026-02-12 11:20:46.102457	2026-02-12 11:20:46.102457	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
38	geometry_animal	village_场景_1770866283752_hen_28	geometry:hen	1.801947449351747	0	5.967104186292474	0	0.07273015231722982	0	0.8729056435594956	0.8729056435594956	0.8729056435594956	\N	2026-02-12 11:20:46.104753	2026-02-12 11:20:46.104753	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
39	geometry_animal	village_场景_1770866283752_cat_29	geometry:cat	-7.854754371208861	0	18.580514714849528	0	1.4489538367309014	0	0.7321020306829472	0.7321020306829472	0.7321020306829472	\N	2026-02-12 11:20:46.105316	2026-02-12 11:20:46.105316	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
40	geometry_terrain	village_场景_1770866496982_mountain_1	geometry:mountain	75.27067946215408	0	-40.623022966857775	0	1.2868485368789193	0	1	1	1	\N	2026-02-12 11:21:41.211383	2026-02-12 11:21:41.211383	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
41	geometry_terrain	village_场景_1770866496982_mountain_2	geometry:mountain	122.40421577266542	0	-44.11286529517605	0	5.365274543170969	0	1	1	1	\N	2026-02-12 11:21:41.212547	2026-02-12 11:21:41.212547	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
42	geometry_terrain	village_场景_1770866496982_mountain_3	geometry:mountain	124.70896553901943	0	-33.72110372768181	0	4.138418380732855	0	1	1	1	\N	2026-02-12 11:21:41.212994	2026-02-12 11:21:41.212994	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
43	geometry_building	village_场景_1770866496982_cottage_4	geometry:cottage	101.30402773475566	0	-1.3872730125302706	0	0.27237704168530324	0	0.8897964887583664	0.8897964887583664	0.8897964887583664	\N	2026-02-12 11:21:41.213462	2026-02-12 11:21:41.213462	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
44	geometry_building	village_场景_1770866496982_cottage_5	geometry:cottage	100.25628632846356	0	-4.0043667854762095	0	1.8333078498524829	0	0.9078283363379849	0.9078283363379849	0.9078283363379849	\N	2026-02-12 11:21:41.213887	2026-02-12 11:21:41.213887	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
46	geometry_building	village_场景_1770866496982_cottage_7	geometry:cottage	100.72988678092685	0	6.296520182910028	0	2.1927898287438516	0	0.7448165162239695	0.7448165162239695	0.7448165162239695	\N	2026-02-12 11:21:41.214683	2026-02-12 11:21:41.214683	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
47	geometry_building	village_场景_1770866496982_cottage_8	geometry:cottage	97.48425610913819	0	5.943259297759987	0	6.116993651678322	0	0.945358093956508	0.945358093956508	0.945358093956508	\N	2026-02-12 11:21:41.215068	2026-02-12 11:21:41.215068	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
48	geometry_nature	village_场景_1770866496982_tree_9	geometry:tree	94.6650445027883	0	-14.305304964983963	0	5.449704676900236	0	1.2077199224302344	1.2077199224302344	1.2077199224302344	\N	2026-02-12 11:21:41.215474	2026-02-12 11:21:41.215474	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
49	geometry_nature	village_场景_1770866496982_tree_10	geometry:tree	119.73808817981211	0	8.589329325070384	0	4.75514609990456	0	0.9348083812578469	0.9348083812578469	0.9348083812578469	\N	2026-02-12 11:21:41.215948	2026-02-12 11:21:41.215948	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
50	geometry_nature	village_场景_1770866496982_tree_11	geometry:tree	100.91068658235102	0	9.396602862148796	0	5.53470967602185	0	1.2922242878693058	1.2922242878693058	1.2922242878693058	\N	2026-02-12 11:21:41.216341	2026-02-12 11:21:41.216341	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
51	geometry_nature	village_场景_1770866496982_tree_12	geometry:tree	100.08844699283412	0	18.46437832806177	0	4.810613708688834	0	1.2002450094578494	1.2002450094578494	1.2002450094578494	\N	2026-02-12 11:21:41.216777	2026-02-12 11:21:41.216777	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
52	geometry_nature	village_场景_1770866496982_tree_13	geometry:tree	89.45695309230891	0	13.849698383219618	0	1.5862901639120313	0	1.3646991063635394	1.3646991063635394	1.3646991063635394	\N	2026-02-12 11:21:41.217244	2026-02-12 11:21:41.217244	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
53	geometry_nature	village_场景_1770866496982_tree_14	geometry:tree	105.93076060214116	0	1.4061926630565296	0	4.8781861787359855	0	1.1409510614116392	1.1409510614116392	1.1409510614116392	\N	2026-02-12 11:21:41.217762	2026-02-12 11:21:41.217762	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
54	geometry_nature	village_场景_1770866496982_tree_15	geometry:tree	97.13091567735448	0	19.787860477655002	0	5.181027039823783	0	0.8255735255147436	0.8255735255147436	0.8255735255147436	\N	2026-02-12 11:21:41.218532	2026-02-12 11:21:41.218532	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
55	geometry_nature	village_场景_1770866496982_tree_16	geometry:tree	109.39380244151424	0	-13.291589042678238	0	1.2694639613491006	0	1.2419331792718897	1.2419331792718897	1.2419331792718897	\N	2026-02-12 11:21:41.220112	2026-02-12 11:21:41.220112	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
56	geometry_nature	village_场景_1770866496982_tree_17	geometry:tree	92.737246994759	0	11.72494515585813	0	5.401348045526824	0	0.7663464299686128	0.7663464299686128	0.7663464299686128	\N	2026-02-12 11:21:41.221567	2026-02-12 11:21:41.221567	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
57	geometry_nature	village_场景_1770866496982_tree_18	geometry:tree	98.28254899396835	0	-7.2547998715373865	0	1.9446437886972838	0	1.1970072616915888	1.1970072616915888	1.1970072616915888	\N	2026-02-12 11:21:41.222424	2026-02-12 11:21:41.222424	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
58	geometry_decoration	village_场景_1770866496982_fence_19	geometry:fence	109.37632245638164	0	0	0	3.564593655194794	0	0.9925050799578455	0.9925050799578455	0.9925050799578455	\N	2026-02-12 11:21:41.222993	2026-02-12 11:21:41.222993	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
59	geometry_decoration	village_场景_1770866496982_fence_20	geometry:fence	106.66009677172916	0	6.660096771729163	0	1.6404626677855025	0	0.9775196590851596	0.9775196590851596	0.9775196590851596	\N	2026-02-12 11:21:41.223555	2026-02-12 11:21:41.223555	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
60	geometry_decoration	village_场景_1770866496982_fence_21	geometry:fence	100	0	9.403030306093175	0	1.8409652867792958	0	0.8350285725223427	0.8350285725223427	0.8350285725223427	\N	2026-02-12 11:21:41.22408	2026-02-12 11:21:41.22408	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
61	geometry_decoration	village_场景_1770866496982_fence_22	geometry:fence	94.21359709302183	0	5.7864029069781635	0	0.40633458738093653	0	0.8184023399307201	0.8184023399307201	0.8184023399307201	\N	2026-02-12 11:21:41.225287	2026-02-12 11:21:41.225287	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
62	geometry_decoration	village_场景_1770866496982_fence_23	geometry:fence	90.47698511586717	0	1.1662329696085888e-15	0	3.6914462996171458	0	0.8639339997615809	0.8639339997615809	0.8639339997615809	\N	2026-02-12 11:21:41.225986	2026-02-12 11:21:41.225986	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
37	geometry_animal	village_场景_1770866283752_hen_27	geometry:hen	-1.80582757988077	0	-15.556030746371427	0	3.9150969416075534	0	0.9534329963609827	0.9534329963609827	0.9534329963609827	\N	2026-02-12 11:20:46.10397	2026-02-12 16:49:08.604077	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
25	geometry_nature	village_场景_1770866283752_tree_15	geometry:tree	-2.8690843226455165	0	19.51585024567906	0	5.181027039823783	0	0.8255735255147436	0.8255735255147436	0.8255735255147436	\N	2026-02-12 11:20:46.096959	2026-03-17 16:30:33.652409	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
24	geometry_nature	village_场景_1770866283752_tree_14	geometry:tree	6.441297946053213	0	1.4061926630565296	0	4.8781861787359855	0	1.1409510614116392	1.1409510614116392	1.1409510614116392	\N	2026-02-12 11:20:46.096541	2026-02-13 18:06:42.026714	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
23	geometry_nature	village_场景_1770866283752_tree_13	geometry:tree	-15.7878828185218	0.09220859064137432	13.849698383219618	0	1.5862901639120313	0	1.3646991063635394	1.3646991063635394	1.3646991063635394	\N	2026-02-12 11:20:46.094989	2026-07-08 16:51:02.331091	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
492	threejs_code	自行车	\N	-49.46407340744712	0.745953400448415	67.45482150779448	0	0	0	1.2246784168699176	1.2246784168699176	1.2246784168699176	\N	2026-08-02 08:00:25.785125	2026-08-02 08:00:45.213833	\N	/* 自动声明的导入变量（运行器已提供常见类，其余从 THREE 命名空间兜底） */\nvar RectAreaLightUniformsLib = (typeof RectAreaLightUniformsLib !== 'undefined') ? RectAreaLightUniformsLib : (THREE.RectAreaLightUniformsLib || function(){});\n\n\n/**\n * BMX "Endurance" bike — hand-authored procedural reconstruction (img2threejs v1.3).\n *\n * Rebuilt in code from a 12-view reference set (3/4 front, side, drivetrain, U-brake,\n * grip, hub/peg, BB welds, saddle, pedal, head-tube decal, wireframe). This replaces the\n * earlier generated "every-part-is-a-cylinder" placeholder with real geometry:\n *   - 5-spoke solid aero MAG wheels (extruded disc + deep-dish barrel + orange rim lip)\n *   - all-black block-tread tyres with orange "TERRAIN MONSTER / SHARP / 2022" sidewall text\n *   - glossy clear-coat orange frame with fish-scale TIG weld beads at the joints\n *   - ribbed orange grips with inner flange, elongated PU-leather saddle\n *   - platform pedals with amber reflectors, 8-arm sunburst orange sprocket + roller chain\n *   - rear U-brake with straddle cable + barrel adjuster, knurled anodized pegs (4)\n *   - "BMX" / "Endurance" frame decals (no head-tube logo)\n *\n * Coordinate frame (root-local, matches the demo camera + drivetrain rig in registry.ts):\n *   +x = rear, -x = front · +y = up · z = axle/width.  Wheel centres: front (-0.62,-0.28),\n *   rear (0.62,-0.28). Bottom-bracket (-0.02,-0.24). Wheels/cranks spin about local z.\n *\n * Action-ready: root.userData.sculptRuntime.nodes exposes frontTire/frontRim/frontHub,\n * rearTire/rearRim/rearHub, crankArmL/crankArmR/chainring, pedalL/pedalR — each a Group\n * centred on its own pivot so the host rig can reparent + rotate it directly.\n */\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n// ---------------------------------------------------------------------------\n// Palette (post-ACES tone-mapping targets, tuned against the reference render)\n// ---------------------------------------------------------------------------\nconst COL = {\n  frame: '#f57c00', // signal orange, glossy clear-coat (rich amber, spec §3)\n  rimLip: '#ff9a1c', // painted orange rim edge\n  gripOrange: '#f98a08',\n  magBlack: '#0c0c0e', // gloss-black mag wheel / sprocket\n  glossBlack: '#161616', // handlebar / stem / seatpost / levers\n  rubber: '#121212', // tyre\n  leather: '#191919', // saddle\n  amber: '#ff8c12', // pedal reflector\n  peg: '#1b1b1d', // anodized black peg\n  chrome: '#c7ccd2', // cable barrel / bolts / seat rails\n  chain: '#3a3a3e', // roller chain\n  pedalBody: '#161618'\n};\n\nconst HAS_DOC = typeof document !== 'undefined';\n\n// ---------------------------------------------------------------------------\n// Canvas-texture helpers (all procedural — no external art)\n// ---------------------------------------------------------------------------\nfunction makeCanvas(w, h) {\n  const canvas = document.createElement('canvas');\n  canvas.width = w;\n  canvas.height = h;\n  return { canvas, ctx: canvas.getContext('2d') };\n}\n\nfunction canvasTexture(\nw,\nh,\ndraw,\nopts = {})\n{\n  if (!HAS_DOC) return null;\n  const { canvas, ctx } = makeCanvas(w, h);\n  draw(ctx, w, h);\n  const tex = new THREE.CanvasTexture(canvas);\n  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;\n  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);\n  tex.anisotropy = opts.aniso ?? 8;\n  tex.encoding = opts.srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;\n  tex.needsUpdate = true;\n  return tex;\n}\n\nfunction roundRect(ctx, x, y, w, h, r) {\n  ctx.beginPath();\n  ctx.moveTo(x + r, y);\n  ctx.arcTo(x + w, y, x + w, y + h, r);\n  ctx.arcTo(x + w, y + h, x, y + h, r);\n  ctx.arcTo(x, y + h, x, y, r);\n  ctx.arcTo(x, y, x + w, y, r);\n  ctx.closePath();\n}\n\n/** Fish-scale TIG weld bead — a bump map of stacked overlapping arcs. */\nfunction weldBumpTexture() {\n  return canvasTexture(256, 64, (ctx, w, h) => {\n    ctx.fillStyle = '#808080';\n    ctx.fillRect(0, 0, w, h);\n    const step = 13;\n    for (let i = -1; i < w / step + 1; i++) {\n      ctx.strokeStyle = '#f2f2f2';\n      ctx.lineWidth = 3;\n      ctx.beginPath();\n      ctx.arc(i * step, h * 0.5, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);\n      ctx.stroke();\n      ctx.strokeStyle = '#4a4a4a';\n      ctx.beginPath();\n      ctx.arc(i * step, h * 0.5 + 2, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);\n      ctx.stroke();\n    }\n  }, { repeat: [1, 1] });\n}\n\n/** Ribbed rubber grip — horizontal ring grooves as a bump map. */\nfunction gripBumpTexture() {\n  return canvasTexture(64, 256, (ctx, w, h) => {\n    const rings = 22;\n    for (let i = 0; i < rings; i++) {\n      const y = i / rings * h;\n      const g = ctx.createLinearGradient(0, y, 0, y + h / rings);\n      g.addColorStop(0, '#3a3a3a');\n      g.addColorStop(0.5, '#ffffff');\n      g.addColorStop(1, '#3a3a3a');\n      ctx.fillStyle = g;\n      ctx.fillRect(0, y, w, h / rings - 1);\n    }\n  }, { repeat: [1, 1] });\n}\n\n/** Diamond knurl for pegs — a fine cross-hatch bump. */\nfunction knurlBumpTexture() {\n  return canvasTexture(128, 128, (ctx, w, h) => {\n    ctx.fillStyle = '#7a7a7a';\n    ctx.fillRect(0, 0, w, h);\n    ctx.strokeStyle = '#e8e8e8';\n    ctx.lineWidth = 1.4;\n    const s = 9;\n    for (let i = -w; i < w; i += s) {\n      ctx.beginPath();ctx.moveTo(i, 0);ctx.lineTo(i + h, h);ctx.stroke();\n      ctx.beginPath();ctx.moveTo(i + h, 0);ctx.lineTo(i, h);ctx.stroke();\n    }\n  }, { repeat: [6, 3] });\n}\n\n/** PU-leather grain — soft mottled bump for the saddle (deterministic noise). */\nfunction leatherBumpTexture() {\n  let seed = 1337;\n  const rnd = () => {seed = seed * 16807 % 2147483647;return seed / 2147483647;};\n  return canvasTexture(256, 256, (ctx, w, h) => {\n    ctx.fillStyle = '#8a8a8a';\n    ctx.fillRect(0, 0, w, h);\n    for (let i = 0; i < 2600; i++) {\n      const x = rnd() * w;\n      const y = rnd() * h;\n      const r = 1 + rnd() * 2.5;\n      const c = 90 + Math.floor(rnd() * 90);\n      ctx.fillStyle = `rgb(${c},${c},${c})`;\n      ctx.beginPath();\n      ctx.arc(x, y, r, 0, Math.PI * 2);\n      ctx.fill();\n    }\n  }, { repeat: [3, 2] });\n}\n\n/** Prismatic reflector — small diamond cells for the amber pedal reflector. */\nfunction reflectorBumpTexture() {\n  return canvasTexture(128, 128, (ctx, w, h) => {\n    ctx.fillStyle = '#808080';\n    ctx.fillRect(0, 0, w, h);\n    const s = 16;\n    for (let x = 0; x < w; x += s) {\n      for (let y = 0; y < h; y += s) {\n        const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.7);\n        g.addColorStop(0, '#ffffff');\n        g.addColorStop(1, '#2a2a2a');\n        ctx.fillStyle = g;\n        ctx.fillRect(x, y, s - 1, s - 1);\n      }\n    }\n  }, { repeat: [3, 1] });\n}\n\n/**\n * Tyre wrap: colour + bump for a TorusGeometry. Cross-section (v, vertical here)\n * runs around the tube: mid-band = crown (block tread), quarter-bands = sidewalls\n * (orange text + bead line). u (horizontal) runs around the wheel.\n */\nfunction tyreTextures() {\n  const W = 2048;\n  const H = 512;\n  const map = canvasTexture(W, H, (ctx, w, h) => {\n    ctx.fillStyle = COL.rubber; // all-black rubber; orange lives only on the rim lip\n    ctx.fillRect(0, 0, w, h);\n    // Sidewall lettering. LOWER sidewall (near the bead) = large repeated "SHARP";\n    // UPPER sidewall (near the tread shoulder) = small "TERRAIN MONSTER" + "2022".\n    // The two faces are vertically mirrored so each reads upright on its outward side.\n    ctx.fillStyle = '#f2a01c';\n    ctx.textBaseline = 'middle';\n    ctx.textAlign = 'left';\n    for (const [y, flip] of [[h * 0.13, 1], [h * 0.87, -1]]) {\n      ctx.font = `bold ${Math.round(h * 0.11)}px Arial, sans-serif`;\n      for (let i = 0; i < 4; i++) {\n        ctx.save();\n        ctx.translate(i / 4 * w + w * 0.03, y);\n        if (flip < 0) ctx.scale(1, -1);\n        ctx.fillText('SHARP', 0, 0);\n        ctx.restore();\n      }\n    }\n    const small = ['TERRAIN MONSTER', '2022'];\n    for (const [y, flip] of [[h * 0.29, 1], [h * 0.71, -1]]) {\n      ctx.font = `bold ${Math.round(h * 0.045)}px Arial, sans-serif`;\n      for (let i = 0; i < 6; i++) {\n        ctx.save();\n        ctx.translate(i / 6 * w + w * 0.02, y);\n        if (flip < 0) ctx.scale(1, -1);\n        ctx.fillText(small[i % 2], 0, 0);\n        ctx.restore();\n      }\n    }\n  }, { repeat: [-1, 1], srgb: true }); // negative U flips the sidewall text to read correctly\n\n  const bump = canvasTexture(W, H, (ctx, w, h) => {\n    ctx.fillStyle = '#2a2a2a'; // deep grooves between knobs\n    ctx.fillRect(0, 0, w, h);\n    // crown block tread: fine, closely-spaced knobs (v 0.28..0.72)\n    const rows = 3;\n    const cols = 52;\n    const bw = w / cols;\n    const crownTop = h * 0.28;\n    const crownH = h * 0.44;\n    for (let r = 0; r < rows; r++) {\n      for (let c = 0; c < cols; c++) {\n        const x = c * bw + r % 2 * bw * 0.5;\n        const y = crownTop + r / rows * crownH;\n        // raised knob with a bright top and mid-grey shoulder for a beveled block\n        ctx.fillStyle = '#6a6a6a';\n        roundRect(ctx, x + bw * 0.08, y + crownH * 0.03, bw * 0.84, crownH / rows * 0.9, 6);\n        ctx.fill();\n        ctx.fillStyle = '#ffffff';\n        roundRect(ctx, x + bw * 0.2, y + crownH * 0.08, bw * 0.6, crownH / rows * 0.7, 4);\n        ctx.fill();\n      }\n    }\n    // side lug rows just outboard of the crown\n    ctx.fillStyle = '#c8c8c8';\n    for (const yb of [h * 0.24, h * 0.76]) {\n      for (let c = 0; c < cols; c++) {\n        const x = c * bw + c % 2 * bw * 0.4;\n        roundRect(ctx, x + bw * 0.15, yb, bw * 0.5, h * 0.04, 3);\n        ctx.fill();\n      }\n    }\n  }, { repeat: [1, 1] });\n\n  return { map, bump };\n}\n\n/** Transparent decal canvas → texture (sRGB). Drawn upright; the caller orients the\n *  quad along the tube's reading direction so the text stays right-way-up. */\nfunction decalTexture(\nw,\nh,\ndraw)\n{\n  return canvasTexture(w, h, (ctx, cw, ch) => {\n    ctx.clearRect(0, 0, cw, ch);\n    draw(ctx, cw, ch);\n  }, { repeat: [1, 1], srgb: true });\n}\n\n// ---------------------------------------------------------------------------\n// Materials — PBR per the supplied specification\n// ---------------------------------------------------------------------------\nfunction buildMaterials() {\n  const env = 1.0;\n  const frame = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.frame),\n    roughness: 0.15, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: env * 1.1\n  });\n\n  const weld = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.frame),\n    roughness: 0.38, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.28,\n    bumpMap: weldBumpTexture(), bumpScale: 3.0, envMapIntensity: env\n  });\n\n  const magBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.magBlack),\n    roughness: 0.1, metalness: 0.9, clearcoat: 0.9, clearcoatRoughness: 0.05, envMapIntensity: env * 1.3\n  });\n\n  const rimOrange = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.rimLip),\n    roughness: 0.22, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: env\n  });\n\n  const glossBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.glossBlack),\n    roughness: 0.3, metalness: 0.65, clearcoat: 0.45, clearcoatRoughness: 0.15, envMapIntensity: env\n  });\n\n  const tyreTex = tyreTextures();\n  const tyre = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color('#ffffff'), map: tyreTex.map, bumpMap: tyreTex.bump, bumpScale: 5.0,\n    roughness: 0.85, metalness: 0.0, envMapIntensity: env * 0.45\n  });\n  if (!tyreTex.map) tyre.color.set(COL.rubber);\n\n  const grip = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.gripOrange),\n    roughness: 0.85, metalness: 0.0, bumpMap: gripBumpTexture(), bumpScale: 1.1, envMapIntensity: env * 0.7\n  });\n\n  const leather = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.leather),\n    roughness: 0.62, metalness: 0.0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#2a2a2a'),\n    bumpMap: leatherBumpTexture(), bumpScale: 0.6, envMapIntensity: env * 0.8\n  });\n\n  const amber = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.amber),\n    roughness: 0.18, metalness: 0.0, transmission: 0.28, ior: 1.5, thickness: 0.02, clearcoat: 0.6,\n    emissive: new THREE.Color(COL.amber), emissiveIntensity: 0.12,\n    bumpMap: reflectorBumpTexture(), bumpScale: 1.2, envMapIntensity: env\n  });\n\n  const peg = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.peg),\n    roughness: 0.55, metalness: 0.7, bumpMap: knurlBumpTexture(), bumpScale: 0.8, envMapIntensity: env\n  });\n\n  const chrome = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.chrome), roughness: 0.22, metalness: 1.0, envMapIntensity: env * 1.2\n  });\n\n  const chain = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.chain), roughness: 0.5, metalness: 0.9, envMapIntensity: env\n  });\n\n  const pedalBody = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color(COL.pedalBody), roughness: 0.5, metalness: 0.35, envMapIntensity: env\n  });\n\n  // smooth matte black (front peg) — no knurl, low sheen\n  const matteBlack = new THREE.MeshPhysicalMaterial({\n    color: new THREE.Color('#141416'), roughness: 0.7, metalness: 0.2, clearcoat: 0.1, envMapIntensity: env * 0.6\n  });\n\n  return { frame, weld, magBlack, rimOrange, glossBlack, tyre, grip, leather, amber, peg, chrome, chain, pedalBody, matteBlack };\n}\n\n// ---------------------------------------------------------------------------\n// Geometry helpers\n// ---------------------------------------------------------------------------\nconst UP = new THREE.Vector3(0, 1, 0);\n\nfunction v(x, y, z = 0) {\n  return new THREE.Vector3(x, y, z);\n}\n\n/** A cylinder spanning a→b (local points), radius r1 at a, r2 at b. */\nfunction tube(\na,\nb,\nr1,\nr2,\nmat,\nradial = 20)\n{\n  const dir = new THREE.Vector3().subVectors(b, a);\n  const len = dir.length();\n  const geo = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false);\n  const mesh = new THREE.Mesh(geo, mat);\n  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());\n  mesh.position.copy(a).addScaledVector(dir, 0.5);\n  return mesh;\n}\n\n/** A smooth cable/hose swept along a Catmull-Rom (bezier-like) curve through `pts`. */\nfunction cable(pts, r, mat, seg = 40) {\n  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);\n  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8, false), mat);\n}\n\n/** Weld bead ring wrapping a tube of radius `tubeR` at `at`, with `dir` = tube axis. */\nfunction weldRing(at, dir, tubeR, mat) {\n  const geo = new THREE.TorusGeometry(tubeR * 1.06, tubeR * 0.26, 10, 32);\n  const mesh = new THREE.Mesh(geo, mat);\n  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());\n  mesh.position.copy(at);\n  return mesh;\n}\n\nfunction applyShadow(obj, opts) {\n  obj.traverse((o) => {\n    const m = o;\n    if (m.isMesh) {\n      m.castShadow = opts.castShadow ?? true;\n      m.receiveShadow = opts.receiveShadow ?? true;\n      if (opts.wireframe) {\n        const mat = m.material;\n        if (mat && 'wireframe' in mat) mat.wireframe = true;\n      }\n    }\n  });\n}\n\n// ---------------------------------------------------------------------------\n// Wheel — OPEN 5-spoke MAG (slim spokes with see-through gaps)\n// ---------------------------------------------------------------------------\nconst TIRE_MAJOR = 0.32; // tyre centreline radius\nconst TIRE_TUBE = 0.05; // tyre cross-section radius → outer 0.37, inner bead ≈ 0.27\nconst WHEEL_WIDTH = 0.085; // hub / peg reference width\n\nconst HUB_R = 0.055;\nconst SPOKE_IN = 0.05;\nconst SPOKE_OUT = 0.244;\nconst RIM_RING_R = 0.244; // black structural rim the spokes meet (inboard of the lip)\nconst LIP_R = 0.268; // orange rim lip ring, sits at the tyre bead just outboard of the ring\nconst MAG_DEPTH = 0.03; // slim spoke / face thickness\n\n/**\n * Open 5-spoke mag face: centre hub + 5 slim beveled spokes + a black rim ring, plus\n * the thin orange rim lip. The gaps between spokes are true voids — you can see through\n * to the far side of the wheel; there is NO solid disc.\n */\nfunction magFace(mats) {\n  const g = new THREE.Group();\n\n  const hub = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, MAG_DEPTH * 1.5, 28), mats.magBlack);\n  hub.rotation.x = Math.PI / 2;\n  g.add(hub);\n\n  // five slim aero spokes — wider at the hub, tapering to the rim, beveled edges\n  for (let i = 0; i < 5; i++) {\n    const shape = new THREE.Shape();\n    const wB = 0.05; // width at hub\n    const wT = 0.03; // width at rim\n    shape.moveTo(-wB / 2, SPOKE_IN);\n    shape.lineTo(wB / 2, SPOKE_IN);\n    shape.lineTo(wT / 2, SPOKE_OUT);\n    shape.lineTo(-wT / 2, SPOKE_OUT);\n    shape.closePath();\n    const geo = new THREE.ExtrudeGeometry(shape, {\n      depth: MAG_DEPTH, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, steps: 1\n    });\n    geo.translate(0, 0, -MAG_DEPTH / 2);\n    const spoke = new THREE.Mesh(geo, mats.magBlack);\n    spoke.rotation.z = i / 5 * Math.PI * 2;\n    g.add(spoke);\n  }\n\n  // black structural rim ring the spoke tips meet (kept inboard of the orange lip)\n  const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_RING_R, 0.013, 18, 96), mats.magBlack);\n  g.add(ring);\n\n  // ORANGE rim lip — glossy burnt-orange painted edge sitting just OUTSIDE the black\n  // ring, at the boundary with the tyre bead (visible band ≈ LIP_R−0.013 … tyre inner)\n  const lip = new THREE.Mesh(new THREE.TorusGeometry(LIP_R, 0.013, 16, 110), mats.rimOrange);\n  g.add(lip);\n\n  return g;\n}\n\n/** Wheel parts returned as three sibling groups (each centred at local origin). */\nfunction buildWheel(mats)\n\n{\n  // rim group = the open mag face (spokes + rim ring + orange lip). No solid disc.\n  const rim = magFace(mats);\n\n  // tyre — all-black rubber torus (decals live in the material's map)\n  const tire = new THREE.Group();\n  tire.add(new THREE.Mesh(new THREE.TorusGeometry(TIRE_MAJOR, TIRE_TUBE, 30, 140), mats.tyre));\n\n  // hub — compact all-black shell (no bright chrome caps)\n  const hub = new THREE.Group();\n  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, WHEEL_WIDTH, 24), mats.magBlack);\n  shell.rotation.x = Math.PI / 2;\n  hub.add(shell);\n  for (const zside of [-1, 1]) {\n    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.01, 16), mats.magBlack);\n    cap.rotation.x = Math.PI / 2;\n    cap.position.z = zside * WHEEL_WIDTH * 0.5;\n    hub.add(cap);\n  }\n\n  return { tire, rim, hub };\n}\n\n// ---------------------------------------------------------------------------\n// Small parts\n// ---------------------------------------------------------------------------\nfunction buildGrip(mats) {\n  // built with the grip axis along local x; positioned/oriented by the caller\n  const g = new THREE.Group();\n  const L = 0.115;\n  const r = 0.026;\n  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 24), mats.grip);\n  body.rotation.z = Math.PI / 2;\n  g.add(body);\n  const flange = new THREE.Mesh(new THREE.TorusGeometry(r + 0.006, 0.006, 8, 24), mats.grip);\n  flange.rotation.y = Math.PI / 2;\n  flange.position.x = -L / 2 + 0.006;\n  g.add(flange);\n  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.glossBlack);\n  cap.rotation.z = -Math.PI / 2;\n  cap.position.x = L / 2;\n  g.add(cap);\n  return g;\n}\n\nfunction buildSaddle(mats) {\n  // Railed BMX seat: pointed, slightly upturned nose (−x = front) · scooped middle ·\n  // fat rounded tail · puffy cushion. Long axis = local x (caller keeps it ~horizontal).\n  const g = new THREE.Group();\n  // Proportions from NotebookLM research (BMX/jump saddles ≈ 235mm long × 127mm rear\n  // width → shorter than road saddles, ~1.9:1 length:width, nose clearly narrower).\n  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 56, 34), mats.leather);\n  shell.scale.set(0.32, 0.1, 0.15); // length · cushion thickness · rear width\n  const pos = shell.geometry.attributes.position;\n  for (let i = 0; i < pos.count; i++) {\n    const x = pos.getX(i);\n    const y = pos.getY(i);\n    const z = pos.getZ(i);\n    const t = THREE.MathUtils.clamp(x / 0.5, -1, 1); // nose −1 … tail +1\n    // width: narrow pointed nose → full rounded tail\n    const wf = 0.4 + 0.6 * THREE.MathUtils.smoothstep((t + 1) / 2, 0, 1);\n    pos.setZ(i, z * wf);\n    // Longitudinal profile (BMX railed/pivotal seat, per web research): a gentle upward\n    // sweep — the middle sits slightly low, the NOSE kicks up (waterfall) and the TAIL\n    // rises into a rounded rear bumper, so the top line arcs upward toward both ends.\n    // Research: BMX seats sit nose-up with a longitudinal dip + raised rear. Make the\n    // top line clearly sweep UP toward both ends (bigger tail bumper, upturned nose).\n    const scoop = -0.022 * (1 - t * t); // seating dip\n    const tail = 0.09 * Math.pow(Math.max(0, t), 1.3); // raised rounded rear bumper\n    const nose = 0.07 * Math.pow(Math.max(0, -t), 1.4); // upturned nose (waterfall)\n    const domeTop = y > 0 ? 0.01 * (1 - t * t) : 0; // slight cushion crown\n    pos.setY(i, y + scoop + tail + nose + domeTop);\n  }\n  pos.needsUpdate = true;\n  shell.geometry.computeVertexNormals();\n  g.add(shell);\n  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.045), mats.glossBlack);\n  clamp.position.y = -0.05;\n  g.add(clamp);\n  for (const zside of [-1, 1]) {\n    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 8), mats.chrome);\n    rail.rotation.z = Math.PI / 2;\n    rail.position.set(0, -0.045, zside * 0.025);\n    g.add(rail);\n  }\n  return g;\n}\n\nfunction buildPedal(mats) {\n  const g = new THREE.Group();\n  // spindle runs inboard to meet the crank arm (pedal sits outboard at z≈0.155)\n  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 12), mats.chrome);\n  spindle.rotation.x = Math.PI / 2;\n  spindle.position.z = -0.02;\n  g.add(spindle);\n  const plat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.075), mats.pedalBody);\n  plat.position.z = 0.05;\n  g.add(plat);\n  for (let ix = 0; ix < 4; ix++) {\n    for (const yside of [-1, 1]) {\n      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.07), mats.pedalBody);\n      pin.position.set(-0.04 + ix * 0.026, yside * 0.014, 0.05);\n      g.add(pin);\n    }\n  }\n  for (const xside of [-1, 1]) {\n    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.05), mats.amber);\n    refl.position.set(xside * 0.056, 0, 0.05);\n    g.add(refl);\n  }\n  return g;\n}\n\n/** 8-arm sunburst orange sprocket (chainring), in XY plane, axle z. */\nfunction buildSprocket(mats) {\n  const g = new THREE.Group();\n  const R = 0.11;\n  const shape = new THREE.Shape();\n  const teeth = 34;\n  for (let i = 0; i <= teeth; i++) {\n    const a = i / teeth * Math.PI * 2;\n    const rr = R + (i % 2 === 0 ? 0.006 : 0.0);\n    const x = Math.cos(a) * rr;\n    const y = Math.sin(a) * rr;\n    if (i === 0) shape.moveTo(x, y);else shape.lineTo(x, y);\n  }\n  const arms = 8;\n  for (let i = 0; i < arms; i++) {\n    const a = i / arms * Math.PI * 2 + Math.PI / arms;\n    const hole = new THREE.Path();\n    const ri = 0.028;\n    const ro = R - 0.02;\n    const aw = 0.22;\n    hole.moveTo(Math.cos(a - aw * 0.4) * ri, Math.sin(a - aw * 0.4) * ri);\n    for (let s = 0; s <= 8; s++) {\n      const t = -aw + 2 * aw * s / 8;\n      hole.lineTo(Math.cos(a + t) * ro, Math.sin(a + t) * ro);\n    }\n    hole.lineTo(Math.cos(a + aw * 0.4) * ri, Math.sin(a + aw * 0.4) * ri);\n    hole.closePath();\n    shape.holes.push(hole);\n  }\n  const geo = new THREE.ExtrudeGeometry(shape, {\n    depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8\n  });\n  geo.center();\n  g.add(new THREE.Mesh(geo, mats.rimOrange));\n  // central spider boss so the ring reads as mounted, not a floating plate\n  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 20), mats.magBlack);\n  boss.rotation.x = Math.PI / 2;\n  g.add(boss);\n  return g;\n}\n\n/**\n * Roller chain as an array of alternating link plates wrapping the chainring + rear cog.\n * Path = upper external run → wrap the rear (+x) of the cog → lower run → wrap the front\n * (−x) of the chainring. Links are placed tangent to the path (not two flat strips).\n */\nfunction buildChain(\nc1, r1, // chainring\nc2, r2, // rear cog\nz,\nmats)\n{\n  const g = new THREE.Group();\n  const pts = [];\n  const arc = (c, r, a0, a1, n) => {\n    for (let i = 0; i <= n; i++) {\n      const a = a0 + (a1 - a0) * i / n;\n      pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));\n    }\n  };\n  // top run start (top of chainring) → top of cog, then wrap cog rear, bottom run, wrap chainring front\n  pts.push(new THREE.Vector2(c1.x, c1.y + r1));\n  pts.push(new THREE.Vector2(c2.x, c2.y + r2));\n  arc(c2, r2, Math.PI / 2, -Math.PI / 2, 10); // around the +x side of the cog\n  pts.push(new THREE.Vector2(c1.x, c1.y - r1));\n  arc(c1, r1, -Math.PI / 2, -Math.PI * 1.5, 16); // around the −x side of the chainring\n\n  // resample at uniform spacing and drop an alternating link at each step\n  const spacing = 0.016;\n  let carry = 0;\n  const linkOuter = new THREE.BoxGeometry(0.022, 0.012, 0.016);\n  const linkInner = new THREE.BoxGeometry(0.02, 0.008, 0.01);\n  let toggle = false;\n  for (let i = 0; i < pts.length - 1; i++) {\n    const a = pts[i];\n    const b = pts[i + 1];\n    const seg = b.clone().sub(a);\n    let segLen = seg.length();\n    const dir = seg.clone().normalize();\n    let t = carry;\n    while (t < segLen) {\n      const p = a.clone().addScaledVector(dir, t);\n      const link = new THREE.Mesh(toggle ? linkInner : linkOuter, mats.chain);\n      link.position.set(p.x, p.y, z);\n      link.rotation.z = Math.atan2(dir.y, dir.x);\n      g.add(link);\n      toggle = !toggle;\n      t += spacing;\n    }\n    carry = t - segLen;\n  }\n  return g;\n}\n\n/** Rear U-brake: two arms hugging the tyre + straddle cable + barrel adjuster. */\nfunction buildUBrake(mats) {\n  const g = new THREE.Group();\n  for (const zside of [-1, 1]) {\n    g.add(tube(v(0, 0, zside * 0.05), v(-0.02, 0.11, zside * 0.03), 0.01, 0.008, mats.glossBlack, 10));\n    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.02), mats.glossBlack);\n    pad.position.set(0, 0, zside * 0.055);\n    g.add(pad);\n    const boltHead = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), mats.chrome);\n    boltHead.rotation.x = Math.PI / 2;\n    boltHead.position.set(-0.02, 0.11, zside * 0.03);\n    g.add(boltHead);\n  }\n  const yoke = v(0, 0.12, 0);\n  g.add(tube(v(-0.02, 0.11, -0.03), yoke, 0.003, 0.003, mats.chrome, 6));\n  g.add(tube(v(-0.02, 0.11, 0.03), yoke, 0.003, 0.003, mats.chrome, 6));\n  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10), mats.chrome);\n  barrel.position.copy(yoke).add(v(0, 0.02, 0));\n  g.add(barrel);\n  // housing hugs forward along the seat stay toward the frame (local −x), not skyward\n  g.add(cable([\n  yoke.clone().add(v(0, 0.03, 0)),\n  v(-0.12, 0.14, 0.01),\n  v(-0.28, 0.11, 0),\n  v(-0.4, 0.08, 0)],\n  0.004, mats.glossBlack));\n  return g;\n}\n\n/** A flat decal quad carrying a transparent canvas texture. */\nfunction decalQuad(tex, w, h, fallbackColor = COL.frame) {\n  const mat = new THREE.MeshPhysicalMaterial({\n    map: tex ?? undefined,\n    color: tex ? new THREE.Color('#ffffff') : new THREE.Color(fallbackColor),\n    transparent: true, roughness: 0.25, clearcoat: 0.6,\n    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.6\n  });\n  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);\n}\n\n// ---------------------------------------------------------------------------\n// Main factory\n// ---------------------------------------------------------------------------\nfunction createBMXEnduranceBikeModel(options = {}) {\n  const root = new THREE.Group();\n  root.name = 'BMX Endurance Bike';\n  const M = buildMaterials();\n\n  const nodes = { root };\n  const meshes = {};\n  const sockets = {};\n  const colliders = {};\n  const destructionGroups = {};\n\n  const addNode = (id, obj, group, parent = root) => {\n    parent.add(obj);\n    nodes[id] = obj;\n    (destructionGroups[group] ??= []).push(obj);\n  };\n\n  // ---- Frame skeleton (joint coordinates) ----\n  // BB, front & rear axles are FIXED (the registry drivetrain rig pivots on them).\n  // Everything else is shaped for a low, stubby BMX freestyle stance.\n  // Front axle pushed forward + rear axle pulled in (~16% shorter rear) for a compact\n  // BMX wheelbase with a clean 3-4cm tyre↔down-tube gap. These MUST match registry.ts.\n  const BB = v(-0.02, -0.24);\n  const seatCluster = v(0.1, 0.04); // short seat tube → low, stubby stance\n  const headTop = v(-0.47, 0.26); // head tube forward/up so the front tyre clears the down tube\n  const headBot = v(-0.51, 0.12);\n  const frontAxle = v(-0.66, -0.28); // pushed forward → ~4cm gap to the down tube\n  const rearAxle = v(0.52, -0.28); // pulled in ~16% → tighter BMX rear end\n  const barBase = v(-0.46, 0.35);\n\n  const frameGroup = new THREE.Group();\n  frameGroup.name = 'frame';\n  root.add(frameGroup);\n  destructionGroups['frame'] = [frameGroup];\n  const addFrame = (mesh) => {frameGroup.add(mesh);};\n\n  addFrame(tube(BB, seatCluster, 0.023, 0.021, M.frame)); // seat tube (short)\n  addFrame(tube(BB, headBot, 0.034, 0.03, M.frame)); // down tube — fattest tube, steep\n  addFrame(tube(seatCluster, headTop, 0.02, 0.019, M.frame)); // top tube — slimmer than down tube\n  // Seat + chain stays bow OUTBOARD around the rear tyre (half-width ≈ 0.05) so they\n  // clear it, then converge to the dropouts. Curved tubes, not straight (which pierced).\n  for (const zs of [-1, 1]) {\n    addFrame(cable([\n    seatCluster.clone().setZ(0.02 * zs),\n    v(0.28, -0.11, 0.092 * zs),\n    rearAxle.clone().setZ(0.066 * zs)],\n    0.011, M.frame)); // seat stay\n    addFrame(cable([\n    BB.clone().setZ(0.045 * zs),\n    v(0.24, -0.3, 0.098 * zs),\n    rearAxle.clone().setZ(0.066 * zs)],\n    0.013, M.frame)); // chain stay\n  }\n  addFrame(tube(headTop, headBot, 0.034, 0.034, M.frame)); // head tube (beefy)\n\n  const bbShell = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 24), M.frame);\n  bbShell.rotation.x = Math.PI / 2;\n  bbShell.position.copy(BB);\n  addFrame(bbShell);\n\n  // Fork (orange): steerer stub + crown + long legs (spread wider than the tyre) + dropouts.\n  const forkCrownPos = v(-0.51, 0.07);\n  addFrame(tube(headBot, forkCrownPos, 0.022, 0.024, M.frame)); // lower steerer into crown\n  const forkCrown = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.14), M.frame);\n  forkCrown.position.copy(forkCrownPos);\n  addFrame(forkCrown);\n  const forkZ = 0.065; // outboard of the tyre half-width (0.05)\n  for (const zs of [-1, 1]) {\n    // long raked leg, tapering down from a thicker crown to a slim dropout\n    addFrame(tube(forkCrownPos.clone().setZ(forkZ * zs), frontAxle.clone().setZ(forkZ * zs), 0.019, 0.009, M.frame));\n    // flat drilled dropout plate around the axle (thin box + hole ring)\n    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.012), M.frame);\n    plate.position.copy(frontAxle).setZ(forkZ * zs);\n    addFrame(plate);\n    const hole = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.006, 8, 16), M.glossBlack);\n    hole.position.copy(frontAxle).setZ(forkZ * zs + 0.007 * zs);\n    addFrame(hole);\n  }\n\n  // ---- TIG weld beads at the joints (fish-scale) ----\n  const welds = new THREE.Group();\n  welds.name = 'welds';\n  root.add(welds);\n  welds.add(weldRing(BB.clone().add(v(0.03, 0.06, 0)), new THREE.Vector3().subVectors(seatCluster, BB), 0.024, M.weld));\n  welds.add(weldRing(BB.clone().add(v(-0.06, 0.03, 0)), new THREE.Vector3().subVectors(headBot, BB), 0.03, M.weld));\n  welds.add(weldRing(headBot.clone().add(v(0.03, 0.02, 0)), new THREE.Vector3().subVectors(BB, headBot), 0.03, M.weld));\n  welds.add(weldRing(headTop.clone().add(v(0.03, -0.02, 0)), new THREE.Vector3().subVectors(seatCluster, headTop), 0.024, M.weld));\n  welds.add(weldRing(seatCluster.clone().add(v(-0.03, -0.02, 0)), new THREE.Vector3().subVectors(headTop, seatCluster), 0.023, M.weld));\n\n  // ---- Seatpost + clamp + saddle: post slammed low, saddle near-horizontal ----\n  const seatTop = v(0.11, 0.12); // very short post, tucked down near the frame\n  addFrame(tube(seatCluster, seatTop, 0.015, 0.015, M.glossBlack));\n  const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 20), M.glossBlack);\n  clamp.rotation.x = Math.PI / 2;\n  clamp.position.set(seatCluster.x, seatCluster.y + 0.02, 0);\n  addFrame(clamp);\n  const saddle = buildSaddle(M); // long axis already along x (nose −x = front)\n  saddle.position.set(0.14, seatTop.y + 0.06, 0);\n  saddle.rotation.z = -0.11; // ~6° nose-up, BMX-standard (research: BMX seats tilt up)\n  addNode('saddle', saddle, 'seat');\n\n  // ---- Cockpit: stem, tall riser bar, crossbar, grips, lever ----\n  addFrame(tube(headTop, barBase, 0.02, 0.02, M.glossBlack)); // steerer riser\n  const stemBlock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), M.glossBlack);\n  stemBlock.position.copy(barBase);\n  addFrame(stemBlock);\n\n  const bx = barBase.x;\n  const by = barBase.y;\n  const bars = new THREE.Group();\n  bars.name = 'handlebar';\n  root.add(bars);\n  bars.add(tube(v(bx, by, -0.12), v(bx, by, 0.12), 0.016, 0.016, M.glossBlack)); // bottom span\n  for (const zs of [-1, 1]) {\n    bars.add(tube(v(bx, by, 0.12 * zs), v(bx + 0.02, by + 0.16, 0.2 * zs), 0.015, 0.015, M.glossBlack)); // uprights\n    bars.add(tube(v(bx + 0.02, by + 0.16, 0.2 * zs), v(bx + 0.03, by + 0.2, 0.28 * zs), 0.015, 0.015, M.glossBlack)); // bend to grip\n  }\n  bars.add(tube(v(bx + 0.015, by + 0.15, -0.19), v(bx + 0.015, by + 0.15, 0.19), 0.013, 0.013, M.glossBlack)); // crossbar\n\n  const gripY = by + 0.2;\n  for (const [id, zs] of [['gripL', -1], ['gripR', 1]]) {\n    const grip = buildGrip(M);\n    grip.position.set(bx + 0.035, gripY, 0.34 * zs);\n    grip.rotation.y = Math.PI / 2; // grip axis → z (outboard)\n    addNode(id, grip, 'cockpit');\n  }\n  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.02), M.glossBlack);\n  lever.position.set(bx + 0.04, gripY - 0.015, 0.26);\n  lever.rotation.z = 0.2;\n  bars.add(lever);\n  // brake cable as a smooth curve from the lever down to the head-tube/frame\n  bars.add(cable([\n  v(bx + 0.06, gripY, 0.25),\n  v(bx + 0.12, by + 0.06, 0.12),\n  v(headTop.x + 0.03, headTop.y + 0.03, 0.04),\n  v(headTop.x + 0.01, headTop.y - 0.06, 0.02)],\n  0.0035, M.glossBlack));\n\n  // ---- Wheels ----\n  const placeWheel = (prefix, center) => {\n    const parts = buildWheel(M);\n    for (const [k, obj] of Object.entries(parts)) {\n      obj.position.copy(center);\n      const id = `${prefix}${k.charAt(0).toUpperCase()}${k.slice(1)}`; // frontTire/frontRim/frontHub\n      addNode(id, obj, 'wheel');\n    }\n  };\n  placeWheel('front', frontAxle);\n  placeWheel('rear', rearAxle);\n\n  // ---- Pegs (4: front + rear, both sides) — static ----\n  const pegs = new THREE.Group();\n  pegs.name = 'pegs';\n  root.add(pegs);\n  // Front axle: ONE slim, smooth matte-black peg (drive side).\n  const frontPeg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 20), M.matteBlack);\n  frontPeg.rotation.x = Math.PI / 2;\n  frontPeg.position.copy(frontAxle).setZ(WHEEL_WIDTH * 0.5 + 0.085);\n  pegs.add(frontPeg);\n  // Rear axle: knurled anodized pegs on both sides.\n  for (const zs of [-1, 1]) {\n    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 20), M.peg);\n    peg.rotation.x = Math.PI / 2;\n    peg.position.copy(rearAxle).setZ(zs * (WHEEL_WIDTH * 0.5 + 0.08));\n    pegs.add(peg);\n  }\n\n  // ---- Drivetrain: BB spindle, bolted cranks, sprocket, pedals, roller chain, cog ----\n  // static BB spindle through the shell — widened so the cranks sit outboard of the\n  // chainstays and the pedals swing free (no frame collision at any crank angle).\n  const CRANK_Z = 0.1;\n  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, CRANK_Z * 2 + 0.04, 16), M.chrome);\n  spindle.rotation.x = Math.PI / 2;\n  spindle.position.set(BB.x, BB.y, 0);\n  addFrame(spindle);\n\n  const crankBolt = (zoff) => {\n    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.014, 12), M.chrome);\n    b.rotation.x = Math.PI / 2;\n    b.position.z = zoff;\n    return b;\n  };\n\n  const crankL = new THREE.Group();\n  crankL.position.set(BB.x, BB.y, CRANK_Z);\n  crankL.add(tube(v(0, 0, 0), v(0, -0.11, 0), 0.016, 0.013, M.glossBlack));\n  crankL.add(crankBolt(0.014)); // nut fixing the arm to the spindle\n  addNode('crankArmL', crankL, 'drivetrain');\n\n  const crankR = new THREE.Group();\n  crankR.position.set(BB.x, BB.y, -CRANK_Z);\n  crankR.add(tube(v(0, 0, 0), v(0, 0.11, 0), 0.016, 0.013, M.glossBlack));\n  crankR.add(crankBolt(-0.014));\n  addNode('crankArmR', crankR, 'drivetrain');\n\n  // sprocket + cog + chain share the SAME z-plane so the chain seats on both\n  const DRIVE_Z = 0.058;\n  const chainring = buildSprocket(M);\n  chainring.position.set(BB.x, BB.y, DRIVE_Z);\n  addNode('chainring', chainring, 'drivetrain');\n\n  const cogR = 0.05;\n  const cog = new THREE.Mesh(new THREE.CylinderGeometry(cogR, cogR, 0.016, 24), M.magBlack);\n  cog.rotation.x = Math.PI / 2;\n  cog.position.set(rearAxle.x, rearAxle.y, DRIVE_Z);\n  root.add(cog);\n\n  const pedalL = buildPedal(M);\n  pedalL.position.set(BB.x, BB.y - 0.11, 0.155); // outboard of the crank + chainstay\n  addNode('pedalL', pedalL, 'drivetrain');\n  const pedalR = buildPedal(M);\n  pedalR.position.set(BB.x, BB.y + 0.11, -0.155);\n  addNode('pedalR', pedalR, 'drivetrain');\n\n  // roller chain — array of alternating links wrapping sprocket teeth + rear cog\n  root.add(buildChain(\n    new THREE.Vector2(BB.x, BB.y), 0.116, // rides on the ~0.11 sprocket teeth\n    new THREE.Vector2(rearAxle.x, rearAxle.y), cogR + 0.006,\n    DRIVE_Z, M\n  ));\n\n  // ---- Rear U-brake (above the rear tyre, mounted on the seat stays) ----\n  const ubrake = buildUBrake(M);\n  ubrake.position.set(rearAxle.x - 0.12, -0.02, 0);\n  root.add(ubrake);\n\n  // ---- Decals: BMX (top tube), Endurance (down tube), lightning (head tube) ----\n  const bmxTex = decalTexture(512, 160, (ctx, _w, h) => {\n    ctx.fillStyle = '#1a1a1a';\n    for (let i = 0; i < 3; i++) ctx.fillRect(10 + i * 20, h * 0.2, 10, h * 0.6);\n    ctx.font = `900 ${Math.round(h * 0.7)}px Arial, sans-serif`;\n    ctx.textBaseline = 'middle';\n    ctx.fillText('BMX', 80, h * 0.5);\n    ctx.fillStyle = '#f39a1b';\n    for (let i = 0; i < 3; i++) {\n      ctx.beginPath();\n      ctx.moveTo(360 + i * 26, h * 0.2);\n      ctx.lineTo(380 + i * 26, h * 0.2);\n      ctx.lineTo(360 + i * 26, h * 0.8);\n      ctx.lineTo(340 + i * 26, h * 0.8);\n      ctx.closePath();\n      ctx.fill();\n    }\n  });\n  const enduranceTex = decalTexture(512, 96, (ctx, _w, h) => {\n    ctx.fillStyle = '#141414';\n    ctx.font = `italic 800 ${Math.round(h * 0.72)}px Georgia, serif`;\n    ctx.textBaseline = 'middle';\n    ctx.fillText('Endurance', 8, h * 0.55);\n  });\n  const decals = new THREE.Group();\n  decals.name = 'decals';\n  root.add(decals);\n  const topMid = seatCluster.clone().lerp(headTop, 0.52);\n  // Reading direction runs front→back (−x → +x = screen left→right) so the text is\n  // upright; using the front-pointing tube direction would spin it ~180°.\n  const topAngle = Math.atan2(seatCluster.y - headTop.y, seatCluster.x - headTop.x);\n  const downMid = BB.clone().lerp(headBot, 0.5);\n  const downAngle = Math.atan2(BB.y - headBot.y, BB.x - headBot.x);\n  // Decals are applied to the drive side (+z, the side the studio camera faces). A\n  // single quad per graphic avoids the far-side mirror bleed-through a thin tube can't\n  // occlude. Text reads left-to-right for a +z-facing viewer. (No head-tube logo.)\n  {\n    const bmx = decalQuad(bmxTex, 0.26, 0.055); // long, fills the top-tube width\n    bmx.position.copy(topMid).setZ(0.021);\n    bmx.rotation.set(0, 0, topAngle);\n    decals.add(bmx);\n\n    const end = decalQuad(enduranceTex, 0.2, 0.04); // bigger, up on the down tube\n    end.position.copy(downMid).setZ(0.036);\n    end.rotation.set(0, 0, downAngle);\n    decals.add(end);\n  }\n\n  applyShadow(root, options);\n\n  root.traverse((o) => {\n    const m = o;\n    if (m.isMesh) meshes[o.name || `mesh_${Object.keys(meshes).length}`] = m;\n  });\n\n  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups };\n  root.userData.actionReadiness = {\n    note: 'root.userData.sculptRuntime.nodes exposes wheels (frontTire/frontRim/frontHub, rear…), crankArmL/R, chainring, pedalL/R for the drivetrain rig.'\n  };\n  return root;\n}\n\n// ---------------------------------------------------------------------------\n// Studio look-dev rig (per the supplied lighting spec)\n// ---------------------------------------------------------------------------\nfunction createBMXEnduranceBikeLookDevLights(\nmode = 'neutral')\n{\n  const lights = new THREE.Group();\n  lights.name = 'BMX Endurance Bike look-dev lights';\n\n  // Key — warm, high right, sharp shadow\n  const key = new THREE.DirectionalLight(0xfff8f0, mode === 'grazing' ? 2.6 : 1.9);\n  key.position.set(5, 8, 5);\n  key.castShadow = true;\n  key.shadow.mapSize.set(2048, 2048);\n  key.shadow.bias = -0.0003;\n  key.shadow.normalBias = 0.02;\n  key.shadow.radius = 6;\n  key.shadow.camera.near = 0.5;\n  key.shadow.camera.far = 30;\n  key.shadow.camera.left = -2.2;\n  key.shadow.camera.right = 2.2;\n  key.shadow.camera.top = 2.2;\n  key.shadow.camera.bottom = -2.2;\n  key.shadow.camera.updateProjectionMatrix();\n  lights.add(key);\n\n  // Fill — warm + soft, front-left; catches bevels without desaturating the orange\n  const fill = new THREE.DirectionalLight(0xffe7cc, 0.45);\n  fill.position.set(-6, 3, 4);\n  lights.add(fill);\n\n  // Rim — behind, separates black parts from the dark stage\n  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 3.0 : 1.9);\n  rim.position.set(0, 6, -6);\n  lights.add(rim);\n\n  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x14161c, 0.3);\n  lights.add(hemi);\n\n  // Softbox panels — large area lights that paint the long, curved specular streaks\n  // the reference shows running down the glossy frame + mag wheels. Kept modest so\n  // they add streaks without flooding the scene and desaturating the orange.\n  RectAreaLightUniformsLib.init();\n  const softTop = new THREE.RectAreaLight(0xffffff, 2.2, 2.4, 0.5);\n  softTop.position.set(0, 2.4, 1.2);\n  softTop.lookAt(0, -0.2, 0);\n  lights.add(softTop);\n\n  const softSide = new THREE.RectAreaLight(0xfff2df, 1.5, 0.5, 2.0);\n  softSide.position.set(1.6, 0.4, 2.2);\n  softSide.lookAt(0, -0.1, 0);\n  lights.add(softSide);\n\n  lights.userData.reviewMode = mode;\n  return lights;\n}\nvar __export_entries = ["createBMXEnduranceBikeModel","createBMXEnduranceBikeLookDevLights"];	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
63	geometry_decoration	village_场景_1770866496982_fence_24	geometry:fence	93.20459091129409	0	-6.795409088705912	0	0.49039978347853685	0	0.8718500724920506	0.8718500724920506	0.8718500724920506	\N	2026-02-12 11:21:41.226467	2026-02-12 11:21:41.226467	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
85	geometry_terrain	village_1770877975255_mountain_2	geometry:mountain	-54.71032545445996	11.401334839045589	1.9658211413165603	0	3.01963690898153	0	1.773445694185679	1.773445694185679	1.773445694185679	\N	2026-02-12 14:32:55.914861	2026-07-22 15:55:28.642785	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
66	geometry_animal	village_场景_1770866496982_hen_27	geometry:hen	98.19417242011923	0	-1.8624346593469063	0	3.9150969416075534	0	0.9534329963609827	0.9534329963609827	0.9534329963609827	\N	2026-02-12 11:21:41.228045	2026-02-12 11:21:41.228045	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
67	geometry_animal	village_场景_1770866496982_hen_28	geometry:hen	101.80194744935174	0	5.967104186292474	0	0.07273015231722982	0	0.8729056435594956	0.8729056435594956	0.8729056435594956	\N	2026-02-12 11:21:41.228571	2026-02-12 11:21:41.228571	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
68	geometry_animal	village_场景_1770866496982_cat_29	geometry:cat	92.14524562879114	0	18.580514714849528	0	1.4489538367309014	0	0.7321020306829472	0.7321020306829472	0.7321020306829472	\N	2026-02-12 11:21:41.229045	2026-02-12 11:21:41.229045	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
45	geometry_building	village_场景_1770866496982_cottage_6	geometry:cottage	81.5689654976512	0	-2.66285434172907	0	0.39508847992008517	0	2.4358693476072353	2.4358693476072353	2.4358693476072353	\N	2026-02-12 11:21:41.214291	2026-02-12 11:22:45.913634	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
69	geometry_vehicle	space_场景_1770876147700_spaceship_1	geometry:spaceship	-12.447849038432954	0	-113.30551569059652	0	3.7294986946172664	0	1.3770632507481837	1.3770632507481837	1.3770632507481837	\N	2026-02-12 14:02:29.372115	2026-02-12 14:02:29.372115	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
70	geometry_vehicle	space_场景_1770876147700_spaceship_2	geometry:spaceship	-7.354959499205362	0	-94.4817318256691	0	5.343207992886674	0	1.690173244238343	1.690173244238343	1.690173244238343	\N	2026-02-12 14:02:29.390861	2026-02-12 14:02:29.390861	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
71	geometry_vehicle	space_场景_1770876147700_spaceship_3	geometry:spaceship	5.35391614573664	0	-93.47534197603039	0	5.209048122705373	0	1.6452008422587547	1.6452008422587547	1.6452008422587547	\N	2026-02-12 14:02:29.391585	2026-02-12 14:02:29.391585	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
72	geometry_decoration	space_场景_1770876147700_crystal_4	geometry:crystal	12.668463590143787	0	-105.19551966098895	0	1.4890809149772049	0	1.240809480437342	1.240809480437342	1.240809480437342	\N	2026-02-12 14:02:29.392156	2026-02-12 14:02:29.392156	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
73	geometry_decoration	space_场景_1770876147700_crystal_5	geometry:crystal	-11.770791527441261	0	-82.91294356818901	0	4.180740639429222	0	0.8068903900136962	0.8068903900136962	0.8068903900136962	\N	2026-02-12 14:02:29.392622	2026-02-12 14:02:29.392622	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
74	geometry_decoration	space_场景_1770876147700_crystal_6	geometry:crystal	6.976417327461611	0	-104.85891374837684	0	0.3206437460536949	0	1.1046364237202908	1.1046364237202908	1.1046364237202908	\N	2026-02-12 14:02:29.393036	2026-02-12 14:02:29.393036	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
75	geometry_decoration	space_场景_1770876147700_crystal_7	geometry:crystal	-1.8025178382430198	0	-119.06353024859396	0	1.7722176107463066	0	1.22233288510519	1.22233288510519	1.22233288510519	\N	2026-02-12 14:02:29.393412	2026-02-12 14:02:29.393412	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
76	geometry_decoration	space_场景_1770876147700_crystal_8	geometry:crystal	-0.0399380363502857	0	-89.39362951597896	0	1.224537280308257	0	0.714353831254911	0.714353831254911	0.714353831254911	\N	2026-02-12 14:02:29.393783	2026-02-12 14:02:29.393783	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
77	geometry_decoration	space_场景_1770876147700_crystal_9	geometry:crystal	3.002205247721186	0	-103.47759727162739	0	0.25933783140009037	0	1.4544911561912506	1.4544911561912506	1.4544911561912506	\N	2026-02-12 14:02:29.394172	2026-02-12 14:02:29.394172	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
78	geometry_decoration	space_场景_1770876147700_crystal_10	geometry:crystal	0.8924418675553198	0	-84.92277803598384	0	5.366552596966661	0	1.1754395238076831	1.1754395238076831	1.1754395238076831	\N	2026-02-12 14:02:29.394537	2026-02-12 14:02:29.394537	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
79	geometry_decoration	space_场景_1770876147700_crystal_11	geometry:crystal	-10.292682131529215	0	-98.2857028211134	0	5.07748350662595	0	1.3024053722588016	1.3024053722588016	1.3024053722588016	\N	2026-02-12 14:02:29.394896	2026-02-12 14:02:29.394896	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
80	geometry_decoration	space_场景_1770876147700_crystal_12	geometry:crystal	19.553245618033507	0	-113.04182497017877	0	5.856114155361672	0	1.173365700821015	1.173365700821015	1.173365700821015	\N	2026-02-12 14:02:29.395259	2026-02-12 14:02:29.395259	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
81	geometry_decoration	space_场景_1770876147700_crystal_13	geometry:crystal	19.066584379006592	0	-89.58785683150595	0	4.0619613647912045	0	0.8933652257623104	0.8933652257623104	0.8933652257623104	\N	2026-02-12 14:02:29.395672	2026-02-12 14:02:29.395672	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
84	geometry_terrain	village_1770877975255_mountain_1	geometry:mountain	-40.89676246901513	0	8.097661281414222	0	5.5984699185754705	0	1.773445694185679	1.773445694185679	1.773445694185679	\N	2026-02-12 14:32:55.901489	2026-02-12 14:32:55.901489	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
87	geometry_building	village_1770877975255_cottage_4	geometry:cottage	-42.873828742057164	0	43.611398648087416	0	1.2906997398597853	0	1.718032773974717	1.718032773974717	1.718032773974717	\N	2026-02-12 14:32:55.915953	2026-02-12 14:32:55.915953	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
88	geometry_building	village_1770877975255_cottage_5	geometry:cottage	-43.2820120613771	0	34.96207905880067	0	2.0857957638787368	0	1.6539600619898602	1.6539600619898602	1.6539600619898602	\N	2026-02-12 14:32:55.917053	2026-02-12 14:32:55.917053	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
90	geometry_building	village_1770877975255_cottage_7	geometry:cottage	-43.75152896254694	0	34.458136938140974	0	3.403207271005922	0	1.3099016384968183	1.3099016384968183	1.3099016384968183	\N	2026-02-12 14:32:55.918781	2026-02-12 14:32:55.918781	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
91	geometry_building	village_1770877975255_cottage_8	geometry:cottage	-39.297643168378535	0	37.928732142502746	0	3.7033026806804736	0	1.4387306594327667	1.4387306594327667	1.4387306594327667	\N	2026-02-12 14:32:55.919468	2026-02-12 14:32:55.919468	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
92	geometry_nature	village_1770877975255_tree_9	geometry:tree	-21.757278329012543	0	30.536216750489494	0	0.9652720722519684	0	2.2573253573149383	2.2573253573149383	2.2573253573149383	\N	2026-02-12 14:32:55.919919	2026-02-12 14:32:55.919919	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
93	geometry_nature	village_1770877975255_tree_10	geometry:tree	-43.72515480067196	0	20.602067098490007	0	3.4473798649684158	0	1.2975836365559525	1.2975836365559525	1.2975836365559525	\N	2026-02-12 14:32:55.920408	2026-02-12 14:32:55.920408	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
94	geometry_nature	village_1770877975255_tree_11	geometry:tree	-50.39938428327122	0	29.090923677702065	0	1.1187941811417628	0	2.31187691976142	2.31187691976142	2.31187691976142	\N	2026-02-12 14:32:55.920848	2026-02-12 14:32:55.920848	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
95	geometry_nature	village_1770877975255_tree_12	geometry:tree	-58.82612325457347	0	34.13407094427944	0	0.6366854775334294	0	2.5287569118857816	2.5287569118857816	2.5287569118857816	\N	2026-02-12 14:32:55.921235	2026-02-12 14:32:55.921235	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
96	geometry_nature	village_1770877975255_tree_13	geometry:tree	-54.26767618752977	0	35.86637729396776	0	6.212097692235541	0	1.8142008412401216	1.8142008412401216	1.8142008412401216	\N	2026-02-12 14:32:55.9216	2026-02-12 14:32:55.9216	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
97	geometry_nature	village_1770877975255_tree_14	geometry:tree	-59.05522321436355	0	56.59125049989319	0	3.527443081109145	0	2.233891437550946	2.233891437550946	2.233891437550946	\N	2026-02-12 14:32:55.921963	2026-02-12 14:32:55.921963	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
98	geometry_nature	village_1770877975255_tree_15	geometry:tree	-59.91879698928706	0	54.90503880557247	0	2.962140555737416	0	2.3844794383284342	2.3844794383284342	2.3844794383284342	\N	2026-02-12 14:32:55.922318	2026-02-12 14:32:55.922318	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
99	geometry_nature	village_1770877975255_tree_16	geometry:tree	-34.6949156959703	0	30.52690027077328	0	2.298068564653607	0	2.434941308537934	2.434941308537934	2.434941308537934	\N	2026-02-12 14:32:55.922693	2026-02-12 14:32:55.922693	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
100	geometry_nature	village_1770877975255_tree_17	geometry:tree	-46.65459399046483	0	26.304867156530126	0	1.34299664160706	0	2.278031581664789	2.278031581664789	2.278031581664789	\N	2026-02-12 14:32:55.923081	2026-02-12 14:32:55.923081	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
102	geometry_decoration	village_1770877975255_fence_19	geometry:fence	-32.78457930525775	0	38.96496211492766	0	6.0474007665770735	0	1.3286272574906246	1.3286272574906246	1.3286272574906246	\N	2026-02-12 14:32:55.923809	2026-02-12 14:32:55.923809	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
89	geometry_building	village_1770877975255_cottage_6	geometry:cottage	-44.795286639775014	0	35.80881959949216	0	3.6265776515185695	0	1.7646817551075131	1.7646817551075131	1.7646817551075131	\N	2026-02-12 14:32:55.917987	2026-02-13 10:46:09.10509	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
82	geometry_building	space_场景_1770876147700_tower_14	geometry:tower	8.364817014483354	0	-95.1921315737212	0	5.620918168106606	0	4.092498728006369	4.092498728006369	4.092498728006369	\N	2026-02-12 14:02:29.396031	2026-06-13 15:19:53.463339	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
86	geometry_terrain	village_1770877975255_mountain_3	geometry:mountain	-68.91492516263261	0	5.0067781190867535	0	4.843143281288625	0	1.773445694185679	1.773445694185679	1.773445694185679	\N	2026-02-12 14:32:55.915399	2026-02-14 14:01:52.522259	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
83	geometry_building	space_场景_1770876147700_tower_15	geometry:tower	-18.436815327524254	0	-112.3257779591841	0	1.837065164671856	0	3.010500186330015	3.010500186330015	3.010500186330015	\N	2026-02-12 14:02:29.396382	2026-06-13 15:20:07.361635	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
103	geometry_decoration	village_1770877975255_fence_20	geometry:fence	-35.28464615989491	0	45.17618360259749	0	0.7207006840706033	0	1.6958029838018298	1.6958029838018298	1.6958029838018298	\N	2026-02-12 14:32:55.924182	2026-02-12 14:32:55.924182	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
104	geometry_decoration	village_1770877975255_fence_21	geometry:fence	-41.495867647564744	0	47.46724022754084	0	5.921320876295173	0	1.5236960576558618	1.5236960576558618	1.5236960576558618	\N	2026-02-12 14:32:55.92472	2026-02-12 14:32:55.92472	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
105	geometry_decoration	village_1770877975255_fence_22	geometry:fence	-47.51929115757633	0	44.98838562493925	0	0.5808587121595675	0	1.2714401791134478	1.2714401791134478	1.2714401791134478	\N	2026-02-12 14:32:55.925075	2026-02-12 14:32:55.925075	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
106	geometry_decoration	village_1770877975255_fence_23	geometry:fence	-51.227953449690375	0	38.96496211492766	0	1.4245781012464618	0	1.4737662911085418	1.4737662911085418	1.4737662911085418	\N	2026-02-12 14:32:55.925423	2026-02-12 14:32:55.925423	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
107	geometry_decoration	village_1770877975255_fence_24	geometry:fence	-47.73965728321721	0	32.7211724792752	0	4.344428888360858	0	1.4384693511551359	1.4384693511551359	1.4384693511551359	\N	2026-02-12 14:32:55.925766	2026-02-12 14:32:55.925766	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
108	geometry_decoration	village_1770877975255_fence_25	geometry:fence	-41.495867647564744	0	29.739666877372343	0	5.7795785676268725	0	1.5236692121434272	1.5236692121434272	1.5236692121434272	\N	2026-02-12 14:32:55.926116	2026-02-12 14:32:55.926116	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
109	geometry_decoration	village_1770877975255_fence_26	geometry:fence	-35.1327645439972	0	32.60185901136011	0	4.212233785203771	0	1.6068496179700649	1.6068496179700649	1.6068496179700649	\N	2026-02-12 14:32:55.926497	2026-02-12 14:32:55.926497	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
110	geometry_animal	village_1770877975255_hen_27	geometry:hen	-42.34189015883878	0	47.56614941977395	0	0.28151227196673567	0	1.5709120173359679	1.5709120173359679	1.5709120173359679	\N	2026-02-12 14:32:55.926903	2026-02-12 14:32:55.926903	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
111	geometry_animal	village_1770877975255_hen_28	geometry:hen	-35.79113005657927	0	45.318024614601626	0	4.4785870348196	0	1.651691796859369	1.651691796859369	1.651691796859369	\N	2026-02-12 14:32:55.927282	2026-02-12 14:32:55.927282	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
112	geometry_animal	village_1770877975255_cat_29	geometry:cat	-24.377715854173644	0	23.33934635048533	0	3.428076667219114	0	1.6528253293614341	1.6528253293614341	1.6528253293614341	\N	2026-02-12 14:32:55.927675	2026-02-12 14:32:55.927675	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
114	geometry_building	city_1770879830289_skyscraper_2	geometry:skyscraper	46.05121186815943	0	-16	0	2.8450377238259126	0	1.2913863990973675	1.2913863990973675	1.2913863990973675	\N	2026-02-12 15:03:50.966325	2026-02-12 15:03:50.966325	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
116	geometry_building	city_1770879830289_skyscraper_4	geometry:skyscraper	62.05121186815943	0	-16	0	5.185632174035798	0	1.4826002875733302	1.4826002875733302	1.4826002875733302	\N	2026-02-12 15:03:50.967636	2026-02-12 15:03:50.967636	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
117	geometry_building	city_1770879830289_skyscraper_5	geometry:skyscraper	38.05121186815943	0	-8	0	0.1337138132105484	0	0.7736491495441532	0.7736491495441532	0.7736491495441532	\N	2026-02-12 15:03:50.968604	2026-02-12 15:03:50.968604	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
118	geometry_building	city_1770879830289_skyscraper_6	geometry:skyscraper	46.05121186815943	0	-8	0	2.2185206904848727	0	0.7095109032765543	0.7095109032765543	0.7095109032765543	\N	2026-02-12 15:03:50.969284	2026-02-12 15:03:50.969284	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
119	geometry_building	city_1770879830289_skyscraper_7	geometry:skyscraper	54.05121186815943	0	-8	0	3.4233534111386037	0	1.492716105652378	1.492716105652378	1.492716105652378	\N	2026-02-12 15:03:50.9699	2026-02-12 15:03:50.9699	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
120	geometry_building	city_1770879830289_skyscraper_8	geometry:skyscraper	62.05121186815943	0	-8	0	5.018937544505627	0	0.7639795153534541	0.7639795153534541	0.7639795153534541	\N	2026-02-12 15:03:50.970482	2026-02-12 15:03:50.970482	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
121	geometry_building	city_1770879830289_skyscraper_9	geometry:skyscraper	38.05121186815943	0	0	0	2.209014845667802	0	0.7343362067649363	0.7343362067649363	0.7343362067649363	\N	2026-02-12 15:03:50.971387	2026-02-12 15:03:50.971387	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
122	geometry_building	city_1770879830289_skyscraper_10	geometry:skyscraper	46.05121186815943	0	0	0	4.652243916193528	0	0.8169926982654342	0.8169926982654342	0.8169926982654342	\N	2026-02-12 15:03:50.971993	2026-02-12 15:03:50.971993	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
123	geometry_building	city_1770879830289_skyscraper_11	geometry:skyscraper	54.05121186815943	0	0	0	2.0073442050960875	0	1.0227598387529937	1.0227598387529937	1.0227598387529937	\N	2026-02-12 15:03:50.97249	2026-02-12 15:03:50.97249	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
124	geometry_building	city_1770879830289_skyscraper_12	geometry:skyscraper	62.05121186815943	0	0	0	6.098419653087786	0	0.7376600072982921	0.7376600072982921	0.7376600072982921	\N	2026-02-12 15:03:50.973036	2026-02-12 15:03:50.973036	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
125	geometry_decoration	city_1770879830289_lamp_13	geometry:lamp	34.05121186815943	0	-20	0	3.5362287827582133	0	0.9679253031574083	0.9679253031574083	0.9679253031574083	\N	2026-02-12 15:03:50.9736	2026-02-12 15:03:50.9736	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
126	geometry_decoration	city_1770879830289_lamp_14	geometry:lamp	42.05121186815943	0	-20	0	3.482662197237865	0	0.7726395453175933	0.7726395453175933	0.7726395453175933	\N	2026-02-12 15:03:50.974283	2026-02-12 15:03:50.974283	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
127	geometry_decoration	city_1770879830289_lamp_15	geometry:lamp	50.05121186815943	0	-20	0	0.6571547130615658	0	0.7926466797806597	0.7926466797806597	0.7926466797806597	\N	2026-02-12 15:03:50.974846	2026-02-12 15:03:50.974846	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
128	geometry_decoration	city_1770879830289_lamp_16	geometry:lamp	58.05121186815943	0	-20	0	6.035445887959367	0	0.9234903812479262	0.9234903812479262	0.9234903812479262	\N	2026-02-12 15:03:50.975386	2026-02-12 15:03:50.975386	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
129	geometry_decoration	city_1770879830289_lamp_17	geometry:lamp	66.05121186815943	0	-20	0	2.812215231004756	0	0.7547267163468313	0.7547267163468313	0.7547267163468313	\N	2026-02-12 15:03:50.975842	2026-02-12 15:03:50.975842	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
130	geometry_decoration	city_1770879830289_lamp_18	geometry:lamp	34.05121186815943	0	-12	0	4.643394429687125	0	0.701396583924572	0.701396583924572	0.701396583924572	\N	2026-02-12 15:03:50.976224	2026-02-12 15:03:50.976224	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
131	geometry_decoration	city_1770879830289_lamp_19	geometry:lamp	42.05121186815943	0	-12	0	0.13599544366934113	0	0.7594930068595023	0.7594930068595023	0.7594930068595023	\N	2026-02-12 15:03:50.976577	2026-02-12 15:03:50.976577	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
132	geometry_decoration	city_1770879830289_lamp_20	geometry:lamp	50.05121186815943	0	-12	0	3.0222379392818546	0	0.8318590206599209	0.8318590206599209	0.8318590206599209	\N	2026-02-12 15:03:50.97696	2026-02-12 15:03:50.97696	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
133	geometry_decoration	city_1770879830289_lamp_21	geometry:lamp	58.05121186815943	0	-12	0	5.761693241845573	0	0.8295391415960413	0.8295391415960413	0.8295391415960413	\N	2026-02-12 15:03:50.977339	2026-02-12 15:03:50.977339	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
134	geometry_decoration	city_1770879830289_lamp_22	geometry:lamp	66.05121186815943	0	-12	0	6.227557184919011	0	0.8311778742759262	0.8311778742759262	0.8311778742759262	\N	2026-02-12 15:03:50.977688	2026-02-12 15:03:50.977688	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
135	geometry_decoration	city_1770879830289_lamp_23	geometry:lamp	34.05121186815943	0	-4	0	3.199790728797191	0	0.8228667224593883	0.8228667224593883	0.8228667224593883	\N	2026-02-12 15:03:50.978023	2026-02-12 15:03:50.978023	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
136	geometry_decoration	city_1770879830289_lamp_24	geometry:lamp	42.05121186815943	0	-4	0	5.808860850374242	0	0.7743591714872529	0.7743591714872529	0.7743591714872529	\N	2026-02-12 15:03:50.978403	2026-02-12 15:03:50.978403	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
137	geometry_decoration	city_1770879830289_lamp_25	geometry:lamp	50.05121186815943	0	-4	0	2.4238182577813063	0	0.903131106243336	0.903131106243336	0.903131106243336	\N	2026-02-12 15:03:50.978743	2026-02-12 15:03:50.978743	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
138	geometry_decoration	city_1770879830289_lamp_26	geometry:lamp	58.05121186815943	0	-4	0	3.3109601807879474	0	0.8703505763289422	0.8703505763289422	0.8703505763289422	\N	2026-02-12 15:03:50.97908	2026-02-12 15:03:50.97908	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
139	geometry_decoration	city_1770879830289_lamp_27	geometry:lamp	66.05121186815943	0	-4	0	1.9551709526476961	0	0.8855961244721448	0.8855961244721448	0.8855961244721448	\N	2026-02-12 15:03:50.979411	2026-02-12 15:03:50.979411	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
140	geometry_decoration	city_1770879830289_lamp_28	geometry:lamp	34.05121186815943	0	4	0	3.1249147896324576	0	0.836730484078815	0.836730484078815	0.836730484078815	\N	2026-02-12 15:03:50.97974	2026-02-12 15:03:50.97974	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
141	geometry_decoration	city_1770879830289_lamp_29	geometry:lamp	42.05121186815943	0	4	0	6.240591710629092	0	0.8958555200853371	0.8958555200853371	0.8958555200853371	\N	2026-02-12 15:03:50.980071	2026-02-12 15:03:50.980071	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
142	geometry_decoration	city_1770879830289_lamp_30	geometry:lamp	50.05121186815943	0	4	0	1.6593525444104047	0	0.8404842758967833	0.8404842758967833	0.8404842758967833	\N	2026-02-12 15:03:50.980399	2026-02-12 15:03:50.980399	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
143	geometry_decoration	city_1770879830289_lamp_31	geometry:lamp	58.05121186815943	0	4	0	2.030758330500297	0	0.9516648043152008	0.9516648043152008	0.9516648043152008	\N	2026-02-12 15:03:50.98073	2026-02-12 15:03:50.98073	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
113	geometry_building	乡村村落_1778144396568_cottage_11	geometry:skyscraper	38.05121186815943	0	-16	0	5.490508280328469	0	1.2581076401777396	1.2581076401777396	1.2581076401777396	\N	2026-02-12 15:03:50.964456	2026-07-22 15:21:19.055392	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
144	geometry_decoration	city_1770879830289_lamp_32	geometry:lamp	66.05121186815943	0	4	0	5.409787783275998	0	0.794669329471013	0.794669329471013	0.794669329471013	\N	2026-02-12 15:03:50.981056	2026-02-12 15:03:50.981056	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
145	geometry_vehicle	city_1770879830289_car_33	geometry:car	39.05121186815943	0	-3.597216263785028	0	5.2558221681462145	0	0.7242723622978099	0.7242723622978099	0.7242723622978099	\N	2026-02-12 15:03:50.981524	2026-02-12 15:03:50.981524	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
146	geometry_vehicle	city_1770879830289_car_34	geometry:car	42.80121186815943	0	-4.853067289528131	0	1.3751552369839173	0	0.836239708756926	0.836239708756926	0.836239708756926	\N	2026-02-12 15:03:50.981882	2026-02-12 15:03:50.981882	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
147	geometry_vehicle	city_1770879830289_car_35	geometry:car	46.55121186815943	0	-3.6820922201914	0	3.530853762227794	0	0.7119242135329295	0.7119242135329295	0.7119242135329295	\N	2026-02-12 15:03:50.982217	2026-02-12 15:03:50.982217	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
148	geometry_vehicle	city_1770879830289_car_36	geometry:car	50.30121186815943	0	-4.678400595003099	0	4.980032389317732	0	0.8053741119081254	0.8053741119081254	0.8053741119081254	\N	2026-02-12 15:03:50.982547	2026-02-12 15:03:50.982547	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
149	geometry_vehicle	city_1770879830289_car_37	geometry:car	54.05121186815943	0	-3.3252861535858873	0	1.741617292408616	0	0.7815980493609448	0.7815980493609448	0.7815980493609448	\N	2026-02-12 15:03:50.982872	2026-02-12 15:03:50.982872	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
150	geometry_vehicle	city_1770879830289_car_38	geometry:car	57.80121186815943	0	-3.5443657918692453	0	0.6703209117877256	0	0.7559229692415078	0.7559229692415078	0.7559229692415078	\N	2026-02-12 15:03:50.983412	2026-02-12 15:03:50.983412	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
151	geometry_vehicle	city_1770879830289_car_39	geometry:car	61.55121186815943	0	-4.159093555974018	0	2.25741745550616	0	0.9200215892315408	0.9200215892315408	0.9200215892315408	\N	2026-02-12 15:03:50.98409	2026-02-12 15:03:50.98409	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
152	geometry_vehicle	city_1770879830289_car_40	geometry:car	65.30121186815943	0	-4.8551182594808715	0	4.533874792735608	0	0.8541670499948184	0.8541670499948184	0.8541670499948184	\N	2026-02-12 15:03:50.985436	2026-02-12 15:03:50.985436	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
153	geometry_nature	city_1770879830289_tree_41	geometry:tree	39.05121186815943	0	-4.785501527872792	0	3.9776380815417283	0	0.8969971323608265	0.8969971323608265	0.8969971323608265	\N	2026-02-12 15:03:51.0121	2026-02-12 15:03:51.0121	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
154	geometry_nature	city_1770879830289_tree_42	geometry:tree	41.05121186815943	0	-4.361954364903276	0	3.5275641389575796	0	0.8055361455461779	0.8055361455461779	0.8055361455461779	\N	2026-02-12 15:03:51.012604	2026-02-12 15:03:51.012604	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
155	geometry_nature	city_1770879830289_tree_43	geometry:tree	43.05121186815943	0	-3.497160908537217	0	1.569780279664792	0	0.8405873965995004	0.8405873965995004	0.8405873965995004	\N	2026-02-12 15:03:51.012968	2026-02-12 15:03:51.012968	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
156	geometry_nature	city_1770879830289_tree_44	geometry:tree	45.05121186815943	0	-3.5315906933047336	0	2.0430262663972636	0	0.8150922130106167	0.8150922130106167	0.8150922130106167	\N	2026-02-12 15:03:51.013307	2026-02-12 15:03:51.013307	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
157	geometry_nature	city_1770879830289_tree_45	geometry:tree	47.05121186815943	0	-4.529031725531967	0	4.003657751179839	0	0.9649057801842978	0.9649057801842978	0.9649057801842978	\N	2026-02-12 15:03:51.013642	2026-02-12 15:03:51.013642	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
158	geometry_nature	city_1770879830289_tree_46	geometry:tree	49.05121186815943	0	-3.4108885559815167	0	3.337016530143387	0	0.9931833880054631	0.9931833880054631	0.9931833880054631	\N	2026-02-12 15:03:51.013977	2026-02-12 15:03:51.013977	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
159	geometry_nature	city_1770879830289_tree_47	geometry:tree	51.05121186815943	0	-3.6274286813356444	0	3.7732959386475997	0	0.7116748422356945	0.7116748422356945	0.7116748422356945	\N	2026-02-12 15:03:51.014305	2026-02-12 15:03:51.014305	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
160	geometry_nature	city_1770879830289_tree_48	geometry:tree	53.05121186815943	0	-3.5219595494691167	0	0.7753348802298617	0	0.8523456857521615	0.8523456857521615	0.8523456857521615	\N	2026-02-12 15:03:51.014703	2026-02-12 15:03:51.014703	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
161	geometry_nature	city_1770879830289_tree_49	geometry:tree	55.05121186815943	0	-3.0047828753561907	0	3.9410508176127115	0	0.7779301922923829	0.7779301922923829	0.7779301922923829	\N	2026-02-12 15:03:51.015112	2026-02-12 15:03:51.015112	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
162	geometry_nature	city_1770879830289_tree_50	geometry:tree	57.05121186815943	0	-3.099428862899847	0	0.4266542163293381	0	0.8056928653396974	0.8056928653396974	0.8056928653396974	\N	2026-02-12 15:03:51.015558	2026-02-12 15:03:51.015558	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
163	geometry_nature	city_1770879830289_tree_51	geometry:tree	59.05121186815943	0	-4.756106677005683	0	2.935997687821794	0	0.9705490788158014	0.9705490788158014	0.9705490788158014	\N	2026-02-12 15:03:51.015972	2026-02-12 15:03:51.015972	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
164	geometry_nature	city_1770879830289_tree_52	geometry:tree	61.05121186815943	0	-4.329097403342461	0	4.188005429901257	0	0.8560725383122444	0.8560725383122444	0.8560725383122444	\N	2026-02-12 15:03:51.033018	2026-02-12 15:03:51.033018	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
165	geometry_nature	city_1770879830289_tree_53	geometry:tree	63.05121186815943	0	-4.670259539921593	0	3.5905035212716903	0	0.7518639652403105	0.7518639652403105	0.7518639652403105	\N	2026-02-12 15:03:51.033999	2026-02-12 15:03:51.033999	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
166	geometry_nature	city_1770879830289_tree_54	geometry:tree	65.05121186815943	0	-3.3186917128766344	0	2.6919131688523597	0	0.7997377968652711	0.7997377968652711	0.7997377968652711	\N	2026-02-12 15:03:51.03515	2026-02-12 15:03:51.03515	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
167	geometry_nature	city_1770879830289_tree_55	geometry:tree	67.05121186815943	0	-3.9546330750100074	0	6.1983024871223185	0	0.9488736156057582	0.9488736156057582	0.9488736156057582	\N	2026-02-12 15:03:51.035793	2026-02-12 15:03:51.035793	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
169	uploaded_model	6f66fa55-49df-4b8e-9838-4c4e46fff939_0.zip	/models/uploaded/model-1770882210680-108958276/0bc2588c9c0adb0b9812c68902bb3768.obj	11.83	6.26	54.311720563182895	0	0	0	16.81	16.81	16.81	\N	2026-02-12 15:55:15.05522	2026-07-22 15:24:08.933339	obj	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
187	geometry_nature	forest_1771048291840_tree_14	geometry:tree	-61.47383877064013	0	-17.546404303312613	0	4.573323065563579	0	1.458387708511572	1.458387708511572	1.458387708511572	\N	2026-02-14 13:51:32.552525	2026-02-14 13:51:32.552525	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
188	geometry_nature	forest_1771048291840_tree_15	geometry:tree	-64.39899957774759	0	-22.066089850962012	0	6.243238728337304	0	0.9563703859883672	0.9563703859883672	0.9563703859883672	\N	2026-02-14 13:51:32.552987	2026-02-14 13:51:32.552987	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
189	geometry_nature	forest_1771048291840_tree_16	geometry:tree	-60.56242262390259	0	-22.5696861103521	0	2.8914658298883946	0	1.0914790978227222	1.0914790978227222	1.0914790978227222	\N	2026-02-14 13:51:32.553414	2026-02-14 13:51:32.553414	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
190	geometry_nature	forest_1771048291840_tree_17	geometry:tree	-64.21593644639469	0	-19.80704388822348	0	5.790561172208771	0	0.7048294983216894	0.7048294983216894	0.7048294983216894	\N	2026-02-14 13:51:32.553939	2026-02-14 13:51:32.553939	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
191	geometry_nature	forest_1771048291840_tree_18	geometry:tree	-55.47361617585398	0	-23.326474757609564	0	0.4281154369475713	0	1.109007945657706	1.109007945657706	1.109007945657706	\N	2026-02-14 13:51:32.554449	2026-02-14 13:51:32.554449	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
174	geometry_nature	forest_1771048291840_tree_1	geometry:tree	-58.49383906955983	0	-20.563118674734582	0	2.6862841549946737	0	1.1650831527504828	1.1650831527504828	1.1650831527504828	\N	2026-02-14 13:51:32.538314	2026-02-14 13:51:32.538314	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
175	geometry_nature	forest_1771048291840_tree_2	geometry:tree	-55.64135261595693	0	-14.836352743618214	0	3.7679494109188307	0	0.9011724401370574	0.9011724401370574	0.9011724401370574	\N	2026-02-14 13:51:32.54696	2026-02-14 13:51:32.54696	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
176	geometry_nature	forest_1771048291840_tree_3	geometry:tree	-56.313362709184744	0	-16.104607392816725	0	4.982619123757087	0	1.0446849659079578	1.0446849659079578	1.0446849659079578	\N	2026-02-14 13:51:32.547568	2026-02-14 13:51:32.547568	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
177	geometry_nature	forest_1771048291840_tree_4	geometry:tree	-64.15662665617043	0	-17.580609156932468	0	1.3107424010176363	0	0.8364142122864967	0.8364142122864967	0.8364142122864967	\N	2026-02-14 13:51:32.548037	2026-02-14 13:51:32.548037	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
178	geometry_nature	forest_1771048291840_tree_5	geometry:tree	-57.97907352160594	0	-25.063504839209653	0	1.4053996887814553	0	0.9370214590346024	0.9370214590346024	0.9370214590346024	\N	2026-02-14 13:51:32.548702	2026-02-14 13:51:32.548702	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
180	geometry_nature	forest_1771048291840_tree_7	geometry:tree	-58.760342060416164	0	-20.761836081402567	0	4.1045305427277805	0	0.7740722943838869	0.7740722943838869	0.7740722943838869	\N	2026-02-14 13:51:32.54962	2026-02-14 13:51:32.54962	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
181	geometry_nature	forest_1771048291840_tree_8	geometry:tree	-55.9951374370228	0	-21.89771800744009	0	4.316939733065838	0	1.1613322772154768	1.1613322772154768	1.1613322772154768	\N	2026-02-14 13:51:32.550054	2026-02-14 13:51:32.550054	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
182	geometry_nature	forest_1771048291840_tree_9	geometry:tree	-53.130312439801145	0	-17.91472714849934	0	4.115108938520444	0	1.2623216149904803	1.2623216149904803	1.2623216149904803	\N	2026-02-14 13:51:32.550524	2026-02-14 13:51:32.550524	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
183	geometry_nature	forest_1771048291840_tree_10	geometry:tree	-63.040093939937506	0	-15.078789343437133	0	3.6417861086227155	0	0.9686913341128349	0.9686913341128349	0.9686913341128349	\N	2026-02-14 13:51:32.550935	2026-02-14 13:51:32.550935	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
184	geometry_nature	forest_1771048291840_tree_11	geometry:tree	-56.74663983771358	0	-16.930815182738908	0	5.609277074687379	0	0.8957735939074837	0.8957735939074837	0.8957735939074837	\N	2026-02-14 13:51:32.551338	2026-02-14 13:51:32.551338	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
185	geometry_nature	forest_1771048291840_tree_12	geometry:tree	-60.40046331044277	0	-23.456190214386734	0	0.6110929097018497	0	1.1824913898338132	1.1824913898338132	1.1824913898338132	\N	2026-02-14 13:51:32.551744	2026-02-14 13:51:32.551744	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
186	geometry_nature	forest_1771048291840_tree_13	geometry:tree	-56.60067366447352	0	-16.429834839067198	0	4.889638234364736	0	1.180679005627846	1.180679005627846	1.180679005627846	\N	2026-02-14 13:51:32.552137	2026-02-14 13:51:32.552137	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
192	geometry_nature	forest_1771048291840_tree_19	geometry:tree	-58.210741586493384	0	-22.70055120782649	0	0.08753006052573135	0	0.8798575996584145	0.8798575996584145	0.8798575996584145	\N	2026-02-14 13:51:32.554911	2026-02-14 13:51:32.554911	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
193	geometry_nature	forest_1771048291840_tree_20	geometry:tree	-54.92536445265273	0	-16.255120192236426	0	2.323235203393214	0	1.106185797375501	1.106185797375501	1.106185797375501	\N	2026-02-14 13:51:32.565558	2026-02-14 13:51:32.565558	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
194	geometry_nature	forest_1771048291840_tree_21	geometry:tree	-55.18089264943329	0	-23.44354640820428	0	0.9387613035247269	0	0.9304050388625359	0.9304050388625359	0.9304050388625359	\N	2026-02-14 13:51:32.566194	2026-02-14 13:51:32.566194	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
195	geometry_nature	forest_1771048291840_tree_22	geometry:tree	-55.53411442298374	0	-21.834476075678854	0	0.4192898561159234	0	0.7650553655100278	0.7650553655100278	0.7650553655100278	\N	2026-02-14 13:51:32.566643	2026-02-14 13:51:32.566643	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
196	geometry_nature	forest_1771048291840_tree_23	geometry:tree	-52.93703681756226	0	-21.08448234152886	0	0.37672043061405913	0	1.2309906164092612	1.2309906164092612	1.2309906164092612	\N	2026-02-14 13:51:32.567084	2026-02-14 13:51:32.567084	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
198	geometry_nature	forest_1771048291840_tree_25	geometry:tree	-55.733802603046215	0	-16.1132453115523	0	4.819034228096529	0	1.394900642207616	1.394900642207616	1.394900642207616	\N	2026-02-14 13:51:32.567951	2026-02-14 13:51:32.567951	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
199	geometry_nature	forest_1771048291840_tree_26	geometry:tree	-64.85009718468052	0	-22.11734063688799	0	3.6405371517420333	0	1.2328555146067077	1.2328555146067077	1.2328555146067077	\N	2026-02-14 13:51:32.568451	2026-02-14 13:51:32.568451	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
200	geometry_nature	forest_1771048291840_tree_27	geometry:tree	-53.71471368782235	0	-21.425236585744443	0	2.7431519621326337	0	0.901501681342627	0.901501681342627	0.901501681342627	\N	2026-02-14 13:51:32.568899	2026-02-14 13:51:32.568899	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
201	geometry_nature	forest_1771048291840_tree_28	geometry:tree	-60.230220376114666	0	-22.154076512773837	0	2.1777815096907287	0	0.7647573531053701	0.7647573531053701	0.7647573531053701	\N	2026-02-14 13:51:32.569303	2026-02-14 13:51:32.569303	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
202	geometry_nature	forest_1771048291840_tree_29	geometry:tree	-61.412650200029944	0	-25.049562408106116	0	1.5841252786166602	0	0.8039846713475778	0.8039846713475778	0.8039846713475778	\N	2026-02-14 13:51:32.56969	2026-02-14 13:51:32.56969	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
203	geometry_nature	forest_1771048291840_tree_30	geometry:tree	-58.33360873827718	0	-20.571829909879536	0	3.953910393662608	0	0.8877056216784401	0.8877056216784401	0.8877056216784401	\N	2026-02-14 13:51:32.570079	2026-02-14 13:51:32.570079	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
204	geometry_nature	forest_1771048291840_rock_31	geometry:rock	-39.753671880455194	0	-22.251931607493294	0	4.076673886681079	0	1.4762397615459288	1.4762397615459288	1.4762397615459288	\N	2026-02-14 13:51:32.570493	2026-02-14 13:51:32.570493	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
205	geometry_nature	forest_1771048291840_rock_32	geometry:rock	-65.58678043617722	0	-3.4905087788850544	0	1.4675563530229114	0	0.8701202464790866	0.8701202464790866	0.8701202464790866	\N	2026-02-14 13:51:32.570899	2026-02-14 13:51:32.570899	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
206	geometry_nature	forest_1771048291840_rock_33	geometry:rock	-44.58549512094066	0	-36.24135513656234	0	4.56378793895437	0	1.3549487065419286	1.3549487065419286	1.3549487065419286	\N	2026-02-14 13:51:32.571295	2026-02-14 13:51:32.571295	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
207	geometry_nature	forest_1771048291840_rock_34	geometry:rock	-76.34160948031874	0	-26.003134172308638	0	4.12348866166316	0	1.1364376506966614	1.1364376506966614	1.1364376506966614	\N	2026-02-14 13:51:32.571676	2026-02-14 13:51:32.571676	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
208	geometry_nature	forest_1771048291840_rock_35	geometry:rock	-41.68372121749115	0	-34.80223535778952	0	2.790469634938104	0	1.469549763866019	1.469549763866019	1.469549763866019	\N	2026-02-14 13:51:32.572071	2026-02-14 13:51:32.572071	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
209	geometry_nature	forest_1771048291840_rock_36	geometry:rock	-67.24703324188553	0	-9.020283382646124	0	5.664670781534749	0	0.956262077551728	0.956262077551728	0.956262077551728	\N	2026-02-14 13:51:32.572471	2026-02-14 13:51:32.572471	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
210	geometry_nature	forest_1771048291840_rock_37	geometry:rock	-45.253403458204154	0	-4.8470812820486735	0	5.620618579724154	0	1.3613180223213461	1.3613180223213461	1.3613180223213461	\N	2026-02-14 13:51:32.572882	2026-02-14 13:51:32.572882	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
211	geometry_nature	forest_1771048291840_rock_38	geometry:rock	-43.96162687339518	0	-12.02314031379903	0	5.43441284665541	0	1.4969528714677185	1.4969528714677185	1.4969528714677185	\N	2026-02-14 13:51:32.573322	2026-02-14 13:51:32.573322	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
212	geometry_nature	forest_1771048291840_rock_39	geometry:rock	-68.3111507357486	0	-19.464954279115435	0	3.393594170489623	0	1.3619238634244308	1.3619238634244308	1.3619238634244308	\N	2026-02-14 13:51:32.573749	2026-02-14 13:51:32.573749	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
213	geometry_nature	forest_1771048291840_rock_40	geometry:rock	-38.45703668189721	0	-3.9326011736236914	0	4.417728828503739	0	0.7186676987510143	0.7186676987510143	0.7186676987510143	\N	2026-02-14 13:51:32.574147	2026-02-14 13:51:32.574147	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
214	geometry_nature	forest_1771048291840_bush_41	geometry:bush	-58.45203700059309	0	-2.0103237707884425	0	2.733688507508056	0	0.8634777091488285	0.8634777091488285	0.8634777091488285	\N	2026-02-14 13:51:32.574518	2026-02-14 13:51:32.574518	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
215	geometry_nature	forest_1771048291840_bush_42	geometry:bush	-56.33419992883921	0	-13.653011303201463	0	5.068105426033661	0	0.9718564217738167	0.9718564217738167	0.9718564217738167	\N	2026-02-14 13:51:32.574913	2026-02-14 13:51:32.574913	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
216	geometry_nature	forest_1771048291840_bush_43	geometry:bush	-46.89582320638218	0	-32.194740686490945	0	4.9388939790628	0	0.9556213901323382	0.9556213901323382	0.9556213901323382	\N	2026-02-14 13:51:32.575297	2026-02-14 13:51:32.575297	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
217	geometry_nature	forest_1771048291840_bush_44	geometry:bush	-59.550789970582514	0	-4.265187180002737	0	1.9523942285154456	0	0.9241765650075776	0.9241765650075776	0.9241765650075776	\N	2026-02-14 13:51:32.575696	2026-02-14 13:51:32.575696	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
218	geometry_nature	forest_1771048291840_bush_45	geometry:bush	-63.05536210293235	0	-1.573446736218326	0	5.409571481269625	0	0.7305775473504049	0.7305775473504049	0.7305775473504049	\N	2026-02-14 13:51:32.576071	2026-02-14 13:51:32.576071	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
219	geometry_nature	forest_1771048291840_bush_46	geometry:bush	-75.44340269678935	0	-37.15186883947699	0	2.4625420423062487	0	0.8865536428143298	0.8865536428143298	0.8865536428143298	\N	2026-02-14 13:51:32.576585	2026-02-14 13:51:32.576585	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
220	geometry_nature	forest_1771048291840_bush_47	geometry:bush	-53.76599460514831	0	-21.109898104276883	0	2.954027267312522	0	0.7538116282472309	0.7538116282472309	0.7538116282472309	\N	2026-02-14 13:51:32.577182	2026-02-14 13:51:32.577182	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
221	geometry_nature	forest_1771048291840_bush_48	geometry:bush	-39.130005514828646	0	-0.9942403592435021	0	1.470790391398669	0	0.7544802045893416	0.7544802045893416	0.7544802045893416	\N	2026-02-14 13:51:32.577706	2026-02-14 13:51:32.577706	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
223	geometry_nature	forest_1771048291840_bush_50	geometry:bush	-45.83821005878289	0	-19.725209828138667	0	5.456313152649219	0	0.8327661695729406	0.8327661695729406	0.8327661695729406	\N	2026-02-14 13:51:32.578661	2026-02-14 13:51:32.578661	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
224	geometry_nature	forest_1771048291840_bush_51	geometry:bush	-40.33497199103149	0	-6.960105318778499	0	0.5089791687607332	0	0.8878462332021048	0.8878462332021048	0.8878462332021048	\N	2026-02-14 13:51:32.579104	2026-02-14 13:51:32.579104	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
225	geometry_nature	forest_1771048291840_bush_52	geometry:bush	-40.15268867551935	0	-19.28420582667304	0	0.11178694890405898	0	0.9839424171395437	0.9839424171395437	0.9839424171395437	\N	2026-02-14 13:51:32.579521	2026-02-14 13:51:32.579521	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
226	geometry_nature	forest_1771048291840_bush_53	geometry:bush	-66.02905901621762	0	-28.40723419363175	0	1.9816165563082206	0	0.8695999937110308	0.8695999937110308	0.8695999937110308	\N	2026-02-14 13:51:32.580037	2026-02-14 13:51:32.580037	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
227	geometry_nature	forest_1771048291840_bush_54	geometry:bush	-63.290107047789384	0	-16.528005355415306	0	1.922960809537516	0	0.8887125899102983	0.8887125899102983	0.8887125899102983	\N	2026-02-14 13:51:32.58048	2026-02-14 13:51:32.58048	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
228	geometry_nature	forest_1771048291840_bush_55	geometry:bush	-70.33472945499261	0	-23.709589873576785	0	2.8064337071984573	0	0.875472923078873	0.875472923078873	0.875472923078873	\N	2026-02-14 13:51:32.580918	2026-02-14 13:51:32.580918	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
229	geometry_nature	forest_1771048291840_bush_56	geometry:bush	-42.21227099531857	0	-24.276075239136464	0	5.199091815693716	0	0.722014915494345	0.722014915494345	0.722014915494345	\N	2026-02-14 13:51:32.581314	2026-02-14 13:51:32.581314	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
230	geometry_nature	forest_1771048291840_bush_57	geometry:bush	-51.10744706837771	0	-31.341276506243403	0	0.5075907337917879	0	0.7627882991049377	0.7627882991049377	0.7627882991049377	\N	2026-02-14 13:51:32.581705	2026-02-14 13:51:32.581705	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
231	geometry_nature	forest_1771048291840_bush_58	geometry:bush	-39.35950837355749	0	-19.309917242114125	0	2.9058906923185406	0	0.8691352143885864	0.8691352143885864	0.8691352143885864	\N	2026-02-14 13:51:32.58209	2026-02-14 13:51:32.58209	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
232	geometry_nature	forest_1771048291840_bush_59	geometry:bush	-42.82917411234935	0	-3.6243503709827216	0	2.5842523259838277	0	0.7410789476000513	0.7410789476000513	0.7410789476000513	\N	2026-02-14 13:51:32.582531	2026-02-14 13:51:32.582531	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
233	geometry_nature	forest_1771048291840_bush_60	geometry:bush	-64.24040761802331	0	-20.434101355285524	0	3.5778781427495363	0	0.8296720924254858	0.8296720924254858	0.8296720924254858	\N	2026-02-14 13:51:32.583046	2026-02-14 13:51:32.583046	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
234	geometry_nature	forest_1771048291840_flower_61	geometry:flower	-48.253255176974555	0	-25.36199166739642	0	2.442021754212472	0	0.8518472459538439	0.8518472459538439	0.8518472459538439	\N	2026-02-14 13:51:32.583772	2026-02-14 13:51:32.583772	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
235	geometry_nature	forest_1771048291840_flower_62	geometry:flower	-56.86987465393969	0	-28.88808249149873	0	2.628755211882922	0	0.7656281867988323	0.7656281867988323	0.7656281867988323	\N	2026-02-14 13:51:32.584286	2026-02-14 13:51:32.584286	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
236	geometry_nature	forest_1771048291840_flower_63	geometry:flower	-55.170936179352566	0	-17.16590701056145	0	5.363991409675017	0	0.7252639542673234	0.7252639542673234	0.7252639542673234	\N	2026-02-14 13:51:32.58475	2026-02-14 13:51:32.58475	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
237	geometry_nature	forest_1771048291840_flower_64	geometry:flower	-54.52581991939957	0	-12.63979096323617	0	2.767691088179231	0	0.709425310442315	0.709425310442315	0.709425310442315	\N	2026-02-14 13:51:32.58517	2026-02-14 13:51:32.58517	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
238	geometry_nature	forest_1771048291840_flower_65	geometry:flower	-67.92572340716536	0	-7.4612227535691	0	2.174631821914544	0	0.8608267247522603	0.8608267247522603	0.8608267247522603	\N	2026-02-14 13:51:32.585571	2026-02-14 13:51:32.585571	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
239	geometry_nature	forest_1771048291840_flower_66	geometry:flower	-47.057457112540796	0	-40.010645822800846	0	5.991386089805338	0	0.8131546944124524	0.8131546944124524	0.8131546944124524	\N	2026-02-14 13:51:32.585951	2026-02-14 13:51:32.585951	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
240	geometry_nature	forest_1771048291840_flower_67	geometry:flower	-60.382638671031316	0	-14.70283952997168	0	1.778863141614823	0	0.8818469920632482	0.8818469920632482	0.8818469920632482	\N	2026-02-14 13:51:32.586327	2026-02-14 13:51:32.586327	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
241	geometry_nature	forest_1771048291840_flower_68	geometry:flower	-64.6231254743679	0	-8.50856376182017	0	2.854773382522281	0	0.8491566330573059	0.8491566330573059	0.8491566330573059	\N	2026-02-14 13:51:32.58673	2026-02-14 13:51:32.58673	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
242	geometry_nature	forest_1771048291840_flower_69	geometry:flower	-65.2613961168665	0	-22.786335353769818	0	6.143207893589391	0	0.9605854140461582	0.9605854140461582	0.9605854140461582	\N	2026-02-14 13:51:32.58712	2026-02-14 13:51:32.58712	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
243	geometry_nature	forest_1771048291840_flower_70	geometry:flower	-62.66393459924238	0	-17.717100233931358	0	0.15227152115386122	0	0.9955700784598381	0.9955700784598381	0.9955700784598381	\N	2026-02-14 13:51:32.587503	2026-02-14 13:51:32.587503	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
244	geometry_nature	forest_1771048291840_flower_71	geometry:flower	-59.42180774292375	0	-13.663818957177941	0	1.3246822176351134	0	0.9648547824958985	0.9648547824958985	0.9648547824958985	\N	2026-02-14 13:51:32.587878	2026-02-14 13:51:32.587878	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
245	geometry_nature	forest_1771048291840_flower_72	geometry:flower	-78.00448876385244	0	-21.981963547125464	0	1.4850029804402367	0	0.7289062136648526	0.7289062136648526	0.7289062136648526	\N	2026-02-14 13:51:32.588243	2026-02-14 13:51:32.588243	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
246	geometry_nature	forest_1771048291840_flower_73	geometry:flower	-73.15794883528064	0	-11.785425835124467	0	2.86742796005888	0	0.8106237630715188	0.8106237630715188	0.8106237630715188	\N	2026-02-14 13:51:32.588634	2026-02-14 13:51:32.588634	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
247	geometry_nature	forest_1771048291840_flower_74	geometry:flower	-70.70435994458116	0	-2.301388695379142	0	2.0737245024215403	0	0.7972403034865652	0.7972403034865652	0.7972403034865652	\N	2026-02-14 13:51:32.589016	2026-02-14 13:51:32.589016	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
248	geometry_nature	forest_1771048291840_flower_75	geometry:flower	-38.80338850103883	0	-35.91143736836954	0	5.9757855078762105	0	0.7906180971104626	0.7906180971104626	0.7906180971104626	\N	2026-02-14 13:51:32.589383	2026-02-14 13:51:32.589383	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
249	geometry_animal	forest_1771048291840_bird_76	geometry:bird	-49.34437719046295	0	-30.112949050301893	0	2.037096994401617	0	0.8285244999030358	0.8285244999030358	0.8285244999030358	\N	2026-02-14 13:51:32.589745	2026-02-14 13:51:32.589745	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
250	geometry_animal	forest_1771048291840_bird_77	geometry:bird	-43.86476770214548	0	-39.25364659289629	0	3.1871906501000553	0	0.8740118172721655	0.8740118172721655	0.8740118172721655	\N	2026-02-14 13:51:32.590121	2026-02-14 13:51:32.590121	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
251	geometry_animal	forest_1771048291840_bird_78	geometry:bird	-52.785001007930816	0	-17.309241549723584	0	1.2899048372812558	0	0.9217947997892186	0.9217947997892186	0.9217947997892186	\N	2026-02-14 13:51:32.59051	2026-02-14 13:51:32.59051	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
252	geometry_animal	forest_1771048291840_bird_79	geometry:bird	-51.72621723496367	0	-14.757938194700241	0	3.428245208927957	0	0.8825141918732046	0.8825141918732046	0.8825141918732046	\N	2026-02-14 13:51:32.59088	2026-02-14 13:51:32.59088	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
253	geometry_animal	forest_1771048291840_bird_80	geometry:bird	-62.106044650160655	0	-22.38347701904517	0	3.3644929272738526	0	0.8979010817747447	0.8979010817747447	0.8979010817747447	\N	2026-02-14 13:51:32.591239	2026-02-14 13:51:32.591239	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
254	geometry_terrain	village_1771048315380_mountain_1	geometry:mountain	5.636915503854745	0	-53.28081397012089	0	3.1472427783680836	0	1	1	1	\N	2026-02-14 13:51:55.540835	2026-02-14 13:51:55.540835	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
255	geometry_terrain	village_1771048315380_mountain_2	geometry:mountain	-33.3621875096062	0	-59.592312330667184	0	2.652809498068531	0	1	1	1	\N	2026-02-14 13:51:55.549221	2026-02-14 13:51:55.549221	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
258	geometry_building	village_1771048315380_cottage_5	geometry:cottage	-18.014270023407043	0	-26.789012666393134	0	4.718676684523167	0	0.9905823764191686	0.9905823764191686	0.9905823764191686	\N	2026-02-14 13:51:55.551182	2026-02-14 13:51:55.551182	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
260	geometry_building	village_1771048315380_cottage_7	geometry:cottage	-16.681744660893596	0	-24.027322773542988	0	1.9734050404939971	0	0.8802170728227	0.8802170728227	0.8802170728227	\N	2026-02-14 13:51:55.552141	2026-02-14 13:51:55.552141	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
261	geometry_building	village_1771048315380_cottage_8	geometry:cottage	-18.465665421037098	0	-24.73191567523918	0	1.896355893299341	0	0.7554650487883002	0.7554650487883002	0.7554650487883002	\N	2026-02-14 13:51:55.552559	2026-02-14 13:51:55.552559	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
262	geometry_nature	village_1771048315380_tree_9	geometry:tree	-24.0227306218995	0	-35.57017981336134	0	5.257570489859981	0	0.9271910631084154	0.9271910631084154	0.9271910631084154	\N	2026-02-14 13:51:55.553025	2026-02-14 13:51:55.553025	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
263	geometry_nature	village_1771048315380_tree_10	geometry:tree	-32.99196513251856	0	-7.4839357495557906	0	5.777108085961789	0	1.381332732759371	1.381332732759371	1.381332732759371	\N	2026-02-14 13:51:55.553565	2026-02-14 13:51:55.553565	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
264	geometry_nature	village_1771048315380_tree_11	geometry:tree	-2.6017109560027905	0	-15.68457664622456	0	2.923566777894517	0	0.8806748092547464	0.8806748092547464	0.8806748092547464	\N	2026-02-14 13:51:55.554044	2026-02-14 13:51:55.554044	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
265	geometry_nature	village_1771048315380_tree_12	geometry:tree	-18.319118352720903	0	-3.726245758879209	0	4.3080396130366205	0	0.9114698692515127	0.9114698692515127	0.9114698692515127	\N	2026-02-14 13:51:55.55451	2026-02-14 13:51:55.55451	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
266	geometry_nature	village_1771048315380_tree_13	geometry:tree	-29.172187074836692	0	-41.96798125425783	0	4.552030270374858	0	1.1713462855251988	1.1713462855251988	1.1713462855251988	\N	2026-02-14 13:51:55.55492	2026-02-14 13:51:55.55492	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
267	geometry_nature	village_1771048315380_tree_14	geometry:tree	-2.3993740126442233	0	-37.801882049655234	0	3.5937659648488722	0	1.495015386461345	1.495015386461345	1.495015386461345	\N	2026-02-14 13:51:55.555307	2026-02-14 13:51:55.555307	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
270	geometry_nature	village_1771048315380_tree_17	geometry:tree	-31.414885341454582	0	-34.3375574828022	0	5.78550358065521	0	1.1945516076252227	1.1945516076252227	1.1945516076252227	\N	2026-02-14 13:51:55.55643	2026-02-14 13:51:55.55643	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
272	geometry_decoration	village_1771048315380_fence_19	geometry:fence	-9.493795712293943	0	-23.23838533551131	0	4.352914495170059	0	0.7563932786162235	0.7563932786162235	0.7563932786162235	\N	2026-02-14 13:51:55.557165	2026-02-14 13:51:55.557165	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
257	geometry_building	village_1771048315380_cottage_4	geometry:cottage	-18.4723399888783	0	-20.21392250101605	0	5.939195255557802	0	0.738010053176343	0.738010053176343	0.738010053176343	\N	2026-02-14 13:51:55.550688	2026-02-26 10:45:03.087423	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
256	geometry_terrain	village_1771048315380_mountain_3	geometry:mountain	-18.046191193534096	0	-67.35539343297967	0	2.657466744197342	0	1	1	1	\N	2026-02-14 13:51:55.549987	2026-04-25 09:46:45.96072	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
268	geometry_nature	village_1771048315380_tree_15	geometry:tree	-16.9928346314109	0	-16.826681041559482	0	4.170722655396002	0	0.7568535680025049	0.7568535680025049	0.7568535680025049	\N	2026-02-14 13:51:55.555688	2026-04-25 18:09:27.021228	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
259	geometry_building	village_1771048315380_cottage_6	geometry:cottage	-17.759305468610577	0	-20.020966777122617	0	0.07476138711481259	0	0.9325624900005848	0.9325624900005848	0.9325624900005848	\N	2026-02-14 13:51:55.551667	2026-04-25 18:09:29.643837	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
271	geometry_nature	village_1771048315380_tree_18	geometry:tree	-36.80252654304545	0	-39.62034705057566	0	5.187955848121132	0	1.2325977171075486	1.2325977171075486	1.2325977171075486	\N	2026-02-14 13:51:55.556802	2026-04-26 07:57:54.22332	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
273	geometry_decoration	village_1771048315380_fence_20	geometry:fence	-13.305271618087431	0	-17.32289876117911	0	4.983682631286539	0	0.7330993882217732	0.7330993882217732	0.7330993882217732	\N	2026-02-14 13:51:55.55753	2026-02-14 13:51:55.55753	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
274	geometry_decoration	village_1771048315380_fence_21	geometry:fence	-19.22075819241963	0	-13.24387078775697	0	2.9684040236313454	0	0.9388806211386487	0.9388806211386487	0.9388806211386487	\N	2026-02-14 13:51:55.557958	2026-02-14 13:51:55.557958	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
275	geometry_decoration	village_1771048315380_fence_22	geometry:fence	-26.11915060482726	0	-16.33999292310368	0	4.845317992739972	0	0.7404514680590907	0.7404514680590907	0.7404514680590907	\N	2026-02-14 13:51:55.558328	2026-02-14 13:51:55.558328	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
276	geometry_decoration	village_1771048315380_fence_23	geometry:fence	-28.662168209673716	0	-23.23838533551131	0	1.9692441846081685	0	0.7289294816663414	0.7289294816663414	0.7289294816663414	\N	2026-02-14 13:51:55.558695	2026-02-14 13:51:55.558695	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
277	geometry_decoration	village_1771048315380_fence_24	geometry:fence	-25.068862560866915	0	-29.08648970395859	0	0.01547419188496972	0	0.8793085955883587	0.8793085955883587	0.8793085955883587	\N	2026-02-14 13:51:55.559082	2026-02-14 13:51:55.559082	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
279	geometry_decoration	village_1771048315380_fence_26	geometry:fence	-12.309331014380728	0	-30.149812513550216	0	4.9086416770843835	0	0.7779904985446096	0.7779904985446096	0.7779904985446096	\N	2026-02-14 13:51:55.560006	2026-02-14 13:51:55.560006	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
280	geometry_animal	village_1771048315380_hen_27	geometry:hen	-2.216708468228653	0	-21.06383172554733	0	5.850904248077764	0	0.7406091185077105	0.7406091185077105	0.7406091185077105	\N	2026-02-14 13:51:55.560777	2026-02-14 13:51:55.560777	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
281	geometry_animal	village_1771048315380_hen_28	geometry:hen	-26.272610791466917	0	-16.807352655537713	0	1.359309061418656	0	0.7739173756936141	0.7739173756936141	0.7739173756936141	\N	2026-02-14 13:51:55.56152	2026-02-14 13:51:55.56152	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
282	geometry_animal	village_1771048315380_cat_29	geometry:cat	-20.422869179802916	0	-24.809941066012858	0	1.817541241179455	0	0.7890762848777179	0.7890762848777179	0.7890762848777179	\N	2026-02-14 13:51:55.562207	2026-02-14 13:51:55.562207	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
278	geometry_decoration	village_1771048315380_fence_25	geometry:fence	-19.22	0	-32.59	0	5.733057526950974	0	0.79	0.79	0.79	\N	2026-02-14 13:51:55.559481	2026-07-10 16:56:23.940367	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
344	geometry_building	长方体	geometry:cottage	10.76507391197368	0.41238262640484624	-13.306631758583597	0	6.152312562121212	0	1.15761694593829	1.15761694593829	1.15761694593829	\N	2026-05-07 16:59:57.136724	2026-07-22 15:23:43.484887	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
28	geometry_nature	village_场景_1770866283752_tree_18	geometry:tree	-1.7174510060316521	0.0305447196642592	-7.2547998715373865	0	1.9446437886972838	0	1.1970072616915888	1.1970072616915888	1.1970072616915888	\N	2026-02-12 11:20:46.09817	2026-04-25 16:59:19.849499	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
269	geometry_nature	village_1771048315380_tree_16	geometry:tree	-24.339514166374045	0	-9.463799865565381	0	0.12303673136603648	0	1.4427400595884958	1.4427400595884958	1.4427400595884958	\N	2026-02-14 13:51:55.556057	2026-04-25 17:00:09.544402	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
342	geometry_building	乡村村落_1778144396568_cottage_9	geometry:cottage	13.171544607558296	0	8.774879544131622	0	2.853082996439306	0	0.8830622124546172	0.8830622124546172	0.8830622124546172	\N	2026-05-07 16:59:57.135892	2026-05-07 16:59:57.135892	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
343	geometry_building	乡村村落_1778144396568_cottage_10	geometry:cottage	5.9425019668586	0	19.283134489485157	0	3.5213838417399983	0	0.8457645063625577	0.8457645063625577	0.8457645063625577	\N	2026-05-07 16:59:57.136301	2026-05-07 16:59:57.136301	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
345	geometry_decoration	乡村村落_1778144396568_fence_12	geometry:fence	-7.796164310892234	0	19.64042249656164	0	5.954560823726074	0	1	1	1	\N	2026-05-07 16:59:57.137121	2026-05-07 16:59:57.137121	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
346	geometry_decoration	乡村村落_1778144396568_fence_13	geometry:fence	-13.795645111997302	0	9.500824156189125	0	5.482007114962938	0	1	1	1	\N	2026-05-07 16:59:57.137516	2026-05-07 16:59:57.137516	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
347	geometry_decoration	乡村村落_1778144396568_fence_14	geometry:fence	-19.843438997264727	0	-15.216229276525244	0	5.515019707788071	0	1	1	1	\N	2026-05-07 16:59:57.137933	2026-05-07 16:59:57.137933	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
348	geometry_decoration	乡村村落_1778144396568_fence_15	geometry:fence	-8.796808349397889	0	7.764690321019824	0	2.6154257171676787	0	1	1	1	\N	2026-05-07 16:59:57.138368	2026-05-07 16:59:57.138368	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
349	geometry_decoration	乡村村落_1778144396568_fence_16	geometry:fence	13.353901664695165	0	10.322920193837618	0	5.377813666527424	0	1	1	1	\N	2026-05-07 16:59:57.138769	2026-05-07 16:59:57.138769	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
350	geometry_decoration	乡村村落_1778144396568_fence_17	geometry:fence	-10.342282309625158	0	2.773888233594292	0	0.0296322519342012	0	1	1	1	\N	2026-05-07 16:59:57.139186	2026-05-07 16:59:57.139186	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
351	geometry_decoration	乡村村落_1778144396568_fence_18	geometry:fence	-13.73178704181107	0	-11.94738237438794	0	3.5856213219183233	0	1	1	1	\N	2026-05-07 16:59:57.139582	2026-05-07 16:59:57.139582	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
352	geometry_decoration	乡村村落_1778144396568_fence_19	geometry:fence	0.5196326850642841	0	2.509619541842895	0	3.856277565153322	0	1	1	1	\N	2026-05-07 16:59:57.139974	2026-05-07 16:59:57.139974	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
353	geometry_decoration	乡村村落_1778144396568_fence_20	geometry:fence	10.02	0	13.89	0	0.5255186377754926	0	1	1	1	\N	2026-05-07 16:59:57.140368	2026-06-10 15:59:58.41987	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
383	geometry_nature	乡村村落_1778144396568_tree_50	geometry:tree	5.196055954814035	0	3.1741978927025087	0	3.059433517397481	0	1.3653927258565675	1.3653927258565675	1.3653927258565675	\N	2026-05-07 16:59:57.155664	2026-07-28 16:48:17.137145	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
354	geometry_decoration	乡村村落_1778144396568_fence_21	geometry:fence	-19.824016616883537	0	1.4491814187104701	0	1.4800208443678946	0	1	1	1	\N	2026-05-07 16:59:57.140797	2026-05-07 16:59:57.140797	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
356	geometry_decoration	乡村村落_1778144396568_fence_23	geometry:fence	-1.7431470421706834	0	-17.169256659006148	0	4.177959062598019	0	1	1	1	\N	2026-05-07 16:59:57.14233	2026-05-07 16:59:57.14233	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
357	geometry_nature	乡村村落_1778144396568_flower_24	geometry:flower	3.9472434287648674	0	15.657501342685066	0	4.466854520210879	0	0.7912870208054685	0.7912870208054685	0.7912870208054685	\N	2026-05-07 16:59:57.143174	2026-05-07 16:59:57.143174	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
358	geometry_nature	乡村村落_1778144396568_flower_25	geometry:flower	11.08956835648053	0	5.429677673112586	0	0.5279713531789045	0	0.9238120688714014	0.9238120688714014	0.9238120688714014	\N	2026-05-07 16:59:57.143728	2026-05-07 16:59:57.143728	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
359	geometry_nature	乡村村落_1778144396568_flower_26	geometry:flower	-3.2148205738757625	0	-1.9255061023621245	0	2.3210434662485264	0	0.7989437391966634	0.7989437391966634	0.7989437391966634	\N	2026-05-07 16:59:57.144217	2026-05-07 16:59:57.144217	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
360	geometry_nature	乡村村落_1778144396568_flower_27	geometry:flower	6.069263962420742	0	-6.111213886314889	0	3.394608444689556	0	0.7322235508578069	0.7322235508578069	0.7322235508578069	\N	2026-05-07 16:59:57.144674	2026-05-07 16:59:57.144674	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
361	geometry_nature	乡村村落_1778144396568_flower_28	geometry:flower	-4.443944693250433	0	17.868487647488067	0	6.138527039842847	0	0.816098681183957	0.816098681183957	0.816098681183957	\N	2026-05-07 16:59:57.145137	2026-05-07 16:59:57.145137	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
362	geometry_nature	乡村村落_1778144396568_flower_29	geometry:flower	-14.090705794828548	0	4.471413154102692	0	4.4140140188837185	0	0.8985100218351917	0.8985100218351917	0.8985100218351917	\N	2026-05-07 16:59:57.145595	2026-05-07 16:59:57.145595	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
363	geometry_nature	乡村村落_1778144396568_flower_30	geometry:flower	-2.327981495430599	0	-5.378089617119954	0	0.3826047219822487	0	0.8672311495120878	0.8672311495120878	0.8672311495120878	\N	2026-05-07 16:59:57.146032	2026-05-07 16:59:57.146032	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
364	geometry_nature	乡村村落_1778144396568_flower_31	geometry:flower	-2.9247790846638537	0	17.30503824908765	0	4.547623287171774	0	0.9477253384322827	0.9477253384322827	0.9477253384322827	\N	2026-05-07 16:59:57.146465	2026-05-07 16:59:57.146465	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
365	geometry_nature	乡村村落_1778144396568_flower_32	geometry:flower	4.373941007486451	0	-12.372010364641145	0	5.945464866862949	0	0.8896030348782483	0.8896030348782483	0.8896030348782483	\N	2026-05-07 16:59:57.146944	2026-05-07 16:59:57.146944	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
366	geometry_nature	乡村村落_1778144396568_flower_33	geometry:flower	10.837216286940766	0	-9.054645083173591	0	3.488631128753154	0	0.8470193758642518	0.8470193758642518	0.8470193758642518	\N	2026-05-07 16:59:57.147405	2026-05-07 16:59:57.147405	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
367	geometry_nature	乡村村落_1778144396568_flower_34	geometry:flower	19.766794870899403	0	-1.654728116815427	0	1.1429315192796252	0	0.8419035602732198	0.8419035602732198	0.8419035602732198	\N	2026-05-07 16:59:57.147841	2026-05-07 16:59:57.147841	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
368	geometry_nature	乡村村落_1778144396568_flower_35	geometry:flower	19.582145508009916	0	8.521279412849388	0	1.9201582214058026	0	0.960547893713717	0.960547893713717	0.960547893713717	\N	2026-05-07 16:59:57.148289	2026-05-07 16:59:57.148289	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
369	geometry_nature	乡村村落_1778144396568_flower_36	geometry:flower	-16.089279221387635	0	-6.516718075122929	0	6.042754584712148	0	0.9973044645690227	0.9973044645690227	0.9973044645690227	\N	2026-05-07 16:59:57.14874	2026-05-07 16:59:57.14874	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
370	geometry_nature	乡村村落_1778144396568_flower_37	geometry:flower	-6.977781950037215	0	18.543497314952795	0	5.203586740045969	0	0.9794647502943116	0.9794647502943116	0.9794647502943116	\N	2026-05-07 16:59:57.149993	2026-05-07 16:59:57.149993	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
371	geometry_nature	乡村村落_1778144396568_flower_38	geometry:flower	19.94764871360963	0	-3.356056386820711	0	2.9123163715131044	0	0.7976998678571534	0.7976998678571534	0.7976998678571534	\N	2026-05-07 16:59:57.150524	2026-05-07 16:59:57.150524	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
372	geometry_nature	乡村村落_1778144396568_flower_39	geometry:flower	-2.609324149947774	0	-7.198893527426851	0	0.1462841168679659	0	0.8574413354864111	0.8574413354864111	0.8574413354864111	\N	2026-05-07 16:59:57.151031	2026-05-07 16:59:57.151031	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
373	geometry_nature	乡村村落_1778144396568_flower_40	geometry:flower	12.380678283670363	0	17.554538393873813	0	4.457907366586032	0	0.7832738642069547	0.7832738642069547	0.7832738642069547	\N	2026-05-07 16:59:57.151575	2026-05-07 16:59:57.151575	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
374	geometry_nature	乡村村落_1778144396568_flower_41	geometry:flower	11.222434694551403	0	-11.470062396131674	0	2.701797532175946	0	0.8144419988389832	0.8144419988389832	0.8144419988389832	\N	2026-05-07 16:59:57.152003	2026-05-07 16:59:57.152003	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
375	geometry_nature	乡村村落_1778144396568_flower_42	geometry:flower	-4.726479853469181	0	11.79279891538345	0	4.151451614955603	0	0.9878002617217426	0.9878002617217426	0.9878002617217426	\N	2026-05-07 16:59:57.152463	2026-05-07 16:59:57.152463	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
376	geometry_nature	乡村村落_1778144396568_flower_43	geometry:flower	4.749044740421731	0	11.748878763361606	0	5.237597274889163	0	0.8427459980725519	0.8427459980725519	0.8427459980725519	\N	2026-05-07 16:59:57.152908	2026-05-07 16:59:57.152908	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
377	geometry_nature	乡村村落_1778144396568_flower_44	geometry:flower	6.697953822613766	0	-10.368676468113783	0	4.678521683328124	0	0.7690249583486422	0.7690249583486422	0.7690249583486422	\N	2026-05-07 16:59:57.153326	2026-05-07 16:59:57.153326	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
378	geometry_nature	乡村村落_1778144396568_flower_45	geometry:flower	0.15480789708963627	0	5.708913014930324	0	0.6331739702254353	0	0.7709009590239954	0.7709009590239954	0.7709009590239954	\N	2026-05-07 16:59:57.153718	2026-05-07 16:59:57.153718	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
379	geometry_nature	乡村村落_1778144396568_flower_46	geometry:flower	6.336574605849343	0	-18.330457523360035	0	3.7557686237413255	0	0.7955327305253238	0.7955327305253238	0.7955327305253238	\N	2026-05-07 16:59:57.154099	2026-05-07 16:59:57.154099	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
380	geometry_nature	乡村村落_1778144396568_flower_47	geometry:flower	-3.992542080834255	0	-8.334001397340067	0	1.9868912258931692	0	0.7238329310966853	0.7238329310966853	0.7238329310966853	\N	2026-05-07 16:59:57.154483	2026-05-07 16:59:57.154483	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
381	geometry_nature	乡村村落_1778144396568_flower_48	geometry:flower	-10.643867117669291	0	-7.656971610130348	0	2.3000762289996857	0	0.7327392232587314	0.7327392232587314	0.7327392232587314	\N	2026-05-07 16:59:57.154886	2026-05-07 16:59:57.154886	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
382	geometry_nature	乡村村落_1778144396568_tree_49	geometry:tree	-7.7687130629395185	0	6.39842927683533	0	0.0389299328442552	0	1.2963039424155487	1.2963039424155487	1.2963039424155487	\N	2026-05-07 16:59:57.155297	2026-05-07 16:59:57.155297	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
384	geometry_nature	乡村村落_1778144396568_tree_51	geometry:tree	-10.305912848075929	0	-4.198367301786909	0	0.8492924145403096	0	0.8789059726790462	0.8789059726790462	0.8789059726790462	\N	2026-05-07 16:59:57.156033	2026-05-07 16:59:57.156033	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
295	uploaded_model	after_moved.glb	/models/uploaded/model-1772073882670-685802444.glb	-108.9743627900844	0	-21.607695033089506	1.7572696645497003	1.352019476268574	-1.6553912392702985	11.34	6.74	9.01	\N	2026-02-26 10:44:54.742213	2026-07-23 16:31:30.121553	gltf	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
222	geometry_nature	forest_1771048291840_bush_49	geometry:bush	-59.839188548780214	0	-35.31689684260785	0	0.4797236387308517	0	0.9007778163131542	0.9007778163131542	0.9007778163131542	\N	2026-02-14 13:51:32.578199	2026-04-26 07:58:01.47486	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
324	uploaded_model	2026_4_26 07-39-10.glb	/models/uploaded/model-1777160361995-170011383.glb	37.69085090206673	0	37.690850902066735	0	0	0	1	1	1	\N	2026-04-26 08:34:13.780463	2026-04-26 08:34:13.780463	gltf	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
325	uploaded_model	2026_4_26 07-39-10.glb	/models/uploaded/model-1777160361995-170011383.glb	-37.74730440929264	0	2.6590177668628456	0	0	0	1	1	1	\N	2026-04-26 08:50:04.689138	2026-04-26 08:50:04.689138	gltf	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
385	geometry_nature	乡村村落_1778144396568_tree_52	geometry:tree	15.250272528832362	0	-0.07719205429712162	0	1.7207465769365768	0	0.7158800026156031	0.7158800026156031	0.7158800026156031	\N	2026-05-07 16:59:57.156401	2026-05-07 16:59:57.156401	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
386	geometry_nature	乡村村落_1778144396568_tree_53	geometry:tree	-2.9088429940916924	0	-12.438114433055736	0	0.9431266535395849	0	1.3751412462425698	1.3751412462425698	1.3751412462425698	\N	2026-05-07 16:59:57.165803	2026-05-07 16:59:57.165803	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
387	geometry_nature	乡村村落_1778144396568_tree_54	geometry:tree	-8.004444456401787	0	14.093710463311709	0	3.9363940991513786	0	0.98416815667361	0.98416815667361	0.98416815667361	\N	2026-05-07 16:59:57.166381	2026-05-07 16:59:57.166381	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
388	geometry_nature	乡村村落_1778144396568_tree_55	geometry:tree	-2.5250241712579466	0	12.853235741688842	0	1.9892869017485955	0	1.0974791925860645	1.0974791925860645	1.0974791925860645	\N	2026-05-07 16:59:57.166886	2026-05-07 16:59:57.166886	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
389	geometry_animal	乡村村落_1778144396568_hen_56	geometry:hen	8.655738697926392	0	-16.410709048203497	0	3.077788537733033	0	0.7687684887818125	0.7687684887818125	0.7687684887818125	\N	2026-05-07 16:59:57.167304	2026-05-07 16:59:57.167304	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
390	geometry_animal	乡村村落_1778144396568_hen_57	geometry:hen	7.639402826485817	0	-7.679139026962311	0	2.0876000483964545	0	0.718037286310729	0.718037286310729	0.718037286310729	\N	2026-05-07 16:59:57.167711	2026-05-07 16:59:57.167711	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
391	geometry_animal	乡村村落_1778144396568_hen_58	geometry:hen	-8.999287243004805	0	13.154441535690182	0	2.104000544277991	0	0.7769625097716778	0.7769625097716778	0.7769625097716778	\N	2026-05-07 16:59:57.168113	2026-05-07 16:59:57.168113	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
392	geometry_animal	乡村村落_1778144396568_hen_59	geometry:hen	-5.740732568043342	0	-2.406715460105037	0	1.1309513213121358	0	0.9435452425910545	0.9435452425910545	0.9435452425910545	\N	2026-05-07 16:59:57.168497	2026-05-07 16:59:57.168497	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
393	geometry_animal	乡村村落_1778144396568_hen_60	geometry:hen	-12.34212379323115	0	-19.84867229179464	0	5.37176996186972	0	0.8516272195549899	0.8516272195549899	0.8516272195549899	\N	2026-05-07 16:59:57.168884	2026-05-07 16:59:57.168884	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
394	geometry_nature	乡村村落_1778144396568_bush_61	geometry:bush	-18.191130208931767	0	-13.316781328437548	0	2.642267895139622	0	1	1	1	\N	2026-05-07 16:59:57.169265	2026-05-07 16:59:57.169265	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
395	geometry_nature	乡村村落_1778144396568_bush_62	geometry:bush	1.857573122584533	0	-13.116014233691615	0	1.7834878074135374	0	1	1	1	\N	2026-05-07 16:59:57.169639	2026-05-07 16:59:57.169639	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
396	geometry_nature	乡村村落_1778144396568_bush_63	geometry:bush	6.646469746008371	0	-2.7639558381116984	0	0.006039876642533112	0	1	1	1	\N	2026-05-07 16:59:57.170026	2026-05-07 16:59:57.170026	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
397	geometry_nature	乡村村落_1778144396568_bush_64	geometry:bush	14.551403908567544	0	-14.294246774044117	0	3.782781934439131	0	1	1	1	\N	2026-05-07 16:59:57.170408	2026-05-07 16:59:57.170408	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
398	geometry_nature	乡村村落_1778144396568_bush_65	geometry:bush	7.867993045559075	0	-15.072370991598385	0	4.210910605565571	0	1	1	1	\N	2026-05-07 16:59:57.170848	2026-05-07 16:59:57.170848	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
399	geometry_nature	乡村村落_1778144396568_bush_66	geometry:bush	-7.409632219441647	0	16.389860139902936	0	3.1818208697242834	0	1	1	1	\N	2026-05-07 16:59:57.171262	2026-05-07 16:59:57.171262	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
355	geometry_decoration	乡村村落_1778144396568_fence_22	geometry:fence	19.68	0	-11.29	0	4.605400297237438	0	1	1	1	\N	2026-05-07 16:59:57.141217	2026-06-05 17:16:36.553802	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
411	geometry_vehicle	城市露天停车场_1780999816476_car_1	geometry:car	-92.69932842452852	0	5.8597642985848175	0	4.350974425403542	0	0.8457109070083012	0.8457109070083012	0.8457109070083012	\N	2026-06-09 18:10:17.016823	2026-06-09 18:10:17.016823	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
412	geometry_vehicle	城市露天停车场_1780999816476_car_2	geometry:car	-93.03086218736935	0	9.687180927141974	0	3.77383214925192	0	1.0794621449879753	1.0794621449879753	1.0794621449879753	\N	2026-06-09 18:10:17.028944	2026-06-09 18:10:17.028944	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
413	geometry_vehicle	城市露天停车场_1780999816476_car_3	geometry:car	-95.68428238806838	0	17.97716617325358	0	1.7351410588074105	0	1.3706154980942256	1.3706154980942256	1.3706154980942256	\N	2026-06-09 18:10:17.029553	2026-06-09 18:10:17.029553	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
414	geometry_vehicle	城市露天停车场_1780999816476_car_4	geometry:car	-97.50395426761753	0	-18.584801154141072	0	2.6228315387004493	0	1.3926082466748475	1.3926082466748475	1.3926082466748475	\N	2026-06-09 18:10:17.030071	2026-06-09 18:10:17.030071	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
415	geometry_vehicle	城市露天停车场_1780999816476_car_5	geometry:car	-100.95880584344977	0	14.85219630103532	0	0.7376826529489297	0	1.151977111128768	1.151977111128768	1.151977111128768	\N	2026-06-09 18:10:17.030552	2026-06-09 18:10:17.030552	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
416	geometry_vehicle	城市露天停车场_1780999816476_car_6	geometry:car	-106.83988318970174	0	19.844189918933175	0	0.37177452685810775	0	0.8394321512959646	0.8394321512959646	0.8394321512959646	\N	2026-06-09 18:10:17.031026	2026-06-09 18:10:17.031026	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
417	geometry_vehicle	城市露天停车场_1780999816476_car_7	geometry:car	-74.48252295110932	0	-6.625440038340628	0	3.1340057710434017	0	0.9945996367911908	0.9945996367911908	0.9945996367911908	\N	2026-06-09 18:10:17.031465	2026-06-09 18:10:17.031465	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
418	geometry_vehicle	城市露天停车场_1780999816476_car_8	geometry:car	-110.01470667260193	0	10.421764980095276	0	5.136948902198746	0	0.8012531231539078	0.8012531231539078	0.8012531231539078	\N	2026-06-09 18:10:17.031873	2026-06-09 18:10:17.031873	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
419	geometry_vehicle	城市露天停车场_1780999816476_car_9	geometry:car	-88.29237806399132	0	-2.5768903840833772	0	5.730600292140322	0	1.1172464768350012	1.1172464768350012	1.1172464768350012	\N	2026-06-09 18:10:17.03619	2026-06-09 18:10:17.03619	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
420	geometry_vehicle	城市露天停车场_1780999816476_car_10	geometry:car	-80.07243390266626	0	-12.970159335533364	0	5.629546253348273	0	1.0226388270697062	1.0226388270697062	1.0226388270697062	\N	2026-06-09 18:10:17.036647	2026-06-09 18:10:17.036647	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
422	geometry_vehicle	城市露天停车场_1780999816476_car_12	geometry:car	-89.82436444989965	0	16.44699108714824	0	2.697409434146166	0	1.0536867861904855	1.0536867861904855	1.0536867861904855	\N	2026-06-09 18:10:17.037573	2026-06-09 18:10:17.037573	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
423	geometry_vehicle	城市露天停车场_1780999816476_car_13	geometry:car	-91.79764972825768	0	17.184424740882427	0	0.5512619549481734	0	0.8569112300733902	0.8569112300733902	0.8569112300733902	\N	2026-06-09 18:10:17.037999	2026-06-09 18:10:17.037999	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
424	geometry_vehicle	城市露天停车场_1780999816476_car_14	geometry:car	-83.51205383355673	0	-12.30847953493484	0	1.456203758701311	0	0.7414878951639126	0.7414878951639126	0.7414878951639126	\N	2026-06-09 18:10:17.038423	2026-06-09 18:10:17.038423	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
425	geometry_vehicle	城市露天停车场_1780999816476_car_15	geometry:car	-109.89609501350537	0	14.224256510512156	0	0.9060769825700146	0	0.742669880360198	0.742669880360198	0.742669880360198	\N	2026-06-09 18:10:17.038843	2026-06-09 18:10:17.038843	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
426	geometry_vehicle	城市露天停车场_1780999816476_car_16	geometry:car	-102.8767268315214	0	-11.235893033104363	0	3.691639300211942	0	0.9097552819189758	0.9097552819189758	0.9097552819189758	\N	2026-06-09 18:10:17.03926	2026-06-09 18:10:17.03926	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
427	geometry_vehicle	城市露天停车场_1780999816476_car_17	geometry:car	-107.2899963890973	0	-13.997963405868221	0	2.2238507036138846	0	1.1778453962570037	1.1778453962570037	1.1778453962570037	\N	2026-06-09 18:10:17.039744	2026-06-09 18:10:17.039744	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
428	geometry_vehicle	城市露天停车场_1780999816476_car_18	geometry:car	-77.81334467709485	0	-3.696121710051308	0	2.2207966066737175	0	1.3193224206664265	1.3193224206664265	1.3193224206664265	\N	2026-06-09 18:10:17.04065	2026-06-09 18:10:17.04065	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
429	geometry_vehicle	城市露天停车场_1780999816476_car_19	geometry:car	-99.75668027961066	0	-19.983961030440195	0	5.655400480146476	0	1.0650846708660477	1.0650846708660477	1.0650846708660477	\N	2026-06-09 18:10:17.04136	2026-06-09 18:10:17.04136	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
430	geometry_vehicle	城市露天停车场_1780999816476_car_20	geometry:car	-86.6644257616234	0	7.812707007817771	0	4.745979159896754	0	1.3807470502463193	1.3807470502463193	1.3807470502463193	\N	2026-06-09 18:10:17.041957	2026-06-09 18:10:17.041957	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
431	geometry_decoration	城市露天停车场_1780999816476_fence_21	geometry:fence	-80.65925466754643	0	-7.368229089478895	0	4.913008126988918	0	1	1	1	\N	2026-06-09 18:10:17.042442	2026-06-09 18:10:17.042442	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
432	geometry_decoration	城市露天停车场_1780999816476_fence_22	geometry:fence	-111.49844353904692	0	1.4215746180818698	0	0.7129906179864811	0	1	1	1	\N	2026-06-09 18:10:17.042914	2026-06-09 18:10:17.042914	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
433	geometry_decoration	城市露天停车场_1780999816476_fence_23	geometry:fence	-102.56463857601825	0	-14.842540046237236	0	3.6842488396461466	0	1	1	1	\N	2026-06-09 18:10:17.043345	2026-06-09 18:10:17.043345	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
434	geometry_decoration	城市露天停车场_1780999816476_fence_24	geometry:fence	-82.2641185566664	0	-3.912599695070181	0	5.972457101530659	0	1	1	1	\N	2026-06-09 18:10:17.043799	2026-06-09 18:10:17.043799	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
435	geometry_decoration	城市露天停车场_1780999816476_lamp_25	geometry:lamp	-100.7962526179312	0	-6.665359547292855	0	4.818008026315016	0	1	1	1	\N	2026-06-09 18:10:17.044245	2026-06-09 18:10:17.044245	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
436	geometry_decoration	城市露天停车场_1780999816476_lamp_26	geometry:lamp	-109.77956758721325	0	15.742016655482544	0	1.8839311679198874	0	1	1	1	\N	2026-06-09 18:10:17.044674	2026-06-09 18:10:17.044674	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
437	geometry_decoration	城市露天停车场_1780999816476_lamp_27	geometry:lamp	-92.56637761022756	0	10.526311007545125	0	3.689452889990805	0	1	1	1	\N	2026-06-09 18:10:17.04517	2026-06-09 18:10:17.04517	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
438	geometry_decoration	城市露天停车场_1780999816476_lamp_28	geometry:lamp	-86.13802328558415	0	-3.054824631302818	0	2.439727340014645	0	1	1	1	\N	2026-06-09 18:10:17.045609	2026-06-09 18:10:17.045609	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
439	geometry_decoration	城市露天停车场_1780999816476_lamp_29	geometry:lamp	-94.19286801701125	0	-5.080460394896473	0	3.255070262903024	0	1	1	1	\N	2026-06-09 18:10:17.046066	2026-06-09 18:10:17.046066	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
440	geometry_decoration	城市露天停车场_1780999816476_lamp_30	geometry:lamp	-81.68731549927497	0	-5.6849999879446	0	0.2425926305726318	0	1	1	1	\N	2026-06-09 18:10:17.04662	2026-06-09 18:10:17.04662	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
421	geometry_vehicle	城市露天停车场_1780999816476_car_11	geometry:car	-83.62	0	13.58	0	6.234316088123745	0	1.06	1.06	1.06	\N	2026-06-09 18:10:17.037117	2026-06-18 16:53:52.258323	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
462	geometry_building	未来塔楼	geometry_building:23	4.858809182070413	-0.22424304493147673	0	0	0	0	1	1	1	\N	2026-06-30 18:24:29.928749	2026-07-07 17:40:09.867524	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
452	unknown	测试	\N	21.3	3.0033804562969366	-16.4	0	0	0	1	1	1	\N	2026-06-13 17:09:45.83199	2026-06-13 17:09:47.553088	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
453	media_video	凡人修仙	/uploads/media/videos/fanrengaiming.mp4	-13.34	9.36	64.24	0	0	0	19.7	11.08	1	\N	2026-06-13 17:16:17.758702	2026-08-02 08:00:03.350587	local	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	null
458	unknown	记忆空间	\N	19	-0.73	99	0	0	0	1	1	1	\N	2026-06-13 17:24:08.475482	2026-07-10 16:57:26.096762	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
470	geometry_building	长方体 (副本) (副本) (副本) (副本) (副本)	geometry_building:25	8.758133197345584	21.81	-5.05	0	0	0	7.788598606241485	0.04134226867946694	3.334171133261333	\N	2026-07-07 17:41:30.981287	2026-07-23 16:31:07.192319	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
461	geometry_building	中世纪城堡	geometry_building:22	0	0	93.29389135506665	0	0	0	1	1	1	\N	2026-06-30 18:23:21.83699	2026-06-30 18:23:47.577048	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
464	geometry_building	长方体	geometry_building:25	-19.611295136901624	10.549882525924131	3.0012009296799365	3.1268162437270464	0	0	1	1	1	\N	2026-07-07 15:56:46.653852	2026-07-28 16:48:16.223572	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
467	geometry_building	长方体 (副本) (副本)	geometry_building:25	-12.68	14.34	1.24	0	0	0	1	1	1	\N	2026-07-07 17:39:44.285359	2026-07-28 16:49:11.574058	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
468	geometry_building	长方体 (副本) (副本) (副本)	geometry_building:25	-5.81	17.53	0.91	0	0	0	1	1	1	\N	2026-07-07 17:40:00.41842	2026-07-07 17:41:11.553744	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
469	geometry_building	长方体 (副本) (副本) (副本) (副本)	geometry_building:25	-0.81	18.8	-2.05	0	0	0	1	1	1	\N	2026-07-07 17:40:23.097805	2026-07-07 17:41:25.863189	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
466	geometry_building	长方体 (副本)	geometry_building:25	-15.811058270877925	12.855454794841856	6.019258776104584	0	0	0	1	1	1	\N	2026-07-07 17:31:47.003154	2026-07-07 17:39:31.79615	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
465	geometry_building	长方体 (副本)	geometry_building:25	-18.47752515115011	11.566144159942237	6.92090313992634	0	0	0	1	1	1	\N	2026-07-07 17:31:34.463378	2026-07-07 17:39:36.949077	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	t	\N
449	geometry_building	湖泊	geometry_building:17	0	0	-0.3394983747826039	0	0	0	1	1	1	\N	2026-06-12 14:19:22.061589	2026-07-08 16:46:58.944769	\N	\N	1	{"loop": false, "muted": true, "autoplay": false}	f	\N
479	threejs_code	狐狸思考	\N	37.69	-0.03	56.73	0	0	0	0.05	0.05	0.05	\N	2026-07-08 18:17:54.695226	2026-08-05 17:21:43.415641	\N	\n\n\n\n\nconst box = document.getElementById('box')\n\nconst scene = new THREE.Scene()\n\nconst camera = new THREE.PerspectiveCamera(50, box.clientWidth / box.clientHeight, 0.1, 1000)\n\ncamera.position.set(0, 200, 200)\n\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true })\n\nrenderer.setClearColor(0x000000, 1)\n\nrenderer.setSize(box.clientWidth, box.clientHeight)\n\nbox.appendChild(renderer.domElement)\n\nscene.add(new THREE.AmbientLight(0xffffff, 0.3))\n\nconst directionalLight = new THREE.DirectionalLight(0xffffff, 1.5)\n\ndirectionalLight.position.set(0, 200, 200)\n\nscene.add(directionalLight)\n\nnew GLTFLoader().load(`https://z2586300277.github.io/3d-file-server/` + "files/model/Fox.glb", (gltf) => scene.add(gltf.scene))\n\nconst controls = new OrbitControls(camera, renderer.domElement)\n\ncontrols.enableDamping = true\n\nconst { DepthFormat, DepthTexture, LinearFilter, Matrix4, MeshStandardMaterial, PerspectiveCamera, Plane, UnsignedShortType, Vector3, Vector4, WebGLRenderTarget } = THREE\n\nclass MeshReflectorMaterial extends MeshStandardMaterial {\n    constructor(renderer, camera, scene, object, {\n        mixBlur = 0,\n        mixStrength = 1,\n        resolution = 256,\n        blur = [0, 0],\n        minDepthThreshold = 0.9,\n        maxDepthThreshold = 1,\n        depthScale = 0,\n        depthToBlurRatioBias = 0.25,\n        mirror = 0,\n        distortion = 1,\n        mixContrast = 1,\n        distortionMap,\n        reflectorOffset = 0,\n        bufferSamples = 8,\n        planeNormal = new Vector3(0, 0, 1),\n        parameters = {}\n    } = {}) {\n        super(parameters);\n\n        this.gl = renderer\n        this.camera = camera\n        this.scene = scene\n        this.parent = object\n\n        this.hasBlur = blur[0] + blur[1] > 0\n        this.reflectorPlane = new Plane()\n        this.normal = new Vector3()\n        this.reflectorWorldPosition = new Vector3()\n        this.cameraWorldPosition = new Vector3()\n        this.rotationMatrix = new Matrix4()\n        this.lookAtPosition = new Vector3(0, -1, 0)\n        this.clipPlane = new Vector4()\n        this.view = new Vector3()\n        this.target = new Vector3()\n        this.q = new Vector4()\n        this.textureMatrix = new Matrix4()\n        this.virtualCamera = new PerspectiveCamera()\n        this.reflectorOffset = reflectorOffset;\n        this.planeNormal = planeNormal\n\n        this.setupBuffers(resolution, blur, bufferSamples);\n\n        this.reflectorProps = {\n            mirror,\n            textureMatrix: this.textureMatrix,\n            mixBlur,\n            tDiffuse: this.fbo1.texture,\n            tDepth: this.fbo1.depthTexture,\n            tDiffuseBlur: this.fbo2.texture,\n            hasBlur: this.hasBlur,\n            mixStrength,\n            minDepthThreshold,\n            maxDepthThreshold,\n            depthScale,\n            depthToBlurRatioBias,\n            distortion,\n            distortionMap,\n            mixContrast,\n            'defines-USE_BLUR': this.hasBlur ? '' : undefined,\n            'defines-USE_DEPTH': depthScale > 0 ? '' : undefined,\n            'defines-USE_DISTORTION': distortionMap ? '' : undefined,\n        }\n    }\n\n    setupBuffers(resolution, blur, bufferSamples) {\n        const parameters = {\n            minFilter: LinearFilter,\n            magFilter: LinearFilter,\n            encoding: this.gl.outputEncoding,\n        }\n\n        const fbo1 = new WebGLRenderTarget(resolution, resolution, parameters)\n        fbo1.depthBuffer = true\n        fbo1.depthTexture = new DepthTexture(resolution, resolution)\n        fbo1.depthTexture.format = DepthFormat\n        fbo1.depthTexture.type = UnsignedShortType\n\n        const fbo2 = new WebGLRenderTarget(resolution, resolution, parameters)\n\n        if (this.gl.capabilities.isWebGL2) {\n            fbo1.samples = bufferSamples\n        }\n\n        this.fbo1 = fbo1;\n        this.fbo2 = fbo2;\n\n        this.kawaseBlurPass = new KawaseBlurPass()\n        this.kawaseBlurPass.setSize(blur[0], blur[1])\n    }\n\n    beforeRender() {\n        if (!this.parent) return\n\n        this.reflectorWorldPosition.setFromMatrixPosition(this.parent.matrixWorld)\n        this.cameraWorldPosition.setFromMatrixPosition(this.camera.matrixWorld)\n        this.rotationMatrix.extractRotation(this.parent.matrixWorld)\n\n        // was changed from this.normal.set(0, 0, 1)\n        this.normal.copy(this.planeNormal)\n        this.normal.applyMatrix4(this.rotationMatrix)\n        this.reflectorWorldPosition.addScaledVector(this.normal, this.reflectorOffset)\n        this.view.subVectors(this.reflectorWorldPosition, this.cameraWorldPosition)\n        // Avoid rendering when reflector is facing away\n        if (this.view.dot(this.normal) > 0) return\n        this.view.reflect(this.normal).negate()\n        this.view.add(this.reflectorWorldPosition)\n        this.rotationMatrix.extractRotation(this.camera.matrixWorld)\n        this.lookAtPosition.set(0, 0, -1)\n        this.lookAtPosition.applyMatrix4(this.rotationMatrix)\n        this.lookAtPosition.add(this.cameraWorldPosition)\n        this.target.subVectors(this.reflectorWorldPosition, this.lookAtPosition)\n        this.target.reflect(this.normal).negate()\n        this.target.add(this.reflectorWorldPosition)\n        this.virtualCamera.position.copy(this.view)\n        this.virtualCamera.up.set(0, 1, 0)\n        this.virtualCamera.up.applyMatrix4(this.rotationMatrix)\n        this.virtualCamera.up.reflect(this.normal)\n        this.virtualCamera.lookAt(this.target)\n        this.virtualCamera.far = this.camera.far // Used in WebGLBackground\n        this.virtualCamera.updateMatrixWorld()\n        this.virtualCamera.projectionMatrix.copy(this.camera.projectionMatrix)\n\n        // Update the texture matrix\n        this.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0)\n        this.textureMatrix.multiply(this.virtualCamera.projectionMatrix)\n        this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse)\n        this.textureMatrix.multiply(this.parent.matrixWorld)\n\n        this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPosition)\n        this.reflectorPlane.applyMatrix4(this.virtualCamera.matrixWorldInverse)\n        this.clipPlane.set(this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant)\n        const projectionMatrix = this.virtualCamera.projectionMatrix\n        this.q.x = (Math.sign(this.clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0]\n        this.q.y = (Math.sign(this.clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5]\n        this.q.z = -1.0\n        this.q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14]\n        // Calculate the scaled plane vector\n        this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q))\n\n        // Replacing the third row of the projection matrix\n        projectionMatrix.elements[2] = this.clipPlane.x\n        projectionMatrix.elements[6] = this.clipPlane.y\n        projectionMatrix.elements[10] = this.clipPlane.z + 1.0\n        projectionMatrix.elements[14] = this.clipPlane.w\n    }\n\n    update() {\n        if (this.parent.material !== this) return;\n\n        this.parent.visible = false\n        const currentXrEnabled = this.gl.xr.enabled\n        const currentShadowAutoUpdate = this.gl.shadowMap.autoUpdate\n\n        this.beforeRender()\n        this.gl.xr.enabled = false\n        this.gl.shadowMap.autoUpdate = false\n        this.gl.setRenderTarget(this.fbo1)\n        this.gl.state.buffers.depth.setMask(true)\n        if (!this.gl.autoClear) this.gl.clear()\n\n        this.gl.render(this.scene, this.virtualCamera)\n\n        if (this.hasBlur) {\n            this.kawaseBlurPass.render(this.gl, this.fbo1, this.fbo2);\n        }\n\n        this.gl.xr.enabled = currentXrEnabled\n        this.gl.shadowMap.autoUpdate = currentShadowAutoUpdate\n        this.parent.visible = true\n        this.gl.setRenderTarget(null)\n    }\n\n    onBeforeCompile(shader, ...args) {\n        super.onBeforeCompile(shader, ...args);\n\n        if (this.defines === undefined) this.defines = {}\n\n        if (!this.defines.USE_UV) {\n            this.defines.USE_UV = ''\n        }\n\n        if (this.reflectorProps["defines-USE_BLUR"] !== undefined) this.defines.USE_BLUR = ""\n        if (this.reflectorProps["defines-USE_DEPTH"] !== undefined) this.defines.USE_DEPTH = ""\n        if (this.reflectorProps["defines-USE_DISTORTION"] !== undefined) this.defines.USE_DISTORTION = ""\n\n        let props = this.reflectorProps;\n\n        for (let prop in props) {\n            shader.uniforms[prop] = {\n                get value() {\n                    return props[prop]\n                }\n            }\n        }\n\n        shader.vertexShader = `\n              uniform mat4 textureMatrix;\n              varying vec4 my_vUv;     \n            ${shader.vertexShader}`\n\n        shader.vertexShader = shader.vertexShader.replace(\n            '#include <project_vertex>',\n            /* glsl */`\n            #include <project_vertex>\n            my_vUv = textureMatrix * vec4( position, 1.0 );\n            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n            `\n        )\n\n        shader.fragmentShader = /* glsl */`\n              uniform sampler2D tDiffuse;\n              uniform sampler2D tDiffuseBlur;\n              uniform sampler2D tDepth;\n              uniform sampler2D distortionMap;\n              uniform float distortion;\n              uniform float cameraNear;\n              uniform float cameraFar;\n              uniform bool hasBlur;\n              uniform float mixBlur;\n              uniform float mirror;\n              uniform float mixStrength;\n              uniform float minDepthThreshold;\n              uniform float maxDepthThreshold;\n              uniform float mixContrast;\n              uniform float depthScale;\n              uniform float depthToBlurRatioBias;\n              varying vec4 my_vUv;        \n              ${shader.fragmentShader}`\n\n        shader.fragmentShader = shader.fragmentShader.replace(\n            '#include <emissivemap_fragment>',\n            /* glsl */`\n            #include <emissivemap_fragment>\n          \n            float distortionFactor = 0.0;\n            #ifdef USE_DISTORTION\n              distortionFactor = texture2D(distortionMap, vUv).r * distortion;\n            #endif\n      \n            vec4 new_vUv = my_vUv;\n            new_vUv.x += distortionFactor;\n            new_vUv.y += distortionFactor;\n      \n            vec4 base = texture2DProj(tDiffuse, new_vUv);\n            vec4 blur = texture2DProj(tDiffuseBlur, new_vUv);\n            \n            vec4 merge = base;\n            \n            #ifdef USE_NORMALMAP\n              vec2 normal_uv = vec2(0.0);\n              vec4 normalColor = texture2D(normalMap, vUv);\n              vec3 my_normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );\n              vec3 coord = new_vUv.xyz / new_vUv.w;\n              normal_uv = coord.xy + coord.z * my_normal.xz * 0.05 * normalScale;\n              vec4 base_normal = texture2D(tDiffuse, normal_uv);\n              vec4 blur_normal = texture2D(tDiffuseBlur, normal_uv);\n              merge = base_normal;\n              blur = blur_normal;\n            #endif\n      \n            float depthFactor = 0.0001;\n            float blurFactor = 0.0;\n      \n            #ifdef USE_DEPTH\n              vec4 depth = texture2DProj(tDepth, new_vUv);\n              depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));\n              depthFactor *= depthScale;\n              depthFactor = max(0.0001, min(1.0, depthFactor));\n      \n              #ifdef USE_BLUR\n                blur = blur * min(1.0, depthFactor + depthToBlurRatioBias);\n                merge = merge * min(1.0, depthFactor + 0.5);\n              #else\n                merge = merge * depthFactor;\n              #endif\n        \n            #endif\n      \n            float reflectorRoughnessFactor = roughness;\n            #ifdef USE_ROUGHNESSMAP\n              vec4 reflectorTexelRoughness = texture2D( roughnessMap, vUv );\n              \n              reflectorRoughnessFactor *= reflectorTexelRoughness.g;\n            #endif\n            \n            #ifdef USE_BLUR\n              blurFactor = min(1.0, mixBlur * reflectorRoughnessFactor);\n              merge = mix(merge, blur, blurFactor);\n            #endif\n      \n            vec4 newMerge = vec4(0.0, 0.0, 0.0, 1.0);\n            newMerge.r = (merge.r - 0.5) * mixContrast + 0.5;\n            newMerge.g = (merge.g - 0.5) * mixContrast + 0.5;\n            newMerge.b = (merge.b - 0.5) * mixContrast + 0.5;\n            \n            diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);\n            `\n        )\n    }\n}\n\nconst tunnel = new THREE.Mesh(new THREE.TorusKnotGeometry(20, 2, 100, 16), new THREE.MeshStandardMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 }))\ntunnel.position.set(0, 80, 50)\nscene.add(tunnel)\n\nconst material = new MeshReflectorMaterial(renderer, camera, scene, {}, {\n    resolution: 1024,\n    blur: [512, 128],\n    mixBlur: 5,\n    mixStrength: 5,\n    mixContrast: 1,\n    mirror: 1,\n    parameters:{\n        roughnessMap: new THREE.TextureLoader().load(`https://z2586300277.github.io/3d-file-server/` + "images/drei/roughness.jpg"),\n        normalMap: new THREE.TextureLoader().load(`https://z2586300277.github.io/3d-file-server/` + "images/drei/normal.jpg"),\n        normalScale: new THREE.Vector2(1, 1)\n    }\n})\nconst plane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),material)\nplane.position.y = -1\nplane.rotation.x = -Math.PI / 2\nmaterial.parent = plane\nscene.add(plane)\n\nconst { reflectorProps } = material\n\nanimate()\nfunction animate() {\n    requestAnimationFrame(animate)\n    tunnel.rotation.z += 0.02\n    tunnel.rotation.x += 0.02\n    material.update()\n    controls.update()\n    renderer.render(scene, camera)\n}\n\nconst pane = new Pane();\npane.addBinding(reflectorProps, 'mixBlur', { min: 0, max: 20 });\npane.addBinding(reflectorProps, 'mixStrength', { min: 0, max: 20 });\npane.addBinding(reflectorProps, 'mirror', { min: 0, max: 1 });\npane.addBinding(reflectorProps, 'mixContrast', { min: 0, max: 5 });\n\n\n/**\n * 名称: 模糊反射(drei转原生)\n * 作者: 优雅永不过时 https://z2586300277.github.io/\n * 参考: https://codesandbox.io/p/sandbox/bfplr \n */\n	1	{"loop": false, "muted": true, "autoplay": false}	f	null
\.


--
-- Data for Name: world_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_rules (id, pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier, allow_skill_types, max_foreign_level, respawn_enabled, friendly_fire, world_type, created_at, updated_at) FROM stdin;
4fe1c6f3-e692-4b75-a56b-3a021eb06033	t	t	f	1	{perform,build,attack,heal}	999	t	f	normal	2026-02-25 17:03:19.561528	2026-03-03 10:42:24.265976
\.


--
-- Data for Name: world_weather; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.world_weather (id, weather_type, sky_mode, fog_enabled, fog_density, rain_intensity, snow_intensity, wind_speed, sun_angle, day_cycle_enabled, day_cycle_speed, updated_at, fog_color, intensity, duration, start_time, end_time, created_at) FROM stdin;
1	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-09 18:31:42.545811	#cccccc	1	0	2026-07-09 18:31:42.545811	\N	2026-07-09 18:31:42.545811
2	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-09 18:31:42.545811	#cccccc	0.5	0	2026-07-09 18:31:42.545811	\N	2026-07-09 18:31:42.545811
3	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-09 18:31:42.545811	#cccccc	0.8	0	2026-07-09 18:31:42.545811	\N	2026-07-09 18:31:42.545811
4	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-09 18:31:42.545811	#cccccc	0.6	0	2026-07-09 18:31:42.545811	\N	2026-07-09 18:31:42.545811
5	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-09 18:31:42.545811	#cccccc	0.4	0	2026-07-09 18:31:42.545811	\N	2026-07-09 18:31:42.545811
6	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 09:08:49.760901	#cccccc	1	0	2026-07-10 09:08:49.760901	\N	2026-07-10 09:08:49.760901
7	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 09:08:49.760901	#cccccc	0.5	0	2026-07-10 09:08:49.760901	\N	2026-07-10 09:08:49.760901
8	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 09:08:49.760901	#cccccc	0.8	0	2026-07-10 09:08:49.760901	\N	2026-07-10 09:08:49.760901
9	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 09:08:49.760901	#cccccc	0.6	0	2026-07-10 09:08:49.760901	\N	2026-07-10 09:08:49.760901
10	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 09:08:49.760901	#cccccc	0.4	0	2026-07-10 09:08:49.760901	\N	2026-07-10 09:08:49.760901
11	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 09:53:35.647545	#cccccc	1	0	2026-07-10 09:53:35.647545	\N	2026-07-10 09:53:35.647545
12	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 09:53:35.647545	#cccccc	0.5	0	2026-07-10 09:53:35.647545	\N	2026-07-10 09:53:35.647545
13	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 09:53:35.647545	#cccccc	0.8	0	2026-07-10 09:53:35.647545	\N	2026-07-10 09:53:35.647545
14	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 09:53:35.647545	#cccccc	0.6	0	2026-07-10 09:53:35.647545	\N	2026-07-10 09:53:35.647545
15	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 09:53:35.647545	#cccccc	0.4	0	2026-07-10 09:53:35.647545	\N	2026-07-10 09:53:35.647545
16	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 10:20:13.990026	#cccccc	1	0	2026-07-10 10:20:13.990026	\N	2026-07-10 10:20:13.990026
17	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 10:20:13.990026	#cccccc	0.5	0	2026-07-10 10:20:13.990026	\N	2026-07-10 10:20:13.990026
18	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 10:20:13.990026	#cccccc	0.8	0	2026-07-10 10:20:13.990026	\N	2026-07-10 10:20:13.990026
19	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 10:20:13.990026	#cccccc	0.6	0	2026-07-10 10:20:13.990026	\N	2026-07-10 10:20:13.990026
20	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 10:20:13.990026	#cccccc	0.4	0	2026-07-10 10:20:13.990026	\N	2026-07-10 10:20:13.990026
21	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 11:28:01.309169	#cccccc	1	0	2026-07-10 11:28:01.309169	\N	2026-07-10 11:28:01.309169
22	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 11:28:01.309169	#cccccc	0.5	0	2026-07-10 11:28:01.309169	\N	2026-07-10 11:28:01.309169
23	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 11:28:01.309169	#cccccc	0.8	0	2026-07-10 11:28:01.309169	\N	2026-07-10 11:28:01.309169
24	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 11:28:01.309169	#cccccc	0.6	0	2026-07-10 11:28:01.309169	\N	2026-07-10 11:28:01.309169
25	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 11:28:01.309169	#cccccc	0.4	0	2026-07-10 11:28:01.309169	\N	2026-07-10 11:28:01.309169
26	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 11:39:29.54042	#cccccc	1	0	2026-07-10 11:39:29.54042	\N	2026-07-10 11:39:29.54042
27	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 11:39:29.54042	#cccccc	0.5	0	2026-07-10 11:39:29.54042	\N	2026-07-10 11:39:29.54042
28	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 11:39:29.54042	#cccccc	0.8	0	2026-07-10 11:39:29.54042	\N	2026-07-10 11:39:29.54042
29	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 11:39:29.54042	#cccccc	0.6	0	2026-07-10 11:39:29.54042	\N	2026-07-10 11:39:29.54042
30	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 11:39:29.54042	#cccccc	0.4	0	2026-07-10 11:39:29.54042	\N	2026-07-10 11:39:29.54042
31	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 11:40:05.985144	#cccccc	1	0	2026-07-10 11:40:05.985144	\N	2026-07-10 11:40:05.985144
32	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 11:40:05.985144	#cccccc	0.5	0	2026-07-10 11:40:05.985144	\N	2026-07-10 11:40:05.985144
33	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 11:40:05.985144	#cccccc	0.8	0	2026-07-10 11:40:05.985144	\N	2026-07-10 11:40:05.985144
34	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 11:40:05.985144	#cccccc	0.6	0	2026-07-10 11:40:05.985144	\N	2026-07-10 11:40:05.985144
35	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 11:40:05.985144	#cccccc	0.4	0	2026-07-10 11:40:05.985144	\N	2026-07-10 11:40:05.985144
36	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 16:20:34.809118	#cccccc	1	0	2026-07-10 16:20:34.809118	\N	2026-07-10 16:20:34.809118
37	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 16:20:34.809118	#cccccc	0.5	0	2026-07-10 16:20:34.809118	\N	2026-07-10 16:20:34.809118
38	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 16:20:34.809118	#cccccc	0.8	0	2026-07-10 16:20:34.809118	\N	2026-07-10 16:20:34.809118
39	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 16:20:34.809118	#cccccc	0.6	0	2026-07-10 16:20:34.809118	\N	2026-07-10 16:20:34.809118
40	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 16:20:34.809118	#cccccc	0.4	0	2026-07-10 16:20:34.809118	\N	2026-07-10 16:20:34.809118
41	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-10 16:31:19.573742	#cccccc	1	0	2026-07-10 16:31:19.573742	\N	2026-07-10 16:31:19.573742
42	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-10 16:31:19.573742	#cccccc	0.5	0	2026-07-10 16:31:19.573742	\N	2026-07-10 16:31:19.573742
43	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-10 16:31:19.573742	#cccccc	0.8	0	2026-07-10 16:31:19.573742	\N	2026-07-10 16:31:19.573742
44	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-10 16:31:19.573742	#cccccc	0.6	0	2026-07-10 16:31:19.573742	\N	2026-07-10 16:31:19.573742
45	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-10 16:31:19.573742	#cccccc	0.4	0	2026-07-10 16:31:19.573742	\N	2026-07-10 16:31:19.573742
46	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-12 06:17:34.433106	#cccccc	1	0	2026-07-12 06:17:34.433106	\N	2026-07-12 06:17:34.433106
47	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-12 06:17:34.433106	#cccccc	0.5	0	2026-07-12 06:17:34.433106	\N	2026-07-12 06:17:34.433106
48	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-12 06:17:34.433106	#cccccc	0.8	0	2026-07-12 06:17:34.433106	\N	2026-07-12 06:17:34.433106
49	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-12 06:17:34.433106	#cccccc	0.6	0	2026-07-12 06:17:34.433106	\N	2026-07-12 06:17:34.433106
50	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-12 06:17:34.433106	#cccccc	0.4	0	2026-07-12 06:17:34.433106	\N	2026-07-12 06:17:34.433106
51	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-12 06:56:48.720264	#cccccc	1	0	2026-07-12 06:56:48.720264	\N	2026-07-12 06:56:48.720264
52	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-12 06:56:48.720264	#cccccc	0.5	0	2026-07-12 06:56:48.720264	\N	2026-07-12 06:56:48.720264
53	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-12 06:56:48.720264	#cccccc	0.8	0	2026-07-12 06:56:48.720264	\N	2026-07-12 06:56:48.720264
54	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-12 06:56:48.720264	#cccccc	0.6	0	2026-07-12 06:56:48.720264	\N	2026-07-12 06:56:48.720264
55	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-12 06:56:48.720264	#cccccc	0.4	0	2026-07-12 06:56:48.720264	\N	2026-07-12 06:56:48.720264
56	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-12 07:00:23.289471	#cccccc	1	0	2026-07-12 07:00:23.289471	\N	2026-07-12 07:00:23.289471
57	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-12 07:00:23.289471	#cccccc	0.5	0	2026-07-12 07:00:23.289471	\N	2026-07-12 07:00:23.289471
58	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-12 07:00:23.289471	#cccccc	0.8	0	2026-07-12 07:00:23.289471	\N	2026-07-12 07:00:23.289471
59	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-12 07:00:23.289471	#cccccc	0.6	0	2026-07-12 07:00:23.289471	\N	2026-07-12 07:00:23.289471
60	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-12 07:00:23.289471	#cccccc	0.4	0	2026-07-12 07:00:23.289471	\N	2026-07-12 07:00:23.289471
61	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-12 07:02:18.507625	#cccccc	1	0	2026-07-12 07:02:18.507625	\N	2026-07-12 07:02:18.507625
62	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-12 07:02:18.507625	#cccccc	0.5	0	2026-07-12 07:02:18.507625	\N	2026-07-12 07:02:18.507625
63	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-12 07:02:18.507625	#cccccc	0.8	0	2026-07-12 07:02:18.507625	\N	2026-07-12 07:02:18.507625
64	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-12 07:02:18.507625	#cccccc	0.6	0	2026-07-12 07:02:18.507625	\N	2026-07-12 07:02:18.507625
65	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-12 07:02:18.507625	#cccccc	0.4	0	2026-07-12 07:02:18.507625	\N	2026-07-12 07:02:18.507625
66	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-12 11:08:38.228877	#cccccc	1	0	2026-07-12 11:08:38.228877	\N	2026-07-12 11:08:38.228877
67	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-12 11:08:38.228877	#cccccc	0.5	0	2026-07-12 11:08:38.228877	\N	2026-07-12 11:08:38.228877
68	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-12 11:08:38.228877	#cccccc	0.8	0	2026-07-12 11:08:38.228877	\N	2026-07-12 11:08:38.228877
69	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-12 11:08:38.228877	#cccccc	0.6	0	2026-07-12 11:08:38.228877	\N	2026-07-12 11:08:38.228877
70	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-12 11:08:38.228877	#cccccc	0.4	0	2026-07-12 11:08:38.228877	\N	2026-07-12 11:08:38.228877
71	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-13 08:54:01.14882	#cccccc	1	0	2026-07-13 08:54:01.14882	\N	2026-07-13 08:54:01.14882
72	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-13 08:54:01.14882	#cccccc	0.5	0	2026-07-13 08:54:01.14882	\N	2026-07-13 08:54:01.14882
73	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-13 08:54:01.14882	#cccccc	0.8	0	2026-07-13 08:54:01.14882	\N	2026-07-13 08:54:01.14882
74	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-13 08:54:01.14882	#cccccc	0.6	0	2026-07-13 08:54:01.14882	\N	2026-07-13 08:54:01.14882
75	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-13 08:54:01.14882	#cccccc	0.4	0	2026-07-13 08:54:01.14882	\N	2026-07-13 08:54:01.14882
76	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-16 15:26:10.712132	#cccccc	1	0	2026-07-16 15:26:10.712132	\N	2026-07-16 15:26:10.712132
77	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-16 15:26:10.712132	#cccccc	0.5	0	2026-07-16 15:26:10.712132	\N	2026-07-16 15:26:10.712132
78	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-16 15:26:10.712132	#cccccc	0.8	0	2026-07-16 15:26:10.712132	\N	2026-07-16 15:26:10.712132
79	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-16 15:26:10.712132	#cccccc	0.6	0	2026-07-16 15:26:10.712132	\N	2026-07-16 15:26:10.712132
80	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-16 15:26:10.712132	#cccccc	0.4	0	2026-07-16 15:26:10.712132	\N	2026-07-16 15:26:10.712132
81	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-16 17:37:22.210079	#cccccc	1	0	2026-07-16 17:37:22.210079	\N	2026-07-16 17:37:22.210079
82	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-16 17:37:22.210079	#cccccc	0.5	0	2026-07-16 17:37:22.210079	\N	2026-07-16 17:37:22.210079
83	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-16 17:37:22.210079	#cccccc	0.8	0	2026-07-16 17:37:22.210079	\N	2026-07-16 17:37:22.210079
84	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-16 17:37:22.210079	#cccccc	0.6	0	2026-07-16 17:37:22.210079	\N	2026-07-16 17:37:22.210079
85	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-16 17:37:22.210079	#cccccc	0.4	0	2026-07-16 17:37:22.210079	\N	2026-07-16 17:37:22.210079
86	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-17 16:58:04.257892	#cccccc	1	0	2026-07-17 16:58:04.257892	\N	2026-07-17 16:58:04.257892
87	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-17 16:58:04.257892	#cccccc	0.5	0	2026-07-17 16:58:04.257892	\N	2026-07-17 16:58:04.257892
88	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-17 16:58:04.257892	#cccccc	0.8	0	2026-07-17 16:58:04.257892	\N	2026-07-17 16:58:04.257892
89	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-17 16:58:04.257892	#cccccc	0.6	0	2026-07-17 16:58:04.257892	\N	2026-07-17 16:58:04.257892
90	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-17 16:58:04.257892	#cccccc	0.4	0	2026-07-17 16:58:04.257892	\N	2026-07-17 16:58:04.257892
91	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-20 16:03:21.055234	#cccccc	1	0	2026-07-20 16:03:21.055234	\N	2026-07-20 16:03:21.055234
92	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-20 16:03:21.055234	#cccccc	0.5	0	2026-07-20 16:03:21.055234	\N	2026-07-20 16:03:21.055234
93	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-20 16:03:21.055234	#cccccc	0.8	0	2026-07-20 16:03:21.055234	\N	2026-07-20 16:03:21.055234
94	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-20 16:03:21.055234	#cccccc	0.6	0	2026-07-20 16:03:21.055234	\N	2026-07-20 16:03:21.055234
95	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-20 16:03:21.055234	#cccccc	0.4	0	2026-07-20 16:03:21.055234	\N	2026-07-20 16:03:21.055234
96	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-21 14:32:56.708031	#cccccc	1	0	2026-07-21 14:32:56.708031	\N	2026-07-21 14:32:56.708031
97	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-21 14:32:56.708031	#cccccc	0.5	0	2026-07-21 14:32:56.708031	\N	2026-07-21 14:32:56.708031
98	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-21 14:32:56.708031	#cccccc	0.8	0	2026-07-21 14:32:56.708031	\N	2026-07-21 14:32:56.708031
99	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-21 14:32:56.708031	#cccccc	0.6	0	2026-07-21 14:32:56.708031	\N	2026-07-21 14:32:56.708031
100	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-21 14:32:56.708031	#cccccc	0.4	0	2026-07-21 14:32:56.708031	\N	2026-07-21 14:32:56.708031
101	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-21 15:24:22.900461	#cccccc	1	0	2026-07-21 15:24:22.900461	\N	2026-07-21 15:24:22.900461
102	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-21 15:24:22.900461	#cccccc	0.5	0	2026-07-21 15:24:22.900461	\N	2026-07-21 15:24:22.900461
103	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-21 15:24:22.900461	#cccccc	0.8	0	2026-07-21 15:24:22.900461	\N	2026-07-21 15:24:22.900461
104	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-21 15:24:22.900461	#cccccc	0.6	0	2026-07-21 15:24:22.900461	\N	2026-07-21 15:24:22.900461
105	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-21 15:24:22.900461	#cccccc	0.4	0	2026-07-21 15:24:22.900461	\N	2026-07-21 15:24:22.900461
106	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-21 15:51:14.878246	#cccccc	1	0	2026-07-21 15:51:14.878246	\N	2026-07-21 15:51:14.878246
107	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-21 15:51:14.878246	#cccccc	0.5	0	2026-07-21 15:51:14.878246	\N	2026-07-21 15:51:14.878246
108	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-21 15:51:14.878246	#cccccc	0.8	0	2026-07-21 15:51:14.878246	\N	2026-07-21 15:51:14.878246
109	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-21 15:51:14.878246	#cccccc	0.6	0	2026-07-21 15:51:14.878246	\N	2026-07-21 15:51:14.878246
110	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-21 15:51:14.878246	#cccccc	0.4	0	2026-07-21 15:51:14.878246	\N	2026-07-21 15:51:14.878246
111	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-21 16:19:14.711054	#cccccc	1	0	2026-07-21 16:19:14.711054	\N	2026-07-21 16:19:14.711054
112	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-21 16:19:14.711054	#cccccc	0.5	0	2026-07-21 16:19:14.711054	\N	2026-07-21 16:19:14.711054
113	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-21 16:19:14.711054	#cccccc	0.8	0	2026-07-21 16:19:14.711054	\N	2026-07-21 16:19:14.711054
114	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-21 16:19:14.711054	#cccccc	0.6	0	2026-07-21 16:19:14.711054	\N	2026-07-21 16:19:14.711054
115	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-21 16:19:14.711054	#cccccc	0.4	0	2026-07-21 16:19:14.711054	\N	2026-07-21 16:19:14.711054
116	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-22 14:59:18.776359	#cccccc	1	0	2026-07-22 14:59:18.776359	\N	2026-07-22 14:59:18.776359
117	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-22 14:59:18.776359	#cccccc	0.5	0	2026-07-22 14:59:18.776359	\N	2026-07-22 14:59:18.776359
118	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-22 14:59:18.776359	#cccccc	0.8	0	2026-07-22 14:59:18.776359	\N	2026-07-22 14:59:18.776359
119	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-22 14:59:18.776359	#cccccc	0.6	0	2026-07-22 14:59:18.776359	\N	2026-07-22 14:59:18.776359
120	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-22 14:59:18.776359	#cccccc	0.4	0	2026-07-22 14:59:18.776359	\N	2026-07-22 14:59:18.776359
121	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-22 15:41:26.089273	#cccccc	1	0	2026-07-22 15:41:26.089273	\N	2026-07-22 15:41:26.089273
122	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-22 15:41:26.089273	#cccccc	0.5	0	2026-07-22 15:41:26.089273	\N	2026-07-22 15:41:26.089273
123	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-22 15:41:26.089273	#cccccc	0.8	0	2026-07-22 15:41:26.089273	\N	2026-07-22 15:41:26.089273
124	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-22 15:41:26.089273	#cccccc	0.6	0	2026-07-22 15:41:26.089273	\N	2026-07-22 15:41:26.089273
125	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-22 15:41:26.089273	#cccccc	0.4	0	2026-07-22 15:41:26.089273	\N	2026-07-22 15:41:26.089273
126	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-22 15:47:13.599426	#cccccc	1	0	2026-07-22 15:47:13.599426	\N	2026-07-22 15:47:13.599426
127	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-22 15:47:13.599426	#cccccc	0.5	0	2026-07-22 15:47:13.599426	\N	2026-07-22 15:47:13.599426
128	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-22 15:47:13.599426	#cccccc	0.8	0	2026-07-22 15:47:13.599426	\N	2026-07-22 15:47:13.599426
129	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-22 15:47:13.599426	#cccccc	0.6	0	2026-07-22 15:47:13.599426	\N	2026-07-22 15:47:13.599426
130	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-22 15:47:13.599426	#cccccc	0.4	0	2026-07-22 15:47:13.599426	\N	2026-07-22 15:47:13.599426
131	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-23 08:57:07.474567	#cccccc	1	0	2026-07-23 08:57:07.474567	\N	2026-07-23 08:57:07.474567
132	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-23 08:57:07.474567	#cccccc	0.5	0	2026-07-23 08:57:07.474567	\N	2026-07-23 08:57:07.474567
133	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-23 08:57:07.474567	#cccccc	0.8	0	2026-07-23 08:57:07.474567	\N	2026-07-23 08:57:07.474567
134	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-23 08:57:07.474567	#cccccc	0.6	0	2026-07-23 08:57:07.474567	\N	2026-07-23 08:57:07.474567
135	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-23 08:57:07.474567	#cccccc	0.4	0	2026-07-23 08:57:07.474567	\N	2026-07-23 08:57:07.474567
136	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-24 09:27:16.309845	#cccccc	1	0	2026-07-24 09:27:16.309845	\N	2026-07-24 09:27:16.309845
137	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-24 09:27:16.309845	#cccccc	0.5	0	2026-07-24 09:27:16.309845	\N	2026-07-24 09:27:16.309845
138	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-24 09:27:16.309845	#cccccc	0.8	0	2026-07-24 09:27:16.309845	\N	2026-07-24 09:27:16.309845
139	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-24 09:27:16.309845	#cccccc	0.6	0	2026-07-24 09:27:16.309845	\N	2026-07-24 09:27:16.309845
140	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-24 09:27:16.309845	#cccccc	0.4	0	2026-07-24 09:27:16.309845	\N	2026-07-24 09:27:16.309845
141	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-24 11:42:06.192897	#cccccc	1	0	2026-07-24 11:42:06.192897	\N	2026-07-24 11:42:06.192897
142	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-24 11:42:06.192897	#cccccc	0.5	0	2026-07-24 11:42:06.192897	\N	2026-07-24 11:42:06.192897
143	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-24 11:42:06.192897	#cccccc	0.8	0	2026-07-24 11:42:06.192897	\N	2026-07-24 11:42:06.192897
144	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-24 11:42:06.192897	#cccccc	0.6	0	2026-07-24 11:42:06.192897	\N	2026-07-24 11:42:06.192897
145	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-24 11:42:06.192897	#cccccc	0.4	0	2026-07-24 11:42:06.192897	\N	2026-07-24 11:42:06.192897
146	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-24 15:33:38.733764	#cccccc	1	0	2026-07-24 15:33:38.733764	\N	2026-07-24 15:33:38.733764
147	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-24 15:33:38.733764	#cccccc	0.5	0	2026-07-24 15:33:38.733764	\N	2026-07-24 15:33:38.733764
148	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-24 15:33:38.733764	#cccccc	0.8	0	2026-07-24 15:33:38.733764	\N	2026-07-24 15:33:38.733764
149	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-24 15:33:38.733764	#cccccc	0.6	0	2026-07-24 15:33:38.733764	\N	2026-07-24 15:33:38.733764
150	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-24 15:33:38.733764	#cccccc	0.4	0	2026-07-24 15:33:38.733764	\N	2026-07-24 15:33:38.733764
151	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-24 17:48:59.454652	#cccccc	1	0	2026-07-24 17:48:59.454652	\N	2026-07-24 17:48:59.454652
152	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-24 17:48:59.454652	#cccccc	0.5	0	2026-07-24 17:48:59.454652	\N	2026-07-24 17:48:59.454652
153	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-24 17:48:59.454652	#cccccc	0.8	0	2026-07-24 17:48:59.454652	\N	2026-07-24 17:48:59.454652
154	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-24 17:48:59.454652	#cccccc	0.6	0	2026-07-24 17:48:59.454652	\N	2026-07-24 17:48:59.454652
155	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-24 17:48:59.454652	#cccccc	0.4	0	2026-07-24 17:48:59.454652	\N	2026-07-24 17:48:59.454652
156	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-25 11:09:42.70463	#cccccc	1	0	2026-07-25 11:09:42.70463	\N	2026-07-25 11:09:42.70463
157	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-25 11:09:42.70463	#cccccc	0.5	0	2026-07-25 11:09:42.70463	\N	2026-07-25 11:09:42.70463
158	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-25 11:09:42.70463	#cccccc	0.8	0	2026-07-25 11:09:42.70463	\N	2026-07-25 11:09:42.70463
159	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-25 11:09:42.70463	#cccccc	0.6	0	2026-07-25 11:09:42.70463	\N	2026-07-25 11:09:42.70463
160	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-25 11:09:42.70463	#cccccc	0.4	0	2026-07-25 11:09:42.70463	\N	2026-07-25 11:09:42.70463
161	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-25 14:39:03.179257	#cccccc	1	0	2026-07-25 14:39:03.179257	\N	2026-07-25 14:39:03.179257
162	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-25 14:39:03.179257	#cccccc	0.5	0	2026-07-25 14:39:03.179257	\N	2026-07-25 14:39:03.179257
163	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-25 14:39:03.179257	#cccccc	0.8	0	2026-07-25 14:39:03.179257	\N	2026-07-25 14:39:03.179257
164	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-25 14:39:03.179257	#cccccc	0.6	0	2026-07-25 14:39:03.179257	\N	2026-07-25 14:39:03.179257
165	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-25 14:39:03.179257	#cccccc	0.4	0	2026-07-25 14:39:03.179257	\N	2026-07-25 14:39:03.179257
166	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-25 17:42:52.951149	#cccccc	1	0	2026-07-25 17:42:52.951149	\N	2026-07-25 17:42:52.951149
167	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-25 17:42:52.951149	#cccccc	0.5	0	2026-07-25 17:42:52.951149	\N	2026-07-25 17:42:52.951149
168	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-25 17:42:52.951149	#cccccc	0.8	0	2026-07-25 17:42:52.951149	\N	2026-07-25 17:42:52.951149
169	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-25 17:42:52.951149	#cccccc	0.6	0	2026-07-25 17:42:52.951149	\N	2026-07-25 17:42:52.951149
170	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-25 17:42:52.951149	#cccccc	0.4	0	2026-07-25 17:42:52.951149	\N	2026-07-25 17:42:52.951149
171	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-25 17:49:40.220574	#cccccc	1	0	2026-07-25 17:49:40.220574	\N	2026-07-25 17:49:40.220574
172	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-25 17:49:40.220574	#cccccc	0.5	0	2026-07-25 17:49:40.220574	\N	2026-07-25 17:49:40.220574
173	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-25 17:49:40.220574	#cccccc	0.8	0	2026-07-25 17:49:40.220574	\N	2026-07-25 17:49:40.220574
174	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-25 17:49:40.220574	#cccccc	0.6	0	2026-07-25 17:49:40.220574	\N	2026-07-25 17:49:40.220574
175	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-25 17:49:40.220574	#cccccc	0.4	0	2026-07-25 17:49:40.220574	\N	2026-07-25 17:49:40.220574
176	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-26 07:46:25.249093	#cccccc	1	0	2026-07-26 07:46:25.249093	\N	2026-07-26 07:46:25.249093
177	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-26 07:46:25.249093	#cccccc	0.5	0	2026-07-26 07:46:25.249093	\N	2026-07-26 07:46:25.249093
178	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-26 07:46:25.249093	#cccccc	0.8	0	2026-07-26 07:46:25.249093	\N	2026-07-26 07:46:25.249093
179	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-26 07:46:25.249093	#cccccc	0.6	0	2026-07-26 07:46:25.249093	\N	2026-07-26 07:46:25.249093
180	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-26 07:46:25.249093	#cccccc	0.4	0	2026-07-26 07:46:25.249093	\N	2026-07-26 07:46:25.249093
181	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-27 16:31:30.502071	#cccccc	1	0	2026-07-27 16:31:30.502071	\N	2026-07-27 16:31:30.502071
182	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-27 16:31:30.502071	#cccccc	0.5	0	2026-07-27 16:31:30.502071	\N	2026-07-27 16:31:30.502071
183	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-27 16:31:30.502071	#cccccc	0.8	0	2026-07-27 16:31:30.502071	\N	2026-07-27 16:31:30.502071
184	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-27 16:31:30.502071	#cccccc	0.6	0	2026-07-27 16:31:30.502071	\N	2026-07-27 16:31:30.502071
185	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-27 16:31:30.502071	#cccccc	0.4	0	2026-07-27 16:31:30.502071	\N	2026-07-27 16:31:30.502071
186	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-28 15:21:41.37614	#cccccc	1	0	2026-07-28 15:21:41.37614	\N	2026-07-28 15:21:41.37614
187	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-28 15:21:41.37614	#cccccc	0.5	0	2026-07-28 15:21:41.37614	\N	2026-07-28 15:21:41.37614
188	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-28 15:21:41.37614	#cccccc	0.8	0	2026-07-28 15:21:41.37614	\N	2026-07-28 15:21:41.37614
189	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-28 15:21:41.37614	#cccccc	0.6	0	2026-07-28 15:21:41.37614	\N	2026-07-28 15:21:41.37614
190	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-28 15:21:41.37614	#cccccc	0.4	0	2026-07-28 15:21:41.37614	\N	2026-07-28 15:21:41.37614
191	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-29 10:03:23.911303	#cccccc	1	0	2026-07-29 10:03:23.911303	\N	2026-07-29 10:03:23.911303
192	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-29 10:03:23.911303	#cccccc	0.5	0	2026-07-29 10:03:23.911303	\N	2026-07-29 10:03:23.911303
193	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-29 10:03:23.911303	#cccccc	0.8	0	2026-07-29 10:03:23.911303	\N	2026-07-29 10:03:23.911303
194	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-29 10:03:23.911303	#cccccc	0.6	0	2026-07-29 10:03:23.911303	\N	2026-07-29 10:03:23.911303
195	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-29 10:03:23.911303	#cccccc	0.4	0	2026-07-29 10:03:23.911303	\N	2026-07-29 10:03:23.911303
196	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-29 17:29:00.539178	#cccccc	1	0	2026-07-29 17:29:00.539178	\N	2026-07-29 17:29:00.539178
197	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-29 17:29:00.539178	#cccccc	0.5	0	2026-07-29 17:29:00.539178	\N	2026-07-29 17:29:00.539178
198	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-29 17:29:00.539178	#cccccc	0.8	0	2026-07-29 17:29:00.539178	\N	2026-07-29 17:29:00.539178
199	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-29 17:29:00.539178	#cccccc	0.6	0	2026-07-29 17:29:00.539178	\N	2026-07-29 17:29:00.539178
200	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-29 17:29:00.539178	#cccccc	0.4	0	2026-07-29 17:29:00.539178	\N	2026-07-29 17:29:00.539178
201	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-30 09:28:58.431591	#cccccc	1	0	2026-07-30 09:28:58.431591	\N	2026-07-30 09:28:58.431591
202	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-30 09:28:58.431591	#cccccc	0.5	0	2026-07-30 09:28:58.431591	\N	2026-07-30 09:28:58.431591
203	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-30 09:28:58.431591	#cccccc	0.8	0	2026-07-30 09:28:58.431591	\N	2026-07-30 09:28:58.431591
204	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-30 09:28:58.431591	#cccccc	0.6	0	2026-07-30 09:28:58.431591	\N	2026-07-30 09:28:58.431591
205	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-30 09:28:58.431591	#cccccc	0.4	0	2026-07-30 09:28:58.431591	\N	2026-07-30 09:28:58.431591
206	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-31 09:02:37.011591	#cccccc	1	0	2026-07-31 09:02:37.011591	\N	2026-07-31 09:02:37.011591
207	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-31 09:02:37.011591	#cccccc	0.5	0	2026-07-31 09:02:37.011591	\N	2026-07-31 09:02:37.011591
208	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-31 09:02:37.011591	#cccccc	0.8	0	2026-07-31 09:02:37.011591	\N	2026-07-31 09:02:37.011591
209	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-31 09:02:37.011591	#cccccc	0.6	0	2026-07-31 09:02:37.011591	\N	2026-07-31 09:02:37.011591
210	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-31 09:02:37.011591	#cccccc	0.4	0	2026-07-31 09:02:37.011591	\N	2026-07-31 09:02:37.011591
211	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:40:47.562913	#cccccc	1	0	2026-07-31 16:40:47.562913	\N	2026-07-31 16:40:47.562913
212	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-31 16:40:47.562913	#cccccc	0.5	0	2026-07-31 16:40:47.562913	\N	2026-07-31 16:40:47.562913
213	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:40:47.562913	#cccccc	0.8	0	2026-07-31 16:40:47.562913	\N	2026-07-31 16:40:47.562913
214	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-31 16:40:47.562913	#cccccc	0.6	0	2026-07-31 16:40:47.562913	\N	2026-07-31 16:40:47.562913
215	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-31 16:40:47.562913	#cccccc	0.4	0	2026-07-31 16:40:47.562913	\N	2026-07-31 16:40:47.562913
216	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:43:55.079449	#cccccc	1	0	2026-07-31 16:43:55.079449	\N	2026-07-31 16:43:55.079449
217	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-31 16:43:55.079449	#cccccc	0.5	0	2026-07-31 16:43:55.079449	\N	2026-07-31 16:43:55.079449
218	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:43:55.079449	#cccccc	0.8	0	2026-07-31 16:43:55.079449	\N	2026-07-31 16:43:55.079449
219	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-31 16:43:55.079449	#cccccc	0.6	0	2026-07-31 16:43:55.079449	\N	2026-07-31 16:43:55.079449
220	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-31 16:43:55.079449	#cccccc	0.4	0	2026-07-31 16:43:55.079449	\N	2026-07-31 16:43:55.079449
221	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:51:34.794214	#cccccc	1	0	2026-07-31 16:51:34.794214	\N	2026-07-31 16:51:34.794214
222	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-31 16:51:34.794214	#cccccc	0.5	0	2026-07-31 16:51:34.794214	\N	2026-07-31 16:51:34.794214
223	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:51:34.794214	#cccccc	0.8	0	2026-07-31 16:51:34.794214	\N	2026-07-31 16:51:34.794214
224	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-31 16:51:34.794214	#cccccc	0.6	0	2026-07-31 16:51:34.794214	\N	2026-07-31 16:51:34.794214
225	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-31 16:51:34.794214	#cccccc	0.4	0	2026-07-31 16:51:34.794214	\N	2026-07-31 16:51:34.794214
226	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:57:57.058852	#cccccc	1	0	2026-07-31 16:57:57.058852	\N	2026-07-31 16:57:57.058852
227	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-07-31 16:57:57.058852	#cccccc	0.5	0	2026-07-31 16:57:57.058852	\N	2026-07-31 16:57:57.058852
228	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-07-31 16:57:57.058852	#cccccc	0.8	0	2026-07-31 16:57:57.058852	\N	2026-07-31 16:57:57.058852
229	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-07-31 16:57:57.058852	#cccccc	0.6	0	2026-07-31 16:57:57.058852	\N	2026-07-31 16:57:57.058852
230	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-07-31 16:57:57.058852	#cccccc	0.4	0	2026-07-31 16:57:57.058852	\N	2026-07-31 16:57:57.058852
231	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-02 07:05:33.849568	#cccccc	1	0	2026-08-02 07:05:33.849568	\N	2026-08-02 07:05:33.849568
232	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-02 07:05:33.849568	#cccccc	0.5	0	2026-08-02 07:05:33.849568	\N	2026-08-02 07:05:33.849568
233	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-02 07:05:33.849568	#cccccc	0.8	0	2026-08-02 07:05:33.849568	\N	2026-08-02 07:05:33.849568
234	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-02 07:05:33.849568	#cccccc	0.6	0	2026-08-02 07:05:33.849568	\N	2026-08-02 07:05:33.849568
235	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-02 07:05:33.849568	#cccccc	0.4	0	2026-08-02 07:05:33.849568	\N	2026-08-02 07:05:33.849568
236	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-03 09:00:45.341123	#cccccc	1	0	2026-08-03 09:00:45.341123	\N	2026-08-03 09:00:45.341123
237	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-03 09:00:45.341123	#cccccc	0.5	0	2026-08-03 09:00:45.341123	\N	2026-08-03 09:00:45.341123
238	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-03 09:00:45.341123	#cccccc	0.8	0	2026-08-03 09:00:45.341123	\N	2026-08-03 09:00:45.341123
239	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-03 09:00:45.341123	#cccccc	0.6	0	2026-08-03 09:00:45.341123	\N	2026-08-03 09:00:45.341123
240	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-03 09:00:45.341123	#cccccc	0.4	0	2026-08-03 09:00:45.341123	\N	2026-08-03 09:00:45.341123
241	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-04 14:41:18.102386	#cccccc	1	0	2026-08-04 14:41:18.102386	\N	2026-08-04 14:41:18.102386
242	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-04 14:41:18.102386	#cccccc	0.5	0	2026-08-04 14:41:18.102386	\N	2026-08-04 14:41:18.102386
243	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-04 14:41:18.102386	#cccccc	0.8	0	2026-08-04 14:41:18.102386	\N	2026-08-04 14:41:18.102386
244	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-04 14:41:18.102386	#cccccc	0.6	0	2026-08-04 14:41:18.102386	\N	2026-08-04 14:41:18.102386
245	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-04 14:41:18.102386	#cccccc	0.4	0	2026-08-04 14:41:18.102386	\N	2026-08-04 14:41:18.102386
246	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-04 14:41:56.13509	#cccccc	1	0	2026-08-04 14:41:56.13509	\N	2026-08-04 14:41:56.13509
247	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-04 14:41:56.13509	#cccccc	0.5	0	2026-08-04 14:41:56.13509	\N	2026-08-04 14:41:56.13509
248	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-04 14:41:56.13509	#cccccc	0.8	0	2026-08-04 14:41:56.13509	\N	2026-08-04 14:41:56.13509
249	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-04 14:41:56.13509	#cccccc	0.6	0	2026-08-04 14:41:56.13509	\N	2026-08-04 14:41:56.13509
250	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-04 14:41:56.13509	#cccccc	0.4	0	2026-08-04 14:41:56.13509	\N	2026-08-04 14:41:56.13509
251	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-05 14:32:26.834062	#cccccc	1	0	2026-08-05 14:32:26.834062	\N	2026-08-05 14:32:26.834062
252	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-05 14:32:26.834062	#cccccc	0.5	0	2026-08-05 14:32:26.834062	\N	2026-08-05 14:32:26.834062
253	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-05 14:32:26.834062	#cccccc	0.8	0	2026-08-05 14:32:26.834062	\N	2026-08-05 14:32:26.834062
254	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-05 14:32:26.834062	#cccccc	0.6	0	2026-08-05 14:32:26.834062	\N	2026-08-05 14:32:26.834062
255	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-05 14:32:26.834062	#cccccc	0.4	0	2026-08-05 14:32:26.834062	\N	2026-08-05 14:32:26.834062
256	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-06 08:44:20.060851	#cccccc	1	0	2026-08-06 08:44:20.060851	\N	2026-08-06 08:44:20.060851
257	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-06 08:44:20.060851	#cccccc	0.5	0	2026-08-06 08:44:20.060851	\N	2026-08-06 08:44:20.060851
258	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-06 08:44:20.060851	#cccccc	0.8	0	2026-08-06 08:44:20.060851	\N	2026-08-06 08:44:20.060851
259	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-06 08:44:20.060851	#cccccc	0.6	0	2026-08-06 08:44:20.060851	\N	2026-08-06 08:44:20.060851
260	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-06 08:44:20.060851	#cccccc	0.4	0	2026-08-06 08:44:20.060851	\N	2026-08-06 08:44:20.060851
261	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-06 16:05:31.935128	#cccccc	1	0	2026-08-06 16:05:31.935128	\N	2026-08-06 16:05:31.935128
262	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-06 16:05:31.935128	#cccccc	0.5	0	2026-08-06 16:05:31.935128	\N	2026-08-06 16:05:31.935128
263	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-06 16:05:31.935128	#cccccc	0.8	0	2026-08-06 16:05:31.935128	\N	2026-08-06 16:05:31.935128
264	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-06 16:05:31.935128	#cccccc	0.6	0	2026-08-06 16:05:31.935128	\N	2026-08-06 16:05:31.935128
265	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-06 16:05:31.935128	#cccccc	0.4	0	2026-08-06 16:05:31.935128	\N	2026-08-06 16:05:31.935128
266	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-07 16:31:18.434647	#cccccc	1	0	2026-08-07 16:31:18.434647	\N	2026-08-07 16:31:18.434647
267	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-07 16:31:18.434647	#cccccc	0.5	0	2026-08-07 16:31:18.434647	\N	2026-08-07 16:31:18.434647
268	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-07 16:31:18.434647	#cccccc	0.8	0	2026-08-07 16:31:18.434647	\N	2026-08-07 16:31:18.434647
269	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-07 16:31:18.434647	#cccccc	0.6	0	2026-08-07 16:31:18.434647	\N	2026-08-07 16:31:18.434647
270	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-07 16:31:18.434647	#cccccc	0.4	0	2026-08-07 16:31:18.434647	\N	2026-08-07 16:31:18.434647
271	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-07 16:59:31.510927	#cccccc	1	0	2026-08-07 16:59:31.510927	\N	2026-08-07 16:59:31.510927
272	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-07 16:59:31.510927	#cccccc	0.5	0	2026-08-07 16:59:31.510927	\N	2026-08-07 16:59:31.510927
273	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-07 16:59:31.510927	#cccccc	0.8	0	2026-08-07 16:59:31.510927	\N	2026-08-07 16:59:31.510927
274	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-07 16:59:31.510927	#cccccc	0.6	0	2026-08-07 16:59:31.510927	\N	2026-08-07 16:59:31.510927
275	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-07 16:59:31.510927	#cccccc	0.4	0	2026-08-07 16:59:31.510927	\N	2026-08-07 16:59:31.510927
276	sunny	default	f	0	0.5	0.5	1	45	f	1	2026-08-08 05:43:00.183905	#cccccc	1	0	2026-08-08 05:43:00.183905	\N	2026-08-08 05:43:00.183905
277	rainy	cloudy	t	0.3	0.5	0.5	1	45	f	1	2026-08-08 05:43:00.183905	#cccccc	0.5	0	2026-08-08 05:43:00.183905	\N	2026-08-08 05:43:00.183905
278	cloudy	cloudy	f	0	0.5	0.5	1	45	f	1	2026-08-08 05:43:00.183905	#cccccc	0.8	0	2026-08-08 05:43:00.183905	\N	2026-08-08 05:43:00.183905
279	snowy	foggy	t	0.5	0.5	0.5	1	45	f	1	2026-08-08 05:43:00.183905	#cccccc	0.6	0	2026-08-08 05:43:00.183905	\N	2026-08-08 05:43:00.183905
280	foggy	foggy	t	0.8	0.5	0.5	1	45	f	1	2026-08-08 05:43:00.183905	#cccccc	0.4	0	2026-08-08 05:43:00.183905	\N	2026-08-08 05:43:00.183905
\.


--
-- Name: account_lockouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.account_lockouts_id_seq', 1, true);


--
-- Name: admin_action_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_action_logs_id_seq', 612, true);


--
-- Name: admin_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_sessions_id_seq', 1, false);


--
-- Name: admin_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_users_id_seq', 60, true);


--
-- Name: ai_generated_scenes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_generated_scenes_id_seq', 19, true);


--
-- Name: ai_provider_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_provider_audit_log_id_seq', 28, true);


--
-- Name: ai_provider_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_provider_configs_id_seq', 15, true);


--
-- Name: ai_providers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_providers_id_seq', 1953, true);


--
-- Name: ai_scene_favorites_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_scene_favorites_id_seq', 1, false);


--
-- Name: config_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.config_audit_log_id_seq', 54, true);


--
-- Name: gallery_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gallery_configs_id_seq', 5, true);


--
-- Name: gallery_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gallery_items_id_seq', 471, true);


--
-- Name: game_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.game_config_id_seq', 56, true);


--
-- Name: generated_buildings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.generated_buildings_id_seq', 18, true);


--
-- Name: geometry_buildings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.geometry_buildings_id_seq', 28, true);


--
-- Name: login_attempts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.login_attempts_id_seq', 162, true);


--
-- Name: maintenance_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.maintenance_logs_id_seq', 64, true);


--
-- Name: model_tags_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.model_tags_id_seq', 2494, true);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_reset_tokens_id_seq', 3, true);


--
-- Name: scene_3dgs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.scene_3dgs_id_seq', 1, false);


--
-- Name: security_questions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.security_questions_id_seq', 564, true);


--
-- Name: system_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.system_config_id_seq', 751, true);


--
-- Name: teleport_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.teleport_history_id_seq', 3, true);


--
-- Name: threejs_code_blocks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.threejs_code_blocks_id_seq', 6, true);


--
-- Name: ui_controls_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ui_controls_id_seq', 2628, true);


--
-- Name: uploaded_models_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.uploaded_models_id_seq', 14, true);


--
-- Name: world_objects_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_objects_id_seq', 493, true);


--
-- Name: world_weather_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.world_weather_id_seq', 280, true);


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
-- Name: threejs_code_blocks threejs_code_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threejs_code_blocks
    ADD CONSTRAINT threejs_code_blocks_pkey PRIMARY KEY (id);


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
-- Name: world_objects world_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_pkey PRIMARY KEY (id);


--
-- Name: world_rules world_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_rules
    ADD CONSTRAINT world_rules_pkey PRIMARY KEY (id);


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
-- Name: idx_trusted_worlds_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_worlds_enabled ON public.trusted_worlds USING btree (enabled);


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
-- Name: idx_user_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_user ON public.user_subscriptions USING btree (user_id);


--
-- Name: idx_world_drops_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_drops_active ON public.world_drops USING btree (is_picked, expires_at);


--
-- Name: idx_world_objects_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_building_id ON public.world_objects USING btree (building_id);


--
-- Name: idx_world_objects_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_world_objects_type ON public.world_objects USING btree (type);


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
-- Name: ai_provider_audit_log ai_provider_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_audit_log
    ADD CONSTRAINT ai_provider_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


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
-- Name: ai_provider_configs ai_provider_configs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs
    ADD CONSTRAINT ai_provider_configs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


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
-- Name: portals portals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portals
    ADD CONSTRAINT portals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


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
-- Name: weapon_skills weapon_skills_weapon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weapon_skills
    ADD CONSTRAINT weapon_skills_weapon_id_fkey FOREIGN KEY (weapon_id) REFERENCES public.weapons(id) ON DELETE CASCADE;


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
-- Name: world_objects world_objects_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.generated_buildings(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 2nvumZRNFebaVbbhHh3wYfLftKPTJLAcifmt1mjecwgpDovuV1VGMBmupXWpweZ

-- ============================================
-- 自动清理：新世界部署用，去除旧世界身份
-- ============================================
DELETE FROM system_config WHERE config_key IN ('147', '20', '21', '22', '148');
UPDATE character_templates SET is_federated = FALSE, source_world_id = NULL, source_template_id = NULL;
UPDATE characters SET remote_user_id = NULL, remote_world = NULL;
UPDATE users SET federation_user = FALSE;
