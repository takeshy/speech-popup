#!/usr/bin/env python3
"""Bundle the macOS executable so WebKit can find its microphone declaration."""

import json
import pathlib
import plistlib
import shutil
import subprocess
import sys


def package(binary):
    binary = pathlib.Path(binary).resolve()
    root = pathlib.Path(__file__).resolve().parents[2]
    info = json.loads((root / "wails.json").read_text())["info"]
    bundle = binary.with_name(binary.name + ".app")
    contents = bundle / "Contents"
    executable = contents / "MacOS" / binary.name
    executable.parent.mkdir(parents=True, exist_ok=True)
    (contents / "Resources").mkdir(exist_ok=True)
    shutil.copy2(binary, executable)
    plist = {
        "CFBundleExecutable": binary.name,
        "CFBundleIdentifier": info["productIdentifier"],
        "CFBundleName": info["productName"],
        "CFBundleDisplayName": info["productName"],
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": info["version"],
        "CFBundleVersion": info["version"],
        "LSMinimumSystemVersion": "12.0",
        "LSUIElement": True,
        "NSHighResolutionCapable": True,
        "NSMicrophoneUsageDescription": "音声入力のためにマイクを使用します。",
        "NSSpeechRecognitionUsageDescription": "音声を認識して入力テキストに変換します。",
        "NSAppleEventsUsageDescription": "認識したテキストを元のアプリへ貼り付けます。",
    }
    with (contents / "Info.plist").open("wb") as output:
        plistlib.dump(plist, output)
    (contents / "PkgInfo").write_bytes(b"APPL????")
    subprocess.run([
        "codesign", "--force", "--sign", "-", "--identifier",
        info["productIdentifier"], str(bundle),
    ], check=True)
    subprocess.run(["codesign", "--verify", "--strict", str(bundle)], check=True)
    print(f"Created {bundle}")


if __name__ == "__main__":
    package(sys.argv[1])
