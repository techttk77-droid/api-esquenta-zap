const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../services/database');

const audioStorage = multer.diskStorage({
  destination: path.join(__dirname, '../../audios'),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${file.originalname}`;
    cb(null, unique);
  },
});

const stickerStorage = multer.diskStorage({
  destination: path.join(__dirname, '../../stickers'),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${file.originalname}`;
    cb(null, unique);
  },
});

const uploadAudio = multer({ storage: audioStorage });
const uploadSticker = multer({ storage: stickerStorage });

// GET /api/media?type=audio|sticker
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    res.json(await db.getAllMedia(type || null));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/audio
router.post('/audio', uploadAudio.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'audio',
      filename: req.file.filename,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/sticker
router.post('/sticker', uploadSticker.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'sticker',
      filename: req.file.filename,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/media/:id
router.delete('/:id', async (req, res) => {
  try {
    const media = await db.getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Mídia não encontrada' });

    const folder = media.type === 'audio' ? 'audios' : 'stickers';
    const filePath = path.join(__dirname, `../../${folder}`, media.filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await db.deleteMedia(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
