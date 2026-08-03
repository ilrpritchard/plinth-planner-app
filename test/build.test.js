import { buildCabinet, getMountY, OPEN_ANGLE } from '../src/models/cabinet.js';
import { buildAppliance } from '../src/models/appliances.js';
import { Worktop } from '../src/models/worktop.js';
import { CATALOGUE, getCab, FINISHES } from '../src/core/catalogue.js';

let pass=0, fail=0;
const ok=(n,c)=>{ c?pass++:(fail++,console.error('✗ '+n)); };

// build every placeable cabinet in a few finishes; ensure no throw & has meshes
let built=0, meshTotal=0;
for(const cab of CATALOGUE.filter(c=>c.placeable && c.type!=='APPLIANCES')){
  for(const fin of [FINISHES[0], FINISHES[8], FINISHES[14]]){
    let g;
    try { g = buildCabinet(cab, fin.hex, {hinge:cab.hinge}); }
    catch(e){ fail++; console.error(`✗ build ${cab.code} ${fin.name}: ${e.message}`); continue; }
    let meshes=0; g.traverse(o=>{ if(o.isMesh) meshes++; });
    if(meshes<4){ fail++; console.error(`✗ ${cab.code} too few meshes (${meshes})`); }
    if(!g.userData.footprint || g.userData.mountY===undefined){ fail++; console.error(`✗ ${cab.code} missing userData`); }
    if(!Array.isArray(g.userData.doors)){ fail++; console.error(`✗ ${cab.code} missing doors array`); }
    built++; meshTotal+=meshes;
  }
}
ok(`built all cabinet SKUs ×3 finishes (${built} builds, ${meshTotal} meshes)`, built>0 && fail===0);

// appliances build
let apps=0;
for(const cab of CATALOGUE.filter(c=>c.type==='APPLIANCES')){
  try { const g=buildAppliance(cab); let m=0; g.traverse(o=>o.isMesh&&m++); if(m<1) fail++; apps++; }
  catch(e){ fail++; console.error(`✗ appliance ${cab.code}: ${e.message}`); }
}
ok(`built all appliances (${apps})`, apps===13);   // AP10 prep sink + AP11/12 french FF + AP13 over-under

// AP11 integrated fridge-freezer: correct install dims (84" h, 36" w, 24"
// counter depth) and a panel look — its meshes must include NO stainless body
// (integrated units read as cabinetry, not steel)
{
  const ff = CATALOGUE.find(c=>c.code==='AP11');
  ok('AP11 in catalogue', !!ff);
  ok('AP11 dims 36×24×84 on the floor', ff.w===36 && ff.d===24 && ff.h===84 && ff.mountY===0 && ff.integrated===true);
  const g = buildAppliance(ff); let m=0; g.traverse(o=>o.isMesh&&m++);
  ok('AP11 builds a multi-part front (doors + drawer + knobs)', m>=8);
}

// F30/F31 cooktop bases: fronts must be IDENTICAL to F20/F10 (form-driven —
// the false top drawer is a workshop detail, never a visual one)
{
  const f30 = getCab('F30'), f31 = getCab('F31'), f20 = getCab('F20'), f10 = getCab('F10');
  ok('F30 renders as a 3-drawer bank like F20', f30.form === 'drawers' && f20.form === 'drawers');
  ok('F31 renders as a double like F10', f31.form === 'double' && f10.form === 'double');
  ok('F30/F31 are 36" cooktop-width bases, same box as their donors',
    f30.w === 36 && f31.w === 36 && f30.h === f20.h && f30.d === f20.d && f31.h === f10.h && f31.d === f10.d);
}

// T13 tall double: plain full-height double-door tall — hinged L+R pair
{
  const t13 = getCab('T13');
  ok('T13 in catalogue as a tall double', !!t13 && t13.type==='TALL' && t13.form==='double' && t13.w===44 && t13.h===86);
  const g = buildCabinet(t13, FINISHES[0].hex, {});
  ok('T13 has 2 hinged doors opening opposite ways', g.userData.doors.length===2 &&
    Math.sign(g.userData.doors[0].userData.openAngle)===-Math.sign(g.userData.doors[1].userData.openAngle));
}

