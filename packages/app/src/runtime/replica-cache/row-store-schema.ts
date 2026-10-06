// Bump when cached rows lack data the server won't resend: a mismatch clears the rows and the sync
// cursor, so the next fetch is a full snapshot. 2: agents keep runtimeInfo and lastUsage.
export const REPLICA_ROW_STORE_SCHEMA_VERSION = 2;

export const REPLICA_SINGLETON_ROW_ID = "singleton";
