#!/usr/bin/env bash
# Download raw open data into data-raw/ (git-ignored). Then run:
#   npm run data:sgu    (SGU geology via WMS)
#   npm run data:build  (writes public/data/)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data-raw/baskarta data-raw/dem data-raw/osm

# Göteborgs Stad baskarta, SHP, EPSG:3007, CC0, updated daily (~700 MB)
curl -fL -C - -o data-raw/baskarta/baskarta_shp_v2.zip https://opengeodata.goteborg.se/downloads/baskarta/baskarta_shp_v2.zip
unzip -oq data-raw/baskarta/baskarta_shp_v2.zip -d data-raw/baskarta -x 'hojdkurvor.*' 'hojdtext.*' 'hojdpunkt.*'

# Göteborgs Stad höjdmodell 2022, 0.5 m GeoTIFF, 10x10 km package 639_14, CC0 (~580 MB)
curl -fL -C - -o data-raw/dem/dem.zip https://opengeodata.goteborg.se/downloads/hojdmodell/2022/hojdmodell_2022_639_14.zip
unzip -oq data-raw/dem/dem.zip -d data-raw/dem '639_14/6398_14[78].*' '639_14/6399_14[78].*'

# OpenStreetMap via the main API (/map, 8 tiles to stay under the node limit), ODbL
i=0
for lo in "11.9552 11.9625" "11.9625 11.9698" "11.9698 11.9771" "11.9771 11.9844"; do
  for la in "57.7010 57.7088" "57.7088 57.7166"; do
    set -- $lo $la; i=$((i+1))
    curl -fsS -o "data-raw/osm/t$i.osm" "https://api.openstreetmap.org/api/0.6/map?bbox=$1,$3,$2,$4"
    sleep 1
  done
done
echo "Done. Next: npm run data:sgu && npm run data:build"
