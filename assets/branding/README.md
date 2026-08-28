# Branding-Assets

## aiv-emblem.png — das AIV-Emblem

Der rote Teufelskopf, wiederkehrendes Erkennungszeichen der Reihe
"AIV - Alles ist vorbestimmt". Quadratisch, PNG-32 mit echtem Alpha,
Kantenlaenge mindestens 512 px (besser 640 px).

**Diese Datei ist die Quelle der Wahrheit.** Der Compositor laedt sie NICHT
zur Laufzeit -- weder der lokale Dienst noch die Render-Harness liefern
statische Dateien aus (der Dienst kennt nur vier API-Routen, die Harness
laeuft ueber file:// mit hartem Offline-Routing und wuerde das Canvas
"tainten"). Stattdessen liegt das Bild als data:-URI in
thumbnail-compositor.html.

Nach jeder Aenderung an aiv-emblem.png neu einbetten:

    node scripts/embed-aiv-emblem.cjs

## _verworfen/

`aiv-mark-v1/v2/v3` (je .svg und .png) sind **verworfen** und duerfen NICHT
eingebunden werden. Es waren nachgebaute Annaeherungen; Kreuzschraffur und
Ausdruck der extern generierten Fassung (aiv-emblem.png) treffen die Anmutung
deutlich besser. Sie liegen nur noch zur Dokumentation hier.
