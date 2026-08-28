from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import unquote

from thumbnail_service import (
    SERIES_NAMES,
    BrowserOpenChannel,
    BrowserOpenCoordinator,
    HOST,
    FileSnapshot,
    PNG_SIGNATURE,
    REPARSE_ATTRIBUTE,
    SERVICE_ID,
    SERVICE_PROTOCOL_VERSION,
    SingleInstanceGuard,
    SourceSelectionError,
    _console_print,
    _health_is_expected,
    create_server,
    normalized_last_assigned,
    record_series_registry_export,
    run_server,
    select_latest_png,
    series_floor_number,
    series_for_preset,
    signal_running_instance,
    verify_only_series_touched,
)


def png_bytes(label: bytes = b"test") -> bytes:
    return PNG_SIGNATURE + label


def write_file(directory: Path, name: str, data: bytes, mtime_ns: int) -> Path:
    path = directory / name
    path.write_bytes(data)
    os.utime(path, ns=(mtime_ns, mtime_ns))
    return path


class LatestPngSelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.base_time = 1_800_000_000_000_000_000

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def select(self, **kwargs):
        return select_latest_png(
            self.directory, stability_delay=0, sleep_func=lambda _: None, **kwargs
        )

    def test_newest_valid_png_is_selected(self) -> None:
        write_file(
            self.directory, "older.png", png_bytes(b"old"), self.base_time
        )
        write_file(
            self.directory, "newer.png", png_bytes(b"new"), self.base_time + 10
        )
        self.assertEqual(self.select().filename, "newer.png")

    def test_uppercase_png_extension_is_accepted(self) -> None:
        write_file(
            self.directory, "TRADINGVIEW.PNG", png_bytes(), self.base_time
        )
        self.assertEqual(self.select().filename, "TRADINGVIEW.PNG")

    def test_jpg_jpeg_and_webp_are_ignored(self) -> None:
        for index, extension in enumerate((".jpg", ".jpeg", ".webp")):
            write_file(
                self.directory,
                f"image{extension}",
                png_bytes(),
                self.base_time + index,
            )
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_empty")

    def test_download_and_temporary_extensions_are_ignored(self) -> None:
        for index, extension in enumerate(
            (".crdownload", ".part", ".tmp", ".temp")
        ):
            write_file(
                self.directory,
                f"image.png{extension}",
                png_bytes(),
                self.base_time + index,
            )
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_empty")

    def test_empty_png_is_ignored(self) -> None:
        write_file(self.directory, "empty.png", b"", self.base_time)
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_invalid")

    def test_png_with_wrong_signature_is_ignored(self) -> None:
        write_file(
            self.directory, "fake.png", b"not a png", self.base_time
        )
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_invalid")

    def test_complete_png_signature_is_accepted(self) -> None:
        write_file(self.directory, "valid.png", PNG_SIGNATURE, self.base_time)
        self.assertEqual(self.select().data, PNG_SIGNATURE)

    def test_subdirectories_are_ignored(self) -> None:
        nested = self.directory / "nested.png"
        nested.mkdir()
        write_file(nested, "inside.png", png_bytes(), self.base_time)
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_invalid")

    def test_symbolic_links_are_ignored(self) -> None:
        target = write_file(
            self.directory, "target.dat", png_bytes(), self.base_time
        )
        link = self.directory / "linked.png"
        try:
            link.symlink_to(target)
        except OSError as error:
            self.skipTest(f"Symlink-Erstellung nicht verfügbar: {error}")
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_invalid")

    def test_reparse_file_entries_are_ignored(self) -> None:
        write_file(self.directory, "reparse.png", png_bytes(), self.base_time)
        reparse_snapshot = FileSnapshot(
            size=len(png_bytes()),
            mtime_ns=self.base_time,
            mode=stat.S_IFREG,
            file_attributes=REPARSE_ATTRIBUTE,
        )
        with patch("thumbnail_service._snapshot", return_value=reparse_snapshot):
            with self.assertRaises(SourceSelectionError) as raised:
                self.select()
        self.assertEqual(raised.exception.code, "source_invalid")

    def test_oversized_png_is_ignored(self) -> None:
        write_file(
            self.directory,
            "large.png",
            png_bytes(b"0123456789"),
            self.base_time,
        )
        with self.assertRaises(SourceSelectionError) as raised:
            self.select(max_bytes=10)
        self.assertEqual(raised.exception.code, "source_invalid")

    def test_equal_mtime_uses_deterministic_filename_order(self) -> None:
        write_file(self.directory, "z.png", png_bytes(b"z"), self.base_time)
        write_file(self.directory, "a.png", png_bytes(b"a"), self.base_time)
        results = [self.select().filename for _ in range(3)]
        self.assertEqual(results, ["a.png", "a.png", "a.png"])

    def test_mutation_during_read_is_detected(self) -> None:
        path = write_file(
            self.directory, "changing.png", png_bytes(), self.base_time
        )

        def mutating_reader(candidate: Path) -> bytes:
            data = candidate.read_bytes()
            with candidate.open("ab") as output:
                output.write(b"x")
            return data

        with self.assertRaises(SourceSelectionError) as raised:
            self.select(read_func=mutating_reader)
        self.assertEqual(raised.exception.code, "source_unstable")
        self.assertEqual(path.stat().st_size, len(png_bytes()) + 1)

    def test_unstable_newest_falls_back_to_stable_png(self) -> None:
        older = write_file(
            self.directory, "older.png", png_bytes(b"older"), self.base_time
        )
        newest = write_file(
            self.directory,
            "newest.png",
            png_bytes(b"newest"),
            self.base_time + 10,
        )

        def mutate_latest(_: float) -> None:
            with newest.open("ab") as output:
                output.write(b"x")

        selected = select_latest_png(
            self.directory, stability_delay=0, sleep_func=mutate_latest
        )
        self.assertEqual(selected.filename, older.name)

    def test_missing_directory_is_controlled(self) -> None:
        with self.assertRaises(SourceSelectionError) as raised:
            select_latest_png(
                self.directory / "missing",
                stability_delay=0,
                sleep_func=lambda _: None,
            )
        self.assertEqual(raised.exception.code, "source_missing")

    def test_empty_directory_is_controlled(self) -> None:
        with self.assertRaises(SourceSelectionError) as raised:
            self.select()
        self.assertEqual(raised.exception.code, "source_empty")


