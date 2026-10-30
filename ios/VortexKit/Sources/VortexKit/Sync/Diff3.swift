import Foundation

/// Line-based 3-way merge, a faithful port of node-diff3 (LCS, diffIndices,
/// diff3MergeRegions, diff3Merge with excludeFalseConflicts) so iOS merges
/// exactly like the CLI's `tryDiff3` in src/sync.ts.
public enum Diff3 {
    /// Merged text, or nil when local and remote edits genuinely overlap.
    public static func merge(base: String, local: String, remote: String) -> String? {
        let a = split(local), o = split(base), b = split(remote)
        var out: [Substring] = []
        for region in regions(a, o, b) {
            switch region {
            case .stable(let lines): out += lines
            case .unstable(let aLines, let bLines):
                guard aLines == bLines else { return nil } // false conflicts merge
                out += aLines
            }
        }
        return out.joined(separator: "\n")
    }

    /// JS `s.split("\n")`: always at least one element, keeps empties.
    static func split(_ s: String) -> [Substring] {
        s.split(separator: "\n", omittingEmptySubsequences: false)
    }

    // MARK: LCS (node-diff3's candidate-chain algorithm)

    private final class Candidate {
        let i: Int, j: Int
        let chain: Candidate?
        init(_ i: Int, _ j: Int, _ chain: Candidate?) { self.i = i; self.j = j; self.chain = chain }
    }

    private static func lcs(_ b1: [Substring], _ b2: [Substring]) -> Candidate {
        var classes: [Substring: [Int]] = [:]
        for (j, item) in b2.enumerated() { classes[item, default: []].append(j) }
        var candidates: [Candidate] = [Candidate(-1, -1, nil)]
        for (i, item) in b1.enumerated() {
            var r = 0
            var c = candidates[0]
            for j in classes[item] ?? [] {
                var s = r
                while s < candidates.count {
                    if candidates[s].j < j && (s == candidates.count - 1 || candidates[s + 1].j > j) { break }
                    s += 1
                }
                if s < candidates.count {
                    let fresh = Candidate(i, j, candidates[s])
                    if r == candidates.count { candidates.append(c) } else { candidates[r] = c }
                    r = s + 1
                    c = fresh
                    if r == candidates.count { break }
                }
            }
            if r == candidates.count { candidates.append(c) } else { candidates[r] = c }
        }
        return candidates[candidates.count - 1]
    }

    /// (start1, len1, start2, len2) mismatches, in order.
    private static func diffIndices(_ b1: [Substring], _ b2: [Substring]) -> [(Int, Int, Int, Int)] {
        var result: [(Int, Int, Int, Int)] = []
        var tail1 = b1.count, tail2 = b2.count
        var cand: Candidate? = lcs(b1, b2)
        while let c = cand {
            let m1 = tail1 - c.i - 1, m2 = tail2 - c.j - 1
            tail1 = c.i
            tail2 = c.j
            if m1 != 0 || m2 != 0 { result.append((tail1 + 1, m1, tail2 + 1, m2)) }
            cand = c.chain
        }
        return result.reversed()
    }

    // MARK: Merge regions

    enum Region {
        case stable([Substring])
        case unstable(a: [Substring], b: [Substring])
    }

    private struct Hunk {
        let isA: Bool, oStart: Int, oLength: Int, abStart: Int, abLength: Int, order: Int
    }

    static func regions(_ a: [Substring], _ o: [Substring], _ b: [Substring]) -> [Region] {
        var hunks: [Hunk] = []
        for h in diffIndices(o, a) { hunks.append(Hunk(isA: true, oStart: h.0, oLength: h.1, abStart: h.2, abLength: h.3, order: hunks.count)) }
        for h in diffIndices(o, b) { hunks.append(Hunk(isA: false, oStart: h.0, oLength: h.1, abStart: h.2, abLength: h.3, order: hunks.count)) }
        // JS Array.sort is stable; keep insertion order on ties.
        hunks.sort { $0.oStart != $1.oStart ? $0.oStart < $1.oStart : $0.order < $1.order }

        var results: [Region] = []
        var curr = 0
        func advance(to end: Int) {
            if end > curr {
                results.append(.stable(Array(o[curr..<end])))
                curr = end
            }
        }
        var idx = 0
        while idx < hunks.count {
            let first = hunks[idx]
            idx += 1
            let regionStart = first.oStart
            var regionEnd = first.oStart + first.oLength
            var group = [first]
            advance(to: regionStart)
            while idx < hunks.count {
                let next = hunks[idx]
                if next.oStart > regionEnd { break }
                regionEnd = max(regionEnd, next.oStart + next.oLength)
                group.append(next)
                idx += 1
            }
            if group.count == 1 {
                if first.abLength > 0 {
                    let buf = first.isA ? a : b
                    results.append(.stable(Array(buf[first.abStart..<(first.abStart + first.abLength)])))
                }
            } else {
                // bounds: [abMin, abMax, oMin, oMax] per side
                var ba = [a.count, -1, o.count, -1]
                var bb = [b.count, -1, o.count, -1]
                for h in group {
                    let oEnd = h.oStart + h.oLength, abEnd = h.abStart + h.abLength
                    if h.isA {
                        ba = [min(h.abStart, ba[0]), max(abEnd, ba[1]), min(h.oStart, ba[2]), max(oEnd, ba[3])]
                    } else {
                        bb = [min(h.abStart, bb[0]), max(abEnd, bb[1]), min(h.oStart, bb[2]), max(oEnd, bb[3])]
                    }
                }
                let aStart = ba[0] + (regionStart - ba[2]), aEnd = ba[1] + (regionEnd - ba[3])
                let bStart = bb[0] + (regionStart - bb[2]), bEnd = bb[1] + (regionEnd - bb[3])
                results.append(.unstable(a: slice(a, aStart, aEnd), b: slice(b, bStart, bEnd)))
            }
            curr = regionEnd
        }
        advance(to: o.count)
        return results
    }

    /// JS `Array.slice` semantics: negatives count from the end, clamps, inverted = empty.
    private static func slice(_ arr: [Substring], _ start: Int, _ end: Int) -> [Substring] {
        func norm(_ i: Int) -> Int { i < 0 ? max(0, arr.count + i) : min(i, arr.count) }
        let s = norm(start), e = norm(end)
        return s < e ? Array(arr[s..<e]) : []
    }
}
