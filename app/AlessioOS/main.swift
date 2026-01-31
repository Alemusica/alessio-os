/**
 * AlessioOS — macOS Native Wrapper
 *
 * WKWebView che carica la dashboard da localhost.
 * Feature native: Cmd+F search, title bar, dock icon.
 *
 * Il web server (src/dashboard/server.ts) gira indipendente.
 * Questo wrapper è solo un client — zero logica di business.
 */

import Cocoa
import WebKit
import Speech
import AVFoundation

// ==================== CONFIG ====================

let DASHBOARD_PORT = ProcessInfo.processInfo.environment["PORT"] ?? "3777"
let DASHBOARD_URL = "http://127.0.0.1:\(DASHBOARD_PORT)"

// ==================== APP DELEGATE ====================

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var searchBar: SearchBarController!
    var navDelegate: NavigationDelegate!
    var uiDelegate: WebUIDelegate!
    var scriptHandler: ScriptMessageHandler!
    var nativeSTT: NativeSTT!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Window
        let frame = NSRect(x: 0, y: 0, width: 1400, height: 900)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "AlessioOS"
        window.center()
        window.setFrameAutosaveName("AlessioOS.MainWindow")

        // Title bar styling — dark, minimal
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.08, alpha: 1.0)
        window.appearance = NSAppearance(named: .darkAqua)

        // WebView config
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.preferences.setValue(true, forKey: "mediaDevicesEnabled")
        config.preferences.setValue(false, forKey: "mediaCaptureRequiresSecureConnection")

        // JS → Swift bridge
        scriptHandler = ScriptMessageHandler()
        let contentController = config.userContentController
        contentController.add(scriptHandler, name: "alessioOS")

        // Inject STT shim BEFORE page JS loads (atDocumentStart)
        // Kill Web Speech API immediately so dashboard never sees it
        let earlyShim = WKUserScript(source: """
            // PTI: stt.engine = 'apple-native' — kill Web Speech API before page loads
            Object.defineProperty(window, 'SpeechRecognition', { value: undefined, writable: false });
            Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, writable: false });
            window._alessioOSNative = true;
            console.log('[AlessioOS] Early shim: Web Speech API killed at documentStart');
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        contentController.addUserScript(earlyShim)

        webView = WKWebView(frame: .zero, configuration: config)
        navDelegate = NavigationDelegate()
        uiDelegate = WebUIDelegate()
        webView.navigationDelegate = navDelegate
        webView.uiDelegate = uiDelegate

        // Load dashboard
        if let url = URL(string: DASHBOARD_URL) {
            webView.load(URLRequest(url: url))
        }

        window.contentView = webView

        // Native STT (SFSpeechRecognizer — on-device, italiano)
        nativeSTT = NativeSTT(webView: webView)

        // Search bar overlay
        searchBar = SearchBarController(webView: webView, window: window)

        // Menu
        setupMenu()

        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // ==================== MENU ====================

    func setupMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About AlessioOS", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        let appMenuItem = NSMenuItem()
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Edit menu (for Cmd+C, Cmd+V, Cmd+A, Cmd+F)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Find", action: #selector(toggleSearch), keyEquivalent: "f"))
        let editMenuItem = NSMenuItem()
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View menu
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadDashboard), keyEquivalent: "r"))
        viewMenu.addItem(NSMenuItem(title: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "b"))
        let viewMenuItem = NSMenuItem()
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Actions menu (AOS — internal API)
        let actionsMenu = NSMenu(title: "Actions")
        actionsMenu.addItem(NSMenuItem(title: "Toggle STT", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "stt.toggle" as NSString
        actionsMenu.addItem(NSMenuItem(title: "Design Tokens", action: #selector(aosAction(_:)), keyEquivalent: ","))
        actionsMenu.items.last?.representedObject = "design.tokens" as NSString
        actionsMenu.addItem(NSMenuItem(title: "Night Mode", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "design.night" as NSString
        actionsMenu.addItem(NSMenuItem(title: "PTI Probe", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "design.probe" as NSString
        actionsMenu.addItem(NSMenuItem.separator())
        actionsMenu.addItem(NSMenuItem(title: "Toggle Terminal", action: #selector(aosAction(_:)), keyEquivalent: "t"))
        actionsMenu.items.last?.representedObject = "terminal.toggle" as NSString
        actionsMenu.addItem(NSMenuItem(title: "Debug Panel", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "debug.toggle" as NSString
        actionsMenu.addItem(NSMenuItem(title: "Log AOS State", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "debug.state" as NSString
        let actionsMenuItem = NSMenuItem()
        actionsMenuItem.submenu = actionsMenu
        mainMenu.addItem(actionsMenuItem)

        // Dev menu
        let devMenu = NSMenu(title: "Dev")
        let restartItem = NSMenuItem(title: "Restart Dashboard", action: #selector(restartDashboard), keyEquivalent: "R")
        restartItem.keyEquivalentModifierMask = [.command, .shift]
        devMenu.addItem(restartItem)
        devMenu.addItem(NSMenuItem(title: "Open Dev Tools", action: #selector(openDevTools), keyEquivalent: "i"))
        let devMenuItem = NSMenuItem()
        devMenuItem.submenu = devMenu
        mainMenu.addItem(devMenuItem)

        NSApplication.shared.mainMenu = mainMenu
    }

    @objc func toggleSearch() {
        searchBar.toggle()
    }

    @objc func reloadDashboard() {
        if let url = URL(string: DASHBOARD_URL) {
            webView.load(URLRequest(url: url))
        }
    }

    @objc func openInBrowser() {
        if let url = URL(string: DASHBOARD_URL) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func restartDashboard() {
        print("[AlessioOS] Restarting dashboard server...")
        // Kill existing node/tsx processes running the dashboard
        let kill = Process()
        kill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        kill.arguments = ["-f", "tsx src/index.ts"]
        try? kill.run()
        kill.waitUntilExit()

        // Start dashboard server again
        let projectDir = ProcessInfo.processInfo.environment["ALESSIO_OS_DIR"]
            ?? "\(NSHomeDirectory())/alessio-os"
        let start = Process()
        start.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        start.arguments = ["npm", "run", "dev"]
        start.currentDirectoryURL = URL(fileURLWithPath: projectDir)
        start.environment = ProcessInfo.processInfo.environment
        try? start.run()

        // Wait a bit then reload
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.reloadDashboard()
            print("[AlessioOS] Dashboard reloaded")
        }
    }

    @objc func openDevTools() {
        aosRun("terminal.toggle")
    }

    // ── AOS Bridge: Swift → JS action system ──
    @objc func aosAction(_ sender: NSMenuItem) {
        guard let actionName = sender.representedObject as? String else { return }
        aosRun(actionName)
    }

    func aosRun(_ action: String) {
        let js = "window.AOS && window.AOS.run('\(action)')"
        webView.evaluateJavaScript(js, completionHandler: nil)
        print("[AOS] \(action)")
    }
}

// ==================== SEARCH BAR ====================

class SearchBarController: NSObject, NSTextFieldDelegate {
    let webView: WKWebView
    let window: NSWindow
    var searchField: NSTextField?
    var containerView: NSView?
    var isVisible = false

    init(webView: WKWebView, window: NSWindow) {
        self.webView = webView
        self.window = window
    }

    func toggle() {
        if isVisible {
            hide()
        } else {
            show()
        }
    }

    func show() {
        guard !isVisible, let contentView = window.contentView else { return }

        // Container — dark bar at top
        let container = NSView(frame: NSRect(x: 0, y: contentView.bounds.height - 40, width: contentView.bounds.width, height: 40))
        container.autoresizingMask = [.width, .minYMargin]
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(red: 0.12, green: 0.12, blue: 0.12, alpha: 0.95).cgColor

        // Search field
        let field = NSTextField(frame: NSRect(x: 12, y: 6, width: container.bounds.width - 24, height: 28))
        field.autoresizingMask = [.width]
        field.placeholderString = "Search projects..."
        field.font = NSFont(name: "Helvetica Neue", size: 14)
        field.isBordered = true
        field.bezelStyle = .roundedBezel
        field.focusRingType = .none
        field.delegate = self
        field.target = self
        field.action = #selector(searchChanged(_:))

        container.addSubview(field)
        contentView.addSubview(container)

        searchField = field
        containerView = container
        isVisible = true

        window.makeFirstResponder(field)
    }

    func hide() {
        containerView?.removeFromSuperview()
        containerView = nil
        searchField = nil
        isVisible = false
        // Clear search in web
        webView.evaluateJavaScript("window.alessioOSSearch && window.alessioOSSearch('')", completionHandler: nil)
        window.makeFirstResponder(webView)
    }

    @objc func searchChanged(_ sender: NSTextField) {
        let query = sender.stringValue
        let escaped = query.replacingOccurrences(of: "'", with: "\\'")
        webView.evaluateJavaScript("window.alessioOSSearch && window.alessioOSSearch('\(escaped)')", completionHandler: nil)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            hide()
            return true
        }
        return false
    }
}

// ==================== NAVIGATION DELEGATE ====================

class NavigationDelegate: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("[AlessioOS] Navigation error: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // Server not running — show error page
        let html = """
        <html>
        <body style="background:#111;color:#999;font-family:Helvetica Neue;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
            <h1 style="color:#e0c97f;font-weight:300;font-size:24px">AlessioOS</h1>
            <p>Dashboard server not running</p>
            <code style="color:#666">PORT=\(DASHBOARD_PORT) npm run dashboard</code>
            <p style="margin-top:20px"><small>Cmd+R to retry</small></p>
        </div>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Inject dark scrollbar + native STT shim
        webView.evaluateJavaScript("""
            document.documentElement.style.colorScheme = 'dark';

            // PTI: stt.engine = 'apple-native' (sostituisce Web Speech API)
            // Salto: stt.input → [prompt.testo]
            (function() {
                if (window._nativeSTTReady) return;
                window._nativeSTTReady = true;
                var _sttActive = false;

                console.log('[AlessioOS] Native STT shim injected');
                if (typeof addLog === 'function') addLog('[shim] Native STT bridge attivo', 'event');

                // Override toggleMic — usa bridge nativo invece di Web Speech API
                var _origToggleMic = window.toggleMic;
                window.toggleMic = function() {
                    console.log('[AlessioOS] toggleMic called, active=' + _sttActive);
                    if (typeof addLog === 'function') addLog('[shim] toggleMic → bridge nativo', 'dim');
                    window.webkit.messageHandlers.alessioOS.postMessage({
                        action: _sttActive ? 'stopSTT' : 'toggleSTT'
                    });
                };

                // Kill la Web Speech API per evitare conflitti
                window.SpeechRecognition = undefined;
                window.webkitSpeechRecognition = undefined;
                console.log('[AlessioOS] Web Speech API disabled');

                // Callback da Swift: STT avviato
                window.onSTTStart = function() {
                    console.log('[AlessioOS] onSTTStart');
                    _sttActive = true;
                    var btn = document.getElementById('mic-btn');
                    var prompt = document.getElementById('dz-prompt');
                    if (btn) { btn.classList.add('recording'); btn.textContent = 'Stop'; }
                    if (prompt) { prompt.innerHTML = '<span style="color:var(--accent)">\\u25cf</span> Ascolto...'; }
                    if (typeof addLog === 'function') addLog('STT avviato (Apple Native)', 'event');
                };

                // Callback da Swift: risultato (interim o final)
                window.onSTTResult = function(data) {
                    console.log('[AlessioOS] onSTTResult: ' + JSON.stringify(data));
                    var prompt = document.getElementById('dz-prompt');
                    if (prompt && data.text) {
                        prompt.innerHTML = '<span style="color:var(--accent)">\\u25cf</span> ' +
                            data.text.substring(0, 120);
                    }
                    if (data.isFinal && data.text) {
                        var input = document.querySelector('.cmd-input');
                        if (input) { input.value = data.text; input.focus(); }
                        if (typeof addLog === 'function') addLog('STT: "' + data.text.substring(0, 80) + '"', 'event');
                    }
                };

                // Callback da Swift: STT fermato
                window.onSTTStop = function() {
                    console.log('[AlessioOS] onSTTStop');
                    _sttActive = false;
                    var btn = document.getElementById('mic-btn');
                    var prompt = document.getElementById('dz-prompt');
                    if (btn) { btn.classList.remove('recording'); btn.textContent = 'Registra'; }
                    if (prompt) { prompt.textContent = '| Drop OCR/STT'; }
                };

                // Callback da Swift: errore
                window.onSTTError = function(err) {
                    console.log('[AlessioOS] onSTTError: ' + err);
                    _sttActive = false;
                    var btn = document.getElementById('mic-btn');
                    var prompt = document.getElementById('dz-prompt');
                    if (btn) { btn.classList.remove('recording'); btn.textContent = 'Registra'; }
                    if (prompt) { prompt.textContent = '| Drop OCR/STT'; }
                    if (typeof addLog === 'function') addLog('STT errore nativo: ' + err, 'error');
                };
            })();
        """, completionHandler: nil)
    }
}

