# Phase 4: GIF / animated WebP verification

2026-10-24T07:46:51.953Z · 28 synthetic + 3 real + 14 corpus files · leak cycles 50

## Browser support

| browser | ImageDecoder (gif / webp) | self-tests: GIF disposal / WebP alpha | createImageBitmap(WebP) | path for GIF | path for animated WebP | still / 1-frame |
|---|---|---|---|---|---|---|
| chromium 156.0.8078.4 | yes / yes | pass / pass | yes | imagedecoder | imagedecoder | still / still |
| webkit 27.2 | yes / yes | **FAIL** / **FAIL** | yes | gif-fallback | webp-anmf | still / still |
| firefox | **could not be launched here**: browserType.launch: Failed to launch the browser process. | | | | | |

## Fallback diff table: chromium 156.0.8078.4

Every frame, decoded three ways and compared with the reference (Δ = largest premultiplied channel difference, 0-255). `auto` is what applications get; `fallback` is our own decoder; `imagedecoder` is the browser's WebCodecs path.

| file | frames | auto path | auto | imagedecoder | fallback |
|---|---|---|---|---|---|
| s/gif-delays.gif | 7 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-disposal-1.gif | 4 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-disposal-2.gif | 4 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-disposal-3.gif | 5 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-first-disposal3.gif | 2 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-interlaced.gif | 2 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-0.gif | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-1.gif | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-3.gif | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-none.gif | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-mixed.gif | 8 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-single.gif | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-transparency.gif | 4 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/selftest-gif-dispose.gif | 2 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/selftest-webp-alpha.webp | 2 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-alpha-blend.webp | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ2) |
| s/webp-alpha-noblend.webp | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.33) |
| s/webp-delays.webp | 6 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-dispose-bg.webp | 4 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.2) |
| s/webp-loop-0.webp | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-loop-1.webp | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-loop-3.webp | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-mixed-codecs.webp | 5 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1) |
| s/webp-offsets.webp | 4 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1) |
| s/webp-single.webp | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-static-alpha.webp | 1 | still | ok (Δ1) | ok (Δ0) | ok (Δ1) |
| s/webp-static-lossless.webp | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-static-lossy.webp | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| rotating-earth.gif | 44 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| animated.webp | 100 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| static.webp | 1 | still | ok (Δ2) | known (3/3 Δ37) | ok (Δ2) |
| c/03-32-04-108_512.webp | 8 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/10014_android_1519293401_middle.webp | 40 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10017_android_1519292856_middle.webp | 30 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10019_android_1519291993_middle.webp | 40 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10020_android_1517469251_middle.webp | 40 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10021_android_1521634082_middle.webp | 40 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10022_android_1531282915_middle.webp | 40 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10023_android_1532053954_middle.webp | 30 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/10024_android_1540180149_middle.webp | 40 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ1.99) |
| c/1648542956622cry-tear.gif | 26 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/1648542972231emoji-in-love.gif | 28 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/1648543432503love-you.gif | 28 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/1694587935069love-nikki-miracle-nikki.gif | 10 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/20-58-58-760_512.webp | 3 | imagedecoder | ok (Δ0) | ok (Δ0) | ok (Δ0) |

## Fallback diff table: webkit 27.2

Every frame, decoded three ways and compared with the reference (Δ = largest premultiplied channel difference, 0-255). `auto` is what applications get; `fallback` is our own decoder; `imagedecoder` is the browser's WebCodecs path.

