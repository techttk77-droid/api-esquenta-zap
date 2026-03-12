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
    const task = await req.scheduler.addTask(req.body);
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/scheduler/:id
router.put('/:id', async (req, res) => {
  try {
    const task = await req.scheduler.updateTask(req.params.id, req.body);
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
