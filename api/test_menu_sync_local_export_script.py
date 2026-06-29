import json
import shutil
import subprocess
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path


class _RecordingMenuSyncHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length)
        type(self).requests.append(
            {
                "path": self.path,
                "headers": dict(self.headers.items()),
                "body": body,
            }
        )

        bundle = BytesIO()
        with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", "{}")

        payload = bundle.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *args) -> None:
        return


def test_menu_sync_local_export_supports_json_array_arguments() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    script_path = repo_root / "scripts" / "menu-sync-local-export.ps1"
    assert script_path.exists()

    _RecordingMenuSyncHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingMenuSyncHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    temp_dir = tempfile.mkdtemp(prefix="menu-sync-export-", dir=str(repo_root / "artifacts"))
    try:
        out_dir = Path(temp_dir)
        relative_out_dir = str(out_dir.relative_to(repo_root)).replace("/", "\\")
        cmd = [
            "pwsh",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            "-LocalApiBaseUrl",
            f"http://127.0.0.1:{server.server_port}",
            "-MenuIdsJson",
            json.dumps(["review_qna", "review_reply"]),
            "-BundleFileName",
            "menu_sync_review_bundle.zip",
            "-OutDir",
            relative_out_dir,
        ]

        result = subprocess.run(
            cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        assert result.returncode == 0, result.stdout + "\n" + result.stderr
        assert len(_RecordingMenuSyncHandler.requests) == 1

        request = _RecordingMenuSyncHandler.requests[0]
        assert request["path"] == "/menu-sync/export"
        body = json.loads(request["body"].decode("utf-8"))
        assert body == {"menu_ids": ["review_qna", "review_reply"]}
        assert (out_dir / "menu_sync_review_bundle.zip").exists()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        shutil.rmtree(temp_dir, ignore_errors=True)