| file | frames | auto path | auto | imagedecoder | fallback |
|---|---|---|---|---|---|
| s/gif-delays.gif | 7 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-disposal-1.gif | 4 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-disposal-2.gif | 4 | gif-fallback | ok (Δ0) | known (7/10 Δ255) | ok (Δ0) |
| s/gif-disposal-3.gif | 5 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-first-disposal3.gif | 2 | gif-fallback | ok (Δ0) | known (5/5 Δ255) | ok (Δ0) |
| s/gif-interlaced.gif | 2 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-0.gif | 3 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-1.gif | 3 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-3.gif | 3 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-loop-none.gif | 3 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-mixed.gif | 8 | gif-fallback | ok (Δ0) | known (11/18 Δ255) | ok (Δ0) |
| s/gif-single.gif | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/gif-transparency.gif | 4 | gif-fallback | ok (Δ0) | known (10/10 Δ255) | ok (Δ0) |
| s/selftest-gif-dispose.gif | 2 | gif-fallback | ok (Δ0) | known (2/5 Δ255) | ok (Δ0) |
| s/selftest-webp-alpha.webp | 2 | webp-anmf | ok (Δ0) | known (2/5 Δ127) | ok (Δ0) |
| s/webp-alpha-blend.webp | 3 | webp-anmf | ok (Δ2) | ok (Δ0) | ok (Δ2) |
| s/webp-alpha-noblend.webp | 3 | webp-anmf | ok (Δ0.8) | known (4/7 Δ153) | ok (Δ0.8) |
| s/webp-delays.webp | 6 | webp-anmf | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-dispose-bg.webp | 4 | webp-anmf | ok (Δ2) | known (5/10 Δ255) | ok (Δ2) |
| s/webp-loop-0.webp | 3 | webp-anmf | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-loop-1.webp | 3 | webp-anmf | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-loop-3.webp | 3 | webp-anmf | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-mixed-codecs.webp | 5 | webp-anmf | ok (Δ1) | known (4/12 Δ255) | ok (Δ1) |
| s/webp-offsets.webp | 4 | webp-anmf | ok (Δ1) | ok (Δ0) | ok (Δ1) |
| s/webp-single.webp | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-static-alpha.webp | 1 | still | ok (Δ0) | known (3/3 Δ127.06) | ok (Δ0) |
| s/webp-static-lossless.webp | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| s/webp-static-lossy.webp | 1 | still | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| rotating-earth.gif | 44 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| animated.webp | 100 | webp-anmf | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| static.webp | 1 | still | ok (Δ2) | ok (Δ2) | ok (Δ2) |
| c/03-32-04-108_512.webp | 8 | webp-anmf | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/10014_android_1519293401_middle.webp | 40 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/10017_android_1519292856_middle.webp | 30 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/10019_android_1519291993_middle.webp | 40 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/10020_android_1517469251_middle.webp | 40 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/10021_android_1521634082_middle.webp | 40 | webp-anmf | ok (Δ0.98) | known (15/15 Δ255) | ok (Δ0.98) |
| c/10022_android_1531282915_middle.webp | 40 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/10023_android_1532053954_middle.webp | 30 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/10024_android_1540180149_middle.webp | 40 | webp-anmf | ok (Δ0.99) | known (15/15 Δ255) | ok (Δ0.99) |
| c/1648542956622cry-tear.gif | 26 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/1648542972231emoji-in-love.gif | 28 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/1648543432503love-you.gif | 28 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/1694587935069love-nikki-miracle-nikki.gif | 10 | gif-fallback | ok (Δ0) | ok (Δ0) | ok (Δ0) |
| c/20-58-58-760_512.webp | 3 | webp-anmf | ok (Δ0) | known (7/7 Δ255) | ok (Δ0) |

## Timing: on-screen frame times vs. the file's delays

Each emitted frame is compared with its scheduled start (cumulative delays). A requestAnimationFrame callback can only run on a ~16.7 ms tick, so ~17 ms is the floor. Pass: max error <= 60 ms and total play time within 60 ms.

