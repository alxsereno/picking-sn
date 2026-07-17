const express = require('express');
const pool    = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/pedidos ─────────────────────────────────────────
// Lista pedidos com filtros opcionais
router.get('/', authMiddleware, async (req, res) => {
  const { status, regiao, periodo, data_entrega } = req.query;
  const conditions = [];
  const params = [];

  if (status)        { params.push(status);        conditions.push(`p.status = $${params.length}`); }
  if (regiao)        { params.push(regiao);         conditions.push(`p.regiao = $${params.length}`); }
  if (periodo)       { params.push(periodo);        conditions.push(`p.periodo_entrega = $${params.length}`); }
  if (data_entrega)  { params.push(data_entrega);   conditions.push(`p.data_entrega = $${params.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await pool.query(`
      SELECT
        p.*,
        COUNT(ip.id)                                   AS total_itens,
        COUNT(ip.id) FILTER (WHERE ip.e_taxa = false)  AS itens_produto,
        s.operador_id,
        o.nome AS operador_nome,
        s.iniciado_em AS sep_iniciado_em,
        s.concluido_em AS sep_concluido_em,
        s.duracao_seg
      FROM pedidos p
      LEFT JOIN itens_pedido ip  ON ip.pedido_id = p.id
      LEFT JOIN separacoes s     ON s.pedido_id = p.id AND s.concluido_em IS NOT NULL
                                  OR s.pedido_id = p.id AND s.concluido_em IS NULL
      LEFT JOIN operadores o     ON o.id = s.operador_id
      ${where}
      GROUP BY p.id, s.operador_id, o.nome, s.iniciado_em, s.concluido_em, s.duracao_seg
      ORDER BY p.data_entrega ASC, p.periodo_entrega ASC, p.regiao ASC, p.recebido_em ASC
    `, params);

    res.json({ pedidos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar pedidos.' });
  }
});

// ── GET /api/pedidos/:id ─────────────────────────────────────
// Detalhe de um pedido com todos os itens
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: [pedido] } = await pool.query(
      `SELECT p.*,
              o.nome AS operador_nome,
              s.id   AS separacao_id,
              s.iniciado_em AS sep_iniciado_em,
              s.concluido_em AS sep_concluido_em,
              s.duracao_seg
       FROM pedidos p
       LEFT JOIN separacoes s  ON s.pedido_id = p.id
       LEFT JOIN operadores o  ON o.id = s.operador_id
       WHERE p.id = $1
       ORDER BY s.iniciado_em DESC LIMIT 1`,
      [req.params.id]
    );

    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

    const { rows: itens } = await pool.query(
      `SELECT ip.*,
              EXISTS(
                SELECT 1 FROM leituras l
                WHERE l.item_id = ip.id AND l.sucesso = true
                  AND l.separacao_id = $2
              ) AS lido
       FROM itens_pedido ip
       WHERE ip.pedido_id = $1
       ORDER BY ip.id`,
      [req.params.id, pedido.separacao_id || 0]
    );

    res.json({ pedido, itens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar pedido.' });
  }
});

// ── POST /api/pedidos/:id/iniciar ────────────────────────────
// Operador inicia a separação de um pedido
router.post('/:id/iniciar', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [pedido] } = await client.query(
      `SELECT id, status FROM pedidos WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );

    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    if (pedido.status !== 'pendente') {
      return res.status(409).json({ erro: `Pedido já está com status "${pedido.status}".` });
    }

    await client.query(
      `UPDATE pedidos SET status = 'separando' WHERE id = $1`,
      [req.params.id]
    );

    const { rows: [sep] } = await client.query(
      `INSERT INTO separacoes (pedido_id, operador_id) VALUES ($1, $2) RETURNING id`,
      [req.params.id, req.operador.id]
    );

    await client.query('COMMIT');
    res.json({ separacao_id: sep.id, mensagem: 'Separação iniciada.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao iniciar separação.' });
  } finally {
    client.release();
  }
});

// ── POST /api/pedidos/:id/ler-item ───────────────────────────
// Registra a leitura de um item
router.post('/:id/ler-item', authMiddleware, async (req, res) => {
  const { separacao_id, item_id, codigo_lido } = req.body;
  if (!separacao_id || !item_id || !codigo_lido) {
    return res.status(400).json({ erro: 'separacao_id, item_id e codigo_lido são obrigatórios.' });
  }

  try {
    // Valida se o código bate com o item
    const { rows: [item] } = await pool.query(
      `SELECT id, codigo_barras FROM itens_pedido WHERE id = $1 AND pedido_id = $2`,
      [item_id, req.params.id]
    );

    if (!item) return res.status(404).json({ erro: 'Item não encontrado neste pedido.' });

    const sucesso = item.codigo_barras === codigo_lido;

    await pool.query(
      `INSERT INTO leituras (separacao_id, item_id, codigo_lido, sucesso)
       VALUES ($1, $2, $3, $4)`,
      [separacao_id, item_id, codigo_lido, sucesso]
    );

    if (!sucesso) {
      return res.status(422).json({ sucesso: false, erro: 'Código de barras incorreto.' });
    }

    res.json({ sucesso: true, mensagem: 'Item confirmado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar leitura.' });
  }
});

// ── POST /api/pedidos/:id/concluir ───────────────────────────
// Finaliza a separação
router.post('/:id/concluir', authMiddleware, async (req, res) => {
  const { separacao_id } = req.body;
  if (!separacao_id) return res.status(400).json({ erro: 'separacao_id é obrigatório.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica se todos os itens (não-taxa) foram lidos
    const { rows: [check] } = await client.query(`
      SELECT
        COUNT(ip.id) FILTER (WHERE ip.e_taxa = false) AS total,
        COUNT(l.id)  FILTER (WHERE l.sucesso = true AND ip.e_taxa = false) AS lidos
      FROM itens_pedido ip
      LEFT JOIN leituras l ON l.item_id = ip.id AND l.separacao_id = $2
      WHERE ip.pedido_id = $1
    `, [req.params.id, separacao_id]);

    if (parseInt(check.lidos) < parseInt(check.total)) {
      return res.status(409).json({
        erro: `Ainda faltam ${check.total - check.lidos} item(s) para confirmar.`,
        total: parseInt(check.total),
        lidos: parseInt(check.lidos)
      });
    }

    const agora = new Date();
    await client.query(`
      UPDATE separacoes
      SET concluido_em = $1,
          duracao_seg  = EXTRACT(EPOCH FROM ($1 - iniciado_em))::INTEGER
      WHERE id = $2
    `, [agora, separacao_id]);

    await client.query(
      `UPDATE pedidos SET status = 'separado' WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json({ mensagem: 'Pedido separado com sucesso.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao concluir separação.' });
  } finally {
    client.release();
  }
});

module.exports = router;
