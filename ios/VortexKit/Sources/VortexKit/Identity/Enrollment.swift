import Foundation

/// The result of signing in: who this device is, and the space it syncs.
public struct Session: Sendable {
    public let identity: DeviceIdentity
    public let spaceId: String
    public let spaceKey: Data

    public init(identity: DeviceIdentity, spaceId: String, spaceKey: Data) {
        self.identity = identity
        self.spaceId = spaceId
        self.spaceKey = spaceKey
    }
}

/// Sign-in flows matching the web app (src/webapp/main.ts unlock + create account).
public enum Enrollment {
    /// 12 words → account → register a new device → open the space with the
    /// account seal → add this device's seal so later launches need no phrase.
    public static func signIn(phrase: String, relay: URL, deviceName: String, session: URLSession = .shared) async throws -> Session {
        let account = try AccountKeys(phrase: phrase)
        let identity = DeviceIdentity.enroll(account: account, name: deviceName)
        let client = RelayClient(baseURL: relay, identity: identity, session: session)
        try await client.register()
        let spaces = try await client.listSpaces()
        guard let space = spaces.first(where: { $0.sealedKeys[identity.accountSignPub] != nil }) else {
            throw EnrollmentError.noSpace
        }
        let spaceKey = try VortexCrypto.openBox(try Bytes.fromHex(space.sealedKeys[identity.accountSignPub]!), with: account.box)
        try await addSeal(client: client, spaceId: space.id, spaceKey: spaceKey, for: identity)
        return Session(identity: identity, spaceId: space.id, spaceKey: spaceKey)
    }

    /// A brand-new account: fresh phrase (show it ONCE), device, and a "personal" space.
    public static func createAccount(relay: URL, deviceName: String, session: URLSession = .shared) async throws -> (phrase: String, session: Session) {
        let phrase = BIP39.generate()
        let account = try AccountKeys(phrase: phrase)
        let identity = DeviceIdentity.enroll(account: account, name: deviceName)
        let client = RelayClient(baseURL: relay, identity: identity, session: session)
        try await client.register()
        let spaceKey = Bytes.random(32)
        let spaceId = "sp-" + ULID.make().lowercased()
        try await client.putSpace(id: spaceId, sealedKeys: [
            identity.accountSignPub: Bytes.hex(try VortexCrypto.sealBox(spaceKey, to: account.box.pub)),
            identity.deviceSignPub: Bytes.hex(try VortexCrypto.sealBox(spaceKey, to: identity.deviceBox.pub)),
        ])
        return (phrase, Session(identity: identity, spaceId: spaceId, spaceKey: spaceKey))
    }

    /// Later launches: no phrase, open the space with this device's own seal.
    public static func resume(identity: DeviceIdentity, relay: URL, session: URLSession = .shared) async throws -> Session {
        let client = RelayClient(baseURL: relay, identity: identity, session: session)
        try await client.register()
        guard let space = try await client.listSpaces().first(where: { $0.sealedKeys[identity.deviceSignPub] != nil }) else {
            throw EnrollmentError.revoked
        }
        let key = try VortexCrypto.openBox(try Bytes.fromHex(space.sealedKeys[identity.deviceSignPub]!), with: identity.deviceBox)
        return Session(identity: identity, spaceId: space.id, spaceKey: key)
    }

    /// PUT replaces the whole map, so re-read right before writing.
    static func addSeal(client: RelayClient, spaceId: String, spaceKey: Data, for identity: DeviceIdentity) async throws {
        guard var seals = try await client.listSpaces().first(where: { $0.id == spaceId })?.sealedKeys else { return }
        if seals[identity.deviceSignPub] != nil { return }
        seals[identity.deviceSignPub] = Bytes.hex(try VortexCrypto.sealBox(spaceKey, to: identity.deviceBox.pub))
        try await client.putSpace(id: spaceId, sealedKeys: seals)
    }
}

public enum EnrollmentError: Error, Equatable, Sendable {
    /// Valid words, but no space on this relay: almost always a typo'd or different phrase.
    case noSpace
    /// This device's seal is gone (revoked from Agents & devices).
    case revoked
}

/// ULID (time + randomness, Crockford base32), for space ids like the TS `ulid()`.
enum ULID {
    static func make(now: Date = Date()) -> String {
        let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        var ms = UInt64(now.timeIntervalSince1970 * 1000)
        var time = [Character](repeating: "0", count: 10)
        for i in (0..<10).reversed() { time[i] = alphabet[Int(ms % 32)]; ms /= 32 }
        let rand = Bytes.random(16).prefix(16).map { alphabet[Int($0) % 32] }
        return String(time) + String(rand)
    }
}
