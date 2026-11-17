#!/usr/bin/env python3
"""Remove fixed disposable paths only after every target passes preflight."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATHS = ('build.nosync', 'tools')

def main():
    paths = PATHS
    if len(sys.argv) != 1:
        raise SystemExit("Usage: clean.py")
    top = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True
    ).strip()
    if Path(top).resolve() != ROOT:
        raise SystemExit("Refusing clean outside its owning Git repository")
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).split(b"\0")
    for relative in paths:
        if any(os.fsdecode(name) == relative or os.fsdecode(name).startswith(relative + "/")
               for name in tracked if name):
            raise SystemExit(f"Refusing to remove tracked path: {relative}")
        target = ROOT / relative
        for part in (target, *target.parents):
            if part == ROOT:
                break
            if part.is_symlink():
                raise SystemExit(f"Refusing symlink: {part.relative_to(ROOT)}")
        if target.is_dir():
            for directory, dirs, files in os.walk(target, followlinks=False):
                for name in dirs + files:
                    child = Path(directory) / name
                    if child.is_symlink():
                        raise SystemExit(f"Refusing symlink: {child.relative_to(ROOT)}")
    for relative in paths:
        target = ROOT / relative
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()


if __name__ == "__main__":
    main()
