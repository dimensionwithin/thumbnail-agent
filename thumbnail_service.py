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
import subprocess
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
# CM1: Die .env liegt neben dem Skript und ist gitignored -- dort stehen die
# Ordnerpfade dieses Rechners. Bis hierher las nur der Node-Teil des Projekts
# diese Datei; der Dienst fiel deshalb still auf den RELATIVEN Fallback oben
# zurueck und suchte im Projektordner statt im TradingView-Ordner. Bewusst kein
# dotenv-Paket und bewusst kein Durchreichen nach os.environ: gelesen werden nur
# die beiden Ordnerschluessel, alles andere in der Datei (u.a. das OAuth-Secret)
# bleibt unberuehrt.
ENV_FILE = Path(__file__).with_name(".env")
DIRECTORY_ENV_KEYS = (SOURCE_DIRECTORY_ENV, EXPORT_DIRECTORY_ENV)
MAX_ENV_FILE_BYTES = 1 * 1024 * 1024
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
# 2 (2026-08-29): /api/emblem kam dazu. Die Version MUSS steigen, sobald sich das
# Routenangebot aendert -- sonst kann der Compositor einen noch laufenden Dienst
# aelterer Fassung nicht von einem passenden unterscheiden. Genau das ist einmal
# passiert: der Dienst lief weiter, lieferte die NEUE HTML (sie wird pro Anfrage
# von der Platte gelesen), kannte /api/emblem aber nicht -- alle Varianten kamen
# als 404 zurueck und der Compositor zeichnete stumm seinen Rueckfall.
# 3 (2026-08-29): /api/session/ping kam dazu.
SERVICE_PROTOCOL_VERSION = 3
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
    LABEL = "Browser-Signalkanal"

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
            raise OSError(f"Der {self.LABEL} ist bereits belegt.")
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


def _health_payload(port: int, timeout_seconds: float = 0.4) -> dict | None:
    """Rohe Health-Antwort. Wer den Port haelt, interessiert auch dann, wenn
    die Antwort NICHT unserer Erwartung entspricht (CQ4) -- deshalb getrennt
    von der Ja/Nein-Bewertung darunter."""

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
            return None
        if response.getheader("Cache-Control") != "no-store":
            return None
        payload = json.loads(data)
        return payload if isinstance(payload, dict) else None
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    finally:
        if connection is not None:
            connection.close()


def _health_is_expected(port: int, timeout_seconds: float = 0.4) -> bool:
    return _health_payload(port, timeout_seconds) == {
        "service": SERVICE_ID,
        "protocol_version": SERVICE_PROTOCOL_VERSION,
        "ready": True,
    }


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


# ---------------------------------------------------------------------------
# CQ1-CQ3: Der Dienst beendet sich, wenn niemand mehr zuschaut.
#
# Gemessen wird das ueber ein Lebenszeichen der Seite, NICHT ueber offene
# Verbindungen. Der Compositor rechnet fast alles im Canvas und kann minuten-
# lang keine einzige Anfrage stellen; eine Verbindungszaehlung faende dann 0
# offene Sockets und beendete den Dienst mitten in der Arbeit. Umgekehrt haelt
# der Browser Keep-Alive-Sockets nach dem Schliessen des Tabs noch eine Weile
# offen -- die Zaehlung waere also in BEIDE Richtungen falsch.
# ---------------------------------------------------------------------------

# 120 s: Ein Neuladen ist nach 1-2 s zurueck. Ein Tab im Hintergrund wird von
# Chrome auf einen Timer-Durchlauf pro Minute gedrosselt -- 120 s verkraftet
# also zwei ausgefallene gedrosselte Schlaege. Ein zu frueher Abbruch trifft
# mitten in der Arbeit; zwei Minuten Nachlauf kosten nichts, zumal ein
# uebriggebliebener Dienst seit CQ4 beim naechsten Start angeboten wird.
IDLE_TIMEOUT_SECONDS = 120.0
IDLE_POLL_SECONDS = 5.0
# Standby-Erkennung: time.monotonic() laeuft unter Windows ueber GetTickCount64
# und ZAEHLT SCHLAFZEIT MIT. Ohne diese Erkennung waere nach zwei Stunden
# Standby jede Karenzzeit ueberschritten und der Dienst beendete sich beim
# Aufwachen -- genau der Fall, der nicht passieren darf. Springt die Uhr
# zwischen zwei Runden weiter als Takt plus Toleranz, war die Maschine weg;
# dann bekommt die Seite die volle Karenzzeit neu.
SLEEP_JUMP_TOLERANCE_SECONDS = 10.0
MAX_TRACKED_SESSIONS = 32
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{8,64}$")
EXIT_WHEN_IDLE_ENV = "THUMBNAIL_EXIT_WHEN_IDLE"


