"""Lokaler, ausschließlich an 127.0.0.1 gebundener Thumbnail-Dienst."""

from __future__ import annotations

import argparse
import copy
import ctypes
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable
from urllib.parse import parse_qs, quote, unquote, urlsplit
import webbrowser


HOST = "127.0.0.1"
DEFAULT_PORT = 8765
SOURCE_DIRECTORY_ENV = "THUMBNAIL_SOURCE_DIR"
EXPORT_DIRECTORY_ENV = "THUMBNAIL_EXPORT_DIR"
# Fallback ohne festen Rechnerpfad: Unterordner des Arbeitsverzeichnisses.
SOURCE_DIRECTORY = Path("thumbnail-source")
EXPORT_DIRECTORY = Path("thumbnail-export")
HTML_FILE = Path(__file__).with_name("thumbnail-compositor.html")
# T1: Persistente Folgennummerierung je Serie (innercircle|livestream|standard).
# Nur lesend fuer die Anzeige
# ("naechste freie Nummer"), aber vom Export-Endpunkt aus auch beschrieben --
# siehe _record_series_registry_entry(). Beide Pfade sind relativ zum Skript,
# nicht zum aktuellen Arbeitsverzeichnis (analog zu HTML_FILE).
SERIES_REGISTRY_FILE = Path(__file__).with_name("data") / "series-registry.json"
# CJ1: Emblem-Varianten werden zur Laufzeit gelesen statt in die HTML eingebettet.
# Bei 14 Varianten waeren das ~4,7 MB base64 in einer Datei, die bei jedem Start
# komplett geparst wird -- und die Bibliothek waechst weiter. Eingebettet bleibt
# nur eine Rueckfall-Variante, damit der Compositor auch ohne Dienst nicht
# emblemlos rendert (siehe assets/branding/README.md).
EMBLEMS_DIRECTORY = Path(__file__).with_name("assets") / "branding" / "emblems"
# Der Slug ist der Dateiname ohne Endung. Bewusst eng: nur Kleinbuchstaben,
# Ziffern und Bindestrich, erstes Zeichen alphanumerisch, hoechstens 64 Zeichen.
# Damit kann aus einem Slug weder ein Pfadtrenner noch ".." noch ein absoluter
# Pfad werden -- der Join unten kann die Verzeichnisgrenze nicht verlassen.
EMBLEM_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_EMBLEM_BYTES = 4 * 1024 * 1024
SERIES_REGISTRY_BACKUP_DIRECTORY = Path(__file__).with_name("backups")
MAX_SERIES_REGISTRY_BYTES = 5 * 1024 * 1024
MAX_SOURCE_BYTES = 50 * 1024 * 1024
MAX_EXPORT_BYTES = 60 * 1024 * 1024
MAX_CANDIDATE_ATTEMPTS = 8
STABILITY_DELAY_SECONDS = 0.25
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
REPARSE_ATTRIBUTE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
SERVICE_ID = "dimensionwithin-thumbnail-compositor"
SERVICE_PROTOCOL_VERSION = 1
STARTUP_SIGNAL_TIMEOUT_SECONDS = 5.0
BROWSER_OPEN_DELAY_SECONDS = 0.35
WINDOWS_ERROR_ALREADY_EXISTS = 183
WINDOWS_WAIT_OBJECT_0 = 0
WINDOWS_WAIT_TIMEOUT = 258
WINDOWS_SEMAPHORE_MODIFY_STATE = 0x0002
_EXPORT_LOCKS_GUARD = threading.Lock()
_EXPORT_LOCKS: dict[str, threading.Lock] = {}


def _console_print(message: str) -> None:
    if sys.stdout is None:
        return
    encoding = sys.stdout.encoding or "utf-8"
    print(message.encode(encoding, "backslashreplace").decode(encoding))


def _startup_error(message: str) -> None:
    _console_print(message)
    if os.name != "nt" or sys.stdout is not None:
        return
    try:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.MessageBoxW(
            None,
            message,
            "DimensionWithin Thumbnail-Compositor",
            0x00000010,
        )
    except (AttributeError, OSError):
        pass


class SingleInstanceGuard:
    """Windows-Mutex gegen nahezu gleichzeitige doppelte Normalstarts."""

    def __init__(self, port: int):
        self.name = f"Local\\DimensionWithinThumbnailCompositor-{HOST}-{port}"
        self.handle: int | None = None

    def acquire(self) -> bool:
        if os.name != "nt":
            return True
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [
            ctypes.c_void_p,
            ctypes.c_bool,
            ctypes.c_wchar_p,
        ]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, False, self.name)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:
            kernel32.CloseHandle(handle)
            return False
        self.handle = handle
        return True

    def release(self) -> None:
        if self.handle is None or os.name != "nt":
            return
        ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(self.handle)
        self.handle = None