// AP12/AP13 sized integrated fridges: 72" french-door and 30" over-under
{
  const a12 = CATALOGUE.find(c=>c.code==='AP12'), a13 = CATALOGUE.find(c=>c.code==='AP13');
  ok('AP12 F&P dims 36×25×72', a12.w===36 && a12.d===25 && a12.h===72 && a12.integrated===true);
  ok('AP13 over-under dims 30×24×84 with single door', a13.w===30 && a13.h===84 && a13.overUnder===true);
}

// hinged door opens with a sensible angle; left & right doors open opposite ways
const dbl = buildCabinet(getCab('F10'), FINISHES[0].hex, {hinge:'n/a'});
ok('double has 2 door pivots', dbl.userData.doors.length===2);
ok('doors open opposite directions', Math.sign(dbl.userData.doors[0].userData.openAngle)===-Math.sign(dbl.userData.doors[1].userData.openAngle));
ok('open angle ~105°', Math.abs(Math.abs(dbl.userData.doors[0].userData.openAngle)-OPEN_ANGLE)<1e-6);

// door cabinet has an oak shelf (extra mesh vs none); drawers have none
const door = buildCabinet(getCab('F2'), FINISHES[0].hex, {});
ok('single door has 1 hinged door', door.userData.doors.length===1);

// fridge/freezer housings (T3/T4) are SEALED appliance fronts: the shaker
// leaves are static — no hinged doors, so "Open doors" never shows and there
// is no interior to reveal. The T9 oven housing keeps its ONE small hinged
// door; its oven fascia stays static.
const t3 = buildCabinet(getCab('T3'), FINISHES[0].hex, {});
ok('T3 fridge housing has NO hinged doors', t3.userData.doors.length===0);
const t4 = buildCabinet(getCab('T4'), FINISHES[0].hex, {});
ok('T4 fridge housing has NO hinged doors', t4.userData.doors.length===0);
let t3meshes=0; t3.traverse(o=>{ if(o.isMesh) t3meshes++; });
ok('T3 housing still shows a shaker front', t3meshes>=8);
const t9 = buildCabinet(getCab('T9'), FINISHES[0].hex, {});
ok('T9 oven housing keeps exactly 1 hinged door', t9.userData.doors.length===1);

// mount heights correct per family + appliances
ok('FLOOR mount 0', getMountY(getCab('F1'))===0);
ok('WALL mount 54', getMountY(getCab('W1'))===54);
ok('COUNTER mount 36.5', getMountY(getCab('C1'))===36.5);
ok('TALL mount 0', getMountY(getCab('T1'))===0);
ok('hob mounts on worktop 36.5', getMountY(getCab('AP4'))===36.5);
ok('range mounts on floor 0', getMountY(getCab('AP1'))===0);

// worktop: only over FLOOR units, and adjacent floor units merge into ONE
// continuous slab (no per-cabinet seams). W1 (wall) is ignored.
const stub={ add(){}, };
const wt=new Worktop(stub);
const items=[{id:1,code:'F2',x:0,z:-48,rotDeg:0},{id:2,code:'W1',x:0,z:-48,rotDeg:0},{id:3,code:'F10',x:30,z:-48,rotDeg:0}];
wt.rebuild(items, getCab);
let slabs=0; wt.group.traverse(o=>{ if(o.isMesh) slabs++; });
ok('adjacent floor units share one continuous worktop (1 slab)', slabs===1);

// floor units separated by a big (range-width) gap stay as separate slabs
const wt2=new Worktop(stub);
wt2.rebuild([{id:1,code:'F2',x:0,z:-48,rotDeg:0},{id:2,code:'F2',x:60,z:-48,rotDeg:0}], getCab);
let slabs2=0; wt2.group.traverse(o=>{ if(o.isMesh) slabs2++; });
ok('floor units split by a big gap get separate slabs (2)', slabs2===2);

console.log(`\nbuild.test.js — ${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
