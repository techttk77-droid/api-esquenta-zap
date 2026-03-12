const express = require('express');
const router = express.Router();
const db = require('../services/database');

// GET /api/numbers
router.get('/', async (req, res) => {
  try {
    const numbers = await db.getAllNumbers();
    const statuses = req.sessionManager.getStatuses();
    const result = numbers.map((n) => ({
      ...n,
      live_status: statuses[n.id] || n.status,
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/numbers — cria um novo slot de número
router.post('/', async (req, res) => {
  try {
    const { name, phone, engine, autoReconnect } = req.body;

    // Seleciona engine automaticamente com base no threshold
    const settings = await db.getSettings();
    const threshold = parseInt(settings.engine_threshold || '10');
    const allNumbers = await db.getAllNumbers();
    const selectedEngine = engine || (allNumbers.length >= threshold ? 'baileys' : 'wwjs');

    const number = await db.createNumber({ name, phone, engine: selectedEngine, autoReconnect });
    res.json(number);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/numbers/:id/status — retorna status ao vivo + último erro da sessão
router.get('/:id/status', async (req, res) => {
  try {
    const session = req.sessionManager.getSession(req.params.id);
    const number = await db.getNumberById(req.params.id);
    res.json({
      id: req.params.id,
      db_status: number?.status,
      live_status: session?.status || 'no_session',
      engine: session?.engineType || number?.engine,
      lastError: session?.lastError || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/numbers/:id/connect
router.post('/:id/connect', async (req, res) => {
  try {
    await req.sessionManager.connectNumber(req.params.id);
    res.json({ success: true, message: 'Connecting... QR will appear shortly.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/numbers/:id/disconnect
router.post('/:id/disconnect', async (req, res) => {
  try {
    await req.sessionManager.disconnectNumber(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/numbers/:id/switch-engine
router.post('/:id/switch-engine', async (req, res) => {
  const { engine } = req.body;
  if (!['wwjs', 'baileys'].includes(engine)) {
    return res.status(400).json({ error: 'Invalid engine. Use "wwjs" or "baileys".' });
  }
  try {
    await req.sessionManager.switchEngine(req.params.id, engine);
    res.json({ success: true, engine });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/numbers/:id
router.delete('/:id', async (req, res) => {
  try {
    await req.sessionManager.disconnectNumber(req.params.id).catch(() => {});
    await db.deleteNumber(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/numbers/:id/send-text — mensagem manual para testes
router.post('/:id/send-text', async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'to e text são obrigatórios' });
  try {
    await req.sessionManager.sendText(req.params.id, to, text);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/numbers/logs/recent
router.get('/logs/recent', async (req, res) => {
  try {
    const logs = await db.getRecentLogs(parseInt(req.query.limit) || 100);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