class BrowserOpenChannel:
    """Gezähltes, tokenfreies Windows-Signal an die primäre Instanz."""

    MAX_PENDING_SIGNALS = 64

    def __init__(self, port: int):
        self.name = (
            f"Local\\DimensionWithinThumbnailCompositor-Open-{HOST}-{port}"
        )
        self.handle: int | None = None

    def create(self) -> None:
        if os.name != "nt":
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateSemaphoreW.argtypes = [
            ctypes.c_void_p,
            ctypes.c_long,
            ctypes.c_long,
            ctypes.c_wchar_p,
        ]
        kernel32.CreateSemaphoreW.restype = ctypes.c_void_p
        ctypes.set_last_error(0)
        handle = kernel32.CreateSemaphoreW(
            None, 0, self.MAX_PENDING_SIGNALS, self.name
        )
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == WINDOWS_ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            raise OSError("Der Browser-Signalkanal ist bereits belegt.")
        self.handle = handle

    def wait(self, timeout_ms: int) -> bool:
        if self.handle is None or os.name != "nt":
            return False
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        result = kernel32.WaitForSingleObject(self.handle, timeout_ms)
        if result == WINDOWS_WAIT_OBJECT_0:
            return True
        if result == WINDOWS_WAIT_TIMEOUT:
            return False
        raise ctypes.WinError(ctypes.get_last_error())

    @classmethod
    def signal(cls, port: int) -> bool:
        if os.name != "nt":
            return False
        channel = cls(port)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenSemaphoreW.argtypes = [
            ctypes.c_ulong,
            ctypes.c_bool,
            ctypes.c_wchar_p,
        ]
        kernel32.OpenSemaphoreW.restype = ctypes.c_void_p
        handle = kernel32.OpenSemaphoreW(
            WINDOWS_SEMAPHORE_MODIFY_STATE, False, channel.name
        )
        if not handle:
            return False
        try:
            return bool(kernel32.ReleaseSemaphore(handle, 1, None))
        finally:
            kernel32.CloseHandle(handle)

    def close(self) -> None:
        if self.handle is None or os.name != "nt":
            return
        ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(self.handle)
        self.handle = None


class BrowserOpenCoordinator:
    """Öffnet die geheime Start-URL einmal pro empfangenem Startsignal."""

    def __init__(
        self,
        channel: BrowserOpenChannel,
        url: str,
        opener: Callable[..., object],
    ):
        self.channel = channel
        self.url = url
        self.opener = opener
        self.stop_event = threading.Event()
        self.open_lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.initial_timer: threading.Timer | None = None

    def start(self) -> None:
        if os.name != "nt":
            return
        self.thread = threading.Thread(
            target=self._watch,
            name="thumbnail-browser-open-signal",
            daemon=True,
        )
        self.thread.start()

    def schedule_initial_open(self, delay_seconds: float) -> None:
        self.initial_timer = threading.Timer(delay_seconds, self.open_browser)
        self.initial_timer.daemon = True
        self.initial_timer.start()

    def open_browser(self) -> None:
        if self.stop_event.is_set():
            return
        try:
            with self.open_lock:
                self.opener(self.url, new=2)
        except Exception as error:  # pragma: no cover - platform browser boundary
            _console_print(f"Der Standardbrowser konnte nicht geöffnet werden: {error!r}")

    def _watch(self) -> None:
        while not self.stop_event.is_set():
            try:
                if self.channel.wait(200):
                    self.open_browser()
            except OSError as error:
                if not self.stop_event.is_set():
                    _console_print(f"Browser-Signalkanal fehlgeschlagen: {error!r}")
                return

    def close(self) -> None:
        self.stop_event.set()
        if self.initial_timer is not None:
            self.initial_timer.cancel()
        if self.thread is not None:
            self.thread.join(timeout=0.5)


def _health_is_expected(port: int, timeout_seconds: float = 0.4) -> bool:
    connection: http.client.HTTPConnection | None = None
    try:
        connection = http.client.HTTPConnection(
            HOST, port, timeout=max(0.05, timeout_seconds)
        )
        connection.request(
            "GET",
            "/api/health",
            headers={
                "Host": f"{HOST}:{port}",
                "Accept": "application/json",
            },
        )
        response = connection.getresponse()
        data = response.read(4097)
        if response.status != HTTPStatus.OK or len(data) > 4096:
            return False
        if response.getheader("Cache-Control") != "no-store":
            return False
        payload = json.loads(data)
        return payload == {
            "service": SERVICE_ID,
            "protocol_version": SERVICE_PROTOCOL_VERSION,
            "ready": True,
        }
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    finally:
        if connection is not None:
            connection.close()


def signal_running_instance(
    port: int,
    *,
    timeout_seconds: float = STARTUP_SIGNAL_TIMEOUT_SECONDS,
    poll_interval: float = 0.05,
    health_check: Callable[[int, float], bool] = _health_is_expected,
    sleep_func: Callable[[float], None] = time.sleep,
) -> bool:
    """Prüft die Dienstidentität begrenzt und signalisiert genau eine Öffnung."""

    deadline = time.monotonic() + max(0.0, timeout_seconds)
    while True:
        remaining = max(0.0, deadline - time.monotonic())
        if health_check(port, min(0.4, max(0.05, remaining))):
            if BrowserOpenChannel.signal(port):
                return True
        if remaining <= 0:
            return False
        sleep_func(min(poll_interval, remaining))


class SourceSelectionError(Exception):
    """Kontrollierter Auswahlfehler mit HTTP-tauglichem Fehlercode."""

    def __init__(self, code: str, message: str, status: HTTPStatus):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass(frozen=True)
class FileSnapshot:
    size: int
    mtime_ns: int
    mode: int
    file_attributes: int


@dataclass(frozen=True)
class SourceImage:
    filename: str
    size: int
    mtime_ns: int
    identity: str
    data: bytes
    content_type: str = "image/png"


def _export_lock_for(directory: Path) -> threading.Lock:
    key = os.path.normcase(str(directory.resolve()))
    with _EXPORT_LOCKS_GUARD:
        return _EXPORT_LOCKS.setdefault(key, threading.Lock())


def _export_candidate_name(filename: str, suffix_number: int | None) -> str:
    path = Path(filename)
    if suffix_number is None:
        return filename
    return f"{path.stem} ({suffix_number}){path.suffix}"


def _reserve_export_path(directory: Path, filename: str) -> tuple[Path, os.stat_result]:
    occupied = {
        entry.name.casefold()
        for entry in os.scandir(directory)
        if not entry.name.startswith(".thumbnail-export-")
    }
    suffix_number: int | None = None
    while True:
        candidate_name = _export_candidate_name(filename, suffix_number)
        if candidate_name.casefold() in occupied:
            suffix_number = 2 if suffix_number is None else suffix_number + 1
            continue
        candidate = directory / candidate_name
        try:
            descriptor = os.open(
                candidate,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0),
                0o600,
            )
        except FileExistsError:
            occupied.add(candidate_name.casefold())
            suffix_number = 2 if suffix_number is None else suffix_number + 1
            continue
        try:
            reservation = os.fstat(descriptor)
        finally:
            os.close(descriptor)
        return candidate, reservation


