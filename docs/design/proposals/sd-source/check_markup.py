"""Every board must be well-formed: each element closed, in order, nothing left open.

A stray or dropped `</div>` has reached this repo twice and both times it was invisible in a
diff and fine to the eye. This parses rather than looks. Run it on every board before trusting
one, and note the CONTROL check below: the parser is first pointed at an approved board that is
known good, so a parser that silently passes everything fails here instead of in a board.

    python3 check_markup.py                  # every *.dc.html beside this file
    python3 check_markup.py --self-test      # prove the parser can actually fail
"""
import sys, glob, os
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


class Balance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"line {self.getpos()[0]}: </{tag}> closes nothing")
            return
        open_tag, open_line = self.stack[-1]
        if open_tag != tag:
            self.errors.append(
                f"line {self.getpos()[0]}: </{tag}> where <{open_tag}> "
                f"(opened line {open_line}) is still open"
            )
            return
        self.stack.pop()

    def finish(self):
        for tag, line in self.stack:
            self.errors.append(f"line {line}: <{tag}> is never closed")
        return self.errors


def check(text):
    p = Balance()
    p.feed(text)
    return p.finish()


def self_test():
    """The parser must FAIL on both shapes of the bug, or its 'ok' means nothing."""
    here = os.path.dirname(os.path.abspath(__file__))
    # The control is an approved board of the SAME surface these boards propose against, so a
    # parser that cannot read the Sources chrome fails here rather than in a board.
    path = os.path.normpath(os.path.join(here, "../../mockups/SourcesCache.dc.html"))
    good = open(path).read()
    head, sep, tail = good.rpartition("</div>")

    cases = [
        ("an approved board parses clean", good, False),
        ("a stray </div>", good.replace("</x-dc>", "</div>\n</x-dc>", 1), True),
        ("a dropped </div>", head + tail, True),
    ]
    bad = 0
    for name, text, want_fail in cases:
        errs = check(text)
        did_fail = bool(errs)
        ok = did_fail == want_fail
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: "
              f"{'errors' if did_fail else 'clean'}"
              + (f" -> {errs[0]}" if errs else ""))
    return bad


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        print("self-test (the parser must catch both shapes):")
        sys.exit(1 if self_test() else 0)

    if self_test():
        print("markup: SELF-TEST FAILED, so a clean result below would mean nothing")
        sys.exit(1)

    boards = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                           "*.dc.html")))
    if not boards:
        print("markup: no boards found, which is not a pass")
        sys.exit(1)
    fails = 0
    for b in boards:
        errs = check(open(b).read())
        if errs:
            fails += 1
            for e in errs:
                print(f"FAIL {os.path.basename(b)} {e}")
    print(f"markup: {len(boards)} board(s), "
          + (f"{fails} FAILED" if fails else "all well formed"))
    sys.exit(1 if fails else 0)
