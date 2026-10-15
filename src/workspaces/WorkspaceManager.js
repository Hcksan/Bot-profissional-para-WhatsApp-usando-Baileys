import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { openDatabase } from "../db/database.js";
import { CrmStore } from "../crm/CrmStore.js";
import { CrmService } from "../crm/CrmService.js";
import { Scheduler } from "../crm/Scheduler.js";
import { CampaignRunner } from "../crm/CampaignRunner.js";
import WhatsAppService from "../services/WhatsAppService.js";
import logger from "../utils/logger.js";

/**
 * Espaços do CRM: cada conta trabalha no seu, com contatos, Kanban, campanhas, agendamentos,
 * configurações e número de WhatsApp separados (um banco SQLite e uma sessão do WhatsApp por espaço).
 *
 * O banco principal guarda as contas e a lista de espaços. O espaço 1 usa o próprio banco principal
 * e a sessão "auth", que é onde tudo ficava antes dos espaços existirem: nada muda para quem já usava.
 *
 * Eventos (todos com o id do espaço primeiro): "whatsapp" (estado), "changed" ({ type }), "campaign" (campanha)
 */
export class WorkspaceManager extends EventEmitter {
  constructor({
    mainDb,
    mainStore,
    dataDir,
    sessionsDir = "./sessions",
    commandsEnabled = true,
    now = Date.now,
    createWhatsApp = (options) => new WhatsAppService({ commandsEnabled, ...options }),
  }) {
    super();
    this.mainDb = mainDb;
    this.mainStore = mainStore;
    this.dataDir = dataDir;
    this.sessionsDir = sessionsDir;
    this.now = now;
    this.createWhatsApp = createWhatsApp;
    this.runtimes = new Map();
    this.started = false;

    // Espaço 1: os dados e o WhatsApp que já existiam
    if (!this.mainStore.getWorkspace(1)) {
      const first = this.mainStore.listUsers()[0];
      this.mainStore.createWorkspace({ id: 1, name: first?.name ?? "Principal", dbFile: "crm.db", sessionDir: "auth" });
    }
    this.mainStore.assignUsersWithoutWorkspace(1);
    for (const record of this.mainStore.listWorkspaces()) this.load(record);
  }

  /**
   * Abre o banco e cria os serviços de um espaço
   */
  load(record) {
    const isMain = record.db_file === "crm.db";
    const db = isMain ? this.mainDb : openDatabase(path.join(this.dataDir, record.db_file));
    const store = isMain ? this.mainStore : new CrmStore(db, { now: this.now });
    const wa = this.createWhatsApp({
      sessionPath: path.join(this.sessionsDir, record.session_dir),
      label: `espaço ${record.id}`,
      printQr: record.id === 1,
    });
    const crm = new CrmService({ store, wa });
    const scheduler = new Scheduler({ store, crm, wa, now: this.now });
    const runner = new CampaignRunner({ store, crm, wa, now: this.now });
    const runtime = { id: record.id, name: record.name, isMain, db, store, wa, crm, scheduler, runner };

    const safely = (fn) => {
      try {
        fn();
      } catch (error) {
        logger.error(`[espaço ${record.id}] Erro ao processar evento:`, { message: error.message });
      }
    };
    wa.on("status", (state) => {
      this.emit("whatsapp", record.id, state);
      // Assim que conectar, dispara o que ficou pendente
      if (state.status === "open") setTimeout(() => scheduler.tick().catch(() => {}), 5000);
    });
    wa.on("incoming", (message) => safely(() => crm.handleIncoming(message)));
    wa.on("outgoing", (message) => safely(() => crm.handleOutgoing(message)));
    crm.on("changed", (change) => this.emit("changed", record.id, change));
    scheduler.on("changed", () => this.emit("changed", record.id, { type: "schedules" }));
    runner.on("progress", (campaign) => {
      this.emit("campaign", record.id, campaign);
      this.emit("changed", record.id, { type: "contacts" });
    });

    this.runtimes.set(record.id, runtime);
    if (this.started) this.startOne(runtime);
    return runtime;
  }

  startOne(runtime) {
    runtime.scheduler.start();
    runtime.runner.start();
    // Só conecta quem já leu o QR Code alguma vez (o espaço 1 sempre, como antes). Os outros conectam pelo painel.
    if (runtime.id === 1 || runtime.wa.hasSession()) runtime.wa.connect().catch(() => {});
  }

  async start() {
    this.started = true;
    for (const runtime of this.runtimes.values()) this.startOne(runtime);
  }

  get(id) {
    return this.runtimes.get(Number(id)) ?? null;
  }

  forUser(user) {
    return user ? this.get(user.workspace_id) : null;
  }

  /**
   * Cria um espaço novo e vazio (com as etapas padrão do Kanban). O WhatsApp conecta quando a pessoa pedir.
   */
  create(name) {
    const record = this.mainStore.createWorkspace({ name });
    logger.info(`🗂️ Espaço ${record.id} criado (${record.name})`);
    return this.load(record).id;
  }

  /**
   * Desliga um espaço que ficou sem contas: desconecta o aparelho do WhatsApp e guarda os arquivos em data/removidos
   */
  async archive(id) {
    const runtime = this.get(id);
    if (!runtime || runtime.isMain) return;
    runtime.scheduler.stop();
    runtime.runner.stop();
    await runtime.wa.unlink().catch(() => {});
    runtime.db.close();
    this.runtimes.delete(runtime.id);
    this.mainStore.archiveWorkspace(runtime.id);

    const record = this.mainStore.getWorkspace(runtime.id);
    const stamp = new Date(this.now()).toISOString().slice(0, 10);
    const removedDir = path.join(this.dataDir, "removidos");
    fs.mkdirSync(removedDir, { recursive: true, mode: 0o700 });
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = path.join(this.dataDir, `${record.db_file}${suffix}`);
      if (fs.existsSync(file)) fs.renameSync(file, path.join(removedDir, `ws-${record.id}-${stamp}.db${suffix}`));
    }
    fs.rmSync(path.join(this.sessionsDir, record.session_dir), { recursive: true, force: true });
    logger.info(`🗂️ Espaço ${record.id} arquivado em ${removedDir}`);
  }

  /**
   * Encerra tudo sem desconectar os aparelhos (na próxima vez não precisa ler o QR Code de novo)
   */
  async stop() {
    for (const runtime of this.runtimes.values()) {
      runtime.scheduler.stop();
      runtime.runner.stop();
      await runtime.wa.disconnect().catch(() => {});
      if (!runtime.isMain) runtime.db.close();
    }
  }
}

export default WorkspaceManager;
