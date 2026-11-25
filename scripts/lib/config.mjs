// Shared configuration for data scripts.
import proj4 from 'proj4';

// SWEREF 99 12 00 is the native CRS of Göteborgs Stad's open geodata.
proj4.defs('EPSG:3007', '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
// SWEREF 99 TM is used by SGU.
proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// Study area: 1.5 x 1.5 km in EPSG:3007 covering Centralstationen, Nordstan,
// Trädgårdsföreningen, Kungsportsplatsen and the edge of Göta älv.
export const BBOX = [147450, 6398100, 148950, 6399600]; // minE, minN, maxE, maxN
export const ORIGIN = [(BBOX[0] + BBOX[2]) / 2, (BBOX[1] + BBOX[3]) / 2];
export const SIZE = BBOX[2] - BBOX[0];

export const RAW = new URL('../../data-raw/', import.meta.url).pathname;
export const OUT = new URL('../../public/data/', import.meta.url).pathname;

export const toLocal = (e, n) => [e - ORIGIN[0], n - ORIGIN[1]];
export const wgsTo3007 = (lon, lat) => proj4('EPSG:4326', 'EPSG:3007', [lon, lat]);
export const sweref3006To3007 = (e, n) => proj4('EPSG:3006', 'EPSG:3007', [e, n]);
export const s3007To3006 = (e, n) => proj4('EPSG:3007', 'EPSG:3006', [e, n]);
export const s3007ToWgs = (e, n) => proj4('EPSG:3007', 'EPSG:4326', [e, n]);