def _remove_owned_reservation(path: Path, reservation: os.stat_result) -> None:
    try:
        current = path.stat()
        if (
            current.st_dev == reservation.st_dev
            and current.st_ino == reservation.st_ino
            and current.st_size == 0
        ):
            path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


def commit_export_temp(
    temp_path: Path,
    export_directory: Path,
    requested_filename: str,
    expected_size: int,
) -> str:
    """Reserviert einen freien Namen und ersetzt nur die eigene Reservierung."""

    lock = _export_lock_for(export_directory)
    final_path: Path | None = None
    reservation: os.stat_result | None = None
    temp_snapshot = temp_path.stat()
    committed = False
    with lock:
        try:
            final_path, reservation = _reserve_export_path(
                export_directory, requested_filename
            )
            os.replace(temp_path, final_path)
            committed = True
            completed = final_path.stat()
            if completed.st_size != expected_size:
                raise OSError("Die atomar abgeschlossene Exportgröße ist ungültig.")
            return final_path.name
        except Exception:
            if committed and final_path is not None:
                try:
                    current = final_path.stat()
                    if (
                        current.st_dev == temp_snapshot.st_dev
                        and current.st_ino == temp_snapshot.st_ino
                    ):
                        final_path.unlink()
                except OSError:
                    pass
            elif final_path is not None and reservation is not None:
                _remove_owned_reservation(final_path, reservation)
            raise


def _snapshot(path: Path) -> FileSnapshot:
    info = path.lstat()
    return FileSnapshot(
        size=info.st_size,
        mtime_ns=info.st_mtime_ns,
        mode=info.st_mode,
        file_attributes=getattr(info, "st_file_attributes", 0),
    )


def _is_regular_non_link(snapshot: FileSnapshot) -> bool:
    return (
        stat.S_ISREG(snapshot.mode)
        and not stat.S_ISLNK(snapshot.mode)
        and not (snapshot.file_attributes & REPARSE_ATTRIBUTE)
    )


def _read_bytes_without_following_links(path: Path) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        opened_snapshot = FileSnapshot(
            size=opened.st_size,
            mtime_ns=opened.st_mtime_ns,
            mode=opened.st_mode,
            file_attributes=getattr(opened, "st_file_attributes", 0),
        )
        if not _is_regular_non_link(opened_snapshot):
            raise OSError("Der Dateieintrag ist kein reguläres, linkfreies Bild.")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            return source.read()
    finally:
        os.close(descriptor)


def _source_identity(filename: str, size: int, mtime_ns: int) -> str:
    material = f"{filename}\0{size}\0{mtime_ns}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def select_latest_png(
    source_directory: Path,
    *,
    max_bytes: int = MAX_SOURCE_BYTES,
    max_candidate_attempts: int = MAX_CANDIDATE_ATTEMPTS,
    stability_delay: float = STABILITY_DELAY_SECONDS,
    sleep_func: Callable[[float], None] = time.sleep,
    read_func: Callable[[Path], bytes] = _read_bytes_without_following_links,
) -> SourceImage:
    """Wählt das neueste stabile PNG unmittelbar aus ``source_directory``.

    Die Funktion ist vom HTTP-Handler getrennt und für Tests vollständig
    injizierbar. Alle geeigneten Kandidaten werden vor einer einzigen,
    begrenzten Stabilitätswartezeit erfasst. Ein instabiler oder ungültiger
    neuer Kandidat blockiert dadurch kein älteres, vollständiges PNG.
    """

    directory = Path(source_directory)
    try:
        entries = list(os.scandir(directory))
    except (FileNotFoundError, NotADirectoryError) as error:
        raise SourceSelectionError(
            "source_missing",
            "Der TradingView-Quellordner ist nicht vorhanden.",
            HTTPStatus.NOT_FOUND,
        ) from error
    except PermissionError as error:
        raise SourceSelectionError(
            "source_unreadable",
            "Der TradingView-Quellordner ist nicht lesbar.",
            HTTPStatus.FORBIDDEN,
        ) from error
    except OSError as error:
        raise SourceSelectionError(
            "source_unreadable",
            "Der TradingView-Quellordner konnte nicht gelesen werden.",
            HTTPStatus.FORBIDDEN,
        ) from error

    saw_png_entry = False
    candidates: list[tuple[Path, str, FileSnapshot]] = []
    for entry in entries:
        if Path(entry.name).suffix.lower() != ".png":
            continue
        saw_png_entry = True
        path = directory / entry.name
        try:
            first = _snapshot(path)
        except OSError:
            continue
        if not _is_regular_non_link(first):
            continue
        if first.size <= 0 or first.size > max_bytes:
            continue
        candidates.append((path, entry.name, first))

    if not candidates:
        if saw_png_entry:
            raise SourceSelectionError(
                "source_invalid",
                "Im TradingView-Quellordner gibt es nur ungeeignete PNG-Dateien.",
                HTTPStatus.CONFLICT,
            )
        raise SourceSelectionError(
            "source_empty",
            "Im TradingView-Quellordner wurde kein PNG-Bild gefunden.",
            HTTPStatus.NOT_FOUND,
        )

    candidates.sort(key=lambda item: (-item[2].mtime_ns, item[1].casefold(), item[1]))
    sleep_func(stability_delay)

    saw_unstable = False
    saw_invalid = False
    saw_read_error = False
    for path, filename, first in candidates[:max_candidate_attempts]:
        try:
            second = _snapshot(path)
        except OSError:
            saw_unstable = True
            continue
        if second != first or not _is_regular_non_link(second):
            saw_unstable = True
            continue

        try:
            data = read_func(path)
            final = _snapshot(path)
        except OSError:
            saw_read_error = True
            continue

        if final != second or not _is_regular_non_link(final) or len(data) != final.size:
            saw_unstable = True
            continue
        if not data.startswith(PNG_SIGNATURE):
            saw_invalid = True
            continue

        return SourceImage(
            filename=filename,
            size=final.size,
            mtime_ns=final.mtime_ns,
            identity=_source_identity(filename, final.size, final.mtime_ns),
            data=data,
        )

    if saw_unstable:
        raise SourceSelectionError(
            "source_unstable",
            "Der neueste PNG-Rohdownload ist noch nicht vollständig.",
            HTTPStatus.CONFLICT,
        )
    if saw_invalid:
        raise SourceSelectionError(
            "source_invalid",
            "Die vorhandenen PNG-Dateien haben keine gültige PNG-Signatur.",
            HTTPStatus.UNPROCESSABLE_ENTITY,
        )
    if saw_read_error:
        raise SourceSelectionError(
            "source_read_error",
            "Die PNG-Datei konnte nicht vollständig gelesen werden.",
            HTTPStatus.INTERNAL_SERVER_ERROR,
        )
    raise SourceSelectionError(
        "source_invalid",
        "Es wurde kein gültiges, stabiles PNG-Bild gefunden.",
        HTTPStatus.UNPROCESSABLE_ENTITY,
    )