class IdleShutdownGuard:
    """Beendet den Dienst nach einer Karenzzeit ohne Lebenszeichen.

    CS2 -- die Sicherung ist strukturell, nicht als Abfrage gebaut: Der
    Wachhund-Thread entsteht AUSSCHLIESSLICH in note_heartbeat(), also nur als
    Folge eines echten Lebenszeichens einer Seite. Es gibt keinen zweiten Pfad,
    der ihn starten koennte -- kein Konstruktor, kein start(), keine
    Schalterauswertung. Wer spaeter die Schalterlogik umbaut, kann daran
    nichts aendern, ohne note_heartbeat() selbst anzufassen: ein Dienst, bei
    dem sich nie eine Seite gemeldet hat (Batch-Render, Testlauf, Harness),
    hat schlicht keinen Thread, der ihn beenden koennte.

    Aus demselben Grund frischt note_activity() -- jede sonstige beglaubigte
    Anfrage -- die Frist nur auf und schaerft NIE. Sonst koennte ein Skript,
    das nur exportiert, die Selbstbeendigung ungewollt aktivieren.
    """

    def __init__(
        self,
        shutdown: Callable[[], object],
        *,
        enabled: bool = True,
        timeout: float = IDLE_TIMEOUT_SECONDS,
        poll_interval: float = IDLE_POLL_SECONDS,
        jump_tolerance: float = SLEEP_JUMP_TOLERANCE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        announce: Callable[[str], None] = _console_print,
    ):
        self._shutdown = shutdown
        self._enabled = enabled
        self._timeout = timeout
        self._poll_interval = poll_interval
        self._jump_tolerance = jump_tolerance
        self._clock = clock
        self._announce = announce
        self._lock = threading.Lock()
        self._sessions: dict[str, float] = {}
        self._last_activity: float | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    # -- Zustand ---------------------------------------------------------
    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def armed(self) -> bool:
        """Wacht bereits jemand? Nur wahr nach einem echten Lebenszeichen."""

        with self._lock:
            return self._thread is not None

    @property
    def session_count(self) -> int:
        with self._lock:
            return len(self._sessions)

    # -- Eingaenge -------------------------------------------------------
    def note_heartbeat(self, session_id: str) -> int:
        """Die einzige Stelle, an der der Wachhund entstehen kann."""

        if not self._enabled:
            return 0
        with self._lock:
            now = self._clock()
            # Laengst verstummte Sitzungen aus der Tabelle nehmen, damit die
            # zurueckgemeldete Zahl wirklich die offenen Seiten sind.
            for stale in [
                key
                for key, seen in self._sessions.items()
                if now - seen > self._timeout
            ]:
                del self._sessions[stale]
            if (
                session_id not in self._sessions
                and len(self._sessions) >= MAX_TRACKED_SESSIONS
            ):
                # Kein unbegrenztes Wachstum durch immer neue Kennungen: die
                # aelteste weicht. Fuer die Frist ist das folgenlos, sie
                # richtet sich ohnehin nach dem juengsten Lebenszeichen.
                oldest = min(self._sessions, key=self._sessions.__getitem__)
                del self._sessions[oldest]
            self._sessions[session_id] = now
            self._last_activity = now
            count = len(self._sessions)
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._watch,
                    name="thumbnail-idle-watchdog",
                    daemon=True,
                )
                self._thread.start()
                self._announce(
                    "Der Compositor ist offen; der Dienst beendet sich "
                    f"{int(self._timeout)} Sekunden nach dem letzten "
                    "Lebenszeichen."
                )
        return count

    def note_activity(self) -> None:
        """Frischt die Frist auf, schaerft aber nie (siehe Klassenkommentar)."""

        if not self._enabled:
            return
        with self._lock:
            self._last_activity = self._clock()

    def drop_session(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def close(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=max(0.5, self._poll_interval))

    # -- Wachhund --------------------------------------------------------
    def _newest_sign_of_life(self) -> float | None:
        signs = list(self._sessions.values())
        if self._last_activity is not None:
            signs.append(self._last_activity)
        return max(signs) if signs else None

    def expired(self, now: float) -> bool:
        with self._lock:
            newest = self._newest_sign_of_life()
            return newest is not None and (now - newest) > self._timeout

    def forgive(self, now: float) -> None:
        """Nach einem Zeitsprung: alle Fristen auf jetzt, volle Karenzzeit neu."""

        with self._lock:
            for session_id in self._sessions:
                self._sessions[session_id] = now
            if self._last_activity is not None:
                self._last_activity = now

    def tick(self, previous: float) -> tuple[float, bool]:
        """Eine Runde. Liefert (neuer Bezugspunkt, jetzt beenden?).

        Getrennt von der Schleife, damit der Zeitsprung ohne echtes Warten
        pruefbar ist: ein Aufruf mit einem weit zurueckliegenden Bezugspunkt
        ist genau das, was nach einem Standby passiert.
        """

        now = self._clock()
        if now - previous > self._poll_interval + self._jump_tolerance:
            self.forgive(now)
            self._announce(
                "Zeitsprung erkannt (vermutlich Standby); die Karenzzeit "
                "beginnt von vorn."
            )
            return now, False
        return now, self.expired(now)

    def _watch(self) -> None:
        previous = self._clock()
        while not self._stop_event.wait(self._poll_interval):
            previous, finished = self.tick(previous)
            if finished:
                self._announce(
                    "Seit "
                    f"{int(self._timeout)} Sekunden kein Lebenszeichen aus dem "
                    "Compositor; der lokale Dienst wird beendet."
                )
                self._shutdown()
                return


def exit_when_idle_default(open_browser: bool) -> bool:
    """Schalterebene 2 und 3 (CQ3).

    Ohne Browser -- also im Batch- und Testlauf -- ist die Selbstbeendigung
    aus. Ausdruecklich uebersteuerbar ueber die Umgebung; die Kommandozeile
    schlaegt beides und wird in main() ausgewertet.
    """

    configured = os.environ.get(EXIT_WHEN_IDLE_ENV, "").strip().lower()
    if configured in ("0", "false", "nein", "no", "off"):
        return False
    if configured in ("1", "true", "ja", "yes", "on"):
        return True
    return open_browser


# ---------------------------------------------------------------------------
# CQ4: Wer haelt den Port -- und darf er beendet werden?
#
# Bis hierher endete ein belegter Port bei einer zwar korrekten, aber taten-
# losen Meldung ("Dienstidentitaet passt nicht"). Sie sagte nicht, WAS den Port
# haelt und was zu tun ist. Der Block unten ermittelt den Besitzer, beschreibt
# ihn IMMER (auch wenn nichts angeboten wird, siehe CR1) und bietet das Beenden
# NUR an, wenn ein belastbarer Beleg den Prozess als unsere eigene Instanz
# ausweist. Im Zweifel wird verweigert.
# ---------------------------------------------------------------------------

SERVICE_FILE = Path(__file__).resolve()
PYTHON_IMAGE_NAMES = ("python.exe", "pythonw.exe")
WINDOWS_ERROR_INSUFFICIENT_BUFFER = 122
WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
WINDOWS_PROCESS_TERMINATE = 0x0001
WINDOWS_CREATE_NO_WINDOW = 0x08000000
WINDOWS_IDYES = 6
WINDOWS_MB_YESNO = 0x00000004
WINDOWS_MB_ICONWARNING = 0x00000030
WINDOWS_TCP_TABLE_OWNER_PID_LISTENER = 3
WINDOWS_AF_INET = 2
# Sanft vor hart (CR2): erst das Quit-Signal, und erst wenn die alte Instanz
# darauf nicht reagiert, TerminateProcess. Ein harter Abschuss mitten in einem
# Export kann eine reservierte Zieldatei zuruecklassen -- siehe
# _reserve_export_path(); der sanfte Weg laeuft durch server_close() und
# hinterlaesst nichts.
GRACEFUL_QUIT_TIMEOUT_SECONDS = 6.0
HARD_QUIT_TIMEOUT_SECONDS = 3.0
COMMAND_LINE_TIMEOUT_SECONDS = 8.0
# logs/ ist gitignored (siehe .gitignore) und liegt neben dem Skript.
MARKER_DIRECTORY = Path(__file__).with_name("logs")
MAX_MARKER_BYTES = 4096
def unknown_owner_hint(port: int) -> str:
    return (
        "Wer den Port haelt, liess sich nicht ermitteln. Deshalb wird hier "
        "nichts beendet. Bitte den sichtbaren CMD-Launcher zur Diagnose "
        "verwenden oder den Compositor auf einem anderen Port starten:\n"
        f"START-THUMBNAIL-COMPOSITOR.cmd --port {port + 1}"
    )


def foreign_owner_hint(port: int) -> str:
    return (
        "Dieser Prozess gehoert nicht zum Thumbnail-Compositor und wird "
        "deshalb nicht angeruehrt. Entweder den fremden Prozess selbst "
        "beenden oder den Compositor auf einem anderen Port starten:\n"
        f"START-THUMBNAIL-COMPOSITOR.cmd --port {port + 1}"
    )

MANUAL_STOP_HINT = (
    "Es wurde nichts beendet. Die alte Instanz laesst sich im Task-Manager "
    "unter dem oben genannten Prozess beenden; danach den Launcher erneut "
    "starten."
)


class QuitChannel(BrowserOpenChannel):
    """Benanntes Windows-Signal an die laufende Instanz: geordnet beenden.

    Bewusst derselbe Semaphor-Mechanismus wie beim Browser-Kanal: tokenfrei,
    nur lokal, und eine alte Fassung ohne diesen Kanal laesst sich schlicht
    nicht oeffnen -- signal() liefert dann False und der Aufrufer faellt auf
    den harten Weg zurueck.
    """

    MAX_PENDING_SIGNALS = 4
    LABEL = "Quit-Signalkanal"

    def __init__(self, port: int):
        super().__init__(port)
        self.name = (
            f"Local\\DimensionWithinThumbnailCompositor-Quit-{HOST}-{port}"
        )


class QuitSignalWatcher:
    """Wartet auf das Quit-Signal und faehrt den Server aus einem Fremdthread."""

    def __init__(self, channel: QuitChannel, shutdown: Callable[[], object]):
        self.channel = channel
        self.shutdown = shutdown
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        if os.name != "nt":
            return
        self.thread = threading.Thread(
            target=self._watch,
            name="thumbnail-quit-signal",
            daemon=True,
        )
        self.thread.start()

    def _watch(self) -> None:
        while not self.stop_event.is_set():
            try:
                if self.channel.wait(200):
                    if self.stop_event.is_set():
                        return
                    _console_print(
                        "\nEin neuer Start hat das Beenden angefordert; "
                        "der lokale Dienst wird beendet."
                    )
                    # serve_forever() laeuft im Hauptthread -- shutdown() MUSS
                    # aus einem anderen Thread kommen, sonst verklemmt es sich.
                    self.shutdown()
                    return
            except OSError as error:
                if not self.stop_event.is_set():
                    _console_print(f"Quit-Signalkanal fehlgeschlagen: {error!r}")
                return

    def close(self) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=0.5)


