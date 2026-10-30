import CryptoKit
import Foundation

/// Ed25519 signing keypair; `priv` is the 32-byte seed (as in src/crypto.ts).
public struct SignKeypair: Sendable, Equatable {
    public let priv: Data
    public let pub: Data

    public init(seed: Data) throws {
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
        priv = seed
        pub = key.publicKey.rawRepresentation
    }

    public static func random() -> SignKeypair { try! SignKeypair(seed: Bytes.random(32)) }

    public func sign(_ message: Data) -> Data {
        // CryptoKit signatures are randomized; any valid Ed25519 signature verifies everywhere.
        let key = try! Curve25519.Signing.PrivateKey(rawRepresentation: priv)
        return try! key.signature(for: message)
    }
}

/// X25519 box keypair; `priv` is the raw 32-byte scalar (clamped internally).
public struct BoxKeypair: Sendable, Equatable {
    public let priv: Data
    public let pub: Data

    public init(seed: Data) throws {
        let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: seed)
        priv = seed
        pub = key.publicKey.rawRepresentation
    }

    public static func random() -> BoxKeypair { try! BoxKeypair(seed: Bytes.random(32)) }
}

/// The E2EE primitives of src/crypto.ts, byte-compatible.
public enum VortexCrypto {
    static let keyLength = 32
    static let nonceLength = XChaCha20Poly1305.nonceLength

    public static func verify(_ sig: Data, _ message: Data, pub: Data) -> Bool {
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pub) else { return false }
        return key.isValidSignature(sig, for: message)
    }

    /// Anonymous sealed box: ephPub(32) ‖ nonce(24) ‖ ct‖tag. NOT libsodium's crypto_box_seal.
    public static func sealBox(_ data: Data, to recipientPub: Data) throws -> Data {
        let eph = BoxKeypair.random()
        let key = try sealKey(priv: eph.priv, peerPub: recipientPub, ephPub: eph.pub, recipientPub: recipientPub)
        let nonce = Bytes.random(nonceLength)
        return eph.pub + nonce + (try XChaCha20Poly1305.seal(data, key: key, nonce: nonce))
    }

    public static func openBox(_ sealed: Data, with recipient: BoxKeypair) throws -> Data {
        guard sealed.count >= keyLength + nonceLength + 16 else { throw VortexError.ciphertextTooShort }
        let b = Data(sealed)
        let ephPub = b.subdata(in: 0..<keyLength)
        let nonce = b.subdata(in: keyLength..<(keyLength + nonceLength))
        let ct = b.subdata(in: (keyLength + nonceLength)..<b.count)
        let key = try sealKey(priv: recipient.priv, peerPub: ephPub, ephPub: ephPub, recipientPub: recipient.pub)
        return try XChaCha20Poly1305.open(ct, key: key, nonce: nonce)
    }

    /// nonce(24) ‖ ct‖tag; the AAD binds the blob to its context (e.g. "vortex-doc-v1:<path>").
    public static func encryptPayload(_ data: Data, key: Data, aad: String? = nil) throws -> Data {
        let nonce = Bytes.random(nonceLength)
        return nonce + (try XChaCha20Poly1305.seal(data, key: key, nonce: nonce, aad: aadData(aad)))
    }

    public static func decryptPayload(_ blob: Data, key: Data, aad: String? = nil) throws -> Data {
        guard blob.count >= nonceLength + 16 else { throw VortexError.ciphertextTooShort }
        let b = Data(blob)
        return try XChaCha20Poly1305.open(
            b.subdata(in: nonceLength..<b.count), key: key, nonce: b.subdata(in: 0..<nonceLength), aad: aadData(aad)
        )
    }

    /// First 8 bytes of sha256(pub), hex, grouped by 4: "ab12-cd34-ef56-7890".
    public static func fingerprint(_ pub: Data) -> String {
        let hex = Bytes.hex(Data(SHA256.hash(data: pub)).prefix(8))
        var out = ""
        for (i, c) in hex.enumerated() {
            if i > 0 && i % 4 == 0 { out.append("-") }
            out.append(c)
        }
        return out
    }

    public static func sha256Hex(_ data: Data) -> String { Bytes.hex(Data(SHA256.hash(data: data))) }

    private static func sealKey(priv: Data, peerPub: Data, ephPub: Data, recipientPub: Data) throws -> Data {
        let shared = try sharedSecret(priv: priv, pub: peerPub)
        return KDF.hkdf(shared, info: "vortex-seal-v1", salt: ephPub + recipientPub)
    }

    static func sharedSecret(priv: Data, pub: Data) throws -> Data {
        let sk = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: priv)
        let pk = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: pub)
        return try sk.sharedSecretFromKeyAgreement(with: pk).withUnsafeBytes { Data($0) }
    }

    // noble treats an empty AAD string like no AAD (`aad ? utf8(aad) : undefined`).
    private static func aadData(_ aad: String?) -> Data? {
        guard let aad, !aad.isEmpty else { return nil }
        return Data(aad.utf8)
    }
}