// ==================== NATIVE STT (SFSpeechRecognizer) ====================
// PTI: stt.engine = 'apple-native'
// Salto: stt.input → [prompt.testo] (via JS bridge)

class NativeSTT {
    let webView: WKWebView
    let speechRecognizer: SFSpeechRecognizer?
    let audioEngine = AVAudioEngine()
    var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    var recognitionTask: SFSpeechRecognitionTask?
    var isListening = false

    init(webView: WKWebView) {
        self.webView = webView
        self.speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "it-IT"))
    }

    func toggle() {
        print("[NativeSTT] toggle() isListening=\(isListening)")
        if isListening {
            stop()
        } else {
            start()
        }
    }

    func start() {
        print("[NativeSTT] start() called")
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            print("[NativeSTT] ERROR: recognizer unavailable")
            jsCallback("onSTTError", data: "'speech_unavailable'")
            return
        }
        print("[NativeSTT] recognizer available, requesting authorization...")

        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            print("[NativeSTT] authorization status: \(status.rawValue)")
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch status {
                case .authorized:
                    print("[NativeSTT] authorized — begin recording")
                    self.beginRecording()
                default:
                    print("[NativeSTT] NOT authorized: \(status.rawValue)")
                    self.jsCallback("onSTTError", data: "'not_authorized_status_\(status.rawValue)'")
                }
            }
        }
    }

    private func beginRecording() {
        // Cancel previous task
        recognitionTask?.cancel()
        recognitionTask = nil

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // On-device when available (macOS 13+)
        if #available(macOS 13, *) {
            request.requiresOnDeviceRecognition = false
        }

        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isListening = true
            print("[NativeSTT] audio engine started — listening")
            jsCallback("onSTTStart", data: "null")
        } catch {
            print("[NativeSTT] audio engine error: \(error)")
            jsCallback("onSTTError", data: "'\(error.localizedDescription)'")
            return
        }

        recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    let escaped = text.replacingOccurrences(of: "'", with: "\\'")
                        .replacingOccurrences(of: "\n", with: "\\n")
                    let isFinal = result.isFinal
                    self.jsCallback("onSTTResult", data: "{ text: '\(escaped)', isFinal: \(isFinal) }")

                    if isFinal {
                        self.stop()
                    }
                }
                if error != nil && self.isListening {
                    self.stop()
                }
            }
        }
    }

    func stop() {
        print("[NativeSTT] stop()")
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask = nil
        isListening = false
        jsCallback("onSTTStop", data: "null")
    }

    private func jsCallback(_ fn: String, data: String) {
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(
                "window.\(fn) && window.\(fn)(\(data))",
                completionHandler: nil
            )
        }
    }
}

