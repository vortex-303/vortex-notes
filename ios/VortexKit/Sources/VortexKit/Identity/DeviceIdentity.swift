import Foundation

/// This device as a principal: account public keys, the device's own keys,
/// and its account-signed cert. Persisted (Keychain on device); the phrase never is.
public struct DeviceIdentity: Sendable, Equatable {
    public let accountSignPub: String
    public let accountEncPub: String
    public let deviceSign: SignKeypair
    public let deviceBox: BoxKeypair
    public let cert: SignedCert

    public init(accountSignPub: String, accountEncPub: String, deviceSign: SignKeypair, deviceBox: BoxKeypair, cert: SignedCert) {
        self.accountSignPub = accountSignPub
        self.accountEncPub = accountEncPub
        self.deviceSign = deviceSign
        self.deviceBox = deviceBox
        self.cert = cert
    }

    /// A fresh device certified by the account (needs the 12 words once).
    public static func enroll(account: AccountKeys, name: String) -> DeviceIdentity {
        let sign = SignKeypair.random()
        let box = BoxKeypair.random()
        return DeviceIdentity(
            accountSignPub: Bytes.hex(account.sign.pub), accountEncPub: Bytes.hex(account.box.pub),
            deviceSign: sign, deviceBox: box,
            cert: SignedCert.certifyDevice(account: account, deviceSign: sign, deviceBox: box, name: name)
        )
    }

    public var deviceSignPub: String { Bytes.hex(deviceSign.pub) }
    public var fingerprint: String { VortexCrypto.fingerprint((try? Bytes.fromHex(accountSignPub)) ?? Data()) }

    /// Same fields as the web app's `vn-device` record.
    public func serialized() -> Data {
        let v: JSValue = .object([
            ("account", .string(accountSignPub)), ("accountEnc", .string(accountEncPub)),
            ("signPriv", .string(Bytes.hex(deviceSign.priv))), ("boxPriv", .string(Bytes.hex(deviceBox.priv))),
            ("device", cert.json),
        ])
        return Data(v.stringify().utf8)
    }

    public init(serialized data: Data) throws {
        let v = try JSValue.parse(data)
        guard let account = v["account"]?.string, let accountEnc = v["accountEnc"]?.string,
              let signPriv = v["signPriv"]?.string, let boxPriv = v["boxPriv"]?.string, let device = v["device"]
        else { throw VortexError.invalidKey }
        self.init(
            accountSignPub: account, accountEncPub: accountEnc,
            deviceSign: try SignKeypair(seed: Bytes.fromHex(signPriv)), deviceBox: try BoxKeypair(seed: Bytes.fromHex(boxPriv)),
            cert: try SignedCert(json: device)
        )
    }
}
