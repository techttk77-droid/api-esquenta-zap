const express = require('express');
const router = express.Router();
const db = require('../services/database');

// GET /api/scheduler
router.get('/', async (req, res) => {
  try {
    res.json(await db.getAllTasks());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scheduler
router.post('/', async (req, res) => {
  try {
    const task = await req.scheduler.addTask(_normalizeTaskBody(req.body));
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/scheduler/:id
router.put('/:id', async (req, res) => {
  try {
    const task = await req.scheduler.updateTask(req.params.id, _normalizeTaskBody(req.body));
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/scheduler/:id
router.delete('/:id', async (req, res) => {
  try {
    await req.scheduler.removeTask(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scheduler/:id/trigger — executa uma tarefa manualmente
router.post('/:id/trigger', async (req, res) => {
  try {
    await req.scheduler.triggerTask(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

/**
 * Normaliza o body enviado pelo frontend:
 * O frontend pode enviar campos como groupId, messagesPerCycle, fromId, etc.
 * diretamente no body. O banco espera que esses campos fiquem dentro de `config`.
 */
function _normalizeTaskBody(body) {
  const { name, type, cronExpression, enabled, config, ...rest } = body;

  // Se `config` já veio preenchido, usa direto; senão monta a partir dos campos extras
  const resolvedConfig = (config && Object.keys(config).length > 0)
    ? config
    : _buildConfig(type, rest);

  return { name, type, cronExpression, enabled, config: resolvedConfig };
}

function _buildConfig(type, fields) {
  switch (type) {
    case 'warm_group':
      return {
        groupId:          fields.groupId          ?? null,
        messagesPerCycle: fields.messagesPerCycle  ?? 3,
      };
    case 'warm_pair':
      return {
        fromId:   fields.fromId   ?? null,
        toId:     fields.toId     ?? null,
        messages: fields.messages ?? 2,
      };
    case 'send_audio':
      return {
        groupId: fields.groupId ?? null,
        audioId: fields.audioId ?? null,
      };
    case 'send_sticker':
      return {
        groupId:   fields.groupId   ?? null,
        stickerId: fields.stickerId ?? null,
      };
    case 'send_reaction':
      return {
        groupId: fields.groupId ?? null,
      };
    default:
      return fields;
  }
}