| browser | file | path | frames | mean err ms | max err ms | total expected / measured ms | late draws | |
|---|---|---|---|---|---|---|---|---|
| chromium | s/gif-delays.gif | imagedecoder | 7 | 11.8 | 16.3 | 2140 / 2151 | 1 | ok |
| chromium | s/gif-delays.gif | gif-fallback | 7 | 7.8 | 12.4 | 2140 / 2146 | 0 | ok |
| chromium | s/webp-delays.webp | imagedecoder | 6 | 13.3 | 17.8 | 940 / 949 | 1 | ok |
| chromium | s/webp-delays.webp | webp-anmf | 6 | 5.5 | 9.8 | 940 / 943 | 2 | ok |
| chromium | s/gif-mixed.gif | imagedecoder | 8 | 10.2 | 17.5 | 1560 / 1574 | 1 | ok |
| chromium | s/gif-mixed.gif | gif-fallback | 8 | 9.2 | 16.5 | 1560 / 1563 | 0 | ok |
| chromium | s/webp-mixed-codecs.webp | imagedecoder | 5 | 9.8 | 17 | 800 / 803 | 1 | ok |
| chromium | s/webp-mixed-codecs.webp | webp-anmf | 5 | 7.7 | 16.2 | 800 / 811 | 2 | ok |
| chromium | rotating-earth.gif | imagedecoder | 44 | 8.8 | 17 | 3960 / 3969 | 1 | ok |
| chromium | rotating-earth.gif | gif-fallback | 44 | 9.2 | 16.8 | 3960 / 3977 | 0 | ok |
| chromium | animated.webp | imagedecoder | 100 | 17.5 | 18.6 | 10000 / 10018 | 1 | ok |
| chromium | animated.webp | webp-anmf | 100 | 3.4 | 4.4 | 10000 / 10003 | 1 | ok |
| webkit | s/gif-delays.gif | imagedecoder | 7 | 9.4 | 14 | 2140 / 2151 | 1 | ok |
| webkit | s/gif-delays.gif | gif-fallback | 7 | 10.1 | 15 | 2140 / 2151 | 0 | ok |
| webkit | s/webp-delays.webp | imagedecoder | 6 | 8.1 | 12 | 940 / 945 | 1 | ok |
| webkit | s/webp-delays.webp | webp-anmf | 6 | 8.8 | 13 | 940 / 946 | 2 | ok |
| webkit | s/gif-mixed.gif | imagedecoder | 8 | 9.2 | 16 | 1560 / 1573 | 1 | ok |
| webkit | s/gif-mixed.gif | gif-fallback | 8 | 7.2 | 15 | 1560 / 1569 | 0 | ok |
| webkit | s/webp-mixed-codecs.webp | imagedecoder | 5 | 7.8 | 15 | 800 / 800 | 1 | ok |
| webkit | s/webp-mixed-codecs.webp | webp-anmf | 5 | 7.5 | 15 | 800 / 805 | 2 | ok |
| webkit | rotating-earth.gif | imagedecoder | 44 | 7.8 | 17 | 3960 / 3964 | 1 | ok |
| webkit | rotating-earth.gif | gif-fallback | 44 | 8 | 16 | 3960 / 3966 | 0 | ok |
| webkit | animated.webp | imagedecoder | 100 | 7.8 | 9 | 10000 / 10009 | 1 | ok |
| webkit | animated.webp | webp-anmf | 100 | 10.4 | 12 | 10000 / 10011 | 1 | ok |

## Loop counts (file vs. player option)

| browser | file | option | file loop count (total plays) | observed plays | ended after / expected ms | |
|---|---|---|---|---|---|---|
| chromium | s/gif-loop-0.gif | - | forever | 4 (expected forever) | - / - | ok |
| chromium | s/gif-loop-1.gif | - | 2 | 2 (expected 2) | 310 / 300 | ok |
| chromium | s/gif-loop-3.gif | - | 4 | 4 (expected 4) | 608 / 600 | ok |
| chromium | s/gif-loop-none.gif | - | 1 | 1 (expected 1) | 161 / 150 | ok |
| chromium | s/webp-loop-0.webp | - | forever | 4 (expected forever) | - / - | ok |
| chromium | s/webp-loop-1.webp | - | 1 | 1 (expected 1) | 159 / 150 | ok |
| chromium | s/webp-loop-3.webp | - | 3 | 3 (expected 3) | 459 / 450 | ok |
| chromium | s/gif-loop-3.gif | 2 | 4 | 2 (expected 2) | 311 / 300 | ok |
| chromium | s/webp-loop-0.webp | 3 | forever | 3 (expected 3) | 460 / 450 | ok |
| chromium | s/gif-loop-none.gif | 0 | 1 | 4 (expected forever) | - / - | ok |
| chromium | static.webp | - | 1 | 1 (expected 1) | 314 / 300 | ok |
| chromium | s/gif-single.gif | - | 1 | 1 (expected 1) | 315 / 300 | ok |
| chromium | s/webp-single.webp | - | 1 | 1 (expected 1) | 307 / 300 | ok |
| chromium | s/webp-static-alpha.webp | - | 1 | 1 (expected 1) | 307 / 300 | ok |
| webkit | s/gif-loop-0.gif | - | forever | 4 (expected forever) | - / - | ok |
| webkit | s/gif-loop-1.gif | - | 2 | 2 (expected 2) | 302 / 300 | ok |
| webkit | s/gif-loop-3.gif | - | 4 | 4 (expected 4) | 606 / 600 | ok |
| webkit | s/gif-loop-none.gif | - | 1 | 1 (expected 1) | 154 / 150 | ok |
| webkit | s/webp-loop-0.webp | - | forever | 4 (expected forever) | - / - | ok |
| webkit | s/webp-loop-1.webp | - | 1 | 1 (expected 1) | 167 / 150 | ok |
| webkit | s/webp-loop-3.webp | - | 3 | 3 (expected 3) | 452 / 450 | ok |
| webkit | s/gif-loop-3.gif | 2 | 4 | 2 (expected 2) | 309 / 300 | ok |
| webkit | s/webp-loop-0.webp | 3 | forever | 3 (expected 3) | 459 / 450 | ok |
| webkit | s/gif-loop-none.gif | 0 | 1 | 4 (expected forever) | - / - | ok |
| webkit | static.webp | - | 1 | 1 (expected 1) | 303 / 300 | ok |
| webkit | s/gif-single.gif | - | 1 | 1 (expected 1) | 302 / 300 | ok |
| webkit | s/webp-single.webp | - | 1 | 1 (expected 1) | 309 / 300 | ok |
| webkit | s/webp-static-alpha.webp | - | 1 | 1 (expected 1) | 307 / 300 | ok |

