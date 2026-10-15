/**
 * Estado compartilhado entre as telas (preenchido por /api/bootstrap)
 */
export const state = {
  // Conta logada: { id, name, email }
  user: null,
  whatsapp: null,
  stages: [],
  tags: [],
  settings: {},
  runtime: {},
  sent_today: 0,
  // Contatos marcados na tela "Contatos" para criar uma campanha
  selection: new Set(),
};

/**
 * Recarrega o estado global (etapas, tags, status). Definido em main.js.
 */
export const hooks = {
  reload: async () => {},
};

export const stageById = (id) => state.stages.find((stage) => stage.id === Number(id)) ?? null;