// ==================== UI DELEGATE (media permissions) ====================

class WebUIDelegate: NSObject, WKUIDelegate {
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Auto-grant microphone for localhost
        if origin.host == "127.0.0.1" || origin.host == "localhost" {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }
}

// ==================== JS → SWIFT BRIDGE ====================

class ScriptMessageHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        let action = body["action"] as? String ?? ""

        // Get NativeSTT from AppDelegate
        let stt = (NSApplication.shared.delegate as? AppDelegate)?.nativeSTT

        switch action {
        case "setTitle":
            if let title = body["title"] as? String {
                NSApplication.shared.windows.first?.title = "AlessioOS — \(title)"
            }
        case "notify":
            if let text = body["text"] as? String {
                print("[AlessioOS] Notification: \(text)")
            }
        case "toggleSTT":
            stt?.toggle()
        case "startSTT":
            stt?.start()
        case "stopSTT":
            stt?.stop()
        case "aosRun":
            // JS → Swift → JS round-trip (for future native-side action hooks)
            if let actionName = body["name"] as? String {
                (NSApplication.shared.delegate as? AppDelegate)?.aosRun(actionName)
            }
        default:
            print("[AlessioOS] Unknown bridge action: \(action)")
        }
    }
}

// ==================== MAIN ====================

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