# V6 (2026-08-27): HARTE TRENNUNG DER SERIEN-ZAEHLER. Die Serie haengt am
# PRESET, nicht am Feldnamen und nicht an der Reihenfolge. nonchart hat keine
# Serie -- dort wird nie gelesen und nie geschrieben. Es gibt keinen gemeinsamen
# Zaehler und keinen Fallback auf eine andere Serie, wenn die eigene leer ist.
SERIES_FOR_PRESET = {
    "aiv": "aiv",
    "innercircle": "innercircle",
    "livestream": "livestream",
    "standard": "standard",
    "nonchart": None,
    # BJ6: Ad-hoc-Mitgliederstreams tragen bewusst keine Nummer und damit keine
    # Serie. Ein eigenes Preset statt einer innercircle-Variante -- so kann es
    # den Inner-Circle-Zaehler gar nicht erst erreichen.
    "memberlive": None,
}
SERIES_NAMES = ("aiv", "innercircle", "livestream", "standard")
# Die gedruckte Kopfzeile sieht je Serie anders aus ("INNER CIRCLE #71" vs.
# "EP. 16"), deshalb je Serie ein eigenes Muster statt einem generischen.
SERIES_NUMBER_PATTERN = {
    "aiv": re.compile(r"#\s*(\d+)"),
    "innercircle": re.compile(r"#\s*(\d+)"),
    "livestream": re.compile(r"#\s*(\d+)"),
    "standard": re.compile(r"(?:EP\.?\s*)?(\d+)"),
}


def series_for_preset(preset: str) -> str | None:
    """Einzige Stelle, die Preset -> Serie aufloest. Unbekannte Presets bekommen
    bewusst keine Serie (fail closed), statt auf innercircle zurueckzufallen."""
    return SERIES_FOR_PRESET.get(preset)


def normalized_last_assigned(registry: dict) -> dict:
    """Migration V1 -> V2: frueher war lastAssigned EIN Wert {"number","at"} und
    meinte immer Inner Circle. Jetzt ist es {serie: {"number","at"}}. Alte Dateien
    werden beim Lesen transparent uebersetzt, damit ein alter Stand nicht als
    Zaehler einer falschen Serie missverstanden wird."""
    raw = registry.get("lastAssigned")
    if not isinstance(raw, dict):
        return {}
    if "number" in raw:
        return {"innercircle": {"number": raw.get("number"), "at": raw.get("at")}}
    return {name: value for name, value in raw.items() if isinstance(value, dict)}


def series_floor_number(registry: dict, series: str) -> int:
    """Hoechste bereits vergebene Nummer DIESER Serie -- aus den vollen Eintraegen
    und dem Zaehler, die auseinanderlaufen koennen (der Wochenlauf schreibt
    Eintraege, der Creator den Zaehler). Nie serienuebergreifend."""
    entries = registry.get(series)
    numbers = []
    if isinstance(entries, list):
        numbers = [e.get("number") for e in entries if isinstance(e, dict)]
    max_entry = max((n for n in numbers if isinstance(n, int)), default=0)
    counter = normalized_last_assigned(registry).get(series) or {}
    counter_number = counter.get("number")
    return max(max_entry, counter_number if isinstance(counter_number, int) else 0)


def series_fingerprint(registry: dict) -> dict:
    """Vergleichsbild je Serie: (volle Eintraege, Zaehler). Basis der Selbstpruefung."""
    counters = normalized_last_assigned(registry)
    return {
        name: (
            json.dumps(registry.get(name) or [], sort_keys=True, ensure_ascii=False),
            json.dumps(counters.get(name) or {}, sort_keys=True, ensure_ascii=False),
        )
        for name in SERIES_NAMES
    }


def verify_only_series_touched(before: dict, after: dict, series: str) -> str | None:
    """V6-Selbstpruefung. Erlaubt ist GENAU eine Aenderung: der Zaehler von
    `series`. Alles andere -- jede fremde Serie, jede Eintragsliste, auch die der
    eigenen Serie -- muss identisch bleiben. Gibt bei Verletzung einen Klartext
    zurueck, sonst None."""
    fingerprint_before = series_fingerprint(before)
    fingerprint_after = series_fingerprint(after)
    for name in SERIES_NAMES:
        entries_before, counter_before = fingerprint_before[name]
        entries_after, counter_after = fingerprint_after[name]
        if entries_before != entries_after:
            return f"Die Eintraege der Serie '{name}' haben sich veraendert."
        if name != series and counter_before != counter_after:
            return f"Der Zaehler der fremden Serie '{name}' hat sich veraendert."
    if fingerprint_before[series][1] == fingerprint_after[series][1]:
        return f"Der Zaehler der Serie '{series}' wurde nicht fortgeschrieben."
    return None


