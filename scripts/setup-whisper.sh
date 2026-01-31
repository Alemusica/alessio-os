#!/bin/bash
# ============================================
# Setup whisper.cpp con modello large-v3-turbo
# Ottimizzato per Apple Silicon (Metal + ANE)
# STT italiano locale, zero token
# ============================================

set -e

WHISPER_DIR="$HOME/.local/share/whisper.cpp"
MODEL="large-v3-turbo"

echo "=== ALESSIO-OS: Setup Whisper.cpp STT ==="

# 1. Installa whisper.cpp via brew se non presente
if ! command -v whisper-cpp &> /dev/null; then
    echo "[1/4] Installazione whisper.cpp..."
    brew install whisper-cpp
else
    echo "[1/4] whisper.cpp già installato ✓"
fi

# 2. Scarica modello large-v3-turbo
mkdir -p "$WHISPER_DIR/models"
MODEL_PATH="$WHISPER_DIR/models/ggml-${MODEL}.bin"

if [ ! -f "$MODEL_PATH" ]; then
    echo "[2/4] Download modello $MODEL (~1.5GB)..."
    whisper-cpp-download-ggml-model "$MODEL" 2>/dev/null || {
        # Fallback: download diretto
        curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin" \
            -o "$MODEL_PATH"
    }
else
    echo "[2/4] Modello $MODEL già presente ✓"
fi

# 3. Crea script daemon STT
cat > "$WHISPER_DIR/stt-daemon.sh" << 'DAEMON'
#!/bin/bash
# STT Daemon — ascolta microfono, trascrive, output su stdout
# Usa: pipe output verso orchestratore o file

WHISPER_DIR="$HOME/.local/share/whisper.cpp"
MODEL="$WHISPER_DIR/models/ggml-large-v3-turbo.bin"
AUDIO_FILE="/tmp/alessio-os-stt-buffer.wav"
OUTPUT_DIR="/tmp/alessio-os-stt"

mkdir -p "$OUTPUT_DIR"

echo "[STT] Daemon avviato. Lingua: italiano. Ctrl+C per fermare."

while true; do
    # Registra 5 secondi di audio (configurabile)
    rec -q -r 16000 -c 1 -b 16 "$AUDIO_FILE" trim 0 5 silence 1 0.1 1% 2>/dev/null

    if [ -f "$AUDIO_FILE" ] && [ -s "$AUDIO_FILE" ]; then
        # Trascrivi con whisper.cpp
        RESULT=$(whisper-cpp \
            --model "$MODEL" \
            --language it \
            --no-timestamps \
            --print-progress false \
            --file "$AUDIO_FILE" 2>/dev/null)

        if [ -n "$RESULT" ]; then
            TIMESTAMP=$(date +%s)
            echo "$RESULT"
            # Salva anche su file per pick up asincrono
            echo "{\"ts\":$TIMESTAMP,\"text\":\"$RESULT\"}" >> "$OUTPUT_DIR/transcriptions.jsonl"
        fi
    fi
done
DAEMON

chmod +x "$WHISPER_DIR/stt-daemon.sh"

# 4. Crea LaunchAgent per auto-start (opzionale)
PLIST="$HOME/Library/LaunchAgents/com.alessio-os.stt.plist"
cat > "$PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.alessio-os.stt</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${WHISPER_DIR}/stt-daemon.sh</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/alessio-os-stt.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/alessio-os-stt.err</string>
</dict>
</plist>
PLIST

echo "[3/4] Daemon STT creato: $WHISPER_DIR/stt-daemon.sh"
echo "[4/4] LaunchAgent creato (non abilitato): $PLIST"
echo ""
echo "=== Setup completato ==="
echo ""
echo "Per avviare manualmente:"
echo "  $WHISPER_DIR/stt-daemon.sh"
echo ""
echo "Per avviare come servizio:"
echo "  launchctl load $PLIST"
echo ""
echo "Per testare singolo file:"
echo "  whisper-cpp --model $MODEL_PATH --language it --file audio.wav"