class _MIB_TCPROW_OWNER_PID(ctypes.Structure):
    _fields_ = [
        ("dwState", ctypes.c_ulong),
        ("dwLocalAddr", ctypes.c_ulong),
        ("dwLocalPort", ctypes.c_ulong),
        ("dwRemoteAddr", ctypes.c_ulong),
        ("dwRemotePort", ctypes.c_ulong),
        ("dwOwningPid", ctypes.c_ulong),
    ]


def _network_port_value(raw: int) -> int:
    """dwLocalPort haelt den Port in Netzwerk-Byte-Reihenfolge im unteren Wort."""

    return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)


def listening_pid(port: int, host: str = HOST) -> int | None:
    """PID des lauschenden Sockets auf host:port, sonst None.

    Bewusst GetExtendedTcpTable statt "netstat -ano": kein Unterprozess, keine
    sprachabhaengige Ausgabe, und dieselbe ctypes-Bauweise wie Mutex und
    Semaphor weiter oben.
    """

    if os.name != "nt":
        return None
    try:
        iphlpapi = ctypes.WinDLL("iphlpapi", use_last_error=True)
    except OSError:
        return None
    size = ctypes.c_ulong(0)
    result = iphlpapi.GetExtendedTcpTable(
        None,
        ctypes.byref(size),
        False,
        WINDOWS_AF_INET,
        WINDOWS_TCP_TABLE_OWNER_PID_LISTENER,
        0,
    )
    if result != WINDOWS_ERROR_INSUFFICIENT_BUFFER or size.value < 4:
        return None
    buffer = ctypes.create_string_buffer(size.value)
    result = iphlpapi.GetExtendedTcpTable(
        buffer,
        ctypes.byref(size),
        False,
        WINDOWS_AF_INET,
        WINDOWS_TCP_TABLE_OWNER_PID_LISTENER,
        0,
    )
    if result != 0:
        return None
    count = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ulong)).contents.value
    row_size = ctypes.sizeof(_MIB_TCPROW_OWNER_PID)
    if 4 + count * row_size > size.value:
        return None
    try:
        wanted = int.from_bytes(socket.inet_aton(host), "little")
        wildcard = int.from_bytes(socket.inet_aton("0.0.0.0"), "little")
    except OSError:
        return None
    for index in range(count):
        row = _MIB_TCPROW_OWNER_PID.from_buffer(buffer, 4 + index * row_size)
        if _network_port_value(row.dwLocalPort) != port:
            continue
        # Ein Lauscher auf 0.0.0.0 belegt 127.0.0.1 mit.
        if row.dwLocalAddr not in (wanted, wildcard):
            continue
        return int(row.dwOwningPid)
    return None


