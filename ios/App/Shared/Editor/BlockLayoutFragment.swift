import Foundation
import CoreGraphics
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Draws a list line's bullet / round checkbox (Apple Notes style) or a quote's bar in
/// the indent, where the hidden markdown marker would be. The characters stay in the text.
final class BlockLayoutFragment: NSTextLayoutFragment {
    let decoration: BlockDecoration
    static let boxSize: CGFloat = 19

    init(textElement: NSTextElement, range: NSTextRange?, decoration: BlockDecoration) {
        self.decoration = decoration
        super.init(textElement: textElement, range: range)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// The tappable checkbox area, in fragment coordinates. TextKit 2 places a paragraph's
    /// fragment at its indent, so x = 0 is where the text starts and markers sit at negative x.
    var markerRect: CGRect {
        guard let first = textLineFragments.first else { return .zero }
        let start = first.typographicBounds.minX
        let mid = first.typographicBounds.midY
        switch decoration {
        case .task:
            return CGRect(x: start - Self.boxSize - 8, y: mid - Self.boxSize / 2, width: Self.boxSize, height: Self.boxSize)
        case .bullet:
            return CGRect(x: start - 14, y: mid - 3, width: 6, height: 6)
        case .quote:
            return CGRect(x: start - 14, y: 0, width: 3, height: layoutFragmentFrame.height)
        }
    }

    /// Always claim the whole left margin, even before lines are laid out (markerRect is
    /// .zero then). Otherwise the area a checkbox was drawn in isn't redrawn when the line
    /// changes, and a ghost checkbox stays on screen.
    override var renderingSurfaceBounds: CGRect {
        let margin = CGRect(x: -64, y: -4, width: 64, height: layoutFragmentFrame.height + 8)
        return super.renderingSurfaceBounds.union(margin).union(markerRect.insetBy(dx: -2, dy: -2))
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        super.draw(at: point, in: context)
        let r = markerRect.offsetBy(dx: point.x, dy: point.y)
        context.saveGState()
        defer { context.restoreGState() }
        switch decoration {
        case .bullet:
            context.setFillColor(MarkdownStylerColors.soft.cgColor)
            context.fillEllipse(in: r)
        case .task(_, let checked):
            if checked {
                context.setFillColor(MarkdownStylerColors.accent.cgColor)
                context.fillEllipse(in: r)
                context.setStrokeColor(CGColor(gray: 1, alpha: 1))
                context.setLineWidth(1.8)
                context.setLineCap(.round)
                context.setLineJoin(.round)
                context.move(to: CGPoint(x: r.minX + r.width * 0.28, y: r.midY))
                context.addLine(to: CGPoint(x: r.minX + r.width * 0.45, y: r.midY + r.height * (flipped ? 0.17 : -0.17)))
                context.addLine(to: CGPoint(x: r.minX + r.width * 0.73, y: r.midY + r.height * (flipped ? -0.2 : 0.2)))
                context.strokePath()
            } else {
                context.setStrokeColor(MarkdownStylerColors.soft.cgColor)
                context.setLineWidth(1.4)
                context.strokeEllipse(in: r.insetBy(dx: 0.7, dy: 0.7))
            }
        case .quote:
            context.setFillColor(MarkdownStylerColors.accent.withAlphaComponent(0.55).cgColor)
            context.fill(r)
        }
    }

    /// UIKit draws text with y going down; AppKit's text views are flipped too.
    private var flipped: Bool { true }
}

/// Colors read from the main actor once, so drawing (off the main actor) can use them.
enum MarkdownStylerColors {
    #if os(iOS)
    nonisolated(unsafe) static var soft: UIColor = .secondaryLabel
    nonisolated(unsafe) static var accent: UIColor = .systemGreen
    #else
    nonisolated(unsafe) static var soft: NSColor = .secondaryLabelColor
    nonisolated(unsafe) static var accent: NSColor = .systemGreen
    #endif
}

/// Hands out BlockLayoutFragments for decorated paragraphs.
final class BlockFragmentProvider: NSObject, NSTextLayoutManagerDelegate {
    func textLayoutManager(_ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: NSTextLocation,
                           in textElement: NSTextElement) -> NSTextLayoutFragment {
        if let paragraph = textElement as? NSTextParagraph, paragraph.attributedString.length > 0,
           let deco = paragraph.attributedString.attribute(.vortexBlock, at: 0, effectiveRange: nil) as? BlockDecoration {
            return BlockLayoutFragment(textElement: textElement, range: textElement.elementRange, decoration: deco)
        }
        return NSTextLayoutFragment(textElement: textElement, range: textElement.elementRange)
    }
}
