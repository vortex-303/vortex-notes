import Foundation

public struct RemoteSpace: Sendable, Equatable {
    public let id: String
    public let sealedKeys: [String: String]
    public let createdAt: String
}

public struct RemoteUpdate: Sendable {
    public let seq: Int64
    public let doc: String
    public let author: String
    public let blob: Data
}

/// Relay HTTP client (src/relay/client.ts). Blobs in, blobs out: all
/// encryption happens before data reaches here.
public struct RelayClient: Sendable {
    /// The relay returns at most this many updates per pull (core.ts `LIMIT 500`).
    public static let pageSize = 500

    public let baseURL: URL
    public let identity: DeviceIdentity
    let session: URLSession

    public init(baseURL: URL, identity: DeviceIdentity, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.identity = identity
        self.session = session
    }

    var signer: RequestSigner { RequestSigner(deviceSign: identity.deviceSign) }

    /// Upsert this device under its account. Unsigned: the account-signed cert is the auth.
    public func register() async throws {
        let body: JSValue = .object([
            ("accountSignPub", .string(identity.accountSignPub)),
            ("accountEncPub", .string(identity.accountEncPub)),
            ("device", identity.cert.json),
        ])
        _ = try await send("POST", "/v1/register", body: body, signed: false)
    }

    public func listSpaces() async throws -> [RemoteSpace] {
        let res = try await send("GET", "/v1/spaces")
        guard case .array(let items)? = res["spaces"] else { return [] }
        return items.compactMap { s in
            guard let id = s["id"]?.string, case .object(let seals)? = s["sealedKeys"] else { return nil }
            return RemoteSpace(
                id: id,
                sealedKeys: Dictionary(seals.compactMap { k, v in v.string.map { (k, $0) } }, uniquingKeysWith: { a, _ in a }),
                createdAt: s["createdAt"]?.string ?? ""
            )
        }
    }

    /// Creates the space or REPLACES its whole sealedKeys map: always read, merge, then put.
    public func putSpace(id: String, sealedKeys: [String: String]) async throws {
        let seals = JSValue.object(sealedKeys.keys.sorted().map { ($0, .string(sealedKeys[$0]!)) })
        _ = try await send("PUT", "/v1/spaces/\(id)", body: .object([("sealedKeys", seals)]))
    }

    @discardableResult
    public func pushUpdate(spaceId: String, docId: String, blob: Data) async throws -> Int64 {
        let path = "/v1/spaces/\(spaceId)/docs/\(RequestSigner.encodeDocId(docId))"
        let res = try await send("POST", path, body: .object([("blob", .string(Bytes.b64(blob)))]))
        return res["seq"]?.int ?? 0
    }

    /// One page (≤ 500) of updates after `since`, ascending by seq.
    public func pullUpdates(spaceId: String, since: Int64, docId: String? = nil) async throws -> [RemoteUpdate] {
        var path = "/v1/spaces/\(spaceId)?since=\(since)"
        if let docId { path += "&doc=\(RequestSigner.encodeDocId(docId))" }
        let res = try await send("GET", path)
        guard case .array(let items)? = res["updates"] else { return [] }
        return try items.map { u in
            guard let seq = u["seq"]?.int, let doc = u["doc"]?.string, let blob = u["blob"]?.string else {
                throw VortexError.relay(status: 200, message: "Malformed update")
            }
            return RemoteUpdate(seq: seq, doc: doc, author: u["author"]?.string ?? "", blob: try Bytes.fromB64(blob))
        }
    }

    public func usage() async throws -> (bytesUsed: Int64, quotaBytes: Int64?) {
        let res = try await send("GET", "/v1/usage")
        return (res["bytesUsed"]?.int ?? 0, res["quotaBytes"]?.int)
    }

    /// `ws(s)://<relay>/ws`, same origin as the HTTP API.
    public var webSocketURL: URL {
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        c.path = "/ws"
        return c.url!
    }

    func send(_ method: String, _ pathWithQuery: String, body: JSValue? = nil, signed: Bool = true) async throws -> JSValue {
        let raw = body.map { Data($0.stringify().utf8) } ?? Data()
        // Build from the string so the signed path is byte-for-byte what goes on the wire.
        guard let url = URL(string: baseURL.absoluteString.trimmingSuffix("/") + pathWithQuery) else {
            throw VortexError.relay(status: 0, message: "Bad URL \(pathWithQuery)")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !raw.isEmpty { req.httpBody = raw }
        if signed {
            for (k, v) in signer.headers(method: method, pathWithQuery: pathWithQuery, body: raw) {
                req.setValue(v, forHTTPHeaderField: k)
            }
        }
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = data.isEmpty ? JSValue.null : ((try? JSValue.parse(data)) ?? .null)
        guard (200..<300).contains(status) else {
            throw VortexError.relay(status: status, message: json["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: status))
        }
        return json
    }
}

extension String {
    func trimmingSuffix(_ s: String) -> String { hasSuffix(s) ? String(dropLast(s.count)) : self }
}