def _open_process(pid: int, access: int) -> int | None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [
        ctypes.c_ulong,
        ctypes.c_bool,
        ctypes.c_ulong,
    ]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    handle = kernel32.OpenProcess(access, False, pid)
    return handle or None


def _close_handle(handle: int) -> None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle(handle)


def _process_image_path(handle: int) -> str | None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.QueryFullProcessImageNameW.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_wchar_p,
        ctypes.POINTER(ctypes.c_ulong),
    ]
    length = ctypes.c_ulong(32768)
    buffer = ctypes.create_unicode_buffer(length.value)
    if not kernel32.QueryFullProcessImageNameW(
        handle, 0, buffer, ctypes.byref(length)
    ):
        return None
    return buffer.value or None


class _FILETIME(ctypes.Structure):
    _fields_ = [
        ("dwLowDateTime", ctypes.c_ulong),
        ("dwHighDateTime", ctypes.c_ulong),
    ]


def _process_creation_ticks(handle: int) -> int | None:
    """Erzeugungszeitpunkt in 100-ns-Ticks seit 1601 -- der Wert, an dem sich
    eine wiederverwendete PID von der urspruenglichen unterscheiden laesst."""

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetProcessTimes.argtypes = [ctypes.c_void_p] + [
        ctypes.POINTER(_FILETIME)
    ] * 4
    creation, exited, kernel_time, user_time = (_FILETIME() for _ in range(4))
    if not kernel32.GetProcessTimes(
        handle,
        ctypes.byref(creation),
        ctypes.byref(exited),
        ctypes.byref(kernel_time),
        ctypes.byref(user_time),
    ):
        return None
    ticks = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
    return ticks or None


