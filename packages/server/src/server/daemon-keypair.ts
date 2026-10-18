import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type pino from "pino";

import {
  generateKeyPair,
  exportPublicKey,
  exportSecretKey,
  importPublicKey,
  importSecretKey,
  type KeyPair,
} from "@getpaseo/relay/e2ee";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

const KeyPairSchema = z.object({
  v: z.literal(2),
  publicKeyB64: z.string().min(1),
  secretKeyB64: z.string().min(1),
  createdAt: z.string().optional(),
});

type StoredKeyPair = z.infer<typeof KeyPairSchema>;

const KEYPAIR_FILENAME = "daemon-keypair.json";

export interface DaemonKeyPairBundle {
  keyPair: KeyPair;
  publicKeyB64: string;
  createdAt: string;
}

export async function loadOrCreateDaemonKeyPair(
  paseoHome: string,
  logger?: pino.Logger,
): Promise<DaemonKeyPairBundle> {
  const log = logger?.child({ module: "daemon-keypair" });
  const filePath = path.join(paseoHome, KEYPAIR_FILENAME);

  if (existsSync(filePath)) {
    try {
      ensurePrivateFile(filePath);
      const raw = readFileSync(filePath, "utf8");
      const parsed = KeyPairSchema.parse(JSON.parse(raw));

      const publicKey = importPublicKey(parsed.publicKeyB64);
      const secretKey = importSecretKey(parsed.secretKeyB64);
      const publicKeyB64 = exportPublicKey(publicKey);

      log?.info({ filePath }, "Loaded daemon keypair");
      return {
        keyPair: { publicKey, secretKey },
        publicKeyB64,
        // Keypairs saved before createdAt existed fall back to the file's mtime.
        createdAt: parsed.createdAt ?? statSync(filePath).mtime.toISOString(),
      };
    } catch (error) {
      log?.warn({ err: error, filePath }, "Failed to load daemon keypair, regenerating");
    }
  }

  return writeNewDaemonKeyPair(filePath, log);
}

/** Replaces the daemon keypair. Clients paired with the old public key can no longer connect. */
export function rotateDaemonKeyPair(paseoHome: string, logger?: pino.Logger): DaemonKeyPairBundle {
  const log = logger?.child({ module: "daemon-keypair" });
  return writeNewDaemonKeyPair(path.join(paseoHome, KEYPAIR_FILENAME), log);
}

function writeNewDaemonKeyPair(filePath: string, log?: pino.Logger): DaemonKeyPairBundle {
  const keyPair = generateKeyPair();
  const publicKeyB64 = exportPublicKey(keyPair.publicKey);
  const secretKeyB64 = exportSecretKey(keyPair.secretKey);
  const createdAt = new Date().toISOString();

  const payload: StoredKeyPair = {
    v: 2,
    publicKeyB64,
    secretKeyB64,
    createdAt,
  };

  writePrivateFileAtomicSync(filePath, JSON.stringify(payload, null, 2) + "\n");
  log?.info({ filePath }, "Saved daemon keypair");

  return { keyPair, publicKeyB64, createdAt };
}
