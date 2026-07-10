#!/usr/bin/env python3
"""Aggregate Slither + Semgrep contract-scan findings into one report.

Reads slither.json and semgrep.json (either may be missing/empty), writes:
  - scan-summary.md   (sticky PR comment / step summary body)
  - scan-gate.txt     ("fail" or "pass" — High/Critical findings block the PR)

Severity gate (mirrors the repo's alerting tiers):
  BLOCK  : Slither impact High  | Semgrep severity ERROR
  WARN   : Slither impact Medium| Semgrep severity WARNING
  INFO   : everything else (listed, never blocks)
"""
import json
import os
import sys

MARKER = "<!-- contract-security-scan -->"


def load(path):
    try:
        # utf-8-sig: tolerate a BOM (e.g. files written by PowerShell) — a BOM
        # would otherwise fail json.load and silently zero the findings.
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def slither_findings(data):
    """slither --json: {results: {detectors: [{check, impact, confidence, description, elements}]}}"""
    out = []
    for d in (data or {}).get("results", {}).get("detectors", []):
        elems = d.get("elements") or [{}]
        src = (elems[0].get("source_mapping") or {})
        fname = src.get("filename_short") or src.get("filename_relative") or "?"
        lines = src.get("lines") or []
        out.append({
            "tool": "slither",
            "rule": d.get("check", "?"),
            "severity": d.get("impact", "Informational"),
            "confidence": d.get("confidence", "?"),
            "file": fname,
            "line": lines[0] if lines else 0,
            "detail": (d.get("description") or "").strip().split("\n")[0][:200],
        })
    return out


def semgrep_findings(data):
    """semgrep --json: {results: [{check_id, path, start: {line}, extra: {severity, message}}]}"""
    out = []
    for r in (data or {}).get("results", []):
        out.append({
            "tool": "semgrep",
            "rule": r.get("check_id", "?").split(".")[-1],
            "severity": (r.get("extra") or {}).get("severity", "INFO"),
            "confidence": "-",
            "file": r.get("path", "?"),
            "line": (r.get("start") or {}).get("line", 0),
            "detail": ((r.get("extra") or {}).get("message") or "").strip().split("\n")[0][:200],
        })
    return out


def tier(f):
    sev = f["severity"].lower()
    if f["tool"] == "slither":
        return "block" if sev == "high" else "warn" if sev == "medium" else "info"
    return "block" if sev == "error" else "warn" if sev == "warning" else "info"


def main():
    findings = slither_findings(load("slither.json")) + semgrep_findings(load("semgrep.json"))
    blocks = [f for f in findings if tier(f) == "block"]
    warns = [f for f in findings if tier(f) == "warn"]
    infos = [f for f in findings if tier(f) == "info"]

    status = "🔴 **FAILED** — high-severity findings block this merge" if blocks else "🟢 **PASSED**"
    lines = [
        MARKER,
        "## 🛡️ Contract Security Scan",
        "",
        status,
        "",
        f"| Tier | Count |",
        f"|---|---|",
        f"| 🔴 Blocking (Slither High / Semgrep ERROR) | {len(blocks)} |",
        f"| 🟡 Warning (Medium / WARNING) | {len(warns)} |",
        f"| 🔵 Info | {len(infos)} |",
        "",
    ]
    shown = blocks + warns
    if shown:
        lines += [
            "| Sev | Tool | Rule | Location | Finding |",
            "|---|---|---|---|---|",
        ]
        for f in shown[:40]:
            icon = "🔴" if tier(f) == "block" else "🟡"
            detail = f["detail"].replace("|", "\\|")
            lines.append(f"| {icon} {f['severity']} | {f['tool']} | `{f['rule']}` | `{f['file']}:{f['line']}` | {detail} |")
        if len(shown) > 40:
            lines.append(f"\n…and {len(shown) - 40} more (see SARIF artifacts).")
    else:
        lines.append("No blocking or warning findings. Info-tier results are in the SARIF artifacts.")
    lines += ["", "_Engines: Slither (AST/dataflow) + Semgrep p/smart-contracts (DeFi-exploit patterns). SARIF attached as workflow artifacts._"]

    with open("scan-summary.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    with open("scan-gate.txt", "w", encoding="utf-8") as f:
        f.write("fail" if blocks else "pass")
    print(f"findings: block={len(blocks)} warn={len(warns)} info={len(infos)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
