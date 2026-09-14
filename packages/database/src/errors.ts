export class PersistenceNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'PersistenceNotFoundError';
  }
}

export class PersistenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConflictError';
  }
}

export class PersistenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceIntegrityError';
  }
}
