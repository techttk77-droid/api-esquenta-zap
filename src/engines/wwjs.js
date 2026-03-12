const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const db = require('../services/database');

/**
 * WWebJSEngine
 * Wraps whatsapp-web.js Client for a single number session.
 * Uses LocalAuth to persist session data between restarts.
 */
class WWebJSEngine {
  constructor(numberId, engineType, io) {
    this.numberId = numberId;
    this.engineType = engineType || 'wwjs';
    this.io = io;
    this.status = 'disconnected';
    this.client = null;
    this._lastMessageIds = new Map(); // track last message per chat for reactions
  }

  async initialize() {
    const sessionPath = path.join(__dirname, '../../sessions', this.numberId);

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.numberId,
        dataPath: sessionPath,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    });

    this.client.on('qr', async (qr) => {
      console.log(`[WWJS ${this.numberId}] QR recebido`);
      this.status = 'qr_pending';
      await db.updateNumberStatus(this.numberId, 'qr_pending');
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.io.emit('number:qr', { id: this.numberId, qr: qrDataUrl, engine: 'wwjs' });
        this.io.emit('number:status', { id: this.numberId, status: 'qr_pending' });
      } catch (e) {
        console.error(`[WWJS ${this.numberId}] Erro ao gerar QR:`, e.message);
      }
    });

    this.client.on('ready', async () => {
      const phone = this.client.info?.wid?.user || null;
      console.log(`[WWJS ${this.numberId}] Conectado! Telefone: ${phone}`);
      this.status = 'connected';
      await db.updateNumberStatus(this.numberId, 'connected', phone);
      this.io.emit('number:status', { id: this.numberId, status: 'connected', phone, engine: 'wwjs' });
      this.io.emit('number:qr_clear', { id: this.numberId });
    });

    this.client.on('authenticated', async () => {
      console.log(`[WWJS ${this.numberId}] Autenticado`);
      this.status = 'authenticated';
      await db.updateNumberStatus(this.numberId, 'authenticated');
      this.io.emit('number:status', { id: this.numberId, status: 'authenticated' });
    });

    this.client.on('auth_failure', async (msg) => {
      console.error(`[WWJS ${this.numberId}] Falha de autenticaÃ§Ã£o:`, msg);
      this.status = 'auth_failure';
      await db.updateNumberStatus(this.numberId, 'auth_failure');
      this.io.emit('number:status', { id: this.numberId, status: 'auth_failure', error: msg });
    });

    this.client.on('disconnected', async (reason) => {
      console.log(`[WWJS ${this.numberId}] Desconectado:`, reason);
      this.status = 'disconnected';
      await db.updateNumberStatus(this.numberId, 'disconnected');
      this.io.emit('number:status', { id: this.numberId, status: 'disconnected', reason });
    });

    this.client.on('message', async (msg) => {
      // Track last message id per chat for reactions
      this._lastMessageIds.set(msg.from, msg.id._serialized);
    });

    await this.client.initialize();
  }

  async sendMessage(toPhone, text) {
    const chatId = await _resolveChatId(this.client, toPhone);
    const msg = await this.client.sendMessage(chatId, text);
    this._lastMessageIds.set(chatId, msg.id._serialized);
    return msg;
  }

  async sendTyping(toPhone, durationMs = 3000) {
    const chatId = await _resolveChatId(this.client, toPhone);
    const chat = await this.client.getChatById(chatId);
    await chat.sendStateTyping();
    await _delay(Math.min(durationMs, 5000));
    await chat.clearState();
  }

  async sendAudio(toPhone, audioPath) {
    const chatId = await _resolveChatId(this.client, toPhone);
    const media = MessageMedia.fromFilePath(audioPath);
    media.mimetype = 'audio/ogg; codecs=opus';
    return this.client.sendMessage(chatId, media, { sendAudioAsVoice: true });
  }

  async sendSticker(toPhone, stickerPath) {
    const chatId = await _resolveChatId(this.client, toPhone);
    const media = MessageMedia.fromFilePath(stickerPath);
    return this.client.sendMessage(chatId, media, { sendMediaAsSticker: true });
  }

  async sendReaction(toPhone, emoji) {
    const chatId = await _resolveChatId(this.client, toPhone);
    const msgId = this._lastMessageIds.get(chatId);
    if (!msgId) return;
    const msg = await this.client.getMessageById(msgId);
    if (msg && msg.react) {
      await msg.react(emoji);
    }
  }

  async destroy() {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    this.status = 'disconnected';
  }
}

async function _resolveChatId(client, phone) {
  const digits = phone.replace(/\D/g, '');
  // Tenta resolver via getNumberId (suporta LID do WhatsApp novo)
  try {
    const numberId = await client.getNumberId(digits);
    if (numberId) return numberId._serialized;
  } catch (e) {
    // fallback
  }
  // Fallback para o formato legado @c.us
  return digits.includes('@') ? phone : `${digits}@c.us`;
}

function _formatChatId(phone) {
  // Remove non-digits and add @c.us suffix
  const digits = phone.replace(/\D/g, '');
  return digits.includes('@') ? phone : `${digits}@c.us`;
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { WWebJSEngine };


