import { AppError } from "../core/app-error";
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes
} from "../core/crypto";
import type { Env } from "./env";

/**
 * Anwendungsseitige Verschluesselung der MATOOL-Nutzlasten in D1.
 *
 * D1 verschluesselt selbst nur auf Datentraegerebene. Wer Zugriff auf das
 * Cloudflare-Konto, einen D1-API-Token, einen Export oder ein Backup hat,
 * saehe sonst jede IBAN im Klartext. Deshalb liegt jede Nutzlast als
 * AES-256-GCM-Chiffrat vor; der Schluessel existiert nur als Cloudflare
 * Secret und laesst sich dort nicht mehr auslesen.
 *
 * Format: enc:v1:<schluessel-id>:<iv>:<chiffrat+tag>, IV und Chiffrat
 * base64url. Die Additional Authenticated Data binden das Chiffrat an
 * Bereich und Quellkennung: In eine fremde Zeile kopiert, laesst es sich
 * nicht mehr entschluesseln.
 */

const STORED_PAYLOAD_VERSION_PREFIX = "enc:v1:";
const KEY_ID_BITS = 64;
const IV_BYTES = 12;
const MIN_KEY_SECRET_LENGTH = 32;
const HKDF_SALT = "matool-middleware-hub/stored-payload";
const STORED_PAYLOAD_PATTERN =
  /^enc:v1:([0-9a-f]{16}):([A-Za-z0-9_-]{16}):([A-Za-z0-9_-]+)$/u;

/** Laenge des Kopfes "enc:v1:<schluessel-id>:" jeder versiegelten Nutzlast. */
export const STORED_PAYLOAD_HEADER_LENGTH =
  STORED_PAYLOAD_VERSION_PREFIX.length + KEY_ID_BITS / 4 + 1;

export interface StoredPayloadContext {
  area: string;
  sourceId: string;
}

export interface StoredPayloadCipher {
  /**
   * Kopf jeder mit dem aktuellen Schluessel versiegelten Nutzlast; null,
   * solange kein Schluessel gesetzt ist.
   */
  readonly currentHeader: string | null;
  seal(context: StoredPayloadContext, plaintext: string): Promise<string>;
  /** Liefert Altbestand ohne Verschluesselung unveraendert zurueck. */
  open(context: StoredPayloadContext, stored: string): Promise<string>;
}

interface PayloadKey {
  header: string;
  id: string;
  key: CryptoKey;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");
const derivedKeys = new Map<string, Promise<PayloadKey>>();

export async function storedPayloadCipher(
  env: Env
): Promise<StoredPayloadCipher> {
  const current = await optionalPayloadKey(
    env.DATA_ENCRYPTION_KEY,
    "DATA_ENCRYPTION_KEY"
  );
  const previous = await optionalPayloadKey(
    env.DATA_ENCRYPTION_KEY_PREVIOUS,
    "DATA_ENCRYPTION_KEY_PREVIOUS"
  );
  const readableKeys = [current, previous].filter(
    (key): key is PayloadKey => key !== null
  );
  const required = env.DATA_ENCRYPTION_REQUIRED === "true";

  return {
    currentHeader: current?.header ?? null,

    async seal(context, plaintext) {
      if (!current) {
        if (required) {
          throw new AppError(
            "data_encryption_not_configured",
            503,
            "Personendaten werden nur verschluesselt gespeichert, aber DATA_ENCRYPTION_KEY ist nicht als Cloudflare Secret gesetzt."
          );
        }
        return plaintext;
      }

      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: associatedData(context)
        },
        current.key,
        encoder.encode(plaintext)
      );
      return `${current.header}${base64UrlEncodeBytes(iv)}:${base64UrlEncodeBytes(
        new Uint8Array(ciphertext)
      )}`;
    },

    async open(context, stored) {
      // Nutzlasten sind JSON-Objekte; nur versiegelte Werte beginnen so.
      if (!stored.startsWith("enc:")) {
        return stored;
      }

      const match = STORED_PAYLOAD_PATTERN.exec(stored);
      const key = match
        ? readableKeys.find((candidate) => candidate.id === match[1])
        : undefined;
      if (!match?.[2] || !match[3] || !key) {
        throw storedPayloadUnreadable();
      }

      try {
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: base64UrlDecodeBytes(match[2]),
            additionalData: associatedData(context)
          },
          key.key,
          base64UrlDecodeBytes(match[3])
        );
        return decoder.decode(plaintext);
      } catch {
        throw storedPayloadUnreadable();
      }
    }
  };
}

function associatedData(context: StoredPayloadContext): Uint8Array {
  return encoder.encode(
    `matool-snapshot/v1\u0000${context.area}\u0000${context.sourceId}`
  );
}

async function optionalPayloadKey(
  secret: string | undefined,
  name: string
): Promise<PayloadKey | null> {
  if (secret === undefined || secret.length === 0) {
    return null;
  }
  if (secret.length < MIN_KEY_SECRET_LENGTH) {
    throw new AppError(
      "data_encryption_key_invalid",
      503,
      `${name} muss mindestens ${MIN_KEY_SECRET_LENGTH} Zeichen lang sein.`
    );
  }

  let derived = derivedKeys.get(secret);
  if (!derived) {
    derived = derivePayloadKey(secret);
    derivedKeys.set(secret, derived);
  }
  return derived;
}

/**
 * Das Secret ist ein beliebig langer Zufallstext aus dem Passwortmanager.
 * HKDF-SHA-256 macht daraus einen AES-256-Schluessel und, getrennt davon,
 * eine Schluessel-ID, die nichts ueber den Schluessel verraet.
 */
async function derivePayloadKey(secret: string): Promise<PayloadKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveBits", "deriveKey"]
  );
  const salt = encoder.encode(HKDF_SALT);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("aes-256-gcm/v1")
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const idBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("key-id/v1")
    },
    material,
    KEY_ID_BITS
  );
  const id = Array.from(new Uint8Array(idBits), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return {
    header: `${STORED_PAYLOAD_VERSION_PREFIX}${id}:`,
    id,
    key
  };
}

function storedPayloadUnreadable(): AppError {
  return new AppError(
    "stored_payload_unreadable",
    503,
    "Gespeicherte Daten lassen sich nicht entschluesseln. Wurde DATA_ENCRYPTION_KEY geaendert, gehoert der alte Wert nach DATA_ENCRYPTION_KEY_PREVIOUS."
  );
}
