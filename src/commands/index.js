/**
 * Gerenciador central de comandos
 */
class CommandManager {
  constructor() {
    this.commands = new Map();
    this.prefix = "!";
  }

  /**
   * Registra um novo comando
   * @param {string} name - Nome do comando
   * @param {Function} handler - Função handler do comando
   * @param {Object} options - Opções do comando
   */
  register(name, handler, options = {}) {
    this.commands.set(name.toLowerCase(), {
      name,
      handler,
      description: options.description || "Sem descrição",
      usage: options.usage || `${this.prefix}${name}`,
      permissions: options.permissions || [],
      category: options.category || "geral",
    });
  }

  /**
   * Obtém um comando pelo nome
   * @param {string} name - Nome do comando
   * @returns {Object|null}
   */
  get(name) {
    return this.commands.get(name.toLowerCase()) || null;
  }

  /**
   * Lista todos os comandos
   * @returns {Array}
   */
  list() {
    return Array.from(this.commands.values());
  }

  /**
   * Lista comandos por categoria
   * @param {string} category - Categoria dos comandos
   * @returns {Array}
   */
  listByCategory(category) {
    return this.list().filter((cmd) => cmd.category === category);
  }

  /**
   * Verifica se uma mensagem é um comando
   * @param {string} text - Texto da mensagem
   * @returns {boolean}
   */
  isCommand(text) {
    return text.trim().startsWith(this.prefix);
  }

  /**
   * Extrai o comando e argumentos de uma mensagem
   * @param {string} text - Texto da mensagem
   * @returns {Object}
   */
  parse(text) {
    const cleanText = text.trim();
    if (!this.isCommand(cleanText)) {
      return null;
    }

    const parts = cleanText.slice(this.prefix.length).split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    return {
      command: commandName,
      args,
      fullCommand: cleanText,
    };
  }

  /**
   * Executa um comando
   * @param {string} commandName - Nome do comando
   * @param {Object} context - Contexto de execução
   * @returns {Promise<any>}
   */
  async execute(commandName, context) {
    const command = this.get(commandName);
    
    if (!command) {
      throw new Error(`Comando "${commandName}" não encontrado`);
    }

    // Aqui você pode adicionar validações de permissão, rate limiting, etc.
    
    return await command.handler(context);
  }
}

export default new CommandManager();
