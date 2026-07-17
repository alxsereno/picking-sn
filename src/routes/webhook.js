const express = require('express');
const pool    = require('../db/pool');
const { webhookAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/webhook/pedido
 *
 * Recebe um novo pedido do OpenCart.
 * O desenvolvedor do site deve enviar este payload via HTTP POST.
 *
 * Header obrigatório:
 *   x-webhook-secret: <WEBHOOK_SECRET configurado no Railway>
 *
 * Payload esperado (JSON):
 * {
 *   "pedido_id": "150588093",          // ID do pedido no OpenCart
 *   "cliente_nome": "Maria Silva",
 *   "cliente_telefone": "19999999999", // opcional
 *   "canal": "site",                   // "site" | "goomer" | "app"
 *   "regiao": "CAM",                   // "CAM" | "BAR" | "IND"
 *   "periodo_entrega": "Manha",        // "Manha" | "Tarde"
 *   "data_entrega": "2026-06-10",      // formato ISO YYYY-MM-DD
 *   "observacao": "Deixar na portaria",// opcional
 *   "valor_total": 168.95,
 *   "urgente": false,
 *   "itens": [
 *     {
 *       "produto_nome": "Frango Grelhado c/ Legumes",
 *       "sku": "FGL-001",
 *       "codigo_barras": "7891234560001",
 *       "quantidade": 2,
 *       "preco_unitario": 28.90,
 *       "e_taxa": false
 *     },
 *     {
 *       "produto_nome": "Taxa de Entrega",
 *       "sku": "TAXA-001",
 *       "codigo_barras": "TAXA",
 *       "quantidade": 1,
 *       "preco_unitario": 10.00,
 *       "e_taxa": true
 *     }
 *   ]
 * }
 */
router.post('/pedido', webhookAuth, async (req, res) => {
  const payload = req.body;

  // Log do webhook recebido
  await pool.query(
    `INSERT INTO webhooks_log (origem, payload, status) VALUES ($1, $2, 'recebido')`,
    [req.headers['user-agent'] || 'OpenCart', JSON.stringify(payload)]
  ).catch(() => {});

  // Validação mínima
  const required = ['pedido_id','cliente_nome','canal','regiao','periodo_entrega','data_entrega','itens'];
  const missing = required.filter(f => !payload[f]);
  if (missing.length) {
    return res.status(400).json({ erro: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
  }

  if (!Array.isArray(payload.itens) || !payload.itens.length) {
    return res.status(400).json({ erro: 'O pedido deve ter pelo menos um item.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert do pedido (idempotente — reenvio do mesmo pedido não duplica)
    const { rows: [pedido] } = await client.query(`
      INSERT INTO pedidos
        (pedido_externo_id, cliente_nome, cliente_telefone, canal, regiao,
         periodo_entrega, data_entrega, observacao, valor_total, urgente)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (pedido_externo_id) DO UPDATE SET
        atualizado_em = NOW()
      RETURNING id, (xmax = 0) AS inserido
    `, [
      String(payload.pedido_id),
      payload.cliente_nome,
      payload.cliente_telefone || null,
      payload.canal,
      payload.regiao,
      payload.periodo_entrega,
      payload.data_entrega,
      payload.observacao || null,
      parseFloat(payload.valor_total) || 0,
      Boolean(payload.urgente)
    ]);

    // Só insere itens se for um pedido novo
    if (pedido.inserido) {
      for (const item of payload.itens) {
        await client.query(`
          INSERT INTO itens_pedido
            (pedido_id, produto_nome, sku, codigo_barras, quantidade, preco_unitario, e_taxa)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [
          pedido.id,
          item.produto_nome,
          item.sku,
          item.codigo_barras,
          parseInt(item.quantidade) || 1,
          parseFloat(item.preco_unitario) || 0,
          Boolean(item.e_taxa)
        ]);
      }
    }

    await client.query(
      `UPDATE webhooks_log SET status = 'processado' WHERE payload->>'pedido_id' = $1`,
      [String(payload.pedido_id)]
    );

    await client.query('COMMIT');

    res.status(pedido.inserido ? 201 : 200).json({
      mensagem: pedido.inserido ? 'Pedido criado.' : 'Pedido já existia (ignorado).',
      pedido_id: pedido.id
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    await pool.query(
      `UPDATE webhooks_log SET status = 'erro', erro = $1 WHERE payload->>'pedido_id' = $2`,
      [err.message, String(payload.pedido_id)]
    ).catch(() => {});
    res.status(500).json({ erro: 'Erro ao processar pedido.' });
  } finally {
    client.release();
  }
});

module.exports = router;
