#!/usr/bin/env swift

// ============================================
// Apple Vision OCR — Tool locale zero token
// Usa VNRecognizeTextRequest nativo macOS
// Output: JSON con testo estratto
// ============================================

import Foundation
import Vision
import AppKit

struct OCRResult: Codable {
    let file: String
    let text: String
    let blocks: [TextBlock]
    let language: String
    let confidence: Double
}

struct TextBlock: Codable {
    let text: String
    let confidence: Double
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

func recognizeText(imagePath: String) -> OCRResult? {
    guard let image = NSImage(contentsOfFile: imagePath) else {
        fputs("Errore: impossibile caricare \(imagePath)\n", stderr)
        return nil
    }

    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        fputs("Errore: impossibile convertire in CGImage\n", stderr)
        return nil
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["it-IT", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

    do {
        try handler.perform([request])
    } catch {
        fputs("Errore Vision: \(error)\n", stderr)
        return nil
    }

    guard let observations = request.results else { return nil }

    var fullText = ""
    var blocks: [TextBlock] = []
    var totalConfidence: Double = 0

    for observation in observations {
        guard let topCandidate = observation.topCandidates(1).first else { continue }

        let box = observation.boundingBox
        let block = TextBlock(
            text: topCandidate.string,
            confidence: Double(topCandidate.confidence),
            x: box.origin.x,
            y: box.origin.y,
            width: box.size.width,
            height: box.size.height
        )
        blocks.append(block)
        fullText += topCandidate.string + "\n"
        totalConfidence += Double(topCandidate.confidence)
    }

    let avgConfidence = blocks.isEmpty ? 0 : totalConfidence / Double(blocks.count)

    return OCRResult(
        file: imagePath,
        text: fullText.trimmingCharacters(in: .whitespacesAndNewlines),
        blocks: blocks,
        language: "it+en",
        confidence: avgConfidence
    )
}

// --- MAIN ---
let args = CommandLine.arguments
if args.count < 2 {
    fputs("Uso: ocr-vision <path-immagine> [path2] [path3] ...\n", stderr)
    exit(1)
}

let encoder = JSONEncoder()
encoder.outputFormatting = .prettyPrinted

var results: [OCRResult] = []
for path in args.dropFirst() {
    if let result = recognizeText(imagePath: path) {
        results.append(result)
    }
}

if let data = try? encoder.encode(results),
   let json = String(data: data, encoding: .utf8) {
    print(json)
}
