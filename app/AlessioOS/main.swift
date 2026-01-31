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
import UserNotifications

// ==================== CONFIG ====================

let DASHBOARD_PORT = ProcessInfo.processInfo.environment["PORT"] ?? "3777"
let DASHBOARD_URL = "http://127.0.0.1:\(DASHBOARD_PORT)"

// ==================== APP DELEGATE ====================

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var searchBar: SearchBarController!
    var navDelegate: NavigationDelegate!
    var scriptHandler: ScriptMessageHandler!

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

        // JS → Swift bridge
        scriptHandler = ScriptMessageHandler()
        let contentController = config.userContentController
        contentController.add(scriptHandler, name: "alessioOS")

        webView = WKWebView(frame: .zero, configuration: config)
        navDelegate = NavigationDelegate()
        webView.navigationDelegate = navDelegate

        // Load dashboard
        if let url = URL(string: DASHBOARD_URL) {
            webView.load(URLRequest(url: url))
        }

        window.contentView = webView

        // Search bar overlay
        searchBar = SearchBarController(webView: webView, window: window)

        // Menu
        setupMenu()

        window.makeKeyAndOrderFront(nil)

        // Request notification permission
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
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
        // Inject dark scrollbar + search bridge
        webView.evaluateJavaScript("""
            document.documentElement.style.colorScheme = 'dark';
        """, completionHandler: nil)
    }
}

// ==================== JS → SWIFT BRIDGE ====================

class ScriptMessageHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        let action = body["action"] as? String ?? ""

        switch action {
        case "setTitle":
            if let title = body["title"] as? String {
                NSApplication.shared.windows.first?.title = "AlessioOS — \(title)"
            }
        case "notify":
            if let text = body["text"] as? String {
                let content = UNMutableNotificationContent()
                content.title = "AlessioOS"
                content.body = text
                let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
                UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
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
