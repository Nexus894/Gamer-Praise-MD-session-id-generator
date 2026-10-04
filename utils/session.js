// utils/session.js
// ─────────────────────────────────────────────────────────
// Session ID format used by Gamer-Praise-MD
//
//   Gpraise_MD~<base64url( zlib.deflate( JSON ) )>
//
//   JSON = {
//     creds: <Baileys creds object, BufferJSON-encoded>,
//     keys : { <type>: { <id>: <BufferJSON-encoded value> } }
//   }
//
// The Session Generator and the bot MUST use this same file
// so encoding/decoding stays 100% compatible.
// ─────────────────────────────────────────────────────────

const zlib = require("zlib");
const {
    initAuthCreds,
    BufferJSON
} = require("@whiskeysockets/baileys");

const SESSION_PREFIX = "Gpraise_MD~";

/* ─────────────────────────── VALIDATION ─────────────────────────── */

function validateSessionId(sessionId) {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
        return { valid: false, reason: "Session ID is empty." };
    }
    if (!sessionId.startsWith(SESSION_PREFIX)) {
        return {
            valid: false,
            reason: `Session ID must start with "${SESSION_PREFIX}".`
        };
    }
    const payload = sessionId.slice(SESSION_PREFIX.length).trim();
    if (payload.length < 16) {
        return { valid: false, reason: "Session ID payload is too short." };
    }
    if (!/^[A-Za-z0-9\-_]+$/.test(payload)) {
        return { valid: false, reason: "Session ID payload is not valid base64url." };
    }
    return { valid: true };
}

/* ─────────────────────────── KEY STORE ─────────────────────────── */

// Baileys-compatible in-memory key store backed by a plain object.
// `rawKeys` is what gets serialized into the Session ID.
function createKeyStore(rawKeys) {
    return {
        get: async (type, ids) => {
            const out = {};
            for (const id of ids) {
                let value = rawKeys?.[type]?.[id];
                if (value !== undefined && value !== null) {
                    value = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
                }
                out[id] = value;
            }
            return out;
        },
        set: async (data) => {
            for (const type of Object.keys(data)) {
                rawKeys[type] = rawKeys[type] || {};
                for (const id of Object.keys(data[type])) {
                    const value = data[type][id];
                    if (value === null || value === undefined) {
                        delete rawKeys[type][id];
                    } else {
                        rawKeys[type][id] = JSON.parse(
                            JSON.stringify(value, BufferJSON.replacer)
                        );
                    }
                }
            }
        }
    };
}

/* ────────────────────────────  ENCODE  ──────────────────────────── */

function encodeSessionId(creds, keys) {
    const json = JSON.stringify({ creds, keys: keys || {} }, BufferJSON.replacer);
    const deflated = zlib.deflateSync(Buffer.from(json, "utf8"));
    return SESSION_PREFIX + deflated.toString("base64url");
}

/* ────────────────────────────  DECODE  ──────────────────────────── */

function decodeSessionId(sessionId) {
    const check = validateSessionId(sessionId);
    if (!check.valid) throw new Error(`Invalid Session ID: ${check.reason}`);

    const payload = sessionId.slice(SESSION_PREFIX.length).trim();

    let inflated;
    try {
        const buf = Buffer.from(payload, "base64url");
        inflated = zlib.inflateSync(buf).toString("utf8");
    } catch (e) {
        throw new Error("Session ID payload could not be decoded (corrupt or wrong format).");
    }

    let parsed;
    try {
        parsed = JSON.parse(inflated, BufferJSON.reviver);
    } catch (e) {
        throw new Error("Session ID JSON is malformed.");
    }

    if (!parsed || typeof parsed !== "object" || !parsed.creds) {
        throw new Error("Session ID does not contain valid Baileys credentials.");
    }

    return {
        creds: parsed.creds,
        keys: parsed.keys || {}
    };
}

/* ───────────────────  BOT: SESSION → AUTH STATE  ─────────────────── */

/**
 * Build a Baileys auth state from a Session ID.
 * Used by index.js.
 */
async function useSessionAuthState(sessionId) {
    const check = validateSessionId(sessionId);
    if (!check.valid) throw new Error(`Invalid Session ID: ${check.reason}`);

    const { creds, keys } = decodeSessionId(sessionId);

    if (!creds.me && !creds.registered) {
        console.warn("[SESSION] Warning: creds.me missing — session may be incomplete.");
    }

    const rawKeys = keys;
    const state = {
        creds,
        keys: createKeyStore(rawKeys)
    };

    // no-op: credentials already persisted inside the Session ID
    const saveCreds = async () => {};

    return { state, saveCreds };
}

/* ────────────────  GENERATOR: FRESH AUTH STATE  ──────────────── */

/**
 * Used by the Session Generator to create a brand new auth state,
 * then encode it into a Session ID once pairing succeeds.
 */
function createFreshAuthState() {
    const creds = initAuthCreds();
    const rawKeys = {};
    const state = {
        creds,
        keys: createKeyStore(rawKeys)
    };
    return {
        creds,
        rawKeys,
        state,
        saveCreds: async () => {}
    };
}

/* ────────────────────────────  EXPORTS  ──────────────────────────── */

module.exports = {
    SESSION_PREFIX,
    validateSessionId,
    encodeSessionId,
    decodeSessionId,
    useSessionAuthState,
    createFreshAuthState,
    createKeyStore
};
