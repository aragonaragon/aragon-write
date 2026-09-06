import AVFoundation
import Capacitor
import Foundation
import Security
import Speech

@objc(AragonBridgeViewController)
final class AragonBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AragonStoragePlugin())
        bridge?.registerPluginInstance(AragonSpeechPlugin())
        bridge?.registerPluginInstance(AragonSecretsPlugin())
        bridge?.registerPluginInstance(AragonAIPlugin())
    }
}

// MARK: - Keychain secrets and native external AI

private enum AragonKeychain {
    static let service = "com.aragon.write.secrets"

    static func value(for key: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.status(status)
        }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String, for key: String) throws {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var insert = base
        insert[kSecValueData as String] = Data(value.utf8)
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(insert as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    private enum KeychainError: LocalizedError {
        case status(OSStatus)
        var errorDescription: String? { "تعذّر الوصول إلى Keychain" }
    }
}

@objc(AragonSecretsPlugin)
final class AragonSecretsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "AragonSecretsPlugin"
    let jsName = "AragonSecrets"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else { call.reject("المفتاح مفقود"); return }
        do { call.resolve(["value": try AragonKeychain.value(for: key) ?? ""]) }
        catch { call.reject(error.localizedDescription, "KEYCHAIN_READ", error) }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else { call.reject("المفتاح مفقود"); return }
        do {
            try AragonKeychain.set(call.getString("value") ?? "", for: key)
            call.resolve(["ok": true])
        } catch { call.reject(error.localizedDescription, "KEYCHAIN_WRITE", error) }
    }
}

@objc(AragonAIPlugin)
final class AragonAIPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "AragonAIPlugin"
    let jsName = "AragonAI"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "test", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "models", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
    ]

    private func endpoint(_ baseURL: String, path: String) throws -> URL {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard var components = URLComponents(string: trimmed),
              components.scheme?.lowercased() == "https",
              components.host != nil else { throw AIError.invalidURL }
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + [basePath, path].filter { !$0.isEmpty }.joined(separator: "/")
        guard let url = components.url else { throw AIError.invalidURL }
        return url
    }

    private func request(_ baseURL: String, path: String, method: String = "GET", json: [String: Any]? = nil) throws -> URLRequest {
        var request = URLRequest(url: try endpoint(baseURL, path: path))
        request.httpMethod = method
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let apiKey = try AragonKeychain.value(for: "external-api-key") ?? ""
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        if let json { request.httpBody = try JSONSerialization.data(withJSONObject: json) }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AIError.connection }
        guard (200..<300).contains(http.statusCode) else { throw AIError.http(http.statusCode) }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AIError.invalidResponse }
        return object
    }

    @objc func test(_ call: CAPPluginCall) {
        guard let baseURL = call.getString("baseUrl") else { call.reject("Base URL مطلوب"); return }
        Task {
            do {
                _ = try await perform(try request(baseURL, path: "models"))
                call.resolve(["ok": true])
            } catch { call.resolve(["ok": false, "error": error.localizedDescription]) }
        }
    }

    @objc func models(_ call: CAPPluginCall) {
        guard let baseURL = call.getString("baseUrl") else { call.reject("Base URL مطلوب"); return }
        Task {
            do {
                let object = try await perform(try request(baseURL, path: "models"))
                let raw = (object["data"] as? [[String: Any]]) ?? (object["models"] as? [[String: Any]]) ?? []
                let models = raw.compactMap { item -> [String: Any]? in
                    guard let name = (item["id"] as? String) ?? (item["name"] as? String), !name.isEmpty else { return nil }
                    return ["name": name]
                }
                call.resolve(["models": models])
            } catch { call.reject(error.localizedDescription, "AI_MODELS", error) }
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let baseURL = call.getString("baseUrl"),
              let model = call.getString("model"), !model.isEmpty,
              let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("إعدادات المساعد أو النص ناقصة")
            return
        }
        Task {
            do {
                let body: [String: Any] = [
                    "model": model,
                    "messages": [["role": "user", "content": prompt]],
                    "stream": false,
                    "temperature": 0.7,
                    "max_tokens": 4096,
                ]
                let object = try await perform(try request(baseURL, path: "chat/completions", method: "POST", json: body))
                let choices = object["choices"] as? [[String: Any]]
                let message = choices?.first?["message"] as? [String: Any]
                guard let text = message?["content"] as? String, !text.isEmpty else { throw AIError.invalidResponse }
                call.resolve(["text": text])
            } catch { call.reject(error.localizedDescription, "AI_GENERATE", error) }
        }
    }

    private enum AIError: LocalizedError {
        case invalidURL, connection, invalidResponse, http(Int)
        var errorDescription: String? {
            switch self {
            case .invalidURL: return "استخدم رابط HTTPS صحيح للمزود"
            case .connection: return "تعذّر الاتصال بمزود الـAPI"
            case .invalidResponse: return "رد مزود الـAPI غير صالح"
            case .http(let code):
                if code == 401 || code == 403 { return "مفتاح API غير صالح أو منتهي" }
                if code == 404 { return "الرابط أو الموديل غير صحيح" }
                if code == 429 { return "تجاوزت الحد المسموح — جرّب بعد قليل" }
                if code >= 500 { return "مزود الـAPI متوقف حالياً" }
                return "فشل طلب الـAPI (\(code))"
            }
        }
    }
}

