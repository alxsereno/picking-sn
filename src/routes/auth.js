const express = require('express');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { nome, pin } = req.body;
  if (!nome || !pin) {
    return res.status(400).json({ erro: 'Nome e PIN são obrigatórios.' });
  }

  const pinHash = crypto.createHash('sha256').update(String(pin)).digest('hex');

  try {
    const { rows } = await pool.query(
      `SELECT id, nome FROM operadores
       WHERE LOWER(nome) = LOWER($1) AND pin_hash = $2 AND ativo = true`,
      [nome.trim(), pinHash]
    );

    if (!rows.length) {
      return res.status(401).json({ erro: 'Nome ou PIN incorreto.' });
    }

    const operador = rows[0];
    const token = jwt.sign(
      { id: operador.id, nome: operador.nome },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, operador: { id: operador.id, nome: operador.nome } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

module.exports = router;
