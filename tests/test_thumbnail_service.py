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
    run_server,
    select_latest_png,
    signal_running_instance,
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
        self.assertIn("return result.filename;", self.html)
        self.assertIn(
            "Gespeichert im Export-Ordner: '+serviceFilename", self.html
        )
        self.assertNotIn(
            "writeExportToLocalService(blob, filename) ||", self.html
        )

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


if __name__ == "__main__":
    unittest.main()
