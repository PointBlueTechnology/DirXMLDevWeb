#!/usr/bin/env python3
"""Derive the DirXML Script grammar table the structured policy editor is driven by.

    tools/dtd2grammar.py <dirxmlscript.dtd> > web/src/policy/grammar.json

Input: the DirXML Script DTD that ships with Designer (plugins/com.novell.idm.policybuilder_*/DTD/).
Output: for every element, its attributes (enumerated values, required, default), the child
elements it may hold in DTD order with how many of each, and whether it holds text. Only the
structure is taken; the DTD itself is not copied into this repository.
"""
import json
import re
import sys


def main(path):
    s = open(path, encoding="utf-8", errors="replace").read()
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    entities = dict(re.findall(r'<!ENTITY\s+%\s+([\w.-]+)\s+"([^"]*)"\s*>', s, flags=re.S))

    def expand(text):
        for _ in range(8):
            new = re.sub(r"%([\w.-]+);", lambda m: entities.get(m.group(1), ""), text)
            if new == text:
                break
            text = new
        return re.sub(r"\s+", " ", text).strip()

    elements = {}
    for name, spec in re.findall(r"<!ELEMENT\s+([\w.-]+)\s+(.*?)>", s, flags=re.S):
        spec = expand(spec)
        children, text = occurrences(spec)
        elements[name] = {"attrs": [], "children": children, "text": text}
    for name, body in re.findall(r"<!ATTLIST\s+([\w.-]+)\s+(.*?)>", s, flags=re.S):
        if name in elements:
            elements[name]["attrs"] = attributes(expand(body))

    def group(entity):
        return [n.strip() for n in expand("%" + entity + ";").split("|") if n.strip()]

    groups = {"conditions": group("CONDITIONS"), "actions": group("ACTIONS"), "tokens": group("TOKENS")}
    # an element that takes every member of a group (any condition, any action, any token) says so
    # once, as {"group": ...}, instead of listing them all
    for el in elements.values():
        for gname, members in groups.items():
            listed = {c["name"]: c for c in el["children"] if "name" in c}
            if members and all(m in listed for m in members):
                first = min(i for i, c in enumerate(el["children"]) if c.get("name") in members)
                sample = listed[members[0]]
                kept = [c for c in el["children"] if c.get("name") not in members]
                kept.insert(min(first, len(kept)), {"group": gname, "min": sample["min"], "max": sample["max"]})
                el["children"] = kept
    version = re.search(r"(\d+\.\d+\.\d+)", path.split("/")[-1])
    json.dump({
        "version": version.group(1) if version else "",
        "groups": groups,
        "elements": elements,
    }, sys.stdout, separators=(",", ":"), sort_keys=False)
    sys.stdout.write("\n")


def attributes(body):
    out = []
    pat = re.compile(r'([\w.:-]+)\s+(\([^)]*\)|[A-Z]+)\s+(#REQUIRED|#IMPLIED|(?:#FIXED\s+)?"[^"]*")')
    for name, typ, dflt in pat.findall(body):
        a = {"name": name, "required": dflt == "#REQUIRED"}
        if typ.startswith("("):
            a["values"] = [v.strip() for v in typ[1:-1].split("|") if v.strip()]
        m = re.search(r'"([^"]*)"', dflt)
        a["default"] = m.group(1) if m else None
        out.append(a)
    return out


def occurrences(spec):
    """Each child name with (min, max) occurrences, in first-appearance order; and whether text is allowed."""
    spec = spec.strip()
    if spec in ("EMPTY", "ANY"):
        return [], False
    tokens = re.findall(r"#PCDATA|[\w.-]+|[(),|?*+]", spec)
    pos = [0]

    def particle():
        tok = tokens[pos[0]]
        if tok == "(":
            pos[0] += 1
            items, sep = [particle()], None
            while tokens[pos[0]] in (",", "|"):
                sep = tokens[pos[0]]
                pos[0] += 1
                items.append(particle())
            pos[0] += 1  # ")"
            node = ("choice" if sep == "|" else "seq", items)
        else:
            pos[0] += 1
            node = ("name", tok)
        q = tokens[pos[0]] if pos[0] < len(tokens) and tokens[pos[0]] in "?*+" else ""
        if q:
            pos[0] += 1
        return (node, q)

    tree = particle()
    order = []

    def walk(p):
        (kind, val), _ = p
        if kind == "name":
            if val != "#PCDATA" and val not in order:
                order.append(val)
        else:
            for i in val:
                walk(i)

    walk(tree)
    INF = None

    def add(a, b):
        return INF if a is INF or b is INF else a + b

    def count(p, name):
        (kind, val), q = p
        if kind == "name":
            lo, hi = (1, 1) if val == name else (0, 0)
        elif kind == "seq":
            lo, hi = 0, 0
            for i in val:
                l, h = count(i, name)
                lo, hi = lo + l, add(hi, h)
        else:
            parts = [count(i, name) for i in val]
            lo = min(l for l, _ in parts)
            hi = INF if any(h is INF for _, h in parts) else max(h for _, h in parts)
        if q == "?":
            lo = 0
        elif q == "*":
            lo, hi = 0, (INF if hi else 0)
        elif q == "+":
            hi = INF if hi else 0
        return lo, hi

    children = []
    for n in order:
        lo, hi = count(tree, n)
        children.append({"name": n, "min": lo, "max": hi})
    return children, "#PCDATA" in tokens


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
