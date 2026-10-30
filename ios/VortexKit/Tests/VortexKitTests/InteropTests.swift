import Foundation
import XCTest
@testable import VortexKit

/// Checks the Swift port against vectors made by the real TypeScript code
/// (scripts/gen-interop-vectors.ts), and writes Swift-made artifacts that
/// test/interop-verify.ts opens with the TypeScript code.
final class InteropTests: XCTestCase {
    static let repo = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let vectorsURL = repo.appendingPathComponent("test/vectors/interop.json")
    static let swiftOutURL = repo.appendingPathComponent("test/vectors/swift-out.json")

    var v: [String: Any] = [:]

    override func setUpWithError() throws {
        v = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.vectorsURL)) as! [String: Any]
    }

    private func dict(_ key: String, in d: [String: Any]? = nil) -> [String: Any] { (d ?? v)[key] as! [String: Any] }
    private func str(_ key: String, in d: [String: Any]? = nil) -> String { (d ?? v)[key] as! String }
    private func hex(_ s: String) -> Data { try! Bytes.fromHex(s) }

    func testPhraseToAccountKeys() throws {
        XCTAssertEqual(Bytes.hex(BIP39.seed(str("phrase"))), str("seed"))
        let acct = try AccountKeys(phrase: str("phrase"))
        let a = dict("account")
        XCTAssertEqual(Bytes.hex(acct.sign.priv), str("signPriv", in: a))
        XCTAssertEqual(Bytes.hex(acct.sign.pub), str("signPub", in: a))
        XCTAssertEqual(Bytes.hex(acct.box.priv), str("boxPriv", in: a))
        XCTAssertEqual(Bytes.hex(acct.box.pub), str("boxPub", in: a))
        XCTAssertEqual(acct.fingerprint, str("fingerprint", in: a))
        XCTAssertEqual(try AccountKeys(phrase: str("messyPhrase")).id, acct.id)
        XCTAssertThrowsError(try AccountKeys(phrase: str("invalidPhrase")))
    }

    func testBIP39RoundTrip() {
        for _ in 0..<20 {
            let p = BIP39.generate()
            XCTAssertEqual(p.split(separator: " ").count, 12)
            XCTAssertTrue(BIP39.isValid(p))
        }
        XCTAssertEqual(BIP39.suggestions("abs"), ["absent", "absorb", "abstract", "absurd"])
    }

    func testHKDF() {
        let h = dict("hkdf")
        XCTAssertEqual(Bytes.hex(KDF.hkdf(hex(str("ikm", in: h)), info: str("info", in: h))), str("out", in: h))
    }

    func testCertCanonicalBytesAndSignatures() throws {
        let acct = try AccountKeys(phrase: str("phrase"))
        for (key, signer) in [("device", acct.sign.pub), ("agent", hex(str("signPub", in: dict("device"))))] {
            let c = dict("cert", in: dict(key))
            let payload = c["payload"] as! [String: Any]
            var wire = payload
            wire["certSig"] = c["certSig"]
            let cert = try SignedCert(json: JSValue.from(wire))
            XCTAssertEqual(String(decoding: cert.canonicalBytes, as: UTF8.self), str("canonical", in: c), key)
            XCTAssertTrue(cert.verify(signerPub: signer), key)
        }
    }

    func testDeviceKeysFromSeeds() throws {
        let d = dict("device")
        XCTAssertEqual(Bytes.hex(try SignKeypair(seed: hex(str("signPriv", in: d))).pub), str("signPub", in: d))
        XCTAssertEqual(Bytes.hex(try BoxKeypair(seed: hex(str("boxPriv", in: d))).pub), str("boxPub", in: d))
    }

    func testRequestSigning() throws {
        let r = dict("request")
        for p in r["docPaths"] as! [[String: String]] {
            XCTAssertEqual(RequestSigner.encodeDocId(p["path"]!), p["encoded"]!)
        }
        for k in ["post", "get"] {
            let q = dict(k, in: r)
            XCTAssertEqual(
                RequestSigner.canonical(
                    method: str("method", in: q), pathWithQuery: str("pathWithQuery", in: q),
                    ts: str("ts", in: q), body: Data(str("body", in: q).utf8)
                ),
                str("canonical", in: q)
            )
        }
        let post = dict("post", in: r)
        let devicePub = hex(str("signPub", in: dict("device")))
        XCTAssertTrue(VortexCrypto.verify(hex(str("sig", in: post)), Data(str("canonical", in: post).utf8), pub: devicePub))
        let ws = dict("ws", in: r)
        XCTAssertEqual(
            RequestSigner.wsCanonical(spaces: ws["spaces"] as! [String], ts: str("ts", in: ws)), str("canonical", in: ws)
        )
    }

    func testOpenTypeScriptSealsAndDocs() throws {
        let acct = try AccountKeys(phrase: str("phrase"))
        let d = dict("device")
        let deviceBox = try BoxKeypair(seed: hex(str("boxPriv", in: d)))
        let s = dict("sealed")
        let spaceKey = hex(str("spaceKey", in: s))
        XCTAssertEqual(try VortexCrypto.openBox(hex(str("toAccount", in: s)), with: acct.box), spaceKey)
        XCTAssertEqual(try VortexCrypto.openBox(hex(str("toDevice", in: s)), with: deviceBox), spaceKey)
        XCTAssertThrowsError(try VortexCrypto.openBox(hex(str("toAccount", in: s)), with: deviceBox))

        for doc in v["docs"] as! [[String: Any]] {
            let payload = doc["payload"] as! [String: Any]
            let path = payload["path"] as! String
            let blob = try Bytes.fromB64(doc["blob"] as! String)
            let p = try DocPayload.decrypt(blob, docId: path, spaceKey: spaceKey)
            XCTAssertEqual(p.content, payload["content"] as? String)
            XCTAssertEqual(p.mtimeMs, (payload["mtimeMs"] as! NSNumber).int64Value)
            XCTAssertEqual(p.deleted, payload["deleted"] as? Bool ?? false)
            // Same plaintext bytes as JSON.stringify, so blobs round-trip identically.
            XCTAssertEqual(p.json.stringify(), doc["json"] as? String)
            XCTAssertThrowsError(try DocPayload.decrypt(blob, docId: path + "x", spaceKey: spaceKey))
        }
    }

    func testOpenTypeScriptLocks() throws {
        let l = dict("locks")
        let acct = try AccountKeys(phrase: str("phrase"))
        let plain = NoteText.splitFrontmatter(str("plain", in: l))
        for key in ["v2", "v1"] {
            let locked = str(key, in: l)
            XCTAssertTrue(NoteLock.isLocked(locked))
            let u = try XCTUnwrap(NoteLock.unlock(locked, password: str("password", in: l)), key)
            XCTAssertEqual(u.body, String(plain.body.drop(while: { $0 == "\n" })))
            XCTAssertEqual(u.frontmatter, plain.frontmatter)
            XCTAssertNil(NoteLock.unlock(locked, password: "wrong"))
        }
        XCTAssertNotNil(NoteLock.unlock(str("v2", in: l), accountBox: acct.box))
        XCTAssertNil(NoteLock.unlock(str("v1", in: l), accountBox: acct.box))
    }

    /// Swift → TypeScript direction: test/interop-verify.ts opens these.
    func testWriteSwiftArtifacts() throws {
        let acct = try AccountKeys(phrase: str("phrase"))
        let deviceSign = SignKeypair.random()
        let deviceBox = BoxKeypair.random()
        let cert = SignedCert.certifyDevice(
            account: acct, deviceSign: deviceSign, deviceBox: deviceBox, name: "iPhone · iOS \"swift\" é/€\n"
        )
        XCTAssertTrue(cert.verify(signerPub: acct.sign.pub))
        let spaceKey = hex(str("spaceKey", in: dict("sealed")))
        let doc = DocPayload(path: "Recetas/Café ñ (swift).md", content: "---\ntitle: Café\n---\n\nHola 🧀\n", mtimeMs: 1_761_741_296_999)
        let body = Data(#"{"blob":"AAAA"}"#.utf8)
        let path = "/v1/spaces/sp-x/docs/" + RequestSigner.encodeDocId(doc.path)
        let headers = RequestSigner(deviceSign: deviceSign).headers(method: "POST", pathWithQuery: path, body: body)
        let locked = try NoteLock.lock(str("plain", in: dict("locks")), password: "swift pw ñ", accountBoxPub: acct.box.pub)

        let out: JSValue = .object([
            ("deviceCert", cert.json),
            ("sealedToAccount", .string(Bytes.hex(try VortexCrypto.sealBox(spaceKey, to: acct.box.pub)))),
            ("doc", .object([("path", .string(doc.path)), ("blob", .string(Bytes.b64(try doc.encrypt(spaceKey: spaceKey))))])),
            ("request", .object([
                ("method", .string("POST")), ("pathWithQuery", .string(path)), ("body", .string(String(decoding: body, as: UTF8.self))),
                ("device", .string(headers["x-vortex-device"]!)), ("ts", .string(headers["x-vortex-ts"]!)),
                ("sig", .string(headers["x-vortex-sig"]!)),
            ])),
            ("lockedV2", .string(locked)), ("lockPassword", .string("swift pw ñ")),
        ])
        try Data(out.stringify().utf8).write(to: Self.swiftOutURL)
    }
}

/// RFC 7914 §12 test vectors (small N so debug builds stay fast).
final class ScryptTests: XCTestCase {
    func testRFC7914Vectors() {
        XCTAssertEqual(
            Bytes.hex(KDF.scrypt(password: Data(), salt: Data(), n: 16, r: 1, p: 1, length: 64)),
            "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906"
        )
        XCTAssertEqual(
            Bytes.hex(KDF.scrypt(password: Data("password".utf8), salt: Data("NaCl".utf8), n: 1024, r: 8, p: 16, length: 64)),
            "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"
        )
    }

    func testNoteKeySpeed() {
        let start = Date()
        _ = KDF.noteKey(password: "pw", salt: Data(repeating: 1, count: 32))
        print("scrypt N=2^15 r=8: \(Date().timeIntervalSince(start))s")
    }
}
