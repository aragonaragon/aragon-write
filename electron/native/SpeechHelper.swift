import AppKit
import AVFoundation
import Foundation
import Speech

final class SpeechSession: NSObject, SFSpeechRecognizerDelegate {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ar-SA"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var timeout: Timer?
    private var isStopping = false
    private var tapInstalled = false

    func begin() {
        guard let recognizer else {
            emit(["type": "error", "code": "unsupported-locale", "message": "التعرّف الصوتي العربي غير متاح على هذا الجهاز"])
            exitSoon(1)
            return
        }

        recognizer.delegate = self
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                guard status == .authorized else {
                    self.emit(["type": "error", "code": "speech-permission", "message": self.authorizationMessage(status)])
                    self.exitSoon(2)
                    return
                }
                self.requestMicrophoneAccess()
            }
        }
    }

    private func requestMicrophoneAccess() {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            startRecognition()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.startRecognition()
                    } else {
                        self.emit(["type": "error", "code": "microphone-permission", "message": "فعّل إذن الميكروفون من إعدادات الخصوصية في macOS"])
                        self.exitSoon(3)
                    }
                }
            }
        default:
            emit(["type": "error", "code": "microphone-permission", "message": "فعّل إذن الميكروفون من إعدادات الخصوصية في macOS"])
            exitSoon(3)
        }
    }

    private func startRecognition() {
        guard let recognizer, recognizer.isAvailable else {
            emit(["type": "error", "code": "unavailable", "message": "خدمة الإملاء العربي غير متاحة الآن"])
            exitSoon(4)
            return
        }

        let recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        recognitionRequest.shouldReportPartialResults = true
        recognitionRequest.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition {
            recognitionRequest.requiresOnDeviceRecognition = true
        }
        request = recognitionRequest

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            emit(["type": "error", "code": "audio-format", "message": "تعذّر تشغيل مدخل الصوت"])
            exitSoon(5)
            return
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            recognitionRequest.append(buffer)
        }
        tapInstalled = true

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            removeAudioTap()
            emit(["type": "error", "code": "audio-start", "message": "تعذّر تشغيل الميكروفون"])
            exitSoon(6)
            return
        }

        emit([
            "type": "ready",
            "locale": "ar-SA",
            "onDevice": recognizer.supportsOnDeviceRecognition,
        ])

        task = recognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    self.emit(["type": result.isFinal ? "final" : "partial", "text": text])
                    if result.isFinal {
                        self.finishAndExit()
                        return
                    }
                }
                if let error, !self.isStopping {
                    self.emit(["type": "error", "code": "recognition", "message": self.friendlyError(error)])
                    self.finishAndExit(code: 7)
                }
            }
        }

        timeout = Timer.scheduledTimer(withTimeInterval: 55, repeats: false) { [weak self] _ in
            self?.stop()
        }
    }

    func stop() {
        guard !isStopping else { return }
        isStopping = true
        timeout?.invalidate()
        timeout = nil
        if audioEngine.isRunning { audioEngine.stop() }
        removeAudioTap()
        request?.endAudio()

        // Give Speech a short window to deliver its final transcription.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            self?.finishAndExit()
        }
    }

    private func finishAndExit(code: Int32 = 0) {
        timeout?.invalidate()
        timeout = nil
        if audioEngine.isRunning { audioEngine.stop() }
        removeAudioTap()
        task?.cancel()
        task = nil
        request = nil
        emit(["type": "stopped"])
        exitSoon(code)
    }

    private func authorizationMessage(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .denied: return "فعّل إذن التعرّف على الكلام من إعدادات الخصوصية في macOS"
        case .restricted: return "التعرّف على الكلام مقيّد على هذا الجهاز"
        default: return "لم يُمنح إذن التعرّف على الكلام"
        }
    }

    private func friendlyError(_ error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == "kAFAssistantErrorDomain", nsError.code == 1110 {
            return "لم أسمع كلاماً واضحاً — جرّب مرة ثانية"
        }
        return "تعذّر تحويل الكلام إلى نص — جرّب مرة ثانية"
    }

    private func removeAudioTap() {
        guard tapInstalled else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    private func emit(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let line = String(data: data, encoding: .utf8) else { return }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    private func exitSoon(_ code: Int32) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { exit(code) }
    }
}

let session = SpeechSession()

FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    guard !data.isEmpty, let command = String(data: data, encoding: .utf8) else { return }
    if command.split(whereSeparator: \Character.isWhitespace).contains("stop") {
        DispatchQueue.main.async { session.stop() }
    }
}

session.begin()
RunLoop.main.run()
