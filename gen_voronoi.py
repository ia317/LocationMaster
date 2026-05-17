"""
Generate israel-cities-voronoi.geojson:
One Voronoi polygon per city, clipped to Israel's approximate boundary.
"""
import json, math
from scipy.spatial import Voronoi
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, mapping, Point
from shapely.ops import unary_union

# Israel boundary (simplified polygon covering Israel + West Bank + Golan + Gaza)
# Coordinates: [lon, lat]
ISRAEL_BOUNDARY = Polygon([
    [34.20, 29.50],  # Eilat / Egyptian border (SW)
    [34.90, 29.50],  # Aqaba area
    [35.00, 30.00],  # Wadi Rum area
    [35.20, 30.80],  # Aqaba / south Jordan border
    [35.55, 31.00],  # south Dead Sea
    [35.60, 31.20],
    [35.60, 31.50],  # Dead Sea east
    [35.60, 31.72],
    [35.60, 32.00],
    [35.60, 32.50],
    [36.05, 32.50],  # Golan NE
    [36.05, 33.25],  # Golan N
    [35.60, 33.25],  # Lebanon/Syria corner
    [35.10, 33.10],  # Lebanon border W
    [34.95, 33.10],  # Rosh HaNikra (NW)
    [34.90, 33.05],
    [34.87, 32.90],  # Haifa coast N
    [34.76, 32.65],  # Haifa-Netanya coast
    [34.57, 32.22],  # coast
    [34.40, 31.85],  # central coast
    [34.36, 31.65],  # Ashkelon coast
    [34.30, 31.50],  # Gaza coast
    [34.22, 31.35],  # Gaza southern coast
    [34.23, 31.22],
    [34.26, 31.12],  # Rafah
    [34.25, 31.00],
    [34.20, 30.50],  # Sinai border
    [34.20, 29.50],  # back to start
])

# Load cities
with open('data/israel-cities.json', encoding='utf-8') as f:
    cities = json.load(f)

# City points: [lon, lat]
points = np.array([[c['center'][1], c['center'][0]] for c in cities])
ids    = [c['id'] for c in cities]

# Add far-away mirror points so all Voronoi regions are finite
far = 5.0
extra = []
for dx in [-far, 0, far]:
    for dy in [-far, 0, far]:
        if dx == 0 and dy == 0:
            continue
        extra.extend(points + np.array([dx, dy]))
all_points = np.vstack([points, extra])

vor = Voronoi(all_points)

features = []
for i, city in enumerate(cities):
    region_idx = vor.point_region[i]
    region = vor.regions[region_idx]
    if -1 in region or len(region) == 0:
        continue
    verts = [vor.vertices[v] for v in region]
    cell = Polygon(verts)
    clipped = cell.intersection(ISRAEL_BOUNDARY)
    if clipped.is_empty:
        continue
    features.append({
        "type": "Feature",
        "properties": {"id": ids[i]},
        "geometry": mapping(clipped)
    })

geojson = {"type": "FeatureCollection", "features": features}

with open('data/israel-cities-voronoi.geojson', 'w', encoding='utf-8') as f:
    json.dump(geojson, f, ensure_ascii=False, separators=(',', ':'))

print(f"Generated {len(features)} polygons")
for feat in features:
    print(f"  {feat['properties']['id']}: {feat['geometry']['type']}")
