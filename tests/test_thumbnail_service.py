from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import quote, unquote

from thumbnail_service import (
    SERIES_NAMES,
    AUFNAHME_DIRECTORY_ENV,
    AUFNAHME_HERKUNFT_BESTAETIGT,
    AUFNAHME_HERKUNFT_LEER,
    AUFNAHME_HERKUNFT_UNBESTAETIGT,
    AUFNAHME_HERKUNFT_WERTE,
    BEIPACKZETTEL_SCHEMA_VERSION,
    VIDEOTITEL_MAX_ZEICHEN,
    beipackzettel_name,
    build_beipackzettel,
    AUFNAHME_PATTERN,
    pruefe_aufnahme,
    pruefe_aufnahme_herkunft,
    pruefe_videotitel,
    resolve_optional_directory,
    sammle_aufnahmen,
    write_beipackzettel,
    zaehle_titel_zeichen,
    BrowserOpenChannel,
    BrowserOpenCoordinator,
    HOST,
    FileSnapshot,
    PNG_SIGNATURE,
    PortOccupant,
    QuitChannel,
    REPARSE_ATTRIBUTE,
    SERVICE_FILE,
    SERVICE_ID,
    SERVICE_PROTOCOL_VERSION,
    SingleInstanceGuard,
    SourceSelectionError,
    _console_print,
    _health_is_expected,
    _network_port_value,
    command_line_names_this_service,
    create_server,
    describe_port_occupant,
    inspect_port_occupant,
    resolve_port_conflict,
    stop_running_instance,
    instance_marker_path,
    marker_matches_process,
    read_instance_marker,
    remove_instance_marker,
    write_instance_marker,
    foreign_owner_hint,
    unknown_owner_hint,
    EXIT_WHEN_IDLE_ENV,
    IDLE_TIMEOUT_SECONDS,
    IdleShutdownGuard,
    MAX_TRACKED_SESSIONS,
    exit_when_idle_default,
    describe_directory,
    normalized_last_assigned,
    read_env_file,
    record_series_registry_export,
    resolve_directory,
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


# EC: DIE WACHE UEBER data/series-registry.json.
#
# In DZ ist der HTTP-Pfad einmal in die ECHTE Registry dieses Repos gelaufen --
# ein Test schickte "EP. 144", und der laufende Zaehler des Kanals sprang auf
# 144. Behoben wurde das in HttpEndpointTests.setUp(), indem die Modul-Globalen
# auf einen temporaeren Ordner zeigen. Diese Wache prueft, dass die Behebung
# HAELT: sie haengt nicht an einer Klasse, sondern am Modul, und faellt auf,
# sobald IRGENDEIN Test dieses Laufs die echte Datei anfasst -- auch ein Test
# in einer Klasse, die es heute noch nicht gibt und die den Patch vergisst.
_ECHTE_REGISTRY = Path(__file__).resolve().parents[1] / "data" / "series-registry.json"
_REGISTRY_VORHER: "tuple[bool, str | None] | None" = None
_REGISTRY_SCHUTZ: "tempfile.TemporaryDirectory | None" = None
_REGISTRY_PATCHER: list = []


def _registry_zustand() -> "tuple[bool, str | None]":
    try:
        rohdaten = _ECHTE_REGISTRY.read_bytes()
    except FileNotFoundError:
        return (False, None)
    return (True, hashlib.sha256(rohdaten).hexdigest())


def setUpModule() -> None:
    """Erst der Riegel, dann die Wache.

    DER RIEGEL: die Modul-Globalen zeigen fuer den GANZEN Lauf auf einen
    temporaeren Ordner. HttpEndpointTests.setUp() biegt sie zusaetzlich pro
    Test um -- das bleibt, weil jeder Test seinen eigenen leeren Zaehler
    braucht. Der Riegel hier faengt die Klassen ab, die das VERGESSEN. Eine
    Wache allein reichte nicht: sie meldet den Schaden, nachdem er entstanden
    ist, und die echte Datei ist gitignored -- ein "git checkout" holt sie
    nicht zurueck.

    DIE WACHE: der sha256 der echten Datei vor und nach dem Lauf. Sie faellt
    auf, wenn ein Test die Datei auf einem Weg erreicht, an den der Riegel
    nicht denkt -- etwa mit einem woertlichen Pfad statt ueber die Globale.
    """
    global _REGISTRY_VORHER, _REGISTRY_SCHUTZ
    _REGISTRY_VORHER = _registry_zustand()
    _REGISTRY_SCHUTZ = tempfile.TemporaryDirectory()
    schutz = Path(_REGISTRY_SCHUTZ.name)
    for ziel, wert in (
        ("thumbnail_service.SERIES_REGISTRY_FILE", schutz / "series-registry.json"),
        ("thumbnail_service.SERIES_REGISTRY_BACKUP_DIRECTORY", schutz / "backups"),
    ):
        patcher = patch(ziel, wert)
        patcher.start()
        _REGISTRY_PATCHER.append(patcher)


def tearDownModule() -> None:
    while _REGISTRY_PATCHER:
        _REGISTRY_PATCHER.pop().stop()
    if _REGISTRY_SCHUTZ is not None:
        _REGISTRY_SCHUTZ.cleanup()
    nachher = _registry_zustand()
    if nachher != _REGISTRY_VORHER:
        raise AssertionError(
            "Ein Test dieses Laufs hat die ECHTE data/series-registry.json "
            f"veraendert (vorher {_REGISTRY_VORHER}, nachher {nachher}). "
            "Der HTTP-Pfad schreibt die Registry ueber die Modul-Globalen. "
            "Sie sind fuer den ganzen Lauf auf einen temporaeren Ordner "
            "gebogen (setUpModule) -- wer sie trotzdem erreicht, tut es an "
            "den Globalen vorbei. Die Datei ist gitignored; sie laesst sich "
            "nur aus backups/ zurueckholen."
        )


class RegistrySchutzTests(unittest.TestCase):
    """EC: Der Riegel selbst -- er soll nicht unbemerkt verschwinden.

    In DZ ist der HTTP-Pfad einmal in die ECHTE Registry gelaufen: ein Test
    schickte "EP. 144", und der laufende Zaehler des Kanals sprang auf 144.
    Diese Pruefung haelt fest, dass die Umleitung waehrend eines Laufs
    tatsaechlich steht -- und zwar fuer JEDE Klasse, nicht nur fuer die, die
    sich selbst darum kuemmert.
    """

    def test_no_test_can_reach_the_real_registry_through_the_globals(self) -> None:
        import thumbnail_service as dienst

        self.assertNotEqual(dienst.SERIES_REGISTRY_FILE, _ECHTE_REGISTRY)
        self.assertNotEqual(
            dienst.SERIES_REGISTRY_BACKUP_DIRECTORY,
            _ECHTE_REGISTRY.parents[1] / "backups",
        )

    def test_the_watch_knows_the_state_it_has_to_restore(self) -> None:
        self.assertEqual(_registry_zustand(), _REGISTRY_VORHER)


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
        # DZ: Der HTTP-Pfad schreibt die Serien-Registry ueber die
        # Modul-Globalen -- also in das ECHTE data/series-registry.json dieses
        # Repos. Jeder Test, der X-Export-Preset mitschickt, haette damit den
        # laufenden Zaehler des Kanals verstellt (einmal passiert: standard
        # sprang auf 144, weil ein Test "EP. 144" schickte). Hier auf den
        # temporaeren Ordner umgebogen. SeriesRegistryPerSeriesTest ruft die
        # reine Funktion mit expliziten Pfaden und war davon nie betroffen --
        # nur der Weg ueber HTTP.
        self.registry_path = root / "series-registry.json"
        self.registry_backups = root / "backups"
        for ziel, wert in (
            ("thumbnail_service.SERIES_REGISTRY_FILE", self.registry_path),
            ("thumbnail_service.SERIES_REGISTRY_BACKUP_DIRECTORY", self.registry_backups),
        ):
            patcher = patch(ziel, wert)
            patcher.start()
            self.addCleanup(patcher.stop)
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

    def bilder(self) -> set[str]:
        """Nur die Bilder im Exportordner.

        Seit DZ liegt neben jedem Bild ein Beipackzettel gleichen Namens mit der
        Endung .json. Die Pruefungen zur Namensvergabe meinen die BILDER --
        deshalb hier gefiltert statt jede einzelne Erwartung zu verdoppeln. Dass
        der Zettel wirklich entsteht, pruefen die BeipackzettelTests.
        """

        return {
            entry.name
            for entry in self.export.iterdir()
            if entry.suffix.lower() != ".json"
        }

    def export_request(
        self,
        filename: str,
        content_type: str,
        payload: bytes,
        *,
        preset: str | None = None,
        episode: str | None = None,
        beipackzettel: object = None,
        beipackzettel_roh: str | None = None,
    ) -> tuple[int, dict[str, str], dict[str, object]]:
        request_headers = {
            "Content-Type": content_type,
            "Content-Length": str(len(payload)),
            "X-Export-Filename": filename,
        }
        if preset is not None:
            request_headers["X-Export-Preset"] = preset
        if episode is not None:
            request_headers["X-Export-Episode"] = quote(episode)
        if beipackzettel_roh is not None:
            request_headers["X-Export-Beipackzettel"] = beipackzettel_roh
        elif beipackzettel is not None:
            request_headers["X-Export-Beipackzettel"] = quote(
                json.dumps(beipackzettel, ensure_ascii=False)
            )
        status, headers, data = self.request(
            method="POST",
            path="/api/export",
            body=payload,
            headers=request_headers,
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
        self.assertEqual(sorted(self.bilder()), sorted(expected))

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
        self.assertEqual(sorted(self.bilder()), sorted(expected))

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
        before = self.bilder()
        status, _, result = self.export_request(
            "thumbnail.png", "image/png", png_bytes(b"new")
        )
        after = self.bilder()
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
            {
                path.read_bytes()
                for path in self.export.iterdir()
                if path.suffix.lower() != ".json"
            },
            set(payloads),
        )
        # Und zu jedem der acht Bilder liegt genau ein Beipackzettel.
        self.assertEqual(
            {beipackzettel_name(name) for name in names},
            {
                path.name
                for path in self.export.iterdir()
                if path.suffix.lower() == ".json"
            },
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



class EmblemRouteTests(HttpEndpointTests):
    """CJ1: /api/emblem liefert eine Variante read-only aus
    assets/branding/emblems/. Die Route nimmt Nutzereingabe entgegen und baut
    daraus einen Dateipfad -- deshalb hier die Sicherheitspruefungen einzeln."""

    def emblem(self, slug: str, **kwargs):
        return self.request(path="/api/emblem?slug=" + slug, **kwargs)

    def test_known_slug_returns_a_png(self) -> None:
        status, headers, data = self.emblem("neutral")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "image/png")
        self.assertEqual(data[:8], bytes.fromhex("89504e470d0a1a0a"))

    def test_unknown_slug_is_a_clean_404(self) -> None:
        status, _, data = self.emblem("gibtesnicht")
        self.assertEqual(status, 404)
        self.assertIn(b"emblem_missing", data)

    def test_path_traversal_is_refused(self) -> None:
        """Weder ueber Verzeichniswechsel noch ueber Pfadtrenner noch ueber
        prozentcodierte Varianten darf etwas ausserhalb des Ordners kommen."""
        for slug in (
            "..%2F..%2Fthumbnail_service",
            "..%2F..%2F.env",
            "%2Fetc%2Fpasswd",
            "neutral%2F..%2F..%2Fpackage",
            "..",
            "....%2F%2Fneutral",
        ):
            with self.subTest(slug=slug):
                status, _, data = self.emblem(slug)
                self.assertIn(status, (400, 404))
                self.assertNotIn(b"PNG", data[:64])

    def test_uppercase_and_extension_are_refused(self) -> None:
        """Der Slug ist der nackte Dateiname ohne Endung, nur klein."""
        for slug in ("Neutral", "neutral.png", "neutral%00", "neutral+", "neutral%20"):
            with self.subTest(slug=slug):
                status, _, _ = self.emblem(slug)
                self.assertIn(status, (400, 404))

    def test_missing_or_wrong_token_is_refused(self) -> None:
        status, _, _ = self.emblem("neutral", token=None)
        self.assertEqual(status, 401)
        status, _, _ = self.emblem("neutral", token="falsch-aber-lang-genug-xxxxxx")
        self.assertEqual(status, 401)

    def test_slug_parameter_must_appear_exactly_once(self) -> None:
        for query in ("", "?slug=", "?slug=neutral&slug=ernst"):
            with self.subTest(query=query):
                status, _, _ = self.request(path="/api/emblem" + query)
                self.assertIn(status, (400, 404))

    def test_route_is_read_only(self) -> None:
        status, _, data = self.request(method="POST", path="/api/emblem?slug=neutral")
        self.assertEqual(status, 405)
        self.assertIn(b"method_not_allowed", data)


class EmblemFallbackTests(unittest.TestCase):
    """CJ1: Ohne laufenden Dienst darf NICHT emblemlos gerendert werden -- der
    eingebettete Rueckfall muss greifen."""

    def setUp(self) -> None:
        self.html = Path("thumbnail-compositor.html").read_text(encoding="utf-8")

    def test_exactly_one_variant_is_embedded(self) -> None:
        self.assertEqual(1, self.html.count("const EMBLEM_FALLBACK_URI = 'data:image/png;base64,"))
        self.assertIn("const EMBLEM_FALLBACK_SLUG = 'neutral';", self.html)

    def test_fallback_is_loaded_before_the_service_is_consulted(self) -> None:
        load = self.html[self.html.index("function loadEmblem(){"):]
        load = load[: load.index("\n}")]
        self.assertLess(
            load.index("EMBLEM_FALLBACK_URI"), load.index("localService.available")
        )

    def test_current_emblem_falls_back_instead_of_drawing_nothing(self) -> None:
        self.assertIn("|| emblemImages[EMBLEM_FALLBACK_SLUG]", self.html)

    def test_service_failure_per_variant_is_caught(self) -> None:
        """Ein Ausfall bei EINER Variante darf nicht den ganzen Ladevorgang
        abbrechen -- sonst faellt auch der Rueckfall aus."""
        self.assertIn("catch (error){ fehler.push(slug);", self.html)
        self.assertIn("nicht vom Dienst ladbar.", self.html)

    def test_a_stale_service_is_detected_and_shown(self) -> None:
        """Die HTML wird pro Anfrage von der Platte gelesen -- ein weiterlaufender
        Dienst aelterer Fassung liefert also die NEUE Oberflaeche mit einem ALTEN
        Routenangebot. Ohne Versionspruefung faellt das nur in der Browserkonsole
        auf, waehrend sichtbar stumm der Rueckfall gezeichnet wird."""
        self.assertIn("const REQUIRED_PROTOCOL_VERSION = 2;", self.html)
        self.assertIn("if (version !== null && version < REQUIRED_PROTOCOL_VERSION){", self.html)
        self.assertIn("bitte den Dienst neu starten", self.html)
        # Die beiden Zahlen duerfen auseinanderlaufen: die Dienstversion steigt
        # mit JEDER Aenderung am Routenangebot (mit /api/session/ping auf 3),
        # die Anforderung der Seite nur, wenn sie auf eine neue Route
        # ANGEWIESEN ist. Das Lebenszeichen ist sie nicht -- gegen einen
        # aelteren Dienst laeuft der Compositor vollstaendig weiter, nur ohne
        # Selbstbeendigung. Fordern darf die Seite aber nie mehr, als der
        # Dienst anbietet.
        self.assertLessEqual(2, SERVICE_PROTOCOL_VERSION)

    def test_load_failures_reach_the_user_interface(self) -> None:
        self.assertIn("emblemWarnungEl.textContent = emblemLoadWarnung;", self.html)
        self.assertIn('id="emblemWarnung"', self.html)

    def test_token_travels_in_a_header_not_in_the_url(self) -> None:
        self.assertIn("headers: { 'X-Session-Token': localService.token }", self.html)


class EmblemGlowColourTests(unittest.TestCase):
    """CJ2: Die Scheinfarbe folgt der gemessenen Helligkeit des Motivs."""

    def setUp(self) -> None:
        self.html = Path("thumbnail-compositor.html").read_text(encoding="utf-8")

    def test_bright_variants_get_a_dark_glow(self) -> None:
        self.assertIn("return (meta && meta.hell) ? EMBLEM_GLOW.dark : EMBLEM_GLOW.color;", self.html)
        self.assertIn("ctx.shadowColor = emblemGlowColor();", self.html)

    def test_brightness_is_measured_at_embed_time(self) -> None:
        script = Path("scripts/embed-aiv-emblem.cjs").read_text(encoding="utf-8")
        self.assertIn("const HELL_SCHWELLE = 90;", script)
        self.assertIn("hell: " + '"' + " + (v.median > HELL_SCHWELLE) + " + '"', script.replace("'", '"'))

    def test_the_colour_follows_the_shown_variant_not_the_selected_one(self) -> None:
        """Greift der Rueckfall, muss die Farbe zur TATSAECHLICH gezeichneten
        Variante passen -- sonst bekaeme ein helles Motiv den hellen Schein."""
        self.assertIn("const meta = EMBLEM_META[shownEmblemSlug()];", self.html)

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
        # Der Quellimport pollt weiterhin nicht. Seit CQ1 gibt es genau EINEN
        # Intervall im Dokument -- das Lebenszeichen an den Dienst. Es fragt
        # nichts ab, sondern meldet nur, dass diese Seite noch offen ist.
        self.assertEqual(1, self.html.count("setInterval("))
        self.assertIn(
            "heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);",
            self.html,
        )

    def test_source_file_is_always_created_as_png(self) -> None:
        self.assertIn(
            "new File([blob], source.filename, {type:'image/png'", self.html
        )

    def test_client_uses_server_confirmed_export_filename(self) -> None:
        # Seit der registry_warning-Erweiterung liefert writeExportToLocalService
        # ein Objekt {filename, warning} statt eines nackten Strings -- der
        # angezeigte Name muss weiterhin der vom Dienst BESTAETIGTE sein, nie der
        # lokal gebaute.
        self.assertIn("      filename: result.filename,", self.html)
        self.assertIn(
            "'Gespeichert im Export-Ordner: '+gespeichert.filename", self.html
        )
        self.assertNotIn(
            "writeExportToLocalService(blob, filename) ||", self.html
        )
        # DZ: Der angezeigte Name kommt weiterhin aus der ANTWORT des Dienstes,
        # nicht aus dem lokal gebauten Namen -- und der Beipackzettel auch.
        self.assertNotIn("'Gespeichert im Export-Ordner: '+filename", self.html)

    def test_client_surfaces_a_registry_warning_next_to_the_filename(self) -> None:
        # DZ: Seit dem Beipackzettel koennen ZWEI Hinweise anfallen (Registry und
        # Zettel). Beide stehen hinter demselben ACHTUNG, keiner faellt weg.
        self.assertIn("gespeichert.warning", self.html)
        self.assertIn(
            "const hinweise = [gespeichert.warning, gespeichert.beipackzettelWarnung].filter(Boolean);",
            self.html,
        )
        self.assertIn("' — ACHTUNG: '+hinweise.join(' ')", self.html)

    def test_every_source_error_code_has_its_own_label(self) -> None:
        """CN2: Verschiedene Ursachen duerfen nicht gleich aussehen.

        'source_missing' (Ordner gibt es nicht), 'source_invalid' (nur
        unbrauchbare PNGs) und 'source_empty' (Ordner ist leer) fielen frueher
        gemeinsam auf "KEIN BILD GEFUNDEN". Ein falsch konfigurierter Ordner war
        dadurch von einem leeren nicht zu unterscheiden -- genau die Faehrte,
        die die Fehlersuche zweimal in die Irre geschickt hat.
        """
        for code, phase in (
            ("source_missing", "missing"),
            ("source_unreadable", "unreadable"),
            ("source_invalid", "invalid"),
            ("source_empty", "empty"),
            ("source_unstable", "unstable"),
        ):
            with self.subTest(code=code):
                self.assertIn(f"if (code === '{code}') return '{phase}';", self.html)

        for phase, label in (
            ("missing", "QUELLE: ORDNER NICHT GEFUNDEN"),
            ("unreadable", "QUELLE: ORDNER NICHT LESBAR"),
            ("invalid", "QUELLE: NUR UNGEEIGNETE PNG-DATEIEN"),
            ("empty", "QUELLE: KEIN BILD GEFUNDEN"),
        ):
            with self.subTest(phase=phase):
                self.assertIn(f"{phase}: '{label}'", self.html)

    def test_no_source_codes_are_folded_onto_one_label(self) -> None:
        """Die alte Sammelzeile darf nicht zurueckkehren."""
        self.assertNotIn(
            "code === 'source_empty' || code === 'source_invalid'", self.html
        )

    def test_unknown_source_code_still_shows_the_service_message(self) -> None:
        """Ein neuer Code darf nicht wortlos zu "FEHLER" werden."""
        self.assertIn(
            "phase === 'error' && error && error.message", self.html
        )
        self.assertIn("setSourcePhase(phase, detail);", self.html)

    def test_failed_service_export_names_the_reason(self) -> None:
        """CN2, zweiter Fall: Der Grund verschwand im console.error.

        Schlug der Dienst-Export fehl, fiel der Aufrufer stumm auf den
        Browserdownload zurueck und meldete "Direktes Speichern nicht
        verfuegbar" -- ein fehlender Exportordner sah damit aus wie ein
        fehlender Dateisystemzugriff.
        """
        self.assertIn("exportServiceFailure = error && error.message", self.html)
        self.assertIn(
            "'Speichern im Export-Ordner fehlgeschlagen: '+exportServiceFailure",
            self.html,
        )
        self.assertIn("exportServiceFailure = null;", self.html)

    def test_export_button_keeps_single_flight_guard_and_finally_reset(self) -> None:
        self.assertIn(
            "if (!state.img || exportDirectory.busy) return;", self.html
        )
        self.assertIn("exportDirectory.busy = true;", self.html)
        self.assertIn("exportDirectory.busy = false;", self.html)
        self.assertIn("exportBtn.disabled = !state.img;", self.html)


class BeipackzettelTests(HttpEndpointTests):
    """DZ: Neben jedem exportierten Bild liegt eine Datei gleichen Namens mit der
    Endung .json -- der Beipackzettel. Er schreibt auf, welches Bild zu welchem
    Video gehoert. Ohne ihn bliebe dem Uploader nur "die neueste Datei", und das
    ist eine Vermutung."""

    quelle = {
        "herkunft": "dienst",
        "dateiname": "BTCUSD_2026-09-02_12-45-54_b24cd.png",
        "zeitstempel": "2026-09-02T10:45:54.000Z",
    }

    def zettel(self, name: str) -> dict:
        return json.loads((self.export / name).read_text(encoding="utf-8"))

    def test_export_lays_a_beipackzettel_next_to_the_image(self) -> None:
        payload = png_bytes(b"mit-zettel")
        status, _, result = self.export_request(
            "adw-standard-ep-144.png",
            "image/png",
            payload,
            preset="standard",
            episode="EP. 144",
            beipackzettel={
                "videotitel": "Der Markt kippt \u2014 was jetzt z\u00e4hlt",
                "datum": "2026-09-03",
                "chart_quelle": self.quelle,
            },
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["beipackzettel"], "adw-standard-ep-144.json")
        self.assertNotIn("beipackzettel_warnung", result)
        zettel = self.zettel("adw-standard-ep-144.json")
        self.assertEqual(zettel["schema_version"], BEIPACKZETTEL_SCHEMA_VERSION)
        self.assertEqual(zettel["bild"]["dateiname"], "adw-standard-ep-144.png")
        self.assertEqual(zettel["bild"]["bytes"], len(payload))
        self.assertEqual(zettel["videotitel"], "Der Markt kippt \u2014 was jetzt z\u00e4hlt")
        self.assertEqual(zettel["episode"], "EP. 144")
        self.assertEqual(zettel["datum"], "2026-09-03")
        self.assertEqual(zettel["format"], "standard")
        self.assertEqual(zettel["chart_quelle"], self.quelle)
        # Der Exportzeitpunkt ist eine lesbare ISO-8601-Zeit mit Zonenversatz.
        self.assertIsNotNone(
            datetime.datetime.fromisoformat(zettel["exportiert_am"]).tzinfo
        )

    def test_the_sha256_in_the_note_matches_the_image_on_disk(self) -> None:
        """Der Kern des Zettels: die Pruefsumme muss gegen die Platte stimmen,
        nicht gegen das, was der Dienst empfangen zu haben glaubt."""
        payload = png_bytes(b"pruefsumme")
        status, _, result = self.export_request(
            "adw-pruefsumme.png", "image/png", payload, preset="standard"
        )
        self.assertEqual(status, 200, result)
        auf_platte = (self.export / result["filename"]).read_bytes()
        self.assertEqual(
            self.zettel(result["beipackzettel"])["bild"]["sha256"],
            hashlib.sha256(auf_platte).hexdigest(),
        )

    def test_the_note_follows_the_suffixed_image_name(self) -> None:
        """Bei Namenskollision heisst das Bild 'x (2).png' -- der Zettel muss
        'x (2).json' heissen, sonst zeigt er auf das falsche Bild."""
        for index in range(2):
            status, _, result = self.export_request(
                "adw-doppelt.png",
                "image/png",
                png_bytes(f"lauf-{index}".encode()),
                preset="standard",
            )
            self.assertEqual(status, 200, result)
        self.assertEqual(result["filename"], "adw-doppelt (2).png")
        self.assertEqual(result["beipackzettel"], "adw-doppelt (2).json")
        zettel = self.zettel("adw-doppelt (2).json")
        self.assertEqual(zettel["bild"]["dateiname"], "adw-doppelt (2).png")
        self.assertEqual(
            zettel["bild"]["sha256"],
            hashlib.sha256((self.export / "adw-doppelt (2).png").read_bytes()).hexdigest(),
        )
        # Und der erste Zettel zeigt weiterhin auf das erste Bild.
        self.assertEqual(
            self.zettel("adw-doppelt.json")["bild"]["sha256"],
            hashlib.sha256((self.export / "adw-doppelt.png").read_bytes()).hexdigest(),
        )

    def test_a_jpg_export_gets_a_json_note_too(self) -> None:
        status, _, result = self.export_request(
            "adw-jpg.jpg", "image/jpeg", b"\xff\xd8jpeg", preset="livestream"
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["beipackzettel"], "adw-jpg.json")
        self.assertEqual(self.zettel("adw-jpg.json")["format"], "livestream")

    def test_missing_fields_become_null_instead_of_empty_strings(self) -> None:
        """Ein leerer Videotitel ist erlaubt -- der YouTube-Titel steht beim Bau
        des Thumbnails nicht immer schon fest. Er wird dann als Luecke notiert,
        nicht als leerer Text."""
        status, _, result = self.export_request(
            "adw-leer.png",
            "image/png",
            png_bytes(b"leer"),
            preset="memberlive",
            episode="",
            beipackzettel={"videotitel": "   ", "datum": "", "chart_quelle": None},
        )
        self.assertEqual(status, 200, result)
        zettel = self.zettel("adw-leer.json")
        self.assertIsNone(zettel["videotitel"])
        self.assertIsNone(zettel["episode"])
        self.assertIsNone(zettel["datum"])
        self.assertIsNone(zettel["chart_quelle"])

    def test_the_registry_write_lands_in_the_test_directory(self) -> None:
        """Beweist zugleich, dass die Umbiegung in setUp greift: der Zaehler
        landet im temporaeren Ordner und nicht im echten Repo."""
        status, _, result = self.export_request(
            "adw-registry.png",
            "image/png",
            png_bytes(b"registry"),
            preset="standard",
            episode="EP. 4711",
        )
        self.assertEqual(status, 200, result)
        self.assertTrue(self.registry_path.is_file())
        eintrag = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(eintrag["lastAssigned"]["standard"]["number"], 4711)

    def test_an_export_without_the_metadata_header_still_gets_a_note(self) -> None:
        status, _, result = self.export_request(
            "adw-ohne-header.png", "image/png", png_bytes(b"ohne"), preset="standard"
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["beipackzettel"], "adw-ohne-header.json")
        self.assertIsNone(self.zettel("adw-ohne-header.json")["videotitel"])

    # ---- Punkt 1: die Grenze des Videotitels -------------------------------

    def test_a_video_title_with_101_codepoints_is_refused(self) -> None:
        status, _, data = self.export_request(
            "adw-zu-lang.png",
            "image/png",
            png_bytes(b"zu-lang"),
            beipackzettel={"videotitel": "a" * 101},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["code"], "invalid_video_title")
        self.assertIn("101", data["message"])
        # NICHTS wurde geschrieben -- weder Bild noch Zettel.
        self.assertEqual(list(self.export.iterdir()), [])

    def test_exactly_100_codepoints_are_accepted(self) -> None:
        status, _, result = self.export_request(
            "adw-genau-100.png",
            "image/png",
            png_bytes(b"genau"),
            beipackzettel={"videotitel": "a" * 100},
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(len(self.zettel("adw-genau-100.json")["videotitel"]), 100)

    def test_a_video_title_with_an_angle_bracket_is_refused(self) -> None:
        for zeichen in ("<", ">"):
            with self.subTest(zeichen=zeichen):
                status, _, data = self.export_request(
                    "adw-spitz.png",
                    "image/png",
                    png_bytes(b"spitz"),
                    beipackzettel={"videotitel": f"Der Markt {zeichen} kippt"},
                )
                self.assertEqual(status, 400)
                self.assertEqual(data["code"], "invalid_video_title")
                self.assertEqual(list(self.export.iterdir()), [])

    def test_the_limit_is_counted_in_codepoints_not_utf16_units(self) -> None:
        """DR, noch einmal: der Uploader zaehlte einst UTF-16-Einheiten und die
        Freigabeseite Codepunkte. Ein Titel aus 100 Emoji hat 200 UTF-16-
        Einheiten und muss trotzdem durchgehen -- sonst gibt es wieder zwei
        Zaehlweisen fuer dieselbe Grenze."""
        hundert_emoji = "\U0001f642" * 100
        self.assertEqual(len(hundert_emoji.encode("utf-16-le")) // 2, 200)
        status, _, result = self.export_request(
            "adw-emoji.png",
            "image/png",
            png_bytes(b"emoji"),
            beipackzettel={"videotitel": hundert_emoji},
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(self.zettel("adw-emoji.json")["videotitel"], hundert_emoji)

        status, _, data = self.export_request(
            "adw-emoji-zuviel.png",
            "image/png",
            png_bytes(b"emoji2"),
            beipackzettel={"videotitel": "\U0001f642" * 101},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["code"], "invalid_video_title")

    def test_a_broken_metadata_header_is_refused_instead_of_ignored(self) -> None:
        status, _, data = self.export_request(
            "adw-kaputt.png",
            "image/png",
            png_bytes(b"kaputt"),
            beipackzettel_roh="%7Bkein-json",
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["code"], "invalid_export_metadata")
        self.assertEqual(list(self.export.iterdir()), [])

    def test_a_metadata_header_that_is_not_an_object_is_refused(self) -> None:
        status, _, data = self.export_request(
            "adw-liste.png", "image/png", png_bytes(b"liste"), beipackzettel=["a"]
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["code"], "invalid_export_metadata")

    def test_an_unknown_field_in_the_source_does_not_reach_the_file(self) -> None:
        """Was im Header steht, wird nicht ungeprueft in eine Datei kopiert, die
        spaeter jemand liest."""
        status, _, result = self.export_request(
            "adw-fremd.png",
            "image/png",
            png_bytes(b"fremd"),
            preset="standard",
            beipackzettel={
                "videotitel": "ok",
                "chart_quelle": {"dateiname": "c.png", "boeses": {"tief": 1}},
                "unbekannt": "irgendwas",
            },
        )
        self.assertEqual(status, 200, result)
        zettel = self.zettel("adw-fremd.json")
        self.assertEqual(zettel["chart_quelle"], {"dateiname": "c.png"})
        self.assertNotIn("unbekannt", zettel)


class AufnahmeImZettelTests(HttpEndpointTests):
    """EC: Was ueber HTTP mit dem Feld `aufnahme` passiert -- und was nicht."""

    def zettel(self, name: str) -> dict:
        return json.loads((self.export / name).read_text(encoding="utf-8"))

    def test_a_confirmed_recording_lands_in_the_note(self) -> None:
        status, _, result = self.export_request(
            "adw-standard-ep-18.png",
            "image/png",
            png_bytes(b"mit-aufnahme"),
            preset="standard",
            episode="EP. 18",
            beipackzettel={
                "videotitel": "Was der Markt heute sagt",
                "datum": "2026-09-02",
                "aufnahme": "2026-09-02 12-10-37",
                "aufnahme_herkunft": AUFNAHME_HERKUNFT_BESTAETIGT,
            },
        )
        self.assertEqual(status, 200, result)
        zettel = self.zettel("adw-standard-ep-18.json")
        self.assertEqual(zettel["aufnahme"], "2026-09-02 12-10-37")
        self.assertEqual(zettel["aufnahme_herkunft"], AUFNAHME_HERKUNFT_BESTAETIGT)
        # Das Feld ist additiv: die Version bleibt 1, alles andere steht weiter da.
        self.assertEqual(zettel["schema_version"], BEIPACKZETTEL_SCHEMA_VERSION)
        self.assertEqual(zettel["episode"], "EP. 18")

    def test_no_recording_is_written_as_empty_and_not_as_missing(self) -> None:
        """"Leer lassen" heisst: es steht im Zettel, dass nichts da ist.

        Ein FEHLENDES Feld waere ein Zettel von vor diesem Nachtrag -- und der
        Longform-Weg behandelt den anders (Rueckfall statt Regel). Die beiden
        Faelle muessen unterscheidbar bleiben.
        """
        status, _, result = self.export_request(
            "adw-ohne-aufnahme.png",
            "image/png",
            png_bytes(b"ohne-aufnahme"),
            preset="standard",
            beipackzettel={"videotitel": "Ohne Aufnahme"},
        )
        self.assertEqual(status, 200, result)
        zettel = self.zettel("adw-ohne-aufnahme.json")
        self.assertIn("aufnahme", zettel)
        self.assertIsNone(zettel["aufnahme"])
        self.assertEqual(zettel["aufnahme_herkunft"], AUFNAHME_HERKUNFT_LEER)

    def test_a_malformed_recording_is_refused_before_anything_is_written(self) -> None:
        """Wie beim Videotitel: der Mangel darf nicht erst auffallen, wenn das
        Bild schon liegt."""
        status, _, result = self.export_request(
            "adw-krumm.png",
            "image/png",
            png_bytes(b"krumm"),
            preset="standard",
            beipackzettel={"aufnahme": "2026-09-02T12:10:37"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(result["code"], "invalid_aufnahme")
        self.assertIn("JJJJ-MM-TT HH-MM-SS", result["message"])
        self.assertEqual(sorted(q.name for q in self.export.iterdir()), [])

    def test_a_note_that_contradicts_itself_is_refused(self) -> None:
        """Ein Name mit der Herkunft "leer" saegt an dem Feld, das ihn
        beglaubigen soll. Er wird abgewiesen, nicht zurechtgebogen."""
        status, _, result = self.export_request(
            "adw-widerspruch.png",
            "image/png",
            png_bytes(b"widerspruch"),
            preset="standard",
            beipackzettel={
                "aufnahme": "2026-09-02 12-10-37",
                "aufnahme_herkunft": AUFNAHME_HERKUNFT_LEER,
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(result["code"], "invalid_aufnahme")
        self.assertEqual(sorted(q.name for q in self.export.iterdir()), [])

    def test_an_invented_provenance_is_refused(self) -> None:
        status, _, result = self.export_request(
            "adw-erfunden.png",
            "image/png",
            png_bytes(b"erfunden"),
            preset="standard",
            beipackzettel={
                "aufnahme": "2026-09-02 12-10-37",
                "aufnahme_herkunft": "aus der zeitnaehe geschlossen",
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(result["code"], "invalid_aufnahme")
        self.assertEqual(sorted(q.name for q in self.export.iterdir()), [])

    def test_a_name_the_service_cannot_vouch_for_is_never_confirmed(self) -> None:
        """Der Kopf nennt einen Namen, aber keine Herkunft. Der Zettel darf
        daraus KEIN "bestaetigt" machen -- dahinter stuende kein Mensch."""
        status, _, result = self.export_request(
            "adw-stumm.png",
            "image/png",
            png_bytes(b"stumm"),
            preset="standard",
            beipackzettel={"aufnahme": "2026-09-02 12-10-37"},
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(
            self.zettel("adw-stumm.json")["aufnahme_herkunft"],
            AUFNAHME_HERKUNFT_UNBESTAETIGT,
        )


class AufnahmenRouteTests(HttpEndpointTests):
    """EC: /api/aufnahmen -- Namen und Zeitstempel, nur lesend."""

    def setUp(self) -> None:
        super().setUp()
        self.aufnahmen = Path(self.temporary.name) / "aufnahmen"
        self.aufnahmen.mkdir()
        self.server.aufnahme_directory = self.aufnahmen

    def hole(self) -> tuple[int, dict]:
        status, _, data = self.request(path="/api/aufnahmen")
        return status, json.loads(data)

    def test_the_route_names_the_recordings_it_finds(self) -> None:
        (self.aufnahmen / "2026-09-02 12-10-37.mp4").write_bytes(b"x")
        (self.aufnahmen / "2026-09-02 11-58-53.mp4").write_bytes(b"x")
        (self.aufnahmen / "2026-09-02 12-10-37.matrix-cut.mp4").write_bytes(b"x")
        status, daten = self.hole()
        self.assertEqual(status, 200)
        self.assertTrue(daten["ok"])
        self.assertTrue(daten["wurzel_gesetzt"])
        self.assertTrue(daten["wurzel_lesbar"])
        self.assertEqual(
            [a["name"] for a in daten["aufnahmen"]],
            ["2026-09-02 12-10-37", "2026-09-02 11-58-53"],
        )

    def test_an_unset_folder_is_an_answer_and_not_an_error(self) -> None:
        """Das Feld ist eine Zugabe, kein Tor. Ein 500 saehe aus wie ein
        kaputter Dienst und wuerde einen taeglichen Arbeitsweg beschaedigen."""
        self.server.aufnahme_directory = None
        status, daten = self.hole()
        self.assertEqual(status, 200)
        self.assertFalse(daten["wurzel_gesetzt"])
        self.assertEqual(daten["aufnahmen"], [])
        self.assertIn(AUFNAHME_DIRECTORY_ENV, daten["grund"])

    def test_a_missing_folder_is_told_apart_from_an_empty_one(self) -> None:
        self.server.aufnahme_directory = self.aufnahmen / "gibt-es-nicht"
        _, fehlt = self.hole()
        self.assertTrue(fehlt["wurzel_gesetzt"])
        self.assertFalse(fehlt["wurzel_lesbar"])
        self.assertIn("nicht vorhanden", fehlt["grund"])

        self.server.aufnahme_directory = self.aufnahmen
        _, leer = self.hole()
        self.assertTrue(leer["wurzel_lesbar"])
        self.assertEqual(leer["aufnahmen"], [])
        self.assertIn("JJJJ-MM-TT HH-MM-SS.mp4", leer["grund"])

    def test_the_route_needs_the_session_token(self) -> None:
        status, _, _ = self.request(path="/api/aufnahmen", headers={"X-Session-Token": "falsch"})
        self.assertEqual(status, 401)

    def test_the_route_takes_no_parameters(self) -> None:
        status, _, data = self.request(path="/api/aufnahmen?ordner=F:/")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(data)["code"], "unexpected_parameters")

    def test_the_route_is_read_only(self) -> None:
        status, _, data = self.request(method="POST", path="/api/aufnahmen", body=b"x")
        self.assertEqual(status, 405)
        self.assertEqual(json.loads(data)["code"], "method_not_allowed")

    def test_the_protocol_version_rose_with_the_route(self) -> None:
        """Ein Dienst, der die Route nicht kennt, muss sich von einem
        passenden unterscheiden lassen -- mit /api/emblem ist genau das
        einmal schiefgegangen."""
        self.assertGreaterEqual(SERVICE_PROTOCOL_VERSION, 4)
        _, _, gesundheit = self.request(path="/api/health")
        self.assertEqual(
            json.loads(gesundheit)["protocol_version"], SERVICE_PROTOCOL_VERSION
        )


class BeipackzettelUnitTests(unittest.TestCase):
    """Die reinen Funktionen -- ohne HTTP."""

    def test_counting_is_codepoints(self) -> None:
        self.assertEqual(zaehle_titel_zeichen("abc"), 3)
        self.assertEqual(zaehle_titel_zeichen("\U0001f642\U0001f642"), 2)
        self.assertEqual(VIDEOTITEL_MAX_ZEICHEN, 100)

    def test_pruefe_videotitel_accepts_empty_and_none(self) -> None:
        self.assertIsNone(pruefe_videotitel(""))
        self.assertIsNone(pruefe_videotitel(None))

    def test_pruefe_videotitel_names_the_reason(self) -> None:
        self.assertIn("101", pruefe_videotitel("a" * 101) or "")
        self.assertIn("<", pruefe_videotitel("a<b") or "")
        self.assertIn(">", pruefe_videotitel("a>b") or "")

    def test_beipackzettel_name_keeps_the_stem(self) -> None:
        self.assertEqual(beipackzettel_name("adw-x.png"), "adw-x.json")
        self.assertEqual(beipackzettel_name("adw-x (2).jpg"), "adw-x (2).json")

    def test_build_beipackzettel_has_every_field_the_uploader_needs(self) -> None:
        zettel = build_beipackzettel(
            dateiname="adw-x.jpg",
            sha256="ab" * 32,
            bytes_geschrieben=7,
            format_="innercircle",
            episode="INNER CIRCLE #12",
            metadaten={
                "videotitel": "Titel",
                "datum": "2026-09-03",
                "chart_quelle": {"herkunft": "manuell", "dateiname": "c.png", "zeitstempel": "z"},
            },
            exportiert_am="2026-09-03T12:00:00+02:00",
        )
        self.assertEqual(
            sorted(zettel),
            [
                "aufnahme", "aufnahme_herkunft", "bild", "chart_quelle",
                "datum", "episode", "exportiert_am", "format",
                "schema_version", "videotitel",
            ],
        )
        # EC: Ohne Angabe im Kopf steht die Aufnahme als LEER da -- nicht als
        # fehlendes Feld und nicht geraten.
        self.assertIsNone(zettel["aufnahme"])
        self.assertEqual(zettel["aufnahme_herkunft"], AUFNAHME_HERKUNFT_LEER)

    def test_write_beipackzettel_leaves_no_temporary_file_behind(self) -> None:
        with tempfile.TemporaryDirectory() as ordner:
            verzeichnis = Path(ordner)
            name = write_beipackzettel(verzeichnis, "adw-x.png", {"schema_version": 1})
            self.assertEqual(name, "adw-x.json")
            self.assertEqual([q.name for q in verzeichnis.iterdir()], ["adw-x.json"])

    def test_write_beipackzettel_replaces_a_stale_note(self) -> None:
        """Loescht jemand ein Bild und laesst den Zettel liegen, gehoert der
        Name beim naechsten Export wieder dem neuen Bild."""
        with tempfile.TemporaryDirectory() as ordner:
            verzeichnis = Path(ordner)
            (verzeichnis / "adw-x.json").write_text("alt", encoding="utf-8")
            write_beipackzettel(verzeichnis, "adw-x.png", {"schema_version": 1})
            self.assertEqual(
                json.loads((verzeichnis / "adw-x.json").read_text(encoding="utf-8")),
                {"schema_version": 1},
            )


class AufnahmeFeldUnitTests(unittest.TestCase):
    """EC: Die reinen Funktionen des Feldes `aufnahme` -- ohne HTTP."""

    def test_no_recording_is_allowed_and_stays_empty(self) -> None:
        """Leer ist erlaubt und wird als leer aufgeschrieben.

        Gemessen an den sieben vorhandenen Bildern entsteht das Thumbnail
        zweimal VOR der Aufnahme, die es bewirbt -- dann gibt es zur
        Exportzeit gar keinen Namen, den jemand bestaetigen koennte.
        """
        self.assertIsNone(pruefe_aufnahme(None))
        self.assertIsNone(pruefe_aufnahme(""))
        self.assertIsNone(pruefe_aufnahme("   "))

    def test_the_form_is_the_name_of_the_recording_folder(self) -> None:
        self.assertIsNone(pruefe_aufnahme("2026-09-02 12-10-37"))
        self.assertIsNone(pruefe_aufnahme("  2026-09-02 12-10-37  "))

    def test_a_name_that_is_not_the_form_is_named_not_swallowed(self) -> None:
        for falsch in (
            "2026-9-2 12-10-37",          # einstellig
            "2026-09-02T12:10:37",        # ISO statt Ordnername
            "2026-09-02 12:10:37",        # Doppelpunkte
            "2026-09-02",                 # nur der Tag
            "2026-09-02 12-10-37.mp4",    # mit Endung
        ):
            with self.subTest(wert=falsch):
                grund = pruefe_aufnahme(falsch)
                self.assertIsNotNone(grund)
                self.assertIn("JJJJ-MM-TT HH-MM-SS", grund or "")

    def test_a_name_with_the_right_shape_but_no_such_moment_is_refused(self) -> None:
        for unmoeglich in ("2026-02-30 12-10-37", "2026-09-02 25-10-37", "2026-13-01 00-00-00"):
            with self.subTest(wert=unmoeglich):
                self.assertIn("moeglichen Zeitpunkt", pruefe_aufnahme(unmoeglich) or "")

    def test_a_recording_must_be_text(self) -> None:
        self.assertIn("Text", pruefe_aufnahme(20260902121037) or "")

    def test_the_two_fields_must_agree(self) -> None:
        """Der ganze Grund fuer das zweite Feld: es darf nicht etwas anderes
        sagen als das erste."""
        self.assertIn(
            "es steht aber ein Name da",
            pruefe_aufnahme_herkunft(AUFNAHME_HERKUNFT_LEER, "2026-09-02 12-10-37") or "",
        )
        for mit_namen in (AUFNAHME_HERKUNFT_BESTAETIGT, AUFNAHME_HERKUNFT_UNBESTAETIGT):
            with self.subTest(herkunft=mit_namen):
                self.assertIn(
                    "es steht aber kein Name da",
                    pruefe_aufnahme_herkunft(mit_namen, None) or "",
                )
        self.assertIsNone(
            pruefe_aufnahme_herkunft(AUFNAHME_HERKUNFT_BESTAETIGT, "2026-09-02 12-10-37")
        )
        self.assertIsNone(pruefe_aufnahme_herkunft(AUFNAHME_HERKUNFT_LEER, None))

    def test_an_unknown_provenance_is_refused(self) -> None:
        grund = pruefe_aufnahme_herkunft("geraten", "2026-09-02 12-10-37")
        self.assertIn("geraten", grund or "")
        for wert in AUFNAHME_HERKUNFT_WERTE:
            self.assertIn(wert, grund or "")

    def test_a_name_without_a_stated_provenance_is_never_confirmed(self) -> None:
        """Die vorsichtige Seite: was der Dienst nicht weiss, darf er nicht
        als bestaetigt aufschreiben."""
        zettel = build_beipackzettel(
            dateiname="adw-x.jpg", sha256="ab" * 32, bytes_geschrieben=7,
            format_="standard", episode=None,
            metadaten={"aufnahme": "2026-09-02 12-10-37"},
            exportiert_am="2026-09-03T12:00:00+02:00",
        )
        self.assertEqual(zettel["aufnahme"], "2026-09-02 12-10-37")
        self.assertEqual(zettel["aufnahme_herkunft"], AUFNAHME_HERKUNFT_UNBESTAETIGT)

    def test_a_provenance_without_a_name_collapses_to_empty(self) -> None:
        zettel = build_beipackzettel(
            dateiname="adw-x.jpg", sha256="ab" * 32, bytes_geschrieben=7,
            format_="standard", episode=None,
            metadaten={"aufnahme": "  ", "aufnahme_herkunft": AUFNAHME_HERKUNFT_BESTAETIGT},
            exportiert_am="2026-09-03T12:00:00+02:00",
        )
        self.assertIsNone(zettel["aufnahme"])
        self.assertEqual(zettel["aufnahme_herkunft"], AUFNAHME_HERKUNFT_LEER)

    def test_a_confirmed_name_is_written_as_confirmed(self) -> None:
        zettel = build_beipackzettel(
            dateiname="adw-x.jpg", sha256="ab" * 32, bytes_geschrieben=7,
            format_="standard", episode=None,
            metadaten={
                "aufnahme": "2026-09-02 12-10-37",
                "aufnahme_herkunft": AUFNAHME_HERKUNFT_BESTAETIGT,
            },
            exportiert_am="2026-09-03T12:00:00+02:00",
        )
        self.assertEqual(zettel["aufnahme_herkunft"], AUFNAHME_HERKUNFT_BESTAETIGT)


class AufnahmenSammelnTests(unittest.TestCase):
    """EC: Was im Aufnahmeordner als Aufnahme zaehlt -- und was nicht."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.ordner = Path(self.temporary.name)

    def lege(self, name: str, mtime: float | None = None) -> Path:
        pfad = self.ordner / name
        pfad.write_bytes(b"x")
        if mtime is not None:
            os.utime(pfad, (mtime, mtime))
        return pfad

    def test_only_files_named_exactly_like_a_recording_count(self) -> None:
        """Neben den Aufnahmen liegt anderes -- Renderversuche, Handarbeit,
        Beipackdateien. Nichts davon ist eine Aufnahme, und nichts davon wird
        genannt (Vertrag 3.2 zaehlt dieselben Muster auf)."""
        self.lege("2026-09-02 12-10-37.mp4")
        for daneben in (
            "2026-09-02 12-10-37.matrix-cut.mp4",
            "2026-09-02 12-10-37.upload.mp4",
            "2026-09-02 12-10-37.obs-events.json",
            "2026-09-02 12-10-37.matrix-cut.render-attempt-ab.h264_nvenc.partial.mp4",
            "irgendwas.mp4",
            "2026-09-02.mp4",
            "desktop.ini",
        ):
            self.lege(daneben)
        aufnahmen, abgeschnitten = sammle_aufnahmen(self.ordner)
        self.assertEqual([a["name"] for a in aufnahmen], ["2026-09-02 12-10-37"])
        self.assertFalse(abgeschnitten)

    def test_subfolders_are_not_searched(self) -> None:
        """Ein Absuchen von Unterordnern waere ein Erraten von Ordnernamen."""
        (self.ordner / "Rendered").mkdir()
        (self.ordner / "Rendered" / "2026-09-02 12-10-37.mp4").write_bytes(b"x")
        aufnahmen, _ = sammle_aufnahmen(self.ordner)
        self.assertEqual(aufnahmen, [])

    def test_beginning_comes_from_the_name_and_the_end_from_the_file(self) -> None:
        """Beide Zeiten zusammen ergeben die Dauer -- und die Dauer ist das,
        was zwei Aufnahmen desselben Tages unterscheidet."""
        beginn = datetime.datetime(2026, 9, 2, 12, 10, 37)
        ende = beginn + datetime.timedelta(minutes=11, seconds=11)
        self.lege("2026-09-02 12-10-37.mp4", ende.timestamp())
        (aufnahme,), _ = sammle_aufnahmen(self.ordner)
        self.assertEqual(aufnahme["name"], "2026-09-02 12-10-37")
        self.assertEqual(
            datetime.datetime.fromisoformat(aufnahme["beginn"]).replace(tzinfo=None),
            beginn,
        )
        self.assertEqual(aufnahme["dauer_sekunden"], 11 * 60 + 11)
        self.assertIsNotNone(datetime.datetime.fromisoformat(aufnahme["ende"]).tzinfo)

    def test_a_wrong_looking_moment_in_the_name_is_skipped(self) -> None:
        self.lege("2026-02-30 12-10-37.mp4")
        self.assertEqual(sammle_aufnahmen(self.ordner)[0], [])

    def test_the_newest_come_first_and_the_list_is_bounded(self) -> None:
        for minute in range(5):
            self.lege(f"2026-09-02 12-0{minute}-00.mp4")
        aufnahmen, abgeschnitten = sammle_aufnahmen(self.ordner, grenze=3)
        self.assertEqual(
            [a["name"] for a in aufnahmen],
            ["2026-09-02 12-04-00", "2026-09-02 12-03-00", "2026-09-02 12-02-00"],
        )
        self.assertTrue(abgeschnitten)


class AufnahmeOrdnerEinstellungTests(unittest.TestCase):
    """EC: Nicht eingestellt heisst None -- und niemals ein Rueckfallordner.

    Der Unterschied zwischen "kein Ordner eingestellt" und "der Ordner ist
    leer" muss erhalten bleiben. Sonst sieht eine fehlende Einstellung aus wie
    die Auskunft "es gibt keine Aufnahme", und genau die fuehrt zu einem leeren
    Feld, das niemand so gemeint hat.
    """

    def test_unset_is_none_and_not_a_fallback_directory(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(AUFNAHME_DIRECTORY_ENV, None)
            self.assertIsNone(resolve_optional_directory(AUFNAHME_DIRECTORY_ENV, None, {}))
            self.assertIsNone(
                resolve_optional_directory(AUFNAHME_DIRECTORY_ENV, None, {AUFNAHME_DIRECTORY_ENV: "  "})
            )

    def test_argument_beats_environment_beats_file(self) -> None:
        with patch.dict(os.environ, {AUFNAHME_DIRECTORY_ENV: "aus-der-umgebung"}):
            self.assertEqual(
                resolve_optional_directory(
                    AUFNAHME_DIRECTORY_ENV, Path("aus-dem-argument"), {AUFNAHME_DIRECTORY_ENV: "aus-der-datei"}
                ),
                Path("aus-dem-argument"),
            )
            self.assertEqual(
                resolve_optional_directory(
                    AUFNAHME_DIRECTORY_ENV, None, {AUFNAHME_DIRECTORY_ENV: "aus-der-datei"}
                ),
                Path("aus-der-umgebung"),
            )
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(AUFNAHME_DIRECTORY_ENV, None)
            self.assertEqual(
                resolve_optional_directory(
                    AUFNAHME_DIRECTORY_ENV, None, {AUFNAHME_DIRECTORY_ENV: "aus-der-datei"}
                ),
                Path("aus-der-datei"),
            )


class VideotitelZaehlstelleTests(unittest.TestCase):
    """DZ: EINE Zaehlweise fuer die Grenze von 100 -- an allen vier Stellen.

    Bis DR zaehlte src/upload/uploader.js mit titel.length (UTF-16-Einheiten)
    und src/upload/freigabe-seite.js mit Array.from() (Codepunkte). Diese
    Pruefung soll verhindern, dass beim naechsten Feld wieder zwei Zaehlweisen
    fuer dieselbe Grenze entstehen.
    """

    @classmethod
    def setUpClass(cls) -> None:
        wurzel = Path(__file__).resolve().parents[1]
        cls.html = (wurzel / "thumbnail-compositor.html").read_text(encoding="utf-8")
        cls.uploader = (wurzel / "src" / "upload" / "uploader.js").read_text(encoding="utf-8")
        cls.seite = (wurzel / "src" / "upload" / "freigabe-seite.js").read_text(encoding="utf-8")

    def test_all_three_javascript_sites_count_with_array_from(self) -> None:
        self.assertIn("return Array.from(String(titel)).length;", self.uploader)
        self.assertIn("const n = Array.from(titel.value).length;", self.seite)
        self.assertIn(
            "function zaehleTitelZeichen(titel){ return Array.from(String(titel)).length; }",
            self.html,
        )

    def test_the_compositor_does_not_count_utf16_units(self) -> None:
        self.assertNotIn("state.videoTitle.length", self.html)
        self.assertNotIn("videoTitleEl.value.length", self.html)

    def test_all_four_sites_use_the_same_limit(self) -> None:
        self.assertIn("const TITEL_MAX_ZEICHEN = 100;", self.uploader)
        self.assertIn("von hoechstens 100 Zeichen", self.seite)
        self.assertIn("const VIDEOTITEL_MAX_ZEICHEN = 100;", self.html)
        self.assertEqual(VIDEOTITEL_MAX_ZEICHEN, 100)

    def test_the_field_carries_no_maxlength_so_the_service_stays_testable(self) -> None:
        """Dieselbe Begruendung wie in freigabe-seite.js: ein Browser, der 101
        Zeichen gar nicht erst zulaesst, macht die Pruefung im Dienst
        untestbar."""
        self.assertIn(
            '<input type="text" id="videoTitle" spellcheck="false" value="">', self.html
        )


class BeipackzettelClientTests(unittest.TestCase):
    """Was die Oberflaeche beitraegt -- und was sie bewusst NICHT tut."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (
            Path(__file__).resolve().parents[1] / "thumbnail-compositor.html"
        ).read_text(encoding="utf-8")

    def test_the_video_title_never_reaches_the_canvas(self) -> None:
        """Der Videotitel gehoert nicht ins Bild. Gezeichnet wird allein
        state.title -- state.videoTitle darf in keiner Zeichenfunktion
        vorkommen."""
        gezeichnet = self.html[
            self.html.index("function drawHeadline()") : self.html.index("// ---------- wiring")
        ]
        self.assertNotIn("videoTitle", gezeichnet)
        self.assertIn("const tokens = parseTitle(state.title);", gezeichnet)

    def test_the_client_sends_what_the_service_cannot_know(self) -> None:
        self.assertIn(
            "'X-Export-Beipackzettel': encodeURIComponent(JSON.stringify(beipackzettelDaten())),",
            self.html,
        )
        self.assertIn("videotitel: state.videoTitle,", self.html)
        self.assertIn("chart_quelle: state.chartQuelle,", self.html)

    def test_format_and_episode_are_not_sent_twice(self) -> None:
        """Sie stehen schon in X-Export-Preset / X-Export-Episode. Ein zweiter
        Weg dafuer waere eine zweite Wahrheit."""
        daten = self.html[
            self.html.index("function beipackzettelDaten()") : self.html.index(
                "async function beipackzettelInhalt("
            )
        ]
        self.assertNotIn("format:", daten)
        self.assertNotIn("episode:", daten)

    def test_the_source_of_the_background_image_is_recorded_in_one_place(self) -> None:
        self.assertEqual(1, self.html.count("state.chartQuelle = {"))
        self.assertIn("herkunft: settings.sourceImport ? 'dienst' : 'manuell',", self.html)

    def test_the_connected_folder_writes_the_image_before_the_note(self) -> None:
        ordner = self.html[
            self.html.index("async function writeExportToDirectory(") : self.html.index(
                "exportBtn.addEventListener('click'"
            )
        ]
        self.assertLess(
            ordner.index("await writable.write(blob);"),
            ordner.index("beipackzettelName(filename)"),
        )

    def test_the_browser_download_writes_no_note_and_says_so(self) -> None:
        """Ueber file:// ohne Dienst vergibt der BROWSER den endgueltigen Namen
        -- ein Zettel koennte ihn nur behaupten."""
        self.assertIn("Ohne Zielordner entsteht KEIN Beipackzettel", self.html)
        klick = self.html[self.html.index("exportBtn.addEventListener('click'") :]
        download = klick[klick.index("downloadExportBlob(blob, filename);") :]
        self.assertNotIn("beipackzettelInhalt", download)

    def test_a_refused_title_never_falls_back_to_a_download(self) -> None:
        self.assertIn("error.exportCode === 'invalid_video_title'", self.html)
        self.assertIn("} else if (exportServiceRejected) {", self.html)
        self.assertIn("Es wurde nichts geschrieben.", self.html)

    def test_a_service_without_the_note_is_named_not_ignored(self) -> None:
        self.assertIn("Der Dienst hat keinen Beipackzettel bestaetigt", self.html)

    def test_the_recording_never_reaches_the_canvas(self) -> None:
        """EC: Die Aufnahme gehoert nicht ins Bild -- wie der Videotitel."""
        gezeichnet = self.html[
            self.html.index("function drawHeadline()") : self.html.index("// ---------- wiring")
        ]
        self.assertNotIn("state.aufnahme", gezeichnet)

    def test_a_config_can_never_claim_a_recording(self) -> None:
        """EC: applyConfig() faehrt die Render-Harness. Hinter einer Config
        steht kein Mensch, der eine Zuordnung bestaetigt haette -- also darf
        sie state.aufnahme nicht anfassen."""
        config = self.html[
            self.html.index("function applyConfig(cfg){") : self.html.index("let engineStartRestored")
        ]
        self.assertNotIn("aufnahme", config)

    def test_only_a_human_action_sets_the_recording(self) -> None:
        """EC: Es gibt genau EINEN Weg in state.aufnahme hinein, und beide
        Ereignisse, die ihn nehmen, sind Handlungen eines Menschen."""
        self.assertEqual(1, self.html.count("state.aufnahme = String("))
        self.assertIn(
            "aufnahmeEl.addEventListener('input', function(){ setzeAufnahme(aufnahmeEl.value); });",
            self.html,
        )
        self.assertIn(
            "aufnahmeLeerenEl.addEventListener('click', function(){ setzeAufnahme(''); });",
            self.html,
        )
        # Die Kandidatenliste SETZT nicht -- sie bietet an.
        laden = self.html[
            self.html.index("async function ladeAufnahmen()") : self.html.index("// ---------- Lebenszeichen")
        ]
        self.assertNotIn("setzeAufnahme", laden)

    def test_the_form_check_is_the_same_on_both_sides(self) -> None:
        """EC: Zwei Pruefweisen fuer dieselbe Form waeren der Fehler, den
        dieses Projekt beim Videotitel schon einmal hatte."""
        self.assertIn(
            r"const AUFNAHME_MUSTER = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/;",
            self.html,
        )
        self.assertEqual(
            AUFNAHME_PATTERN.pattern,
            r"^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$",
        )

    def test_the_client_sends_both_fields_together(self) -> None:
        daten = self.html[
            self.html.index("function beipackzettelDaten()") : self.html.index(
                "async function beipackzettelInhalt("
            )
        ]
        self.assertIn("aufnahme: state.aufnahme,", daten)
        self.assertIn("aufnahme_herkunft: aufnahmeHerkunft(),", daten)

    def test_a_changed_chart_takes_the_confirmation_away(self) -> None:
        """EC: Der Name bleibt stehen -- die Bestaetigung nicht. Genau dafuer
        gibt es das zweite Feld."""
        herkunft = self.html[
            self.html.index("function aufnahmeHerkunft()") : self.html.index("function todayISO()")
        ]
        self.assertIn("state.aufnahmeChart === chartSchluessel()", herkunft)
        self.assertIn("AUFNAHME_HERKUNFT_UNBESTAETIGT", herkunft)
        # Ein neues Chart loescht den Namen NICHT -- die Arbeit soll bleiben.
        laden = self.html[
            self.html.index("function loadFile(f, options)") : self.html.index("function sourceFailurePhase(")
        ]
        self.assertIn("ladeAufnahmen();", laden)
        self.assertNotIn("state.aufnahme =", laden)

    def test_a_refused_recording_never_falls_back_to_a_download(self) -> None:
        self.assertIn("error.exportCode === 'invalid_aufnahme'", self.html)

    def test_the_page_says_what_the_note_will_carry(self) -> None:
        """Wer exportiert, soll ohne die Datei zu oeffnen sehen, ob gerade ein
        Zettel ohne Aufnahme entstanden ist."""
        self.assertIn("' (ohne Aufnahme)'", self.html)
        self.assertIn("' (Aufnahme '+state.aufnahme+', '+aufnahmeHerkunft()+')'", self.html)

    def test_the_connected_folder_writes_the_same_note(self) -> None:
        inhalt = self.html[
            self.html.index("async function beipackzettelInhalt(") : self.html.index(
                "function beipackzettelName("
            )
        ]
        self.assertIn("aufnahme: d.aufnahme.trim() || null,", inhalt)
        self.assertIn("AUFNAHME_HERKUNFT_LEER", inhalt)

    def test_an_older_service_without_the_route_is_not_a_failure(self) -> None:
        """Der Compositor ist auf /api/aufnahmen nicht ANGEWIESEN: ohne sie
        bleibt das Feld Handeingabe. Deshalb steigt REQUIRED_PROTOCOL_VERSION
        hierfuer nicht -- sonst saehe ein aelterer Dienst kaputt aus."""
        self.assertIn("const REQUIRED_PROTOCOL_VERSION = 2;", self.html)
        laden = self.html[
            self.html.index("async function ladeAufnahmen()") : self.html.index("// ---------- Lebenszeichen")
        ]
        self.assertIn("if (antwort.status === 404){", laden)
        self.assertIn("aeltere Fassung", laden)

    def test_the_field_works_without_the_service(self) -> None:
        """Ueber file:// gibt es keinen Dienst und keine Kandidatenliste --
        aber das Feld gibt es, und es sagt warum."""
        self.assertIn("phase: localService.available ? 'laedt' : 'aus',", self.html)
        self.assertIn("Ohne den lokalen Dienst gibt es keine Kandidatenliste", self.html)

    def test_the_date_field_map_matches_the_watermark_tail(self) -> None:
        """PRESET_DATE_FIELD spiegelt tail() -- das Datum im Zettel muss das
        Datum sein, das auf dem Bild steht."""
        for preset, feld in (
            ("standard", "dateIC"), ("innercircle", "dateIC"), ("livestream", "dateLS"),
            ("aiv", "dateAIV"), ("memberlive", "dateML"),
        ):
            with self.subTest(preset=preset):
                self.assertIn(f"{preset}: '{feld}'", self.html)
                self.assertIn(f"fmtDate(m.{feld})", self.html)
        self.assertIn("nonchart: null", self.html)
        nonchart = self.html[self.html.index("  nonchart: {") : self.html.index("  // BJ4: AIV")]
        self.assertNotIn("fmtDate", nonchart)


class VorgabenBeimOeffnenTests(unittest.TestCase):
    """DZ Punkt 4: zwei Vorgaben beim Oeffnen -- und beide Knoepfe bleiben."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (
            Path(__file__).resolve().parents[1] / "thumbnail-compositor.html"
        ).read_text(encoding="utf-8")

    def test_the_page_opens_with_bottom_left_and_jpg(self) -> None:
        self.assertIn("const UI_DEFAULT_POS = 'bottom-left';", self.html)
        self.assertIn("  pos: UI_DEFAULT_POS,", self.html)
        self.assertIn("  exportFormat: 'jpg',", self.html)
        self.assertIn('<button data-pos="bottom-left"  aria-pressed="true">', self.html)
        self.assertIn('<button data-export-format="jpg" aria-pressed="true">', self.html)

    def test_both_buttons_stay(self) -> None:
        self.assertIn(
            '<button data-pos="bottom" aria-pressed="false">Unten</button>', self.html
        )
        self.assertIn(
            '<button data-export-format="png" aria-pressed="false">PNG</button>', self.html
        )

    def test_the_headless_engine_keeps_its_own_starting_position(self) -> None:
        """Die Render-Harness faehrt dieselbe Datei ueber window.adwRender().
        Fuer sie darf sich nicht aendern, wie ein Bedienfeld beim Oeffnen
        vorbelegt ist -- gemessen: mit 'bottom-left' als Startwert kam der erste
        Auftrag aus configs.sample.json anders heraus."""
        self.assertIn("const ENGINE_DEFAULT_POS = 'bottom';", self.html)
        self.assertIn(
            "if (!engineStartRestored){ engineStartRestored = true; state.pos = ENGINE_DEFAULT_POS; }",
            self.html,
        )

    def test_the_export_button_label_follows_the_chosen_format(self) -> None:
        """syncExportFormatUI() lief bisher NUR beim Klick -- der Knopf haette
        sonst weiter 'PNG exportieren' gesagt und JPG geschrieben."""
        init = self.html[self.html.index("(async function init(){") :]
        self.assertIn("syncExportFormatUI();", init)


class BedienreihenfolgeTests(unittest.TestCase):
    """DZ Punkt 3: die Bloecke stehen in Joshuas Ablauf -- erst das
    Hintergrundbild, dann die Titelposition, dann Emblem und Titeltext."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (
            Path(__file__).resolve().parents[1] / "thumbnail-compositor.html"
        ).read_text(encoding="utf-8")

    def test_the_blocks_follow_the_working_order(self) -> None:
        erwartet = [
            'id="imgLabel">Chart-Bild',
            'for="imageZoom">Bild-Zoom',
            'class="lbl">Titel-Position',
            'id="autoBtn"',
            'id="emblemControls"',
            'class="lbl">Titel<',
            'class="lbl">Titelgr\u00f6\u00dfe',
            'class="lbl">Farbe',
            'class="lbl">Format',
            'class="lbl">Watermark',
            'for="videoTitle">Videotitel',
            'class="lbl">Exportformat',
            'class="lbl">Export-Ordner',
            'id="export" disabled',
        ]
        stellen = [self.html.index(teil) for teil in erwartet]
        self.assertEqual(stellen, sorted(stellen), "Reihenfolge der Bedienfelder")


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


class DirectoryResolutionTests(unittest.TestCase):
    """CM1: Der Quellordner kam bis hierher aus einem RELATIVEN Fallback.

    Damit suchte der Dienst still im Projektordner statt im TradingView-Ordner
    und meldete "kein Bild gefunden". Diese Tests halten die Rangfolge fest und
    schuetzen die Konsolenzeile, die den Irrtum sichtbar macht.
    """

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.env_file = self.directory / ".env"

    def test_reads_only_the_directory_keys(self) -> None:
        self.env_file.write_text(
            "\n".join(
                [
                    "YOUTUBE_CLIENT_SECRET=streng-geheim",
                    "THUMBNAIL_SOURCE_DIR=ordner-quelle",
                    "THUMBNAIL_EXPORT_DIR=ordner-ziel",
                ]
            ),
            encoding="utf-8",
        )
        values = read_env_file(self.env_file)
        self.assertEqual(
            values,
            {"THUMBNAIL_SOURCE_DIR": "ordner-quelle", "THUMBNAIL_EXPORT_DIR": "ordner-ziel"},
        )
        self.assertNotIn("YOUTUBE_CLIENT_SECRET", values)

    def test_ignores_comments_blank_lines_and_quotes(self) -> None:
        self.env_file.write_text(
            "\n".join(
                [
                    "",
                    "# Kommentar",
                    '  THUMBNAIL_SOURCE_DIR = "ordner mit leerzeichen"  ',
                    "THUMBNAIL_EXPORT_DIR=",
                ]
            ),
            encoding="utf-8",
        )
        values = read_env_file(self.env_file)
        self.assertEqual(values, {"THUMBNAIL_SOURCE_DIR": "ordner mit leerzeichen"})

    def test_missing_file_is_not_an_error(self) -> None:
        self.assertEqual(read_env_file(self.directory / "fehlt.env"), {})

    def test_precedence_argument_beats_environment_beats_file(self) -> None:
        values = {"THUMBNAIL_SOURCE_DIR": "ordner-aus-datei"}
        with patch.dict(os.environ, {"THUMBNAIL_SOURCE_DIR": "ordner-aus-umgebung"}):
            self.assertEqual(
                resolve_directory(
                    "THUMBNAIL_SOURCE_DIR",
                    Path("ordner-aus-argument"),
                    Path("fallback"),
                    values,
                ),
                Path("ordner-aus-argument"),
            )
            self.assertEqual(
                resolve_directory(
                    "THUMBNAIL_SOURCE_DIR", None, Path("fallback"), values
                ),
                Path("ordner-aus-umgebung"),
            )
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                resolve_directory(
                    "THUMBNAIL_SOURCE_DIR", None, Path("fallback"), values
                ),
                Path("ordner-aus-datei"),
            )
            self.assertEqual(
                resolve_directory("THUMBNAIL_SOURCE_DIR", None, Path("fallback"), {}),
                Path("fallback"),
            )

    def test_description_is_absolute_and_reports_existence(self) -> None:
        line = describe_directory("Quellordner", self.directory)
        self.assertIn(str(self.directory.resolve()), line)
        self.assertTrue(line.endswith("[ok]"))

        missing = self.directory / "gibt-es-nicht"
        line = describe_directory("Quellordner", missing)
        self.assertIn(str(missing.resolve()), line)
        self.assertTrue(line.endswith("[FEHLT]"))

    def test_description_resolves_relative_paths_absolutely(self) -> None:
        """Der eigentliche Stolperstein: relativ sieht harmlos aus."""
        line = describe_directory("Quellordner", Path("thumbnail-source"))
        self.assertIn(str(Path("thumbnail-source").resolve()), line)


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

    def test_emblems_are_embedded_as_data_uris(self) -> None:
        """Weder der Dienst noch die Render-Harness liefern statische Dateien --
        die Varianten muessen in der HTML liegen, nicht als Dateipfad."""
        self.assertIn("const EMBLEM_META = {", self.html)
        self.assertIn("const EMBLEM_FALLBACK_URI = 'data:image/png;base64,", self.html)
        self.assertNotIn('src="assets/branding', self.html)

    def test_variants_come_from_the_folder_not_from_a_list_in_code(self) -> None:
        """Eine Variante ergaenzen soll heissen: Datei ablegen, Skript laufen
        lassen. Keine Namensliste im Quelltext, die man vergessen kann."""
        self.assertIn("const EMBLEM_SLUGS = Object.keys(EMBLEM_META);", self.html)
        script = Path("scripts/embed-aiv-emblem.cjs").read_text(encoding="utf-8")
        self.assertIn("fs.readdirSync(DIR)", script)

    def test_selected_variant_falls_back_to_the_first_one(self) -> None:
        """Ein entfernter oder umbenannter Dateiname darf nicht in einem leeren
        Emblem enden."""
        self.assertIn("return emblemImages[state.emblemVariant]", self.html)
        self.assertIn("|| emblemImages[EMBLEM_FALLBACK_SLUG]", self.html)
        self.assertIn("|| emblemImages[EMBLEM_SLUGS[0]]", self.html)

    def test_glow_is_light_because_the_emblem_is_dark(self) -> None:
        """Der Avatar ist fast schwarz (Median 15/255); ein dunkler Schein wuerde
        auf dunklem Grund nichts bewirken."""
        self.assertIn("const EMBLEM_GLOW = { color: 'rgba(236,232,224,", self.html)

    def test_draw_emblem_returns_early_for_every_other_preset(self) -> None:
        """Der Preset-Test sitzt in emblemRect(), das drawEmblem() UND
        emblemBlockRect() speist -- eine Stelle statt zweier, die auseinander
        laufen koennen. Ausserhalb von EMBLEM_PRESETS ist der Rueckgabewert null."""
        self.assertIn("const img = emblemVisible() ? currentEmblem() : null;", self.html)
        self.assertIn(
            "  if (!EMBLEM_PRESETS.has(state.preset)) return false;", self.html
        )
        draw = self.html[self.html.index("function drawEmblem(){"):]
        draw = draw[: draw.index("\n}")]
        self.assertIn("const rect = emblemRect();", draw)
        self.assertIn("if (!rect) return;", draw)

    def test_emblem_is_drawn_between_vignette_and_watermark(self) -> None:
        order = self.html[self.html.index("  drawImageCover();"):]
        order = order[: order.index("}")]
        self.assertLess(order.index("drawVignette()"), order.index("drawEmblem()"))
        self.assertLess(order.index("drawEmblem()"), order.index("drawWatermark()"))

    def test_block_rect_is_null_without_an_emblem(self) -> None:
        """Kern der BK2-Zusage: liefert emblemBlockRect() null, bleibt die
        Belegungskarte in autoPlace() unveraendert. Das gilt jetzt fuer jedes
        Preset ausserhalb von EMBLEM_PRESETS und zusaetzlich bei Titel 'bottom'."""
        self.assertIn("const img = emblemVisible() ? currentEmblem() : null;", self.html)
        self.assertIn("  if (!img) return null;", self.html)

    def test_only_nonchart_and_memberlive_have_no_emblem(self) -> None:
        """CG5/CH1: kanalweites Erkennungszeichen. Ohne Emblem bleiben nur
        nonchart (freies Topic-Bild ohne feste Marke) und memberlive (Ad-hoc)."""
        self.assertIn(
            "const EMBLEM_PRESETS = new Set(['aiv', 'standard', 'livestream', 'innercircle']);",
            self.html,
        )

    def test_emblem_is_dropped_for_a_full_width_bottom_title(self) -> None:
        """CG1: 'bottom' ist eine ganzbreite Box -- eine laengere Headline laeuft
        von Rand zu Rand, das Emblem sitzt auf derselben Hoehe und hat keine
        Seite zum Ausweichen. NUR 'bottom': bei 'top' ist unten alles frei."""
        self.assertIn("  return state.pos !== 'bottom';", self.html)
        visible = self.html[self.html.index("function emblemVisible(){"):]
        visible = visible[: visible.index("\n}")]
        self.assertNotIn("'top'", visible)

    def test_emblem_visibility_is_overridable(self) -> None:
        """CG2: ein / aus / automatisch, Vorgabe automatisch. Das Preset-Gatter
        bleibt aber staerker -- nonchart laesst sich nicht einschalten."""
        self.assertIn("if (state.emblemShow === 'off') return false;", self.html)
        self.assertIn("if (state.emblemShow === 'on') return true;", self.html)
        visible = self.html[self.html.index("function emblemVisible(){"):]
        visible = visible[: visible.index("\n}")]
        self.assertLess(
            visible.index("EMBLEM_PRESETS"), visible.index("state.emblemShow")
        )

    def test_auto_place_only_stamps_the_map_when_a_block_exists(self) -> None:
        self.assertIn("const block = emblemBlockRect();\n  if (block){", self.html)

    def test_block_rect_follows_the_ui_values(self) -> None:
        """Sperrflaeche aus emblemX/emblemY/emblemSize plus Rand -- verschiebt
        man das Emblem, wandert sie mit."""
        # CO3: aus der SILHOUETTE, nicht aus dem Rahmen -- der transparente Rand
        # ist je nach Vorlage bis zu 80 px breit und drueckte die Headline als
        # scheinbar belegte Flaeche weiter weg als noetig.
        for token in ("rect.sx - pad", "rect.sy - pad",
                      "rect.sx + rect.sw + pad", "rect.sy + rect.sh + pad"):
            self.assertIn(token, self.html)
        self.assertNotIn("rect.dx + rect.dw + pad", self.html)

    def test_free_side_counts_over_the_silhouette(self) -> None:
        """CO3: Sonst entscheidet transparenter Rand mit darueber, welche Seite
        der Hintergrund freier laesst."""
        self.assertIn("occupancyIn(occ, emblemSilhouetteRect(links))", self.html)
        self.assertIn("occupancyIn(occ, emblemSilhouetteRect(rechts))", self.html)

    def test_anchor_is_the_outer_bottom_corner(self) -> None:
        """CB1/CD1: waagerecht ein RANDABSTAND (spiegelt sich beim Seitenwechsel
        mit), senkrecht die Unterkante. Mit einem Mittelpunkt-Anker wanderte die
        buendige Unterkante bei jeder Groessenaenderung -- der Anschnitt wuerde
        dann zur Kartenkante."""
        self.assertIn("const side = forceSide || resolvedEmblemSide();", self.html)
        # CO1: Der Anker haengt jetzt am aeussersten SICHTBAREN Pixel statt am
        # Rahmen. Die Vorlagen tragen unterschiedlich breiten transparenten Rand
        # (rechts 21 bis 256 Quellpixel) -- am Rahmen ausgerichtet sass deshalb
        # jede Variante woanders, bei "verwirrt" fuellt der erhobene Arm den Rand
        # aus und die Figur stand sichtbar weiter aussen.
        self.assertIn("const aussen = (iw - box.r) * s;", self.html)
        self.assertIn("? state.emblemMargin - aussen", self.html)
        self.assertIn("W - state.emblemMargin - dw + aussen;", self.html)
        # CO2: Senkrecht dieselbe Regel. Bei allen heutigen Vorlagen ist der Term
        # 0 (die Figur ist unten angeschnitten), er haelt aber eine kuenftige
        # Vorlage mit Luft unten davon ab, ueber der Kante zu schweben.
        self.assertIn("const dy = state.emblemY - dh + (ih - box.b) * s;", self.html)
        self.assertIn("const EMBLEM_DEFAULT = { size: 480, margin: 16, y: 720 };", self.html)

    def test_reset_restores_the_documented_default_margin(self) -> None:
        """Die Zurueck-Schaltfluche darf keinen anderen Wert herstellen als den,
        mit dem der Regler startet -- sonst sprang der Randabstand beim
        Zuruecksetzen von 16 auf 40."""
        self.assertIn('id="emblemMargin" min="0" max="400" step="2" value="16"', self.html)
        self.assertIn("emblemMargin: 16,", self.html)
        self.assertIn("const EMBLEM_DEFAULT = { size: 480, margin: 16, y: 720 };", self.html)

    def test_alpha_box_is_measured_not_maintained_by_hand(self) -> None:
        """Eine Tabelle mit Alphakanten liefe auseinander, sobald eine Vorlage
        nachgeschaerft wird. Gemessen wird einmal je Bild und zwischengespeichert;
        ein nicht lesbares Canvas faellt auf den vollen Rahmen zurueck, also auf
        das Verhalten von vorher."""
        self.assertIn("const emblemBoxes = new WeakMap();", self.html)
        self.assertIn("let box = { l: 0, t: 0, r: iw, b: ih, iw, ih };", self.html)
        self.assertIn("emblemBoxes.set(img, box);", self.html)

    def test_side_follows_the_title_and_otherwise_the_free_background(self) -> None:
        """CD1/CH3: Der Titel hat Vorrang, wo er eine Seite belegt. 'top' und
        'bottom' laufen ueber die volle Breite und belegen keine -- dort
        entscheidet die gemessene freiere Seite des Hintergrunds."""
        self.assertIn("if (state.emblemSide !== 'auto') return state.emblemSide;", self.html)
        self.assertIn(
            "if (state.pos === 'right' || state.pos === 'bottom-right') return 'left';", self.html
        )
        self.assertIn(
            "if (state.pos === 'left'  || state.pos === 'bottom-left')  return 'right';", self.html
        )
        self.assertIn("  return freeSide();", self.html)

    def test_free_side_uses_the_same_occupancy_map_as_auto_place(self) -> None:
        """Eine zweite, leicht abweichende Belegungsrechnung waere eine
        Fehlerquelle -- beide benutzen occupancyMap()."""
        self.assertIn("function occupancyMap(img){", self.html)
        self.assertIn("const occ = occupancyMap(state.img);", self.html)
        auto = self.html[self.html.index("function autoPlace(img){"):]
        auto = auto[: auto.index("  const hasContent")]
        self.assertIn("const occ = occupancyMap(img);", auto)

    def test_live_badge_moves_away_from_the_emblem(self) -> None:
        """CH3: Das Abzeichen sass fest unten rechts, wo seit CG5 auch das Emblem
        steht -- Ueberlappung in 3 von 5 Stellungen."""
        # CO3: an der sichtbaren Figur ausweichen, nicht am Rahmen.
        self.assertIn(
            "const x = (emblem && emblem.sx + emblem.sw > W/2) ? pad : (W - pad - bw);",
            self.html,
        )

    def test_mirror_wraps_the_emblem_itself_not_only_the_glow(self) -> None:
        """CF1: DER Fehler, der eine Positionspruefung ueberlebt hat.

        Die Spiegelung lag im inneren save/restore-Block, der nur den Beschnitt
        fuer den Schein umschliesst. Gespiegelt wurde dadurch ausschliesslich der
        weichgezeichnete Schatten -- dem sieht man es nicht an -- waehrend das
        Emblem selbst nach dem restore() unveraendert gezeichnet wurde. Alle
        x-Koordinaten stimmten dabei, die Ausrichtung nicht.

        Geprueft wird deshalb die VERSCHACHTELUNG: zwischen der Spiegelung und
        dem Zeichnen des Emblems darf kein unpaariges restore() stehen."""
        body = self.html[self.html.index("function drawEmblem(){"):]
        body = body[: body.index("\n}")]
        mirror = body.index("ctx.scale(-1, 1)")
        draw = body.rindex("ctx.drawImage(img, dx, dy, dw, dh);")
        self.assertLess(mirror, draw, "Emblem wird vor der Spiegelung gezeichnet")
        between = body[mirror:draw]
        self.assertEqual(
            between.count("ctx.save()"),
            between.count("ctx.restore()"),
            "unpaariges restore() zwischen Spiegelung und Emblem -- die "
            "Spiegelung greift dann nur fuer den Schein",
        )

    def test_glow_offset_flips_with_the_mirror(self) -> None:
        """CF1, zweiter Fehler derselben Familie: shadowOffsetX liegt in
        GERAETE-Pixeln und wird von der Spiegelung nicht mitgedreht, die
        Verschiebung des Quellbildes dagegen schon. Ohne Vorzeichenwechsel
        landet der Schatten um 2*off daneben und der Schein fehlt auf der
        gespiegelten Seite vollstaendig (gemessen: 4984 statt 32633
        Schein-Pixel)."""
        self.assertIn("ctx.shadowOffsetX = (mirrored ? -off : off) * SCALE;", self.html)

    def test_left_side_is_mirrored(self) -> None:
        """CD1: gespiegelt wird wegen des Kapuzengewichts, NICHT wegen einer
        Blickrichtung -- die Sonnenbrille ist deckend, es gibt keine Augen."""
        self.assertIn("if (mirrored){ ctx.translate(dx + dw/2, 0); ctx.scale(-1, 1);", self.html)
        self.assertIn("const mirrored = (resolvedEmblemSide() === 'left');", self.html)

    def test_auto_placement_runs_at_most_two_passes(self) -> None:
        """CD3: erst die Titelposition, dann folgt die Seite, dann EIN zweiter
        Durchgang gegen die verschobene Sperrflaeche. Kein dritter -- Seite und
        Position koennten einander sonst im Kreis jagen."""
        block = self.html[self.html.index("function applyAuto(){"):]
        block = block[: block.index("\n}")]
        self.assertEqual(2, block.count("autoPlace(state.img)"))
        self.assertIn(
            "if (resolvedEmblemSide() !== sideBefore || emblemVisible() !== visibleBefore){",
            block,
        )

    def test_block_rect_and_drawing_share_one_geometry(self) -> None:
        """Sperrflaeche und gezeichnete Flaeche duerfen nicht auseinanderlaufen --
        beide kommen aus emblemRect()."""
        self.assertIn("const rect = emblemRect();", self.html)
        block = self.html[self.html.index("function emblemBlockRect(){"):]
        block = block[: block.index("\n}")]
        self.assertNotIn("emblemSize", block)

    def test_fallback_is_plain_again_after_the_bottom_rule(self) -> None:
        """CH2: Die Sonderlogik im Rueckfall ist ERSATZLOS entfernt, und das ist
        keine Luecke. Seit CG1 entfaellt das Emblem bei Titelposition 'bottom' --
        damit ist 'bottom' die garantiert kollisionsfreie Stellung. Die alte
        Logik haette ausgerechnet sie gemieden, weil sie gegen eine Sperrflaeche
        rechnete, die es nach der Wahl nicht mehr gibt."""
        self.assertIn("if (!best) best = {pos:'bottom', scalePct:50};", self.html)
        self.assertNotIn("if (!best && block){", self.html)

    def test_bottom_edge_crop_is_allowed_by_the_embed_script(self) -> None:
        """CB2: Der Avatar sitzt buendig am unteren Bildrand, der Anschnitt dort
        ist gewollt. Oben/links/rechts bleiben echte Zuschneidefehler."""
        script = Path("scripts/embed-aiv-emblem.cjs").read_text(encoding="utf-8")
        self.assertIn("edge !== 'unten' && share > 0.02", script)
        self.assertIn("if (state.auto && state.img) applyAuto(); else render();", self.html)

    def test_glow_is_drawn_behind_the_emblem_only_for_aiv(self) -> None:
        """BM1: Der Schein haengt an drawEmblem() und damit am frueh
        aussteigenden aiv-Zweig -- kein anderes Preset kann ihn erreichen."""
        emblem = self.html[self.html.index("function drawEmblem(){"):]
        emblem = emblem[: emblem.index("// ---------- live badge")]
        self.assertIn("ctx.shadowColor = emblemGlowColor();", emblem)
        # Der Schein wird erst gezeichnet, nachdem emblemRect() eine Flaeche
        # geliefert hat -- und die gibt es nur bei aiv.
        self.assertLess(emblem.index("if (!rect) return;"), emblem.index("EMBLEM_GLOW"))

    def test_glow_offset_and_blur_are_scaled_to_device_pixels(self) -> None:
        """shadowOffsetX/shadowBlur werden von setTransform(SCALE,...) NICHT
        mitskaliert. Ohne * SCALE landet der Schatten ausserhalb der Leinwand
        und der Schein ist unsichtbar -- genau das ist beim Bau passiert."""
        self.assertIn("ctx.shadowOffsetX = (mirrored ? -off : off) * SCALE;", self.html)
        self.assertIn(
            "ctx.shadowBlur = state.emblemSize * EMBLEM_GLOW.blurRatio * SCALE;", self.html
        )

    def test_emblem_itself_is_drawn_exactly_once(self) -> None:
        """Der Schein darf die Farbe des Emblems nicht antasten: das Bild wird
        fuer den Schatten ausserhalb der Leinwand gezeichnet und danach genau
        einmal an seiner echten Stelle."""
        emblem = self.html[self.html.index("function drawEmblem(){"):]
        emblem = emblem[: emblem.index("// ---------- live badge")]
        self.assertEqual(1, emblem.count("ctx.drawImage(img, dx, dy, dw, dh);"))
        self.assertIn("ctx.drawImage(img, dx - off, dy, dw, dh)", emblem)

    def test_image_cover_is_untouched_by_the_emblem(self) -> None:
        """Die zweite Bildebene darf nicht in drawImageCover() eingreifen."""
        cover = self.html[self.html.index("function drawImageCover(){"):]
        cover = cover[: cover.index("// ---------- scrim")]
        self.assertNotIn("emblem", cover.lower())


class PortOccupantIdentityTests(unittest.TestCase):
    """CQ4/CR1: Angeboten wird nur, was belegbar unsere eigene Instanz ist."""

    def occupant(self, **overrides) -> PortOccupant:
        base = dict(port=8765, pid=4242, image_path=r"C:\Windows\explorer.exe")
        base.update(overrides)
        base.setdefault("image_name", Path(base["image_path"]).name if base["image_path"] else None)
        return PortOccupant(**base)

    def inspect(self, *, health=None, pid=4242, command_line=None, port=8765):
        return inspect_port_occupant(
            port,
            health_payload=lambda _port, _timeout: health,
            pid_lookup=lambda _port: pid,
            command_line_lookup=lambda _pid: command_line,
        )

    def test_foreign_process_is_never_offered(self) -> None:
        occupant = self.occupant(health_service="etwas-anderes")
        self.assertFalse(occupant.may_be_stopped)

    def test_unknown_owner_is_never_offered(self) -> None:
        """Ohne PID gibt es nichts, das man gezielt beenden koennte."""
        occupant = self.occupant(pid=None, image_path=None, identified_by_health=True)
        self.assertFalse(occupant.may_be_stopped)

    def test_health_identity_is_enough(self) -> None:
        occupant = self.occupant(identified_by_health=True)
        self.assertTrue(occupant.may_be_stopped)

    def test_command_line_identity_is_enough(self) -> None:
        occupant = self.occupant(identified_by_command_line=True)
        self.assertTrue(occupant.may_be_stopped)

    def test_old_protocol_version_still_counts_as_our_service(self) -> None:
        """Genau der Fall aus Commit 272eaad: laufende ALTE Fassung. Sie ist
        unsere Instanz und muss angeboten werden, obwohl die Protokollversion
        nicht zur Oberflaeche passt."""
        occupant = self.inspect(
            health={
                "service": SERVICE_ID,
                "protocol_version": SERVICE_PROTOCOL_VERSION - 1,
                "ready": True,
            }
        )
        self.assertTrue(occupant.identified_by_health)
        self.assertTrue(occupant.may_be_stopped)

    def test_foreign_service_id_on_the_port_is_refused(self) -> None:
        occupant = self.inspect(health={"service": "fremder-dienst", "ready": True})
        self.assertFalse(occupant.identified_by_health)
        self.assertFalse(occupant.may_be_stopped)

    def test_command_line_must_name_this_very_script(self) -> None:
        own = str(SERVICE_FILE)
        self.assertTrue(command_line_names_this_service(f'pythonw.exe "{own}"'))
        # Aufruf ohne Pfad: so startet der CMD-Launcher, mit gesetztem
        # Arbeitsverzeichnis.
        self.assertTrue(
            command_line_names_this_service("py -3 thumbnail_service.py --port 8765")
        )

    def test_same_named_script_elsewhere_is_refused(self) -> None:
        """Im Zweifel verweigern (CR1): gleicher Dateiname, fremder Pfad."""
        self.assertFalse(
            command_line_names_this_service(
                r'pythonw.exe "C:\Anderswo\thumbnail_service.py"'
            )
        )

    def test_unrelated_command_line_is_refused(self) -> None:
        self.assertFalse(command_line_names_this_service("pythonw.exe irgendwas.py"))
        self.assertFalse(command_line_names_this_service(None))
        self.assertFalse(command_line_names_this_service(""))

    def test_command_line_is_not_queried_for_non_python_processes(self) -> None:
        """Die CIM-Abfrage ist teuer und kann bei einem fremden Prozess ohnehin
        nichts entscheiden."""
        calls = []

        def lookup(pid):
            calls.append(pid)
            return None

        with patch(
            "thumbnail_service._open_process", return_value=None
        ):  # ohne Handle bleibt image_name None
            inspect_port_occupant(
                8765,
                health_payload=lambda _port, _timeout: None,
                pid_lookup=lambda _port: 4242,
                command_line_lookup=lookup,
            )
        self.assertEqual([], calls)


class PortOccupantDescriptionTests(unittest.TestCase):
    """CR1: Die Meldung sagt IMMER, was den Port haelt."""

    def test_description_names_process_path_and_start_time(self) -> None:
        occupant = PortOccupant(
            port=8765,
            pid=4242,
            image_path=r"C:\Windows\explorer.exe",
            image_name="explorer.exe",
            started_at=datetime.datetime(2026, 8, 29, 14, 2, 3),
        )
        text = describe_port_occupant(occupant)
        self.assertIn("Port 8765", text)
        self.assertIn("explorer.exe", text)
        self.assertIn("4242", text)
        self.assertIn(r"C:\Windows\explorer.exe", text)
        self.assertIn("29.08.2026 14:02:03", text)

    def test_description_says_so_when_the_owner_is_unknown(self) -> None:
        text = describe_port_occupant(PortOccupant(port=8765))
        self.assertIn("nicht ermitteln", text)

    def test_description_reports_a_foreign_service_identity(self) -> None:
        text = describe_port_occupant(
            PortOccupant(port=8765, pid=7, health_service="fremder-dienst")
        )
        self.assertIn("fremden Dienstkennung", text)
        self.assertIn("fremder-dienst", text)

    def test_description_reports_our_own_protocol_version(self) -> None:
        text = describe_port_occupant(
            PortOccupant(
                port=8765,
                pid=7,
                health_service=SERVICE_ID,
                health_protocol=1,
                identified_by_health=True,
            )
        )
        self.assertIn("Protokoll 1", text)


class PortConflictResolutionTests(unittest.TestCase):
    """CQ4: Diagnose, Angebot, Ausfuehrung -- und was verweigert wird."""

    def setUp(self) -> None:
        self.asked: list[str] = []
        self.stopped: list[PortOccupant] = []
        self.messages: list[str] = []
        patcher = patch("thumbnail_service._startup_error", self.messages.append)
        patcher.start()
        self.addCleanup(patcher.stop)
        console = patch("thumbnail_service._console_print", self.messages.append)
        console.start()
        self.addCleanup(console.stop)

    def stop(self, occupant, _is_free, **_kwargs):
        self.stopped.append(occupant)
        return True, "beendet"

    def resolve(self, occupant, *, answer=True, may_prompt=True, force=False):
        def ask(description):
            self.asked.append(description)
            return answer

        return resolve_port_conflict(
            8765,
            lambda: True,
            may_prompt=may_prompt,
            force=force,
            inspect=lambda _port: occupant,
            ask=ask,
            stop=self.stop,
        )

    def foreign(self) -> PortOccupant:
        return PortOccupant(
            port=8765,
            pid=4242,
            image_path=r"C:\Windows\explorer.exe",
            image_name="explorer.exe",
        )

    def ours(self) -> PortOccupant:
        return PortOccupant(
            port=8765,
            pid=4242,
            image_path=r"C:\Python\pythonw.exe",
            image_name="pythonw.exe",
            health_service=SERVICE_ID,
            health_protocol=1,
            identified_by_health=True,
        )

    def test_foreign_process_is_neither_asked_about_nor_stopped(self) -> None:
        self.assertFalse(self.resolve(self.foreign()))
        self.assertEqual([], self.asked)
        self.assertEqual([], self.stopped)

    def test_foreign_process_message_still_says_what_holds_the_port(self) -> None:
        self.resolve(self.foreign())
        text = "\n".join(self.messages)
        self.assertIn("explorer.exe", text)
        self.assertIn("4242", text)
        self.assertIn("--port 8766", text)

    def test_unknown_owner_message_offers_a_way_out(self) -> None:
        self.resolve(PortOccupant(port=8765))
        text = "\n".join(self.messages)
        self.assertIn("nicht ermitteln", text)
        self.assertIn("--port 8766", text)
        self.assertEqual([], self.stopped)

    def test_our_instance_is_offered_and_stopped_on_yes(self) -> None:
        self.assertTrue(self.resolve(self.ours()))
        self.assertEqual(1, len(self.asked))
        self.assertEqual(1, len(self.stopped))

    def test_declined_offer_stops_nothing(self) -> None:
        self.assertFalse(self.resolve(self.ours(), answer=False))
        self.assertEqual([], self.stopped)
        self.assertIn("Task-Manager", "\n".join(self.messages))

    def test_no_prompt_reports_without_asking(self) -> None:
        self.assertFalse(self.resolve(self.ours(), may_prompt=False))
        self.assertEqual([], self.asked)
        self.assertEqual([], self.stopped)
        self.assertIn("pythonw.exe", "\n".join(self.messages))

    def test_force_stops_without_asking(self) -> None:
        self.assertTrue(self.resolve(self.ours(), may_prompt=False, force=True))
        self.assertEqual([], self.asked)
        self.assertEqual(1, len(self.stopped))


class GracefulBeforeHardTests(unittest.TestCase):
    """CR2: erst das Quit-Signal, TerminateProcess nur als Rueckfall."""

    def occupant(self) -> PortOccupant:
        return PortOccupant(port=8765, pid=4242, identified_by_health=True)

    def test_a_reacting_instance_is_never_terminated(self) -> None:
        signalled: list[int] = []
        terminated: list[int] = []
        freed = iter([False, True, True, True])

        ok, detail = stop_running_instance(
            self.occupant(),
            lambda: next(freed, True),
            sleep_func=lambda _seconds: None,
            terminate=lambda pid: terminated.append(pid) or True,
            signal_quit=lambda port: signalled.append(port) or True,
        )
        self.assertTrue(ok)
        self.assertEqual([8765], signalled)
        self.assertEqual([], terminated)
        self.assertIn("geordnet", detail)

    def test_a_hanging_instance_is_terminated_after_the_grace(self) -> None:
        terminated: list[int] = []

        def terminate(pid):
            terminated.append(pid)
            return True

        state = {"killed": False}

        def is_free():
            return state["killed"]

        def terminate_and_free(pid):
            terminate(pid)
            state["killed"] = True
            return True

        ok, detail = stop_running_instance(
            self.occupant(),
            is_free,
            graceful_timeout=0.0,
            hard_timeout=1.0,
            sleep_func=lambda _seconds: None,
            terminate=terminate_and_free,
            signal_quit=lambda _port: False,
        )
        self.assertTrue(ok)
        self.assertEqual([4242], terminated)
        # Der Hinweis auf die moegliche Platzhalterdatei ist der Grund, warum
        # dieser Weg der zweite ist (CR2).
        self.assertIn("Platzhalterdatei", detail)

    def test_an_unkillable_instance_reports_failure(self) -> None:
        ok, detail = stop_running_instance(
            self.occupant(),
            lambda: False,
            graceful_timeout=0.0,
            hard_timeout=0.0,
            sleep_func=lambda _seconds: None,
            terminate=lambda _pid: False,
            signal_quit=lambda _port: False,
        )
        self.assertFalse(ok)
        self.assertIn("4242", detail)


class QuitChannelTests(unittest.TestCase):
    def test_quit_channel_has_its_own_name(self) -> None:
        """Der Quit-Kanal darf den Browser-Kanal nicht ueberlagern."""
        self.assertNotEqual(QuitChannel(8765).name, BrowserOpenChannel(8765).name)
        self.assertIn("Quit", QuitChannel(8765).name)

    def test_quit_channel_is_per_port(self) -> None:
        self.assertNotEqual(QuitChannel(8765).name, QuitChannel(8766).name)

    @unittest.skipUnless(os.name == "nt", "benannte Kernel-Objekte gibt es nur unter Windows")
    def test_signal_reaches_a_listening_channel(self) -> None:
        channel = QuitChannel(8891)
        channel.create()
        self.addCleanup(channel.close)
        self.assertFalse(channel.wait(0))
        self.assertTrue(QuitChannel.signal(8891))
        self.assertTrue(channel.wait(500))

    @unittest.skipUnless(os.name == "nt", "benannte Kernel-Objekte gibt es nur unter Windows")
    def test_signal_without_listener_is_reported_as_unreachable(self) -> None:
        """Eine alte Fassung ohne Quit-Kanal: signal() meldet False, der
        Aufrufer faellt auf den harten Weg zurueck."""
        self.assertFalse(QuitChannel.signal(8892))


class HealthPayloadTests(unittest.TestCase):
    def test_payload_and_verdict_agree_on_the_expected_service(self) -> None:
        with patch(
            "thumbnail_service._health_payload",
            return_value={
                "service": SERVICE_ID,
                "protocol_version": SERVICE_PROTOCOL_VERSION,
                "ready": True,
            },
        ):
            self.assertTrue(_health_is_expected(8765))

    def test_an_old_protocol_is_not_the_expected_service(self) -> None:
        with patch(
            "thumbnail_service._health_payload",
            return_value={
                "service": SERVICE_ID,
                "protocol_version": SERVICE_PROTOCOL_VERSION - 1,
                "ready": True,
            },
        ):
            self.assertFalse(_health_is_expected(8765))


class NetworkByteOrderTests(unittest.TestCase):
    def test_local_port_is_read_in_network_byte_order(self) -> None:
        # 8765 == 0x223D; im Tabelleneintrag stehen die Bytes vertauscht.
        self.assertEqual(8765, _network_port_value(0x3D22))
        self.assertEqual(80, _network_port_value(0x5000))



class InstanceMarkerTests(unittest.TestCase):
    """CQ4: Der Beleg, der ohne WMI auskommt.

    Auf diesem Rechner fehlt die WMI-Klasse Win32_Process -- die Kommandozeile
    eines fremden Prozesses ist dort nicht zu bekommen. Ohne den Marker bliebe
    bei einer haengenden Instanz (die nicht mehr auf /api/health antwortet)
    kein einziger Beleg uebrig, und der Launcher muesste verweigern.
    """

    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.directory, True)
        patcher = patch("thumbnail_service.MARKER_DIRECTORY", self.directory)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_marker_round_trip(self) -> None:
        write_instance_marker(8765)
        marker = read_instance_marker(8765)
        self.assertIsNotNone(marker)
        self.assertEqual(SERVICE_ID, marker["service"])
        self.assertEqual(os.getpid(), marker["pid"])

    def test_marker_is_removed_again(self) -> None:
        write_instance_marker(8765)
        remove_instance_marker(8765)
        self.assertIsNone(read_instance_marker(8765))

    def test_removing_a_missing_marker_is_not_an_error(self) -> None:
        remove_instance_marker(8765)

    def test_marker_is_per_port(self) -> None:
        write_instance_marker(8765)
        self.assertIsNone(read_instance_marker(8766))

    def test_marker_identifies_the_own_process(self) -> None:
        write_instance_marker(8765)
        ticks = read_instance_marker(8765)["creation_ticks"]
        self.assertTrue(marker_matches_process(8765, os.getpid(), ticks))

    def test_a_reused_pid_is_not_accepted(self) -> None:
        """Der eigentliche Zweck der Erzeugungszeit: eine liegengebliebene
        Markerdatei darf nicht auf einen fremden Prozess zeigen, der die PID
        inzwischen wiederverwendet hat."""
        write_instance_marker(8765)
        ticks = read_instance_marker(8765)["creation_ticks"]
        self.assertFalse(marker_matches_process(8765, os.getpid(), ticks + 1))

    def test_a_foreign_pid_is_not_accepted(self) -> None:
        write_instance_marker(8765)
        ticks = read_instance_marker(8765)["creation_ticks"]
        self.assertFalse(marker_matches_process(8765, os.getpid() + 1, ticks))

    def test_missing_marker_is_no_evidence(self) -> None:
        self.assertFalse(marker_matches_process(8765, os.getpid(), 1))

    def test_unknown_pid_is_no_evidence(self) -> None:
        write_instance_marker(8765)
        self.assertFalse(marker_matches_process(8765, None, 1))

    def test_foreign_marker_content_is_rejected(self) -> None:
        instance_marker_path(8765).write_text(
            json.dumps({"service": "etwas-anderes", "pid": os.getpid()}),
            encoding="utf-8",
        )
        self.assertIsNone(read_instance_marker(8765))

    def test_damaged_marker_is_rejected(self) -> None:
        instance_marker_path(8765).write_text("kein json", encoding="utf-8")
        self.assertIsNone(read_instance_marker(8765))

    def test_marker_alone_is_enough_to_be_offered(self) -> None:
        """Die haengende Instanz: keine Health-Antwort, keine Kommandozeile."""
        occupant = inspect_port_occupant(
            8765,
            health_payload=lambda _port, _timeout: None,
            pid_lookup=lambda _port: 4242,
            command_line_lookup=lambda _pid: None,
            marker_check=lambda _port, _pid, _ticks: True,
        )
        self.assertTrue(occupant.identified_by_marker)
        self.assertTrue(occupant.may_be_stopped)
        self.assertIn("eingetragen", describe_port_occupant(occupant))

    def test_without_any_evidence_nothing_is_offered(self) -> None:
        occupant = inspect_port_occupant(
            8765,
            health_payload=lambda _port, _timeout: None,
            pid_lookup=lambda _port: 4242,
            command_line_lookup=lambda _pid: None,
            marker_check=lambda _port, _pid, _ticks: False,
        )
        self.assertFalse(occupant.may_be_stopped)



class MarkerSurvivesFailedStartTests(unittest.TestCase):
    """Regression aus dem Abnahmelauf: Ein gescheiterter Start loeschte die
    Markerdatei der noch LAUFENDEN anderen Instanz -- und nahm dem naechsten
    Start damit genau den Beleg, an dem er sie als eigene erkannt haette.
    Weggeraeumt wird nur der selbst geschriebene Marker."""

    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.directory, True)
        patcher = patch("thumbnail_service.MARKER_DIRECTORY", self.directory)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.blocker = socket.socket()
        self.addCleanup(self.blocker.close)
        self.blocker.bind((HOST, 0))
        self.blocker.listen(1)
        self.port = self.blocker.getsockname()[1]

    def test_failed_start_keeps_a_foreign_marker(self) -> None:
        write_instance_marker(self.port)
        before = instance_marker_path(self.port).read_text(encoding="utf-8")
        with patch("thumbnail_service._startup_error"), patch(
            "thumbnail_service._console_print"
        ):
            result = run_server(
                self.port,
                open_browser=False,
                restart_prompt=False,
            )
        self.assertEqual(4, result)
        self.assertTrue(instance_marker_path(self.port).is_file())
        self.assertEqual(before, instance_marker_path(self.port).read_text(encoding="utf-8"))


class HintPortTests(unittest.TestCase):
    def test_the_suggested_port_follows_the_blocked_one(self) -> None:
        """Der Ausweichvorschlag muss zum Konflikt passen und darf nicht
        wieder auf den belegten Port zeigen."""
        self.assertIn("--port 8766", foreign_owner_hint(8765))
        self.assertIn("--port 8800", unknown_owner_hint(8799))
        self.assertNotIn("--port 8799", unknown_owner_hint(8799))



class FakeClock:
    """Steuerbare Uhr. monotonic() zaehlt unter Windows Schlafzeit MIT --
    ein Standby sieht fuer den Dienst genauso aus wie ein Sprung hier."""

    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


class IdleGuardArmingTests(unittest.TestCase):
    """CS2: Der Waechter entsteht ausschliesslich aus einem Lebenszeichen."""

    def setUp(self) -> None:
        self.clock = FakeClock()
        self.shutdowns: list[int] = []
        self.guard = IdleShutdownGuard(
            lambda: self.shutdowns.append(1),
            timeout=120.0,
            poll_interval=5.0,
            clock=self.clock,
            announce=lambda _message: None,
        )
        self.addCleanup(self.guard.close)

    def test_a_fresh_guard_is_not_armed(self) -> None:
        self.assertFalse(self.guard.armed)

    def test_exports_alone_never_arm_the_guard(self) -> None:
        """Ein Skript, das nur exportiert, darf die Selbstbeendigung nicht
        ungewollt einschalten."""
        for _ in range(50):
            self.guard.note_activity()
            self.clock.advance(60)
        self.assertFalse(self.guard.armed)
        self.assertEqual([], self.shutdowns)

    def test_a_heartbeat_arms_the_guard(self) -> None:
        self.guard.note_heartbeat("sitzung-eins")
        self.assertTrue(self.guard.armed)

    def test_arming_is_not_reachable_without_a_heartbeat(self) -> None:
        """Strukturell statt als Abfrage (CS2): Es gibt keine oeffentliche
        Methode, die den Waechter startet. Wer die Schalterlogik umbaut, kann
        daran nichts aendern, ohne note_heartbeat() selbst anzufassen."""
        starters = [
            name
            for name in dir(self.guard)
            if not name.startswith("_") and callable(getattr(self.guard, name))
        ]
        self.assertEqual(
            {"close", "drop_session", "expired", "forgive", "note_activity",
             "note_heartbeat", "tick"},
            set(starters),
        )
        thread_names = {thread.name for thread in threading.enumerate()}
        self.assertNotIn("thumbnail-idle-watchdog", thread_names)

    def test_a_disabled_guard_never_arms_even_with_heartbeats(self) -> None:
        guard = IdleShutdownGuard(
            lambda: self.shutdowns.append(1),
            enabled=False,
            clock=self.clock,
            announce=lambda _message: None,
        )
        self.addCleanup(guard.close)
        for _ in range(10):
            guard.note_heartbeat("sitzung-eins")
        self.assertFalse(guard.armed)
        self.assertEqual(0, guard.session_count)


class IdleGuardExpiryTests(unittest.TestCase):
    """CS1: wann der Waechter WIRKT und wann er es nicht darf."""

    def setUp(self) -> None:
        self.clock = FakeClock()
        self.guard = IdleShutdownGuard(
            lambda: None,
            timeout=120.0,
            poll_interval=5.0,
            jump_tolerance=10.0,
            clock=self.clock,
            announce=lambda _message: None,
        )
        self.addCleanup(self.guard.close)

    def test_tab_closed_expires_after_the_grace(self) -> None:
        """Fall 1: Tab zu -- nach 120 s ohne Lebenszeichen ist Schluss."""
        self.guard.note_heartbeat("tab-eins")
        self.clock.advance(119)
        self.assertFalse(self.guard.expired(self.clock.now))
        self.clock.advance(2)
        self.assertTrue(self.guard.expired(self.clock.now))

    def test_a_reload_keeps_the_service_alive(self) -> None:
        """Fall 2: Neuladen. Die neue Seite meldet sich mit einer NEUEN
        Kennung; die alte laeuft still aus. Zwischen beiden liegen ein bis
        zwei Sekunden -- weit unter der Karenzzeit."""
        self.guard.note_heartbeat("tab-vor-dem-neuladen")
        self.clock.advance(2)
        self.guard.note_heartbeat("tab-nach-dem-neuladen")
        for _ in range(20):
            self.clock.advance(15)
            self.guard.note_heartbeat("tab-nach-dem-neuladen")
            self.assertFalse(self.guard.expired(self.clock.now))
        # Insgesamt weit ueber der Karenzzeit vergangen, nie abgelaufen.
        self.assertGreater(self.clock.now - 1000.0, 2 * 120.0)

    def test_closing_one_of_two_tabs_keeps_the_service_alive(self) -> None:
        """Fall 3: Zwei Tabs, einer geht zu. Der andere haelt den Dienst."""
        self.guard.note_heartbeat("tab-eins")
        self.guard.note_heartbeat("tab-zwei")
        self.assertEqual(2, self.guard.session_count)
        for _ in range(20):
            self.clock.advance(15)
            self.guard.note_heartbeat("tab-zwei")  # nur noch einer meldet sich
            self.assertFalse(self.guard.expired(self.clock.now))
        self.assertGreater(self.clock.now - 1000.0, 2 * 120.0)

    def test_a_background_tab_at_one_beat_per_minute_survives(self) -> None:
        """Chrome drosselt Timer im Hintergrund auf einen Durchlauf pro
        Minute. Genau dafuer sind die 120 s gewaehlt."""
        self.guard.note_heartbeat("tab-im-hintergrund")
        for _ in range(10):
            self.clock.advance(60)
            self.assertFalse(self.guard.expired(self.clock.now))
            self.guard.note_heartbeat("tab-im-hintergrund")

    def test_an_export_refreshes_the_deadline(self) -> None:
        """Wer exportiert, schaut zu -- auch wenn der Timer gerade gedrosselt
        ist."""
        self.guard.note_heartbeat("tab-eins")
        self.clock.advance(100)
        self.guard.note_activity()
        self.clock.advance(100)
        self.assertFalse(self.guard.expired(self.clock.now))

    def test_never_expires_without_any_sign_of_life(self) -> None:
        """Fall 4: Nie ein Lebenszeichen -- es gibt gar keine Frist."""
        self.clock.advance(10_000)
        self.assertFalse(self.guard.expired(self.clock.now))


class IdleGuardSleepTests(unittest.TestCase):
    """CS1, Fall 5: der Zeitsprung.

    Nur simulierbar -- ein echtes Standby laesst sich im Test nicht ausloesen.
    Die Simulation ist aber genau richtig: time.monotonic() laeuft unter
    Windows ueber GetTickCount64 und ZAEHLT SCHLAFZEIT MIT. Fuer den Waechter
    ist ein Standby daher nichts anderes als eine Uhr, die zwischen zwei Runden
    weit springt -- und genau das stellt FakeClock her. Was der Test prueft,
    ist die einzige Stelle, an der der Dienst diesen Unterschied sehen kann:
    die Luecke zwischen zwei Runden von tick().
    """

    def setUp(self) -> None:
        self.clock = FakeClock()
        self.shutdowns: list[int] = []
        self.guard = IdleShutdownGuard(
            lambda: self.shutdowns.append(1),
            timeout=120.0,
            poll_interval=5.0,
            jump_tolerance=10.0,
            clock=self.clock,
            announce=lambda _message: None,
        )
        self.addCleanup(self.guard.close)

    def test_without_the_jump_detection_standby_would_end_the_service(self) -> None:
        """Der Nachweis, dass die Erkennung ueberhaupt etwas abfaengt: nach
        zwei Stunden Standby ist die Frist rechnerisch laengst abgelaufen."""
        self.guard.note_heartbeat("tab-eins")
        self.clock.advance(2 * 60 * 60)
        self.assertTrue(self.guard.expired(self.clock.now))

    def test_a_time_jump_resets_the_grace_instead_of_shutting_down(self) -> None:
        self.guard.note_heartbeat("tab-eins")
        previous = self.clock.now
        self.clock.advance(2 * 60 * 60)  # Standby
        previous, finished = self.guard.tick(previous)
        self.assertFalse(finished)
        # Und danach laeuft die volle Karenzzeit neu, nicht ein Rest davon.
        self.clock.advance(119)
        self.assertFalse(self.guard.expired(self.clock.now))
        self.clock.advance(2)
        self.assertTrue(self.guard.expired(self.clock.now))

    def test_a_normal_round_is_not_mistaken_for_a_jump(self) -> None:
        """Die Toleranz darf die Selbstbeendigung nicht aushebeln: eine Runde
        im normalen Takt zaehlt nicht als Sprung."""
        self.guard.note_heartbeat("tab-eins")
        previous = self.clock.now
        for _ in range(30):
            self.clock.advance(5)
            previous, finished = self.guard.tick(previous)
        self.assertTrue(finished)

    def test_a_short_hiccup_is_tolerated_as_a_jump(self) -> None:
        """Eine Verzoegerung knapp ueber Takt plus Toleranz gilt als Sprung --
        im Zweifel weiterlaufen statt zu frueh beenden."""
        self.guard.note_heartbeat("tab-eins")
        previous = self.clock.now
        self.clock.advance(200)
        previous, finished = self.guard.tick(previous)
        self.assertFalse(finished)
        self.assertEqual([], self.shutdowns)


class IdleGuardSessionTableTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.guard = IdleShutdownGuard(
            lambda: None, clock=self.clock, announce=lambda _m: None
        )
        self.addCleanup(self.guard.close)

    def test_the_same_tab_is_counted_once(self) -> None:
        for _ in range(5):
            self.guard.note_heartbeat("tab-eins")
        self.assertEqual(1, self.guard.session_count)

    def test_the_table_does_not_grow_without_bound(self) -> None:
        """Immer neue Kennungen (viele Neuladungen) duerfen den Dienst nicht
        volllaufen lassen."""
        for index in range(MAX_TRACKED_SESSIONS + 20):
            self.guard.note_heartbeat(f"sitzung-{index:04d}")
        self.assertEqual(MAX_TRACKED_SESSIONS, self.guard.session_count)

    def test_a_dropped_session_is_gone(self) -> None:
        self.guard.note_heartbeat("tab-eins")
        self.guard.drop_session("tab-eins")
        self.assertEqual(0, self.guard.session_count)


class IdleShutdownEndToEndTests(unittest.TestCase):
    """Dieselben Faelle noch einmal gegen den LAUFENDEN Dienst ueber HTTP --
    mit verkuerzter Karenzzeit, damit die Laufzeit ertraeglich bleibt. Was hier
    zusaetzlich nachgewiesen wird, ist die Verdrahtung: Route, Kopfzeilen,
    Waechter und serve_forever greifen wirklich ineinander."""

    token = "test-session-token-that-is-long-enough"
    timeout_seconds = 0.8

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        (root / "source").mkdir()
        (root / "export").mkdir()
        self.guard = IdleShutdownGuard(
            lambda: self.server.shutdown(),
            timeout=self.timeout_seconds,
            poll_interval=0.05,
            jump_tolerance=0.5,
            announce=lambda _message: None,
        )
        self.addCleanup(self.guard.close)
        self.server = create_server(
            port=0,
            session_token=self.token,
            source_directory=root / "source",
            export_directory=root / "export",
            stability_delay=0,
            idle_guard=self.guard,
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=3)
        self.server.server_close()

    def ping(self, session_id: str, *, token: str | None = token) -> tuple[int, dict]:
        connection = http.client.HTTPConnection(HOST, self.server.server_port)
        headers = {"Host": f"{HOST}:{self.server.server_port}"}
        if token is not None:
            headers["X-Session-Token"] = token
        if session_id is not None:
            headers["X-Session-Id"] = session_id
        connection.request("POST", "/api/session/ping", headers=headers)
        response = connection.getresponse()
        data = response.read()
        status = response.status
        connection.close()
        return status, (json.loads(data) if data else {})

    def still_running(self) -> bool:
        return self.thread.is_alive()

    def keep_alive_for(self, seconds: float, session_id: str) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if not self.still_running():
                return
            self.ping(session_id)
            time.sleep(self.timeout_seconds / 4)

    def test_a_ping_is_answered_and_counted(self) -> None:
        status, payload = self.ping("tab-eins-kennung")
        self.assertEqual(200, status)
        self.assertTrue(payload["ok"])
        self.assertEqual(1, payload["sessions"])

    def test_the_ping_needs_the_session_token(self) -> None:
        status, payload = self.ping("tab-eins-kennung", token=None)
        self.assertEqual(401, status)
        self.assertEqual("invalid_token", payload["code"])
        self.assertFalse(self.guard.armed)

    def test_a_malformed_session_id_is_rejected(self) -> None:
        for bad in ("", "kurz", "hat leerzeichen drin", "x" * 200):
            status, payload = self.ping(bad)
            self.assertEqual(400, status, bad)
            self.assertEqual("invalid_session_id", payload["code"])
        self.assertFalse(self.guard.armed)

    def test_case_one_closed_tab_ends_the_service(self) -> None:
        self.ping("tab-das-gleich-zugeht")
        time.sleep(self.timeout_seconds * 3)
        self.thread.join(timeout=2)
        self.assertFalse(self.still_running())

    def test_case_two_a_reload_keeps_it_running(self) -> None:
        self.ping("kennung-vor-dem-neuladen")
        time.sleep(self.timeout_seconds / 2)  # die Luecke des Neuladens
        self.keep_alive_for(self.timeout_seconds * 3, "kennung-nach-dem-neuladen")
        self.assertTrue(self.still_running())

    def test_case_three_one_of_two_tabs_closes(self) -> None:
        self.ping("erster-tab-kennung")
        self.ping("zweiter-tab-kennung")
        self.assertEqual(2, self.guard.session_count)
        self.keep_alive_for(self.timeout_seconds * 3, "zweiter-tab-kennung")
        self.assertTrue(self.still_running())

    def test_case_four_without_any_heartbeat_it_never_ends(self) -> None:
        self.assertFalse(self.guard.armed)
        time.sleep(self.timeout_seconds * 3)
        self.assertTrue(self.still_running())
        self.assertNotIn(
            "thumbnail-idle-watchdog",
            {thread.name for thread in threading.enumerate()},
        )

    def test_ping_is_post_only(self) -> None:
        connection = http.client.HTTPConnection(HOST, self.server.server_port)
        connection.request(
            "GET",
            "/api/session/ping",
            headers={
                "Host": f"{HOST}:{self.server.server_port}",
                "X-Session-Token": self.token,
            },
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        self.assertEqual(405, response.status)
        self.assertEqual("method_not_allowed", payload["code"])


class ExitWhenIdleSwitchTests(unittest.TestCase):
    """CQ3, Schalterebene 2 und 3."""

    def test_without_a_browser_it_is_off(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(EXIT_WHEN_IDLE_ENV, None)
            self.assertFalse(exit_when_idle_default(False))
            self.assertTrue(exit_when_idle_default(True))

    def test_the_environment_overrides_both_ways(self) -> None:
        with patch.dict(os.environ, {EXIT_WHEN_IDLE_ENV: "0"}):
            self.assertFalse(exit_when_idle_default(True))
        with patch.dict(os.environ, {EXIT_WHEN_IDLE_ENV: "1"}):
            self.assertTrue(exit_when_idle_default(False))
        with patch.dict(os.environ, {EXIT_WHEN_IDLE_ENV: "nein"}):
            self.assertFalse(exit_when_idle_default(True))

    def test_an_unknown_value_falls_back_to_the_browser_rule(self) -> None:
        with patch.dict(os.environ, {EXIT_WHEN_IDLE_ENV: "vielleicht"}):
            self.assertFalse(exit_when_idle_default(False))
            self.assertTrue(exit_when_idle_default(True))


class HeartbeatClientContractTests(unittest.TestCase):
    """Was die Seite dafuer tun muss (CQ1)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (Path(__file__).resolve().parents[1] / "thumbnail-compositor.html").read_text(
            encoding="utf-8"
        )

    def test_the_page_sends_a_heartbeat(self) -> None:
        self.assertIn("fetch('/api/session/ping'", self.html)
        self.assertIn("'X-Session-Id': heartbeatSessionId", self.html)
        self.assertIn("'X-Session-Token': localService.token", self.html)

    def test_every_document_gets_its_own_session_id(self) -> None:
        """Sonst koennte ein Neuladen nicht von einem zweiten Tab
        unterschieden werden."""
        self.assertIn("window.crypto.randomUUID()", self.html)

    def test_the_interval_leaves_room_for_throttling(self) -> None:
        """15 s Takt gegen 120 s Karenzzeit: auch auf einen Schlag pro Minute
        gedrosselt bleibt Luft fuer zwei ausgefallene Schlaege."""
        self.assertIn("const HEARTBEAT_INTERVAL_MS = 15000;", self.html)
        self.assertLessEqual(15.0 * 4, IDLE_TIMEOUT_SECONDS)

    def test_returning_to_the_tab_reports_immediately(self) -> None:
        self.assertIn("document.visibilityState === 'visible') sendHeartbeat()", self.html)

    def test_the_heartbeat_stays_off_without_the_local_service(self) -> None:
        """Ueber file:// -- also in der Render-Harness -- gibt es keinen Dienst
        und darf es keine Anfragen geben."""
        self.assertIn("if (!localService.available) return;", self.html)
        self.assertIn(
            "if (!localService.available || heartbeatTimer !== null) return;", self.html
        )

    def test_an_older_service_stops_the_heartbeat_quietly(self) -> None:
        self.assertIn("if (response.status === 404){", self.html)


if __name__ == "__main__":
    unittest.main()
