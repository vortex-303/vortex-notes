import Foundation

/// Account keys derived from the 12 words (src/account.ts `accountFromPhrase`).
/// Hold only in memory: the phrase and these private keys are never persisted.
public struct AccountKeys: Sendable {
    public let sign: SignKeypair
    public let box: BoxKeypair
    public let fingerprint: String

    public init(phrase: String) throws {
        let normalized = BIP39.normalize(phrase)
        guard BIP39.isValid(normalized) else { throw VortexError.invalidPhrase }
        let seed = BIP39.seed(normalized)
        sign = try SignKeypair(seed: KDF.hkdf(seed, info: "vortex-account-sign-v1"))
        box = try BoxKeypair(seed: KDF.hkdf(seed, info: "vortex-account-encrypt-v1"))
        fingerprint = VortexCrypto.fingerprint(sign.pub)
    }

    /// Account id = signPub hex.
    public var id: String { Bytes.hex(sign.pub) }
}

/// A principal certificate (`DeviceCertPayload & { certSig }`).
public struct SignedCert: Sendable, Equatable {
    public enum Kind: String, Sendable { case device, agent }

    public var kind: Kind
    public var signPub: String
    public var encPub: String
    public var name: String
    public var createdAt: String
    public var spaces: [String]?
    public var mode: String?
    public var signedBy: String?
    public var certSig: String

    /// The payload without certSig; optional fields are omitted, never null.
    public var payload: JSValue {
        var pairs: [(String, JSValue)] = [
            ("v", .int(1)), ("kind", .string(kind.rawValue)), ("signPub", .string(signPub)),
            ("encPub", .string(encPub)), ("name", .string(name)), ("createdAt", .string(createdAt)),
        ]
        if let spaces { pairs.append(("spaces", .array(spaces.map { .string($0) }))) }
        if let mode { pairs.append(("mode", .string(mode))) }
        if let signedBy { pairs.append(("signedBy", .string(signedBy))) }
        return .object(pairs)
    }

    /// Exactly the bytes account.ts `canonical()` signs.
    public var canonicalBytes: Data { Data(payload.sortedKeys().stringify().utf8) }

    /// The wire form `{...payload, certSig}`.
    public var json: JSValue {
        guard case .object(var pairs) = payload else { return payload }
        pairs.append(("certSig", .string(certSig)))
        return .object(pairs)
    }

    public func verify(signerPub: Data) -> Bool {
        guard let sig = try? Bytes.fromHex(certSig) else { return false }
        return VortexCrypto.verify(sig, canonicalBytes, pub: signerPub)
    }

    /// `certifyDevice`: the account key vouches for a fresh device keypair.
    public static func certifyDevice(
        account: AccountKeys, deviceSign: SignKeypair, deviceBox: BoxKeypair, name: String, now: Date = Date()
    ) -> SignedCert {
        var cert = SignedCert(
            kind: .device, signPub: Bytes.hex(deviceSign.pub), encPub: Bytes.hex(deviceBox.pub),
            name: name, createdAt: isoString(now), certSig: ""
        )
        cert.certSig = Bytes.hex(account.sign.sign(cert.canonicalBytes))
        return cert
    }

    public init(
        kind: Kind, signPub: String, encPub: String, name: String, createdAt: String,
        spaces: [String]? = nil, mode: String? = nil, signedBy: String? = nil, certSig: String
    ) {
        self.kind = kind
        self.signPub = signPub
        self.encPub = encPub
        self.name = name
        self.createdAt = createdAt
        self.spaces = spaces
        self.mode = mode
        self.signedBy = signedBy
        self.certSig = certSig
    }

    public init(json: JSValue) throws {
        guard let kind = json["kind"]?.string.flatMap(Kind.init), let signPub = json["signPub"]?.string,
              let encPub = json["encPub"]?.string, let name = json["name"]?.string,
              let createdAt = json["createdAt"]?.string, let certSig = json["certSig"]?.string
        else { throw VortexError.invalidKey }
        var spaces: [String]?
        if case .array(let items)? = json["spaces"] { spaces = items.compactMap(\.string) }
        self.init(
            kind: kind, signPub: signPub, encPub: encPub, name: name, createdAt: createdAt,
            spaces: spaces, mode: json["mode"]?.string, signedBy: json["signedBy"]?.string, certSig: certSig
        )
    }
}

/// JS `new Date().toISOString()`: UTC with milliseconds.
public func isoString(_ date: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    f.timeZone = TimeZone(identifier: "UTC")
    return f.string(from: date)
}
