import { SourceError } from './sources';

/** A refused action, with a sentence the caller (the screen, the agent) can read. */
export class FilaError extends SourceError {
  constructor(status: number, message: string) { super(status); this.message = message; }
}
