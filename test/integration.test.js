import { Store } from '../src/core/store.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { summarize } from '../src/core/cost.js';
import { buildOrderEmail } from '../src/core/order.js';
import { getCab, sellUSD } from '../src/core/catalogue.js';

let pass=0, fail=0;
const ok=(n,c)=>{ c?pass++:(fail++,console.error('✗ '+n)); };

// pricing sanity: F1 gbp 676 -> (676+20)*1.32*2 = 1837.44
ok('F1 sell ≈ $1837', Math.abs(sellUSD(getCab('F1'))-1837.44)<0.01);

const store=new Store();
store.setRoom({width:144,depth:120,height:96});
const bounds={minX:-72,maxX:72,minZ:-60,maxZ:60};

// place two F2 (24") base units near back wall, drag the second next to the first
const a=store.addItem('F2',{x:-40,z:0});
let sa=snapPosition(store,a.id,-40,-58,bounds); // near back wall
store.updateItem(a.id,sa,{quiet:false});
ok('A snaps to back wall (rot 0)', sa.rotDeg===0);
ok('A back sits just off wall z≈minZ+d/2+gap', Math.abs(sa.z-(bounds.minZ+24/2+0.25))<0.01);

const b=store.addItem('F2',{x:-10,z:0});
// drag B toward A's right edge: A center x=sa.x, edge at sa.x+12; B should butt at sa.x+24
let sb=snapPosition(store,b.id, sa.x+20, -58, bounds);
store.updateItem(b.id,sb,{quiet:false});
ok('B snaps to back wall', sb.rotDeg===0);
ok('B butts edge-to-edge (24" apart)', Math.abs((sb.x-sa.x)-24)<0.01);

// the snap RESPECTS orientation: a side-facing (rot 90) cabinet snaps to the
// LEFT wall; a back-facing (rot 0) one near the left wall does NOT auto-rotate.
const c=store.addItem('F2',{x:0,z:0,rotDeg:90});
let sc=snapPosition(store,c.id,-70,10,bounds);
ok('C (rot 90) snaps to left wall', sc.rotDeg===90);
ok('C left sits just off wall x≈minX+d/2+gap', Math.abs(sc.x-(bounds.minX+24/2+0.25))<0.01);

// clamp keeps items on the floor
let clamped=snapPosition(store,c.id, 999, 999, bounds);
ok('clamp keeps inside room X', clamped.x<=bounds.maxX);
ok('clamp keeps inside room Z', clamped.z<=bounds.maxZ);

// cost summary
const sum=summarize(store.state.items);
ok('3 cabinets total', sum.totalCabs===3);
ok('subtotal = 3×F2 sell', Math.abs(sum.subtotal-3*sellUSD(getCab('F2')))<0.01);

// order email
store.setCustomer({name:'Imogen Test',email:'i@test.com',zip:'10001'});
const mail=buildOrderEmail(store.state);
ok('mailto target', mail.href.startsWith('mailto:imogen@plinthmade.com'));
ok('subject has count', mail.subject.includes('3 cabinets'));
ok('body lists F2', mail.body.includes('F2'));
ok('body has finish', mail.body.includes('Finish:'));

console.log(`\nintegration.test.js — ${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
