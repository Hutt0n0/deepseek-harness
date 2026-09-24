/**
 * Client-namespace projection of the board domain: a pure re-export of the
 * package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline); `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @dsh-redteam/dsh-session-board/client
 */
export type * from './types.ts'
