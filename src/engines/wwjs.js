const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
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
    this.lastQr = null; // cached QR data URL for re-emission
    this._destroyed = false;
    this._sessionPath = path.join(__dirname, '../../sessions', numberId);
    this._lastMessageIds = new Map(); // track last message per chat for reactions
  }

  async initialize() {
    this._destroyed = false;
    const sessionPath = this._sessionPath;

    // Tenta encontrar Chromium em múltiplos caminhos
    const getPuppeteerPath = () => {
      const fs = require('fs');
      const { execSync } = require('child_process');

      const isAccessible = (p) => {
        try { fs.accessSync(p); return true; } catch { return false; }
      };

      // 1. Variável de ambiente (prioritário) — valida se o caminho existe
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH.trim();
        if (isAccessible(envPath)) {
          console.log(`[WWJS] Chromium via env: ${envPath}`);
          return envPath;
        }
        console.warn(`[WWJS] PUPPETEER_EXECUTABLE_PATH inválido: "${envPath}" — tentando outros caminhos...`);
      }

      // 2. Busca dinâmica via 'which' (funciona com PATH do nixpacks/Railway)
      try {
        const found = execSync(
          'which chromium || which chromium-browser || which google-chrome-stable || which google-chrome',
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
        ).trim().split('\n')[0];
        if (found && isAccessible(found)) {
          console.log(`[WWJS] Chromium via which: ${found}`);
          return found;
        }
      } catch {}

      // 3. Caminhos estáticos comuns em produção
      const staticPaths = [
        '/run/current-system/sw/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
      ];
      for (const p of staticPaths) {
        if (isAccessible(p)) {
          console.log(`[WWJS] Chromium via path estático: ${p}`);
          return p;
        }
      }

      // 4. Deixa Puppeteer procurar automaticamente
      console.warn('[WWJS] Chromium não encontrado — deixando Puppeteer decidir.');
      return undefined;
    };

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.numberId,
        dataPath: sessionPath,
      }),
      puppeteer: {
        headless: true,
        executablePath: getPuppeteerPath(),
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
        this.lastQr = qrDataUrl; // cache para re-envio
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
      this.lastQr = null; // limpa QR cacheado
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
      console.error(`[WWJS ${this.numberId}] Falha de autenticação:`, msg);
      this.status = 'auth_failure';
      await db.updateNumberStatus(this.numberId, 'auth_failure');
      this.io.emit('number:status', { id: this.numberId, status: 'auth_failure', error: msg });

      if (!this._destroyed) {
        // Limpa sessão corrompida/expirada e reinicia para gerar novo QR
        console.log(`[WWJS ${this.numberId}] Limpando sessão e reiniciando para gerar novo QR...`);
        await this.destroy().catch(() => {});
        this._clearSessionFolder();
        setTimeout(() => {
          if (!this._destroyed) this.initialize().catch(console.error);
        }, 3000);
      }
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
    this._destroyed = true;
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    this.status = 'disconnected';
  }

  _clearSessionFolder() {
    try {
      // Remove toda a pasta de sessão para forçar novo QR na próxima conexão
      if (fs.existsSync(this._sessionPath)) {
        fs.rmSync(this._sessionPath, { recursive: true, force: true });
        console.log(`[WWJS ${this.numberId}] Pasta de sessão removida: ${this._sessionPath}`);
      }
    } catch (e) {
      console.warn(`[WWJS ${this.numberId}] Erro ao remover sessão:`, e.message);
    }
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


