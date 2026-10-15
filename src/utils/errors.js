/**
 * Erro com status HTTP, usado para validações que devem chegar ao usuário
 */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export const badRequest = (message) => new AppError(400, message);
export const notFound = (message = "Registro não encontrado") => new AppError(404, message);
export const conflict = (message) => new AppError(409, message);

export default AppError;
