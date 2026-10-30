import Foundation
import Security
#if os(iOS)
import UIKit
#endif

/// This device's identity (keys + cert) in the Keychain. Readable after first
/// unlock so the share extension and background sync can sign; never synced to
/// iCloud ("ThisDeviceOnly"): a device key belongs to exactly one device.
enum Keychain {
    static let service = "dev.vortex303.notes"
    static let account = "device"
    static let appGroup = "group.dev.vortex303.notes"

    static func save(_ data: Data) -> Bool {
        delete()
        var q = base()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return add(q)
    }

    static func load() -> Data? {
        var q = base()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        var status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecMissingEntitlement {
            q.removeValue(forKey: kSecUseDataProtectionKeychain as String)
            status = SecItemCopyMatching(q as CFDictionary, &out)
        }
        return status == errSecSuccess ? out as? Data : nil
    }

    @discardableResult
    static func delete() -> Bool {
        var q = base()
        var status = SecItemDelete(q as CFDictionary)
        if status == errSecMissingEntitlement {
            q.removeValue(forKey: kSecUseDataProtectionKeychain as String)
            status = SecItemDelete(q as CFDictionary)
        }
        return status == errSecSuccess || status == errSecItemNotFound
    }

    private static func base() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            // macOS: the iOS-style keychain. Unsigned dev builds lack the entitlement and fall back.
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    private static func add(_ query: [String: Any]) -> Bool {
        var q = query
        var status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecMissingEntitlement {
            q.removeValue(forKey: kSecUseDataProtectionKeychain as String)
            status = SecItemAdd(q as CFDictionary, nil)
        }
        return status == errSecSuccess
    }
}

#if os(iOS)
@MainActor
enum DeviceInfo {
    static var model: String { UIDevice.current.model } // "iPhone" / "iPad"
}
#endif