class HttpEndpointTests(unittest.TestCase):
    token = "test-session-token-that-is-long-enough"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.source = root / "source"
        self.export = root / "export"
        self.source.mkdir()
        self.export.mkdir()
        self.image = write_file(
            self.source,
            "Chart äöü.PNG",
            png_bytes(b"http"),
            1_800_000_000_000_000_000,
        )
        self.server = create_server(
            port=0,
            session_token=self.token,
            source_directory=self.source,
            export_directory=self.export,
            stability_delay=0,
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.temporary.cleanup()

    def request(
        self,
        method: str = "GET",
        path: str = "/api/source/latest",
        *,
        token: str | None = token,
        host: str | None = None,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection(HOST, self.server.server_port)
        request_headers = {
            "Host": host or f"{HOST}:{self.server.server_port}",
        }
        if token is not None:
            request_headers["X-Session-Token"] = token
        if headers:
            request_headers.update(headers)
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        result = response.status, dict(response.getheaders()), data
        connection.close()
        return result

    def export_request(
        self,
        filename: str,
        content_type: str,
        payload: bytes,
    ) -> tuple[int, dict[str, str], dict[str, object]]:
        status, headers, data = self.request(
            method="POST",
            path="/api/export",
            body=payload,
            headers={
                "Content-Type": content_type,
                "Content-Length": str(len(payload)),
                "X-Export-Filename": filename,
            },
        )
        return status, headers, json.loads(data)

    def test_valid_get_returns_binary_png_and_metadata(self) -> None:
        status, headers, data = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(int(headers["Content-Length"]), len(data))
        self.assertEqual(unquote(headers["X-Source-Filename"]), self.image.name)
        self.assertEqual(int(headers["X-Source-Size"]), len(data))
        self.assertTrue(headers["X-Source-Mtime-Ns"].isdigit())
        self.assertRegex(headers["X-Source-Identity"], r"^[a-f0-9]{64}$")
        self.assertEqual(data, self.image.read_bytes())

    def test_health_identifies_only_the_service_without_secrets(self) -> None:
        status, headers, data = self.request(
            path="/api/health",
            token=None,
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(
            json.loads(data),
            {
                "service": SERVICE_ID,
                "protocol_version": SERVICE_PROTOCOL_VERSION,
                "ready": True,
            },
        )
        decoded = data.decode("ascii")
        self.assertNotIn(self.token, decoded)
        self.assertNotIn(str(self.source), decoded)
        self.assertNotIn(str(self.export), decoded)

    def test_health_probe_accepts_expected_service(self) -> None:
        self.assertTrue(_health_is_expected(self.server.server_port))

    def test_health_rejects_wrong_host_and_non_get(self) -> None:
        wrong_host_status, _, wrong_host_data = self.request(
            path="/api/health",
            token=None,
            host="foreign.invalid",
        )
        post_status, _, post_data = self.request(
            method="POST",
            path="/api/health",
            token=None,
            body=b"",
        )
        self.assertEqual(wrong_host_status, 421)
        self.assertEqual(json.loads(wrong_host_data)["code"], "invalid_host")
        self.assertEqual(post_status, 405)
        self.assertEqual(json.loads(post_data)["code"], "method_not_allowed")

    def test_second_get_sees_a_newer_png(self) -> None:
        first_status, first_headers, _ = self.request()
        newer = write_file(
            self.source,
            "newer.png",
            png_bytes(b"newer"),
            self.image.stat().st_mtime_ns + 1_000_000,
        )
        second_status, second_headers, second_data = self.request()
        self.assertEqual((first_status, second_status), (200, 200))
        self.assertNotEqual(
            first_headers["X-Source-Identity"],
            second_headers["X-Source-Identity"],
        )
        self.assertEqual(unquote(second_headers["X-Source-Filename"]), newer.name)
        self.assertEqual(second_data, newer.read_bytes())

    def test_missing_token_is_rejected(self) -> None:
        status, headers, data = self.request(token=None)
        self.assertEqual(status, 401)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(json.loads(data)["code"], "invalid_token")

    def test_wrong_token_is_rejected(self) -> None:
        status, _, data = self.request(token="wrong")
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(data)["code"], "invalid_token")

    def test_wrong_host_is_rejected(self) -> None:
        status, _, data = self.request(host="evil.example")
        self.assertEqual(status, 421)
        self.assertEqual(json.loads(data)["code"], "invalid_host")

    def test_post_on_source_endpoint_is_rejected(self) -> None:
        status, _, data = self.request(method="POST", body=b"")
        self.assertEqual(status, 405)
        self.assertEqual(json.loads(data)["code"], "method_not_allowed")

    def test_client_cannot_supply_alternative_path(self) -> None:
        status, _, data = self.request(path="/api/source/latest?path=C%3A%5Csecret")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(data)["code"], "unexpected_parameters")

    def test_missing_source_directory_is_controlled_http_error(self) -> None:
        self.server.source_directory = self.source / "missing"
        status, _, data = self.request()
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(data)["code"], "source_missing")

    def test_empty_source_directory_is_controlled_http_error(self) -> None:
        self.image.unlink()
        status, _, data = self.request()
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(data)["code"], "source_empty")

    def test_export_endpoint_uses_same_token_and_fixed_directory(self) -> None:
        payload = png_bytes(b"export")
        status, _, result = self.export_request(
            "test-output.png", "image/png", payload
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["filename"], "test-output.png")
        self.assertEqual((self.export / "test-output.png").read_bytes(), payload)

    def test_export_endpoint_rejects_path_traversal(self) -> None:
        payload = png_bytes(b"export")
        status, _, data = self.request(
            method="POST",
            path="/api/export",
            body=payload,
            headers={
                "Content-Type": "image/png",
                "Content-Length": str(len(payload)),
                "X-Export-Filename": "..%2Foutside.png",
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(data)["code"], "invalid_export_filename")

    def test_second_png_export_uses_suffix_two(self) -> None:
        payload = png_bytes(b"same")
        first_status, _, first = self.export_request(
            "thumbnail.png", "image/png", payload
        )
        second_status, _, second = self.export_request(
            "thumbnail.png", "image/png", payload
        )
        self.assertEqual((first_status, second_status), (200, 200))
        self.assertEqual(first["filename"], "thumbnail.png")
        self.assertEqual(second["filename"], "thumbnail (2).png")

    def test_five_sequential_png_exports_create_five_files(self) -> None:
        expected = [
            "thumbnail.png",
            "thumbnail (2).png",
            "thumbnail (3).png",
            "thumbnail (4).png",
            "thumbnail (5).png",
        ]
        responses = []
        for index in range(5):
            payload = png_bytes(f"png-{index}".encode())
            status, _, result = self.export_request(
                "thumbnail.png", "image/png", payload
            )
            self.assertEqual(status, 200, result)
            responses.append(result["filename"])
        self.assertEqual(responses, expected)
        self.assertEqual(
            sorted(path.name for path in self.export.iterdir()), sorted(expected)
        )

    def test_five_sequential_jpg_exports_create_five_files(self) -> None:
        expected = [
            "thumbnail.jpg",
            "thumbnail (2).jpg",
            "thumbnail (3).jpg",
            "thumbnail (4).jpg",
            "thumbnail (5).jpg",
        ]
        responses = []
        for index in range(5):
            payload = b"\xff\xd8" + f"jpg-{index}".encode()
            status, _, result = self.export_request(
                "thumbnail.jpg", "image/jpeg", payload
            )
            self.assertEqual(status, 200, result)
            responses.append(result["filename"])
        self.assertEqual(responses, expected)
        self.assertEqual(
            sorted(path.name for path in self.export.iterdir()), sorted(expected)
        )

    def test_existing_base_and_suffix_two_choose_suffix_three(self) -> None:
        (self.export / "thumbnail.png").write_bytes(b"base")
        (self.export / "thumbnail (2).png").write_bytes(b"two")
        status, _, result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"three")
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["filename"], "thumbnail (3).png")

    def test_lowest_free_suffix_fills_a_gap(self) -> None:
        (self.export / "thumbnail.png").write_bytes(b"base")
        (self.export / "thumbnail (2).png").write_bytes(b"two")
        (self.export / "thumbnail (4).png").write_bytes(b"four")
        status, _, result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"three")
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["filename"], "thumbnail (3).png")

    def test_existing_files_keep_content_and_hash(self) -> None:
        original = b"original-user-file"
        existing = self.export / "thumbnail.png"
        existing.write_bytes(original)
        before = hashlib.sha256(existing.read_bytes()).hexdigest()
        status, _, result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"new")
        )
        after = hashlib.sha256(existing.read_bytes()).hexdigest()
        self.assertEqual(status, 200, result)
        self.assertEqual(result["filename"], "thumbnail (2).png")
        self.assertEqual((before, after), (before, before))
        self.assertEqual(existing.read_bytes(), original)

    def test_case_insensitive_collision_preserves_existing_file(self) -> None:
        existing = self.export / "Thumbnail.PNG"
        existing.write_bytes(b"case-sensitive-test")
        status, _, result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"new")
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["filename"], "thumbnail (2).png")
        self.assertEqual(existing.read_bytes(), b"case-sensitive-test")

    def test_success_response_always_names_an_existing_new_file(self) -> None:
        before = {path.name for path in self.export.iterdir()}
        status, _, result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"new")
        )
        after = {path.name for path in self.export.iterdir()}
        self.assertEqual(status, 200, result)
        self.assertEqual(after - before, {result["filename"]})
        self.assertGreater((self.export / str(result["filename"])).stat().st_size, 0)

    def test_write_failure_leaves_no_temp_or_final_file(self) -> None:
        with patch("thumbnail_service.os.replace", side_effect=OSError("simulated")):
            status, _, result = self.export_request(
                "thumbnail.png", "image/png", png_bytes(b"failure")
            )
        self.assertEqual(status, 500, result)
        self.assertEqual(result["code"], "export_write_error")
        self.assertEqual(list(self.export.iterdir()), [])

    def test_parallel_requests_create_distinct_files_without_overwrite(self) -> None:
        payloads = [png_bytes(f"parallel-{index}".encode()) for index in range(8)]

        def send(payload: bytes):
            return self.export_request("thumbnail.png", "image/png", payload)

        with ThreadPoolExecutor(max_workers=8) as executor:
            responses = list(executor.map(send, payloads))

        self.assertTrue(all(status == 200 for status, _, _ in responses))
        names = [str(result["filename"]) for _, _, result in responses]
        self.assertEqual(len(set(names)), len(payloads))
        self.assertEqual(
            set(names),
            {"thumbnail.png"}
            | {f"thumbnail ({index}).png" for index in range(2, 9)},
        )
        self.assertEqual(
            {path.read_bytes() for path in self.export.iterdir()}, set(payloads)
        )

    def test_png_and_jpg_collision_namespaces_are_separate(self) -> None:
        png_status, _, png_result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"png")
        )
        jpg_status, _, jpg_result = self.export_request(
            "thumbnail.jpg", "image/jpeg", b"\xff\xd8jpg"
        )
        self.assertEqual((png_status, jpg_status), (200, 200))
        self.assertEqual(png_result["filename"], "thumbnail.png")
        self.assertEqual(jpg_result["filename"], "thumbnail.jpg")

    def test_invalid_mime_or_wrong_extension_creates_no_file(self) -> None:
        bad_mime_status, _, _ = self.export_request(
            "thumbnail.png", "image/gif", b"gif"
        )
        bad_extension_status, _, _ = self.export_request(
            "thumbnail.jpg", "image/png", png_bytes()
        )
        self.assertEqual(bad_mime_status, 415)
        self.assertEqual(bad_extension_status, 400)
        self.assertEqual(list(self.export.iterdir()), [])


class ClientContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (
            Path(__file__).resolve().parents[1] / "thumbnail-compositor.html"
        ).read_text(encoding="utf-8")

    def test_client_rejects_unexpected_source_mime_type(self) -> None:
        self.assertIn("responseType !== 'image/png'", self.html)
        self.assertIn("blob.type.toLowerCase() !== 'image/png'", self.html)

    def test_all_imports_share_the_central_load_file_path(self) -> None:
        self.assertIn(
            "loadFile(file, {sourceImport:true, sourceGeneration:generation})",
            self.html,
        )
        self.assertIn("loadFile(e.target.files[0])", self.html)
        self.assertIn("loadFile(e.dataTransfer.files[0])", self.html)
        self.assertEqual(self.html.count("function loadFile("), 1)

    def test_start_load_and_refresh_have_no_polling(self) -> None:
        self.assertIn(
            "if (localService.available) await loadLatestSource();", self.html
        )
        self.assertIn(
            "sourceRefreshBtn.addEventListener('click'", self.html
        )
        self.assertNotIn("setInterval(", self.html)

    def test_source_file_is_always_created_as_png(self) -> None:
        self.assertIn(
            "new File([blob], source.filename, {type:'image/png'", self.html
        )

    def test_client_uses_server_confirmed_export_filename(self) -> None:
        # Seit der registry_warning-Erweiterung liefert writeExportToLocalService
        # ein Objekt {filename, warning} statt eines nackten Strings -- der
        # angezeigte Name muss weiterhin der vom Dienst BESTAETIGTE sein, nie der
        # lokal gebaute.
        self.assertIn("return { filename: result.filename, warning:", self.html)
        self.assertIn(
            "'Gespeichert im Export-Ordner: '+serviceResult.filename", self.html
        )
        self.assertNotIn(
            "writeExportToLocalService(blob, filename) ||", self.html
        )

    def test_client_surfaces_a_registry_warning_next_to_the_filename(self) -> None:
        self.assertIn("serviceResult.warning", self.html)
        self.assertIn("— ACHTUNG: '+serviceResult.warning", self.html)

    def test_export_button_keeps_single_flight_guard_and_finally_reset(self) -> None:
        self.assertIn(
            "if (!state.img || exportDirectory.busy) return;", self.html
        )
        self.assertIn("exportDirectory.busy = true;", self.html)
        self.assertIn("exportDirectory.busy = false;", self.html)
        self.assertIn("exportBtn.disabled = !state.img;", self.html)


