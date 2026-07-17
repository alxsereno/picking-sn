require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const schemaPath = path.join(__dirname, '../../schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();
  try {
    console.log('Executando schema.sql...');
    await client.query(sql);
    console.log('✓ Banco de dados criado com sucesso.');
  } catch (err) {
    console.error('✗ Erro na migração:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
