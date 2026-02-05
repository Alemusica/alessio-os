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
import CoreAudio
import AudioToolbox

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
        window.appearance = nil  // Follow system appearance for better font rendering

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
        webView.allowsBackForwardNavigationGestures = true
        // Better text rendering — match Safari quality
        webView.setValue(false, forKey: "drawsBackground")
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
        // Theme submenu
        let themeSubmenu = NSMenu(title: "Theme")
        let themes: [(String, String, String)] = [
            ("Luce — Swiss Warm", "default", ""),
            ("Notte — Carbon Amber", "night", ""),
            ("Primavera — Sage & Peach", "primavera", ""),
            ("Estate — Sea & Sand", "estate", ""),
            ("Ellenica — Aegean Blue", "ellenica", ""),
            ("Benessere — Mineral Spa", "benessere", ""),
        ]
        for (title, themeId, key) in themes {
            let item = NSMenuItem(title: title, action: #selector(setTheme(_:)), keyEquivalent: key)
            item.representedObject = themeId as NSString
            themeSubmenu.addItem(item)
        }
        let themeMenuItem = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
        themeMenuItem.submenu = themeSubmenu
        actionsMenu.addItem(themeMenuItem)

        actionsMenu.addItem(NSMenuItem(title: "PTI Probe", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "design.probe" as NSString
        // Audio submenu
        let audioSubmenu = NSMenu(title: "Audio")
        audioSubmenu.addItem(NSMenuItem(title: "Audio Status…", action: #selector(showAudioStatus), keyEquivalent: ""))
        audioSubmenu.addItem(NSMenuItem(title: "Test Microphone (2s)…", action: #selector(testMicrophone), keyEquivalent: ""))
        audioSubmenu.addItem(NSMenuItem.separator())
        audioSubmenu.addItem(NSMenuItem(title: "Restart CoreAudio", action: #selector(restartCoreAudio), keyEquivalent: ""))
        audioSubmenu.addItem(NSMenuItem(title: "Open Sound Settings", action: #selector(openSoundSettings), keyEquivalent: ""))
        let audioMenuItem = NSMenuItem(title: "Audio", action: nil, keyEquivalent: "")
        audioMenuItem.submenu = audioSubmenu
        actionsMenu.addItem(audioMenuItem)
        actionsMenu.addItem(NSMenuItem.separator())
        actionsMenu.addItem(NSMenuItem(title: "Toggle Terminal", action: #selector(aosAction(_:)), keyEquivalent: "t"))
        actionsMenu.items.last?.representedObject = "terminal.toggle" as NSString
        actionsMenu.addItem(NSMenuItem(title: "Debug Panel", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "debug.toggle" as NSString
        actionsMenu.addItem(NSMenuItem(title: "Log AOS State", action: #selector(aosAction(_:)), keyEquivalent: ""))
        actionsMenu.items.last?.representedObject = "debug.state" as NSString
        actionsMenu.addItem(NSMenuItem.separator())
        let restartActionItem = NSMenuItem(title: "Restart Server", action: #selector(restartDashboard), keyEquivalent: "R")
        restartActionItem.keyEquivalentModifierMask = [.command, .shift]
        actionsMenu.addItem(restartActionItem)
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

        // Show arcade boot screen
        let bootHtml = """
        <html>
        <head><style>
            @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
            @keyframes scanline { 0%{top:0} 100%{top:100%} }
            body { background:#0a0a0a; color:#e0c97f; font-family:'Courier New',monospace;
                   display:flex; align-items:center; justify-content:center; height:100vh; margin:0;
                   overflow:hidden; }
            .boot { text-align:left; max-width:600px; width:90%; }
            .title { font-size:28px; font-weight:bold; letter-spacing:4px; margin-bottom:20px;
                     text-shadow: 0 0 10px rgba(224,201,127,0.5); }
            .line { font-size:13px; color:#888; margin:3px 0; opacity:0;
                    animation: fadein 0.15s forwards; }
            .line.ok { color:#7a9f6a; }
            .line.warn { color:#c08080; }
            .cursor { display:inline-block; animation:blink 0.7s step-end infinite; }
            .scanline { position:fixed; top:0; left:0; right:0; height:2px;
                       background:rgba(224,201,127,0.08); animation:scanline 3s linear infinite; }
            @keyframes fadein { to { opacity:1 } }
        </style></head>
        <body>
        <div class="scanline"></div>
        <div class="boot" id="boot"></div>
        <script>
            var lines = [
                ['ALESSIO-OS v0.1.0', 'title'],
                ['', ''],
                ['SYSTEM CHECK', ''],
                ['  Memory ........... OK', 'ok'],
                ['  SurrealDB ........ CONNECTING', ''],
                ['  PTI Graph ........ v4.1', 'ok'],
                ['  Delta Engine ..... REACTIVE', 'ok'],
                ['  Paradigm ......... PTI MANIFESTO', 'ok'],
                ['', ''],
                ['LOADING MODULES', ''],
                ['  dashboard/server . \\u2713', 'ok'],
                ['  agents/orchestrator \\u2713', 'ok'],
                ['  pti/graph ........ \\u2713', 'ok'],
                ['  pti/registry ..... \\u2713', 'ok'],
                ['  integrations/gh .. \\u2713', 'ok'],
                ['  tools/ocr ........ \\u2713', 'ok'],
                ['  tools/stt ........ \\u2713', 'ok'],
                ['', ''],
                ['KILLING OLD PROCESSES...', 'warn'],
                ['SPAWNING DASHBOARD SERVER...', ''],
                ['', ''],
                ['  > npm run dashboard', ''],
                ['  > PORT=\(DASHBOARD_PORT)', ''],
                ['', ''],
                ['WAITING FOR SERVER...', ''],
            ];
            var boot = document.getElementById('boot');
            var delay = 0;
            lines.forEach(function(l, i) {
                delay += (l[1] === 'title' ? 200 : 60 + Math.random() * 40);
                setTimeout(function() {
                    var d = document.createElement('div');
                    d.className = 'line' + (l[1] ? ' ' + l[1] : '');
                    d.style.animationDelay = '0s';
                    if (l[1] === 'title') {
                        d.innerHTML = l[0];
                        d.className = 'title line';
                    } else {
                        d.textContent = l[0];
                    }
                    boot.appendChild(d);
                    boot.scrollTop = boot.scrollHeight;
                }, delay);
            });
            // Blinking cursor at the end
            setTimeout(function() {
                var c = document.createElement('div');
                c.className = 'line';
                c.style.opacity = '1';
                c.innerHTML = '  <span class="cursor">\\u2588</span>';
                boot.appendChild(c);
            }, delay + 100);
        </script>
        </body></html>
        """
        webView.loadHTMLString(bootHtml, baseURL: nil)

        // Kill existing node/tsx processes running the dashboard
        let kill = Process()
        kill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        kill.arguments = ["-f", "tsx src/index.ts"]
        try? kill.run()
        kill.waitUntilExit()

        // Also kill by port
        let killPort = Process()
        killPort.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        killPort.arguments = ["bash", "-c", "lsof -ti :\(DASHBOARD_PORT) | xargs kill -9 2>/dev/null"]
        try? killPort.run()
        killPort.waitUntilExit()

        // Start dashboard server — use full path for npm/npx (not in app PATH)
        let projectDir = ProcessInfo.processInfo.environment["ALESSIO_OS_DIR"]
            ?? "\(NSHomeDirectory())/alessio-os"

        let start = Process()
        start.executableURL = URL(fileURLWithPath: "/bin/bash")
        start.arguments = ["-l", "-c", "cd '\(projectDir)' && npx tsx src/index.ts --dashboard"]
        // Inherit env but ensure PATH includes homebrew/node paths
        var env = ProcessInfo.processInfo.environment
        let extraPaths = "/usr/local/bin:/opt/homebrew/bin:\(NSHomeDirectory())/.nvm/versions/node/v22.12.0/bin"
        env["PATH"] = "\(extraPaths):\(env["PATH"] ?? "/usr/bin:/bin")"
        start.environment = env
        start.standardOutput = FileHandle.nullDevice
        start.standardError = FileHandle.nullDevice
        try? start.run()

        // Poll server until it responds, then reload
        pollServerAndReload(attempts: 0)
    }

    private func pollServerAndReload(attempts: Int) {
        guard attempts < 30 else {
            print("[AlessioOS] Server failed to start after 30 attempts")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self else { return }
            guard let url = URL(string: DASHBOARD_URL) else { return }
            let task = URLSession.shared.dataTask(with: url) { data, response, error in
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        self.reloadDashboard()
                        print("[AlessioOS] Dashboard reloaded after \(attempts + 1) polls")
                    }
                } else {
                    self.pollServerAndReload(attempts: attempts + 1)
                }
            }
            task.resume()
        }
    }

    @objc func setTheme(_ sender: NSMenuItem) {
        guard let themeId = sender.representedObject as? String else { return }
        let js = "window.applyTheme && window.applyTheme('\(themeId)'); var s = document.getElementById('theme-select'); if(s) s.value = '\(themeId)';"
        webView.evaluateJavaScript(js, completionHandler: nil)
        print("[AOS] theme → \(themeId)")
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

    // ==================== AUDIO DIAGNOSTICS ====================

    @objc func showAudioStatus() {
        var info = ""

        // Default input device via CoreAudio HAL
        var deviceID = AudioDeviceID(0)
        var propSize = UInt32(MemoryLayout<AudioDeviceID>.size)
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let st = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &addr, 0, nil, &propSize, &deviceID
        )

        if st == noErr && deviceID != 0 {
            // Device name
            var nameRef: CFString = "" as CFString
            var nameSize = UInt32(MemoryLayout<CFString>.size)
            var nameAddr = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyDeviceNameCFString,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            AudioObjectGetPropertyData(deviceID, &nameAddr, 0, nil, &nameSize, &nameRef)

            // Sample rate
            var sampleRate: Float64 = 0
            var srSize = UInt32(MemoryLayout<Float64>.size)
            var srAddr = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyNominalSampleRate,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            AudioObjectGetPropertyData(deviceID, &srAddr, 0, nil, &srSize, &sampleRate)

            // Input channels — use AVAudioEngine for simpler access
            let engine = AVAudioEngine()
            let fmt = engine.inputNode.outputFormat(forBus: 0)

            info += "Input Device: \(nameRef)\n"
            info += "Device ID: \(deviceID)\n"
            info += "Sample Rate: \(Int(sampleRate)) Hz\n"
            info += "Engine Format: \(Int(fmt.sampleRate)) Hz, \(fmt.channelCount) ch\n"
        } else {
            info += "⚠ No input device detected\n"
            info += "Status: \(st), Device ID: \(deviceID)\n"
        }

        // List all input devices
        var devicesAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var devSize: UInt32 = 0
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &devicesAddr, 0, nil, &devSize)
        let deviceCount = Int(devSize) / MemoryLayout<AudioDeviceID>.size
        var devices = [AudioDeviceID](repeating: 0, count: deviceCount)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devicesAddr, 0, nil, &devSize, &devices)

        var inputDevices: [String] = []
        for dev in devices {
            var streamAddr = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreams,
                mScope: kAudioObjectPropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain
            )
            var streamSize: UInt32 = 0
            AudioObjectGetPropertyDataSize(dev, &streamAddr, 0, nil, &streamSize)
            if streamSize > 0 {
                var dn: CFString = "" as CFString
                var dns = UInt32(MemoryLayout<CFString>.size)
                var dnAddr = AudioObjectPropertyAddress(
                    mSelector: kAudioDevicePropertyDeviceNameCFString,
                    mScope: kAudioObjectPropertyScopeGlobal,
                    mElement: kAudioObjectPropertyElementMain
                )
                AudioObjectGetPropertyData(dev, &dnAddr, 0, nil, &dns, &dn)
                let marker = dev == deviceID ? " ◀ active" : ""
                inputDevices.append("  • \(dn) (id:\(dev))\(marker)")
            }
        }

        if !inputDevices.isEmpty {
            info += "\nInput Devices:\n" + inputDevices.joined(separator: "\n")
        } else {
            info += "\n⚠ No input devices found"
        }

        // Speech recognizer
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "it-IT"))
        info += "\n\nSpeech (it-IT): \(recognizer?.isAvailable == true ? "available" : "⚠ unavailable")"

        // STT engine state
        info += "\nSTT Engine: listening=\(nativeSTT.isListening), starting=\(nativeSTT.isStarting)"

        let alert = NSAlert()
        alert.messageText = "Audio Status"
        alert.informativeText = info
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Open Sound Settings")
        alert.addButton(withTitle: "Restart CoreAudio")

        let response = alert.runModal()
        if response == .alertSecondButtonReturn {
            openSoundSettings()
        } else if response == .alertThirdButtonReturn {
            restartCoreAudio()
        }
    }

    @objc func testMicrophone() {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        guard format.sampleRate > 0 else {
            let alert = NSAlert()
            alert.messageText = "Mic Test Failed"
            alert.informativeText = "No audio input (sampleRate = 0).\n\nCheck System Settings > Sound > Input."
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Open Sound Settings")
            if alert.runModal() == .alertSecondButtonReturn { openSoundSettings() }
            return
        }

        var peakLevel: Float = 0
        var sampleCount: Int = 0

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            guard let data = buffer.floatChannelData else { return }
            let count = Int(buffer.frameLength)
            for i in 0..<count {
                let level = abs(data[0][i])
                if level > peakLevel { peakLevel = level }
            }
            sampleCount += count
        }

        engine.prepare()
        do {
            try engine.start()
            print("[Audio] Mic test started — recording 2s at \(Int(format.sampleRate))Hz")
        } catch {
            inputNode.removeTap(onBus: 0)
            let alert = NSAlert()
            alert.messageText = "Mic Test Failed"
            alert.informativeText = "Audio engine error: \(error.localizedDescription)"
            alert.alertStyle = .warning
            alert.runModal()
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            engine.stop()
            inputNode.removeTap(onBus: 0)

            let db = peakLevel > 0 ? 20 * log10(peakLevel) : -100
            let working = peakLevel > 0.001

            let alert = NSAlert()
            alert.messageText = working ? "Microphone OK" : "No Audio Detected"
            alert.informativeText = """
            Peak: \(String(format: "%.1f", db)) dB
            Samples: \(sampleCount)
            Format: \(Int(format.sampleRate)) Hz, \(format.channelCount) ch
            Status: \(working ? "✅ Audio input working" : "❌ No signal — check audio device")
            """
            alert.alertStyle = working ? .informational : .warning
            alert.addButton(withTitle: "OK")
            if !working {
                alert.addButton(withTitle: "Open Sound Settings")
            }
            let response = alert.runModal()
            if response == .alertSecondButtonReturn {
                self?.openSoundSettings()
            }
        }
    }

    @objc func openSoundSettings() {
        // macOS 13+ System Settings URL
        if let url = URL(string: "x-apple.systempreferences:com.apple.Sound-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func restartCoreAudio() {
        let script = "do shell script \"killall coreaudiod\" with administrator privileges"
        var error: NSDictionary?
        if let appleScript = NSAppleScript(source: script) {
            appleScript.executeAndReturnError(&error)
            if let error = error {
                print("[Audio] CoreAudio restart error: \(error)")
                let alert = NSAlert()
                alert.messageText = "CoreAudio Restart Failed"
                alert.informativeText = "\(error[NSAppleScript.errorMessage] ?? "Unknown error")"
                alert.alertStyle = .warning
                alert.runModal()
            } else {
                print("[Audio] CoreAudio daemon restarted")
                let alert = NSAlert()
                alert.messageText = "CoreAudio Restarted"
                alert.informativeText = "The audio daemon has been restarted.\nWait 2–3 seconds, then try the microphone."
                alert.runModal()
            }
        }
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
            // Sync colorScheme with active theme (don't force dark)
            (function() {
                var el = document.documentElement;
                var isDark = el.classList.contains('night');
                el.style.colorScheme = isDark ? 'dark' : 'light dark';
                el.style.webkitFontSmoothing = 'antialiased';
                el.style.webkitTextSizeAdjust = '100%';
            })();

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
        """) { _, error in
            if let error = error {
                print("[AlessioOS] STT shim injection error: \(error.localizedDescription)")
            } else {
                print("[AlessioOS] STT shim injected OK")
            }
        }
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
    var isStarting = false
    var accumulatedText: String = ""  // Full accumulated transcription

    init(webView: WKWebView) {
        self.webView = webView
        self.speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "it-IT"))
    }

    func toggle() {
        print("[NativeSTT] toggle() isListening=\(isListening) isStarting=\(isStarting)")
        if isListening || isStarting {
            stop()
        } else {
            start()
        }
    }

    func start() {
        print("[NativeSTT] start() called")
        guard !isStarting else {
            print("[NativeSTT] already starting, ignoring")
            return
        }
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            print("[NativeSTT] ERROR: recognizer unavailable")
            jsCallback("onSTTError", data: "'speech_unavailable'")
            return
        }
        isStarting = true
        print("[NativeSTT] recognizer available, requesting authorization...")

        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            print("[NativeSTT] authorization status: \(status.rawValue)")
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard self.isStarting else { return } // User cancelled during auth
                self.isStarting = false
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

        // Always remove existing tap before installing new one (prevents crash)
        audioEngine.inputNode.removeTap(onBus: 0)

        // Reset accumulated text for new recording session
        accumulatedText = ""

        // Auto-detect: if default input is virtual (Realphones, BlackHole, etc.),
        // switch to MacBook Pro Microphone or first physical mic
        setInputDeviceToPhysicalMic()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true

        // Prefer on-device recognition (no network dependency, lower latency)
        if #available(macOS 13, *) {
            if speechRecognizer?.supportsOnDeviceRecognition == true {
                request.requiresOnDeviceRecognition = true
                print("[NativeSTT] Using ON-DEVICE recognition (it-IT)")
            } else {
                request.requiresOnDeviceRecognition = false
                print("[NativeSTT] On-device NOT available — using server")
            }
        }

        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        // Validate audio format (sampleRate 0 = no audio input device)
        guard recordingFormat.sampleRate > 0 else {
            print("[NativeSTT] ERROR: no audio input (sampleRate=0)")
            jsCallback("onSTTError", data: "'no_audio_input'")
            return
        }

        print("[NativeSTT] Audio format: \(Int(recordingFormat.sampleRate))Hz, \(recordingFormat.channelCount)ch")

        var bufferCount = 0
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
            bufferCount += 1
            if bufferCount == 1 {
                print("[NativeSTT] First audio buffer received (\(buffer.frameLength) frames)")
            } else if bufferCount % 100 == 0 {
                print("[NativeSTT] Buffer #\(bufferCount)")
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isListening = true
            print("[NativeSTT] Audio engine started — listening")
            jsCallback("onSTTStart", data: "null")
        } catch {
            print("[NativeSTT] audio engine error: \(error)")
            audioEngine.inputNode.removeTap(onBus: 0)
            jsCallback("onSTTError", data: "'\(error.localizedDescription)'")
            return
        }

        recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    // Accumulate FULL text (SFSpeechRecognizer already gives us cumulative result)
                    self.accumulatedText = text
                    print("[NativeSTT] Result: '\(text)' isFinal=\(result.isFinal)")
                    // Escape backslash FIRST, then quotes
                    let escaped = text
                        .replacingOccurrences(of: "\\", with: "\\\\")
                        .replacingOccurrences(of: "'", with: "\\'")
                        .replacingOccurrences(of: "\n", with: "\\n")
                    let isFinal = result.isFinal
                    self.jsCallback("onSTTResult", data: "{ text: '\(escaped)', isFinal: \(isFinal) }")

                    if isFinal {
                        self.stop()
                    }
                }
                if let error = error {
                    print("[NativeSTT] Recognition error: \(error.localizedDescription) (listening=\(self.isListening))")
                    if self.isListening {
                        self.jsCallback("onSTTError", data: "'\(error.localizedDescription)'")
                        self.stop()
                    }
                }
            }
        }

        if recognitionTask == nil {
            print("[NativeSTT] ⚠ recognitionTask is NIL — recognizer may be unavailable")
            jsCallback("onSTTError", data: "'recognition_task_nil'")
            stop()
        } else {
            print("[NativeSTT] Recognition task created OK")
        }
    }

    // ── AUTO-DETECT PHYSICAL MICROPHONE ──
    // If default input is a virtual audio device (Realphones, BlackHole, etc.),
    // switch the audio engine to MacBook Pro Microphone or first physical mic.
    private func setInputDeviceToPhysicalMic() {
        var defaultID = AudioDeviceID(0)
        var propSize = UInt32(MemoryLayout<AudioDeviceID>.size)
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &addr, 0, nil, &propSize, &defaultID
        )

        let defaultName = getAudioDeviceName(defaultID)
        let lower = defaultName.lowercased()

        let virtualKeywords = ["realphones", "blackhole", "soundflower", "loopback",
                               "merging ravenna", "aggregate", "microsoft teams"]
        let isVirtual = virtualKeywords.contains(where: { lower.contains($0) })

        if !isVirtual {
            print("[NativeSTT] Default input: \(defaultName) — physical device, OK")
            return
        }

        print("[NativeSTT] ⚠ Default input '\(defaultName)' is VIRTUAL — searching for physical mic...")

        guard let physicalMicID = findPhysicalMic(excluding: defaultID) else {
            print("[NativeSTT] ⚠ No physical mic found — using default anyway")
            return
        }

        // Set the physical mic on the audio engine's input node audio unit
        guard let au = audioEngine.inputNode.audioUnit else {
            print("[NativeSTT] ⚠ No audio unit on input node")
            return
        }

        var devID = physicalMicID
        let status = AudioUnitSetProperty(
            au,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &devID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )

        let micName = getAudioDeviceName(physicalMicID)
        if status == noErr {
            print("[NativeSTT] ✓ Switched input to: \(micName) (id:\(physicalMicID))")
        } else {
            print("[NativeSTT] ⚠ Failed to set input device (OSStatus: \(status))")
        }
    }

    private func getAudioDeviceName(_ deviceID: AudioDeviceID) -> String {
        var nameRef: CFString = "" as CFString
        var nameSize = UInt32(MemoryLayout<CFString>.size)
        var nameAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectGetPropertyData(deviceID, &nameAddr, 0, nil, &nameSize, &nameRef)
        return nameRef as String
    }

    private func findPhysicalMic(excluding: AudioDeviceID) -> AudioDeviceID? {
        var devicesAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var devSize: UInt32 = 0
        AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &devicesAddr, 0, nil, &devSize
        )
        let count = Int(devSize) / MemoryLayout<AudioDeviceID>.size
        var devices = [AudioDeviceID](repeating: 0, count: count)
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &devicesAddr, 0, nil, &devSize, &devices
        )

        let virtualKeywords = ["realphones", "blackhole", "soundflower", "loopback",
                               "merging ravenna", "aggregate", "microsoft teams"]
        var fallback: AudioDeviceID? = nil

        for dev in devices {
            guard dev != excluding else { continue }
            // Check device has input streams
            var streamAddr = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreams,
                mScope: kAudioObjectPropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain
            )
            var streamSize: UInt32 = 0
            AudioObjectGetPropertyDataSize(dev, &streamAddr, 0, nil, &streamSize)
            guard streamSize > 0 else { continue }

            let name = getAudioDeviceName(dev).lowercased()
            if virtualKeywords.contains(where: { name.contains($0) }) { continue }

            // Prefer built-in mic
            if name.contains("macbook") || name.contains("built-in") || name.contains("internal") {
                return dev
            }
            if fallback == nil { fallback = dev }
        }
        return fallback
    }

    func stop() {
        print("[NativeSTT] stop() isListening=\(isListening)")
        let wasListening = isListening
        isListening = false
        isStarting = false

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)

        // If user manually stopped (not auto-stopped by isFinal), force send accumulated result
        if wasListening && !accumulatedText.isEmpty {
            print("[NativeSTT] Manual stop — forcing final result: '\(accumulatedText)'")
            let escaped = accumulatedText
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
            jsCallback("onSTTResult", data: "{ text: '\(escaped)', isFinal: true }")
        }

        // Signal end of audio
        recognitionRequest?.endAudio()
        recognitionRequest = nil

        // Clean up recognition task
        recognitionTask?.cancel()
        recognitionTask = nil
        accumulatedText = ""

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