def record_series_registry_export(
    preset: str,
    episode_raw: str,
    *,
    registry_path: Path,
    backup_directory: Path,
) -> str | None:
    """U1 (2026-08-27): Beim Export wird NUR ein schlanker Zaehler fortgeschrieben
    (registry["lastAssigned"][serie] = {"number", "at"}) -- KEIN voller Eintrag mit
    videoId, denn die videoId ist beim Bau des Thumbnails noch nicht bekannt und
    muesste spaeter muehsam nachgetragen werden. Die vollstaendige Zuordnung
    videoId->Nummer entsteht stattdessen im Wochenlauf (siehe --assign-episode
    in sync-livestream-archive.js), wo die videoId von Anfang an bekannt ist.

    V6 (2026-08-27): Der Zaehler wird PRO SERIE gefuehrt und die Serie kommt
    ausschliesslich aus dem Preset. Ein Standard-Export darf die Inner-Circle-
    Zaehlung nicht verschieben -- das faellt sonst erst auf einem gedruckten
    Thumbnail auf. Nach dem Schreiben wird aus der Datei zurueckgelesen und
    verifiziert, dass wirklich nur die erwartete Serie beruehrt wurde; schlaegt
    das fehl, wird das Backup zurueckgespielt.

    "Bereits vergeben" heisst hier: die Nummer ist <= dem hoeheren der beiden
    Werte max(entries[].number) und lastAssigned[serie].number DIESER Serie
    (beide koennen auseinanderlaufen, z.B. wenn der Wochenlauf zwischenzeitlich
    einen echten Eintrag hinzugefuegt hat) -- dann wird NICHTS ueberschrieben,
    nur gewarnt. Vor jedem Schreiben wird die Registry nach backups/ kopiert.
    Reine Funktion (kein self/HTTP) -- separat testbar.

    Gibt bei Erfolg (oder wenn das Preset keine Serie hat / keine Nummer im Feld
    steht) None zurueck, sonst einen Warntext fuer die UI.
    """
    series = series_for_preset(preset)
    if series is None:
        return None
    match = SERIES_NUMBER_PATTERN[series].search(episode_raw)
    if not match:
        return None
    number = int(match.group(1))

    try:
        raw = registry_path.read_text(encoding="utf-8")
        registry = json.loads(raw)
    except FileNotFoundError:
        registry = {name: [] for name in SERIES_NAMES}
    except (OSError, json.JSONDecodeError) as error:
        return f"Registry konnte nicht gelesen werden ({error}) -- lastAssigned wurde NICHT geaendert."
    if not isinstance(registry, dict):
        return "Registry hat ein unerwartetes Format -- lastAssigned wurde NICHT geaendert."

    floor_number = series_floor_number(registry, series)
    if number <= floor_number:
        return (
            f"#{number} ist in der Serie '{series}' bereits vergeben oder veraltet "
            f"(zuletzt: #{floor_number}) -- lastAssigned wurde NICHT geaendert."
        )

    before = copy.deepcopy(registry)
    registry["lastAssigned"] = normalized_last_assigned(registry)
    registry["lastAssigned"][series] = {
        "number": number,
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }

    # Selbstpruefung VOR dem Schreiben: eine falsche Serie darf gar nicht erst
    # auf die Platte kommen.
    violation = verify_only_series_touched(before, registry, series)
    if violation:
        return f"Abbruch der Selbstpruefung: {violation} -- es wurde NICHTS geschrieben."

    backup_path: Path | None = None
    try:
        backup_directory.mkdir(parents=True, exist_ok=True)
        if registry_path.exists():
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
            backup_path = backup_directory / f"series-registry-{stamp}.json"
            shutil.copy2(registry_path, backup_path)
    except OSError as error:
        return f"Backup der Registry fehlgeschlagen ({error}) -- lastAssigned wurde NICHT geaendert."

    try:
        registry_path.write_text(
            json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    except OSError as error:
        return f"Registry konnte nicht geschrieben werden ({error})."

    # Selbstpruefung NACH dem Schreiben, gegen den tatsaechlichen Dateiinhalt.
    try:
        written = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        written = None
        violation = f"Die geschriebene Registry ist nicht lesbar ({error})."
    else:
        violation = verify_only_series_touched(before, written, series)
    if violation:
        restored = "kein Backup vorhanden"
        if backup_path is not None:
            try:
                shutil.copy2(backup_path, registry_path)
                restored = f"Backup {backup_path.name} zurueckgespielt"
            except OSError as error:
                restored = f"Backup konnte NICHT zurueckgespielt werden ({error})"
        return f"Selbstpruefung nach dem Schreiben fehlgeschlagen: {violation} -- {restored}."
    return None


class ThumbnailHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    allow_reuse_port = False

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(
                socket.SOL_SOCKET,
                socket.SO_EXCLUSIVEADDRUSE,
                1,
            )
        super().server_bind()

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        *,
        session_token: str,
        source_directory: Path = SOURCE_DIRECTORY,
        export_directory: Path = EXPORT_DIRECTORY,
        html_file: Path = HTML_FILE,
        stability_delay: float = STABILITY_DELAY_SECONDS,
    ):
        super().__init__(server_address, handler_class)
        self.session_token = session_token
        self.source_directory = Path(source_directory)
        self.export_directory = Path(export_directory)
        self.html_file = Path(html_file)
        self.stability_delay = stability_delay