def _ticks_to_local_time(ticks: int | None) -> datetime.datetime | None:
    if not ticks:
        return None
    epoch = datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
    try:
        return (epoch + datetime.timedelta(microseconds=ticks // 10)).astimezone()
    except (OverflowError, OSError, ValueError):
        return None


def _own_creation_ticks() -> int | None:
    if os.name != "nt":
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    return _process_creation_ticks(kernel32.GetCurrentProcess())


def instance_marker_path(port: int) -> Path:
    return MARKER_DIRECTORY / f"thumbnail-service-{port}.json"


def write_instance_marker(port: int) -> None:
    """Hinterlegt PID und Erzeugungszeitpunkt der eigenen Instanz.

    Das ist der Beleg, der ohne WMI auskommt: Diese Datei schreibt unser
    eigener Code in unser eigenes Verzeichnis. Wenn der Besitzer des Ports
    genau diese PID hat UND denselben Erzeugungszeitpunkt, ist es unsere
    Instanz -- eine wiederverwendete PID hat zwangslaeufig einen anderen.
    Ein Scheitern ist folgenlos: dann fehlt spaeter nur ein Beleg.
    """

    try:
        MARKER_DIRECTORY.mkdir(parents=True, exist_ok=True)
        instance_marker_path(port).write_text(
            json.dumps(
                {
                    "service": SERVICE_ID,
                    "port": port,
                    "pid": os.getpid(),
                    "creation_ticks": _own_creation_ticks(),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def remove_instance_marker(port: int) -> None:
    try:
        instance_marker_path(port).unlink(missing_ok=True)
    except OSError:
        pass


def read_instance_marker(port: int) -> dict | None:
    try:
        path = instance_marker_path(port)
        if path.stat().st_size > MAX_MARKER_BYTES:
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("service") != SERVICE_ID:
        return None
    return payload


def marker_matches_process(
    port: int, pid: int | None, creation_ticks: int | None
) -> bool:
    """Nur mit uebereinstimmender PID UND Erzeugungszeit -- sonst koennte eine
    liegengebliebene Markerdatei auf einen voellig fremden Prozess zeigen,
    der die PID inzwischen wiederverwendet."""

    if pid is None:
        return False
    marker = read_instance_marker(port)
    if marker is None or marker.get("pid") != pid:
        return False
    recorded = marker.get("creation_ticks")
    if not isinstance(recorded, int) or creation_ticks is None:
        return False
    return recorded == creation_ticks


def _process_command_line(pid: int) -> str | None:
    """Kommandozeile eines fremden Prozesses -- der entscheidende Beleg.

    Ueber CIM statt ueber das PEB des Fremdprozesses: PEB-Lesen ist bei
    gemischter Bitbreite unzuverlaessig, und ein Fehlgriff wuerde hier die
    Frage "darf beendet werden?" falsch beantworten.
    """

    if os.name != "nt":
        return None
    query = (
        "(Get-CimInstance Win32_Process -Filter "
        + '"ProcessId='
        + str(int(pid))
        + '").CommandLine'
    )
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                query,
            ],
            capture_output=True,
            timeout=COMMAND_LINE_TIMEOUT_SECONDS,
            creationflags=WINDOWS_CREATE_NO_WINDOW,
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    # Bewusst selbst dekodiert: text=True nimmt die ANSI-Codepage und wirft bei
    # jedem Pfad mit Sonderzeichen einen UnicodeDecodeError -- im Lesethread,
    # also mit Traceback vor den Augen des Anwenders.
    command_line = (completed.stdout or b"").decode("utf-8", "replace").strip()
    return command_line or None


def command_line_names_this_service(command_line: str | None) -> bool:
    """Nennt diese Kommandozeile UNSER Dienstskript -- und kein gleichnamiges?"""

    if not command_line:
        return False
    lowered = command_line.lower()
    if SERVICE_FILE.name.lower() not in lowered:
        return False
    if str(SERVICE_FILE).lower() in lowered:
        return True
    # Ein absoluter Pfad auf ein gleichnamiges Skript woanders ist NICHT unser
    # Dienst -- im Zweifel verweigern (CR1). Nur der Aufruf ohne Pfadangabe
    # zaehlt; so startet der CMD-Launcher, mit gesetztem Arbeitsverzeichnis.
    foreign = re.search(
        r"[a-z]:[\\/][^\"']*" + re.escape(SERVICE_FILE.name.lower()), lowered
    )
    return foreign is None


@dataclass(frozen=True)
class PortOccupant:
    """Was ueber den Besitzer des Ports bekannt ist -- Belege getrennt gefuehrt."""

    port: int
    pid: int | None = None
    image_path: str | None = None
    image_name: str | None = None
    started_at: datetime.datetime | None = None
    command_line: str | None = None
    health_service: str | None = None
    health_protocol: int | None = None
    identified_by_health: bool = False
    identified_by_command_line: bool = False
    identified_by_marker: bool = False

    @property
    def may_be_stopped(self) -> bool:
        """Angeboten wird nur mit PID UND mindestens einem positiven Beleg."""

        if self.pid is None:
            return False
        return (
            self.identified_by_health
            or self.identified_by_command_line
            or self.identified_by_marker
        )


def inspect_port_occupant(
    port: int,
    *,
    health_payload: Callable[[int, float], dict | None] | None = None,
    pid_lookup: Callable[[int], int | None] | None = None,
    command_line_lookup: Callable[[int], str | None] | None = None,
    marker_check: Callable[[int, int | None, int | None], bool] | None = None,
) -> PortOccupant:
    payload = (health_payload or _health_payload)(port, 0.4)
    health_service = None
    health_protocol = None
    if isinstance(payload, dict):
        service = payload.get("service")
        if isinstance(service, str):
            health_service = service
        protocol = payload.get("protocol_version")
        if isinstance(protocol, int):
            health_protocol = protocol
    pid = (pid_lookup or listening_pid)(port)
    image_path = None
    image_name = None
    creation_ticks = None
    if pid is not None:
        handle = _open_process(pid, WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION)
        if handle is not None:
            try:
                image_path = _process_image_path(handle)
                creation_ticks = _process_creation_ticks(handle)
            finally:
                _close_handle(handle)
        if image_path:
            image_name = Path(image_path).name
    started_at = _ticks_to_local_time(creation_ticks)
    identified_by_marker = (marker_check or marker_matches_process)(
        port, pid, creation_ticks
    )
    identified_by_health = health_service == SERVICE_ID
    command_line = None
    identified_by_command_line = False
    # Die teure CIM-Abfrage nur, wenn sie ueberhaupt etwas entscheiden kann:
    # bei einem Prozess, der kein Python ist, waere die Antwort ohne Belang.
    if (
        pid is not None
        and image_name is not None
        and image_name.lower() in PYTHON_IMAGE_NAMES
    ):
        command_line = (command_line_lookup or _process_command_line)(pid)
        identified_by_command_line = command_line_names_this_service(command_line)
    return PortOccupant(
        port=port,
        pid=pid,
        image_path=image_path,
        image_name=image_name,
        started_at=started_at,
        command_line=command_line,
        health_service=health_service,
        health_protocol=health_protocol,
        identified_by_health=identified_by_health,
        identified_by_command_line=identified_by_command_line,
        identified_by_marker=identified_by_marker,
    )


def describe_port_occupant(occupant: PortOccupant) -> str:
    """Sagt IMMER, was den Port haelt -- auch wenn nichts angeboten wird (CR1)."""

    lines = [f"Port {occupant.port} ist bereits belegt.", ""]
    if occupant.pid is None:
        lines.append("Der belegende Prozess liess sich nicht ermitteln.")
    else:
        lines.append(
            f"Prozess: {occupant.image_name or 'unbekannt'} (PID {occupant.pid})"
        )
        if occupant.image_path:
            lines.append(f"Programmdatei: {occupant.image_path}")
        if occupant.started_at is not None:
            lines.append(
                "Gestartet: " + occupant.started_at.strftime("%d.%m.%Y %H:%M:%S")
            )
        if occupant.command_line:
            lines.append(f"Aufruf: {occupant.command_line}")
    lines.append("")
    if occupant.identified_by_health:
        version = (
            str(occupant.health_protocol)
            if occupant.health_protocol is not None
            else "unbekannt"
        )
        lines.append(
            "Der Port antwortet mit der Kennung des Thumbnail-Compositors "
            f"(Protokoll {version})."
        )
    elif occupant.health_service:
        lines.append(
            "Der Port antwortet mit einer fremden Dienstkennung: "
            f"{occupant.health_service}."
        )
    else:
        lines.append(
            "Der Port antwortet nicht mit einer erkennbaren Dienstkennung."
        )
    if occupant.identified_by_command_line:
        lines.append("Der Aufruf nennt dieses Dienstskript.")
    if occupant.identified_by_marker:
        lines.append(
            "Dieser Prozess hat sich beim Start als Thumbnail-Dienst "
            f"eingetragen ({instance_marker_path(occupant.port).name})."
        )
    return "\n".join(lines)


def _ask_to_stop(description: str) -> bool:
    question = (
        description
        + "\n\nDie laufende Instanz beenden und den Compositor neu starten?"
    )
    if sys.stdout is not None:
        _console_print(question)
        try:
            if sys.stdin is None or not sys.stdin.isatty():
                return False
            answer = input("Beenden und neu starten? [j/N] ").strip().lower()
        except (EOFError, OSError, ValueError):
            return False
        return answer in ("j", "ja", "y", "yes")
    if os.name != "nt":
        return False
    try:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        return (
            user32.MessageBoxW(
                None,
                question,
                "DimensionWithin Thumbnail-Compositor",
                WINDOWS_MB_YESNO | WINDOWS_MB_ICONWARNING,
            )
            == WINDOWS_IDYES
        )
    except (AttributeError, OSError):
        return False


def _terminate_process(pid: int) -> bool:
    if os.name != "nt":
        return False
    handle = _open_process(pid, WINDOWS_PROCESS_TERMINATE)
    if handle is None:
        return False
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
        return bool(kernel32.TerminateProcess(handle, 1))
    finally:
        _close_handle(handle)


def stop_running_instance(
    occupant: PortOccupant,
    is_free: Callable[[], bool],
    *,
    graceful_timeout: float = GRACEFUL_QUIT_TIMEOUT_SECONDS,
    hard_timeout: float = HARD_QUIT_TIMEOUT_SECONDS,
    sleep_func: Callable[[float], None] = time.sleep,
    terminate: Callable[[int], bool] = _terminate_process,
    signal_quit: Callable[[int], bool] = QuitChannel.signal,
) -> tuple[bool, str]:
    """Sanft vor hart (CR2). Liefert (frei geworden, Beschreibung des Wegs)."""

    def wait_until(timeout: float) -> bool:
        deadline = time.monotonic() + max(0.0, timeout)
        while True:
            if is_free():
                return True
            if time.monotonic() >= deadline:
                return False
            sleep_func(0.1)

    signal_quit(occupant.port)
    if wait_until(graceful_timeout):
        return True, "Die alte Instanz hat sich geordnet beendet."
    if occupant.pid is None:
        return False, "Die alte Instanz reagiert nicht und hat keine bekannte PID."
    if not terminate(occupant.pid):
        return (
            False,
            f"Die alte Instanz (PID {occupant.pid}) liess sich nicht beenden.",
        )
    if wait_until(hard_timeout):
        return (
            True,
            "Die alte Instanz reagierte nicht auf das Beenden-Signal und wurde "
            "hart beendet. Falls dabei gerade ein Export lief, kann im "
            "Exportordner eine leere Platzhalterdatei zurueckgeblieben sein.",
        )
    return False, "Der Port ist auch nach dem Beenden noch belegt."


def resolve_port_conflict(
    port: int,
    is_free: Callable[[], bool],
    *,
    may_prompt: bool,
    force: bool,
    inspect: Callable[[int], PortOccupant] = inspect_port_occupant,
    ask: Callable[[str], bool] = _ask_to_stop,
    stop: Callable[..., tuple[bool, str]] = stop_running_instance,
) -> bool:
    """Diagnose, Angebot, Ausfuehrung. False heisst: der Port bleibt belegt."""

    occupant = inspect(port)
    description = describe_port_occupant(occupant)
    if not occupant.may_be_stopped:
        hint = (
            unknown_owner_hint(port)
            if occupant.pid is None
            else foreign_owner_hint(port)
        )
        _startup_error(description + "\n\n" + hint)
        return False
    if force:
        _console_print(description)
    elif not may_prompt:
        _startup_error(description + "\n\n" + MANUAL_STOP_HINT)
        return False
    elif not ask(description):
        # Die Frage hat die Beschreibung bereits gezeigt -- hier nur noch der
        # Hinweis, sonst steht alles zweimal auf der Konsole.
        _startup_error(MANUAL_STOP_HINT)
        return False
    freed, detail = stop(occupant, is_free)
    if not freed:
        _startup_error(detail + "\n\n" + MANUAL_STOP_HINT)
        return False
    _console_print(detail)
    return True


def port_is_free(port: int, host: str = HOST) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


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
        idle_guard: "IdleShutdownGuard | None" = None,
    ):
        super().__init__(server_address, handler_class)
        # Ohne Waechter (Testaufbauten, die create_server direkt benutzen)
        # verhaelt sich der Dienst wie bisher: er laeuft, bis er beendet wird.
        self.idle_guard = idle_guard
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
            # Wer exportiert, schaut zu. Das FRISCHT die Frist nur auf und
            # schaerft den Waechter nicht -- schaerfen kann nur ein echtes
            # Lebenszeichen der Seite (siehe IdleShutdownGuard).
            if self.server.idle_guard is not None:
                self.server.idle_guard.note_activity()
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
        if request.path == "/api/session/ping":
            if self._reject_invalid_api_token():
                return
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Das Lebenszeichen wird ausschließlich per POST gemeldet.",
            )
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
        if request.path == "/api/session/ping":
            if self._reject_invalid_api_token():
                return
            self._note_heartbeat()
            return
        if request.path == "/api/export":
            if self._reject_invalid_api_token():
                return
            self._save_export()
            return
        self._send_json(HTTPStatus.NOT_FOUND, "not_found", "Endpunkt nicht gefunden.")

    def _note_heartbeat(self) -> None:
        """Lebenszeichen einer offenen Compositor-Seite.

        Die Sitzungskennung kommt als Kopfzeile, nicht im Rumpf: die Anfrage
        traegt keinen Inhalt, und ein enges Muster laesst sich hier in einer
        Zeile pruefen.
        """

        session_id = self.headers.get("X-Session-Id", "")
        if not SESSION_ID_PATTERN.match(session_id):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                "invalid_session_id",
                "Die Sitzungskennung fehlt oder ist ungültig.",
            )
            return
        guard = self.server.idle_guard
        sessions = guard.note_heartbeat(session_id) if guard is not None else 0
        payload = json.dumps(
            {
                "ok": True,
                "sessions": sessions,
                "idle_timeout_seconds": (
                    int(IDLE_TIMEOUT_SECONDS)
                    if guard is not None and guard.enabled
                    else None
                ),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self._send_headers(
            HTTPStatus.OK, "application/json; charset=utf-8", len(payload)
        )
        self.wfile.write(payload)

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
    idle_guard: IdleShutdownGuard | None = None,
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
        idle_guard=idle_guard,
    )


def read_env_file(path: Path = ENV_FILE) -> dict[str, str]:
    """Liest NUR die Ordnerschlüssel aus einer KEY=VALUE-Datei.

    Absichtlich anspruchslos: keine Interpolation, keine ``export``-Praefixe,
    keine mehrzeiligen Werte. Umgebende Anfuehrungszeichen werden entfernt,
    damit ein Windows-Pfad mit Leerzeichen zitiert werden kann. Fehlt die Datei
    oder ist sie unlesbar, ist das kein Fehler -- dann gelten Umgebung und
    Fallback wie bisher.
    """
    try:
        if path.stat().st_size > MAX_ENV_FILE_BYTES:
            return {}
        raw = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return {}

    values: dict[str, str] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if key not in DIRECTORY_ENV_KEYS:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        value = value.strip()
        if value:
            values[key] = value
    return values


def resolve_directory(
    variable: str,
    override: Path | None,
    fallback: Path,
    env_file_values: dict[str, str] | None = None,
) -> Path:
    """Löst ein Arbeitsverzeichnis auf: Argument vor Umgebung vor .env vor Fallback.

    Die echte Prozessumgebung schlaegt die Datei, damit ein einmaliges
    ``set THUMBNAIL_SOURCE_DIR=...`` zum Testen weiterhin greift.
    """
    if override is not None:
        return Path(override).expanduser()
    configured = os.environ.get(variable, "").strip()
    if configured:
        return Path(configured).expanduser()
    from_file = (env_file_values or {}).get(variable, "").strip()
    if from_file:
        return Path(from_file).expanduser()
    return fallback


def describe_directory(label: str, directory: Path) -> str:
    """Eine Konsolenzeile: aufgeloester ABSOLUTER Pfad plus Existenzbefund.

    CM1: Zweimal ist uns entgangen, dass der Dienst anderswo suchte als
    erwartet. Der konfigurierte Wert allein sagt das nicht -- ein relativer
    Pfad sieht harmlos aus und zeigt trotzdem in den Projektordner. Darum
    hier immer absolut und immer mit Existenzbefund.
    """
    try:
        absolute = Path(directory).resolve()
    except OSError:
        absolute = Path(directory).absolute()
    if not absolute.exists():
        state = "FEHLT"
    elif not absolute.is_dir():
        state = "IST KEIN ORDNER"
    else:
        state = "ok"
    return f"{label}: {absolute}  [{state}]"


def run_server(
    port: int = DEFAULT_PORT,
    *,
    open_browser: bool = True,
    session_token: str | None = None,
    browser_opener: Callable[..., object] | None = None,
    browser_open_delay: float = BROWSER_OPEN_DELAY_SECONDS,
    source_directory: Path | None = None,
    export_directory: Path | None = None,
    restart_prompt: bool = True,
    force_restart: bool = False,
    exit_when_idle: bool | None = None,
) -> int:
    instance_guard = SingleInstanceGuard(port)
    if not instance_guard.acquire():
        # Passt die Identität, ist das kein Konflikt, sondern ein zweiter
        # Aufruf: die laufende Instanz öffnet nur ein Fenster nach.
        if open_browser and signal_running_instance(port):
            _console_print(
                "Der lokale Thumbnail-Dienst läuft bereits; "
                "der Compositor wird erneut geöffnet."
            )
            return 0
        if not open_browser and _health_is_expected(port):
            _console_print("Der lokale Thumbnail-Dienst läuft bereits.")
            return 5
        # CQ4: Ab hier steht wirklich etwas im Weg. Bis hierher endete das in
        # einer korrekten, aber tatenlosen Meldung ("Dienstidentität passt
        # nicht"). Jetzt wird gesagt, WAS den Port hält -- und wenn es belegbar
        # unsere eigene Instanz ist, wird das Aufräumen angeboten.
        if not resolve_port_conflict(
            port,
            instance_guard.acquire,
            may_prompt=restart_prompt and open_browser,
            force=force_restart,
        ):
            return 5 if not open_browser else 6
    channel = BrowserOpenChannel(port)
    quit_channel = QuitChannel(port)
    coordinator: BrowserOpenCoordinator | None = None
    quit_watcher: QuitSignalWatcher | None = None
    marker_written = False
    server: ThumbnailHTTPServer | None = None
    # Schalterebene 3 (Kommandozeile) schlaegt Ebene 2 (--no-browser bzw. die
    # Umgebungsvariable). Ebene 1 -- der Waechter schaerft erst mit dem ersten
    # Lebenszeichen -- steckt in IdleShutdownGuard selbst und laesst sich von
    # hier aus gar nicht umgehen.
    idle_guard = IdleShutdownGuard(
        lambda: server.shutdown() if server is not None else None,
        enabled=(
            exit_when_idle
            if exit_when_idle is not None
            else exit_when_idle_default(open_browser)
        ),
    )
    try:
        env_file_values = read_env_file()
        resolved_source = resolve_directory(
            SOURCE_DIRECTORY_ENV,
            source_directory,
            SOURCE_DIRECTORY,
            env_file_values,
        )
        resolved_export = resolve_directory(
            EXPORT_DIRECTORY_ENV,
            export_directory,
            EXPORT_DIRECTORY,
            env_file_values,
        )
        # Zwei Anläufe: Der Mutex kann frei sein, während der Port noch von
        # einer verwaisten Instanz gehalten wird. Auch dieser Fall bekommt die
        # Diagnose aus CQ4, danach genau ein Wiederholungsversuch.
        for attempt in (1, 2):
            try:
                channel.create()
                quit_channel.create()
                server = create_server(
                    port=port,
                    session_token=session_token,
                    source_directory=resolved_source,
                    export_directory=resolved_export,
                    idle_guard=idle_guard,
                )
                break
            except OSError as error:
                channel.close()
                quit_channel.close()
                if attempt == 2 or not resolve_port_conflict(
                    port,
                    lambda: port_is_free(port),
                    may_prompt=restart_prompt and open_browser,
                    force=force_restart,
                ):
                    if attempt == 2:
                        _startup_error(
                            "Der lokale Thumbnail-Dienst konnte nicht gestartet "
                            f"werden.\n\nPort {port} ist belegt oder nicht "
                            f"verfügbar: {error}"
                        )
                    return 4
        if server is None:
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
        quit_watcher = QuitSignalWatcher(quit_channel, lambda: server.shutdown())
        quit_watcher.start()
        write_instance_marker(port)
        marker_written = True
        _console_print("DimensionWithin Thumbnail-Compositor")
        _console_print(f"Lokaler Dienst: http://{HOST}:{actual_port}/")
        _console_print(describe_directory("Quellordner", resolved_source))
        _console_print(describe_directory("Exportordner", resolved_export))
        _console_print(
            "Selbstbeendigung: "
            + (
                f"aktiv, {int(IDLE_TIMEOUT_SECONDS)} s nach dem letzten "
                "Lebenszeichen des Compositors"
                if idle_guard.enabled
                else "aus"
            )
        )
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
        idle_guard.close()
        if marker_written:
            remove_instance_marker(port)
        if coordinator is not None:
            coordinator.close()
        if quit_watcher is not None:
            quit_watcher.close()
        channel.close()
        quit_channel.close()
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
    parser.add_argument(
        "--force-restart",
        action="store_true",
        help=(
            "Eine belegbar eigene, bereits laufende Instanz ohne Rueckfrage "
            "beenden und neu starten."
        ),
    )
    parser.add_argument(
        "--exit-when-idle",
        action=argparse.BooleanOptionalAction,
        default=None,
        help=(
            "Beendet den Dienst nach "
            f"{int(IDLE_TIMEOUT_SECONDS)} s ohne Lebenszeichen des "
            "Compositors. Ohne Angabe an, wenn ein Browser geoeffnet wird, "
            f"sonst aus; {EXIT_WHEN_IDLE_ENV} uebersteuert das."
        ),
    )
    parser.add_argument(
        "--no-restart-prompt",
        action="store_true",
        help=(
            "Bei belegtem Port nur melden, wer ihn haelt, und nichts anbieten."
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
            restart_prompt=not args.no_restart_prompt,
            force_restart=args.force_restart,
            exit_when_idle=args.exit_when_idle,
        )
    )


if __name__ == "__main__":
    main()
