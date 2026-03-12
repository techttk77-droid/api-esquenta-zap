const { PrismaClient } = require('@prisma/client');

/**
 * DatabaseService
 *
 * Singleton que encapsula todas as operações Prisma do sistema.
 * Use `DatabaseService.getInstance()` para obter a instância única,
 * ou simplesmente faça `require('./database')` — o módulo já exporta
 * a instância pronta.
 */
class DatabaseService {
  static #instance = null;

  /** @type {PrismaClient} */
  #prisma;

  constructor() {
    this.#prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  /** @returns {DatabaseService} */
  static getInstance() {
    if (!DatabaseService.#instance) {
      DatabaseService.#instance = new DatabaseService();
    }
    return DatabaseService.#instance;
  }

  get prisma() {
    return this.#prisma;
  }

  async connect() {
    await this.#prisma.$connect();
    await this.#seedDefaultSettings();
    console.log('[DB] Conectado ao PostgreSQL via Prisma');
  }

  async disconnect() {
    await this.#prisma.$disconnect();
  }

  async #seedDefaultSettings() {
    const defaults = [
      { key: 'min_delay_ms',      value: '5000'  },
      { key: 'max_delay_ms',      value: '15000' },
      { key: 'engine_threshold',  value: '10'    },
      { key: 'default_engine',    value: 'wwjs'  },
      { key: 'daily_msg_limit',   value: '50'    },
      { key: 'typing_simulation', value: '1'     },
    ];
    for (const s of defaults) {
      await this.#prisma.setting.upsert({
        where:  { key: s.key },
        update: {},
        create: s,
      });
    }
  }

  // --- Numbers ---------------------------------------------------------------

  async getAllNumbers() {
    return this.#prisma.number.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async getNumberById(id) {
    return this.#prisma.number.findUnique({ where: { id } });
  }

  async createNumber({ name, phone, engine, autoReconnect }) {
    return this.#prisma.number.create({
      data: {
        name:          name          ?? null,
        phone:         phone         ?? null,
        engine:        engine        ?? 'wwjs',
        autoReconnect: autoReconnect ?? true,
      },
    });
  }

  async updateNumberStatus(id, status, phone = null) {
    return this.#prisma.number.update({
      where: { id },
      data: {
        status,
        ...(phone ? { phone, lastConnected: new Date() } : {}),
      },
    });
  }

  async updateNumberEngine(id, engine) {
    return this.#prisma.number.update({ where: { id }, data: { engine } });
  }

  async updateNumberLastActivity(id) {
    return this.#prisma.number.update({
      where: { id },
      data:  { lastActivity: new Date() },
    });
  }

  /**
   * Retorna números conectados cuja última atividade (ou conexão) é anterior ao threshold.
   * Usado para expirar sessões inativas após N dias.
   */
  async getExpiredSessions(thresholdDate) {
    return this.#prisma.number.findMany({
      where: {
        status: 'connected',
        OR: [
          { lastActivity:  { lt: thresholdDate } },
          { lastActivity:  null, lastConnected: { lt: thresholdDate } },
          { lastActivity:  null, lastConnected: null },
        ],
      },
    });
  }

  async deleteNumber(id) {
    return this.#prisma.number.delete({ where: { id } });
  }

  // --- Groups ----------------------------------------------------------------

  async getAllGroups() {
    return this.#prisma.group.findMany({
      orderBy: { createdAt: 'asc' },
      include: { members: { include: { number: true } } },
    });
  }

  async getGroupById(id) {
    return this.#prisma.group.findUnique({
      where: { id },
      include: { members: { include: { number: true } } },
    });
  }

  async createGroup(name) {
    return this.#prisma.group.create({
      data: { name },
      include: { members: { include: { number: true } } },
    });
  }

  async addMemberToGroup(groupId, numberId) {
    return this.#prisma.groupMember.upsert({
      where:  { groupId_numberId: { groupId, numberId } },
      update: {},
      create: { groupId, numberId },
    });
  }

  async removeMemberFromGroup(groupId, numberId) {
    return this.#prisma.groupMember.delete({
      where: { groupId_numberId: { groupId, numberId } },
    });
  }

  async deleteGroup(id) {
    return this.#prisma.group.delete({ where: { id } });
  }

  // --- Conversation Logs -----------------------------------------------------

  async logConversation(fromNumberId, toNumberId, message, type = 'text') {
    return this.#prisma.conversationLog.create({
      data: { fromNumberId, toNumberId, message, type },
    });
  }

  async getRecentLogs(limit = 100) {
    return this.#prisma.conversationLog.findMany({
      take:    limit,
      orderBy: { sentAt: 'desc' },
      include: {
        fromNumber: { select: { id: true, name: true, phone: true } },
        toNumber:   { select: { id: true, name: true, phone: true } },
      },
    });
  }

  // --- Scheduled Tasks -------------------------------------------------------

  async getAllTasks() {
    return this.#prisma.scheduledTask.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async getTaskById(id) {
    return this.#prisma.scheduledTask.findUnique({ where: { id } });
  }

  async createTask({ name, type, cronExpression, enabled, config }) {
    return this.#prisma.scheduledTask.create({
      data: {
        name,
        type,
        cronExpression,
        enabled: enabled ?? true,
        config:  config  ?? {},
      },
    });
  }

  async updateTask(id, { name, type, cronExpression, enabled, config }) {
    return this.#prisma.scheduledTask.update({
      where: { id },
      data:  { name, type, cronExpression, enabled, config: config ?? {} },
    });
  }

  async updateTaskLastRun(id) {
    return this.#prisma.scheduledTask.update({
      where: { id },
      data:  { lastRun: new Date() },
    });
  }

  async deleteTask(id) {
    return this.#prisma.scheduledTask.delete({ where: { id } });
  }

  // --- Settings --------------------------------------------------------------

  async getSettings() {
    const rows = await this.#prisma.setting.findMany();
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  async setSetting(key, value) {
    return this.#prisma.setting.upsert({
      where:  { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
  }

  // --- Media -----------------------------------------------------------------

  async getAllMedia(type = null) {
    return this.#prisma.mediaFile.findMany({
      where:   type ? { type } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMediaById(id) {
    return this.#prisma.mediaFile.findUnique({ where: { id } });
  }

  async createMedia({ name, type, filename }) {
    return this.#prisma.mediaFile.create({
      data: { name, type, filename },
    });
  }

  async deleteMedia(id) {
    return this.#prisma.mediaFile.delete({ where: { id } });
  }
}

module.exports = DatabaseService.getInstance();