class ThumbnailRequestHandler(BaseHTTPRequestHandler):
    server: ThumbnailHTTPServer
    protocol_version = "HTTP/1.1"
    server_version = "DimensionWithinThumbnail/1.0"

    def log_message(self, format_string: str, *args: object) -> None:
        message = f"[{self.log_date_time_string()}] {format_string % args}"
        _console_print(message)

    def _host_is_valid(self) -> bool:
        expected = f"{HOST}:{self.server.server_port}"
        return self.headers.get("Host", "") == expected

    def _token_is_valid(self) -> bool:
        supplied = self.headers.get("X-Session-Token", "")
        return bool(supplied) and secrets.compare_digest(
            supplied, self.server.session_token
        )

    def _send_headers(
        self, status: HTTPStatus, content_type: str, length: int, **headers: str
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in headers.items():
            self.send_header(name.replace("_", "-"), value)
        self.end_headers()

    def _send_json(
        self, status: HTTPStatus, code: str, message: str, **extra: object
    ) -> None:
        self.close_connection = True
        payload = {"ok": False, "code": code, "message": message, **extra}
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_headers(
            status,
            "application/json; charset=utf-8",
            len(data),
            Connection="close",
        )
        self.wfile.write(data)

    def _reject_invalid_host(self) -> bool:
        if self._host_is_valid():
            return False
        self._send_json(
            HTTPStatus.MISDIRECTED_REQUEST,
            "invalid_host",
            "Der Host-Header ist für diesen lokalen Dienst nicht zulässig.",
        )
        return True

    def _reject_invalid_api_token(self) -> bool:
        if self._token_is_valid():
            return False
        self._send_json(
            HTTPStatus.UNAUTHORIZED,
            "invalid_token",
            "Der Sitzungstoken fehlt oder ist ungültig.",
        )
        return True

    def do_GET(self) -> None:
        if self._reject_invalid_host():
            return
        request = urlsplit(self.path)
        if request.path == "/api/health":
            if request.query:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    "unexpected_parameters",
                    "Der Health-Endpunkt akzeptiert keine Parameter.",
                )
                return
            self._serve_health()
            return
        if request.path == "/":
            self._serve_compositor(request.query)
            return
        if request.path == "/favicon.ico":
            self._send_headers(HTTPStatus.NO_CONTENT, "image/x-icon", 0)
            return
        if request.path == "/api/source/latest":
            if self._reject_invalid_api_token():
                return
            if request.query:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    "unexpected_parameters",
                    "Dieser Endpunkt akzeptiert keine Pfad- oder Dateiparameter.",
                )
                return
            self._serve_latest_source()
            return
        if request.path == "/api/series-registry":
            if self._reject_invalid_api_token():
                return
            if request.query:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    "unexpected_parameters",
                    "Dieser Endpunkt akzeptiert keine Parameter.",
                )
                return
            self._serve_series_registry()
            return
        if request.path == "/api/emblem":
            if self._reject_invalid_api_token():
                return
            self._serve_emblem(request.query)
            return
        self._send_json(HTTPStatus.NOT_FOUND, "not_found", "Endpunkt nicht gefunden.")

    def _serve_emblem(self, query: str) -> None:
        """Liest EINE Emblem-Variante read-only aus assets/branding/emblems/.

        Der einzige Parameter ist ein Slug, der gegen EMBLEM_SLUG_PATTERN geprueft
        wird -- keine Pfade, keine Endungen, keine Grossbuchstaben. Zusaetzlich
        wird der aufgeloeste Pfad gegen das Zielverzeichnis geprueft (Guertel und
        Hosentraeger): selbst wenn das Muster je aufgeweicht wuerde, kaeme so
        nichts ausserhalb des Ordners heraus.
        """
        values = parse_qs(query, keep_blank_values=True).get("slug", [])
        if len(values) != 1:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                "invalid_slug",
                "Es muss genau ein slug-Parameter angegeben werden.",
            )
            return
        slug = values[0]
        if not EMBLEM_SLUG_PATTERN.match(slug):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                "invalid_slug",
                "Der slug enthaelt unerlaubte Zeichen.",
            )
            return
        try:
            directory = EMBLEMS_DIRECTORY.resolve(strict=True)
            candidate = (directory / f"{slug}.png").resolve(strict=True)
        except OSError:
            self._send_json(
                HTTPStatus.NOT_FOUND, "emblem_missing", "Diese Emblem-Variante gibt es nicht."
            )
            return
        if candidate.parent != directory or not candidate.is_file():
            self._send_json(
                HTTPStatus.NOT_FOUND, "emblem_missing", "Diese Emblem-Variante gibt es nicht."
            )
            return
        try:
            data = candidate.read_bytes()
        except OSError:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "emblem_unreadable",
                "Die Emblem-Datei konnte nicht gelesen werden.",
            )
            return
        if len(data) > MAX_EMBLEM_BYTES:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "emblem_too_large",
                "Die Emblem-Datei ist unerwartet gross.",
            )
            return
        if data[:8] != bytes.fromhex("89504e470d0a1a0a"):   # PNG-Signatur
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "emblem_not_png",
                "Die Emblem-Datei ist kein PNG.",
            )
            return
        self._send_headers(HTTPStatus.OK, "image/png", len(data))
        self.wfile.write(data)

    def _serve_series_registry(self) -> None:
        """Liest data/series-registry.json read-only fuer die Nummern-Anzeige."""
        try:
            data = SERIES_REGISTRY_FILE.read_bytes()
        except FileNotFoundError:
            self._send_json(
                HTTPStatus.NOT_FOUND,
                "registry_missing",
                "data/series-registry.json wurde nicht gefunden.",
            )
            return
        except OSError:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "registry_unreadable",
                "Die Registry konnte nicht gelesen werden.",
            )
            return
        if len(data) > MAX_SERIES_REGISTRY_BYTES:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "registry_too_large",
                "Die Registry ist unerwartet gross.",
            )
            return
        self._send_headers(HTTPStatus.OK, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _serve_health(self) -> None:
        payload = json.dumps(
            {
                "service": SERVICE_ID,
                "protocol_version": SERVICE_PROTOCOL_VERSION,
                "ready": True,
            },
            separators=(",", ":"),
        ).encode("ascii")
        self._send_headers(
            HTTPStatus.OK,
            "application/json",
            len(payload),
        )
        self.wfile.write(payload)

    def do_POST(self) -> None:
        if self._reject_invalid_host():
            return
        request = urlsplit(self.path)
        if request.path == "/api/health":
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Der Health-Endpunkt ist ausschließlich read-only per GET.",
            )
            return
        if request.path == "/api/source/latest":
            if self._reject_invalid_api_token():
                return
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Der TradingView-Quellendpunkt ist ausschließlich read-only per GET.",
            )
            return
        if request.path == "/api/series-registry":
            if self._reject_invalid_api_token():
                return
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Die Registry-Anzeige ist ausschließlich read-only per GET. Ein Registry-Eintrag entsteht ausschliesslich als Nebeneffekt von /api/export.",
            )
            return
        if request.path == "/api/emblem":
            if self._reject_invalid_api_token():
                return
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Die Emblem-Route ist ausschließlich read-only per GET.",
            )
            return
        if request.path == "/api/export":
            if self._reject_invalid_api_token():
                return
            self._save_export()
            return
        self._send_json(HTTPStatus.NOT_FOUND, "not_found", "Endpunkt nicht gefunden.")

    def _serve_compositor(self, query: str) -> None:
        token_values = parse_qs(query, keep_blank_values=True).get("token", [])
        if (
            len(token_values) != 1
            or not secrets.compare_digest(token_values[0], self.server.session_token)
        ):
            self._send_json(
                HTTPStatus.UNAUTHORIZED,
                "invalid_token",
                "Der Compositor muss über das Startskript geöffnet werden.",
            )
            return
        try:
            data = self.server.html_file.read_bytes()
        except OSError:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "html_unavailable",
                "Die Compositor-Datei konnte nicht gelesen werden.",
            )
            return
        self._send_headers(
            HTTPStatus.OK,
            "text/html; charset=utf-8",
            len(data),
            Content_Security_Policy=(
                "default-src 'self' data: blob:; "
                "style-src 'self' 'unsafe-inline' data:; "
                "font-src data:; img-src 'self' data: blob:; "
                "script-src 'self' 'unsafe-inline'; connect-src 'self'"
            ),
        )
        self.wfile.write(data)

    def _serve_latest_source(self) -> None:
        try:
            image = select_latest_png(
                self.server.source_directory,
                stability_delay=self.server.stability_delay,
            )
        except SourceSelectionError as error:
            self._send_json(error.status, error.code, error.message)
            return
        except Exception as error:  # pragma: no cover - defensive HTTP boundary
            _console_print(f"Unerwarteter Quell-Lesefehler: {error!r}")
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "source_internal_error",
                "Beim Lesen des TradingView-Bildes ist ein interner Fehler aufgetreten.",
            )
            return

        encoded_name = quote(image.filename, safe="")
        self._send_headers(
            HTTPStatus.OK,
            image.content_type,
            len(image.data),
            X_Source_Filename=encoded_name,
            X_Source_Mtime_Ns=str(image.mtime_ns),
            X_Source_Size=str(image.size),
            X_Source_Identity=image.identity,
            Content_Disposition=f"inline; filename*=UTF-8''{encoded_name}",
        )
        self.wfile.write(image.data)

    def _save_export(self) -> None:
        content_type = self.headers.get("Content-Type", "").lower()
        extension = ".jpg" if content_type == "image/jpeg" else ".png"
        if content_type not in {"image/png", "image/jpeg"}:
            self._send_json(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "invalid_export_type",
                "Exportiert werden ausschließlich PNG und JPG.",
            )
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_EXPORT_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "invalid_export_size",
                "Die Exportgröße ist ungültig oder überschreitet das Limit.",
            )
            return

        encoded_filename = self.headers.get("X-Export-Filename", "")
        filename = unquote(encoded_filename)
        if (
            not filename
            or filename != Path(filename).name
            or Path(filename).suffix.lower() != extension
            or any(character in filename for character in "\0\r\n")
        ):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                "invalid_export_filename",
                "Der Exportdateiname ist ungültig.",
            )
            return
        if not self.server.export_directory.is_dir():
            self._send_json(
                HTTPStatus.NOT_FOUND,
                "export_directory_missing",
                "Der feste Exportordner ist nicht vorhanden.",
            )
            return

        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=".thumbnail-export-",
                suffix=".tmp",
                dir=self.server.export_directory,
                delete=False,
            ) as temporary:
                temp_path = Path(temporary.name)
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    temporary.write(chunk)
                    remaining -= len(chunk)
                if remaining:
                    raise EOFError("Der Export wurde nicht vollständig übertragen.")
                temporary.flush()
                os.fsync(temporary.fileno())
            actual_filename = commit_export_temp(
                temp_path,
                self.server.export_directory,
                filename,
                length,
            )
            temp_path = None
        except EOFError:
            if temp_path is not None:
                try:
                    temp_path.unlink()
                except OSError:
                    pass
                temp_path = None
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                "incomplete_export",
                "Der Export wurde nicht vollständig übertragen.",
            )
            return
        except OSError:
            if temp_path is not None:
                try:
                    temp_path.unlink()
                except OSError:
                    pass
                temp_path = None
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "export_write_error",
                "Der Export konnte nicht in den festen Ordner geschrieben werden.",
            )
            return
        finally:
            if temp_path is not None:
                try:
                    temp_path.unlink()
                except FileNotFoundError:
                    pass
                except OSError:
                    pass

        # T1: Registry-Schreib-Moment ist ausschliesslich der Export. Ein Fehler
        # hier darf den bereits erfolgreich gespeicherten Bild-Export NIE
        # ungeschehen machen -- daher separat abgefangen, nie erneut geworfen.
        registry_warning: str | None = None
        try:
            registry_warning = self._record_series_registry_export()
        except Exception as error:  # pragma: no cover - defensive, Export bleibt gueltig
            _console_print(f"Registry-Schreibversuch fehlgeschlagen (Export bleibt gueltig): {error!r}")
            registry_warning = "Die Folgennummer konnte nicht in die Registry geschrieben werden (siehe Server-Log)."

        result: dict[str, object] = {"ok": True, "filename": actual_filename, "size": length}
        if registry_warning:
            result["registry_warning"] = registry_warning
        payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self._send_headers(
            HTTPStatus.OK, "application/json; charset=utf-8", len(payload)
        )
        self.wfile.write(payload)

    def _record_series_registry_export(self) -> str | None:
        """U1: liest die Export-Header und delegiert an die reine (testbare)
        Funktion record_series_registry_export(). Nur ein duenner HTTP-Adapter."""
        preset = self.headers.get("X-Export-Preset", "")
        episode_raw = unquote(self.headers.get("X-Export-Episode", ""))
        return record_series_registry_export(
            preset, episode_raw,
            registry_path=SERIES_REGISTRY_FILE,
            backup_directory=SERIES_REGISTRY_BACKUP_DIRECTORY,
        )


