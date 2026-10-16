// Bump when cached rows lack data the server won't resend: a mismatch clears the rows and the sync
// cursor, so the next fetch is a full snapshot. 3: submitted prompts keep canonical media.
export const REPLICA_ROW_STORE_SCHEMA_VERSION = 3;

export const REPLICA_SINGLETON_ROW_ID = "singleton";
