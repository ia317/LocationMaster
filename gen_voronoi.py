"""
Generate israel-cities-voronoi.geojson:
One Voronoi polygon per city, clipped to Israel's approximate boundary.
"""
import json, math
from scipy.spatial import Voronoi
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, mapping, Point
from shapely.ops import unary_union

# Israel boundary — detailed Mediterranean coastline + accurate land borders
# Coordinates: [lon, lat], traced clockwise from Rosh HaNikra
ISRAEL_BOUNDARY = Polygon([
    # Lebanese border (west → east)
    [35.10, 33.08],  # Rosh HaNikra (NW)
    [35.25, 33.10],
    [35.60, 33.09],
    # Golan / Syrian border (north → south)
    [36.05, 33.09],
    [36.05, 32.50],
    # Jordan River / Dead Sea / Wadi Araba (north → south)
    [35.60, 32.50],
    [35.58, 32.10],
    [35.57, 31.78],
    [35.55, 31.50],
    [35.52, 31.20],
    [35.50, 31.00],
    [35.48, 30.85],  # Dead Sea south tip
    [35.20, 30.50],  # Wadi Araba
    [35.08, 30.20],
    [34.97, 29.88],
    [34.95, 29.53],  # Eilat (SE corner)
    # Egyptian / Sinai border (SE → NW)
    [34.65, 29.50],
    [34.25, 30.10],
    [34.20, 30.65],
    [34.22, 31.00],
    [34.24, 31.13],  # Rafah
    # Mediterranean coast (south → north, detailed)
    [34.28, 31.22],
    [34.34, 31.28],
    [34.38, 31.37],
    [34.40, 31.43],
    [34.43, 31.47],
    [34.46, 31.50],  # north Gaza
    [34.49, 31.54],
    [34.54, 31.61],
    [34.57, 31.67],  # Ashkelon
    [34.60, 31.74],
    [34.64, 31.80],  # Ashdod
    [34.69, 31.86],
    [34.71, 31.91],
    [34.73, 31.97],
    [34.75, 32.02],  # Bat Yam / Jaffa
    [34.77, 32.09],  # Tel Aviv
    [34.82, 32.17],  # Herzliya coast
    [34.85, 32.25],
    [34.87, 32.34],  # Netanya
    [34.89, 32.43],
    [34.92, 32.50],  # Caesarea
    [34.93, 32.62],  # Atlit
    [34.95, 32.70],  # Carmel coast
    [34.97, 32.76],
    [34.99, 32.82],  # Haifa port
    [35.05, 32.87],  # Haifa bay north
    [35.08, 32.93],  # Akko
    [35.09, 32.97],
    [35.10, 33.00],  # Nahariya
    [35.10, 33.08],  # Rosh HaNikra (back to start)
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
