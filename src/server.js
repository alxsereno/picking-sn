require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const authRouter    = require('./routes/auth');
const pedidosRouter = require('./routes/pedidos');
const webhookRouter = require('./routes/webhook');
const gestaoRouter  = require('./routes/gestao');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Segurança ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "'unsafe-eval'",
                      "unpkg.com", "*.unpkg.com",
                      "cdn.jsdelivr.net", "*.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:       ["'self'", "fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:", "blob:"],
      mediaSrc:      ["'self'", "blob:"],
      connectSrc:    ["'self'",
                      "unpkg.com", "*.unpkg.com",
                      "cdn.jsdelivr.net", "*.jsdelivr.net"],
      workerSrc:     ["'self'", "blob:"],
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [/\.up\.railway\.app$/, /simplesenaturalcps\.com\.br$/]
    : '*',
  methods: ['GET','POST','PUT','PATCH'],
  allowedHeaders: ['Content-Type','Authorization','x-webhook-secret']
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const webhookLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 60 });
app.use(limiter);

app.use(express.json({ limit: '1mb' }));

// ── Rotas da API ─────────────────────────────────────────────
app.use('/api/auth',    authRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/webhook', webhookLimiter, webhookRouter);
app.use('/api/gestao',  gestaoRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', versao: '1.0.0', ts: new Date() });
});

// ── Serve o PWA ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Picking SN rodando na porta ${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
