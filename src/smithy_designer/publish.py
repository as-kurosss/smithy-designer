"""Publish a flow project to a smithy-cloud orchestrator as a pack.

The designer edits a **project**: a main flow file plus reusable subflows
under ``flows/``. Publishing turns the whole directory into a
``smithy-pack-v1`` archive:

* the main flow is the pack's ``process`` stage (``entry``);
* subflows travel as regular files and are referenced by ``flow`` nodes via
  relative ``path`` (``flows/login.flow.json``);
* :func:`smithy.pack.publish_pack` builds the manifest, zips and uploads to
  ``POST {base_url}/api/packs/{name}/versions/{version}``.

Versions are immutable: re-publishing the same ``name``/``version`` is a
409. Pass ``--version`` for a release, or rely on the timestamp default.

Usage:
    python -m smithy_designer.publish flow.web.json \
        --url http://localhost:8000 --token sct_... \
        [--name my-flow] [--version 1.0.0] [--insecure] [--open]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from smithy.pack import publish_pack

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


def _default_version() -> str:
    """A unique dotted-numeric version for quick re-publishes."""
    return f"1.0.{int(time.time())}"


def _check_name_version(name: str, version: str) -> None:
    if not _NAME_RE.match(name):
        raise ValueError(
            "invalid pack name: use letters, digits, . _ - (max 64 chars, alphanumeric first)"
        )
    if not _VERSION_RE.match(version):
        raise ValueError(
            "invalid pack version: use letters, digits, . _ - (max 32 chars, alphanumeric first)"
        )


def _check_base_url(base_url: str, *, allow_insecure: bool) -> str:
    """Validate orchestrator URL; refuse cleartext http to non-loopback hosts."""
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("url must be an http(s) URL")
    if parsed.scheme == "http" and not allow_insecure:
        host = (parsed.hostname or "").lower()
        if host not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError(
                "url must use https:// (pass allow_insecure=True to override; "
                "token would travel in cleartext)"
            )
    return base_url.rstrip("/")


def _safe_archive_path(name: str, version: str) -> Path:
    """Temp archive path that cannot escape the temp dir (name/version validated)."""
    _check_name_version(name, version)
    return Path(tempfile.gettempdir()) / f"{name}-{version}.zip"


def publish(
    directory: str | Path,
    base_url: str,
    token: str,
    name: str,
    version: str,
    *,
    entry: dict[str, str] | None = None,
    allow_insecure: bool = False,
) -> dict[str, Any]:
    """Build and upload the flow *directory* as a pack; return info.

    Raises:
        ValueError: When *directory* is not a directory.
        smithy.core.errors.InvalidInput: On pack build/upload failure.
    """
    root = Path(directory)
    if not root.is_dir():
        raise ValueError(f"flow project directory does not exist: {root}")
    _check_name_version(name, version)
    base = _check_base_url(base_url, allow_insecure=allow_insecure)
    api_url = f"{base}/api"
    archive = _safe_archive_path(name, version)
    publish_pack(
        root,
        name=name,
        version=version,
        api_url=api_url,
        token=token,
        entry=entry,
        out=archive,
        allow_insecure=allow_insecure,
    )
    info: dict[str, Any] = {
        "name": name,
        "version": version,
        "orchestrator": base_url.rstrip("/"),
    }
    process_id = _find_process_id(base, token, name)
    if process_id is not None:
        info["process_id"] = process_id
        info["process_url"] = f"{base}/processes/{process_id}"
    return info


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so the Bearer token is never replayed to another host."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        raise urllib.error.HTTPError(
            req.full_url, code, f"redirect to {newurl!r} is not allowed", headers, fp
        )


_NO_REDIRECT_OPENER = urllib.request.build_opener(_NoRedirectHandler)

_MAX_PROCESSES_BYTES = 1_000_000


def _find_process_id(base_url: str, token: str, name: str) -> str | None:
    """Best-effort lookup of the process the pack was materialized as."""
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/processes",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with _NO_REDIRECT_OPENER.open(request, timeout=15) as response:
            raw = response.read(_MAX_PROCESSES_BYTES + 1)
            if len(raw) > _MAX_PROCESSES_BYTES:
                return None
            data: Any = json.loads(raw.decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if not isinstance(data, list):
        return None
    for item in data:
        if isinstance(item, dict) and item.get("name") == name and item.get("id") is not None:
            return str(item["id"])
    return None


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smithy_designer.publish", description=__doc__)
    parser.add_argument("flow", help="path to the project's main flow document (JSON)")
    parser.add_argument("--url", required=True, help="orchestrator base URL")
    parser.add_argument("--token", required=True, help="API token (sct_...) or user JWT")
    parser.add_argument("--name", help="pack name (default: flow file stem)")
    parser.add_argument(
        "--version",
        help="pack version (default: 1.0.<unixtime>; versions are immutable)",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="allow plain http to a non-loopback orchestrator (token in cleartext)",
    )
    parser.add_argument("--open", action="store_true", help="open the orchestrator when done")
    args = parser.parse_args(argv)

    project = Path(args.flow).resolve()
    if not project.is_file():
        print(f"refusing to publish: {project} is not a file", file=sys.stderr)
        return 1

    name = args.name or project.stem
    version = args.version or _default_version()
    try:
        info = publish(
            project.parent,
            args.url,
            args.token,
            name,
            version,
            entry={"process": project.name},
            allow_insecure=args.insecure,
        )
    except Exception as exc:  # surfaced as a one-line CLI error
        print(f"publish failed: {exc}", file=sys.stderr)
        return 1

    print(f"published: {info['name']} {info['version']} -> {info['orchestrator']}")
    if info.get("process_url"):
        print(f"orchestrator: {info['process_url']}")
    if args.open:
        webbrowser.open(str(info.get("process_url") or info["orchestrator"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
