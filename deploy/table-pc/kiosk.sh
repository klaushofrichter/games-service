#!/bin/sh
# Opens the board full screen once the Table Host answers. Run by gametable-kiosk.service inside cage.
PORT=$(grep -E '^PORT=' /opt/gametable/.env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-8080}
until curl -fs "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; do sleep 2; done
CHROME=$(command -v chromium || command -v chromium-browser || command -v google-chrome)
exec "$CHROME" \
  --kiosk --incognito --noerrdialogs --disable-session-crashed-bubble --disable-infobars \
  --disable-translate --disable-features=TranslateUI,Translate --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 --disable-pinch --touch-events=enabled \
  --autoplay-policy=no-user-gesture-required \
  "http://127.0.0.1:${PORT}/board/"