@unittest.skipUnless(os.name == "nt", "Windows-Named-IPC wird nur unter Windows geprüft.")
class BrowserReopenTests(unittest.TestCase):
    @staticmethod
    def unique_port(offset: int = 0) -> int:
        return 52_000 + ((os.getpid() + offset) % 10_000)

    def wait_for_calls(
        self,
        calls: list[tuple[str, int]],
        expected: int,
        timeout: float = 2.0,
    ) -> None:
        deadline = time.monotonic() + timeout
        while len(calls) < expected and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(len(calls), expected)

    def test_first_start_opens_browser_exactly_once(self) -> None:
        port = self.unique_port(1)
        calls: list[tuple[str, int]] = []
        opened = threading.Event()

        class FakeServer:
            server_port = port
            session_token = "primary-secret-token"

            def serve_forever(self, poll_interval: float) -> None:
                self.poll_interval = poll_interval
                opened.wait(timeout=1)

            def server_close(self) -> None:
                pass

        def opener(url: str, *, new: int) -> None:
            calls.append((url, new))
            opened.set()

        with patch("thumbnail_service.create_server", return_value=FakeServer()):
            result = run_server(
                port=port,
                browser_opener=opener,
                browser_open_delay=0,
            )

        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], 2)
        self.assertIn("?token=primary-secret-token", calls[0][0])

    def test_running_service_skips_server_creation_but_signals_each_start(self) -> None:
        port = self.unique_port(2)
        primary = SingleInstanceGuard(port)
        try:
            self.assertTrue(primary.acquire())
            with (
                patch(
                    "thumbnail_service.signal_running_instance",
                    return_value=True,
                ) as signal,
                patch("thumbnail_service.create_server") as create,
            ):
                results = [run_server(port=port) for _ in range(4)]
            self.assertEqual(results, [0, 0, 0, 0])
            self.assertEqual(signal.call_count, 4)
            create.assert_not_called()
        finally:
            primary.release()

    def test_initial_open_and_four_reopen_signals_are_all_counted(self) -> None:
        port = self.unique_port(3)
        channel = BrowserOpenChannel(port)
        calls: list[tuple[str, int]] = []
        coordinator: BrowserOpenCoordinator | None = None
        try:
            channel.create()
            coordinator = BrowserOpenCoordinator(
                channel,
                "http://127.0.0.1:8765/?token=only-primary-knows",
                lambda url, *, new: calls.append((url, new)),
            )
            coordinator.start()
            coordinator.schedule_initial_open(0)
            for _ in range(4):
                self.assertTrue(BrowserOpenChannel.signal(port))
            self.wait_for_calls(calls, 5)
            self.assertTrue(all(new == 2 for _, new in calls))
        finally:
            if coordinator is not None:
                coordinator.close()
            channel.close()

    def test_fast_duplicate_signals_wait_in_channel_until_watcher_starts(self) -> None:
        port = self.unique_port(4)
        channel = BrowserOpenChannel(port)
        calls: list[tuple[str, int]] = []
        coordinator: BrowserOpenCoordinator | None = None
        try:
            channel.create()
            self.assertTrue(BrowserOpenChannel.signal(port))
            self.assertTrue(BrowserOpenChannel.signal(port))
            coordinator = BrowserOpenCoordinator(
                channel,
                "http://127.0.0.1:8765/?token=secret",
                lambda url, *, new: calls.append((url, new)),
            )
            coordinator.start()
            self.wait_for_calls(calls, 2)
        finally:
            if coordinator is not None:
                coordinator.close()
            channel.close()

    def test_signal_requires_expected_health_before_open_request(self) -> None:
        port = self.unique_port(5)
        channel = BrowserOpenChannel(port)
        try:
            channel.create()
            self.assertFalse(
                signal_running_instance(
                    port,
                    timeout_seconds=0,
                    health_check=lambda _port, _timeout: False,
                )
            )
            self.assertTrue(
                signal_running_instance(
                    port,
                    timeout_seconds=0,
                    health_check=lambda _port, _timeout: True,
                )
            )
            self.assertTrue(channel.wait(100))
        finally:
            channel.close()

    def test_stale_mutex_without_valid_service_is_a_controlled_error(self) -> None:
        port = self.unique_port(6)
        primary = SingleInstanceGuard(port)
        try:
            self.assertTrue(primary.acquire())
            with (
                patch(
                    "thumbnail_service.signal_running_instance",
                    return_value=False,
                ),
                patch("thumbnail_service._startup_error") as startup_error,
                patch("thumbnail_service.create_server") as create,
            ):
                result = run_server(port=port)
            self.assertEqual(result, 6)
            startup_error.assert_called_once()
            create.assert_not_called()
        finally:
            primary.release()

    def test_foreign_service_on_port_is_not_opened_as_compositor(self) -> None:
        class ForeignHandler(BaseHTTPRequestHandler):
            def log_message(self, format_string: str, *args: object) -> None:
                pass

            def do_GET(self) -> None:
                data = b'{"service":"foreign","ready":true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)

        foreign = ThreadingHTTPServer((HOST, 0), ForeignHandler)
        thread = threading.Thread(target=foreign.serve_forever)
        thread.start()
        calls: list[tuple[str, int]] = []
        try:
            self.assertFalse(_health_is_expected(foreign.server_port))
            with patch("thumbnail_service._startup_error") as startup_error:
                result = run_server(
                    port=foreign.server_port,
                    browser_opener=lambda url, *, new: calls.append((url, new)),
                    browser_open_delay=0,
                )
            self.assertEqual(result, 4)
            startup_error.assert_called_once()
            self.assertEqual(calls, [])
        finally:
            foreign.shutdown()
            thread.join(timeout=2)
            foreign.server_close()

    def test_channel_cleanup_leaves_no_watcher_thread(self) -> None:
        port = self.unique_port(7)
        channel = BrowserOpenChannel(port)
        channel.create()
        coordinator = BrowserOpenCoordinator(
            channel,
            "http://127.0.0.1:8765/?token=secret",
            lambda _url, *, new: new,
        )
        coordinator.start()
        coordinator.close()
        channel.close()
        self.assertIsNotNone(coordinator.thread)
        self.assertFalse(coordinator.thread.is_alive())


class LauncherContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root = Path(__file__).resolve().parents[1]
        cls.launcher = cls.root / "START-THUMBNAIL-COMPOSITOR.vbs"
        cls.script = cls.launcher.read_text(encoding="utf-8")
        cls.diagnostic_launcher = cls.root / "START-THUMBNAIL-COMPOSITOR.cmd"

    def test_hidden_launcher_exists_and_uses_its_own_directory(self) -> None:
        self.assertTrue(self.launcher.is_file())
        self.assertIn("WScript.ScriptFullName", self.script)
        self.assertIn("GetParentFolderName", self.script)
        self.assertIn("shell.CurrentDirectory = scriptDirectory", self.script)

    def test_hidden_launcher_quotes_paths_and_returns_without_waiting(self) -> None:
        self.assertIn("QuoteArgument(servicePath)", self.script)
        self.assertIn("shell.Run(commandLine, WINDOW_HIDDEN, False)", self.script)

    def test_visible_diagnostic_launcher_still_finds_local_python(self) -> None:
        completed = subprocess.run(
            [
                os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe"),
                "/d",
                "/c",
                "START-THUMBNAIL-COMPOSITOR.cmd --help",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        combined = completed.stdout + completed.stderr
        self.assertEqual(completed.returncode, 0, combined)
        self.assertIn("usage: thumbnail_service.py", combined)

    def test_hidden_launcher_has_controlled_errors_and_no_static_token(self) -> None:
        self.assertIn("ShowError", self.script)
        self.assertIn("thumbnail_service.py", self.script)
        self.assertIn("thumbnail-compositor.html", self.script)
        self.assertNotIn("session-token", self.script.lower())
        self.assertNotIn("?token=", self.script.lower())
        self.assertNotIn("http://127.0.0.1", self.script.lower())

    def test_server_console_output_is_safe_without_console_stream(self) -> None:
        with patch("thumbnail_service.sys.stdout", None):
            _console_print("fensterlos")

    def test_single_instance_guard_rejects_second_process_slot(self) -> None:
        port = 50_000 + (os.getpid() % 10_000)
        first = SingleInstanceGuard(port)
        second = SingleInstanceGuard(port)
        third = SingleInstanceGuard(port)
        try:
            self.assertTrue(first.acquire())
            self.assertFalse(second.acquire())
            first.release()
            self.assertTrue(third.acquire())
        finally:
            first.release()
            second.release()
            third.release()


class SeriesRegistryPerSeriesTest(unittest.TestCase):
    """V6: harte Trennung der drei Zaehler. Jede Nummer gehoert zu genau einer
    Serie, die Zuordnung haengt am PRESET, und ein Export darf ausschliesslich
    den Zaehler der aktiven Serie beruehren."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.registry_path = root / "series-registry.json"
        self.backup_directory = root / "backups"

    def write_registry(self, registry: dict) -> None:
        self.registry_path.write_text(
            json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    def read_registry(self) -> dict:
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def record(self, preset: str, episode: str) -> str | None:
        return record_series_registry_export(
            preset,
            episode,
            registry_path=self.registry_path,
            backup_directory=self.backup_directory,
        )

    def seeded_registry(self) -> dict:
        return {
            "$schema": "SERIES_REGISTRY_V2",
            "aiv": [],
            "innercircle": [{"number": 75, "videoId": "TESTVIDEO001", "date": "2026-08-20"}],
            "livestream": [{"number": 66, "videoId": "abc", "date": "2026-05-31"}],
            "standard": [],
            "lastAssigned": {"standard": {"number": 15, "at": "2026-08-27T00:00:00Z"}},
        }

    def counters(self) -> dict:
        return {
            name: (self.read_registry().get("lastAssigned", {}).get(name) or {}).get("number")
            for name in SERIES_NAMES
        }

    # --- Preset -> Serie ---------------------------------------------------

    def test_preset_maps_to_exactly_one_series(self) -> None:
        self.assertEqual(series_for_preset("aiv"), "aiv")
        self.assertEqual(series_for_preset("innercircle"), "innercircle")
        self.assertEqual(series_for_preset("livestream"), "livestream")
        self.assertEqual(series_for_preset("standard"), "standard")

    def test_nonchart_and_unknown_presets_have_no_series(self) -> None:
        self.assertIsNone(series_for_preset("nonchart"))
        # BJ6: memberlive traegt bewusst keine Nummer und damit keine Serie.
        self.assertIsNone(series_for_preset("memberlive"))
        self.assertIsNone(series_for_preset(""))
        self.assertIsNone(series_for_preset("innercircle "))

    # --- V6 Kreuztest ------------------------------------------------------

    def test_standard_export_leaves_innercircle_and_livestream_untouched(self) -> None:
        self.write_registry(self.seeded_registry())
        before = self.read_registry()
        self.assertIsNone(self.record("standard", "EP. 16"))
        after = self.read_registry()
        self.assertEqual(self.counters()["standard"], 16)
        self.assertIsNone(self.counters()["innercircle"])
        self.assertIsNone(self.counters()["livestream"])
        for name in SERIES_NAMES:
            self.assertEqual(before[name], after[name], f"Eintraege von {name} veraendert")

    def test_innercircle_export_leaves_livestream_and_standard_untouched(self) -> None:
        self.write_registry(self.seeded_registry())
        before = self.read_registry()
        self.assertIsNone(self.record("innercircle", "INNER CIRCLE #76"))
        after = self.read_registry()
        self.assertEqual(self.counters()["innercircle"], 76)
        self.assertIsNone(self.counters()["livestream"])
        self.assertEqual(self.counters()["standard"], 15, "Standard-Zaehler mitgeschoben")
        for name in SERIES_NAMES:
            self.assertEqual(before[name], after[name], f"Eintraege von {name} veraendert")

    def test_livestream_export_leaves_innercircle_and_standard_untouched(self) -> None:
        self.write_registry(self.seeded_registry())
        self.assertIsNone(self.record("livestream", "LIVESTREAM #67"))
        self.assertEqual(self.counters()["livestream"], 67)
        self.assertIsNone(self.counters()["innercircle"])
        self.assertEqual(self.counters()["standard"], 15)

    def test_three_exports_in_a_row_keep_three_independent_counters(self) -> None:
        self.write_registry(self.seeded_registry())
        self.assertIsNone(self.record("standard", "EP. 16"))
        self.assertIsNone(self.record("innercircle", "INNER CIRCLE #76"))
        self.assertIsNone(self.record("livestream", "LIVESTREAM #67"))
        self.assertEqual(
            self.counters(),
            {"aiv": None, "innercircle": 76, "livestream": 67, "standard": 16},
        )

    def test_aiv_export_leaves_the_three_older_series_untouched(self) -> None:
        """BJ4-Kreuztest: ein aiv-Export darf innercircle, livestream und
        standard weder in den Eintraegen noch im Zaehler beruehren."""
        self.write_registry(self.seeded_registry())
        before = self.read_registry()
        self.assertIsNone(self.record("aiv", "AIV #1"))
        after = self.read_registry()
        self.assertEqual(self.counters()["aiv"], 1)
        self.assertIsNone(self.counters()["innercircle"])
        self.assertIsNone(self.counters()["livestream"])
        self.assertEqual(self.counters()["standard"], 15, "Standard-Zaehler mitgeschoben")
        for name in SERIES_NAMES:
            self.assertEqual(before[name], after[name], f"Eintraege von {name} veraendert")

    def test_older_exports_leave_the_aiv_counter_untouched(self) -> None:
        """Gegenrichtung: die drei alten Serien duerfen den aiv-Zaehler nicht
        anfassen -- auch nicht, nachdem aiv schon eine Nummer hat."""
        self.write_registry(self.seeded_registry())
        self.assertIsNone(self.record("aiv", "AIV #1"))
        for preset, episode in (
            ("standard", "EP. 16"),
            ("innercircle", "INNER CIRCLE #76"),
            ("livestream", "LIVESTREAM #67"),
        ):
            self.assertIsNone(self.record(preset, episode))
            self.assertEqual(self.counters()["aiv"], 1, f"{preset} hat aiv verschoben")

    def test_aiv_number_one_is_accepted_although_other_series_are_far_ahead(self) -> None:
        """Die neue Serie startet bei #1, obwohl innercircle bei #75 steht.
        Mit einem gemeinsamen Zaehler waere das faelschlich blockiert."""
        self.write_registry(self.seeded_registry())
        self.assertIsNone(self.record("aiv", "AIV #1"))
        self.assertEqual(self.counters()["aiv"], 1)

    def test_memberlive_export_never_writes(self) -> None:
        """BJ6: series:null heisst wirklich nichts anfassen -- auch dann nicht,
        wenn im Feld zufaellig eine Zahl steht."""
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        self.assertIsNone(self.record("memberlive", "MITGLIEDER LIVESTREAM #1"))
        self.assertIsNone(self.record("memberlive", "MEMBER LIVESTREAM"))
        self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"))

    def test_presets_without_a_series_write_nothing_at_all(self) -> None:
        """Weder nonchart noch memberlive duerfen irgendeinen Zaehler anlegen --
        auch nicht den der jeweils anderen serienlosen Sorte."""
        self.write_registry(self.seeded_registry())
        for preset in ("nonchart", "memberlive"):
            before = self.registry_path.read_text(encoding="utf-8")
            self.assertIsNone(self.record(preset, "AIV #9"))
            self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"))
        registry = self.read_registry()
        self.assertNotIn("nonchart", registry.get("lastAssigned", {}))
        self.assertNotIn("memberlive", registry.get("lastAssigned", {}))
        self.assertIsNone(self.counters()["aiv"])

    def test_standard_number_below_innercircle_floor_is_still_accepted(self) -> None:
        """Kernpunkt von V2: EP. 16 ist gueltig, obwohl Inner Circle schon bei
        #75 steht. Mit einem gemeinsamen Zaehler waere das faelschlich blockiert."""
        self.write_registry(self.seeded_registry())
        self.assertIsNone(self.record("standard", "EP. 16"))
        self.assertEqual(self.counters()["standard"], 16)

    def test_nonchart_export_never_writes(self) -> None:
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        self.assertIsNone(self.record("nonchart", "IRGENDWAS #99"))
        self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"))

    def test_empty_series_does_not_fall_back_to_another_series(self) -> None:
        """standard ist leer und hat keinen Zaehler -- der Vorschlag darf NICHT
        aus innercircle geborgt werden."""
        registry = {"innercircle": [{"number": 75}], "livestream": [], "standard": []}
        self.write_registry(registry)
        self.assertEqual(series_floor_number(registry, "standard"), 0)
        self.assertIsNone(self.record("standard", "EP. 1"))
        self.assertEqual(self.counters()["standard"], 1)

    # --- Untergrenze und Warnungen ----------------------------------------

    def test_already_assigned_number_warns_and_writes_nothing(self) -> None:
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        warning = self.record("livestream", "LIVESTREAM #66")
        self.assertIsNotNone(warning)
        self.assertIn("livestream", warning)
        self.assertIn("#66", warning)
        self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"))

    def test_floor_is_the_higher_of_entries_and_counter(self) -> None:
        registry = {
            "innercircle": [{"number": 75}],
            "lastAssigned": {"innercircle": {"number": 80}},
        }
        self.assertEqual(series_floor_number(registry, "innercircle"), 80)
        registry["lastAssigned"]["innercircle"]["number"] = 70
        self.assertEqual(series_floor_number(registry, "innercircle"), 75)

    def test_field_without_a_number_is_ignored(self) -> None:
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        self.assertIsNone(self.record("innercircle", "INNER CIRCLE #"))
        self.assertIsNone(self.record("standard", "EP. "))
        self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"))

    def test_standard_accepts_ep_prefix_and_bare_number(self) -> None:
        self.write_registry(self.seeded_registry())
        self.assertIsNone(self.record("standard", "EP. 16"))
        self.assertIsNone(self.record("standard", "17"))
        self.assertEqual(self.counters()["standard"], 17)

    # --- Migration V1 -> V2 ------------------------------------------------

    def test_scalar_last_assigned_migrates_to_innercircle(self) -> None:
        self.write_registry({
            "innercircle": [{"number": 75}],
            "lastAssigned": {"number": 80, "at": "2026-08-01T00:00:00Z"},
        })
        self.assertEqual(series_floor_number(self.read_registry(), "innercircle"), 80)
        self.assertEqual(series_floor_number(self.read_registry(), "standard"), 0)
        self.assertIsNone(self.record("standard", "EP. 16"))
        counters = self.counters()
        self.assertEqual(counters["innercircle"], 80, "alter Stand ging verloren")
        self.assertEqual(counters["standard"], 16)

    def test_scalar_last_assigned_is_never_read_as_another_series(self) -> None:
        registry = {"livestream": [], "lastAssigned": {"number": 80}}
        self.assertEqual(series_floor_number(registry, "livestream"), 0)

    # --- Selbstpruefung ----------------------------------------------------

    def test_self_check_accepts_a_single_series_counter_change(self) -> None:
        before = self.seeded_registry()
        after = json.loads(json.dumps(before))
        after["lastAssigned"]["standard"] = {"number": 16, "at": "x"}
        self.assertIsNone(verify_only_series_touched(before, after, "standard"))

    def test_self_check_rejects_a_foreign_series_counter_change(self) -> None:
        before = self.seeded_registry()
        after = json.loads(json.dumps(before))
        after["lastAssigned"]["standard"] = {"number": 16, "at": "x"}
        after["lastAssigned"]["innercircle"] = {"number": 76, "at": "x"}
        violation = verify_only_series_touched(before, after, "standard")
        self.assertIsNotNone(violation)
        self.assertIn("innercircle", violation)

    def test_self_check_rejects_a_lost_or_changed_entry_list(self) -> None:
        before = self.seeded_registry()
        after = json.loads(json.dumps(before))
        after["lastAssigned"]["standard"] = {"number": 16, "at": "x"}
        after["innercircle"] = []
        violation = verify_only_series_touched(before, after, "standard")
        self.assertIsNotNone(violation)
        self.assertIn("innercircle", violation)

    def test_write_is_refused_when_the_pre_write_self_check_fails(self) -> None:
        """Statt eine falsche Serie zu beschreiben, wird abgebrochen -- die
        Datei darf die falsche Serie gar nicht erst zu sehen bekommen."""
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        with patch("thumbnail_service.verify_only_series_touched",
                   return_value="Der Zaehler der fremden Serie 'innercircle' hat sich veraendert."):
            warning = self.record("standard", "EP. 16")
        self.assertIsNotNone(warning)
        self.assertIn("Selbstpruefung", warning)
        self.assertIn("innercircle", warning)
        self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"),
                         "Registry wurde trotz fehlgeschlagener Selbstpruefung veraendert")
        self.assertFalse(list(self.backup_directory.glob("*.json")) if self.backup_directory.exists() else [],
                         "Es wurde gesichert, obwohl gar nicht geschrieben werden durfte")

    def test_registry_is_restored_when_the_post_write_self_check_fails(self) -> None:
        """Zweite Verteidigungslinie: die Pruefung vor dem Schreiben ist sauber,
        aber das, was tatsaechlich auf der Platte landet, ist es nicht -- dann
        wird das Backup zurueckgespielt."""
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        with patch("thumbnail_service.verify_only_series_touched",
                   side_effect=[None, "Der Zaehler der fremden Serie 'livestream' hat sich veraendert."]):
            warning = self.record("standard", "EP. 16")
        self.assertIsNotNone(warning)
        self.assertIn("Selbstpruefung nach dem Schreiben", warning)
        self.assertIn("zurueckgespielt", warning)
        self.assertEqual(before, self.registry_path.read_text(encoding="utf-8"),
                         "Registry wurde nicht auf den Stand vor dem Export zurueckgesetzt")

    def test_backup_is_written_before_the_registry_changes(self) -> None:
        self.write_registry(self.seeded_registry())
        before = self.registry_path.read_text(encoding="utf-8")
        self.assertIsNone(self.record("standard", "EP. 16"))
        backups = list(self.backup_directory.glob("series-registry-*.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(before, backups[0].read_text(encoding="utf-8"))


class SeriesRegistryClientBindingTest(unittest.TestCase):
    """Die Anzeige im Creator haengt am Preset, nicht am Feldnamen -- und die
    vier Presets muessen mit dem Dienst uebereinstimmen."""

    def setUp(self) -> None:
        self.html = Path("thumbnail-compositor.html").read_text(encoding="utf-8")

    def test_the_numbered_presets_declare_their_series(self) -> None:
        for preset, series in (
            ("standard", "standard"),
            ("innercircle", "innercircle"),
            ("livestream", "livestream"),
            ("aiv", "aiv"),
        ):
            self.assertIn(f"series:'{series}'", self.html, f"{preset} ohne Serie")

    def test_nonchart_declares_no_series_and_no_number_field(self) -> None:
        # nonchart und memberlive -- beide serienlos, deshalb zweimal die Zeile.
        self.assertEqual(
            2, self.html.count("series:null, numberField:null, numberPrefix:null")
        )

    def test_client_binds_the_hint_to_the_preset_not_the_field_name(self) -> None:
        self.assertIn("cfg.series && f.id === cfg.numberField", self.html)
        self.assertNotIn("epIC' && icRegistryNextNumber", self.html)

    def test_no_hardcoded_episode_number_is_left_in_the_defaults(self) -> None:
        self.assertNotIn("EP. 143", self.html)
        self.assertNotIn("INNER CIRCLE #12", self.html)
        self.assertNotIn("LIVESTREAM #1'", self.html)

    def test_client_and_service_agree_on_the_series_names(self) -> None:
        self.assertIn(
            "const SERIES_NAMES = ['aiv', 'innercircle', 'livestream', 'standard'];",
            self.html,
        )
        self.assertEqual(SERIES_NAMES, ("aiv", "innercircle", "livestream", "standard"))



class EmblemLayerTest(unittest.TestCase):
    """BJ2/BK2: die Emblem-Ebene und ihre Sperrflaeche haengen am Preset aiv.
    Alle anderen Presets muessen davon unberuehrt bleiben."""

    def setUp(self) -> None:
        self.html = Path("thumbnail-compositor.html").read_text(encoding="utf-8")

    def test_emblem_is_embedded_as_data_uri(self) -> None:
        """Weder der Dienst noch die Render-Harness liefern statische Dateien --
        das Emblem muss in der HTML liegen, nicht als Dateipfad."""
        self.assertIn("const AIV_EMBLEM_DATA_URI = 'data:image/png;base64,", self.html)
        self.assertNotIn('src="assets/branding', self.html)

    def test_draw_emblem_returns_early_for_every_other_preset(self) -> None:
        self.assertIn("function drawEmblem(){\n  if (state.preset !== 'aiv') return;", self.html)

    def test_emblem_is_drawn_between_vignette_and_watermark(self) -> None:
        order = self.html[self.html.index("  drawImageCover();"):]
        order = order[: order.index("}")]
        self.assertLess(order.index("drawVignette()"), order.index("drawEmblem()"))
        self.assertLess(order.index("drawEmblem()"), order.index("drawWatermark()"))

    def test_block_rect_is_null_without_aiv_and_without_a_loaded_emblem(self) -> None:
        """Kern der BK2-Zusage: liefert emblemBlockRect() null, bleibt die
        Belegungskarte in autoPlace() unveraendert."""
        self.assertIn(
            "if (state.preset !== 'aiv' || !state.emblemImg) return null;", self.html
        )

    def test_auto_place_only_stamps_the_map_when_a_block_exists(self) -> None:
        self.assertIn("const block = emblemBlockRect();\n  if (block){", self.html)

    def test_block_rect_follows_the_ui_values(self) -> None:
        """Sperrflaeche aus emblemX/emblemY/emblemSize plus Rand -- verschiebt
        man das Emblem, wandert sie mit."""
        for token in ("state.emblemX - half - pad", "state.emblemY - half - pad",
                      "const half = state.emblemSize/2"):
            self.assertIn(token, self.html)
        self.assertIn("if (state.auto && state.img) applyAuto(); else render();", self.html)

    def test_image_cover_is_untouched_by_the_emblem(self) -> None:
        """Die zweite Bildebene darf nicht in drawImageCover() eingreifen."""
        cover = self.html[self.html.index("function drawImageCover(){"):]
        cover = cover[: cover.index("// ---------- scrim")]
        self.assertNotIn("emblem", cover.lower())


if __name__ == "__main__":
    unittest.main()