// MARK: - Local-first iCloud document storage

@objc(AragonStoragePlugin)
final class AragonStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "AragonStoragePlugin"
    let jsName = "AragonStorage"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listProjects", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDocuments", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDocument", returnType: CAPPluginReturnPromise),
    ]

    private let files = FileManager.default
    private let queue = DispatchQueue(label: "com.aragon.write.storage", qos: .userInitiated)
    private let containerIdentifier = "iCloud.com.aragon.write"
    private let idPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]+$")

    private var timestamp: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    private func isSafeID(_ value: String) -> Bool {
        idPattern.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    private func makeID() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }

    private func storageRoot() throws -> (url: URL, isICloud: Bool) {
        if let cloud = files.url(forUbiquityContainerIdentifier: containerIdentifier) {
            let root = cloud.appendingPathComponent("Documents", isDirectory: true)
                .appendingPathComponent("Aragon Write", isDirectory: true)
            try files.createDirectory(at: root, withIntermediateDirectories: true)
            return (root, true)
        }

        let support = try files.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let root = support.appendingPathComponent("Aragon Write", isDirectory: true)
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        return (root, false)
    }

    private func projectURL(_ projectID: String, root: URL) throws -> URL {
        guard isSafeID(projectID) else { throw StorageError.invalidID }
        return root.appendingPathComponent(projectID, isDirectory: true)
    }

    private func readJSON(_ url: URL) throws -> [String: Any] {
        if let ubiquitous = try? url.resourceValues(forKeys: [.isUbiquitousItemKey]), ubiquitous.isUbiquitousItem == true {
            try? files.startDownloadingUbiquitousItem(at: url)
        }
        let data = try Data(contentsOf: url)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StorageError.invalidJSON
        }
        return object
    }

    private func writeJSON(_ object: [String: Any], to url: URL) throws {
        guard JSONSerialization.isValidJSONObject(object) else { throw StorageError.invalidJSON }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private func bumpProject(_ projectURL: URL) {
        let metadataURL = projectURL.appendingPathComponent("_project.json")
        guard var metadata = try? readJSON(metadataURL) else { return }
        metadata["updatedAt"] = timestamp
        try? writeJSON(metadata, to: metadataURL)
    }

    private func run(_ call: CAPPluginCall, operation: @escaping () throws -> [String: Any]) {
        queue.async {
            do { call.resolve(try operation()) }
            catch { call.reject(error.localizedDescription, "STORAGE_ERROR", error) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        run(call) { [self] in
            let root = try storageRoot()
            return [
                "available": true,
                "iCloud": root.isICloud,
                "mode": root.isICloud ? "icloud" : "local",
            ]
        }
    }

    @objc func listProjects(_ call: CAPPluginCall) {
        run(call) { [self] in
            let root = try storageRoot().url
            let folders = try files.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])
            var projects: [[String: Any]] = []
            for folder in folders {
                guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
                let metadataURL = folder.appendingPathComponent("_project.json")
                guard var metadata = try? readJSON(metadataURL) else { continue }
                let documents = (try? files.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
                metadata["docCount"] = documents.filter { $0.pathExtension == "json" && $0.lastPathComponent != "_project.json" }.count
                projects.append(metadata)
            }
            projects.sort { (($0["updatedAt"] as? String) ?? "") > (($1["updatedAt"] as? String) ?? "") }
            return ["items": projects]
        }
    }

    @objc func createProject(_ call: CAPPluginCall) {
        let title = call.getString("title")?.trimmingCharacters(in: .whitespacesAndNewlines)
        run(call) { [self] in
            let id = makeID()
            let root = try storageRoot().url
            let folder = root.appendingPathComponent(id, isDirectory: true)
            try files.createDirectory(at: folder, withIntermediateDirectories: true)
            let now = timestamp
            let project: [String: Any] = [
                "id": id,
                "title": (title?.isEmpty == false ? title! : "كتاب جديد"),
                "gradient": NSNull(),
                "docCount": 0,
                "createdAt": now,
                "updatedAt": now,
                "revision": 1,
            ]
            try writeJSON(project, to: folder.appendingPathComponent("_project.json"))
            return ["item": project]
        }
    }

    @objc func deleteProject(_ call: CAPPluginCall) {
        guard let projectID = call.getString("projectId") else { call.reject("معرّف الكتاب مفقود"); return }
        run(call) { [self] in
            let root = try storageRoot().url
            try files.removeItem(at: try projectURL(projectID, root: root))
            return ["ok": true]
        }
    }

    @objc func listDocuments(_ call: CAPPluginCall) {
        guard let projectID = call.getString("projectId") else { call.reject("معرّف الكتاب مفقود"); return }
        run(call) { [self] in
            let root = try storageRoot().url
            let folder = try projectURL(projectID, root: root)
            let urls = try files.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            var documents = urls
                .filter { $0.pathExtension == "json" && $0.lastPathComponent != "_project.json" }
                .compactMap { try? readJSON($0) }
            documents.sort { (($0["createdAt"] as? String) ?? "") < (($1["createdAt"] as? String) ?? "") }
            return ["items": documents]
        }
    }

    @objc func createDocument(_ call: CAPPluginCall) {
        guard let projectID = call.getString("projectId"),
              var document = call.getObject("document") else {
            call.reject("بيانات الفصل ناقصة")
            return
        }
        run(call) { [self] in
            let root = try storageRoot().url
            let folder = try projectURL(projectID, root: root)
            try files.createDirectory(at: folder, withIntermediateDirectories: true)
            let proposedID = document["id"] as? String
            let documentID = proposedID.flatMap { isSafeID($0) ? $0 : nil } ?? makeID()
            let now = timestamp
            document["id"] = documentID
            document["title"] = (document["title"] as? String) ?? "فصل جديد"
            document["content"] = (document["content"] as? String) ?? "<p></p>"
            document["createdAt"] = (document["createdAt"] as? String) ?? now
            document["updatedAt"] = now
            document["revision"] = 1
            try writeJSON(document, to: folder.appendingPathComponent("\(documentID).json"))
            bumpProject(folder)
            return ["item": document]
        }
    }

    @objc func saveDocument(_ call: CAPPluginCall) {
        guard let projectID = call.getString("projectId"),
              var document = call.getObject("document"),
              let documentID = document["id"] as? String,
              isSafeID(documentID) else {
            call.reject("بيانات الفصل ناقصة")
            return
        }
        run(call) { [self] in
            let root = try storageRoot().url
            let folder = try projectURL(projectID, root: root)
            let url = folder.appendingPathComponent("\(documentID).json")
            let previous = try? readJSON(url)
            let revision = ((previous?["revision"] as? Int) ?? 0) + 1
            document["updatedAt"] = timestamp
            document["revision"] = revision
            try writeJSON(document, to: url)
            bumpProject(folder)
            return ["item": document]
        }
    }

    @objc func deleteDocument(_ call: CAPPluginCall) {
        guard let projectID = call.getString("projectId"),
              let documentID = call.getString("documentId"),
              isSafeID(documentID) else {
            call.reject("معرّف الفصل مفقود")
            return
        }
        run(call) { [self] in
            let root = try storageRoot().url
            let folder = try projectURL(projectID, root: root)
            try files.removeItem(at: folder.appendingPathComponent("\(documentID).json"))
            bumpProject(folder)
            return ["ok": true]
        }
    }

    private enum StorageError: LocalizedError {
        case invalidID, invalidJSON
        var errorDescription: String? {
            switch self {
            case .invalidID: return "معرّف الملف غير صالح"
            case .invalidJSON: return "ملف الكتاب غير صالح"
            }
        }
    }
}

// MARK: - Arabic speech recognition

@objc(AragonSpeechPlugin)
final class AragonSpeechPlugin: CAPPlugin, CAPBridgedPlugin, SFSpeechRecognizerDelegate {
    let identifier = "AragonSpeechPlugin"
    let jsName = "AragonSpeech"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ar-SA"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var timer: Timer?
    private var stopping = false
    private var tapInstalled = false

    @objc func start(_ call: CAPPluginCall) {
        guard task == nil else { call.resolve(["active": true]); return }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                guard status == .authorized else {
                    call.reject("فعّل إذن التعرّف على الكلام من إعدادات iPad", "SPEECH_PERMISSION")
                    return
                }
                self.requestMicrophone(call)
            }
        }
    }

    private func requestMicrophone(_ call: CAPPluginCall) {
        let completion: (Bool) -> Void = { [weak self] granted in
            DispatchQueue.main.async {
                guard let self else { return }
                guard granted else {
                    call.reject("فعّل إذن الميكروفون من إعدادات iPad", "MIC_PERMISSION")
                    return
                }
                do {
                    try self.beginRecognition()
                    call.resolve(["active": true])
                } catch {
                    call.reject("تعذّر تشغيل الإملاء العربي", "SPEECH_START", error)
                }
            }
        }
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: completion)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(completion)
        }
    }

    private func beginRecognition() throws {
        guard let recognizer, recognizer.isAvailable else { throw SpeechError.unavailable }
        stopping = false
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        recognitionRequest.shouldReportPartialResults = true
        recognitionRequest.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { recognitionRequest.requiresOnDeviceRecognition = true }
        request = recognitionRequest

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            recognitionRequest.append(buffer)
        }
        tapInstalled = true
        audioEngine.prepare()
        try audioEngine.start()

        notifyListeners("speechEvent", data: [
            "type": "ready",
            "locale": "ar-SA",
            "onDevice": recognizer.supportsOnDeviceRecognition,
        ])

        task = recognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result {
                    self.notifyListeners("speechEvent", data: [
                        "type": result.isFinal ? "final" : "partial",
                        "text": result.bestTranscription.formattedString,
                    ])
                    if result.isFinal { self.finish() }
                } else if error != nil, !self.stopping {
                    self.notifyListeners("speechEvent", data: ["type": "error", "message": "تعذّر تحويل الكلام إلى نص — جرّب مرة ثانية"])
                    self.finish()
                }
            }
        }

        timer = Timer.scheduledTimer(withTimeInterval: 55, repeats: false) { [weak self] _ in self?.stopRecognition() }
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopRecognition()
        call.resolve(["ok": true])
    }

    private func stopRecognition() {
        guard task != nil, !stopping else { return }
        stopping = true
        timer?.invalidate()
        timer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        removeAudioTap()
        request?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.finish() }
    }

    private func finish() {
        timer?.invalidate()
        timer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        removeAudioTap()
        task?.cancel()
        task = nil
        request = nil
        stopping = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        notifyListeners("speechEvent", data: ["type": "stopped"])
    }

    private func removeAudioTap() {
        guard tapInstalled else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    private enum SpeechError: Error { case unavailable }
}
