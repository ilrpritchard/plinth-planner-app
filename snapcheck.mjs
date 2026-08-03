import { snapPosition } from './src/interaction/snapping.js';
import { getCab } from './src/core/catalogue.js';
import { getFootprint } from './src/models/cabinet.js';

// minimal store
const mk = (items) => ({ state:{items}, getItem:(id)=>items.find(i=>i.id===id) });
const bounds = { minX:-60, maxX:60, minZ:-60, maxZ:60 };
const front = (it) => it.z + getFootprint(getCab(it.code)).d/2; // rot 0 front

// Scenario A: island, two F2 (24x24). A at z=0 (mid-room, off wall). Drag B beside it but 2" forward.
let A = { id:'a', code:'F2', x:0, z:0, rotDeg:0 };
let B = { id:'b', code:'F2', x:24, z:0, rotDeg:0 };
let r = snapPosition(mk([A,B]), 'b', 24.3, 2.0, bounds); // rawZ forward by 2"
console.log('A front', front(A).toFixed(3), 'B snapped z', r.z.toFixed(3), 'B front', (r.z+12).toFixed(3), '=> flush?', Math.abs(front(A)-(r.z+12))<1e-6);

// Scenario B: floor F2 dragged against a TALL (T-) cabinet. Tall should be 30mm (1.181") proud.
const tall = getCab('T1') || getCab('TL1');
console.log('tall code sample:', tall && tall.code, tall && tall.type, tall && tall.d);
