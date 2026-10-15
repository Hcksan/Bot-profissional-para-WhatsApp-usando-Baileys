import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import AppError, { badRequest } from "../utils/errors.js";
import logger from "../utils/logger.js";
import { renderTemplate } from "../utils/template.js";
import { applyMapping, exportContacts, guessMapping, parseSpreadsheet } from "../crm/spreadsheet.js";
import { blockCrossSite, describeDevice, securityHeaders } from "./security.js";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

/**
 * Versão dos arquivos do painel (muda a cada atualização). A Cloudflare manda o navegador guardar CSS/JS por horas;
 * com a versão no caminho (/v/<versão>/...), uma atualização nunca mistura HTML novo com CSS/JS antigos.
 * Os import relativos dos módulos herdam o caminho versionado sozinhos.
 */
function assetVersion(dir) {
  const hash = crypto.createHash("sha256");
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else hash.update(entry.name).update(fs.readFileSync(file));
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 12);
}

/**
 * Cria o app Express com a API do CRM e o painel web
 */
export function createApp({ store, crm, wa, runner, auth, config = {}, onSessionsRevoked = () => {} }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ?? "loopback");
  app.use(securityHeaders({ hsts: Boolean(config.cookieSecure) }));
  app.use("/api", blockCrossSite({ publicUrl: config.publicUrl }));
  app.use(["/api/login", "/api/setup", "/api/activation"], express.json({ limit: "4kb" }));
  app.use(express.json({ limit: "25mb" }));

  // ───────────── Login ─────────────
  app.get("/api/session", (req, res) => res.json(auth.status(req)));
  app.post("/api/login", auth.login);
  app.post("/api/setup", auth.setup);
  app.post("/api/activation/verify", auth.verifyActivation);
  app.post("/api/activation/complete", auth.completeActivation);
  app.post("/api/logout", auth.logout);

  const api = express.Router();
  api.use(auth.requireAuth);

  const id = (req) => {
    const value = Number(req.params.id);
    if (!Number.isInteger(value)) throw badRequest("ID inválido");
    return value;
  };

  /**
   * Seleção de contatos usada por campanhas: lista explícita ou filtro (etapa/tag)
   */
  const selectContactIds = ({ contact_ids, stage_id, tag }) => {
    if (Array.isArray(contact_ids) && contact_ids.length > 0) return contact_ids;
    if (!stage_id && !tag) throw badRequest("Escolha os contatos, uma etapa ou uma tag");
    return store.listContacts({ stage_id, tag, include_opted_out: false }).map((contact) => contact.id);
  };

  // ───────────── Visão geral ─────────────
  api.get("/bootstrap", (req, res) => {
    res.json({
      whatsapp: wa.getState(),
      stages: store.listStages(),
      tags: store.listTags(),
      settings: store.getSettings(),
      runtime: runner.runtime(),
      sent_today: store.campaignSentToday(),
    });
  });

  api.get("/dashboard", (req, res) => {
    res.json({ ...store.dashboard(), whatsapp: wa.getState(), settings: store.getSettings(), runtime: runner.runtime() });
  });

  // ───────────── WhatsApp ─────────────
  api.get("/whatsapp", (req, res) => res.json(wa.getState()));
  api.post("/whatsapp/restart", async (req, res) => {
    await wa.restart();
    res.json(wa.getState());
  });
  api.post("/whatsapp/logout", async (req, res) => {
    await wa.logout();
    res.json(wa.getState());
  });
  api.post("/whatsapp/limits", async (req, res) => {
    if (!wa.isConnected()) throw new AppError(409, "Conecte o WhatsApp primeiro");
    res.json(await wa.refreshLimits());
  });

  // ───────────── Etapas ─────────────
  api.get("/stages", (req, res) => res.json(store.listStages()));
  api.post("/stages", (req, res) => res.status(201).json(store.createStage(req.body)));
  api.post("/stages/reorder", (req, res) => {
    if (!Array.isArray(req.body?.ids)) throw badRequest("Lista de etapas inválida");
    res.json(store.reorderStages(req.body.ids));
  });
  api.patch("/stages/:id", (req, res) => res.json(store.updateStage(id(req), req.body)));
  api.delete("/stages/:id", (req, res) => {
    store.deleteStage(id(req));
    res.status(204).end();
  });

  // ───────────── Contatos ─────────────
  api.get("/contacts", (req, res) => res.json(store.listContacts(req.query)));
  api.get("/tags", (req, res) => res.json(store.listTags()));
  api.post("/contacts", (req, res) => res.status(201).json(store.createContact(req.body ?? {})));
  api.get("/contacts/:id", (req, res) => {
    const contact = store.requireContact(id(req));
    res.json({ ...contact, messages: store.listMessages(contact.id) });
  });
  api.patch("/contacts/:id", (req, res) => res.json(store.updateContact(id(req), req.body ?? {})));
  api.delete("/contacts/:id", (req, res) => {
    store.deleteContact(id(req));
    res.status(204).end();
  });
  api.post("/contacts/:id/move", (req, res) => {
    const { stage_id: stageId = null, index } = req.body ?? {};
    res.json(store.moveContact(id(req), stageId, Number.isInteger(index) ? index : undefined));
  });
  api.post("/contacts/:id/send", async (req, res) => {
    if (!wa.isConnected()) throw new AppError(409, "WhatsApp não está conectado");
    res.json(await crm.sendToContact(id(req), req.body?.text, { source: "manual" }));
  });

  // ───────────── Importar / exportar ─────────────
  api.post("/import/preview", (req, res) => {
    const { headers, rows } = parseSpreadsheet(req.body?.data);
    res.json({ headers, sample: rows.slice(0, 5), total: rows.length, mapping: guessMapping(headers) });
  });
  api.post("/import/commit", (req, res) => {
    const { data, mapping, stage_id, tags, update_existing } = req.body ?? {};
    const { rows } = parseSpreadsheet(data);
    const result = store.importContacts(applyMapping(rows, mapping), {
      stage_id: stage_id || null,
      tags: tags ?? [],
      update_existing: update_existing !== false,
    });
    crm.emit("changed", { type: "contacts" });
    res.json(result);
  });
  api.get("/export", (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const contacts = store.listContacts({ stage_id: req.query.stage_id, tag: req.query.tag, q: req.query.q });
    const file = exportContacts(contacts, store.listStages(), format);
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="contatos-${stamp}.${format}"`,
    });
    res.send(file);
  });

  // ───────────── Agendamentos ─────────────
  api.get("/schedules", (req, res) => res.json(store.listSchedules(req.query)));
  api.post("/schedules", (req, res) => res.status(201).json(store.createSchedule(req.body ?? {})));
  api.post("/schedules/:id/cancel", (req, res) => res.json(store.cancelSchedule(id(req))));
  api.delete("/schedules/:id", (req, res) => {
    store.deleteSchedule(id(req));
    res.status(204).end();
  });

  // ───────────── Campanhas ─────────────
  api.get("/campaigns", (req, res) => res.json({ campaigns: store.listCampaigns(), runtime: runner.runtime() }));
  api.post("/campaigns/preview", (req, res) => {
    const message = String(req.body?.message ?? "");
    const contact = req.body?.contact_id ? store.requireContact(req.body.contact_id) : { name: "Maria Silva", phone: "5511987654321" };
    res.json({ samples: [1, 2, 3].map(() => renderTemplate(message, contact)) });
  });
  api.post("/campaigns", (req, res) => {
    const body = req.body ?? {};
    res.status(201).json(store.createCampaign(body, selectContactIds(body)));
  });
  api.get("/campaigns/:id", (req, res) => {
    const campaign = store.getCampaign(id(req));
    res.json({ ...campaign, items: store.listCampaignItems(campaign.id), runtime: runner.runtime() });
  });
  api.patch("/campaigns/:id", (req, res) => res.json(store.updateCampaign(id(req), req.body ?? {})));
  api.post("/campaigns/:id/start", (req, res) => res.json(runner.startCampaign(id(req))));
  api.post("/campaigns/:id/pause", (req, res) => res.json(runner.pauseCampaign(id(req))));
  api.post("/campaigns/:id/cancel", (req, res) => res.json(runner.cancelCampaign(id(req))));
  api.delete("/campaigns/:id", (req, res) => {
    store.deleteCampaign(id(req));
    res.status(204).end();
  });

  // ───────────── Sessões de login (aparelhos conectados ao painel) ─────────────
  api.get("/sessions", (req, res) => {
    res.json(
      store.listWebSessions(req.user.id).map(({ token_hash: hash, ...session }) => ({
        ...session,
        device: describeDevice(session.user_agent),
        current: hash === req.session.token_hash,
      }))
    );
  });
  api.delete("/sessions/:id", (req, res) => {
    const hash = store.deleteWebSessionById(id(req), req.user.id);
    onSessionsRevoked([hash]);
    res.status(204).end();
  });
  api.post("/sessions/revoke-others", (req, res) => {
    const hashes = store.deleteOtherWebSessions(req.user.id, req.session.token_hash);
    onSessionsRevoked(hashes);
    res.json({ closed: hashes.length });
  });

  // ───────────── Minha conta ─────────────
  api.get("/account", (req, res) => res.json(req.user));
  api.post("/account/password", async (req, res) => {
    const hashes = await auth.changePassword(req.session, req.body ?? {});
    onSessionsRevoked(hashes);
    res.json({ ok: true, closed: hashes.length });
  });

  // ───────────── Contas (só administradores) ─────────────
  const admin = express.Router();
  admin.use(auth.accounts.requireAdmin);
  admin.get("/", (req, res) => res.json(store.listUsers().map((user) => ({ ...user, is_me: user.id === req.user.id }))));
  admin.post("/", (req, res) => res.status(201).json(auth.accounts.createUser(req.user, req.body ?? {})));
  admin.post("/:id/activation-code", (req, res) => res.json(auth.accounts.newCode(id(req))));
  admin.patch("/:id", (req, res) => {
    const { user, revoked } = auth.accounts.updateUser(req.user, id(req), req.body ?? {});
    onSessionsRevoked(revoked);
    res.json(user);
  });
  admin.delete("/:id", (req, res) => {
    onSessionsRevoked(auth.accounts.deleteUser(req.user, id(req)));
    res.status(204).end();
  });
  api.use("/users", admin);

  // ───────────── Configurações ─────────────
  api.get("/settings", (req, res) => res.json(store.getSettings()));
  api.patch("/settings", (req, res) => res.json(store.updateSettings(req.body ?? {})));

  app.use("/api", api);
  app.use("/api", (req, res) => res.status(404).json({ error: "Rota não encontrada" }));

  // ───────────── Painel ─────────────
  const version = assetVersion(publicDir);
  const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8").replaceAll("/__V__/", `/v/${version}/`);
  app.get(["/", "/index.html"], (req, res) => res.set("Cache-Control", "no-cache").type("html").send(indexHtml));
  app.use("/v/:version", express.static(publicDir, { index: false, maxAge: "365d", immutable: true }));
  app.use(express.static(publicDir, { index: false }));

  // Erros
  app.use((error, req, res, _next) => {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Arquivo grande demais (máx. 25 MB)" });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Requisição inválida" });
    logger.error("Erro na API:", { path: req.path, message: error.message });
    return res.status(500).json({ error: error.message || "Erro interno" });
  });

  return app;
}

export default createApp;
