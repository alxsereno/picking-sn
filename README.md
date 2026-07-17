# Picking SN — Simples e Natural

Sistema de separação de pedidos com PWA mobile + tela de gestão kanban.

---

## Estrutura do projeto

```
picking-sn/
├── src/
│   ├── server.js              # Servidor Express principal
│   ├── db/
│   │   ├── pool.js            # Conexão PostgreSQL
│   │   └── migrate.js         # Cria as tabelas no banco
│   ├── middleware/
│   │   └── auth.js            # JWT + Webhook auth
│   └── routes/
│       ├── auth.js            # POST /api/auth/login
│       ├── pedidos.js         # CRUD de pedidos e separação
│       ├── webhook.js         # POST /api/webhook/pedido (OpenCart)
│       └── gestao.js          # GET /api/gestao/kanban
├── public/                    # PWA (servido pelo Express)
│   ├── index.html             # App mobile
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service Worker
│   └── icons/
├── schema.sql                 # Schema completo do banco
├── railway.json               # Config deploy Railway
├── .env.example               # Variáveis de ambiente
└── package.json
```

---

## Deploy no Railway

### 1. Criar repositório no GitHub

```bash
git init
git add .
git commit -m "feat: picking SN v1"
git remote add origin https://github.com/SEU_USUARIO/picking-sn.git
git push -u origin main
```

### 2. Criar projeto no Railway

- Acesse railway.app → New Project → Deploy from GitHub
- Selecione o repositório `picking-sn`
- Railway detecta automaticamente o Node.js

### 3. Adicionar PostgreSQL

- No projeto Railway → Add Service → Database → PostgreSQL
- Railway injeta `DATABASE_URL` automaticamente

### 4. Configurar variáveis de ambiente

No Railway → seu serviço → Variables:

```
JWT_SECRET=gere_uma_chave_forte_aleatoria_aqui
WEBHOOK_SECRET=chave_secreta_para_o_opencart
NODE_ENV=production
```

Para gerar o JWT_SECRET, rode no terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Rodar a migração (criar tabelas)

No Railway → seu serviço → Settings → Deploy → Start Command, rode uma vez:
```
node src/db/migrate.js
```
Depois volte para `node src/server.js`.

Ou pelo Railway CLI:
```bash
railway run node src/db/migrate.js
```

### 6. Acessar o app

- **URL do Railway** → app PWA (instale no celular como app)
- **URL do Railway/gestao** → tela de gestão kanban no desktop

---

## Integração com OpenCart

Os desenvolvedores do site devem enviar um HTTP POST para:

```
POST https://SUA-URL.up.railway.app/api/webhook/pedido
```

**Header obrigatório:**
```
x-webhook-secret: <WEBHOOK_SECRET configurado no Railway>
Content-Type: application/json
```

**Payload:**
```json
{
  "pedido_id": "150588093",
  "cliente_nome": "Maria Silva",
  "cliente_telefone": "19999999999",
  "canal": "site",
  "regiao": "CAM",
  "periodo_entrega": "Manha",
  "data_entrega": "2026-06-10",
  "observacao": "Deixar na portaria",
  "valor_total": 168.95,
  "urgente": false,
  "itens": [
    {
      "produto_nome": "Frango Grelhado c/ Legumes",
      "sku": "FGL-001",
      "codigo_barras": "7891234560001",
      "quantidade": 2,
      "preco_unitario": 28.90,
      "e_taxa": false
    },
    {
      "produto_nome": "Taxa de Entrega",
      "sku": "TAXA",
      "codigo_barras": "TAXA",
      "quantidade": 1,
      "preco_unitario": 10.00,
      "e_taxa": true
    }
  ]
}
```

**Campos de região aceitos:** `CAM` (Cambuí), `BAR` (Barão Geraldo), `IND` (Indaiatuba)  
**Campos de período aceitos:** `Manha`, `Tarde`  
**Campos de canal aceitos:** `site`, `goomer`, `app`

---

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/login` | Login do operador |
| GET  | `/api/pedidos` | Lista pedidos (com filtros) |
| GET  | `/api/pedidos/:id` | Detalhe + itens do pedido |
| POST | `/api/pedidos/:id/iniciar` | Inicia separação |
| POST | `/api/pedidos/:id/ler-item` | Registra leitura de item |
| POST | `/api/pedidos/:id/concluir` | Finaliza separação |
| GET  | `/api/gestao/kanban` | Dados para tela kanban |
| GET  | `/api/gestao/historico` | Histórico de separações |
| POST | `/api/webhook/pedido` | Recebe pedido do OpenCart |
| GET  | `/api/health` | Health check |

---

## Operadores padrão (seeds)

| Nome | PIN |
|------|-----|
| Admin | 1234 |
| João Silva | 1234 |
| Ana Lima | 1234 |

Para adicionar operadores, insira diretamente no banco:
```sql
INSERT INTO operadores (nome, pin_hash)
VALUES ('Nome Operador', encode(digest('NOVO_PIN', 'sha256'), 'hex'));
```
