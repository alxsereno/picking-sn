const express = require('express');
const pool    = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/gestao/kanban — dados para a tela de gestão (polling a cada 15s)
router.get('/kanban', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.pedido_externo_id,
        p.cliente_nome,
        p.canal,
        p.regiao,
        p.periodo_entrega,
        p.data_entrega,
        p.observacao,
        p.valor_total,
        p.status,
        p.urgente,
        p.recebido_em,
        p.atualizado_em,
        COUNT(ip.id) FILTER (WHERE ip.e_taxa = false)                AS total_itens,
        COUNT(l.id)  FILTER (WHERE l.sucesso = true AND ip.e_taxa = false) AS itens_lidos,
        o.nome   AS operador_nome,
        s.iniciado_em  AS sep_inicio,
        s.concluido_em AS sep_fim,
        s.duracao_seg
      FROM pedidos p
      LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id
      LEFT JOIN separacoes s    ON s.pedido_id = p.id
      LEFT JOIN leituras l      ON l.separacao_id = s.id AND l.item_id = ip.id
      LEFT JOIN operadores o    ON o.id = s.operador_id
      WHERE p.status != 'cancelado'
        AND p.data_entrega >= CURRENT_DATE - INTERVAL '1 day'
      GROUP BY p.id, o.nome, s.iniciado_em, s.concluido_em, s.duracao_seg
      ORDER BY p.data_entrega ASC, p.periodo_entrega ASC, p.regiao ASC
    `);

    // Agrupa por status para o kanban
    const kanban = {
      pendente:   rows.filter(r => r.status === 'pendente'),
      separando:  rows.filter(r => r.status === 'separando'),
      separado:   rows.filter(r => r.status === 'separado'),
      expedicao:  rows.filter(r => r.status === 'expedição'),
    };

    res.json({ kanban, total: rows.length, atualizado_em: new Date() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar kanban.' });
  }
});

// GET /api/gestao/historico — separações concluídas com auditoria
router.get('/historico', authMiddleware, async (req, res) => {
  const { data, operador_id } = req.query;
  const params = [];
  const conditions = [`s.concluido_em IS NOT NULL`];

  if (data) {
    params.push(data);
    conditions.push(`DATE(s.concluido_em) = $${params.length}`);
  }
  if (operador_id) {
    params.push(operador_id);
    conditions.push(`s.operador_id = $${params.length}`);
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        s.id AS separacao_id,
        p.pedido_externo_id,
        p.cliente_nome,
        p.regiao,
        p.canal,
        p.valor_total,
        o.nome        AS operador_nome,
        s.iniciado_em,
        s.concluido_em,
        s.duracao_seg,
        COUNT(l.id)   AS itens_lidos
      FROM separacoes s
      JOIN pedidos p    ON p.id = s.pedido_id
      JOIN operadores o ON o.id = s.operador_id
      LEFT JOIN leituras l ON l.separacao_id = s.id AND l.sucesso = true
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id, p.pedido_externo_id, p.cliente_nome, p.regiao, p.canal, p.valor_total, o.nome
      ORDER BY s.concluido_em DESC
      LIMIT 200
    `, params);

    res.json({ historico: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar histórico.' });
  }
});

module.exports = router;
