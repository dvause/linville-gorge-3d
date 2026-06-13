// Fetch Linville River + Lake James from the USGS National Hydrography Dataset
// (High Resolution) via the public NHD ArcGIS MapServer, clipped to the DEM
// bounding box, as raw GeoJSON into data/nhd/. Run with: node scripts/fetch_hydro.mjs
//
// Layers (https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer):
//   6  = Flowline - Large Scale  (high-res NHDFlowline)
//   12 = Waterbody - Large Scale (high-res NHDWaterbody)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '..', 'data', 'nhd');
const BASE = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer';

// DEM geographic bounds (matches public/heightmap_meta.json bounds_native).
const BBOX = '-81.97526993629236,35.757311916094906,-81.83054770249237,35.971293414694905';

function queryUrl(layer, params) {
  const u = new URL(`${BASE}/${layer}/query`);
  const def = {
    geometry: BBOX, geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outSR: '4326',
    returnGeometry: 'true', f: 'geojson',
  };
  for (const [k, v] of Object.entries({ ...def, ...params })) u.searchParams.set(k, v);
  return u.toString();
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

fs.mkdirSync(OUT, { recursive: true });

const flowline = await getJson(queryUrl(6, {
  where: "GNIS_NAME='Linville River'",
  outFields: 'GNIS_NAME,GNIS_ID,LENGTHKM,FCODE,FDATE',
}));
fs.writeFileSync(path.join(OUT, 'flowline.geojson'), JSON.stringify(flowline));
console.log('flowline features:', (flowline.features || []).length);

const waterbody = await getJson(queryUrl(12, {
  where: "GNIS_NAME='Lake James'",
  outFields: 'GNIS_NAME,GNIS_ID,FCODE,AREASQKM',
}));
fs.writeFileSync(path.join(OUT, 'waterbody.geojson'), JSON.stringify(waterbody));
console.log('waterbody features:', (waterbody.features || []).length);