def create_server(
    *,
    port: int = DEFAULT_PORT,
    session_token: str | None = None,
    source_directory: Path = SOURCE_DIRECTORY,
    export_directory: Path = EXPORT_DIRECTORY,
    html_file: Path = HTML_FILE,
    stability_delay: float = STABILITY_DELAY_SECONDS,
) -> ThumbnailHTTPServer:
    token = session_token or secrets.token_urlsafe(32)
    return ThumbnailHTTPServer(
        (HOST, port),
        ThumbnailRequestHandler,
        session_token=token,
        source_directory=source_directory,
        export_directory=export_directory,
        html_file=html_file,
        stability_delay=stability_delay,
    )


def resolve_directory(
    variable: str, override: Path | None, fallback: Path
) -> Path:
    """Löst ein Arbeitsverzeichnis auf: Argument vor Umgebung vor Fallback."""
    if override is not None:
        return Path(override).expanduser()
    configured = os.environ.get(variable, "").strip()
    if configured:
        return Path(configured).expanduser()
    return fallback


def run_server(
    port: int = DEFAULT_PORT,
    *,
    open_browser: bool = True,
    session_token: str | None = None,
    browser_opener: Callable[..., object] | None = None,
    browser_open_delay: float = BROWSER_OPEN_DELAY_SECONDS,
    source_directory: Path | None = None,
    export_directory: Path | None = None,
) -> int:
    instance_guard = SingleInstanceGuard(port)
    if not instance_guard.acquire():
        if not open_browser:
            _console_print("Der lokale Thumbnail-Dienst läuft bereits.")
            return 5
        if signal_running_instance(port):
            _console_print(
                "Der lokale Thumbnail-Dienst läuft bereits; "
                "der Compositor wird erneut geöffnet."
            )
            return 0
        _startup_error(
            "Eine laufende Thumbnail-Instanz konnte nicht sicher erreicht werden.\n\n"
            "Der lokale Port antwortet nicht mit der erwarteten Dienstidentität. "
            "Bitte den sichtbaren CMD-Launcher zur Diagnose verwenden."
        )
        return 6
    channel = BrowserOpenChannel(port)
    coordinator: BrowserOpenCoordinator | None = None
    try:
        try:
            channel.create()
            server = create_server(
                port=port,
                session_token=session_token,
                source_directory=resolve_directory(
                    SOURCE_DIRECTORY_ENV, source_directory, SOURCE_DIRECTORY
                ),
                export_directory=resolve_directory(
                    EXPORT_DIRECTORY_ENV, export_directory, EXPORT_DIRECTORY
                ),
            )
        except OSError as error:
            _startup_error(
                "Der lokale Thumbnail-Dienst konnte nicht gestartet werden.\n\n"
                f"Port {port} ist belegt oder nicht verfügbar: {error}"
            )
            return 4
        actual_port = server.server_port
        url = (
            f"http://{HOST}:{actual_port}/"
            f"?token={quote(server.session_token, safe='')}"
        )
        coordinator = BrowserOpenCoordinator(
            channel,
            url,
            browser_opener or webbrowser.open,
        )
        coordinator.start()
        _console_print("DimensionWithin Thumbnail-Compositor")
        _console_print(f"Lokaler Dienst: http://{HOST}:{actual_port}/")
        _console_print("Beenden mit Strg+C.")
        if open_browser:
            coordinator.schedule_initial_open(browser_open_delay)
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            _console_print("\nLokaler Dienst wird beendet.")
        finally:
            server.server_close()
        return 0
    finally:
        if coordinator is not None:
            coordinator.close()
        channel.close()
        instance_guard.release()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--session-token", help=argparse.SUPPRESS)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=None,
        help=(
            "Quellordner der Chart-Screenshots. Ohne Angabe gilt "
            f"{SOURCE_DIRECTORY_ENV}, sonst ./{SOURCE_DIRECTORY}."
        ),
    )
    parser.add_argument(
        "--export-dir",
        type=Path,
        default=None,
        help=(
            "Zielordner der fertigen Thumbnails. Ohne Angabe gilt "
            f"{EXPORT_DIRECTORY_ENV}, sonst ./{EXPORT_DIRECTORY}."
        ),
    )
    args = parser.parse_args()
    raise SystemExit(
        run_server(
            args.port,
            open_browser=not args.no_browser,
            session_token=args.session_token,
            source_directory=args.source_dir,
            export_directory=args.export_dir,
        )
    )


if __name__ == "__main__":
    main()