## Leaks: 50 create -> play -> seek -> destroy cycles per path

| browser | file | path | VideoFrames created / closed | ImageBitmaps created / closed | decoders opened / closed | still open | peak open per renderer | rAF outstanding | ResizeObservers live | |
|---|---|---|---|---|---|---|---|---|---|---|
| chromium | rotating-earth.gif | imagedecoder | 401 / 401 | 0 / 0 | 50 / 50 | 0 | 4 | 0 | 0 | ok |
| chromium | rotating-earth.gif | gif-fallback | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0 | 0 | 0 | ok |
| chromium | animated.webp | imagedecoder | 612 / 612 | 0 / 0 | 50 / 50 | 0 | 7 | 0 | 0 | ok |
| chromium | animated.webp | webp-anmf | 0 / 0 | 585 / 585 | 0 / 0 | 0 | 3 | 0 | 0 | ok |
| chromium | s/gif-mixed.gif | imagedecoder | 751 / 751 | 0 / 0 | 50 / 50 | 0 | 7 | 0 | 0 | ok |
| chromium | s/gif-mixed.gif | gif-fallback | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0 | 0 | 0 | ok |
| chromium | s/webp-mixed-codecs.webp | imagedecoder | 546 / 546 | 0 / 0 | 50 / 50 | 0 | 4 | 0 | 0 | ok |
| chromium | s/webp-mixed-codecs.webp | webp-anmf | 0 / 0 | 648 / 648 | 0 / 0 | 0 | 3 | 0 | 0 | ok |
| webkit | rotating-earth.gif | imagedecoder | 643 / 643 | 0 / 0 | 50 / 50 | 0 | 6 | 0 | 0 | ok |
| webkit | rotating-earth.gif | gif-fallback | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0 | 0 | 0 | ok |
| webkit | animated.webp | imagedecoder | 618 / 618 | 0 / 0 | 50 / 50 | 0 | 6 | 0 | 0 | ok |
| webkit | animated.webp | webp-anmf | 0 / 0 | 511 / 511 | 0 / 0 | 0 | 3 | 0 | 0 | ok |
| webkit | s/gif-mixed.gif | imagedecoder | 743 / 743 | 0 / 0 | 50 / 50 | 0 | 6 | 0 | 0 | ok |
| webkit | s/gif-mixed.gif | gif-fallback | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0 | 0 | 0 | ok |
| webkit | s/webp-mixed-codecs.webp | imagedecoder | 549 / 549 | 0 / 0 | 50 / 50 | 0 | 4 | 0 | 0 | ok |
| webkit | s/webp-mixed-codecs.webp | webp-anmf | 0 / 0 | 615 / 615 | 0 / 0 | 0 | 3 | 0 | 0 | ok |

**All checks passed** (rows marked "known" are the documented WebKit ImageDecoder bug, which `auto` routes around).
