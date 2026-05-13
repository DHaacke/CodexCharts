#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / "chart-contract" / "templates"


def resolve_default_python() -> str:
    venv_python = ROOT / ".venv" / "bin" / "python"
    if venv_python.exists():
        return venv_python.as_posix()
    return sys.executable


def python_has_module(python_exec: str, module_name: str) -> bool:
    result = subprocess.run(
        [python_exec, "-c", f"import {module_name}"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def fail_missing_xlsxwriter(selected_python: str) -> None:
    venv_python = ROOT / ".venv" / "bin" / "python"
    system_python = sys.executable

    lines = [
        "Missing dependency: xlsxwriter",
        f"Selected Python: {selected_python}",
        "",
        "Install with one of the following:",
    ]

    if venv_python.exists():
        lines.append(f"- {venv_python.as_posix()} -m pip install xlsxwriter")
    lines.append(f"- {system_python} -m pip install xlsxwriter")
    lines.append("")
    lines.append("Then rerun: python3 scripts/generate_excel_templates.py")

    raise RuntimeError("\n".join(lines))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Regenerate all embedded-chart XLSX templates for line/bar/pie/scatter."
    )
    parser.add_argument(
        "--python",
        default=resolve_default_python(),
        help="Python executable to run fill scripts (defaults to current interpreter).",
    )
    return parser.parse_args()


def run_fill_script(
    python_exec: str,
    script_path: Path,
    output_path: Path,
    headers: list[str],
    rows: list[dict],
) -> None:
    payload = {
        "templatePath": output_path.as_posix(),
        "outputPath": output_path.as_posix(),
        "sheetName": "Data",
        "headers": headers,
        "rows": rows,
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        payload_path = Path(f.name)
        json.dump(payload, f)

    try:
        result = subprocess.run(
            [python_exec, script_path.as_posix(), "--payload", payload_path.as_posix()],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            message = "\n".join(v for v in [result.stdout, result.stderr] if v).strip()
            raise RuntimeError(f"{script_path.name} failed\n{message}" if message else f"{script_path.name} failed")
    finally:
        payload_path.unlink(missing_ok=True)


def main() -> None:
    args = parse_args()
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

    if not python_has_module(args.python, "xlsxwriter"):
        # If selected interpreter is missing xlsxwriter, see if either venv or
        # current system Python has it. If neither does, provide friendly
        # install commands and stop before invoking fill scripts.
        venv_python = ROOT / ".venv" / "bin" / "python"
        venv_ok = venv_python.exists() and python_has_module(venv_python.as_posix(), "xlsxwriter")
        system_ok = python_has_module(sys.executable, "xlsxwriter")
        if not (venv_ok or system_ok):
            fail_missing_xlsxwriter(args.python)

    line_rows = [
        {"date": "2025-01-01", "WaterYear": 2200, "Average": 2000, "OptionalSeries": None},
        {"date": "2025-02-01", "WaterYear": 2400, "Average": 2050, "OptionalSeries": None},
        {"date": "2025-03-01", "WaterYear": 2100, "Average": 2150, "OptionalSeries": None},
        {"date": "2025-04-01", "WaterYear": 2600, "Average": 2250, "OptionalSeries": None},
    ]
    run_fill_script(
        args.python,
        ROOT / "scripts" / "fill_excel_template.py",
        TEMPLATE_DIR / "line-series-template.xlsx",
        ["date", "WaterYear", "Average", "OptionalSeries"],
        line_rows,
    )

    bar_rows = [
        {"date": "2025-01-01", "RB": 150, "CT": 110, "BK": 95},
        {"date": "2025-02-01", "RB": 170, "CT": 108, "BK": 102},
        {"date": "2025-03-01", "RB": 165, "CT": 120, "BK": 98},
        {"date": "2025-04-01", "RB": 180, "CT": 116, "BK": 105},
    ]
    run_fill_script(
        args.python,
        ROOT / "scripts" / "fill_excel_template_bar.py",
        TEMPLATE_DIR / "bar-grouped-template.xlsx",
        ["date", "RB", "CT", "BK"],
        bar_rows,
    )

    pie_rows = [
        {"label": "RB", "value": 48},
        {"label": "CT", "value": 33},
        {"label": "BK", "value": 19},
    ]
    run_fill_script(
        args.python,
        ROOT / "scripts" / "fill_excel_template_pie.py",
        TEMPLATE_DIR / "pie-template.xlsx",
        ["label", "value"],
        pie_rows,
    )

    scatter_rows = [
        {"x": 120, "SeriesA": 26, "SeriesB": 19},
        {"x": 150, "SeriesA": 35, "SeriesB": 25},
        {"x": 175, "SeriesA": 42, "SeriesB": 31},
        {"x": 210, "SeriesA": 54, "SeriesB": 40},
    ]
    run_fill_script(
        args.python,
        ROOT / "scripts" / "fill_excel_template_scatter.py",
        TEMPLATE_DIR / "scatter-template.xlsx",
        ["x", "SeriesA", "SeriesB"],
        scatter_rows,
    )

    print("Regenerated templates:")
    print(f"- {(TEMPLATE_DIR / 'line-series-template.xlsx').as_posix()}")
    print(f"- {(TEMPLATE_DIR / 'bar-grouped-template.xlsx').as_posix()}")
    print(f"- {(TEMPLATE_DIR / 'pie-template.xlsx').as_posix()}")
    print(f"- {(TEMPLATE_DIR / 'scatter-template.xlsx').as_posix()}")


if __name__ == "__main__":
    main()
