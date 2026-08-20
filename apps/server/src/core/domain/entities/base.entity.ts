/**
 * Common identity for domain entities.
 *
 * Entities are IMMUTABLE: a mutation returns a new instance rather than
 * changing this one. That makes state transitions explicit at the call site
 * (`conversation.end()` obviously produces something) and removes a whole
 * class of bug where a service mutates an object another caller still holds.
 */
export abstract class BaseEntity {
  protected constructor(public readonly id: string) {}

  /** Entities are equal when their identities match, not their fields. */
  public equals(other: BaseEntity): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}
