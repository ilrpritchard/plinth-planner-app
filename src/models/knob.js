// knob.js — a simple turned knob, painted to match the cabinet (the material is
// passed in) so it changes colour with the finish. Used on drawers only.

import * as THREE from 'three';

let geo = null;
function knobGeo() {
  if (geo) return geo;
  const head = new THREE.SphereGeometry(0.55, 18, 14);
  head.scale(1, 0.9, 1);
  geo = head;
  return geo;
}

/** Returns a knob mesh whose back sits at z=0, protruding +Z, in `material`. */
export function makeKnob(material) {
  const m = new THREE.Group();
  const head = new THREE.Mesh(knobGeo(), material);
  head.castShadow = true;
  head.position.z = 0.5;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 10), material);
  stem.rotation.x = Math.PI / 2;
  stem.position.z = 0.22;
  m.add(stem, head);
  m.name = 'knob';
  return m;
}
