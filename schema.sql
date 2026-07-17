-- ============================================================
--  PICKING SN — Schema PostgreSQL
--  Simples e Natural
-- ============================================================

-- Extensão para UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── OPERADORES ───────────────────────────────────────────────
CREATE TABLE operadores (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(120)        NOT NULL,
  pin_hash    VARCHAR(64)         NOT NULL,          -- SHA-256 do PIN
  ativo       BOOLEAN             DEFAULT true,
  criado_em   TIMESTAMPTZ         DEFAULT NOW()
);

-- ── PEDIDOS ──────────────────────────────────────────────────
CREATE TABLE pedidos (
  id                SERIAL PRIMARY KEY,
  pedido_externo_id VARCHAR(60)   NOT NULL UNIQUE,   -- ID do OpenCart
  cliente_nome      VARCHAR(200)  NOT NULL,
  cliente_telefone  VARCHAR(30),
  canal             VARCHAR(50)   NOT NULL,           -- 'site','goomer','app'
  regiao            VARCHAR(10)   NOT NULL,           -- 'CAM','BAR','IND'
  periodo_entrega   VARCHAR(20)   NOT NULL,           -- 'Manha','Tarde'
  data_entrega      DATE          NOT NULL,
  observacao        TEXT,
  valor_total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  status            VARCHAR(20)   NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','separando','separado','expedição','cancelado')),
  urgente           BOOLEAN       DEFAULT false,
  recebido_em       TIMESTAMPTZ   DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ   DEFAULT NOW()
);

-- ── ITENS DO PEDIDO ──────────────────────────────────────────
CREATE TABLE itens_pedido (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER       NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_nome    VARCHAR(300)  NOT NULL,
  sku             VARCHAR(60)   NOT NULL,
  codigo_barras   VARCHAR(60)   NOT NULL,
  quantidade      INTEGER       NOT NULL DEFAULT 1,
  preco_unitario  NUMERIC(10,2) NOT NULL DEFAULT 0,
  e_taxa          BOOLEAN       DEFAULT false          -- true = taxa de entrega, não precisa de leitura
);

-- ── SEPARAÇÕES (registro de auditoria) ───────────────────────
CREATE TABLE separacoes (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER       NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  operador_id     INTEGER       NOT NULL REFERENCES operadores(id),
  iniciado_em     TIMESTAMPTZ   DEFAULT NOW(),
  concluido_em    TIMESTAMPTZ,
  duracao_seg     INTEGER,                             -- calculado ao concluir
  observacao      TEXT
);

-- ── LEITURAS (item a item) ────────────────────────────────────
CREATE TABLE leituras (
  id              SERIAL PRIMARY KEY,
  separacao_id    INTEGER       NOT NULL REFERENCES separacoes(id) ON DELETE CASCADE,
  item_id         INTEGER       NOT NULL REFERENCES itens_pedido(id),
  codigo_lido     VARCHAR(60)   NOT NULL,
  lido_em         TIMESTAMPTZ   DEFAULT NOW(),
  sucesso         BOOLEAN       NOT NULL DEFAULT true
);

-- ── WEBHOOKS LOG (rastrear chamadas do OpenCart) ─────────────
CREATE TABLE webhooks_log (
  id              SERIAL PRIMARY KEY,
  origem          VARCHAR(100),
  payload         JSONB,
  status          VARCHAR(20)   DEFAULT 'recebido',
  erro            TEXT,
  recebido_em     TIMESTAMPTZ   DEFAULT NOW()
);

-- ── ÍNDICES ──────────────────────────────────────────────────
CREATE INDEX idx_pedidos_status         ON pedidos(status);
CREATE INDEX idx_pedidos_data_entrega   ON pedidos(data_entrega);
CREATE INDEX idx_pedidos_regiao         ON pedidos(regiao);
CREATE INDEX idx_pedidos_externo_id     ON pedidos(pedido_externo_id);
CREATE INDEX idx_itens_pedido_id        ON itens_pedido(pedido_id);
CREATE INDEX idx_itens_codigo_barras    ON itens_pedido(codigo_barras);
CREATE INDEX idx_separacoes_pedido_id   ON separacoes(pedido_id);
CREATE INDEX idx_leituras_separacao_id  ON leituras(separacao_id);

-- ── TRIGGER: atualiza atualizado_em automaticamente ──────────
CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pedidos_atualizado_em
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- ── OPERADORES PADRÃO (seeds) ─────────────────────────────────
-- PIN padrão "1234" → hash SHA-256
INSERT INTO operadores (nome, pin_hash) VALUES
  ('Admin',      encode(digest('1234', 'sha256'), 'hex')),
  ('João Silva', encode(digest('1234', 'sha256'), 'hex')),
  ('Ana Lima',   encode(digest('1234', 'sha256'), 'hex'));
