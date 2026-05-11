-- ═══════════════════════════════════════════════════════════════
-- Auto-exécuté au premier démarrage du conteneur MySQL
-- ═══════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS orienteering;
USE orienteering;

CREATE TABLE IF NOT EXISTS beacon_pings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  race_id VARCHAR(80) NOT NULL,
  team_code VARCHAR(80) NOT NULL,
  team_name VARCHAR(120) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  accuracy DOUBLE NOT NULL,
  speed_kmh DOUBLE NOT NULL,
  heading DOUBLE NOT NULL,
  battery DOUBLE NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_bp_race (race_id, created_at DESC),
  INDEX idx_bp_team (team_code, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS server_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  message VARCHAR(500) NOT NULL,
  meta TEXT,
  timestamp BIGINT NOT NULL,
  INDEX idx_logs_ts (timestamp DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS race_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  race_id VARCHAR(80) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload TEXT,
  created_at BIGINT NOT NULL,
  INDEX idx_re_race (race_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
